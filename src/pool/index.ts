import { HARDWARE_CONCURRENCY, Worker as WorkerPolyfill } from '@cloudpss/worker/ponyfill';
import {
    isWorkerMessage,
    kID,
    type WorkerInitializationMessage,
    type WorkerRequest,
    type WorkerResponse,
} from './message.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { WorkerInterface, notifyReady } from './worker.js';

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
     * @default maxWorkers >= 4 ? 2 : 1
     */
    minIdleWorkers?: number;
    /**
     * Idle worker timeout in milliseconds, set to 0 to disable automatic cleanup
     * @default 5000
     */
    idleWorkerTimeout?: number;
    /**
     * Wait time in milliseconds for a worker initialization before timing out
     * @default 30000
     */
    workerInitTimeout?: number;
}

let _id = 1;
/** Acquire next sequence id */
function nextId(): number {
    const id = _id;
    _id++;
    if (_id >= 0x7fff_ffff) _id = 1;
    return id;
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
            reject(new Error(ev.message, { cause: ev.error }));
        };
        const cleanup = (): void => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
    });
}

/** Tagged worker */
export type TaggedWorker<T = WorkerInterface> = Worker & { __workerInterface__: T };

/** Status of worker */
interface WorkerStatus<T> {
    /** The worker instance */
    worker: TaggedWorker<T>;
    /** Whether the worker is busy */
    busy: boolean;
}

/** Low level API, wait for a worker to become available, i.e., call {@link notifyReady} method */
export async function waitForWorkerReady(worker: Worker, timeout = 30000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const onMessage = (ev: MessageEvent<WorkerInitializationMessage>): void => {
            if (!isWorkerMessage(ev.data) || ev.data[kID] !== -1) return;
            cleanup();
            if (ev.data.error !== undefined) {
                reject(ev.data.error);
            } else {
                resolve();
            }
        };
        const onError = (ev: ErrorEvent): void => {
            cleanup();
            reject(new Error(ev.message, { cause: ev.error }));
        };
        const onTimeout = (): void => {
            cleanup();
            reject(new Error(`Worker initialization timed out after ${timeout} ms`));
        };
        const cleanup = (): void => {
            clearTimeout(timeoutId);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
        };
        const timeoutId = setTimeout(onTimeout, timeout);
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
    });
}

/** Worker pool */
export class WorkerPool<T extends WorkerInterface> implements Disposable {
    constructor(
        factoryOrUrl: (() => Worker | WorkerPolyfill | PromiseLike<Worker | WorkerPolyfill>) | string | URL,
        options?: WorkerPoolOptions,
    ) {
        const name = options?.name ?? 'worker-pool';
        const maxWorkers = options?.maxWorkers ?? Math.max(HARDWARE_CONCURRENCY - 1, 1);
        let minIdleWorkers = options?.minIdleWorkers ?? (maxWorkers >= 4 ? 2 : 1);
        if (minIdleWorkers > maxWorkers) minIdleWorkers = maxWorkers;
        const idleWorkerTimeout = options?.idleWorkerTimeout ?? 5000;

        if (maxWorkers <= 0 || !Number.isSafeInteger(maxWorkers)) {
            throw new TypeError('Invalid maxWorkers option');
        }
        if (minIdleWorkers < 0 || !Number.isSafeInteger(minIdleWorkers)) {
            throw new TypeError('Invalid minIdleWorkers option');
        }
        if (!Number.isFinite(idleWorkerTimeout) || idleWorkerTimeout < 0) {
            throw new TypeError('Invalid idleWorkerTimeout option');
        }

        this.options = {
            name,
            maxWorkers,
            minIdleWorkers,
            idleWorkerTimeout,
            workerInitTimeout: options?.workerInitTimeout ?? 30000,
        };

        if (typeof factoryOrUrl === 'function') {
            this.factory = factoryOrUrl as () => Promise<TaggedWorker<T>>;
        } else {
            const url = typeof factoryOrUrl == 'string' ? factoryOrUrl : factoryOrUrl.href;
            // eslint-disable-next-line @typescript-eslint/promise-function-async
            this.factory = () => Promise.resolve(new WorkerPolyfill(url, { name }) as Worker as TaggedWorker<T>);
        }
    }
    readonly options: Required<WorkerPoolOptions>;
    private readonly factory: () => Promise<TaggedWorker<T>>;

