import type {
  LiveSource,
  LocalModelProgress,
  ModelModeId,
  ModelModeOption,
  PersonaRule,
} from '../types';
import { buildSystemPrompt } from './systemPrompt';
import { streamLocalBrowserAI } from './localAi';

export const MODEL_MODES: ModelModeOption[] = [
  {
    id: 'auto',
    label: 'Auto-Router (Fast + Unlimited)',
    shortLabel: 'Auto-Router',
    description: 'Zero-key multi-tier cloud router with instant failover',
    pollinationsModel: 'openai',
  },
  {
    id: 'deepseek-r1',
    label: 'DeepSeek-R1 (Deep Step-by-Step Reasoning)',
    shortLabel: 'DeepSeek-R1',
    description: 'Deep analytical & multi-step reasoning engine',
    pollinationsModel: 'deepseek-r1',
  },
  {
    id: 'searchgpt',
    label: 'SearchGPT (Live Real-Time Web Search)',
    shortLabel: 'SearchGPT',
    description: 'Live DuckDuckGo + Wikipedia + Google Search grounding',
    pollinationsModel: 'searchgpt',
  },
  {
    id: 'coder-pro',
    label: 'Coder Pro (Full-Stack App Builder)',
    shortLabel: 'Coder Pro',
    description: 'Optimized for complete production code & live sandboxes',
    pollinationsModel: 'openai-large',
  },
  {
    id: 'local-webgpu',
    label: 'Local Browser AI (Offline / Zero Server Limits)',
    shortLabel: 'Local WebGPU',
    description: 'In-browser Qwen2.5-Coder-1.5B cached locally via WebGPU',
    pollinationsModel: 'local',
  },
];

export interface RunChatStreamParams {
  modelMode: ModelModeId;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  liveSearchEnabled: boolean;
  personaRules: PersonaRule[];
  onSources?: (sources: LiveSource[]) => void;
  onToken: (token: string, engine: string) => void;
  onLocalProgress?: (progress: LocalModelProgress) => void;
  signal: AbortSignal;
}

const REALTIME_KEYWORDS =
  /\b(today|latest|current|news|weather|price|stock|bitcoin|crypto|score|winner|who won|release|2025|2026|now|recent|live|forecast|docs|documentation|what is the date)\b/i;

export function shouldTriggerLiveSearch(
  prompt: string,
  modelMode: ModelModeId,
  liveSearchEnabled: boolean
): boolean {
  if (modelMode === 'searchgpt') return true;
  if (!liveSearchEnabled) return false;
  return REALTIME_KEYWORDS.test(prompt) || liveSearchEnabled;
}

