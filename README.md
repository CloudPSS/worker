# @cloudpss/worker

[![check](https://img.shields.io/github/actions/workflow/status/CloudPSS/worker/check.yml?event=push&logo=github)](https://github.com/CloudPSS/worker/actions/workflows/check.yml)
[![Codacy coverage](https://img.shields.io/codacy/coverage/eb25a8bd05df4e0097d7289c80767ad6?logo=jest)](https://app.codacy.com/gh/CloudPSS/worker/dashboard)
[![Codacy Badge](https://img.shields.io/codacy/grade/eb25a8bd05df4e0097d7289c80767ad6?logo=codacy)](https://app.codacy.com/gh/CloudPSS/worker/dashboard)
[![npm version](https://img.shields.io/npm/v/@cloudpss/worker?logo=npm)](https://npmjs.org/package/@cloudpss/worker)

Provide WebWorker and Node Worker Threads wrapper with better usability. Include:

- WebWorker polyfill/ponyfill for Node.js environment.
- Worker thread pool implementation for both browser and Node.js environment.

## Installation

```bash
npm install @cloudpss/worker
```

## Usage

### Ponyfill (recommended inside workers)

In both Node.js and the browser you can use the ponyfill API instead of the global `Worker`:

```ts
// main.ts
import { Worker } from '@cloudpss/worker/ponyfill';

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.addEventListener('message', (ev) => {
  console.log('got from worker:', ev.data);
});

worker.postMessage({ hello: 'world' });
```

```ts
// worker.ts
import { onMessage, postMessage } from '@cloudpss/worker/ponyfill';

onMessage((value) => {
  // `value` is the `data` of the incoming MessageEvent
  postMessage({ echo: value });
});
```

### Polyfill global `Worker` in Node.js

If you prefer to use the standard `Worker` global in Node.js, import the polyfill once at startup:

```ts
import '@cloudpss/worker/polyfill';

// Now `Worker` is available on globalThis in Node.js
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
```

The worker code can still use the ponyfill helpers:

```ts
import { onMessage, postMessage } from '@cloudpss/worker/ponyfill';

onMessage((value) => {
  postMessage({ ok: true, value });
});
```

### Worker pool

The worker pool lets you run many small tasks on a set of shared workers with automatic scaling and cleanup.

Define the worker script and expose the API:

```ts
// pool-worker.ts
import { expose } from '@cloudpss/worker/pool';

export default expose({
  async sleep(ms: number, value?: unknown) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return value;
  },
  sum(...values: number[]) {
    return values.reduce((a, b) => a + b, 0);
  },
});
```

Create a pool and call the exposed methods from the main thread:

```ts
// main.ts
import { WorkerPool, type WorkerInterface } from '@cloudpss/worker/pool';
// Use import type to avoid runtime dependency
import type WorkerAPI from './pool-worker.js';

const pool = new WorkerPool<typeof WorkerAPI>(
  // Use a factory that creates a new Worker instance to make bundlers deal with it correctly
  () => new Worker(new URL('./pool-worker.js', import.meta.url)),
  {
    maxWorkers: 4,
  },
);

const result = await pool.call('sleep', [100, 'hello']);
console.log(result); // => 'hello'

// When you are done with the pool
pool.destroy();
```

## API

### Module `@cloudpss/worker/ponyfill`

- `class Worker extends EventTarget`
  - Compatible with the standard Web Worker API (`postMessage`, `terminate`, `message` / `messageerror` / `error` events).
  - Uses `worker_threads` under Node.js and the native `Worker` in the browser.
- `function onMessage(handler: (value: unknown) => unknown): void`
  - Helper for worker-side code. Subscribes to the `message` event and passes `event.data` to the handler.
- `function postMessage(value: unknown, transfer?: Transferable[]): void`
  - Worker-side helper that forwards to the underlying `postMessage` implementation.
- `const IS_WORKER_THREAD: boolean`
  - `true` when running inside a worker, `false` in the main thread.
- `const HARDWARE_CONCURRENCY: number`
  - Estimated number of hardware threads (`navigator.hardwareConcurrency` in browsers, `os.availableParallelism()` in Node.js).

### Module `@cloudpss/worker/polyfill`

- Side-effect-only module.
- Defines `globalThis.Worker` using the ponyfill implementation when it does not already exist (primarily for Node.js).

### Module `@cloudpss/worker/pool`

- `class WorkerPool<T extends WorkerInterface = WorkerInterface>`
  - `constructor(source: WorkerSource, options?: WorkerPoolOptions)`
    - `source`: JavaScript worker source, such as:
      - A string of worker code.
      - A `Blob` containing the code.
      - A `URL` (including `data:` or `blob:` URLs).
      - A factory function returning any of the above or an existing `Worker`/ponyfill `Worker`.
    - `options`: see `WorkerPoolOptions` below.
  - `call<M extends WorkerMethods<T>>(method: M, args: Parameters<WorkerMethod<T, M>>, transfer?: Transferable[])`
    - Enqueues a call to `method` on the pool and returns a `Promise` of the result.
  - `callWorker(...)`
    - Low-level variant that calls a specific `Worker` instance from the pool.
  - `status(): { total: number; idle: number; busy: number; initializing: number }`
    - Returns current pool statistics.
  - `destroy(): void`
    - Aborts all pending work, terminates all workers, and frees resources.

- `type WorkerFunction`
  - Signature of functions that can be exposed from a worker. May return a value, a `Promise`, or a `WorkerResult` to control transferable objects.
- `function WorkerResult<R>(result: R, transfer: Transferable[]): WorkerResult<R>`
  - Helper to create a `WorkerResult` object that wraps a result and a list of transferable objects.
- `type WorkerInterface<T>`
  - Maps a plain object of `WorkerFunction`s to a callable TypeScript interface used as the generic parameter of `WorkerPool`.
- `type WorkerMethods<T>` / `type WorkerMethod<T, M>`
  - Utility types that extract method names and signatures from a `WorkerInterface`.
- `interface WorkerPoolOptions`
  - `name?: string` – Name of the pool (used in error messages). Default: `'worker-pool'`.
  - `maxWorkers?: number` – Maximum number of workers in the pool. Default: `HARDWARE_CONCURRENCY - 1`, at least `1`.
  - `minIdleWorkers?: number` – Minimum number of idle workers to keep. Default: `1`.
  - `idleTimeout?: number` – Milliseconds before extra idle workers are cleaned up. `0` disables cleanup. Default: `5000`.
  - `initTimeout?: number` – Milliseconds to wait for a worker to signal readiness before failing. Default: `30000`.
  - `creationDelay?: number` – Delay before creating a new worker when the pool is already warm. Default: `0`.
  - `workerOptions?: WorkerOptions` – Extra options passed to the underlying `Worker` constructor (e.g. `type`, `name`).

- `function expose<T extends Record<string, WorkerFunction>>(worker: T | (() => T) | (() => PromiseLike<T>))`
  - Worker-side helper that exposes an object of functions to the main thread.
  - Must be called exactly once inside a worker; it automatically sets up message handling and calls `notifyReady()`.
- `function notifyReady(ready?: Promise<unknown>): void`
  - Low-level worker-side API. Manually notifies the main thread that initialization has completed (successfully or with an error).
- `function waitForWorkerReady(worker: Worker, timeout?: number, signal?: AbortSignal): Promise<void>`
  - Low-level main-thread API. Waits until the worker calls `notifyReady` or until `timeout`/`signal` aborts.

## License

MIT
