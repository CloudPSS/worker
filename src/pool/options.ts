import { HARDWARE_CONCURRENCY } from '@cloudpss/worker/ponyfill';

/** Worker pool options */
export interface WorkerPoolOptions {
    /** Name of the worker pool. */
    name?: string;
    /**
     * Maximum number of workers in the pool.
     * @default navigator.hardwareConcurrency - 1
     */
    maxWorkers?: number;
    /**
     * Minimum number of idle workers to keep.
     * @default 1
     */
    minIdleWorkers?: number;
    /**
     * Milliseconds before extra idle workers are cleaned up. 0 disables cleanup.
     * @default 5000
     */
    idleTimeout?: number;
    /**
     * Milliseconds to wait for a worker to signal readiness before failing.
     * @default 30000
     */
    initTimeout?: number;
    /**
     * Delay before creating a new worker when the pool is already warm.
     * @default 0
     */
    creationDelay?: number;
    /**
     * Extra options passed to the underlying {@link Worker} constructor
     */
    workerOptions?: WorkerOptions;
}

/** Create options */
export function createWorkerPoolOptions(options: WorkerPoolOptions | undefined): Required<WorkerPoolOptions> {
    const name = String(options?.name ?? 'worker-pool');
    let maxWorkers = Math.trunc(options?.maxWorkers ?? HARDWARE_CONCURRENCY - 1);
    let minIdleWorkers = Math.trunc(options?.minIdleWorkers ?? 1);
    let idleTimeout = Number(options?.idleTimeout ?? 5000);
    let initTimeout = Number(options?.initTimeout ?? 30000);
    let creationDelay = Number(options?.creationDelay ?? 0);

    if (maxWorkers <= 0 || !Number.isFinite(maxWorkers)) {
        maxWorkers = 1;
    }
    if (minIdleWorkers < 0 || !Number.isFinite(minIdleWorkers)) {
        minIdleWorkers = 0;
    }
    if (minIdleWorkers > maxWorkers) {
        minIdleWorkers = maxWorkers;
    }
    if (!Number.isFinite(idleTimeout) || idleTimeout < 0) {
        idleTimeout = 0;
    }
    if (!Number.isFinite(initTimeout) || initTimeout < 0) {
        initTimeout = 0;
    }
    if (!Number.isFinite(creationDelay) || creationDelay < 0) {
        creationDelay = 0;
    }
    const workerOptions = { ...options?.workerOptions };
    if (!workerOptions.name) {
        workerOptions.name = name;
    }
    return {
        name,
        maxWorkers,
        minIdleWorkers,
        idleTimeout,
        initTimeout,
        creationDelay,
        workerOptions,
    };
}
