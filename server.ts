import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface MultimodalTextPart {
  type: 'text';
  text: string;
}

interface MultimodalImagePart {
  type: 'image_url';
  image_url: { url: string };
}

type MessageContent = string | Array<MultimodalTextPart | MultimodalImagePart>;

interface IncomingMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
}

function extractTextFromContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image_url') return '[Attached image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function hasImageAttachment(messages: IncomingMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === 'image_url' && Boolean(part.image_url?.url))
  );
}

function toTextOnlyMessages(messages: IncomingMessage[]): Array<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}> {
  return messages.map((m) => ({
    role: m.role,
    content: extractTextFromContent(m.content),
  }));
}

interface LiveSourceItem {
  title: string;
  url: string;
  snippet: string;
  provider: 'DuckDuckGo' | 'Wikipedia' | 'Google Search' | 'SearchGPT';
}

async function fetchDuckDuckGo(query: string): Promise<LiveSourceItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      Answer?: string;
      RelatedTopics?: Array<{
        Text?: string;
        FirstURL?: string;
        Topics?: Array<{ Text?: string; FirstURL?: string }>;
      }>;
    };

    const items: LiveSourceItem[] = [];
    if (data.AbstractText && data.AbstractURL) {
      items.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
        provider: 'DuckDuckGo',
      });
    } else if (data.Answer) {
      items.push({
        title: `Instant Answer: ${query}`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: data.Answer,
        provider: 'DuckDuckGo',
      });
    }

    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (items.length >= 4) break;
        if (topic.Text && topic.FirstURL) {
          items.push({
            title: topic.Text.split(' - ')[0]?.slice(0, 80) || 'DuckDuckGo Result',
            url: topic.FirstURL,
            snippet: topic.Text,
            provider: 'DuckDuckGo',
          });
        } else if (Array.isArray(topic.Topics)) {
          for (const sub of topic.Topics) {
            if (items.length >= 4) break;
            if (sub.Text && sub.FirstURL) {
              items.push({
                title: sub.Text.split(' - ')[0]?.slice(0, 80) || 'DuckDuckGo Result',
                url: sub.FirstURL,
                snippet: sub.Text,
                provider: 'DuckDuckGo',
              });
            }
          }
        }
      }
    }
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWikipedia(query: string): Promise<LiveSourceItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VektorStudio/1.0' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        search?: Array<{ title: string; snippet: string; pageid: number }>;
      };
    };

    const hits = data.query?.search || [];
    const items: LiveSourceItem[] = [];

    for (const hit of hits.slice(0, 3)) {
      const cleanSnippet = hit.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`;
      items.push({
        title: `${hit.title} — Wikipedia`,
        url: wikiUrl,
        snippet: cleanSnippet,
        provider: 'Wikipedia',
      });
    }

    // Fetch rich REST summary for the top hit if available
    if (hits[0]) {
      try {
        const sumRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hits[0].title.replace(/ /g, '_'))}`,
          { signal: controller.signal, headers: { 'User-Agent': 'VektorStudio/1.0' } }
        );
        if (sumRes.ok) {
          const sumData = (await sumRes.json()) as { extract?: string; content_urls?: { desktop?: { page?: string } } };
          if (sumData.extract && items[0]) {
            items[0].snippet = sumData.extract.slice(0, 480);
            if (sumData.content_urls?.desktop?.page) {
              items[0].url = sumData.content_urls.desktop.page;
            }
          }
        }
      } catch {
        // Keep search snippet
      }
    }

    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGeminiSearchGrounding(
  query: string
): Promise<{ summary: string; sources: LiveSourceItem[] } | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const sources: LiveSourceItem[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) {
        const web = (chunk as { web?: { uri?: string; title?: string } }).web;
        if (web?.uri) {
          sources.push({
            title: web.title || web.uri,
            url: web.uri,
            snippet: 'Verified Google Search grounding source',
            provider: 'Google Search',
          });
        }
      }
    }

    return {
      summary: response.text || '',
      sources,
    };
  } catch {
    return null;
  }
}

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

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
    },
  };
}

