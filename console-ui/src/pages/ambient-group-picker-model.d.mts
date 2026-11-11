export interface GroupEndpoint { adapter: string; name: string; connected: boolean }
export interface GroupOption { value: string; id: string; name: string }
export interface GroupSection { key: string; adapter: string; endpoint: string; groups: GroupOption[] }
export interface GroupFailure { adapter: string; endpoint: string; error: string }
export interface GroupCatalog { sections: GroupSection[]; failures: GroupFailure[] }
export type GroupListResult = { adapter: string; endpoint: string; groups: unknown } | { adapter: string; endpoint: string; error: string }
export type GroupPickerView =
  | { kind: 'loading' }
  | { kind: 'denied' | 'error'; error: string }
  | { kind: 'empty'; noOnlineAccount: boolean }
  | { kind: 'no-match' }
  | { kind: 'ready'; sections: GroupSection[] }
export function readGroupEndpoints(payload: unknown, locale?: 'zh-CN' | 'en'): GroupEndpoint[]
export function readGroupRecord(raw: unknown): { id: string; name: string } | null
export function buildGroupCatalog(results: readonly GroupListResult[]): GroupCatalog
export function filterGroupCatalog(catalog: GroupCatalog, query: string): GroupSection[]
export function groupsOutsideCatalog(selected: readonly string[], catalog: GroupCatalog): string[]
export function groupNamesFromCatalog(catalog: GroupCatalog): Map<string, string>
export function toggleGroupSelection(selected: readonly string[], value: string): string[]
export function addManualGroups(selected: readonly string[], text: string): { groups: string[]; invalid: string[] }
export function groupPickerView(input: { loading: boolean; error: string | null; catalog: GroupCatalog | null; query: string }): GroupPickerView
