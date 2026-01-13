import { isNativeError } from 'node:util/types';
import type { Worker as NodeWorker } from 'node:worker_threads';
import { createNodeWorker } from './worker.js';
import { filterNodeTransferable } from './utils.js';

/** Create ErrorEvent */
function createErrorEvent(error: unknown): ErrorEvent {
    const ev = new Event('error', {}) as ErrorEvent;
    const message = isNativeError(error) ? error.message : String(error);
    Object.defineProperty(ev, 'message', {
        value: message,
        configurable: true,
    });
    Object.defineProperty(ev, 'error', {
        value: error,
        configurable: true,
    });
    return ev;
}

const kWorker = Symbol.for('@cloudpss/worker:worker');
/** Worker polyfill */
class WorkerPonyfill extends EventTarget implements Worker, AbstractWorker, MessageEventTarget<Worker> {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super();
        const worker = createNodeWorker(scriptURL, options);
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
            const ev = createErrorEvent(error);
            this.dispatchEvent(ev);
            if (typeof this.onerror == 'function') {
                this.onerror(ev);
            }
        });
        this[kWorker] = worker;
    }
    protected readonly [kWorker]: NodeWorker;
    onmessage: Worker['onmessage'] = null;
    onmessageerror: Worker['onmessageerror'] = null;
    onerror: Worker['onerror'] = null;
    /** @inheritdoc */
    postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const options = filterNodeTransferable(transfer);
        this[kWorker].postMessage(message, options?.transfer);
    }
    /** @inheritdoc */
    terminate(): void {
        void this[kWorker].terminate();
    }
}
Object.defineProperty(WorkerPonyfill, 'name', { value: 'Worker' });
export { WorkerPonyfill as Worker };
