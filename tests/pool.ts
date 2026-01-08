import { WorkerPool } from '../dist/pool/pool.js';
import type { WorkerInterface } from '../dist/pool/worker.js';

const WORKER_SOURCE = /* js */ `
import { expose } from ${JSON.stringify(import.meta.resolve('@cloudpss/worker/pool'))};

expose({
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },
    echo(data) {
        return data;
    },
});
`;

type WorkerAPI = {
    sleep(ms: number): Promise<void>;
    echo<T>(data: T): T;
};

describe('should work with correct parallism', () => {
    const POOL = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);
    const MAX_WORKERS = POOL.options.maxWorkers;
    const MIN_IDLE = POOL.options.minIdleWorkers;

    beforeEach(() => {
        POOL.destroy();
    });
    afterAll(() => {
        POOL.destroy();
    });

    it('worker count', () => {
        expect(MAX_WORKERS).toBeGreaterThan(0);
    });

    it('run some tasks', async () => {
        await POOL.call('sleep', [100]);
        expect(POOL.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
        const data = Array.from({ length: MAX_WORKERS - 1 }, (_, i) => Math.random());
        const echo = Promise.all(data.map((d) => POOL.call('echo', [d])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 1, initializing: MIN_IDLE - 1, total: MIN_IDLE });
        for (const [i, v] of (await echo).entries()) {
            expect(v).toBe(data[i]);
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS - 1, busy: 0, initializing: 0, total: MAX_WORKERS - 1 });
    });

    it('run MAX_WORKERS tasks', async () => {
        const wait = Promise.all(Array.from({ length: MAX_WORKERS }, () => POOL.call('sleep', [10])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 0, initializing: MIN_IDLE, total: MIN_IDLE });
        for (const c of await wait) {
            expect(c).toBeUndefined();
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS, busy: 0, initializing: 0, total: MAX_WORKERS });
    });

    it('run over MAX_WORKERS tasks', async () => {
        const wait = Promise.all(Array.from({ length: MAX_WORKERS + 10 }, () => POOL.call('sleep', [10])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 0, initializing: MIN_IDLE, total: MIN_IDLE });
        for (const c of await wait) {
            expect(c).toBeUndefined();
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS, busy: 0, initializing: 0, total: MAX_WORKERS });
    });
});
