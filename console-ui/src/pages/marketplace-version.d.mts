export function applyRegistryVersion<T extends { name: string; version: string; date: string }>(plugin: T, detail?: { name: string; version: string; lastPublish?: string }): T & { versionSource: 'index' | 'registry' }
export function belongsToZhinScope(name: unknown): boolean
