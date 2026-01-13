import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import { type WorkerAPI, WORKER_SOURCE } from './.helper.ts';

describe('should work with correct parallelism', () => {
    const POOL = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);
    const MAX_WORKERS = POOL.options.maxWorkers;

    beforeEach(() => {
        POOL.destroy();
    });
    afterAll(() => {
        POOL[Symbol.dispose]();
    });

    it('worker count', () => {
        expect(MAX_WORKERS).toBeGreaterThan(0);
    });

    it('run some tasks', async () => {
        await POOL.call('sleep', [100]);
        expect(POOL.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
        const data = Array.from({ length: MAX_WORKERS - 1 }, (_, i) => Math.random());
        const echo = Promise.all(data.map((d) => POOL.call('sleep', [100, d])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 1, initializing: 0, total: 1 });
        for (const [i, v] of (await echo).entries()) {
            expect(v).toBe(data[i]);
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS - 1, busy: 0, initializing: 0, total: MAX_WORKERS - 1 });
    });

    it('run MAX_WORKERS tasks', async () => {
        const wait = Promise.all(Array.from({ length: MAX_WORKERS }, () => POOL.call('sleep', [100])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 0, initializing: 1, total: 1 });
        for (const c of await wait) {
            expect(c).toBeUndefined();
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS, busy: 0, initializing: 0, total: MAX_WORKERS });
    });

    it('run over MAX_WORKERS tasks', async () => {
        const wait = Promise.all(Array.from({ length: MAX_WORKERS + 10 }, () => POOL.call('sleep', [100])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 0, initializing: 1, total: 1 });
        for (const c of await wait) {
            expect(c).toBeUndefined();
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS, busy: 0, initializing: 0, total: MAX_WORKERS });
    });
});
