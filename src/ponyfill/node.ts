import os from 'node:os';
import { Worker as NodeWorker, type Transferable as NodeTransferable, parentPort } from 'node:worker_threads';

const workerSource = /* js */ `import(process.getBuiltinModule('node:worker_threads').workerData);`;
const workerUrl = new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`);
const kWorker = Symbol.for('@cloudpss/worker:worker');

/** Worker polyfill */
class WorkerPonyfill extends EventTarget implements Worker, AbstractWorker, MessageEventTarget<Worker> {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super();
        if (typeof scriptURL != 'string') scriptURL = String(scriptURL);
        const worker = new NodeWorker(workerUrl, {
            name: options?.name,
            workerData: scriptURL,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onmessageerror: ((this: Worker, ev: MessageEvent) => any) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;
    /** @inheritdoc */
    postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        let t: Transferable[] | undefined;
        if (Array.isArray(transfer)) {
            t = transfer;
        } else if (Array.isArray(transfer?.transfer)) {
            t = transfer.transfer;
        }
        this[kWorker].postMessage(message, t as readonly NodeTransferable[]);
    }
    /** @inheritdoc */
    terminate(): void {
        void this[kWorker].terminate();
    }
}
Object.defineProperty(WorkerPonyfill, 'name', { value: 'Worker' });
export { WorkerPonyfill as Worker };

/** add message callback */
export function onMessage(callback: (value: unknown) => unknown): void {
    parentPort?.on('message', callback);
}

/** post message */
export function postMessage(value: unknown, transfer?: readonly Transferable[]): void {
    parentPort?.postMessage(value, transfer as NodeTransferable[]);
}

export const IS_WORKER_THREAD = parentPort != null;

export const HARDWARE_CONCURRENCY = os.availableParallelism?.() ?? os.cpus().length;
