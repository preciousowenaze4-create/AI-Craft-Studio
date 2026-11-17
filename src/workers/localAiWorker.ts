export type LocalModelKey = 'qwen-coder' | 'llama-3.2' | 'phi-3.5';

interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface WorkerStartPayload {
  type: 'generate';
  requestId: string;
  modelKey: LocalModelKey;
  messages: ChatMessageInput[];
}

interface WorkerPreloadPayload {
  type: 'preload';
  modelKey: LocalModelKey;
}

interface WorkerAbortPayload {
  type: 'abort';
  requestId: string;
}

type WorkerInMessage =
  | WorkerStartPayload
  | WorkerPreloadPayload
  | WorkerAbortPayload;

const WEBLLM_MODEL_MAP: Record<LocalModelKey, string> = {
  'qwen-coder': 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
  'llama-3.2': 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'phi-3.5': 'Phi-3.5-mini-instruct-q4f16_1-MLC',
};

const WEBLLM_F32_FALLBACK: Record<LocalModelKey, string> = {
  'qwen-coder': 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC',
  'llama-3.2': 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
  'phi-3.5': 'Phi-3.5-mini-instruct-q4f32_1-MLC',
};

const TRANSFORMERS_MODEL_MAP: Record<LocalModelKey, string> = {
  'qwen-coder': 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
  'llama-3.2': 'onnx-community/Llama-3.2-1B-Instruct',
  'phi-3.5': 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
};

// Cached engine instances across chat turns inside worker
let activeBackend: 'webllm' | 'transformers' | null = null;
let loadedModelKey: LocalModelKey | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let webllmEngine: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tfPipeline: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tfInterrupt: any = null;
let loadPromise: Promise<'webllm' | 'transformers'> | null = null;
const abortedRequests = new Set<string>();

function postProgress(progress: number, text: string, status: 'loading' | 'ready' | 'error' = 'loading') {
  self.postMessage({
    type: 'progress',
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    text,
    status,
  });
}

