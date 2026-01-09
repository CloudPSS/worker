let _id = 1;
/** Acquire next sequence id */
export function nextId(): number {
    const id = _id;
    _id++;
    if (_id >= 0x7fff_ffff) _id = 1;
    return id;
}
