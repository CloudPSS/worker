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
     * @default 0
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

/** Clamp value in range */
function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value) || value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

/** Clamp value in range */
function clampMin(value: number, min: number): number {
    if (!Number.isFinite(value) || value < min) {
        return min;
    }
    return value;
}

/** Create options */
export function createWorkerPoolOptions(options: WorkerPoolOptions | undefined): Required<WorkerPoolOptions> {
    const name = String(options?.name ?? 'worker-pool');
    let maxWorkers = Math.trunc(options?.maxWorkers ?? HARDWARE_CONCURRENCY - 1);
    let minIdleWorkers = Math.trunc(options?.minIdleWorkers ?? 0);
    let idleTimeout = Number(options?.idleTimeout ?? 5000);
    let initTimeout = Number(options?.initTimeout ?? 30000);
    let creationDelay = Number(options?.creationDelay ?? 0);

    maxWorkers = clampMin(maxWorkers, 1);
    minIdleWorkers = clamp(minIdleWorkers, 0, maxWorkers);
    idleTimeout = clampMin(idleTimeout, 0);
    initTimeout = clampMin(initTimeout, 0);
    creationDelay = clampMin(creationDelay, 0);

    const workerOptions = { ...options?.workerOptions };
    workerOptions.name ||= name;
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
