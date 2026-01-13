import { IS_WORKER_THREAD, postMessage } from '@cloudpss/worker/ponyfill';
import { kID, type WorkerInitializationMessage } from './message.js';

/** Implementation of worker ready notification */
async function notifyReadyImpl(ready?: Promise<unknown>): Promise<void> {
    let message: WorkerInitializationMessage;
    try {
        await ready;
        message = { [kID]: -1 };
    } catch (err) {
        const error = (err as Error | null) ?? new Error('Unknown error during worker initialization');
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
