import '../../dist/pool/interfaces.js';
import '../../dist/polyfill.js';
import type { WorkerResult } from '../../dist/pool/index.js';

export const importUrl = (u: string): `"${string}"` => JSON.stringify(import.meta.resolve(u)) as `"${string}"`;
export const WORKER_SOURCE = /* js */ `
import { expose, WorkerResult } from ${importUrl('@cloudpss/worker/pool')};

expose({
    sleep(ms, data) {
        return new Promise((resolve) => setTimeout(() => resolve(data), ms));
    },
    echo(data) {
        return data;
    },
    error(e) {
        throw e;
    },
    transfer(data) {
        return WorkerResult(data, [data.buffer]);
    }
});
`;

export type WorkerAPI = {
    sleep<T = void>(ms: number, data?: T): Promise<T>;
    echo<T>(data: T): T;
    error(msg: unknown): never;
    transfer(data: Uint8Array<ArrayBuffer>): WorkerResult<Uint8Array<ArrayBuffer>>;
};
