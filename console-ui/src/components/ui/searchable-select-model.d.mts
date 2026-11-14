import type { ReactNode } from 'react'

export interface SearchableSelectOption {
  value: string
  label: ReactNode
  /** Heading the option is listed under; omitted for top-level choices such as 「未设置」. */
  group?: string
  /** Secondary line under the label (e.g. `model · account`). */
  description?: string
  /** Extra text the search box matches (the label is used when it is a string). */
  keywords?: string
  disabled?: boolean
}
export interface SearchableSelectGroup<T extends SearchableSelectOption = SearchableSelectOption> { group: string | null; options: T[] }
export function optionSearchText(option: SearchableSelectOption): string
export function optionMatches(option: SearchableSelectOption, query: string): boolean
export function groupSelectOptions<T extends SearchableSelectOption>(options: readonly T[], query?: string): SearchableSelectGroup<T>[]
export function navigableValues(grouped: readonly SearchableSelectGroup[]): string[]
