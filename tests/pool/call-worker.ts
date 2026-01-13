import { setTimeout } from 'node:timers/promises';
import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import { type WorkerAPI, WORKER_SOURCE } from './.helper.ts';

describe('should handle low-level calls correctly', () => {
    it('reject disowned worker', async () => {
        const pool1 = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);
        const pool2 = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);

        const worker = await pool1.borrowWorker();
        pool1.returnWorker(worker);

        // callWorker will not check whether the worker is borrowed or not,
        // but it will check whether the worker belongs to this pool.

        const call = await pool1.callWorker(worker, 'echo', ['test pool1']);
        expect(call).toBe('test pool1');

        await expect(pool2.callWorker(worker, 'echo', ['test pool2'])).rejects.toThrow('Invalid tagged worker');

        pool1.destroy();
        pool2.destroy();
    });
});
