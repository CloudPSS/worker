import { setTimeout } from 'node:timers/promises';
import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import { type WorkerAPI, WORKER_SOURCE } from './.helper.ts';

describe('should destroy pool correctly', () => {
    it('destroy while idle', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);
        await pool.call('sleep', [50]);
        expect(pool.status().total).toBe(1);
        pool.destroy();
        expect(pool.status().total).toBe(0);
    });

    it('destroy while initializing (factory)', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => setTimeout(200, WORKER_SOURCE));
        expect(pool.status().total).toBe(0);
        const init = pool.call('sleep', [100]);
        await setTimeout(50);
        expect(pool.status().initializing).toBe(1);
        pool.destroy();
        expect(pool.status().total).toBe(0);
        await expect(init).rejects.toThrow(`Worker pool ${pool.options.name} has been destroyed`);
    });

    it('destroy while initializing (wait for ready)', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(/* js */ `setTimeout(() => void 0, 200);`);
        expect(pool.status().total).toBe(0);
        const init = pool.call('sleep', [100]);
        await setTimeout(50);
        expect(pool.status().initializing).toBe(1);
        pool.destroy();
        expect(pool.status().total).toBe(0);
        await expect(init).rejects.toThrow(`Worker pool ${pool.options.name} has been destroyed`);
    });

    it('destroy while busy', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);
        const task = pool.call('sleep', [200]);
        expect(pool.status().total).toBe(1);
        await setTimeout(50);
        pool.destroy();
        expect(pool.status().total).toBe(0);
        await expect(task).rejects.toThrow(`Worker pool ${pool.options.name} has been destroyed`);
    });

    it('destroy while pending', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE, { maxWorkers: 1 });
        const task = pool.call('sleep', [200]);
        expect(pool.status().total).toBe(1);
        await setTimeout(50);
        const pending = pool.call('sleep', [100]);
        expect(pool.status().total).toBe(1);
        await setTimeout(50);
        pool.destroy();
        expect(pool.status().total).toBe(0);
        await expect(pending).rejects.toThrow(`Worker pool ${pool.options.name} has been destroyed`);
        await expect(task).rejects.toThrow(`Worker pool ${pool.options.name} has been destroyed`);
    });
});
