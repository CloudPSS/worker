import { TAG, WORKER_URL, type WorkerData } from '#node-worker';
import os from 'node:os';
import { Worker as NodeWorker, type Transferable as NodeTransferable, parentPort } from 'node:worker_threads';

const kWorker = Symbol.for('@cloudpss/worker:worker');
/** Worker polyfill */
export class Worker extends EventTarget implements AbstractWorker, MessageEventTarget<Worker> {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super();
        if (typeof scriptURL != 'string') scriptURL = String(scriptURL);
        const worker = new NodeWorker(new URL(WORKER_URL), {
            name: options?.name,
            workerData: { tag: TAG, url: scriptURL } satisfies WorkerData,
        });
        worker.on('message', (data: unknown) => {
            const ev = new MessageEvent('message', { data });
            this.dispatchEvent(ev);
            if (typeof this.onmessage == 'function') {
                this.onmessage(ev);
            }
        });
        worker.on('messageerror', (data: unknown) => {
            const ev = new MessageEvent('messageerror', { data });
            this.dispatchEvent(ev);
            if (typeof this.onmessageerror == 'function') {
                this.onmessageerror(ev);
            }
        });
        worker.on('error', (error) => {
            const ev = new Event('error', {}) as ErrorEvent;
            Object.defineProperty(ev, 'error', {
                value: error,
                configurable: true,
            });
            Object.defineProperty(ev, 'message', {
                value: error instanceof Error ? error.message : String(error),
                configurable: true,
            });
            this.dispatchEvent(ev);
            if (typeof this.onerror == 'function') {
                this.onerror(ev);
            }
        });
        this[kWorker] = worker;
    }
    protected readonly [kWorker]: NodeWorker;
    onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
    onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
    onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;
    /** @inheritdoc */
    postMessage(data: unknown, transfer?: Transferable[] | { transfer?: Transferable[] }): void {
        let t: Transferable[] = [];
        if (!transfer) {
            //
        } else if (Array.isArray(transfer)) {
            t = transfer;
        } else if (transfer.transfer) {
            t = transfer.transfer;
        }
        this[kWorker].postMessage(data, t as readonly NodeTransferable[]);
    }
    /** @inheritdoc */
    terminate(): void {
        void this[kWorker].terminate();
    }
}

/** add message callback */
export function onMessage(callback: (value: unknown) => unknown): void {
    parentPort!.on('message', callback);
}

/** post message */
export function postMessage(value: unknown, transfer?: readonly Transferable[]): void {
    parentPort!.postMessage(value, transfer as NodeTransferable[]);
}

export const IS_WORKER_THREAD = parentPort != null;

export const HARDWARE_CONCURRENCY = os.availableParallelism?.() ?? os.cpus().length;
