import type {
  ApiMessageContent,
  ChatImageAttachment,
  LiveSource,
  LocalModelProgress,
  ModelModeId,
  ModelModeOption,
  MultimodalPart,
  PersonaRule,
} from '../types';
import { buildSystemPrompt } from './systemPrompt';
import { streamLocalBrowserAI } from './localAi';

export const MODEL_MODES: ModelModeOption[] = [
  {
    id: 'auto',
    label: 'Auto-Router (Fast + Unlimited)',
    shortLabel: 'Auto-Router',
    description: 'Client-first multi-tier cloud router scaled for high concurrency',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'deepseek-r1',
    label: 'DeepSeek-R1 (Deep Step-by-Step Reasoning)',
    shortLabel: 'DeepSeek-R1',
    description: 'DeepSeek V4.1, Qwen3.5 397B & Nemotron reasoning engines',
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
    label: 'Coder Pro (Full-Stack App & Vision Builder)',
    shortLabel: 'Coder Pro',
    description: 'GPT-OSS 120B, Qwen3.6 Coder, NorthCode & Vision-to-App engines',
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

export interface HistoryTurnInput {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImageAttachment[];
}

export interface RunChatStreamParams {
  modelMode: ModelModeId;
  history: HistoryTurnInput[];
  liveSearchEnabled: boolean;
  personaRules: PersonaRule[];
  onSources?: (sources: LiveSource[]) => void;
  onToken: (token: string, engine: string) => void;
  onLocalProgress?: (progress: LocalModelProgress) => void;
  signal: AbortSignal;
}

interface ApiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ApiMessageContent;
}

const REALTIME_KEYWORDS =
  /\b(today|latest|current|currently|news|headline|headlines|weather|forecast|price|stock|bitcoin|crypto|score|winner|who won|release|released|2025|2026|now|recent|recently|live|docs|documentation|what is the date|what day is|who is the)\b/i;

const CASUAL_OR_BUILD_ONLY =
  /^\s*(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|how are you|thanks|thank you|ok|okay|build |create |make |design |write |code |fix |debug |refactor )/i;

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

export function shouldTriggerLiveSearch(
  prompt: string,
  modelMode: ModelModeId,
  liveSearchEnabled: boolean,
  hasImages = false
): boolean {
  if (modelMode === 'searchgpt') return true;
  if (hasImages) return false;
  if (!liveSearchEnabled) return false;
  if (REALTIME_KEYWORDS.test(prompt)) return true;
  if (CASUAL_OR_BUILD_ONLY.test(prompt)) return false;
  return /\b(what|who|when|where|which|how much|how many|search|lookup|find)\b/i.test(
    prompt
  );
}

async function fetchLiveSearchContext(
  query: string,
  parentSignal: AbortSignal
): Promise<{ sources: LiveSource[]; groundedSummary: string }> {
  // Client-first Wikipedia + DuckDuckGo for scale, or /api/search/live with Google Grounding
  const searchGuard = createLinkedTimeoutSignal(parentSignal, 2400);
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

  const backupGuard = createLinkedTimeoutSignal(parentSignal, 2400);
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

function toTextOnlyMessages(messages: ApiChatMessage[]): Array<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}> {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content
            .map((p) => (p.type === 'text' ? p.text : '[Attached image]'))
            .filter(Boolean)
            .join('\n'),
  }));
}

