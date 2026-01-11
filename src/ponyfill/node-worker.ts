import { workerData, isMainThread } from 'node:worker_threads';

/** Data passed to worker threads */
export interface WorkerData {
    /** Tag to identify worker data */
    tag: typeof TAG;
    /** URL of the worker script to load */
    url: string;
}

export const TAG = '@cloudpss/worker:worker-data';
export const WORKER_URL = import.meta.url;

if (!isMainThread && (workerData as WorkerData)?.tag === TAG) {
    const { url } = workerData as WorkerData;
    import(url).catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error(`Failed to load worker script: ${url}`, e);
        throw e;
    });
}
