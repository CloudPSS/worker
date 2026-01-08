/// <reference lib="webworker" />

export const { Worker } = globalThis;

/** add message callback */
export function onMessage(callback: (value: unknown) => unknown): void {
    self.addEventListener('message', (ev) => {
        callback(ev.data);
    });
}

/** post message */
export function postMessage(value: unknown, transfer?: Transferable[]): void {
    self.postMessage(value, transfer!);
}

// eslint-disable-next-line unicorn/prefer-global-this
export const IS_WORKER_THREAD = typeof self != 'undefined' && self instanceof WorkerGlobalScope;

export const HARDWARE_CONCURRENCY = globalThis.navigator?.hardwareConcurrency ?? 4;
