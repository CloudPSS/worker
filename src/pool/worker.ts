import { IS_WORKER_THREAD, onMessage, postMessage } from '@cloudpss/worker/ponyfill';
import { isWorkerMessage, kID, type WorkerRequest, type WorkerResponse } from './message.js';
import type { MaybeFactory, WorkerFunction, WorkerInterface } from './interfaces.js';
import { notifyReady } from './ready.js';

/** Message handler */
async function handleMessage<T extends Record<string, WorkerFunction>>(worker: T, msg: unknown): Promise<void> {
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
        const fn = worker[method];
        if (typeof fn != 'function') {
            throw new TypeError(`Method not found: ${method}`);
        }
        const result: unknown = await Reflect.apply(fn, worker, args);
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
}

/** Start listening for messages */
async function exposeImpl<T extends Record<string, WorkerFunction>>(worker: MaybeFactory<T>): Promise<void> {
    if (typeof worker == 'function') {
        worker = await worker();
    }
    onMessage(async (msg) => handleMessage(worker, msg));
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
