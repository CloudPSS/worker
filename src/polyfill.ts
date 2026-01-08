import { Worker } from '@cloudpss/worker/ponyfill';

/** define global constant */
function define(name: string, value: unknown): void {
    if (name in globalThis) return;
    Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        enumerable: false,
        configurable: true,
    });
}

define('Worker', Worker);
