import { randomBytes } from 'node:crypto';
import ref from '@napi-ffi/ref-napi';
import { WorkerPool, type WorkerInterface } from '../../dist/pool/index.js';
import { type WorkerAPI, WORKER_SOURCE } from './.helper.ts';

const POOL = new WorkerPool<WorkerInterface<WorkerAPI>>(() => WORKER_SOURCE);

beforeEach(() => {
    POOL.destroy();
});
afterAll(() => {
    POOL.destroy();
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
