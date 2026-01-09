import type { MaybeAsync, MaybeFactory } from './interfaces.js';
import { Worker as WorkerPolyfill } from '@cloudpss/worker/ponyfill';

/** Source of a worker */
export type WorkerSource =
    // Factory function
    | (() => MaybeAsync<Worker | WorkerPolyfill>)
    // URL
    | MaybeFactory<URL>
    // Source code
    | MaybeFactory<string | Blob>;

/** Check if the input is a blob */
function isBlob(input: unknown): input is Blob {
    if (typeof input != 'object' || input == null) {
        return false;
    }
    const blob = input as Blob;
    return typeof blob.size == 'number' && typeof blob.type == 'string' && typeof blob.text == 'function';
}

/** Check if the input is an URL */
function isURL(input: unknown): input is URL {
    return typeof input == 'object' && input != null && typeof (input as URL).href == 'string';
}

/** Create a worker from url */
async function createWorkerFromUrl(url: string | URL, options: WorkerOptions): Promise<Worker> {
    const urlStr = typeof url == 'string' ? url : url.href;
    if (urlStr.startsWith('blob:') && typeof process == 'object' && typeof process?.getBuiltinModule == 'function') {
        // Node.js environment with blob URL
        const { resolveObjectURL } = process.getBuiltinModule('node:buffer');
        const blob = resolveObjectURL(urlStr);
        if (blob == null) {
            throw new Error(`Cannot resolve blob URL: ${urlStr}`);
        }
        return await createWorkerFromSource(blob, options);
    }
    return new WorkerPolyfill(urlStr, options) as Worker;
}

/** Create a worker from source code */
async function createWorkerFromSource(source: string | Blob, options: WorkerOptions): Promise<Worker> {
    if (typeof Buffer == 'function') {
        const src = typeof source == 'string' ? source : await source.text();
        const base64 = Buffer.from(src, 'utf8').toString('base64');
        const dataUrl = `data:text/javascript;base64,${base64}`;
        return createWorkerFromUrl(dataUrl, options);
    } else {
        const blob = typeof source == 'string' ? new Blob([source], { type: 'application/javascript' }) : source;
        const url = URL.createObjectURL(blob);
        try {
            return createWorkerFromUrl(url, options);
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }
}

/** Create a worker factory */
export function createWorkerFactory(source: WorkerSource, options: WorkerOptions = {}): () => MaybeAsync<Worker> {
    const name = options.name ?? `<anonymous>`;
    if (typeof source == 'function') {
        return async () => {
            const result = await source();
            if (typeof result == 'string' || isBlob(result)) {
                return await createWorkerFromSource(result, options);
            } else if (isURL(result)) {
                return await createWorkerFromUrl(result, options);
            } else if (result != null && typeof result == 'object') {
                return result as Worker;
            } else {
                throw new TypeError(`Worker factory of ${name} returned invalid result`);
            }
        };
    }
    if (typeof source == 'string' || isBlob(source)) {
        return async () => createWorkerFromSource(source, options);
    }
    if (isURL(source)) {
        return async () => createWorkerFromUrl(source, options);
    }
    source satisfies never;
    throw new TypeError(`Worker source of ${name} is invalid`);
}