async function streamDirectOpenAISSE(
  endpointUrl: string,
  model: string,
  engineLabel: string,
  messages: ApiChatMessage[],
  onToken: (token: string, engine: string) => void,
  parentSignal: AbortSignal,
  connectTimeoutMs = 4500
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

/**
 * Client-first direct browser routing across CORS-enabled keyless cloud engines.
 * Each of the app's users (e.g. 5,000+ users) uses their own client IP,
 * eliminating shared server IP rate-limit bottlenecks.
 */
async function tryClientDirectCloud(
  modelMode: ModelModeId,
  messages: ApiChatMessage[],
  hasImages: boolean,
  onToken: (token: string, engine: string) => void,
  parentSignal: AbortSignal
): Promise<string | null> {
  const OVH_URL = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions';
  const LLM7_URL = 'https://api.llm7.io/v1/chat/completions';

  interface DirectTarget {
    url: string;
    model: string;
    label: string;
    timeoutMs?: number;
    supportsVision?: boolean;
  }

  const directTargets: DirectTarget[] = hasImages
    ? [
        {
          url: OVH_URL,
          model: 'Qwen2.5-VL-72B-Instruct',
          label: 'OVH Qwen2.5-VL 72B',
          timeoutMs: 7000,
          supportsVision: true,
        },
        {
          url: OVH_URL,
          model: 'qwen3-vl-30b-a3b',
          label: 'OVH Qwen3-VL 30B',
          timeoutMs: 7000,
          supportsVision: true,
        },
        {
          url: OVH_URL,
          model: 'Mistral-Small-3.2-24B-Instruct-2506',
          label: 'OVH Mistral 3.2 Vision',
          timeoutMs: 6500,
          supportsVision: true,
        },
        {
          url: OVH_URL,
          model: 'gemma-4-26b-a4b',
          label: 'OVH Gemma 4 26B Vision',
          timeoutMs: 6500,
          supportsVision: true,
        },
      ]
    : modelMode === 'coder-pro'
      ? [
          { url: OVH_URL, model: 'gpt-oss-120b', label: 'OVH GPT-OSS 120B', timeoutMs: 5500 },
          { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'OVH Qwen3.6 35B Coder', timeoutMs: 5500 },
          { url: OVH_URL, model: 'Qwen3.5-397B-A17B', label: 'OVH Qwen3.5 397B', timeoutMs: 6500 },
          { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'OVH Mistral 3.2' },
          { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'OVH DeepSeek V4.1' },
          { url: OVH_URL, model: 'gpt-oss-20b', label: 'OVH GPT-OSS 20B' },
          { url: LLM7_URL, model: 'codestral-latest', label: 'LLM7 Codestral' },
          { url: LLM7_URL, model: 'glm-5.3-flash', label: 'LLM7 GLM-5.3' },
        ]
      : modelMode === 'deepseek-r1'
        ? [
            { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'OVH DeepSeek V4.1', timeoutMs: 5500 },
            { url: OVH_URL, model: 'Qwen3.5-397B-A17B', label: 'OVH Qwen3.5 397B', timeoutMs: 6500 },
            { url: OVH_URL, model: 'gpt-oss-120b', label: 'OVH GPT-OSS 120B', timeoutMs: 5500 },
            { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'OVH Qwen3.6 35B' },
            { url: LLM7_URL, model: 'DeepSeek-V4-Flash-0731', label: 'LLM7 DeepSeek V4' },
            { url: LLM7_URL, model: 'gemma4:31b', label: 'LLM7 Gemma 4' },
          ]
        : [
            { url: OVH_URL, model: 'gpt-oss-20b', label: 'OVH GPT-OSS 20B' },
            { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'OVH Qwen3.6 35B' },
            { url: OVH_URL, model: 'gpt-oss-120b', label: 'OVH GPT-OSS 120B', timeoutMs: 5500 },
            { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'OVH Mistral 3.2' },
            { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'OVH DeepSeek V4.1' },
            { url: LLM7_URL, model: 'fast', label: 'LLM7 Fast' },
            { url: LLM7_URL, model: 'glm-5.3-flash', label: 'LLM7 GLM-5.3' },
          ];

  for (const target of directTargets) {
    if (parentSignal.aborted) throw new Error('Aborted');
    let emitted = false;
    const payload =
      hasImages && !target.supportsVision ? toTextOnlyMessages(messages) : messages;
    try {
      const ok = await streamDirectOpenAISSE(
        target.url,
        target.model,
        target.label,
        payload,
        (tok, eng) => {
          emitted = true;
          onToken(tok, eng);
        },
        parentSignal,
        target.timeoutMs ?? 4500
      );
      if (ok) return target.label;
    } catch {
      if (parentSignal.aborted) throw new Error('Aborted');
      if (emitted) return target.label;
    }
  }

  return null;
}

async function tryClientPollinationsBackup(
  messages: ApiChatMessage[],
  onToken: (token: string, engine: string) => void,
  parentSignal: AbortSignal
): Promise<string | null> {
  const POLL_URL = 'https://text.pollinations.ai/openai';
  const textMessages = toTextOnlyMessages(messages);

  let emitted = false;
  try {
    const ok = await streamDirectOpenAISSE(
      POLL_URL,
      'openai-fast',
      'Pollinations Direct SSE',
      textMessages,
      (tok, eng) => {
        emitted = true;
        onToken(tok, eng);
      },
      parentSignal,
      4500
    );
    if (ok) return 'Pollinations Direct SSE';
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
    if (emitted) return 'Pollinations Direct SSE';
  }

  const compactMessages = [
    ...(textMessages[0]?.role === 'system'
      ? [{ role: 'system' as const, content: textMessages[0].content.slice(0, 1200) }]
      : []),
    ...textMessages.filter((m) => m.role !== 'system').slice(-6),
  ];

  const postGuard = createLinkedTimeoutSignal(parentSignal, 6000);
  try {
    const postRes = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: compactMessages,
        model: 'openai-fast',
        private: true,
      }),
      signal: postGuard.signal,
    });
    if (postRes.ok) {
      const fullText = await postRes.text();
      if (fullText.trim() && !fullText.includes('Free limit reached')) {
        onToken(fullText, 'Direct Pollinations POST');
        return 'Direct Pollinations POST';
      }
    }
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  } finally {
    postGuard.clear();
  }

  const getGuard = createLinkedTimeoutSignal(parentSignal, 6000);
  try {
    const lastUser = (
      [...textMessages].reverse().find((m) => m.role === 'user')?.content || 'Hello'
    ).slice(0, 900);
    const sys = (
      textMessages.find((m) => m.role === 'system')?.content || ''
    ).slice(0, 500);
    const textRes = await fetch(
      `https://text.pollinations.ai/${encodeURIComponent(lastUser)}?model=openai-fast&system=${encodeURIComponent(sys)}`,
      { signal: getGuard.signal }
    );
    if (textRes.ok) {
      const fullText = await textRes.text();
      if (fullText.trim() && !fullText.includes('Free limit reached')) {
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

function buildApiMessages(
  systemPrompt: string,
  history: HistoryTurnInput[]
): { apiMessages: ApiChatMessage[]; hasImages: boolean } {
  const recent = history.slice(-14);
  // Keep raw base64 image payloads only for the latest 2 turns that contain images
  const imageTurnIndices = recent
    .map((m, idx) => (m.images && m.images.length > 0 ? idx : -1))
    .filter((idx) => idx >= 0);
  const activeImageIndexSet = new Set(imageTurnIndices.slice(-2));
  const hasImages = activeImageIndexSet.size > 0;

  const formattedTurns: ApiChatMessage[] = recent.map((m, idx) => {
    if (m.images && m.images.length > 0 && activeImageIndexSet.has(idx)) {
      const parts: MultimodalPart[] = [
        {
          type: 'text',
          text:
            m.content.trim() ||
            'Please analyze this image and build an interactive web app matching what you see.',
        },
        ...m.images.map((img) => ({
          type: 'image_url' as const,
          image_url: { url: img.dataUrl },
        })),
      ];
      return { role: m.role, content: parts };
    }

    if (m.images && m.images.length > 0) {
      return {
        role: m.role,
        content: `[Earlier uploaded ${m.images.length} image(s)]\n${m.content}`,
      };
    }

    return { role: m.role, content: m.content };
  });

  return {
    apiMessages: [{ role: 'system', content: systemPrompt }, ...formattedTurns],
    hasImages,
  };
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

  const lastUserTurn = [...history].reverse().find((m) => m.role === 'user');
  const lastUserText = lastUserTurn?.content || '';
  const hasAnyRecentImage = history
    .slice(-6)
    .some((m) => Boolean(m.images && m.images.length > 0));

  let liveSources: LiveSource[] = [];
  let groundedSummary = '';

  if (
    lastUserText &&
    modelMode !== 'local-webgpu' &&
    shouldTriggerLiveSearch(
      lastUserText,
      modelMode,
      liveSearchEnabled,
      hasAnyRecentImage
    )
  ) {
    const searchRes = await fetchLiveSearchContext(lastUserText, signal);
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
    hasImages: hasAnyRecentImage,
  });

  const { apiMessages, hasImages } = buildApiMessages(systemPrompt, history);

  // Offline / In-Browser Local AI Mode (text-only; images automatically escalate to cloud vision)
  if (modelMode === 'local-webgpu' && !hasImages) {
    const textMessages = toTextOnlyMessages(apiMessages);
    await streamLocalBrowserAI(
      textMessages,
      (token) => onToken(token, 'Local Browser AI (Qwen2.5-Coder-1.5B)'),
      onLocalProgress,
      signal
    );
    return 'Local Browser AI (Qwen2.5-Coder-1.5B)';
  }

  const modeOption = MODEL_MODES.find((m) => m.id === modelMode) || MODEL_MODES[0];
  let engineUsed = `Cloud Router (${modeOption.shortLabel})`;

  // Tier 1 (5,000-user scale): Direct Browser-to-Cloud (CORS *, user's own IP!)
  const directEngine = await tryClientDirectCloud(
    modelMode,
    apiMessages,
    hasImages,
    (token, eng) => {
      engineUsed = eng;
      onToken(token, eng);
    },
    signal
  );

  if (directEngine) {
    return directEngine;
  }

  if (signal.aborted) {
    throw new Error('Aborted');
  }

  // Tier 2: Backend Multi-Provider Proxy (Kilo Free Gateways, HF Gemma 4 Spaces, Server OVH, Gemini)
  let gotAnyTokenFromBackend = false;
  const backendConnectGuard = createLinkedTimeoutSignal(signal, 18000);
  try {
    const res = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: modeOption.pollinationsModel,
        mode: modelMode,
        messages: apiMessages,
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
  } catch (err) {
    backendConnectGuard.clear();
    if (signal.aborted) throw err;
    if (gotAnyTokenFromBackend) {
      return engineUsed;
    }
  } finally {
    backendConnectGuard.clear();
  }

  // Tier 3: Pollinations Direct Backup
  const pollEngine = await tryClientPollinationsBackup(
    apiMessages,
    (token, eng) => {
      engineUsed = eng;
      onToken(token, eng);
    },
    signal
  );

  if (pollEngine) {
    return pollEngine;
  }

  throw new Error(
    'Unable to connect to cloud AI right now. Check your internet connection and tap Regenerate, or switch to Local WebGPU mode.'
  );
}
