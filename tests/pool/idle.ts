import { setTimeout } from 'node:timers/promises';
import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import { type WorkerAPI, WORKER_SOURCE } from './.helper.ts';

describe('should clear idle workers correctly', () => {
    it('idle timeout', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE, {
            name: 'idle-timeout-test',
            idleTimeout: 50,
        });
        await pool.call('sleep', [10]);
        expect(pool.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
        await setTimeout(100);
        expect(pool.status()).toEqual({ idle: 0, busy: 0, initializing: 0, total: 0 });
        pool.destroy();
    });
});
