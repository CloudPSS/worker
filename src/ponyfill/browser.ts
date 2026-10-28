/// <reference lib="webworker" />

export const { Worker } = globalThis;

/** add message callback */
export function onMessage(callback: (value: unknown) => unknown): void {
    globalThis.addEventListener('message', (ev) => {
        callback(ev.data);
    });
}

/** post message */
export function postMessage(value: unknown, transfer?: readonly Transferable[] | StructuredSerializeOptions): void {
    globalThis.postMessage(value, transfer as StructuredSerializeOptions);
}

export const IS_WORKER_THREAD = typeof WorkerGlobalScope == 'function' && globalThis instanceof WorkerGlobalScope;

export const HARDWARE_CONCURRENCY = globalThis.navigator?.hardwareConcurrency ?? 4;
