/** Sync or async return value */
export type MaybeAsync<T> = T | PromiseLike<T>;
/** Value or factory returning a value or a Promise of a value */
export type MaybeFactory<T> = T | (() => MaybeAsync<T>);

const kWorkerResult: unique symbol = Symbol.for('@cloudpss/worker:worker-result');
/**
 * Result of a worker function call with transferable objects
 */
export interface WorkerResult<R> {
    /** Marker to identify WorkerResult */
    readonly [kWorkerResult]: true;
    /** Result value */
    readonly result: R;
    /** Transferable objects */
    readonly transfer: readonly Transferable[];
}

/**
 * Create a {@link WorkerFunctionResult}
 */
export function WorkerResult<R>(result: R, transfer: readonly Transferable[] | null | undefined): WorkerResult<R> {
    return Object.freeze({
        __proto__: null,
        [kWorkerResult]: true,
        result,
        transfer: transfer ?? [],
    }) as WorkerResult<R>;
}

/**
 * Check if the input is a WorkerResult
 */
export function isWorkerResult<R>(value: unknown): value is WorkerResult<R> {
    if (value == null || typeof value != 'object') return false;
    return (value as Record<typeof kWorkerResult, unknown>)[kWorkerResult] === true;
}

/**
 * A function type that can be executed in a worker thread
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerFunction<A extends any[] = any[], R = any> = (...args: A) => MaybeAsync<R | WorkerResult<R>>;

/** Return type of a worker function wrapped in a Promise */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WorkerFunctionReturn<W> = W extends WorkerFunction<any, infer R> ? R : never;

/** Interface of a worker exposing functions of type WorkerFunction */
export type WorkerInterface<T extends Record<string, WorkerFunction> = Record<string, WorkerFunction>> =
    | null
    | {
          readonly [K in keyof T & string]: (...args: Parameters<T[K]>) => WorkerFunctionReturn<T[K]>;
      };

/** Method names of a worker interface */
export type WorkerMethods<T extends WorkerInterface> = {
    [K in keyof NonNullable<T> & string]: NonNullable<T>[K] extends WorkerFunction ? K : never;
}[keyof NonNullable<T> & string];

/** Method of a worker interface */
export type WorkerMethod<T extends WorkerInterface, M extends WorkerMethods<T>> = NonNullable<T>[M];
