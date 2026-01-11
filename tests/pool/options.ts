import { createWorkerPoolOptions, type WorkerPoolOptions } from '../../dist/pool/options.js';

// tests/pool/options.test.ts

describe('createWorkerPoolOptions', () => {
    it('returns an options object from minimal input', () => {
        const options = createWorkerPoolOptions({});
        expect(options).toBeDefined();
        expect(typeof options).toBe('object');
    });

    it('uses sensible defaults when options is undefined', () => {
        const options = createWorkerPoolOptions(undefined);

        expect(options.name).toBe('worker-pool');
        expect(options.maxWorkers).toBeGreaterThan(0);
        expect(options.minIdleWorkers).toBeGreaterThanOrEqual(0);
        expect(options.minIdleWorkers).toBeLessThanOrEqual(options.maxWorkers);
        expect(options.idleTimeout).toBe(5000);
        expect(options.initTimeout).toBe(30000);
        expect(options.creationDelay).toBe(0);
        expect(options.workerOptions.name).toBe('worker-pool');
    });

    it('keeps provided values and workerOptions.name', () => {
        const workerOptions: WorkerOptions = { name: 'worker-name', type: 'module' };
        const options = createWorkerPoolOptions({
            name: 'custom-pool',
            maxWorkers: 10,
            minIdleWorkers: 3,
            idleTimeout: 1000,
            initTimeout: 2000,
            creationDelay: 50,
            workerOptions,
        });

        expect(options.name).toBe('custom-pool');
        expect(options.maxWorkers).toBe(10);
        expect(options.minIdleWorkers).toBe(3);
        expect(options.idleTimeout).toBe(1000);
        expect(options.initTimeout).toBe(2000);
        expect(options.creationDelay).toBe(50);
        // 使用新的对象，而不是直接复用传入的 workerOptions
        expect(options.workerOptions).not.toBe(workerOptions);
        // 不会覆盖已有的 name
        expect(options.workerOptions.name).toBe('worker-name');
    });

    it('sanitizes non-positive and non-finite maxWorkers and minIdleWorkers', () => {
        const options1 = createWorkerPoolOptions({ maxWorkers: 0, minIdleWorkers: -5 });
        expect(options1.maxWorkers).toBe(1);
        expect(options1.minIdleWorkers).toBe(0);

        const options2 = createWorkerPoolOptions({ maxWorkers: Number.POSITIVE_INFINITY, minIdleWorkers: Number.NaN });
        expect(options2.maxWorkers).toBe(1);
        expect(options2.minIdleWorkers).toBe(0);
    });

    it('caps minIdleWorkers to maxWorkers when larger', () => {
        const options = createWorkerPoolOptions({ maxWorkers: 2, minIdleWorkers: 10 });
        expect(options.maxWorkers).toBe(2);
        expect(options.minIdleWorkers).toBe(2);
    });

    it('normalizes invalid timeout and delay values', () => {
        const options = createWorkerPoolOptions({
            idleTimeout: Number.NaN,
            initTimeout: Number.NEGATIVE_INFINITY,
            creationDelay: -100,
        });

        expect(options.idleTimeout).toBe(0);
        expect(options.initTimeout).toBe(0);
        expect(options.creationDelay).toBe(0);
    });

    it('fills workerOptions.name from pool name when missing', () => {
        const options = createWorkerPoolOptions({ name: 'named-pool', workerOptions: {} });

        expect(options.name).toBe('named-pool');
        expect(options.workerOptions.name).toBe('named-pool');
    });
});
