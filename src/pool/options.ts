import { HARDWARE_CONCURRENCY } from '@cloudpss/worker/ponyfill';

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
    /** Additional options for worker creation */
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
