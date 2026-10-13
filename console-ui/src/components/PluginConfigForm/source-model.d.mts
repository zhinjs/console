export function parseConfigDocument(source: string, format: 'yaml' | 'json'): Record<string, unknown>
export function configAtPath(document: unknown, path: readonly string[] | undefined): unknown
export function replaceConfigAtPath(document: Record<string, unknown>, path: readonly string[] | undefined, value: unknown): Record<string, unknown>
export function configSourceForPlugin(source: string, format: 'yaml' | 'json', path: readonly string[] | undefined, value: unknown): string
