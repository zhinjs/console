import type { ConfigSource } from '../hooks/useConfigSource'
export interface SourceDraft { readonly source: string; readonly snapshot: ConfigSource }
export function editSourceDraft(previous: SourceDraft | null, snapshot: ConfigSource | null, source: string, locale?: 'zh-CN' | 'en'): SourceDraft
export function saveSourceDraft<T>(saveBound: (source: string, snapshot: ConfigSource) => Promise<T>, draft: SourceDraft | null, locale?: 'zh-CN' | 'en'): Promise<T>
