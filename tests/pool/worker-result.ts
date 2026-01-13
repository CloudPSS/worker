import { WorkerResult, isWorkerResult } from '../../dist/pool/interfaces.js';

describe('WorkerResult', () => {
    it('has correct shape', () => {
        const result = WorkerResult(1, []);
        expect(isWorkerResult(result)).toBe(true);
        expect(result).toMatchObject({
            result: 1,
            transfer: [],
            [Symbol.for('@cloudpss/worker:worker-result')]: true,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.getPrototypeOf(result)).toBe(null);
    });

    it('handles null or undefined transfer', () => {
        const result1 = WorkerResult('test', null);
        const result2 = WorkerResult('test', undefined);
        expect(result1.transfer).toEqual([]);
        expect(result2.transfer).toEqual([]);
    });

    it('is identified correctly', () => {
        expect(isWorkerResult(WorkerResult('test', []))).toBe(true);
        expect(isWorkerResult({})).toBe(false);
        expect(isWorkerResult(1)).toBe(false);
        expect(isWorkerResult({ result: 1, transfer: [] })).toBe(false);
        expect(isWorkerResult({ [Symbol.for('@cloudpss/worker:worker-result')]: true, result: 1, transfer: [] })).toBe(
            true,
        );
    });
});
