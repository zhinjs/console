import type { ConfigSource } from '../../hooks/useConfigSource.js'
export function createConfigDraftGuard(): { edited(): void; saved(): void; readonly dirty: boolean; readonly snapshot: ConfigSource | undefined; receive(key: string, value: unknown, sourceSnapshot?: ConfigSource): boolean };