async function hasWorkingWebGPU(): Promise<boolean> {
  try {
    const nav = self.navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<{ features?: Set<string> } | null> };
    };
    if (!nav?.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function loadWebLLM(modelKey: LocalModelKey): Promise<boolean> {
  if (!(await hasWorkingWebGPU())) {
    return false;
  }

  postProgress(5, 'Initializing WebLLM WebGPU runtime...');
  try {
    // Load @mlc-ai/web-llm cleanly from ESM CDN as requested
    const webllmUrl = 'https://esm.run/@mlc-ai/web-llm';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webllm: any = await import(/* @vite-ignore */ webllmUrl);

    const appConfig = webllm.prebuiltAppConfig
      ? { ...webllm.prebuiltAppConfig, useIndexedDBCache: true }
      : undefined;

    const preferredModelId = WEBLLM_MODEL_MAP[modelKey];
    const fallbackF32Id = WEBLLM_F32_FALLBACK[modelKey];

    const initWithId = async (modelId: string) => {
      return webllm.CreateMLCEngine(modelId, {
        ...(appConfig ? { appConfig } : {}),
        initProgressCallback: (report: { progress?: number; text?: string }) => {
          const pct = typeof report?.progress === 'number' ? report.progress * 100 : 10;
          postProgress(
            Math.max(5, Math.min(99, pct)),
            report?.text || `Caching ${modelId} into IndexedDB...`
          );
        },
      });
    };

    try {
      webllmEngine = await initWithId(preferredModelId);
    } catch {
      // Retry FP32 shader build if device lacks shader-f16 WebGPU extension
      webllmEngine = await initWithId(fallbackF32Id);
    }

    activeBackend = 'webllm';
    loadedModelKey = modelKey;
    postProgress(100, `WebLLM (${preferredModelId}) ready & cached locally`, 'ready');
    return true;
  } catch {
    webllmEngine = null;
    return false;
  }
}

async function loadTransformersFallback(modelKey: LocalModelKey): Promise<void> {
  postProgress(8, 'Initializing Transformers.js WASM fallback runtime...');

  // Prefer official CDN, fallback to bundled @huggingface/transformers if offline
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let transformers: any;
  try {
    const cdnUrl = 'https://esm.run/@huggingface/transformers';
    transformers = await import(/* @vite-ignore */ cdnUrl);
  } catch {
    transformers = await import('@huggingface/transformers');
  }

  if (transformers.env) {
    transformers.env.useBrowserCache = true;
    transformers.env.allowLocalModels = false;
  }

  const hasGpu = await hasWorkingWebGPU();
  const candidates = [
    TRANSFORMERS_MODEL_MAP[modelKey],
    'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
  ];

  let lastErr: unknown = null;
  for (const modelId of [...new Set(candidates)]) {
    try {
      tfPipeline = await transformers.pipeline('text-generation', modelId, {
        device: hasGpu ? 'webgpu' : 'wasm',
        dtype: hasGpu ? 'q4f16' : 'q4',
        progress_callback: (evt: { progress?: number; file?: string }) => {
          if (typeof evt.progress === 'number') {
            postProgress(
              Math.min(99, evt.progress),
              evt.file
                ? `Caching ${evt.file} (${Math.round(evt.progress)}%)`
                : `Loading local WASM AI (${Math.round(evt.progress)}%)`
            );
          }
        },
      });
      activeBackend = 'transformers';
      loadedModelKey = modelKey;
      postProgress(
        100,
        `Transformers.js (${hasGpu ? 'WebGPU' : 'WASM'}) ready & cached locally`,
        'ready'
      );
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error('Unable to initialize local browser AI model.');
}

async function ensureEngineReady(modelKey: LocalModelKey): Promise<'webllm' | 'transformers'> {
  if (activeBackend && loadedModelKey === modelKey && (webllmEngine || tfPipeline)) {
    postProgress(100, 'Cached browser model ready', 'ready');
    return activeBackend;
  }

  if (loadedModelKey !== modelKey) {
    webllmEngine = null;
    tfPipeline = null;
    activeBackend = null;
    loadPromise = null;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const webllmOk = await loadWebLLM(modelKey);
    if (webllmOk) return 'webllm';
    await loadTransformersFallback(modelKey);
    return 'transformers';
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    postProgress(
      0,
      err instanceof Error ? err.message : 'Local model load failed',
      'error'
    );
    throw err;
  }
}

async function handleGenerate(payload: WorkerStartPayload) {
  const { requestId, modelKey, messages } = payload;

  try {
    const backend = await ensureEngineReady(modelKey);
    if (abortedRequests.has(requestId)) {
      abortedRequests.delete(requestId);
      self.postMessage({ type: 'done', requestId, engine: 'Browser Local AI (Stopped)' });
      return;
    }

    if (backend === 'webllm' && webllmEngine) {
      const engineLabel = `Browser Local WebLLM (${WEBLLM_MODEL_MAP[modelKey].split('-q4')[0]})`;
      const asyncChunks = await webllmEngine.chat.completions.create({
        messages,
        stream: true,
        max_tokens: 1536,
        temperature: 0.4,
      });

      for await (const chunk of asyncChunks) {
        if (abortedRequests.has(requestId)) {
          await webllmEngine.interruptGenerate?.();
          break;
        }
        const token = chunk?.choices?.[0]?.delta?.content;
        if (token) {
          self.postMessage({
            type: 'token',
            requestId,
            token,
            engine: engineLabel,
          });
        }
      }

      abortedRequests.delete(requestId);
      self.postMessage({ type: 'done', requestId, engine: engineLabel });
      return;
    }

    if (tfPipeline) {
      // Transformers.js TextStreamer in WASM / WebGPU fallback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let transformers: any;
      try {
        const tfCdnUrl = 'https://esm.run/@huggingface/transformers';
        transformers = await import(/* @vite-ignore */ tfCdnUrl);
      } catch {
        transformers = await import('@huggingface/transformers');
      }

      const engineLabel = 'Browser Local Transformers (WASM)';
      const { TextStreamer, InterruptableStoppingCriteria } = transformers;
      tfInterrupt = InterruptableStoppingCriteria ? new InterruptableStoppingCriteria() : null;

      const streamer = new TextStreamer(tfPipeline.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          if (abortedRequests.has(requestId)) {
            tfInterrupt?.interrupt?.();
            return;
          }
          if (text) {
            self.postMessage({
              type: 'token',
              requestId,
              token: text,
              engine: engineLabel,
            });
          }
        },
      });

      await tfPipeline(messages, {
        max_new_tokens: 1200,
        do_sample: false,
        streamer,
        ...(tfInterrupt ? { stopping_criteria: [tfInterrupt] } : {}),
      });

      tfInterrupt = null;
      abortedRequests.delete(requestId);
      self.postMessage({ type: 'done', requestId, engine: engineLabel });
    }
  } catch (err) {
    abortedRequests.delete(requestId);
    self.postMessage({
      type: 'error',
      requestId,
      error:
        err instanceof Error
          ? err.message
          : 'Browser Local AI inference encountered an error.',
    });
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'abort') {
    abortedRequests.add(msg.requestId);
    if (webllmEngine?.interruptGenerate) {
      webllmEngine.interruptGenerate().catch(() => {});
    }
    if (tfInterrupt?.interrupt) {
      tfInterrupt.interrupt();
    }
    return;
  }

  if (msg.type === 'preload') {
    ensureEngineReady(msg.modelKey).catch(() => {});
    return;
  }

  if (msg.type === 'generate') {
    handleGenerate(msg);
  }
});
