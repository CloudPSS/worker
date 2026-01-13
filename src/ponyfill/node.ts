import os from 'node:os';
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

/**
 * Add event listener for event handler
 * @see https://html.spec.whatwg.org/multipage/webappapis.html#the-event-handler-processing-algorithm
 */
function listen<T extends EventTarget, E extends Event>(
    target: T,
    type: string,
    handler: () => ((this: T, ev: E) => unknown) | null | undefined,
): void {
    target.addEventListener(type, (ev) => {
        // Let callback be the result of getting the current value of the event handler given eventTarget and name.
        const callback = handler();
        // If callback is null, then return.
        if (callback == null) return;
        // Let return value be the result of invoking callback with « event », "rethrow", and with callback this value set to event's currentTarget.
        const returnValue = callback.call(ev.currentTarget as T, ev as E);
        // If return value is false, then set event's canceled flag.
        if (returnValue === false) {
            ev.preventDefault();
        }
    });
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
        });
        worker.on('messageerror', (data: unknown) => {
            const ev = new MessageEvent('messageerror', { data });
            this.dispatchEvent(ev);
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
        });
        this[kWorker] = worker;
    }
    protected readonly [kWorker]: NodeWorker;

    #message: ((this: Worker, ev: MessageEvent) => unknown) | null | undefined = undefined;
    /** @inheritdoc */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get onmessage(): ((this: Worker, ev: MessageEvent) => any) | null {
        return this.#message ?? null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set onmessage(value: ((this: Worker, ev: MessageEvent) => any) | null) {
        if (this.#message === undefined) {
            listen(this, 'message', () => this.#message);
        }
        this.#message = value;
    }
    #messageerror: ((this: Worker, ev: MessageEvent) => unknown) | null | undefined = undefined;
    /** @inheritdoc */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get onmessageerror(): ((this: Worker, ev: MessageEvent) => any) | null {
        return this.#messageerror ?? null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set onmessageerror(value: ((this: Worker, ev: MessageEvent) => any) | null) {
        if (this.#messageerror === undefined) {
            listen(this, 'messageerror', () => this.#messageerror);
        }
        this.#messageerror = value;
    }
    #error: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null | undefined = undefined;
    /** @inheritdoc */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get onerror(): ((this: AbstractWorker, ev: ErrorEvent) => any) | null {
        return this.#error ?? null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set onerror(value: ((this: AbstractWorker, ev: ErrorEvent) => any) | null) {
        if (this.#error === undefined) {
            listen(this, 'error', () => this.#error);
        }
        this.#error = value;
    }
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
