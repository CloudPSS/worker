import { IS_WORKER_THREAD, onMessage, postMessage } from '@cloudpss/worker/ponyfill';
import { isWorkerMessage, kID, type WorkerRequest, type WorkerResponse } from './message.js';
import type { WorkerFunction, WorkerInterface } from './interfaces.js';
import { notifyReady } from './ready.js';

/** Start listening for messages */
async function exposeImpl<T extends Record<string, WorkerFunction>>(
    worker: T | (() => T) | (() => PromiseLike<T>),
): Promise<void> {
    if (typeof worker == 'function') {
        worker = await worker();
    }
    const functions = new Map<string, WorkerFunction>();
    for (const key of Object.keys(worker)) {
        const fn = (worker as Record<string, unknown>)[key];
        if (typeof fn == 'function') {
            functions.set(key, fn.bind(worker) as WorkerFunction);
        }
    }
    onMessage(async (msg) => {
        if (!isWorkerMessage(msg)) {
            // ignore invalid message
            return;
        }
        const { method, args, [kID]: id } = msg as WorkerRequest;
        if (typeof method != 'string' || !Array.isArray(args)) {
            // ignore invalid message
            return;
        }
        try {
            const fn = functions.get(method);
            if (fn == null) {
                throw new Error(`Method not found: ${method}`);
            }
            const result: unknown = await fn(...args);
            if (
                result &&
                typeof result == 'object' &&
                'result' in result &&
                'transfer' in result &&
                Array.isArray(result.transfer)
            ) {
                postMessage(
                    {
                        [kID]: id,
                        result: result.result,
                    } satisfies WorkerResponse,
                    result.transfer,
                );
            } else {
                postMessage({
                    [kID]: id,
                    result,
                } satisfies WorkerResponse);
            }
        } catch (ex) {
            postMessage({
                [kID]: id,
                result: undefined,
                error: (ex as Error) ?? new Error('Unknown error'),
            } satisfies WorkerResponse);
        }
    });
}
let exposed = false;
/** Expose functions from worker */
export function expose<T extends Record<string, WorkerFunction>>(
    worker: T | (() => T) | (() => PromiseLike<T>),
): WorkerInterface<T> {
    if (!IS_WORKER_THREAD) {
        throw new Error('expose can only be called inside worker thread');
    }
    if (exposed) {
        throw new Error('expose can only be called once per worker');
    }
    exposeImpl(worker).then(
        () => {
            exposed = true;
            notifyReady();
        },
        (ex) => {
            exposed = true;
            notifyReady((ex as Error) ?? new Error('Unknown error'));
        },
    );

    // This dummy implementation is only for type inference
    return null;
}