async function fetchLiveSearchContext(
  query: string,
  signal: AbortSignal
): Promise<{ sources: LiveSource[]; groundedSummary: string }> {
  try {
    const res = await fetch('/api/search/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, useGoogleGrounding: true }),
      signal,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        sources?: LiveSource[];
        groundedSummary?: string;
      };
      return {
        sources: data.sources || [],
        groundedSummary: data.groundedSummary || '',
      };
    }
  } catch {
    // Fall back to direct browser Wikipedia + DuckDuckGo fetch
  }

  // Client-side keyless backup search
  try {
    const [wikiRes, ddgRes] = await Promise.all([
      fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`,
        { signal }
      ).catch(() => null),
      fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
        { signal }
      ).catch(() => null),
    ]);

    const sources: LiveSource[] = [];
    if (wikiRes?.ok) {
      const wikiJson = (await wikiRes.json()) as {
        query?: { search?: Array<{ title: string; snippet: string }> };
      };
      for (const hit of wikiJson.query?.search || []) {
        sources.push({
          title: `${hit.title} — Wikipedia`,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
          snippet: hit.snippet.replace(/<[^>]+>/g, ''),
          provider: 'Wikipedia',
        });
      }
    }
    if (ddgRes?.ok) {
      const ddgJson = (await ddgRes.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
      };
      if (ddgJson.AbstractText && ddgJson.AbstractURL) {
        sources.push({
          title: ddgJson.Heading || query,
          url: ddgJson.AbstractURL,
          snippet: ddgJson.AbstractText,
          provider: 'DuckDuckGo',
        });
      }
    }
    return { sources, groundedSummary: '' };
  } catch {
    return { sources: [], groundedSummary: '' };
  }
}

async function directClientPollinationsFallback(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onToken: (token: string, engine: string) => void,
  signal: AbortSignal
): Promise<boolean> {
  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotTokens = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const trimmed = raw.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return gotTokens;
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content || '';
            if (token) {
              gotTokens = true;
              onToken(token, `Direct Cloud (${model})`);
            }
          } catch {
            // ignore
          }
        }
      }
      if (gotTokens) return true;
    }
  } catch {
    // Fall through to GET endpoint
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const textRes = await fetch(
    `https://text.pollinations.ai/${encodeURIComponent(lastUser)}`,
    { signal }
  );
  if (textRes.ok) {
    const fullText = await textRes.text();
    if (fullText) {
      onToken(fullText, 'Direct Pollinations Text');
      return true;
    }
  }
  return false;
}

export async function runChatStream(params: RunChatStreamParams): Promise<string> {
  const {
    modelMode,
    history,
    liveSearchEnabled,
    personaRules,
    onSources,
    onToken,
    onLocalProgress,
    signal,
  } = params;

  const lastUserMsg = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  let liveSources: LiveSource[] = [];
  let groundedSummary = '';

  if (
    lastUserMsg &&
    modelMode !== 'local-webgpu' &&
    (modelMode === 'searchgpt' ||
      (liveSearchEnabled &&
        (REALTIME_KEYWORDS.test(lastUserMsg) || lastUserMsg.trim().endsWith('?'))))
  ) {
    const searchRes = await fetchLiveSearchContext(lastUserMsg, signal);
    liveSources = searchRes.sources;
    groundedSummary = searchRes.groundedSummary;
    if (liveSources.length > 0) {
      onSources?.(liveSources);
    }
  } else if (liveSearchEnabled && modelMode !== 'local-webgpu' && lastUserMsg) {
    // Even if not a question, if user explicitly kept Live Web Search ON, still query quietly for factual boost
    const searchRes = await fetchLiveSearchContext(lastUserMsg, signal);
    liveSources = searchRes.sources;
    groundedSummary = searchRes.groundedSummary;
    if (liveSources.length > 0) {
      onSources?.(liveSources);
    }
  }

  const systemPrompt = buildSystemPrompt({
    modelMode,
    personaRules,
    liveSources,
    groundedSummary,
  });

  const payloadMessages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }> = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-14).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  // Offline / In-Browser Local AI Mode
  if (modelMode === 'local-webgpu') {
    await streamLocalBrowserAI(
      payloadMessages,
      (token) => onToken(token, 'Local Browser AI (Qwen2.5-Coder-1.5B)'),
      onLocalProgress,
      signal
    );
    return 'Local Browser AI (Qwen2.5-Coder-1.5B)';
  }

  const modeOption = MODEL_MODES.find((m) => m.id === modelMode) || MODEL_MODES[0];
  let engineUsed = `Pollinations (${modeOption.pollinationsModel})`;

  try {
    const res = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeOption.pollinationsModel,
        messages: payloadMessages,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Stream endpoint HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotAnyToken = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const jsonText = line.slice(5).trim();
        if (!jsonText) continue;

        try {
          const parsed = JSON.parse(jsonText) as {
            token?: string;
            engine?: string;
            done?: boolean;
            error?: string;
          };
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.engine) {
            engineUsed = parsed.engine;
          }
          if (parsed.token) {
            gotAnyToken = true;
            onToken(parsed.token, engineUsed);
          }
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
            throw parseErr;
          }
        }
      }
    }

    if (gotAnyToken) {
      return engineUsed;
    }
    throw new Error('Empty stream from backend router');
  } catch (err) {
    if (signal.aborted) throw err;
    // Direct client-side keyless failover if backend proxy failed
    const ok = await directClientPollinationsFallback(
      modeOption.pollinationsModel,
      payloadMessages,
      (token, eng) => {
        engineUsed = eng;
        onToken(token, eng);
      },
      signal
    );
    if (!ok) {
      throw err instanceof Error ? err : new Error('All keyless AI endpoints failed');
    }
    return engineUsed;
  }
}
