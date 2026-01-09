import { IS_WORKER_THREAD, postMessage } from '@cloudpss/worker/ponyfill';
import { isWorkerMessage, kID, type WorkerInitializationMessage } from './message.js';

/** Low level API, notify main thread that worker is ready */
export function notifyReady(err?: Error): void {
    if (!IS_WORKER_THREAD) {
        throw new Error('notifyReady can only be called inside worker thread');
    }
    const message: WorkerInitializationMessage = { [kID]: -1, error: err ?? undefined };
    setTimeout(() => postMessage(message), 1);
}

/** Low level API, wait for a worker to become available, i.e., call {@link notifyReady} method */
export async function waitForWorkerReady(worker: Worker, timeout = 30000): Promise<void> {
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
        const cleanup = (): void => {
            clearTimeout(timeoutId);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
        };
        const timeoutId = setTimeout(onTimeout, timeout);
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
    });
}
