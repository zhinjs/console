export type ReadState<T> = { data: T; loaded: boolean; loading: boolean; error: string | null };
export function createReadState<T>(data: T): ReadState<T>;
export function pendingRead<T>(state: ReadState<T>): ReadState<T>;
export function successfulRead<T>(data: T): ReadState<T>;
export function failedRead<T>(state: ReadState<T>, error: string): ReadState<T>;