    private readonly workers = new Map<TaggedWorker<T>, WorkerStatus<T>>();
    /** create and initialize worker */
    private async initWorker(): Promise<WorkerStatus<T>> {
        const worker = await this.factory();
        const status = { worker, busy: true };
        this.workers.set(worker, status);
        try {
            await waitForWorkerReady(worker, this.options.workerInitTimeout);
            const onError = (ev: ErrorEvent): void => {
                // eslint-disable-next-line no-console
                console.error(`${this.options.name} worker error`, ev);

                worker.removeEventListener('error', onError);
                this.destroyWorker(worker);
                this.handlePendingBorrow();
            };
            worker.addEventListener('error', onError);
            status.busy = false;
            return status;
        } catch (ex) {
            this.destroyWorker(worker);
            this.handlePendingBorrow();
            throw ex;
        }
    }
    private cleanupScheduleId: ReturnType<typeof setTimeout> | null = null;
    /** Schedule cleanup of idle workers */
    private scheduleCleanup(): void {
        if (this.cleanupScheduleId != null) clearTimeout(this.cleanupScheduleId);

        const id = setTimeout(() => {
            if (this.cleanupScheduleId === id) this.cleanupScheduleId = null;
            if (this.pendingBorrow.length > 0) return;
            // destroy extra idle workers
            const idleWorkers = [...this.workers.values()].filter((w) => !w.busy).map((w) => w.worker);
            const minIdle = this.options.minIdleWorkers;
            if (idleWorkers.length <= minIdle) return;
            const numToDestroy = idleWorkers.length - minIdle;
            for (let i = 0; i < numToDestroy; i++) {
                const worker = idleWorkers[i]!;
                this.destroyWorker(worker);
            }
        }, this.options.idleWorkerTimeout);
        this.cleanupScheduleId = id;
    }

    /** return worker to pool */
    returnWorker(worker: TaggedWorker<T>): void {
        const status = this.workers.get(worker);
        if (status == null) {
            // Worker has been destroyed
            return;
        }
        status.busy = false;
        this.handlePendingBorrow();
        this.scheduleCleanup();
    }

    /** destroy worker and remove it from the pool */
    destroyWorker(worker: TaggedWorker<T>): void {
        this.workers.delete(worker);
        worker.terminate();
    }

    /** Get an idle worker */
    private getIdleWorker(): WorkerStatus<T> | null {
        for (const status of this.workers.values()) {
            if (!status.busy) {
                return status;
            }
        }
        return null;
    }

    /** Get or wait for an idle worker */
    async borrowWorker(): Promise<TaggedWorker<T>> {
        // try to find an idle worker
        const idleWorker = this.getIdleWorker();
        if (idleWorker != null) {
            idleWorker.busy = true;
            return idleWorker.worker;
        }
        // create a new worker if possible
        if (this.workers.size < this.options.maxWorkers) {
            const status = await this.initWorker();
            status.busy = true;
            return status.worker;
        }
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
                    const idle = this.getIdleWorker();
                    if (idle == null) break;
                    idle.busy = true;
                    this.pendingBorrow.shift()!(idle.worker);
                }
                while (this.pendingBorrow.length > 0 && this.workers.size < this.options.maxWorkers) {
                    const worker = await this.initWorker();
                    worker.busy = true;
                    this.pendingBorrow.shift()!(worker.worker);
                }
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.error(`${this.options.name} handlePendingBorrow error`, err);
            });
    }

    /** Call to a specific worker */
    async callWorker<const M extends keyof T & string>(
        worker: TaggedWorker<T>,
        method: M,
        args: Parameters<T[M]>,
        transfer?: Transferable[],
    ): Promise<unknown> {
        return await callWorker(worker, method, args, transfer);
    }

    /** Call to worker pool */
    async call<const M extends keyof T & string>(
        method: M,
        args: Parameters<T[M]>,
        transfer?: Transferable[],
    ): Promise<unknown> {
        const worker = await this.borrowWorker();
        try {
            return await callWorker(worker, method, args, transfer);
        } finally {
            this.returnWorker(worker);
        }
    }

    /** cleanup all workers */
    destroy(): void {
        for (const worker of this.workers.keys()) {
            worker.terminate();
        }
        this.workers.clear();
    }
    /** Dispose the worker pool */
    [Symbol.dispose](): void {
        this.destroy();
    }

    /** get current worker status */
    status(): { total: number; idle: number; busy: number } {
        let idle = 0;
        for (const status of this.workers.values()) {
            if (!status.busy) idle++;
        }
        return {
            total: this.workers.size,
            idle,
            busy: this.workers.size - idle,
        };
    }
}
