/** Sync or async return value */
export type MaybeAsync<T> = T | PromiseLike<T>;
/** Value or factory returning a value or a Promise of a value */
export type MaybeFactory<T> = T | (() => MaybeAsync<T>);

/**
 * A function type that can be executed in a worker thread
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerFunction<A extends any[] = any[], R = any> = (
    ...args: A
) => MaybeAsync<R> | MaybeAsync<{ result: R; transfer: Transferable[] }>;

/** Return type of a worker function wrapped in a Promise */
export type WorkerFunctionReturn<W> = W extends WorkerFunction<infer _, infer R> ? R : never;

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
