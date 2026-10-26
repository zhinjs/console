export function parseConfigDocument(source: string, format: 'yaml' | 'json', locale?: 'zh-CN' | 'en'): Record<string, unknown>
export function configAtPath(document: unknown, path: readonly string[] | undefined, locale?: 'zh-CN' | 'en'): unknown
export function replaceConfigAtPath(document: Record<string, unknown>, path: readonly string[] | undefined, value: unknown, locale?: 'zh-CN' | 'en'): Record<string, unknown>
export function configSourceForPlugin(source: string, format: 'yaml' | 'json', path: readonly string[] | undefined, value: unknown, locale?: 'zh-CN' | 'en'): string
