import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import type { WorkerAPI } from './.helper.ts';

describe('should throw on invalid worker', () => {
    it(`worker throwing on initialization`, async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(/* js */ `throw new Error('init error');`, {
            name: 'init-error',
        });
        await expect(pool.call('echo', ['test'])).rejects.toThrow(`Worker initialization error: Error: init error`);
        pool.destroy();
    });
    it(`worker not calling notifyReady`, async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(/* js */ `setTimeout(() => void 0, 1_000_000);`, {
            name: 'no-ready',
            initTimeout: 100,
        });
        await expect(pool.call('echo', ['test'])).rejects.toThrow(`Worker initialization timed out after 100 ms`);
        pool.destroy();
    });
    it(`worker throwing on expose`, async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(
            /* js */ `
            import { expose } from ${JSON.stringify(import.meta.resolve('@cloudpss/worker/pool'))};
            expose(() => { throw new Error('expose error'); });
        `,
            { name: 'expose-error' },
        );
        await expect(pool.call('echo', ['test'])).rejects.toThrow(`expose error`);
        pool.destroy();
    });
});
