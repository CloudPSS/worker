import { setTimeout } from 'node:timers/promises';
import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import { type WorkerAPI, WORKER_SOURCE, importUrl } from './.helper.ts';

describe('should handle errors correctly', () => {
    const POOL = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);

    beforeEach(() => {
        POOL.destroy();
    });
    afterAll(() => {
        POOL.destroy();
    });

    it('error string', async () => {
        await expect(POOL.call('error', ['test error'])).rejects.toBe('test error');
        expect(POOL.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
    });
    it('error object', async () => {
        await expect(POOL.call('error', [{ code: 123 }])).rejects.toEqual({ code: 123 });
        expect(POOL.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
    });
    it('error Error', async () => {
        await expect(POOL.call('error', [new Error('custom error')])).rejects.toThrow(new Error('custom error'));
        expect(POOL.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
    });
});

describe('should work with complex worker', () => {
    it('ignore unknown messages', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(
            /* js */ `
            import { expose, WorkerResult } from ${importUrl('@cloudpss/worker/pool')};
            import { onMessage, postMessage } from ${importUrl('@cloudpss/worker/ponyfill')};
            import { kID } from ${importUrl('../../dist/pool/message.js')};
            
            postMessage({ foo: 'bar' });
            postMessage({ [kID]: -10 });
            onMessage((msg) => {
                postMessage({ foo: 'bar' });
                postMessage({ [kID]: -10 });
            });
            expose({
                echo(data) {
                    return data;
                }
            });
        `,
            { name: 'complex-worker' },
        );
        const result = await pool.call('echo', ['test']);
        expect(result).toBe('test');
        pool.destroy();
    });

    it('handle unhandled error in workers', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(
            /* js */ `
            import { expose } from ${importUrl('@cloudpss/worker/pool')};
            setTimeout(() => {
                throw new Error('unhandled error foo');
            }, 50);
            expose({
                sleep(ms, data) {
                    return new Promise((resolve) => setTimeout(() => resolve(data), ms));
                },
            });
        `,
            { name: 'error-worker' },
        );
        {
            const result = await pool.call('sleep', [0, 'test']);
            expect(result).toBe('test');
        }
        expect(pool.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
        await setTimeout(100);
        expect(pool.status()).toEqual({ idle: 0, busy: 0, initializing: 0, total: 0 });
        {
            const result = () => pool.call('sleep', [100, 'test']);
            await expect(result).rejects.toThrow(`Worker error: Error: unhandled error foo`);
        }
        expect(pool.status()).toEqual({ idle: 0, busy: 0, initializing: 0, total: 0 });
        pool.destroy();
    });
});
