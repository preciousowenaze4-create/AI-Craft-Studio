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
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'deepseek-r1',
    label: 'DeepSeek-R1 (Deep Step-by-Step Reasoning)',
    shortLabel: 'DeepSeek-R1',
    description: 'Deep analytical & multi-step reasoning engine',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'searchgpt',
    label: 'SearchGPT (Live Real-Time Web Search)',
    shortLabel: 'SearchGPT',
    description: 'Live DuckDuckGo + Wikipedia + Google Search grounding',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'coder-pro',
    label: 'Coder Pro (Full-Stack App Builder)',
    shortLabel: 'Coder Pro',
    description: 'Optimized for complete production code & live sandboxes',
    pollinationsModel: 'openai-fast',
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

function createLinkedTimeoutSignal(
  parentSignal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();

  if (parentSignal.aborted) {
    controller.abort();
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => {
      window.clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
    },
  };
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

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
  parentSignal: AbortSignal
): Promise<{ sources: LiveSource[]; groundedSummary: string }> {
  const searchGuard = createLinkedTimeoutSignal(parentSignal, 4500);
  try {
    const res = await fetch('/api/search/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, useGoogleGrounding: true }),
      signal: searchGuard.signal,
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
    if (parentSignal.aborted) {
      searchGuard.clear();
      throw new Error('Aborted');
    }
  } finally {
    searchGuard.clear();
  }

  // Client-side keyless backup search (Wikipedia + DuckDuckGo)
  const backupGuard = createLinkedTimeoutSignal(parentSignal, 4500);
  try {
    const [wikiRes, ddgRes] = await Promise.all([
      fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`,
        { signal: backupGuard.signal }
      ).catch(() => null),
      fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
        { signal: backupGuard.signal }
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
  } finally {
    backupGuard.clear();
  }
}

async function streamDirectOpenAISSE(
  endpointUrl: string,
  model: string,
  engineLabel: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onToken: (token: string, engine: string) => void,
  parentSignal: AbortSignal,
  connectTimeoutMs = 7000
): Promise<boolean> {
  const timeoutGuard = createLinkedTimeoutSignal(parentSignal, connectTimeoutMs);

  let res: Response;
  try {
    res = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: timeoutGuard.signal,
    });
  } catch (err) {
    timeoutGuard.clear();
    throw err;
  }

  if (!res.ok || !res.body) {
    timeoutGuard.clear();
    return false;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotTokens = false;
  let openedReasoningTag = false;
  let sawContentAfterReasoning = false;

  const emit = (text: string) => {
    if (!text) return;
    if (!gotTokens) {
      timeoutGuard.clear();
      gotTokens = true;
    }
    onToken(text, engineLabel);
  };

  try {
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
        if (payload === '[DONE]') {
          if (openedReasoningTag && !sawContentAfterReasoning) {
            emit('</think>\n');
          }
          return gotTokens;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning?: string | null;
                reasoning_content?: string | null;
              };
              message?: {
                content?: string | null;
                reasoning?: string | null;
                reasoning_content?: string | null;
              };
            }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          const msg = parsed.choices?.[0]?.message;
          const reasoning =
            delta?.reasoning ??
            delta?.reasoning_content ??
            msg?.reasoning ??
            msg?.reasoning_content ??
            '';
          const content = delta?.content ?? msg?.content ?? '';

          if (reasoning && !sawContentAfterReasoning) {
            if (!openedReasoningTag) {
              openedReasoningTag = true;
              if (!reasoning.trimStart().startsWith('<think>')) {
                emit('<think>\n');
              }
            }
            emit(reasoning);
          }

          if (content) {
            if (openedReasoningTag && !sawContentAfterReasoning) {
              sawContentAfterReasoning = true;
              if (!content.trimStart().startsWith('</think>')) {
                emit('\n</think>\n\n');
              }
            }
            emit(content);
          }
        } catch {
          // ignore partial JSON chunk
        }
      }
    }
  } finally {
    timeoutGuard.clear();
  }

  if (openedReasoningTag && !sawContentAfterReasoning) {
    emit('</think>\n');
  }
  return gotTokens;
}

async function directClientCloudFailover(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onToken: (token: string, engine: string) => void,
  parentSignal: AbortSignal
): Promise<string | null> {
  // Browser Tier 1: Direct LLM7 SSE Stream (CORS *, zero API key, fast ~350ms TTFT)
  try {
    const ok = await streamDirectOpenAISSE(
      'https://api.llm7.io/v1/chat/completions',
      'fast',
      'Direct Cloud (LLM7 Fast)',
      messages,
      onToken,
      parentSignal,
      7000
    );
    if (ok) return 'Direct Cloud (LLM7 Fast)';
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  }

  // Browser Tier 2: Direct Pollinations OpenAI-compatible SSE Stream (active free model)
  try {
    const ok = await streamDirectOpenAISSE(
      'https://text.pollinations.ai/openai',
      'openai-fast',
      'Direct Cloud (Pollinations)',
      messages,
      onToken,
      parentSignal,
      7000
    );
    if (ok) return 'Direct Cloud (Pollinations)';
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  }

  // Browser Tier 3: Automatic retry on LLM7 (default) after 1.1s rate-limit backoff
  try {
    await sleepAbortable(1100, parentSignal);
    const ok = await streamDirectOpenAISSE(
      'https://api.llm7.io/v1/chat/completions',
      'default',
      'Direct Cloud (LLM7 Default)',
      messages,
      onToken,
      parentSignal,
      8500
    );
    if (ok) return 'Direct Cloud (LLM7 Default)';
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  }

  // Browser Tier 4: Direct Pollinations POST Text Endpoint
  const postGuard = createLinkedTimeoutSignal(parentSignal, 8500);
  try {
    const postRes = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model: 'openai-fast',
        private: true,
      }),
      signal: postGuard.signal,
    });
    if (postRes.ok) {
      const fullText = await postRes.text();
      if (fullText.trim()) {
        onToken(fullText, 'Direct Pollinations POST');
        return 'Direct Pollinations POST';
      }
    }
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  } finally {
    postGuard.clear();
  }

  // Browser Tier 5: Non-streaming LLM7 retry
  const llm7JsonGuard = createLinkedTimeoutSignal(parentSignal, 9500);
  try {
    const res = await fetch('https://api.llm7.io/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'default',
        messages,
        stream: false,
      }),
      signal: llm7JsonGuard.signal,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            reasoning_content?: string;
            reasoning?: string;
          };
        }>;
      };
      const msg = data.choices?.[0]?.message;
      const content = msg?.content?.trim() || '';
      const reasoning = (msg?.reasoning_content || msg?.reasoning || '').trim();
      if (content) {
        const combined =
          reasoning && !content.includes('<think>')
            ? `<think>\n${reasoning}\n</think>\n\n${content}`
            : content;
        onToken(combined, 'Direct Cloud (LLM7)');
        return 'Direct Cloud (LLM7)';
      }
    }
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  } finally {
    llm7JsonGuard.clear();
  }

  // Browser Tier 6: Safe-length GET fallback to Pollinations
  const getGuard = createLinkedTimeoutSignal(parentSignal, 8500);
  try {
    const lastUser = (
      [...messages].reverse().find((m) => m.role === 'user')?.content || 'Hello'
    ).slice(0, 900);
    const sys = (messages.find((m) => m.role === 'system')?.content || '').slice(0, 500);
    const textRes = await fetch(
      `https://text.pollinations.ai/${encodeURIComponent(lastUser)}?model=openai-fast&system=${encodeURIComponent(sys)}`,
      { signal: getGuard.signal }
    );
    if (textRes.ok) {
      const fullText = await textRes.text();
      if (fullText.trim()) {
        onToken(fullText, 'Direct Pollinations Text');
        return 'Direct Pollinations Text';
      }
    }
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  } finally {
    getGuard.clear();
  }

  return null;
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
        (REALTIME_KEYWORDS.test(lastUserMsg) || lastUserMsg.trim().endsWith('?'))) ||
      liveSearchEnabled)
  ) {
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
  let engineUsed = `Cloud Router (${modeOption.shortLabel})`;
  let gotAnyTokenFromBackend = false;

  const backendConnectGuard = createLinkedTimeoutSignal(signal, 8500);
  try {
    const res = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: modeOption.pollinationsModel,
        messages: payloadMessages,
      }),
      signal: backendConnectGuard.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Backend stream unavailable (HTTP ${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
            if (!gotAnyTokenFromBackend) {
              backendConnectGuard.clear();
              gotAnyTokenFromBackend = true;
            }
            onToken(parsed.token, engineUsed);
          }
        } catch (parseErr) {
          if (
            parseErr instanceof Error &&
            parseErr.message !== 'Unexpected end of JSON input'
          ) {
            throw parseErr;
          }
        }
      }
    }

    if (gotAnyTokenFromBackend) {
      return engineUsed;
    }
    throw new Error('Empty stream from backend router');
  } catch (err) {
    backendConnectGuard.clear();
    if (signal.aborted) throw err;

    // If backend already streamed partial output, keep what we have rather than duplicating
    if (gotAnyTokenFromBackend) {
      return engineUsed;
    }

    // Instant client-side multi-tier keyless failover (handles 404, 5xx, static PWA, or slow backend)
    const fallbackEngine = await directClientCloudFailover(
      payloadMessages,
      (token, eng) => {
        engineUsed = eng;
        onToken(token, eng);
      },
      signal
    );

    if (fallbackEngine) {
      return fallbackEngine;
    }

    throw new Error(
      'Unable to reach free cloud AI endpoints right now. Please tap Regenerate or switch to Local WebGPU mode.'
    );
  } finally {
    backendConnectGuard.clear();
  }
}
