import { jest } from '@jest/globals';
import { WorkerPool } from '../../dist/pool/index.js';
import { kID } from '../../dist/pool/message.js';

class TestWorker extends EventTarget implements Worker {
    onmessage: Worker['onmessage'] = null;
    onmessageerror: Worker['onmessageerror'] = null;
    onerror: Worker['onerror'] = null;
    readonly postMessage =
        jest.fn<(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => void>();
    readonly terminate = jest.fn<Worker['terminate']>();

    ready(error?: Error): void {
        this.dispatchEvent(new MessageEvent('message', { data: { [kID]: -1, error } }));
    }

    fail(error: Error): void {
        this.dispatchEvent(Object.assign(new Event('error'), { message: error.message, error }));
    }
}

describe('worker initialization lifecycle', () => {
    const pools: WorkerPool[] = [];
    const createPool = (factory: () => Worker | Promise<Worker>, initTimeout = 100): WorkerPool => {
        const pool = new WorkerPool(factory, { maxWorkers: 1, initTimeout });
        pools.push(pool);
        return pool;
    };

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        for (const pool of pools.splice(0)) pool.destroy();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('terminates workers that time out before becoming ready', async () => {
        const worker = new TestWorker();
        const pool = createPool(() => worker, 10);
        const rejected = expect(pool.borrowWorker()).rejects.toThrow('Worker initialization timed out');

        await jest.advanceTimersByTimeAsync(10);
        await rejected;

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(pool.status().total).toBe(0);
    });

    it('terminates workers that report initialization errors', async () => {
        const worker = new TestWorker();
        const pool = createPool(() => worker);
        const error = new Error('initialization failed');
        const rejected = expect(pool.borrowWorker()).rejects.toBe(error);
        await jest.advanceTimersByTimeAsync(0);

        worker.ready(error);
        await rejected;

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(pool.status().total).toBe(0);
    });

    it('terminates workers when destroyed while waiting for readiness', async () => {
        const worker = new TestWorker();
        const pool = createPool(() => worker);
        const rejected = expect(pool.borrowWorker()).rejects.toThrow('has been destroyed');
        await jest.advanceTimersByTimeAsync(0);

        pool.destroy();
        await rejected;

        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('terminates workers returned by a factory after destruction', async () => {
        const worker = new TestWorker();
        const pool = createPool(() => new Promise((resolve) => setTimeout(() => resolve(worker), 10)));
        const rejected = expect(pool.borrowWorker()).rejects.toThrow('has been destroyed');

        pool.destroy();
        await jest.advanceTimersByTimeAsync(10);
        await rejected;

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(pool.status().total).toBe(0);
    });

    it.each(['factory', 'readiness'] as const)('serves queued borrowers after a %s failure', async (failure) => {
        const first = new TestWorker();
        const replacement = new TestWorker();
        const error = new Error('first worker failed');
        const factory = jest.fn<() => Worker | Promise<Worker>>().mockReturnValue(replacement);
        if (failure === 'factory') {
            factory.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(error), 10)));
        } else {
            factory.mockReturnValueOnce(first);
        }
        const pool = createPool(factory);
        const rejected = expect(pool.borrowWorker()).rejects.toBe(error);
        const resolved = jest.fn();
        const queuedRejected = jest.fn();
        void pool.borrowWorker().then(resolved, queuedRejected);
        await jest.advanceTimersByTimeAsync(1);

        if (failure === 'factory') {
            await jest.advanceTimersByTimeAsync(9);
        } else {
            first.ready(error);
        }
        await rejected;
        await jest.advanceTimersByTimeAsync(0);
        replacement.ready();
        await jest.advanceTimersByTimeAsync(0);

        expect(resolved).toHaveBeenCalledWith(replacement);
        expect(queuedRejected).not.toHaveBeenCalled();
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('rejects a queued borrower when replacement creation fails and serves the next one', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const worker = new TestWorker();
        const replacement = new TestWorker();
        const error = new Error('replacement factory failed');
        const factory = jest
            .fn<() => Worker>()
            .mockReturnValueOnce(worker)
            .mockImplementationOnce(() => {
                throw error;
            })
            .mockReturnValue(replacement);
        const pool = createPool(factory);
        const borrowed = pool.borrowWorker();
        await jest.advanceTimersByTimeAsync(0);
        worker.ready();
        await borrowed;

        const rejected = jest.fn();
        const resolved = jest.fn();
        const lastRejected = jest.fn();
        void pool.borrowWorker().then(undefined, rejected);
        void pool.borrowWorker().then(resolved, lastRejected);
        await jest.advanceTimersByTimeAsync(1);

        worker.fail(new Error('worker crashed'));
        await jest.advanceTimersByTimeAsync(0);
        replacement.ready();
        await jest.advanceTimersByTimeAsync(0);

        expect(rejected).toHaveBeenCalledWith(error);
        expect(resolved).toHaveBeenCalledWith(replacement);
        expect(lastRejected).not.toHaveBeenCalled();
        expect(factory).toHaveBeenCalledTimes(3);
        expect(console.error).not.toHaveBeenCalled();
    });
});
