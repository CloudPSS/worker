import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import { type WorkerAPI, WORKER_SOURCE } from './.helper.ts';

describe('should accept different worker sources', () => {
    const dataUrl = new URL(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`);
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    const blobUrl = new URL(URL.createObjectURL(blob));
    afterAll(() => {
        URL.revokeObjectURL(blobUrl.href);
    });

    const checkPool = async (pool: WorkerPool<WorkerInterface<WorkerAPI>>) => {
        const result = await pool.call('echo', ['hello']);
        expect(result).toBe('hello');

        const batch = await Promise.all([1, 2, 3, 4, 5].map((i) => pool.call('sleep', [10 * i, i])));
        expect(batch).toEqual([1, 2, 3, 4, 5]);

        pool.destroy();
    };

    it('value of source code', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(WORKER_SOURCE);
        await checkPool(pool);
    });

    it('factory returning source code', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);
        await checkPool(pool);
    });

    it('value of blob', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(blob);
        await checkPool(pool);
    });

    it('factory returning blob', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => blob);
        await checkPool(pool);
    });

    it('value of Worker', () => {
        expect(
            // @ts-expect-error testing Worker value
            () => new WorkerPool<WorkerInterface<WorkerAPI>>(new Worker(dataUrl, { type: 'module' }), { name: 'test' }),
        ).toThrow(`Worker source of test is invalid`);
    });

    it('factory returning Worker', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => {
            return new Worker(dataUrl, { type: 'module' });
        });
        await checkPool(pool);
    });

    it('value of data URL', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(dataUrl);
        await checkPool(pool);
    });

    it('factory returning data URL', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => dataUrl);
        await checkPool(pool);
    });

    it('value of blob URL', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(blobUrl);
        await checkPool(pool);
    });

    it('factory returning blob URL', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => blobUrl);
        await checkPool(pool);
    });

    it('factory returning invalid blob URL', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(
            () => new URL('blob:http://invalid/00000000-0000-0000-0000-000000000000'),
        );
        await expect(pool.call('echo', ['test'])).rejects.toThrow(`Cannot resolve blob URL`);
    });

    it('factory returning invalid value', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(() => 123 as unknown as string, { name: 'invalid' });
        await expect(pool.call('echo', ['test'])).rejects.toThrow(`Worker factory of invalid returned invalid result`);
        pool.destroy();
    });

    it('factory throwing error', async () => {
        const pool = new WorkerPool<WorkerInterface<WorkerAPI>>(
            () => {
                throw new Error('factory error');
            },
            { name: 'factory-error' },
        );
        await expect(pool.call('echo', ['test'])).rejects.toThrow(`factory error`);
        pool.destroy();
    });
});
