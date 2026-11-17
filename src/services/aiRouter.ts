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
import { streamLocalBrowserAI, type LocalModelKey } from './localAi';

export const MODEL_MODES: ModelModeOption[] = [
  {
    id: 'deepseek-r1',
    label: 'AI Craft Max',
    shortLabel: 'AI Craft Max',
    rankBadge: '9.5 · 397B Cloud',
    description:
      'Flagship reasoning & deep architecture (Qwen3.5 397B, DeepSeek V4.1, GPT-OSS 120B)',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'coder-pro',
    label: 'AI Craft Pro',
    shortLabel: 'AI Craft Pro',
    rankBadge: '9.2 · 120B Code',
    description:
      'Full-stack coding, live preview & vision-to-code (GPT-OSS 120B, Qwen3.6, NorthCode)',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'auto',
    label: 'AI Craft Studio',
    shortLabel: 'AI Craft Studio',
    rankBadge: '9.0 · 35B–120B',
    description:
      'Balanced creative UI/UX & smart auto-routing with live web & automatic failover',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'searchgpt',
    label: 'AI Craft Plus',
    shortLabel: 'AI Craft Plus',
    rankBadge: '8.8 · Live Web',
    description:
      'Real-time DuckDuckGo, Wikipedia & Google Search grounding with citations',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'keyless-unlimited',
    label: 'AI Craft Flash',
    shortLabel: 'AI Craft Flash',
    rankBadge: '8.5 · 20B Fast',
    description:
      'Sub-second instant replies via GPT-OSS 20B, Pollinations & LLM7 open web',
    pollinationsModel: 'openai-fast',
  },
  {
    id: 'local-webgpu',
    label: 'AI Craft Mini',
    shortLabel: 'AI Craft Mini',
    rankBadge: '2.3 GB · Local',
    description:
      'Zero-limit 100% browser-local Web Worker (0.7 GB – 2.3 GB WebGPU / WASM)',
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
  localModelKey?: LocalModelKey;
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
  // Flash prioritizes instant low-latency responses unless explicit real-time/current-event signal
  if (modelMode === 'keyless-unlimited') {
    return /\b(today|latest|news|weather|price|stock|current|who is the|what happened)\b/i.test(
      prompt
    );
  }
  if (CASUAL_OR_BUILD_ONLY.test(prompt)) return false;
  if (prompt.trim().endsWith('?')) return true;
  return /\b(what|who|why|how|when|where|which|explain|define|tell me about|how much|how many|search|lookup|find)\b/i.test(
    prompt
  );
}

async function fetchDirectKeylessWebSources(
  query: string,
  parentSignal: AbortSignal
): Promise<LiveSource[]> {
  const backupGuard = createLinkedTimeoutSignal(parentSignal, 2600);
  try {
    // Extract crisp topic slug for direct Wikipedia REST summary lookup
    const cleanedSlug = query
      .replace(/^(what is|who is|what are|explain|tell me about|define|search)\s+/i, '')
      .replace(/[?!.,]+$/g, '')
      .trim()
      .slice(0, 80);

    const [wikiSearchRes, wikiDirectRestRes, ddgRes] = await Promise.all([
      fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`,
        { signal: backupGuard.signal }
      ).catch(() => null),
      cleanedSlug
        ? fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanedSlug.replace(/\s+/g, '_'))}`,
            { signal: backupGuard.signal }
          ).catch(() => null)
        : Promise.resolve(null),
      fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { signal: backupGuard.signal }
      ).catch(() => null),
    ]);

    const sources: LiveSource[] = [];
    const seen = new Set<string>();
    const addUnique = (item: LiveSource) => {
      if (!item.url || seen.has(item.url)) return;
      seen.add(item.url);
      sources.push(item);
    };

    if (wikiDirectRestRes?.ok) {
      const restData = (await wikiDirectRestRes.json()) as {
        title?: string;
        extract?: string;
        type?: string;
        content_urls?: { desktop?: { page?: string } };
      };
      if (restData.extract && restData.type !== 'disambiguation') {
        addUnique({
          title: `${restData.title || cleanedSlug} — Wikipedia`,
          url:
            restData.content_urls?.desktop?.page ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent((restData.title || cleanedSlug).replace(/ /g, '_'))}`,
          snippet: restData.extract.slice(0, 520),
          provider: 'Wikipedia',
        });
      }
    }

    if (wikiSearchRes?.ok) {
      const wikiJson = (await wikiSearchRes.json()) as {
        query?: { search?: Array<{ title: string; snippet: string }> };
      };
      const hits = wikiJson.query?.search || [];
      // Fetch full REST summary for the top search hit if we don't already have one
      if (hits[0] && sources.length === 0) {
        try {
          const topSumRes = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hits[0].title.replace(/ /g, '_'))}`,
            { signal: backupGuard.signal }
          );
          if (topSumRes.ok) {
            const topSum = (await topSumRes.json()) as {
              title?: string;
              extract?: string;
              content_urls?: { desktop?: { page?: string } };
            };
            if (topSum.extract) {
              addUnique({
                title: `${topSum.title || hits[0].title} — Wikipedia`,
                url:
                  topSum.content_urls?.desktop?.page ||
                  `https://en.wikipedia.org/wiki/${encodeURIComponent(hits[0].title.replace(/ /g, '_'))}`,
                snippet: topSum.extract.slice(0, 520),
                provider: 'Wikipedia',
              });
            }
          }
        } catch {
          // fallback to search snippet below
        }
      }
      for (const hit of hits) {
        addUnique({
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
        Answer?: string;
        RelatedTopics?: Array<{
          Text?: string;
          FirstURL?: string;
        }>;
      };
      if (ddgJson.AbstractText && ddgJson.AbstractURL) {
        addUnique({
          title: ddgJson.Heading || query,
          url: ddgJson.AbstractURL,
          snippet: ddgJson.AbstractText,
          provider: 'DuckDuckGo',
        });
      } else if (ddgJson.Answer) {
        addUnique({
          title: `Instant Answer: ${query}`,
          url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          snippet: ddgJson.Answer,
          provider: 'DuckDuckGo',
        });
      }
      for (const topic of (ddgJson.RelatedTopics || []).slice(0, 3)) {
        if (topic.Text && topic.FirstURL) {
          addUnique({
            title: topic.Text.split(' - ')[0]?.slice(0, 80) || 'DuckDuckGo Result',
            url: topic.FirstURL,
            snippet: topic.Text,
            provider: 'DuckDuckGo',
          });
        }
      }
    }

    return sources.slice(0, 8);
  } catch {
    return [];
  } finally {
    backupGuard.clear();
  }
}

