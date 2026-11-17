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

interface IncomingMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LiveSourceItem {
  title: string;
  url: string;
  snippet: string;
  provider: 'DuckDuckGo' | 'Wikipedia' | 'Google Search' | 'SearchGPT';
}

async function fetchDuckDuckGo(query: string): Promise<LiveSourceItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
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
  const timer = setTimeout(() => controller.abort(), 5000);
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

async function streamPollinationsOpenAI(
  model: string,
  messages: IncomingMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal
): Promise<boolean> {
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Pollinations primary HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emittedAny = false;

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
        return emittedAny;
      }
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
            message?: { content?: string };
          }>;
        };
        const delta = json.choices?.[0]?.delta;
        const content = delta?.content ?? json.choices?.[0]?.message?.content ?? '';
        if (content) {
          emittedAny = true;
          onToken(content);
        }
      } catch {
        // Ignore partial JSON frames
      }
    }
  }

  return emittedAny;
}

async function fallbackPollinationsText(
  messages: IncomingMessage[],
  model: string,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch('https://text.pollinations.ai/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      model: model === 'deepseek-r1' ? 'deepseek-r1' : 'openai',
      private: true,
    }),
    signal,
  });
  if (res.ok) {
    const text = await res.text();
    if (text.trim()) return text;
  }

  // GET fallback with condensed prompt
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || 'Hello';
  const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
  const getUrl = `https://text.pollinations.ai/${encodeURIComponent(lastUser)}?system=${encodeURIComponent(systemMsg.slice(0, 1200))}`;
  const getRes = await fetch(getUrl, { signal });
  if (!getRes.ok) {
    throw new Error(`Pollinations GET fallback HTTP ${getRes.status}`);
  }
  return await getRes.text();
}

async function fallbackHuggingFacePublic(
  messages: IncomingMessage[],
  signal: AbortSignal
): Promise<string> {
  const prompt = messages
    .map((m) => `<|${m.role}|>\n${m.content}`)
    .join('\n')
    .concat('\n<|assistant|>\n');

  const res = await fetch(
    'https://api-inference.huggingface.co/models/Qwen/Qwen2.5-Coder-32B-Instruct',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 1024, return_full_text: false },
      }),
      signal,
    }
  );
  if (!res.ok) {
    throw new Error(`Hugging Face public fallback HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{ generated_text?: string }> | { generated_text?: string };
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text;
  }
  if (!Array.isArray(data) && data.generated_text) {
    return data.generated_text;
  }
  throw new Error('Empty Hugging Face response');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

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
    const { model = 'openai', messages } = req.body as {
      model?: string;
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
    req.on('close', () => controller.abort());

    const sendEvent = (data: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      // Tier 1: Primary Engine — Pollinations OpenAI-compatible streaming
      const primaryOk = await streamPollinationsOpenAI(
        model,
        messages,
        (token) => sendEvent({ token, engine: `Pollinations (${model})` }),
        controller.signal
      );

      if (primaryOk) {
        sendEvent({ done: true, engine: `Pollinations (${model})` });
        res.end();
        return;
      }
    } catch {
      // Continue immediately to Tier 2 failover
    }

    try {
      // Tier 2: Secondary Automatic Failover — Pollinations POST/GET text endpoint
      const text = await fallbackPollinationsText(messages, model, controller.signal);
      if (text) {
        sendEvent({ token: text, engine: 'Pollinations Text Failover' });
        sendEvent({ done: true, engine: 'Pollinations Text Failover' });
        res.end();
        return;
      }
    } catch {
      // Continue immediately to Tier 3 failover
    }

    try {
      // Tier 3: Hugging Face Free Public Inference Fallback
      const hfText = await fallbackHuggingFacePublic(messages, controller.signal);
      sendEvent({ token: hfText, engine: 'Hugging Face Public Failover' });
      sendEvent({ done: true, engine: 'Hugging Face Public Failover' });
      res.end();
      return;
    } catch (err) {
      // Tier 4: Gemini server-side fallback if configured (for grounding/resilience)
      const ai = getGeminiClient();
      if (ai) {
        try {
          const systemInstruction = messages.find((m) => m.role === 'system')?.content;
          const userTurns = messages
            .filter((m) => m.role !== 'system')
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

          const stream = await ai.models.generateContentStream({
            model: 'gemini-4-hydrogen',
            contents: userTurns,
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
          // Fall through to error
        }
      }

      sendEvent({
        error:
          err instanceof Error
            ? err.message
            : 'All keyless cloud inference endpoints are temporarily busy.',
      });
      res.end();
    }
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
