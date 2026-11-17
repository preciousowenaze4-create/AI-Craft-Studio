import type { LocalModelProgress } from '../types';
import type { LocalModelKey } from '../workers/localAiWorker';

export type { LocalModelKey };

export interface LocalModelOption {
  id: LocalModelKey;
  label: string;
  sizeLabel: string;
  description: string;
}

export const LOCAL_MODEL_OPTIONS: LocalModelOption[] = [
  {
    id: 'phi-3.5',
    label: 'Phi-3.5-Mini-Instruct (3.8B)',
    sizeLabel: '~2.3 GB',
    description: 'Higher-capacity local reasoning & deep synthesis (~2.3 GB WebGPU)',
  },
  {
    id: 'qwen-coder',
    label: 'Qwen2.5-Coder-1.5B',
    sizeLabel: '~1.0 GB',
    description: 'Best local coding & HTML/JS live previews (~1.0 GB cached)',
  },
  {
    id: 'llama-3.2',
    label: 'Llama-3.2-1B-Instruct',
    sizeLabel: '~0.7 GB',
    description: 'Ultra-lightweight fast responses for mobile phones (~0.7 GB cached)',
  },
];

interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

let workerInstance: Worker | null = null;

function getLocalAiWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('../workers/localAiWorker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return workerInstance;
}

export async function checkWebGPUSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown | null> };
  };
  if (!nav.gpu) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export async function streamLocalBrowserAI(
  messages: ChatMessageInput[],
  onToken: (token: string, engineLabel?: string) => void,
  onProgress?: (info: LocalModelProgress) => void,
  signal?: AbortSignal,
  modelKey: LocalModelKey = 'qwen-coder'
): Promise<string> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const worker = getLocalAiWorker();
  const requestId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  onProgress?.({
    status: 'loading',
    progress: 3,
    text: 'Starting Browser Local AI Web Worker...',
  });

  return new Promise<string>((resolve, reject) => {
    let engineUsed = 'Browser Local AI (Zero-Limit)';
    let settled = false;

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onWorkerError);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      worker.postMessage({ type: 'abort', requestId });
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const onWorkerError = (ev: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      const errMsg = ev.message || 'Local Web Worker execution error.';
      onProgress?.({ status: 'error', progress: 0, text: errMsg });
      reject(new Error(errMsg));
    };

    const onMessage = (
      ev: MessageEvent<{
        type: 'progress' | 'token' | 'done' | 'error';
        requestId?: string;
        progress?: number;
        text?: string;
        status?: 'loading' | 'ready' | 'error';
        token?: string;
        engine?: string;
        error?: string;
      }>
    ) => {
      const data = ev.data;
      if (!data) return;

      if (data.type === 'progress') {
        onProgress?.({
          status: data.status || 'loading',
          progress: data.progress ?? 0,
          text: data.text || 'Loading local browser model...',
        });
        return;
      }

      if (data.requestId !== requestId) return;

      if (data.type === 'token' && data.token) {
        if (data.engine) engineUsed = data.engine;
        onToken(data.token, engineUsed);
        return;
      }

      if (data.type === 'done') {
        if (settled) return;
        settled = true;
        if (data.engine) engineUsed = data.engine;
        cleanup();
        resolve(engineUsed);
        return;
      }

      if (data.type === 'error') {
        if (settled) return;
        settled = true;
        cleanup();
        const errMsg = data.error || 'Local browser AI failed.';
        onProgress?.({ status: 'error', progress: 0, text: errMsg });
        reject(new Error(errMsg));
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onWorkerError);

    worker.postMessage({
      type: 'generate',
      requestId,
      modelKey,
      messages,
    });
  });
}
