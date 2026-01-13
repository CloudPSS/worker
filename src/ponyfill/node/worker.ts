import { Worker as NodeWorker } from 'node:worker_threads';

const workerSource = /* js */ `import(process.getBuiltinModule('node:worker_threads').workerData);`;
const workerUrl = new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`);

/** Create node worker */
export function createNodeWorker(scriptURL: string | URL, options?: WorkerOptions): NodeWorker {
    if (typeof scriptURL == 'string') scriptURL = new URL(scriptURL);
    if (scriptURL.protocol !== 'file:') {
        // Use workerData to pass script URL since Node.js doesn't support non-file URLs
        return new NodeWorker(workerUrl, {
            name: options?.name,
            workerData: scriptURL.href,
        });
    }
    if (scriptURL.hash.length > 1 && typeof import.meta.resolve == 'function') {
        // Maybe created by `new URL('#import-path', import.meta.url)`
        try {
            const maybeImport = decodeURIComponent(scriptURL.hash.slice(1));
            const resolved = import.meta.resolve(`#${maybeImport}`, scriptURL);
            return new NodeWorker(new URL(resolved), options);
        } catch {
            // ignore
        }
    }
    return new NodeWorker(scriptURL, options);
}
