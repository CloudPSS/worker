import { expose } from '../../dist/pool/worker.js';

describe('expose', () => {
    it('should return void', () => {
        const fn = (a: number, b: number) => a + b;
        const exposedFn = expose({ fn });
        expect(exposedFn).toBeUndefined();
    });
});
