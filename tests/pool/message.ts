import { kID, isWorkerMessage } from '../../dist/pool/message.js';

describe('WorkerMessage', () => {
    it('is identified correctly', () => {
        expect(isWorkerMessage({ [kID]: 1 })).toBe(true);
        expect(isWorkerMessage({ [kID]: -1 })).toBe(true);
        expect(isWorkerMessage({})).toBe(false);
        expect(isWorkerMessage({ __proto__: null })).toBe(false);
        expect(isWorkerMessage({ __proto__: null, [kID]: 1 })).toBe(true);
        expect(isWorkerMessage(null)).toBe(false);
        expect(isWorkerMessage(1)).toBe(false);
        expect(isWorkerMessage({ id: 1 })).toBe(false);
    });

    it('can be transferred via postMessage', () => {
        const message = { [kID]: 42 };
        const clone = structuredClone(message);
        expect(isWorkerMessage(clone)).toBe(true);
        expect(clone[kID]).toBe(42);
    });
});
