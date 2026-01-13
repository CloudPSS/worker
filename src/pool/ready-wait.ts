import { isWorkerMessage, kID, type WorkerInitializationMessage } from './message.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { notifyReady } from './ready-notify.js';

/** Low level API, wait for a worker to become available, i.e., call {@link notifyReady} method */
export async function waitForWorkerReady(worker: Worker, timeout = 30000, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const onMessage = ({ data }: MessageEvent<WorkerInitializationMessage>): void => {
            if (!isWorkerMessage(data) || data[kID] !== -1) return;
            cleanup();
            if (data.error !== undefined) {
                reject(data.error);
            } else {
                resolve();
            }
        };
        const onError = (ev: ErrorEvent): void => {
            cleanup();
            reject(new Error(`Worker initialization error: ${ev.message}`, { cause: ev.error }));
        };
        const onTimeout = (): void => {
            cleanup();
            reject(new Error(`Worker initialization timed out after ${timeout} ms`));
        };
        const onAbort = (): void => {
            cleanup();
            reject((signal?.reason as Error | null) ?? new Error('Worker initialization aborted'));
        };
        const cleanup = (): void => {
            if (timeoutId) clearTimeout(timeoutId);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
        };
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (timeout > 0) timeoutId = setTimeout(onTimeout, timeout);
        signal?.addEventListener('abort', onAbort);
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
    });
}
