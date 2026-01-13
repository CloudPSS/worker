import {
    isMarkedAsUntransferable,
    type Transferable as NodeTransferable,
    type StructuredSerializeOptions as NodeStructuredSerializeOptions,
} from 'node:worker_threads';

/** Filter transferable array */
function filterTransferableArray(transfer: readonly Transferable[]): NodeTransferable[] {
    return transfer.filter((item): item is NodeTransferable => !isMarkedAsUntransferable(item));
}

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
