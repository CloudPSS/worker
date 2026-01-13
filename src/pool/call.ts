import { isWorkerMessage, kID, type WorkerRequest, type WorkerResponse } from './message.js';
import { createErrorFromEvent, nextId } from './utils.js';

const MAX_COPY_OVERHEAD = 1024 * 16; // 16KB

/** Should make a slice of the underlying ArrayBuffer to avoid copying unused data */
function shouldCopyArrayBufferView(arg: ArrayBufferView): boolean {
    return arg.byteLength + MAX_COPY_OVERHEAD < arg.buffer.byteLength;
}

/** Make a slice of the underlying ArrayBuffer */
function copyArrayBufferView(arg: ArrayBufferView): ArrayBufferView {
    // WORKAROUND: Avoid OOM of chrome when copying large buffers
    const buffer = arg.buffer.slice(arg.byteOffset, arg.byteOffset + arg.byteLength);
    return new (arg.constructor as new (buffer: ArrayBufferLike) => typeof arg)(buffer);
}

/** Call to a specific worker */
export async function callWorker(
    worker: Worker,
    signal: AbortSignal | null,
    method: WorkerRequest['method'],
    args: WorkerRequest['args'],
    transfer?: Transferable[],
): Promise<unknown> {
    signal?.throwIfAborted();
    const id = nextId();
    const request: WorkerRequest = {
        [kID]: id,
        method,
        args,
    };
    if (transfer == null) {
        transfer = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (!ArrayBuffer.isView(arg) || !shouldCopyArrayBufferView(arg)) continue;
            const copied = copyArrayBufferView(arg);
            args[i] = copied;
            transfer.push(copied.buffer);
        }
    }
    return new Promise((resolve, reject) => {
        worker.postMessage(request, transfer);

        const onMessage = (ev: MessageEvent<WorkerResponse>): void => {
            if (!isWorkerMessage(ev.data)) {
                // ignore invalid message
                return;
            }
            const { [kID]: resId, result, error } = ev.data;
            if (resId !== id) return;
            cleanup();
            if (error != null) {
                reject(error);
            } else {
                resolve(result);
            }
        };
        const onError = (ev: ErrorEvent): void => {
            cleanup();
            reject(createErrorFromEvent(ev));
        };
        const onAbort = (): void => {
            cleanup();
            reject((signal?.reason as Error | null) ?? new Error('Operation aborted'));
        };
        const cleanup = (): void => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        signal?.addEventListener('abort', onAbort);
    });
}
