/** Create error from ErrorEvent */
export function createErrorFromEvent(ev: ErrorEvent): Error {
    return new Error(`Worker error: ${ev.message}`, { cause: ev.error });
}

let _id = 1;
/** Acquire next sequence id */
export function nextId(): number {
    const id = _id;
    _id++;
    if (_id >= 0x7fff_ffff) _id = 1;
    return id;
}

/** Check if the input is a blob */
export function isBlob(input: unknown): input is Blob {
    if (typeof input != 'object' || input == null) {
        return false;
    }
    const blob = input as Blob;
    return typeof blob.size == 'number' && typeof blob.type == 'string' && typeof blob.text == 'function';
}

/** Check if the input is an URL */
export function isURL(input: unknown): input is URL {
    if (typeof input != 'object' || input == null) {
        return false;
    }
    return typeof (input as URL).href == 'string';
}