async function fetchLiveSearchContext(
  query: string,
  parentSignal: AbortSignal
): Promise<{ sources: LiveSource[]; groundedSummary: string }> {
  const searchGuard = createLinkedTimeoutSignal(parentSignal, 2500);
  try {
    const [backendRes, directSources] = await Promise.all([
      fetch('/api/search/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, useGoogleGrounding: true }),
        signal: searchGuard.signal,
      })
        .then((r) =>
          r.ok
            ? (r.json() as Promise<{ sources?: LiveSource[]; groundedSummary?: string }>)
            : null
        )
        .catch(() => null),
      fetchDirectKeylessWebSources(query, parentSignal),
    ]);

    const merged: LiveSource[] = [];
    const seen = new Set<string>();
    for (const s of [...(backendRes?.sources || []), ...directSources]) {
      if (s.url && !seen.has(s.url)) {
        seen.add(s.url);
        merged.push(s);
      }
    }

    return {
      sources: merged.slice(0, 8),
      groundedSummary: backendRes?.groundedSummary || '',
    };
  } catch {
    if (parentSignal.aborted) {
      searchGuard.clear();
      throw new Error('Aborted');
    }
    const direct = await fetchDirectKeylessWebSources(query, parentSignal);
    return { sources: direct, groundedSummary: '' };
  } finally {
    searchGuard.clear();
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

function getTierTuning(modelMode: ModelModeId): {
  maxTokens: number;
  temperature: number;
} {
  switch (modelMode) {
    case 'deepseek-r1':
      return { maxTokens: 4096, temperature: 0.35 };
    case 'coder-pro':
      return { maxTokens: 4096, temperature: 0.25 };
    case 'auto':
      return { maxTokens: 2800, temperature: 0.55 };
    case 'searchgpt':
      return { maxTokens: 2400, temperature: 0.3 };
    case 'keyless-unlimited':
      return { maxTokens: 1600, temperature: 0.45 };
    default:
      return { maxTokens: 1536, temperature: 0.4 };
  }
}

async function streamDirectOpenAISSE(
  endpointUrl: string,
  model: string,
  engineLabel: string,
  messages: ApiChatMessage[],
  onToken: (token: string, engine: string) => void,
  parentSignal: AbortSignal,
  connectTimeoutMs = 4500,
  tuning?: { maxTokens?: number; temperature?: number }
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
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(tuning?.maxTokens ? { max_tokens: tuning.maxTokens } : {}),
        ...(typeof tuning?.temperature === 'number'
          ? { temperature: tuning.temperature }
          : {}),
      }),
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
    : modelMode === 'deepseek-r1'
      ? [
          { url: OVH_URL, model: 'Qwen3.5-397B-A17B', label: 'AI Craft Max · Qwen3.5 397B', timeoutMs: 7000 },
          { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'AI Craft Max · DeepSeek V4.1', timeoutMs: 6000 },
          { url: OVH_URL, model: 'gpt-oss-120b', label: 'AI Craft Max · GPT-OSS 120B', timeoutMs: 6000 },
          { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'AI Craft Max · Qwen3.6 35B' },
          { url: LLM7_URL, model: 'DeepSeek-V4-Flash-0731', label: 'AI Craft Max · LLM7 DeepSeek' },
          { url: LLM7_URL, model: 'gemma4:31b', label: 'AI Craft Max · LLM7 Gemma 4' },
        ]
      : modelMode === 'coder-pro'
        ? [
            { url: OVH_URL, model: 'gpt-oss-120b', label: 'AI Craft Pro · GPT-OSS 120B', timeoutMs: 6000 },
            { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'AI Craft Pro · Qwen3.6 Coder', timeoutMs: 5500 },
            { url: OVH_URL, model: 'Qwen3.5-397B-A17B', label: 'AI Craft Pro · Qwen3.5 397B', timeoutMs: 6500 },
            { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'AI Craft Pro · Mistral 3.2' },
            { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'AI Craft Pro · DeepSeek V4.1' },
            { url: LLM7_URL, model: 'codestral-latest', label: 'AI Craft Pro · LLM7 Codestral' },
            { url: LLM7_URL, model: 'glm-5.3-flash', label: 'AI Craft Pro · LLM7 GLM-5.3' },
          ]
        : modelMode === 'keyless-unlimited'
          ? [
              { url: OVH_URL, model: 'gpt-oss-20b', label: 'AI Craft Flash · GPT-OSS 20B', timeoutMs: 3200 },
              { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'AI Craft Flash · Mistral 3.2', timeoutMs: 3500 },
              { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'AI Craft Flash · Qwen3.6 35B', timeoutMs: 3800 },
              { url: LLM7_URL, model: 'fast', label: 'AI Craft Flash · LLM7 Fast', timeoutMs: 3500 },
              { url: LLM7_URL, model: 'glm-5.3-flash', label: 'AI Craft Flash · LLM7 GLM-5.3', timeoutMs: 3500 },
            ]
          : modelMode === 'searchgpt'
            ? [
                { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'AI Craft Plus · Qwen3.6 35B' },
                { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'AI Craft Plus · Mistral 3.2' },
                { url: OVH_URL, model: 'gpt-oss-120b', label: 'AI Craft Plus · GPT-OSS 120B', timeoutMs: 5500 },
                { url: OVH_URL, model: 'gpt-oss-20b', label: 'AI Craft Plus · GPT-OSS 20B' },
                { url: LLM7_URL, model: 'fast', label: 'AI Craft Plus · LLM7 Fast' },
              ]
            : [
                { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'AI Craft Studio · Qwen3.6 35B' },
                { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'AI Craft Studio · Mistral 3.2' },
                { url: OVH_URL, model: 'gpt-oss-120b', label: 'AI Craft Studio · GPT-OSS 120B', timeoutMs: 5500 },
                { url: OVH_URL, model: 'gpt-oss-20b', label: 'AI Craft Studio · GPT-OSS 20B' },
                { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'AI Craft Studio · DeepSeek V4.1' },
                { url: LLM7_URL, model: 'fast', label: 'AI Craft Studio · LLM7 Fast' },
                { url: LLM7_URL, model: 'glm-5.3-flash', label: 'AI Craft Studio · LLM7 GLM-5.3' },
              ];

  const tuning = getTierTuning(modelMode);

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
        target.timeoutMs ?? 4500,
        tuning
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
  const GEN_OPENAI_URL = 'https://gen.pollinations.ai/v1/chat/completions';
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
      4000
    );
    if (ok) return 'Pollinations Direct SSE';
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
    if (emitted) return 'Pollinations Direct SSE';
  }

  // Try gen.pollinations.ai OpenAI endpoint cleanly (immediately skips on 401/429)
  const genGuard = createLinkedTimeoutSignal(parentSignal, 4000);
  try {
    const genRes = await fetch(GEN_OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai-fast',
        messages: textMessages,
        stream: false,
      }),
      signal: genGuard.signal,
    });
    if (genRes.ok) {
      const genData = (await genRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = genData.choices?.[0]?.message?.content?.trim();
      if (text) {
        onToken(text, 'Gen Pollinations OpenAI');
        return 'Gen Pollinations OpenAI';
      }
    }
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  } finally {
    genGuard.clear();
  }

  const compactMessages = [
    ...(textMessages[0]?.role === 'system'
      ? [{ role: 'system' as const, content: textMessages[0].content.slice(0, 1200) }]
      : []),
    ...textMessages.filter((m) => m.role !== 'system').slice(-6),
  ];

  const postGuard = createLinkedTimeoutSignal(parentSignal, 5500);
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

  const lastUser = (
    [...textMessages].reverse().find((m) => m.role === 'user')?.content || 'Hello'
  ).slice(0, 900);
  const sys = (
    textMessages.find((m) => m.role === 'system')?.content || ''
  ).slice(0, 500);

  // gen.pollinations.ai/text GET backup
  const genTextGuard = createLinkedTimeoutSignal(parentSignal, 5500);
  try {
    const genTextRes = await fetch(
      `https://gen.pollinations.ai/text/${encodeURIComponent(lastUser)}?system=${encodeURIComponent(sys)}`,
      { signal: genTextGuard.signal }
    );
    if (genTextRes.ok) {
      const fullText = await genTextRes.text();
      if (
        fullText.trim() &&
        !fullText.startsWith('{"success":false') &&
        !fullText.includes('Free limit reached')
      ) {
        onToken(fullText, 'Gen Pollinations Text');
        return 'Gen Pollinations Text';
      }
    }
  } catch {
    if (parentSignal.aborted) throw new Error('Aborted');
  } finally {
    genTextGuard.clear();
  }

  // text.pollinations.ai GET backup
  const getGuard = createLinkedTimeoutSignal(parentSignal, 5500);
  try {
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
    localModelKey = 'qwen-coder',
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
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

  let liveSources: LiveSource[] = [];
  let groundedSummary = '';

  if (
    isOnline &&
    lastUserText &&
    shouldTriggerLiveSearch(
      lastUserText,
      modelMode,
      liveSearchEnabled,
      hasAnyRecentImage
    )
  ) {
    if (modelMode === 'local-webgpu') {
      // Strictly zero external AI backend calls in 100% Browser Local mode; direct public DuckDuckGo + Wikipedia REST lookup only
      liveSources = await fetchDirectKeylessWebSources(lastUserText, signal);
    } else {
      const searchRes = await fetchLiveSearchContext(lastUserText, signal);
      liveSources = searchRes.sources;
      groundedSummary = searchRes.groundedSummary;
    }
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

  // 100% Browser Local Mode (WebLLM WebGPU -> Transformers.js WASM Web Worker; zero external AI calls)
  if (modelMode === 'local-webgpu' && !hasImages) {
    const textMessages = toTextOnlyMessages(apiMessages);
    const localEngine = await streamLocalBrowserAI(
      textMessages,
      (token, engineLabel) =>
        onToken(token, engineLabel || 'Browser Local AI (Zero-Limit)'),
      onLocalProgress,
      signal,
      localModelKey
    );
    return localEngine;
  }

  const modeOption = MODEL_MODES.find((m) => m.id === modelMode) || MODEL_MODES[0];
  let engineUsed = `Cloud Router (${modeOption.shortLabel})`;

  if (isOnline) {
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

    // In Keyless Unlimited Engine mode, also race direct Pollinations & gen.pollinations open web endpoints before server proxy
    if (modelMode === 'keyless-unlimited' && !hasImages) {
      const directWebBackup = await tryClientPollinationsBackup(
        apiMessages,
        (token, eng) => {
          engineUsed = eng;
          onToken(token, eng);
        },
        signal
      );
      if (directWebBackup) {
        return directWebBackup;
      }
    }

    // Tier 2: Backend Multi-Provider Proxy (Kilo Free Gateways, HF Gemma 4 Spaces, Server OVH, Gemini)
    const tierTuning = getTierTuning(modelMode);
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
          maxTokens: tierTuning.maxTokens,
          temperature: tierTuning.temperature,
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

    // Tier 3: Pollinations Direct Backup (if not already tried above)
    if (modelMode !== 'keyless-unlimited' || hasImages) {
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
    }
  }

  // Tier 4: Automatic Zero-Failure Failover to Browser Local AI (WebLLM / Transformers.js WASM)
  if (!signal.aborted && !hasImages) {
    try {
      const textMessages = toTextOnlyMessages(apiMessages);
      const localFallbackEngine = await streamLocalBrowserAI(
        textMessages,
        (token, engineLabel) =>
          onToken(token, `${engineLabel || 'Browser Local AI'} (Auto Failover)`),
        onLocalProgress,
        signal,
        localModelKey
      );
      return `${localFallbackEngine} (Auto Failover)`;
    } catch (localErr) {
      if (signal.aborted) throw localErr;
    }
  }

  throw new Error(
    'Unable to connect to cloud AI right now. Check your internet connection and tap Regenerate, or switch to Browser Local mode.'
  );
}
