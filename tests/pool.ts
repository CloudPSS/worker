import { randomBytes } from 'node:crypto';
import ref from 'ref-napi';
import '../dist/pool/interfaces.js';
import { WorkerPool, type WorkerInterface } from '../dist/pool/index.js';

const WORKER_SOURCE = /* js */ `
import { expose } from ${JSON.stringify(import.meta.resolve('@cloudpss/worker/pool'))};

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
        return { result: data, transfer: [data.buffer] };
    }
});
`;

type WorkerAPI = {
    sleep<T = void>(ms: number, data?: T): Promise<T>;
    echo<T>(data: T): T;
    error(msg: unknown): never;
    transfer(data: Uint8Array<ArrayBuffer>): { result: Uint8Array<ArrayBuffer>; transfer: [ArrayBuffer] };
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