function normalizePollinationsModel(requestedModel: string): string {
  // Only openai / openai-fast / gpt-oss-20b remain active on Classic Pollinations without 404
  const valid = new Set(['openai', 'openai-fast', 'gpt-oss', 'gpt-oss-20b']);
  return valid.has(requestedModel) ? requestedModel : 'openai-fast';
}

async function streamOpenAICompatible(
  endpointUrl: string,
  model: string,
  messages: IncomingMessage[],
  onToken: (token: string) => void,
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
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
      signal: timeoutGuard.signal,
    });
  } catch (err) {
    timeoutGuard.clear();
    throw err;
  }

  if (!res.ok || !res.body) {
    timeoutGuard.clear();
    throw new Error(`Upstream ${endpointUrl} HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emittedAny = false;
  let openedReasoningTag = false;
  let sawContentAfterReasoning = false;

  const emitChunk = (text: string) => {
    if (!text) return;
    if (!emittedAny) {
      timeoutGuard.clear();
      emittedAny = true;
    }
    onToken(text);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          if (openedReasoningTag && !sawContentAfterReasoning) {
            emitChunk('</think>\n');
          }
          return emittedAny;
        }
        try {
          const json = JSON.parse(payload) as {
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
          const delta = json.choices?.[0]?.delta;
          const msg = json.choices?.[0]?.message;
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
                emitChunk('<think>\n');
              }
            }
            emitChunk(reasoning);
          }

          if (content) {
            if (openedReasoningTag && !sawContentAfterReasoning) {
              sawContentAfterReasoning = true;
              if (!content.trimStart().startsWith('</think>')) {
                emitChunk('\n</think>\n\n');
              }
            }
            emitChunk(content);
          }
        } catch {
          // Ignore partial JSON frames
        }
      }
    }
  } finally {
    timeoutGuard.clear();
  }

  if (openedReasoningTag && !sawContentAfterReasoning) {
    emitChunk('</think>\n');
  }
  return emittedAny;
}

async function streamHuggingFaceGemma4Space(
  spaceHost: string,
  messages: IncomingMessage[],
  enableThinking: boolean,
  onToken: (token: string) => void,
  parentSignal: AbortSignal,
  connectTimeoutMs = 5500
): Promise<boolean> {
  const timeoutGuard = createLinkedTimeoutSignal(parentSignal, connectTimeoutMs);

  const textMessages = toTextOnlyMessages(messages);
  const systemPrompt = textMessages.find((m) => m.role === 'system')?.content || '';
  const nonSystem = textMessages.filter((m) => m.role !== 'system');
  const lastUser = [...nonSystem].reverse().find((m) => m.role === 'user')?.content || 'Hello';
  const priorTurns = nonSystem.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const postRes = await fetch(`${spaceHost}/gradio_api/call/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [
          lastUser,
          null,
          priorTurns,
          enableThinking,
          2048,
          280,
          systemPrompt,
          0.7,
          0.95,
          64,
          1,
        ],
      }),
      signal: timeoutGuard.signal,
    });
    if (!postRes.ok) {
      timeoutGuard.clear();
      throw new Error(`HF Space POST HTTP ${postRes.status}`);
    }
    const { event_id } = (await postRes.json()) as { event_id?: string };
    if (!event_id) {
      timeoutGuard.clear();
      throw new Error('Missing HF Space event_id');
    }

    const sseRes = await fetch(`${spaceHost}/gradio_api/call/chat/${event_id}`, {
      signal: timeoutGuard.signal,
    });
    if (!sseRes.ok || !sseRes.body) {
      timeoutGuard.clear();
      throw new Error(`HF Space SSE HTTP ${sseRes.status}`);
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let prevReasoningLen = 0;
    let prevContentLen = 0;
    let openedReasoning = false;
    let closedReasoning = false;
    let emittedAny = false;

    const emit = (txt: string) => {
      if (!txt) return;
      if (!emittedAny) {
        timeoutGuard.clear();
        emittedAny = true;
      }
      onToken(txt);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trim();
        if (line.startsWith('event: error')) {
          throw new Error('HF Space returned event: error');
        }
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === 'null') continue;
        try {
          const arr = JSON.parse(jsonStr) as Array<{
            reasoning?: string;
            content?: string;
          }>;
          const item = Array.isArray(arr) ? arr[0] : null;
          if (!item) continue;
          const rText = item.reasoning || '';
          const cText = item.content || '';

          if (rText.length > prevReasoningLen && !closedReasoning) {
            if (!openedReasoning) {
              openedReasoning = true;
              if (!rText.trimStart().startsWith('<think>')) {
                emit('<think>\n');
              }
            }
            emit(rText.slice(prevReasoningLen));
            prevReasoningLen = rText.length;
          }

          if (cText.length > prevContentLen) {
            if (openedReasoning && !closedReasoning) {
              closedReasoning = true;
              if (!cText.trimStart().startsWith('</think>')) {
                emit('\n</think>\n\n');
              }
            }
            emit(cText.slice(prevContentLen));
            prevContentLen = cText.length;
          }
        } catch {
          // ignore partial frames
        }
      }
    }

    if (openedReasoning && !closedReasoning) {
      emit('</think>\n');
    }
    return emittedAny;
  } finally {
    timeoutGuard.clear();
  }
}

