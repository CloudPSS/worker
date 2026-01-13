import { availableParallelism } from 'node:os';
import { parentPort } from 'node:worker_threads';
import { filterNodeTransferable } from './node/utils.js';

export { Worker } from './node/worker-polyfill.js';

/** add message callback */
export function onMessage(callback: (value: unknown) => unknown): void {
    parentPort?.on('message', callback);
}

/** post message */
export function postMessage(value: unknown, transfer?: readonly Transferable[] | StructuredSerializeOptions): void {
    if (parentPort == null) return;
    const filtered = filterNodeTransferable(transfer);
    return parentPort.postMessage(value, filtered);
}

export const IS_WORKER_THREAD = parentPort != null;

export const HARDWARE_CONCURRENCY = availableParallelism();
