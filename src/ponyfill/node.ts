import { availableParallelism } from 'node:os';
import { type Transferable as NodeTransferable, parentPort } from 'node:worker_threads';

export { Worker } from './node/worker-polyfill.js';

/** add message callback */
export function onMessage(callback: (value: unknown) => unknown): void {
    parentPort?.on('message', callback);
}

/** post message */
export function postMessage(value: unknown, transfer?: readonly Transferable[]): void {
    parentPort?.postMessage(value, transfer as NodeTransferable[]);
}

export const IS_WORKER_THREAD = parentPort != null;

export const HARDWARE_CONCURRENCY = availableParallelism();
