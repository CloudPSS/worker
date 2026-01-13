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

function checkResult(result: Uint8Array<ArrayBuffer>, input: Uint8Array<ArrayBuffer>): void {
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).not.toBe(input);
    expect(result).toEqual(input);
    expect(result.buffer).not.toBe(input.buffer);
}

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
        checkResult(result, data);
    });
    it('copy ArrayBuffer of slight larger length', async () => {
        const { buffer } = randomBytes(1024 * 64);
        const data = new Uint8Array(buffer, 1024 * 8, 1024 * 48);
        const result = await echo(data);
        checkResult(result, data);
        expect(result.buffer.byteLength).toBe(buffer.byteLength);
    });
    it('slice ArrayBuffer of larger length', async () => {
        const { buffer } = randomBytes(1024 * 128);
        const data = new Uint8Array(buffer, 1024 * 32, 1024 * 64);
        const result = await echo(data);
        checkResult(result, data);
        expect(result.buffer.byteLength).toBe(1024 * 64);
    });
    it('copy ArrayBuffer of larger length', async () => {
        const { buffer } = randomBytes(1024 * 128);
        const data = new Uint8Array(buffer, 1024 * 32, 1024 * 64);
        const result = await echoTransfer(data);
        checkResult(result, data);
        expect(result.buffer.byteLength).toBe(buffer.byteLength);
    });
});

describe('should transfer data correctly', () => {
    const DATA = new Uint8Array(randomBytes(1024 * 64).buffer);
    it('transfer from worker', async () => {
        const data = DATA.slice();
        const result = await POOL.call('transfer', [data]);
        checkResult(result, DATA);
        // Source data should not be transferred
        expect(data.byteLength).toBe(DATA.byteLength);
    });

    it('transfer to worker', async () => {
        const data = DATA.slice();
        const addressBefore = ref.address(data as Buffer<ArrayBuffer>);
        const result = (await POOL.call('echo', [data], [data.buffer])) as Uint8Array<ArrayBuffer>;
        checkResult(result, DATA);
        // Source data should be transferred
        expect(data.byteLength).toBe(0);
        // Worker data should not be transferred
        const addressAfter = ref.address(result as Buffer<ArrayBuffer>);
        expect(addressBefore).not.toBe(addressAfter);
    });

    it('transfer both ways', async () => {
        const data = DATA.slice();
        const addressBefore = ref.address(data as Buffer<ArrayBuffer>);
        const result = await POOL.call('transfer', [data], [data.buffer]);
        checkResult(result, DATA);
        // Source data should be transferred
        expect(data.byteLength).toBe(0);
        // Worker data should be transferred back
        const addressAfter = ref.address(result as Buffer<ArrayBuffer>);
        expect(addressBefore).toBe(addressAfter);
    });
});
