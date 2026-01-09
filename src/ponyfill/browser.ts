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

export const IS_WORKER_THREAD =
    // eslint-disable-next-line unicorn/prefer-global-this
    typeof self != 'undefined' && typeof WorkerGlobalScope == 'function' && self instanceof WorkerGlobalScope;

export const HARDWARE_CONCURRENCY = globalThis.navigator?.hardwareConcurrency ?? 4;
