import type { LocalModelProgress } from '../types';

const MODEL_ID = 'onnx-community/Qwen2.5-Coder-1.5B-Instruct';

interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Lazy-loaded singleton state for in-browser inference
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedPipeline: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadingPromise: Promise<any> | null = null;

export async function checkWebGPUSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown | null> } };
  if (!nav.gpu) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export async function getOrLoadLocalPipeline(
  onProgress?: (info: LocalModelProgress) => void
) {
  if (cachedPipeline) {
    onProgress?.({ status: 'ready', progress: 100, text: 'Local model ready' });
    return cachedPipeline;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    onProgress?.({
      status: 'loading',
      progress: 5,
      text: 'Initializing WebGPU / ONNX runtime...',
    });

    const transformers = await import('@huggingface/transformers');
    const hasWebGPU = await checkWebGPUSupport();

    // Ensure browser cache is enabled so weights persist in CacheStorage/IndexedDB
    if (transformers.env) {
      transformers.env.useBrowserCache = true;
      transformers.env.allowLocalModels = false;
    }

    const pipe = await transformers.pipeline('text-generation', MODEL_ID, {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      dtype: hasWebGPU ? 'q4f16' : 'q4',
      progress_callback: (evt: { status?: string; progress?: number; file?: string }) => {
        if (typeof evt.progress === 'number') {
          onProgress?.({
            status: 'loading',
            progress: Math.min(99, Math.round(evt.progress)),
            text: evt.file
              ? `Downloading ${evt.file} (${Math.round(evt.progress)}%)`
              : `Loading model (${Math.round(evt.progress)}%)`,
          });
        }
      },
    });

    cachedPipeline = pipe;
    onProgress?.({
      status: 'ready',
      progress: 100,
      text: `Local Qwen2.5-Coder-1.5B ready (${hasWebGPU ? 'WebGPU' : 'WASM'})`,
    });
    return pipe;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    loadingPromise = null;
    onProgress?.({
      status: 'error',
      progress: 0,
      text: err instanceof Error ? err.message : 'Failed to load local model',
    });
    throw err;
  }
}

export async function streamLocalBrowserAI(
  messages: ChatMessageInput[],
  onToken: (token: string) => void,
  onProgress?: (info: LocalModelProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const pipe = await getOrLoadLocalPipeline(onProgress);
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const transformers = await import('@huggingface/transformers');
  const { TextStreamer } = transformers;

  const streamer = new TextStreamer(pipe.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (!signal?.aborted && text) {
        onToken(text);
      }
    },
  });

  await pipe(messages, {
    max_new_tokens: 1024,
    do_sample: false,
    streamer,
  });
}
