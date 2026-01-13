import os from 'node:os';
import { isNativeError } from 'node:util/types';
import { Worker as NodeWorker, type Transferable as NodeTransferable, parentPort } from 'node:worker_threads';

const workerSource = /* js */ `import(process.getBuiltinModule('node:worker_threads').workerData);`;
const workerUrl = new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`);

/** Create node worker */
function createNodeWorker(scriptURL: string | URL, options?: WorkerOptions): NodeWorker {
    if (typeof scriptURL == 'string') scriptURL = new URL(scriptURL);
    if (scriptURL.protocol !== 'file:') {
        // Use workerData to pass script URL since Node.js doesn't support non-file URLs
        return new NodeWorker(workerUrl, {
            name: options?.name,
            workerData: scriptURL.href,
        });
    }
    if (scriptURL.hash.length > 1 && typeof import.meta.resolve == 'function') {
        // Maybe created by `new URL('#import-path', import.meta.url)`
        try {
            const maybeImport = decodeURIComponent(scriptURL.hash.slice(1));
            const resolved = import.meta.resolve(`#${maybeImport}`, scriptURL);
            return new NodeWorker(new URL(resolved), options);
        } catch {
            // ignore
        }
    }
    return new NodeWorker(scriptURL, options);
}

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
