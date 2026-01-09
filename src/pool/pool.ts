import { HARDWARE_CONCURRENCY } from '@cloudpss/worker/ponyfill';
import { isWorkerMessage, kID, type WorkerRequest, type WorkerResponse } from './message.js';
import type { WorkerInterface, WorkerMethod, WorkerMethods } from './interfaces.js';
import { createWorkerFactory, type WorkerSource } from './factory.js';
import { nextId } from './id.js';
import { waitForWorkerReady } from './ready.js';

const MAX_COPY_OVERHEAD = 1024 * 16; // 16KB

/** Worker pool options */
export interface WorkerPoolOptions {
    /** Name of the worker pool */
    name?: string;
    /**
     * Maximum number of workers in the pool
     * @default navigator.hardwareConcurrency - 1
     */
    maxWorkers?: number;
    /**
     * Minimum number of idle workers to keep
     * @default 1
     */
    minIdleWorkers?: number;
    /**
     * Idle worker timeout in milliseconds, set to 0 to disable automatic cleanup
     * @default 5000
     */
    idleTimeout?: number;
    /**
     * Wait time in milliseconds for a worker initialization before timing out
     * @default 30000
     */
    initTimeout?: number;
    /**
     * Wait time in milliseconds for an idle worker before creating a new worker
     * @default 0
     */
    creationDelay?: number;
}

/** Call to a specific worker */
async function callWorker(
    worker: Worker,
    method: WorkerRequest['method'],
    args: WorkerRequest['args'],
    transfer?: Transferable[],
): Promise<unknown> {
    const id = nextId();
    const request: WorkerRequest = {
        [kID]: id,
        method,
        args,
    };
    if (transfer == null) {
        transfer = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (!ArrayBuffer.isView(arg) || arg.byteLength + MAX_COPY_OVERHEAD >= arg.buffer.byteLength) continue;

            // WORKAROUND: Avoid OOM of chrome when copying large buffers
            const buffer = arg.buffer.slice(arg.byteOffset, arg.byteOffset + arg.byteLength);
            args[i] = new (arg.constructor as new (buffer: ArrayBufferLike) => typeof arg)(buffer);
            transfer.push(buffer);
        }
    }
    return new Promise((resolve, reject) => {
        if (transfer?.length) {
            worker.postMessage(request, { transfer });
        } else {
            worker.postMessage(request);
        }

        const onMessage = (ev: MessageEvent<WorkerResponse>): void => {
            if (!isWorkerMessage(ev.data)) {
                // ignore invalid message
                return;
            }
            const { [kID]: resId, result, error } = ev.data;
            if (resId !== id) return;
            cleanup();
            if (error != null) {
                reject(error);
            } else {
                resolve(result);
            }
        };
        const onError = (ev: ErrorEvent): void => {
            cleanup();
            reject(new Error(`Worker error: ${ev.message}`, { cause: ev.error }));
        };
        const cleanup = (): void => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
    });
}

const kInfo = Symbol('@cloudpss/worker:worker-info');
/** Tagged worker */
export type TaggedWorker<T extends WorkerInterface | null = WorkerInterface | null> = Worker & {
    [kInfo]: {
        __pool__?: WorkerPool<T>;
        tag: symbol;
        busy: boolean;
    };
};

/** Worker pool */
export class WorkerPool<T extends WorkerInterface = WorkerInterface> implements Disposable {
    constructor(source: WorkerSource, options?: WorkerPoolOptions) {
        const name = options?.name ?? 'worker-pool';
        const maxWorkers = options?.maxWorkers ?? Math.max(HARDWARE_CONCURRENCY - 1, 1);
        let minIdleWorkers = options?.minIdleWorkers ?? 1;
        if (minIdleWorkers > maxWorkers) minIdleWorkers = maxWorkers;
        const idleTimeout = options?.idleTimeout ?? 5000;
        const initTimeout = options?.initTimeout ?? 30000;
        const creationDelay = options?.creationDelay ?? 0;

        if (maxWorkers <= 0 || !Number.isSafeInteger(maxWorkers)) {
            throw new TypeError('Invalid maxWorkers option');
        }
        if (minIdleWorkers < 0 || !Number.isSafeInteger(minIdleWorkers)) {
            throw new TypeError('Invalid minIdleWorkers option');
        }
        if (!Number.isFinite(idleTimeout) || idleTimeout < 0) {
            throw new TypeError('Invalid idleWorkerTimeout option');
        }
        if (!Number.isFinite(initTimeout) || initTimeout < 0) {
            throw new TypeError('Invalid workerInitTimeout option');
        }
        if (!Number.isFinite(creationDelay) || creationDelay < 0) {
            throw new TypeError('Invalid idleWorkerWaitTimeout option');
        }

        this.options = Object.freeze({
            name,
            maxWorkers,
            minIdleWorkers,
            idleTimeout,
            initTimeout,
            creationDelay,
        });
        this.tag = Symbol(`@cloudpss/worker:pool:${name}`);
        this.factory = createWorkerFactory(source, { name });
    }
    readonly options: Readonly<Required<WorkerPoolOptions>>;
    private readonly factory;
    private readonly tag;

