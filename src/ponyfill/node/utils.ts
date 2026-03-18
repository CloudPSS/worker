import type {
    Transferable as NodeTransferable,
    StructuredSerializeOptions as NodeStructuredSerializeOptions,
} from 'node:worker_threads';
import worker_threads from 'node:worker_threads';

const { isMarkedAsUntransferable } = worker_threads;

/** Filter transferable array */
const filterTransferableArray: (transfer: readonly Transferable[]) => NodeTransferable[] =
    typeof isMarkedAsUntransferable == 'function'
        ? (transfer: readonly Transferable[]) =>
              transfer.filter((item): item is NodeTransferable => !isMarkedAsUntransferable(item))
        : (transfer: readonly Transferable[]) => transfer as NodeTransferable[];

/** Filter out untransferable items */
export function filterNodeTransferable(
    transfer?: readonly Transferable[] | StructuredSerializeOptions,
): NodeStructuredSerializeOptions | undefined {
    if (transfer == null) return undefined;
    if (Array.isArray(transfer)) {
        const filtered = filterTransferableArray(transfer);
        return filtered.length ? { transfer: filtered } : undefined;
    }
    const options = transfer as StructuredSerializeOptions;
    if (options.transfer?.length) {
        const filtered = filterTransferableArray(options.transfer);
        options.transfer = filtered;
    }
    return options as NodeStructuredSerializeOptions;
}
