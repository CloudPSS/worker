import { expose, WorkerResult } from '../../../dist/pool/index.js';

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
    },
});
