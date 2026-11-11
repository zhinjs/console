export interface ConfiguredProject { id: string; name: string; description?: string; enabled: boolean }
export function projectsFromCatalog(catalog: unknown, locale?: 'zh-CN' | 'en'): ConfiguredProject[];
export function projectListView(projects: ConfiguredProject[] | null, error: string | null): 'loading' | 'error' | 'empty' | 'ready';
