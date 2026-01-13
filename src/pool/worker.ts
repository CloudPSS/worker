import { IS_WORKER_THREAD, onMessage, postMessage } from '@cloudpss/worker/ponyfill';
import { isWorkerMessage, kID, type WorkerRequest, type WorkerResponse } from './message.js';
import { isWorkerResult, type MaybeAsync, type WorkerInterface, type WorkerRecord } from './interfaces.js';
import { notifyReady } from './ready-notify.js';

/** Message handler */
async function handleMessage<T extends WorkerRecord>(worker: T, msg: unknown): Promise<void> {
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
        if (isWorkerResult(result)) {
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
            error: (ex as Error | null) ?? new Error('Unknown error'),
        } satisfies WorkerResponse);
    }
}

/** Start listening for messages */
async function exposeImpl<T extends WorkerRecord>(worker: (() => MaybeAsync<T>) | MaybeAsync<T>): Promise<void> {
    if (typeof worker == 'function') {
        worker = await worker();
    } else {
        worker = await worker;
    }
    onMessage(async (msg) => handleMessage(worker, msg));
}

let exposed = false;

// WORKAROUND: Union args are not properly inferred in some cases

/** Expose functions from worker */
export function expose<const T extends WorkerRecord>(worker: () => PromiseLike<T>): WorkerInterface<T>;
/** Expose functions from worker */
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function expose<const T extends WorkerRecord>(worker: () => T): WorkerInterface<T>;
/** Expose functions from worker */
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function expose<const T extends WorkerRecord>(worker: PromiseLike<T>): WorkerInterface<T>;
/** Expose functions from worker */
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function expose<const T extends WorkerRecord>(worker: T): WorkerInterface<T>;

/** Expose functions from worker */
export function expose<const T extends WorkerRecord>(
    worker: (() => MaybeAsync<T>) | MaybeAsync<T>,
): WorkerInterface<T> {
    if (!IS_WORKER_THREAD) {
        throw new Error('expose can only be called inside worker thread');
    }
    if (exposed) {
        throw new Error('expose can only be called once per worker');
    }
    exposed = true;
    notifyReady(exposeImpl(worker));

    // This dummy implementation is only for type inference
    return null;
}
