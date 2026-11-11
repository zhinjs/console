export interface DropTableOutcome<T> { result: T; refreshError: unknown | null }
export function dropThenRefresh<T>(drop: () => Promise<T>, refresh: () => Promise<unknown>): Promise<DropTableOutcome<T>>
export interface DroppedTables<T> { source: readonly T[]; names: readonly string[] }
export function withoutDroppedTables<T extends { name: string }>(tables: T[], dropped: DroppedTables<T> | null): T[]
