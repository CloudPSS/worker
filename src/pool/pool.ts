import { isWorkerMessage, kID, type WorkerRequest, type WorkerResponse } from './message.js';
import type { MaybeAsync, WorkerInterface, WorkerMethod, WorkerMethods } from './interfaces.js';
import { createWorkerFactory, type WorkerSource } from './factory.js';
import { nextId } from './id.js';
import { waitForWorkerReady } from './ready.js';
import { createWorkerPoolOptions, type WorkerPoolOptions } from './options.js';

const MAX_COPY_OVERHEAD = 1024 * 16; // 16KB

/** Call to a specific worker */
async function callWorker(
    worker: Worker,
    signal: AbortSignal | null,
    method: WorkerRequest['method'],
    args: WorkerRequest['args'],
    transfer?: Transferable[],
): Promise<unknown> {
    signal?.throwIfAborted();
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

            // Make a slice of the underlying ArrayBuffer to avoid copying unused data
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
        const onAbort = (): void => {
            cleanup();
            reject((signal?.reason as Error) ?? new Error('Operation aborted'));
        };
        const cleanup = (): void => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        signal?.addEventListener('abort', onAbort);
    });
}

const kInfo: unique symbol = Symbol('@cloudpss/worker:worker-info');
/** Worker information */
interface WorkerInfo<T extends WorkerPool> {
    /** Unique tag of the worker pool */
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    tag: symbol & { __pool__?: T & never };
    /** Whether the worker is currently busy */
    busy: boolean;
    /** Abort controller to terminate the worker */
    controller: AbortController;
}
/** Tagged data */
type TaggedData<D extends object, T extends WorkerPool> = D & {
    [kInfo]: WorkerInfo<T>;
};
/** Tagged worker */
export type TaggedWorker<T extends WorkerPool = WorkerPool> = TaggedData<Worker, T>;

/** Worker pool */
export class WorkerPool<T extends WorkerInterface = WorkerInterface> implements Disposable {
    constructor(source: WorkerSource, options?: WorkerPoolOptions) {
        this.options = Object.freeze(createWorkerPoolOptions(options));
        const { name, workerOptions } = this.options;
        this.tag = Symbol(`@cloudpss/worker:pool:${name}`);
        this.factory = createWorkerFactory(source, workerOptions);
    }
    readonly options: Readonly<Required<WorkerPoolOptions>>;
    private readonly factory;
    private readonly tag: WorkerInfo<this>['tag'];
    private readonly initializingWorkers = new Set<TaggedData<Promise<TaggedWorker<this>>, this>>();
    private readonly workers = new Set<TaggedWorker<this>>();
    /** create and initialize worker */
    private async initWorker(info: WorkerInfo<this>, signal: AbortSignal): Promise<TaggedWorker<this>> {
        const worker = (await this.factory()) as TaggedWorker<this>;
        signal.throwIfAborted();
        worker[kInfo] = info;
        try {
            await waitForWorkerReady(worker, this.options.initTimeout, signal);
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
    /** Unschedule cleanup of idle workers */
    private unscheduleCleanup(): void {
        if (this.cleanupScheduleId != null) {
            clearTimeout(this.cleanupScheduleId);
            this.cleanupScheduleId = null;
        }
    }
    /** Schedule cleanup of idle workers */
    private scheduleCleanup(): void {
        if (this.options.idleTimeout <= 0) return;
        this.unscheduleCleanup();

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
    returnWorker(worker: TaggedWorker<this>): void {
        if (!this.workers.has(worker)) {
            // Worker has been destroyed
            return;
        }
        worker[kInfo].busy = false;
        this.handlePendingBorrow();
        this.scheduleCleanup();
    }

    /** destroy worker and remove it from the pool */
    destroyWorker(worker: TaggedWorker<this>): void {
        if (!this.workers.delete(worker)) {
            // Worker already removed
            return;
        }
        worker[kInfo].controller.abort(new Error(`Worker in pool ${this.options.name} has been destroyed`));
    }

    /** Get an idle worker */
    private findIdleWorker(): TaggedWorker<this> | null {
        for (const worker of this.workers) {
            if (worker[kInfo].busy) continue;
            worker[kInfo].busy = true;
            return worker;
        }
        return null;
    }

    /** Create a new worker if possible */
    private createWorker(): Promise<TaggedWorker<this>> | null {
        if (this.workers.size + this.initializingWorkers.size >= this.options.maxWorkers) {
            return null;
        }

        return (async () => {
            const controller = new AbortController();
            const info = {
                tag: this.tag,
                busy: true,
                controller,
            };
            const task = this.initWorker(info, controller.signal) as TaggedData<Promise<TaggedWorker<this>>, this>;
            task[kInfo] = info;
            this.initializingWorkers.add(task);
            let worker: TaggedWorker<this>;
            try {
                worker = await task;
            } finally {
                this.initializingWorkers.delete(task);
            }
            if (controller.signal.aborted) {
                worker.terminate();
                controller.signal.throwIfAborted();
            }
            controller.signal.addEventListener('abort', () => worker.terminate());
            this.workers.add(worker);
            return worker;
        })();
    }

    /** Get or wait for an idle worker */
    async borrowWorker(): Promise<TaggedWorker<this>> {
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

    private readonly pendingBorrow: Array<(worker: MaybeAsync<TaggedWorker<this>>) => void> = [];
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
        worker: TaggedWorker<this>,
        method: M,
        args: Parameters<WorkerMethod<T, M>>,
        transfer?: Transferable[],
    ): Promise<ReturnType<WorkerMethod<T, M>>> {
        const info = worker[kInfo];
        if (info == null) {
            throw new Error('Invalid tagged worker');
        }
        const result = await callWorker(worker, info.controller.signal, method, args, transfer);
        return result as Promise<ReturnType<WorkerMethod<T, M>>>;
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
        const reason = () => new Error(`Worker pool ${this.options.name} has been destroyed`);
        for (const worker of this.workers) {
            worker[kInfo].controller.abort(reason());
        }
        this.workers.clear();
        for (const task of this.initializingWorkers) {
            task[kInfo].controller.abort(reason());
        }
        this.initializingWorkers.clear();
        this.unscheduleCleanup();
        const pending = this.pendingBorrow.splice(0);
        for (const resolver of pending) {
            resolver(Promise.reject(reason()));
        }
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
