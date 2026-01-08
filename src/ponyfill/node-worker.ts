import { workerData, isMainThread } from 'node:worker_threads';

/** Data passed to worker threads */
export type WorkerData = {
    tag: typeof TAG;
    url: string;
};

export const TAG = '@cloudpss/worker:worker-data';
export const WORKER_URL = import.meta.url;

if (!isMainThread && (workerData as WorkerData)?.tag === TAG) {
    const { url } = workerData as WorkerData;
    import(url).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`Failed to load worker script: ${url}`, e);
        throw e;
    });
}