    private readonly initializingWorkers = new Set<Promise<TaggedWorker<T>>>();
    private readonly workers = new Set<TaggedWorker<T>>();
    /** create and initialize worker */
    private async initWorker(info: TaggedWorker<T>[typeof kInfo]): Promise<TaggedWorker<T>> {
        const worker = (await this.factory()) as TaggedWorker<T>;
        worker[kInfo] = info;
        try {
            await waitForWorkerReady(worker, this.options.initTimeout);
            const onError = (ev: ErrorEvent): void => {
                // eslint-disable-next-line no-console
                console.error(`${this.options.name} worker error`, ev);

                worker.removeEventListener('error', onError);
                this.destroyWorker(worker);
                this.handlePendingBorrow();
            };
            worker.addEventListener('error', onError);
            return worker;
        } catch (ex) {
            this.destroyWorker(worker);
            this.handlePendingBorrow();
            throw ex;
        }
    }
    private cleanupScheduleId: ReturnType<typeof setTimeout> | null = null;
    /** Schedule cleanup of idle workers */
    private scheduleCleanup(): void {
        if (this.options.idleTimeout <= 0) return;
        if (this.cleanupScheduleId != null) clearTimeout(this.cleanupScheduleId);

        const id = setTimeout(() => {
            if (this.cleanupScheduleId === id) this.cleanupScheduleId = null;
            if (this.pendingBorrow.length > 0) return;
            // destroy extra idle workers
            const idleWorkers = [...this.workers].filter((w) => !w[kInfo].busy);
            const minIdle = this.options.minIdleWorkers;
            if (idleWorkers.length <= minIdle) return;
            const numToDestroy = idleWorkers.length - minIdle;
            for (let i = 0; i < numToDestroy; i++) {
                const worker = idleWorkers[i]!;
                this.destroyWorker(worker);
            }
        }, this.options.idleTimeout);
        this.cleanupScheduleId = id;
    }

    /** return worker to pool */
    returnWorker(worker: TaggedWorker<T>): void {
        if (!this.workers.has(worker)) {
            // Worker has been destroyed
            return;
        }
        worker[kInfo].busy = false;
        this.handlePendingBorrow();
        this.scheduleCleanup();
    }

    /** destroy worker and remove it from the pool */
    destroyWorker(worker: TaggedWorker<T>): void {
        if (!this.workers.delete(worker)) {
            // Worker already removed
            return;
        }
        worker.terminate();
    }

    /** Get an idle worker */
    private findIdleWorker(): TaggedWorker<T> | null {
        for (const worker of this.workers) {
            if (worker[kInfo].busy) continue;
            worker[kInfo].busy = true;
            return worker;
        }
        return null;
    }

    /** Create a new worker if possible */
    private createWorker(): Promise<TaggedWorker<T>> | null {
        if (this.workers.size + this.initializingWorkers.size >= this.options.maxWorkers) {
            return null;
        }

        return (async () => {
            const task = this.initWorker({ tag: this.tag, busy: true });
            this.initializingWorkers.add(task);
            let worker: TaggedWorker<T>;
            try {
                worker = await task;
            } finally {
                this.initializingWorkers.delete(task);
            }
            this.workers.add(worker);
            return worker;
        })();
    }

    /** Get or wait for an idle worker */
    async borrowWorker(): Promise<TaggedWorker<T>> {
        // try to find an idle worker
        const idle = this.findIdleWorker();
        if (idle != null) return idle;

        // check if we need to wait before creating a new worker
        const currentTotal = this.workers.size + this.initializingWorkers.size;
        if (currentTotal > 0 && currentTotal >= this.options.minIdleWorkers) {
            // wait for creation delay
            await new Promise((resolve) => setTimeout(resolve, this.options.creationDelay));
            // try to find an idle worker again
            const idle = this.findIdleWorker();
            if (idle != null) return idle;
        }

        // create a new worker if possible
        const created = this.createWorker();
        if (created != null) return await created;

        // wait for an idle worker
        return await new Promise((resolve) => {
            this.pendingBorrow.push(resolve);
        });
    }

    private readonly pendingBorrow: Array<(worker: TaggedWorker<T>) => void> = [];
    /** handle pending borrow */
    private handlePendingBorrow(): void {
        void Promise.resolve()
            .then(async () => {
                while (this.pendingBorrow.length > 0) {
                    const pending = this.pendingBorrow.shift()!;
                    const existingIdle = this.findIdleWorker();
                    if (existingIdle != null) {
                        pending(existingIdle);
                        continue;
                    }
                    const created = this.createWorker();
                    if (created != null) {
                        pending(await created);
                        continue;
                    }
                    this.pendingBorrow.unshift(pending);
                    break;
                }
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.error(`${this.options.name} handlePendingBorrow error`, err);
            });
    }

    /** Call to a specific worker */
    async callWorker<const M extends WorkerMethods<T>>(
        worker: TaggedWorker<T>,
        method: M,
        args: Parameters<WorkerMethod<T, M>>,
        transfer?: Transferable[],
    ): Promise<ReturnType<WorkerMethod<T, M>>> {
        return (await callWorker(worker, method, args, transfer)) as Promise<ReturnType<WorkerMethod<T, M>>>;
    }

    /** Call to worker pool */
    async call<const M extends WorkerMethods<T>>(
        method: M,
        args: Parameters<WorkerMethod<T, M>>,
        transfer?: Transferable[],
    ): Promise<ReturnType<WorkerMethod<T, M>>> {
        const worker = await this.borrowWorker();
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return await this.callWorker<M>(worker, method, args, transfer);
        } finally {
            this.returnWorker(worker);
        }
    }

    /** cleanup all workers */
    destroy(): void {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers.clear();
    }
    /** Dispose the worker pool */
    [Symbol.dispose](): void {
        this.destroy();
    }

    /** get current worker status */
    status(): { total: number; idle: number; busy: number; initializing: number } {
        const initializing = this.initializingWorkers.size;
        let idle = 0;
        for (const worker of this.workers) {
            if (!worker[kInfo].busy) idle++;
        }
        return {
            total: this.workers.size + initializing,
            idle,
            busy: this.workers.size - idle,
            initializing,
        };
    }
}
