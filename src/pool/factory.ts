import type { MaybeAsync } from './interfaces.js';
import { Worker as WorkerPolyfill } from '@cloudpss/worker/ponyfill';
import { isBlob, isURL } from './utils.js';

/** Source code of worker */
type WorkerSourceCode = string | Blob;

/** Source of a worker */
export type WorkerSource =
    // Factory function
    | (() => MaybeAsync<Worker | URL | WorkerSourceCode>)
    // URL
    | URL
    // Source code
    | WorkerSourceCode;

/** Worker factory */
type WorkerFactory = () => MaybeAsync<Worker>;

/** Create a worker from url */
async function createWorkerFromUrl(url: string | URL, options: WorkerOptions): Promise<WorkerFactory> {
    const urlStr = typeof url == 'string' ? url : url.href;
    if (urlStr.startsWith('blob:') && typeof process == 'object' && typeof process?.getBuiltinModule == 'function') {
        // Node.js environment with blob URL
        const { resolveObjectURL } = process.getBuiltinModule('node:buffer');
        const blob = resolveObjectURL(urlStr);
        if (blob == null) {
            throw new Error(`Cannot resolve blob URL: ${urlStr}`);
        }
        return await createWorkerFromSource(await blob.text(), options);
    }
    return () => new WorkerPolyfill(urlStr, options);
}

/** Create a worker from source code */
async function createWorkerFromSource(source: string | Blob, options: WorkerOptions): Promise<WorkerFactory> {
    const src = typeof source == 'string' ? source : await source.text();
    const dataUrl = `data:text/javascript,${encodeURIComponent(src)}`;
    return createWorkerFromUrl(dataUrl, options);
}

/** Create a worker factory */
export function createWorkerFactory(source: WorkerSource, options: WorkerOptions = {}): WorkerFactory {
    const name = options.name ?? `<anonymous>`;

    if (typeof source == 'function') {
        let factory: WorkerFactory | undefined;
        return async () => {
            if (factory != null) return await factory();
            const result = await source();
            if (typeof result == 'string' || isBlob(result)) {
                factory = await createWorkerFromSource(result, options);
            } else if (isURL(result)) {
                factory = await createWorkerFromUrl(result, options);
            } else if (result != null && typeof result == 'object') {
                return result;
            } else {
                throw new TypeError(`Worker factory of ${name} returned invalid result`);
            }
            return await factory();
        };
    }

    let factoryBuilder: Promise<WorkerFactory>;
    if (typeof source == 'string' || isBlob(source)) {
        factoryBuilder = createWorkerFromSource(source, options);
    } else if (isURL(source)) {
        factoryBuilder = createWorkerFromUrl(source, options);
    } else {
        source satisfies never;
        throw new TypeError(`Worker source of ${name} is invalid`);
    }
    let factory: WorkerFactory | undefined;
    return async () => {
        factory ??= await factoryBuilder;
        return await factory();
    };
}
