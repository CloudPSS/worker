import { IS_WORKER_THREAD, onMessage, postMessage } from '@cloudpss/worker/ponyfill';
import {
    isWorkerMessage,
    kID,
    type WorkerInitializationMessage,
    type WorkerRequest,
    type WorkerResponse,
} from './message.js';

/** Return type of a worker function wrapped in a Promise */
type WorkerFunctionReturn<W> =
    W extends WorkerFunction<infer _, infer R>
        ? Promise<Awaited<R>>
        : W extends (...args: infer _) => infer R
          ? Promise<Awaited<R>>
          : never;

/**
 * A function type that can be executed in a worker thread
 */
export type WorkerFunction<A extends unknown[] = unknown[], R = unknown> = (
    ...args: A
) =>
    | R
    | PromiseLike<R>
    | { result: R; transfer: Transferable[] }
    | PromiseLike<{ result: R; transfer: Transferable[] }>;
/** Interface of a worker exposing functions of type WorkerFunction */
export type WorkerInterface<T extends Record<string, WorkerFunction> = Record<string, WorkerFunction>> = {
    readonly [K in keyof T & string]: (...args: Parameters<T[K]>) => WorkerFunctionReturn<T[K]>;
};

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
            const result = await fn(...args);
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
            setTimeout(
                () =>
                    postMessage({
                        [kID]: -1,
                    } satisfies WorkerInitializationMessage),
                1,
            );
        },
        (ex) => {
            exposed = true;
            setTimeout(
                () =>
                    postMessage({
                        [kID]: -1,
                        error: ex as Error,
                    } satisfies WorkerInitializationMessage),
                1,
            );
        },
    );

    // This dummy implementation is only for type inference
    return undefined as unknown as WorkerInterface<T>;
}
