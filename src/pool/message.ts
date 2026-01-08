/** Unique key for message ID */
export const kID = `@cloudpss/worker\0id\0`;

/** Message format between main thread and worker */
export interface WorkerMessage {
    /** Unique ID of the message */
    [kID]: number;
}
/** Initialization message sent to main thread */
export interface WorkerInitializationMessage extends WorkerMessage {
    /** @inheritdoc */
    [kID]: -1;
    /** Initialization error */
    error?: Error | undefined;
}
/** Request message sent to worker */
export interface WorkerRequest extends WorkerMessage {
    /** Method name */
    method: string;
    /** Arguments */
    args: unknown[];
}
/** Response message sent to main thread */
export interface WorkerResponse extends WorkerMessage {
    /** Result data */
    result: unknown;
    /** Error */
    error?: Error | undefined;
}

/** Check if a message is a WorkerMessage */
export function isWorkerMessage(message: unknown): message is WorkerMessage {
    if (message == null || typeof message != 'object') return false;
    const msg = message as WorkerMessage;
    return typeof msg[kID] == 'number';
}