async function fallbackPollinationsText(
  messages: IncomingMessage[],
  parentSignal: AbortSignal
): Promise<string> {
  const textMessages = toTextOnlyMessages(messages);
  const compactMessages = [
    ...(textMessages[0]?.role === 'system'
      ? [{ role: 'system' as const, content: textMessages[0].content.slice(0, 1200) }]
      : []),
    ...textMessages.filter((m) => m.role !== 'system').slice(-6),
  ];

  const postGuard = createLinkedTimeoutSignal(parentSignal, 5500);
  try {
    const res = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: compactMessages,
        model: 'openai-fast',
        private: true,
      }),
      signal: postGuard.signal,
    });
    if (res.ok) {
      const text = await res.text();
      if (text.trim() && !text.includes('Free limit reached')) return text;
    }
  } finally {
    postGuard.clear();
  }

  const getGuard = createLinkedTimeoutSignal(parentSignal, 5500);
  try {
    const lastUser = (
      [...textMessages].reverse().find((m) => m.role === 'user')?.content || 'Hello'
    ).slice(0, 900);
    const systemMsg = (
      textMessages.find((m) => m.role === 'system')?.content || ''
    ).slice(0, 500);
    const getUrl = `https://text.pollinations.ai/${encodeURIComponent(lastUser)}?model=openai-fast&system=${encodeURIComponent(systemMsg)}`;
    const getRes = await fetch(getUrl, { signal: getGuard.signal });
    if (!getRes.ok) {
      throw new Error(`Pollinations GET fallback HTTP ${getRes.status}`);
    }
    const text = await getRes.text();
    if (!text.trim() || text.includes('Free limit reached')) {
      throw new Error('Pollinations rate-limited');
    }
    return text;
  } finally {
    getGuard.clear();
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Public runtime Maps config (never exposes Gemini key; only Maps browser key if configured)
  app.get('/api/maps/client-config', (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    res.json({ apiKey });
  });

  // Keyless Live Web Search Pipeline (+ optional Gemini 4 Hydrogen Search Grounding)
  app.post('/api/search/live', async (req, res) => {
    try {
      const { query, useGoogleGrounding } = req.body as {
        query?: string;
        useGoogleGrounding?: boolean;
      };
      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Missing query' });
        return;
      }

      const [ddgResults, wikiResults, geminiResult] = await Promise.all([
        fetchDuckDuckGo(query),
        fetchWikipedia(query),
        useGoogleGrounding !== false ? fetchGeminiSearchGrounding(query) : Promise.resolve(null),
      ]);

      const combined: LiveSourceItem[] = [];
      const seenUrls = new Set<string>();

      const pushUnique = (item: LiveSourceItem) => {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          combined.push(item);
        }
      };

      if (geminiResult?.sources) {
        geminiResult.sources.forEach(pushUnique);
      }
      wikiResults.forEach(pushUnique);
      ddgResults.forEach(pushUnique);

      res.json({
        sources: combined.slice(0, 8),
        groundedSummary: geminiResult?.summary || '',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Live search error',
        sources: [],
      });
    }
  });

  // Google Maps Grounding via gemini-4-hydrogen
  app.post('/api/maps/grounding', async (req, res) => {
    try {
      const { query, lat, lng } = req.body as {
        query?: string;
        lat?: number;
        lng?: number;
      };
      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Missing query' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.json({
          text: '',
          links: [],
          unavailableReason: 'Server search grounding unavailable; using interactive Google Maps Places search.',
        });
        return;
      }

      const config: {
        tools: Array<{ googleMaps: Record<string, never> }>;
        toolConfig?: { retrievalConfig: { latLng: { latitude: number; longitude: number } } };
      } = {
        tools: [{ googleMaps: {} }],
      };

      if (typeof lat === 'number' && typeof lng === 'number') {
        config.toolConfig = {
          retrievalConfig: {
            latLng: { latitude: lat, longitude: lng },
          },
        };
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: query,
        config,
      });

      const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const links: Array<{ title: string; uri: string; reviewSnippets?: string[] }> = [];

      if (Array.isArray(rawChunks)) {
        for (const chunk of rawChunks) {
          const mapsData = (
            chunk as {
              maps?: {
                uri?: string;
                title?: string;
                placeAnswerSources?: {
                  reviewSnippets?: Array<{ content?: string }>;
                };
              };
            }
          ).maps;

          if (mapsData?.uri) {
            const snippets =
              mapsData.placeAnswerSources?.reviewSnippets
                ?.map((s) => s.content || '')
                .filter(Boolean) || [];
            links.push({
              title: mapsData.title || 'Google Maps Place',
              uri: mapsData.uri,
              reviewSnippets: snippets,
            });
          }
        }
      }

      res.json({
        text: response.text || '',
        links,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Maps grounding failed',
        text: '',
        links: [],
      });
    }
  });

  // Resilient Multi-Tier Keyless AI Streaming Router
  app.post('/api/ai/stream', async (req, res) => {
    const {
      model = 'openai-fast',
      mode = 'auto',
      messages,
    } = req.body as {
      model?: string;
      mode?: string;
      messages?: IncomingMessage[];
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    const sendEvent = (data: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    interface ProviderTarget {
      url: string;
      model: string;
      label: string;
      timeoutMs?: number;
      supportsVision?: boolean;
    }

    const OVH_URL = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions';
    const KILO_URL = 'https://api.kilo.ai/api/gateway/chat/completions';
    const LLM7_URL = 'https://api.llm7.io/v1/chat/completions';
    const POLL_URL = 'https://text.pollinations.ai/openai';

    const withImages = hasImageAttachment(messages);

    const providerChain: ProviderTarget[] = withImages
      ? [
          { url: KILO_URL, model: 'nvidia/nemotron-3.5-super-vl:free', label: 'Kilo Nemotron VL Vision', timeoutMs: 8000, supportsVision: true },
          { url: OVH_URL, model: 'Qwen2.5-VL-72B-Instruct', label: 'OVH Qwen2.5-VL 72B', timeoutMs: 7000, supportsVision: true },
          { url: OVH_URL, model: 'qwen3-vl-30b-a3b', label: 'OVH Qwen3-VL 30B', timeoutMs: 7000, supportsVision: true },
          { url: KILO_URL, model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Kilo Nemotron Omni Vision', timeoutMs: 8000, supportsVision: true },
          { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'OVH Mistral 3.2 Vision', timeoutMs: 7000, supportsVision: true },
          { url: OVH_URL, model: 'gemma-4-26b-a4b', label: 'OVH Gemma 4 26B Vision', timeoutMs: 7000, supportsVision: true },
          { url: KILO_URL, model: 'openrouter/free', label: 'Kilo OpenRouter Free Vision', timeoutMs: 8000, supportsVision: true },
        ]
      : mode === 'coder-pro'
        ? [
            { url: KILO_URL, model: 'kilo-auto/free', label: 'Kilo Auto Free' },
            { url: OVH_URL, model: 'gpt-oss-120b', label: 'OVH GPT-OSS 120B' },
            { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'OVH Qwen3.6 35B Coder' },
            { url: KILO_URL, model: 'cohere/north-mini-code:free', label: 'Kilo NorthCode' },
            { url: OVH_URL, model: 'Qwen3.5-397B-A17B', label: 'OVH Qwen3.5 397B' },
            { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'OVH Mistral 3.2' },
            { url: KILO_URL, model: 'nvidia/nemotron-3.5-lightning:free', label: 'Kilo Nemotron Lightning' },
            { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'OVH DeepSeek V4.1' },
            { url: LLM7_URL, model: 'codestral-latest', label: 'LLM7 Codestral' },
            { url: LLM7_URL, model: 'fast', label: 'LLM7 Cloud (fast)' },
          ]
        : mode === 'deepseek-r1'
          ? [
              { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'OVH DeepSeek V4.1' },
              { url: KILO_URL, model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Kilo Nemotron Reasoning' },
              { url: OVH_URL, model: 'Qwen3.5-397B-A17B', label: 'OVH Qwen3.5 397B' },
              { url: OVH_URL, model: 'gpt-oss-120b', label: 'OVH GPT-OSS 120B' },
              { url: KILO_URL, model: 'nvidia/nemotron-3.5-lightning:free', label: 'Kilo Nemotron Lightning' },
              { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'OVH Qwen3.6 35B' },
              { url: LLM7_URL, model: 'DeepSeek-V4-Flash-0731', label: 'LLM7 DeepSeek V4' },
              { url: LLM7_URL, model: 'fast', label: 'LLM7 Cloud (fast)' },
            ]
          : [
              { url: KILO_URL, model: 'kilo-auto/free', label: 'Kilo Auto Free' },
              { url: OVH_URL, model: 'gpt-oss-20b', label: 'OVH GPT-OSS 20B' },
              { url: OVH_URL, model: 'qwen3.6-35b-a3b', label: 'OVH Qwen3.6 35B' },
              { url: KILO_URL, model: 'nvidia/nemotron-3.5-lightning:free', label: 'Kilo Nemotron Lightning' },
              { url: OVH_URL, model: 'gpt-oss-120b', label: 'OVH GPT-OSS 120B' },
              { url: OVH_URL, model: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'OVH Mistral 3.2' },
              { url: KILO_URL, model: 'cohere/north-mini-code:free', label: 'Kilo NorthCode' },
              { url: OVH_URL, model: 'DeepSeek-V4.1-Flash-1017', label: 'OVH DeepSeek V4.1' },
              { url: LLM7_URL, model: 'fast', label: 'LLM7 Cloud (fast)' },
              { url: LLM7_URL, model: 'glm-5.3-flash', label: 'LLM7 GLM-5.3 Flash' },
            ];

    if (!withImages) {
      // Add Pollinations Classic only near the end (since it enforces a 45s per-IP cooldown)
      providerChain.push({
        url: POLL_URL,
        model: normalizePollinationsModel(model),
        label: `Pollinations (${normalizePollinationsModel(model)})`,
        timeoutMs: 4500,
      });
    }

    for (const target of providerChain) {
      if (controller.signal.aborted) {
        res.end();
        return;
      }
      let emittedFromTarget = false;
      const targetMessages =
        withImages && !target.supportsVision ? toTextOnlyMessages(messages) : messages;
      try {
        const ok = await streamOpenAICompatible(
          target.url,
          target.model,
          targetMessages,
          (token) => {
            emittedFromTarget = true;
            sendEvent({ token, engine: target.label });
          },
          controller.signal,
          target.timeoutMs ?? 5000
        );
        if (ok) {
          sendEvent({ done: true, engine: target.label });
          res.end();
          return;
        }
      } catch {
        if (controller.signal.aborted || emittedFromTarget) {
          if (emittedFromTarget) sendEvent({ done: true, engine: target.label });
          res.end();
          return;
        }
      }
    }

    // Hugging Face Official Gemma 4 Space Fallback (12B -> 31B)
    for (const space of [
      {
        host: 'https://huggingface-projects-gemma-4-12b-it.hf.space',
        label: 'HuggingFace Gemma 4 12B',
      },
      {
        host: 'https://huggingface-projects-gemma-4-31b-it.hf.space',
        label: 'HuggingFace Gemma 4 31B',
      },
    ]) {
      if (controller.signal.aborted) {
        res.end();
        return;
      }
      let emittedFromSpace = false;
      try {
        const ok = await streamHuggingFaceGemma4Space(
          space.host,
          messages,
          mode === 'deepseek-r1',
          (token) => {
            emittedFromSpace = true;
            sendEvent({ token, engine: space.label });
          },
          controller.signal,
          5500
        );
        if (ok) {
          sendEvent({ done: true, engine: space.label });
          res.end();
          return;
        }
      } catch {
        if (controller.signal.aborted || emittedFromSpace) {
          if (emittedFromSpace) sendEvent({ done: true, engine: space.label });
          res.end();
          return;
        }
      }
    }

    // Pollinations POST / GET compact fallback
    try {
      const text = await fallbackPollinationsText(messages, controller.signal);
      if (text) {
        sendEvent({ token: text, engine: 'Pollinations Text Failover' });
        sendEvent({ done: true, engine: 'Pollinations Text Failover' });
        res.end();
        return;
      }
    } catch {
      if (controller.signal.aborted) {
        res.end();
        return;
      }
    }

    // Gemini server-side fallback if configured (supports multimodal inlineData!)
    const ai = getGeminiClient();
    if (ai) {
      try {
        const rawSystem = messages.find((m) => m.role === 'system')?.content;
        const systemInstruction = rawSystem ? extractTextFromContent(rawSystem) : undefined;
        const geminiParts: Array<
          { text: string } | { inlineData: { mimeType: string; data: string } }
        > = [];

        for (const msg of messages.filter((m) => m.role !== 'system')) {
          const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
          if (typeof msg.content === 'string') {
            geminiParts.push({ text: `${prefix}${msg.content}` });
          } else if (Array.isArray(msg.content)) {
            geminiParts.push({ text: prefix });
            for (const part of msg.content) {
              if (part.type === 'text') {
                geminiParts.push({ text: part.text });
              } else if (part.type === 'image_url' && part.image_url?.url) {
                const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  geminiParts.push({
                    inlineData: { mimeType: match[1], data: match[2] },
                  });
                }
              }
            }
          }
        }

        const stream = await ai.models.generateContentStream({
          model: 'gemini-4-hydrogen',
          contents: geminiParts,
          config: systemInstruction ? { systemInstruction } : undefined,
        });
        for await (const chunk of stream) {
          if (chunk.text) {
            sendEvent({ token: chunk.text, engine: 'Gemini 4 Hydrogen' });
          }
        }
        sendEvent({ done: true, engine: 'Gemini 4 Hydrogen' });
        res.end();
        return;
      } catch {
        // Fall through to final error
      }
    }

    sendEvent({
      error: 'All keyless cloud inference endpoints are temporarily busy.',
    });
    res.end();
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vektor Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
