import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import ref from '@napi-ffi/ref-napi';
import '../../dist/pool/interfaces.js';
import { WorkerPool, type WorkerResult, type WorkerInterface } from '../../dist/pool/index.js';
import '../../dist/polyfill.js';

const importUrl = (u: string) => JSON.stringify(import.meta.resolve(u));
const WORKER_SOURCE = /* js */ `
import { expose, WorkerResult } from ${importUrl('@cloudpss/worker/pool')};

expose({
    sleep(ms, data) {
        return new Promise((resolve) => setTimeout(() => resolve(data), ms));
    },
    echo(data) {
        return data;
    },
    error(e) {
        throw e;
    },
    transfer(data) {
        return WorkerResult(data, [data.buffer]);
    }
});
`;

type WorkerAPI = {
    sleep<T = void>(ms: number, data?: T): Promise<T>;
    echo<T>(data: T): T;
    error(msg: unknown): never;
    transfer(data: Uint8Array<ArrayBuffer>): WorkerResult<Uint8Array<ArrayBuffer>>;
};
const POOL = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);

beforeEach(() => {
    POOL.destroy();
});
afterAll(() => {
    POOL.destroy();
});

describe('should work with correct parallelism', () => {
    const MAX_WORKERS = POOL.options.maxWorkers;
    const MIN_IDLE = POOL.options.minIdleWorkers;

    it('worker count', () => {
        expect(MAX_WORKERS).toBeGreaterThan(0);
    });

    it('run some tasks', async () => {
        await POOL.call('sleep', [100]);
        expect(POOL.status()).toEqual({ idle: 1, busy: 0, initializing: 0, total: 1 });
        const data = Array.from({ length: MAX_WORKERS - 1 }, (_, i) => Math.random());
        const echo = Promise.all(data.map((d) => POOL.call('sleep', [100, d])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 1, initializing: MIN_IDLE - 1, total: MIN_IDLE });
        for (const [i, v] of (await echo).entries()) {
            expect(v).toBe(data[i]);
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS - 1, busy: 0, initializing: 0, total: MAX_WORKERS - 1 });
    });

    it('run MAX_WORKERS tasks', async () => {
        const wait = Promise.all(Array.from({ length: MAX_WORKERS }, () => POOL.call('sleep', [100])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 0, initializing: MIN_IDLE, total: MIN_IDLE });
        for (const c of await wait) {
            expect(c).toBeUndefined();
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS, busy: 0, initializing: 0, total: MAX_WORKERS });
    });

    it('run over MAX_WORKERS tasks', async () => {
        const wait = Promise.all(Array.from({ length: MAX_WORKERS + 10 }, () => POOL.call('sleep', [100])));
        expect(POOL.status()).toEqual({ idle: 0, busy: 0, initializing: MIN_IDLE, total: MIN_IDLE });
        for (const c of await wait) {
            expect(c).toBeUndefined();
        }
        expect(POOL.status()).toEqual({ idle: MAX_WORKERS, busy: 0, initializing: 0, total: MAX_WORKERS });
    });
});

describe('should handle errors correctly', () => {
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

describe('should copy data correctly', () => {
    const echo = async <T>(data: T): Promise<T> => {
        return (await POOL.call('echo', [data])) as T;
    };
    const echoTransfer = async <T>(data: T): Promise<T> => {
        return (await POOL.call('echo', [data], [])) as T;
    };
    it('copy ArrayBuffer of same length', async () => {
        const data = new Uint8Array(randomBytes(1024 * 64).buffer);
        const result = await echo(data);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).not.toBe(data);
        expect(result.buffer).not.toBe(data.buffer);
        expect(result).toEqual(data);
    });
    it('copy ArrayBuffer of slight larger length', async () => {
        const { buffer } = randomBytes(1024 * 64);
        const data = new Uint8Array(buffer, 1024 * 8, 1024 * 48);
        const result = await echo(data);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).not.toBe(data);
        expect(result.buffer).not.toBe(data.buffer);
        expect(result).toEqual(data);
        expect(result.buffer.byteLength).toBe(buffer.byteLength);
    });
    it('slice ArrayBuffer of larger length', async () => {
        const { buffer } = randomBytes(1024 * 128);
        const data = new Uint8Array(buffer, 1024 * 32, 1024 * 64);
        const result = await echo(data);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).not.toBe(data);
        expect(result.buffer).not.toBe(data.buffer);
        expect(result).toEqual(data);
        expect(result.buffer.byteLength).toBe(1024 * 64);
    });
    it('copy ArrayBuffer of larger length', async () => {
        const { buffer } = randomBytes(1024 * 128);
        const data = new Uint8Array(buffer, 1024 * 32, 1024 * 64);
        const result = await echoTransfer(data);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).not.toBe(data);
        expect(result.buffer).not.toBe(data.buffer);
        expect(result).toEqual(data);
        expect(result.buffer.byteLength).toBe(buffer.byteLength);
    });
});

describe('should transfer data correctly', () => {
    const DATA = new Uint8Array(randomBytes(1024 * 64).buffer);
    it('transfer from worker', async () => {
        const data = DATA.slice();
        const result = await POOL.call('transfer', [data]);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).not.toBe(data);
        expect(data.byteLength).toBe(DATA.byteLength);
        expect(result).toEqual(DATA);
    });

    it('transfer to worker', async () => {
        const data = DATA.slice();
        const addressBefore = ref.address(data as Buffer<ArrayBuffer>);
        const result = await POOL.call('echo', [data], [data.buffer]);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).not.toBe(data);
        expect(result).toEqual(DATA);
        expect(data.byteLength).toBe(0);
        const addressAfter = ref.address(result as Buffer<ArrayBuffer>);
        expect(addressBefore).not.toBe(addressAfter);
    });

    it('transfer both ways', async () => {
        const data = DATA.slice();
        const addressBefore = ref.address(data as Buffer<ArrayBuffer>);
        const result = await POOL.call('transfer', [data], [data.buffer]);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result).not.toBe(data);
        expect(result).toEqual(DATA);
        expect(data.byteLength).toBe(0);
        const addressAfter = ref.address(result as Buffer<ArrayBuffer>);
        expect(addressBefore).toBe(addressAfter);
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
            }, 10);
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
        await setTimeout(50);
        expect(pool.status()).toEqual({ idle: 0, busy: 0, initializing: 0, total: 0 });
        {
            const result = () => pool.call('sleep', [100, 'test']);
            await expect(result).rejects.toThrow(`Worker error: Error: unhandled error foo`);
        }
        expect(pool.status()).toEqual({ idle: 0, busy: 0, initializing: 0, total: 0 });
        pool.destroy();
    });
});

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
