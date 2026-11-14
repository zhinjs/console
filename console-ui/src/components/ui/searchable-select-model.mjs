/**
 * Pure part of SearchableSelectField: which options a query keeps and how they are grouped.
 * Groups appear in the order their first option appears; ungrouped options (such as 「未设置」)
 * come first and are never filtered out, so clearing a choice stays one click away.
 */

const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase()

/** Text a query is matched against: explicit keywords, else a string label, plus value, description and group. */
export function optionSearchText(option) {
  const label = typeof option.label === 'string' ? option.label : ''
  return normalize([option.keywords ?? '', label, option.value, option.description ?? '', option.group ?? ''].join(' '))
}

/** Every whitespace-separated term must appear somewhere in the option's search text. */
export function optionMatches(option, query) {
  const terms = normalize(query).split(/\s+/u).filter(Boolean)
  if (!terms.length) return true
  const text = optionSearchText(option)
  return terms.every(term => text.includes(term))
}

/** `[{ group: string | null, options }]` for the options matching `query`; empty groups are dropped. */
export function groupSelectOptions(options, query = '') {
  const groups = new Map()
  const loose = []
  for (const option of options) {
    if (!option.group) {
      if (!query || option.value === '' || optionMatches(option, query)) loose.push(option)
      continue
    }
    if (!groups.has(option.group)) groups.set(option.group, [])
    if (optionMatches(option, query)) groups.get(option.group).push(option)
  }
  return [
    ...(loose.length ? [{ group: null, options: loose }] : []),
    ...[...groups].filter(([, items]) => items.length).map(([group, items]) => ({ group, options: items })),
  ]
}

/** Values in display order, for arrow-key movement (disabled options are skipped). */
export function navigableValues(grouped) {
  return grouped.flatMap(entry => entry.options.filter(option => !option.disabled).map(option => option.value))
}
