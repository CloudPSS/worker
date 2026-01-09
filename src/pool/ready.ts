import { IS_WORKER_THREAD, postMessage } from '@cloudpss/worker/ponyfill';
import { isWorkerMessage, kID, type WorkerInitializationMessage } from './message.js';

/** Implementation of worker ready notification */
async function notifyReadyImpl(ready?: Promise<unknown>): Promise<void> {
    let message: WorkerInitializationMessage;
    try {
        await ready;
        message = { [kID]: -1 };
    } catch (err) {
        const error = (err as Error) ?? new Error('Unknown error during worker initialization');
        message = { [kID]: -1, error };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    postMessage(message);
}

/** Low level API, notify main thread that worker is ready */
export function notifyReady(ready?: Promise<unknown>): void {
    if (!IS_WORKER_THREAD) {
        throw new Error('notifyReady can only be called inside worker thread');
    }
    void notifyReadyImpl(ready);
}

/** Low level API, wait for a worker to become available, i.e., call {@link notifyReady} method */
export async function waitForWorkerReady(worker: Worker, timeout = 30000, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const onMessage = (ev: MessageEvent<WorkerInitializationMessage>): void => {
            if (!isWorkerMessage(ev.data) || ev.data[kID] !== -1) return;
            cleanup();
            if (ev.data.error !== undefined) {
                reject(ev.data.error);
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
            reject((signal?.reason as Error) ?? new Error('Worker initialization aborted'));
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
