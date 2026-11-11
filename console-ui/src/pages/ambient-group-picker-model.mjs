import { translate } from '../i18n/locale.mjs'
import { isPermissionDenied, parseGroupList } from './ambient-engagement-model.mjs'

/**
 * 群聊插话白名单的群选择器：把各在线账号的群列表（endpoint.groups）整理成按平台/账号分组的目录，
 * 选中后写入与 Host `enabledFor(platform, groupId)` 一致的「平台:群号」。
 */

const GROUP_ID_PATTERN = /^[^:\s]+:[^\s]+$/

function nonempty(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function firstLabel(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null) continue
    const text = String(candidate).trim()
    if (text) return text
  }
  return ''
}

/** endpoint.list → 在线状态与平台名；平台名优先取规范身份 `endpoint.adapter`（Host 用它匹配白名单）。 */
export function readGroupEndpoints(payload, locale = 'zh-CN') {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.endpoints)) {
    throw new Error(translate(locale, "账号列表格式不正确。"))
  }
  const endpoints = []
  for (const item of payload.endpoints) {
    if (!item || typeof item !== 'object') continue
    const adapter = nonempty(item.endpoint?.adapter) ? item.endpoint.adapter : item.adapter
    if (!nonempty(adapter) || !nonempty(item.name)) continue
    endpoints.push({ adapter, name: item.name, connected: item.connected === true })
  }
  return endpoints
}

/** 群号保持字符串：Slack/LINE 等平台的群号不是数字，大数字群号转成 Number 也会丢精度。 */
export function readGroupRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = firstLabel(raw.group_id, raw.groupId, raw.id)
  if (!id || /\s/.test(id) || id === '0') return null
  const name = firstLabel(raw.group_name, raw.groupName, raw.name, raw.title, raw.remark)
  return { id, name: name === id ? '' : name }
}

/**
 * results: 每个在线账号一项，`groups` 是 endpoint.groups 的原始返回，读取失败时为 `error`。
 * 返回分组目录和逐账号的失败原因；同一账号内按群号去重。
 */
export function buildGroupCatalog(results) {
  const sections = []
  const failures = []
  for (const result of results) {
    if (result.error !== undefined) {
      failures.push({ adapter: result.adapter, endpoint: result.endpoint, error: String(result.error) })
      continue
    }
    const seen = new Set()
    const groups = []
    for (const raw of Array.isArray(result.groups) ? result.groups : []) {
      const group = readGroupRecord(raw)
      if (!group) continue
      const value = `${result.adapter}:${group.id}`
      if (seen.has(value)) continue
      seen.add(value)
      groups.push({ value, id: group.id, name: group.name })
    }
    sections.push({ key: `${result.adapter}/${result.endpoint}`, adapter: result.adapter, endpoint: result.endpoint, groups })
  }
  return { sections, failures }
}

/** 按群名、群号、「平台:群号」或账号/平台名搜索；不区分大小写，没有匹配的分组不显示。 */
export function filterGroupCatalog(catalog, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return catalog.sections.filter((section) => section.groups.length > 0)
  const sections = []
  for (const section of catalog.sections) {
    const sectionMatches = section.adapter.toLowerCase().includes(needle) || section.endpoint.toLowerCase().includes(needle)
    const groups = sectionMatches
      ? section.groups
      : section.groups.filter((group) => [group.name, group.id, group.value].some((text) => text.toLowerCase().includes(needle)))
    if (groups.length > 0) sections.push({ ...section, groups })
  }
  return sections
}

/** 白名单里有、但读到的群列表里没有的项（群已退出、账号离线、读取失败或手动填写的）。 */
export function groupsOutsideCatalog(selected, catalog) {
  const known = new Set(catalog.sections.flatMap((section) => section.groups.map((group) => group.value)))
  return selected.filter((value) => !known.has(value))
}

/** 「平台:群号」→ 群名；同一个群出现在多个账号下时取第一个有名字的。 */
export function groupNamesFromCatalog(catalog) {
  const names = new Map()
  for (const section of catalog.sections) {
    for (const group of section.groups) {
      if (group.name && !names.has(group.value)) names.set(group.value, group.name)
    }
  }
  return names
}

export function toggleGroupSelection(selected, value) {
  return selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]
}

/** 手动补充：格式全部正确才加入，避免一半写进白名单一半丢掉。 */
export function addManualGroups(selected, text) {
  const entries = parseGroupList(text)
  const invalid = entries.filter((entry) => !GROUP_ID_PATTERN.test(entry))
  if (invalid.length > 0 || entries.length === 0) return { groups: selected, invalid }
  const groups = [...selected]
  for (const entry of entries) if (!groups.includes(entry)) groups.push(entry)
  return { groups, invalid: [] }
}

/**
 * 群列表区域只处于一种状态：读取中 / 无权限 / 读取失败 / 没有群 / 搜索无结果 / 可选择。
 * 读取失败（包括所有在线账号都失败）绝不显示成「没有群」。
 */
export function groupPickerView({ loading, error, catalog, query }) {
  if (error) return { kind: isPermissionDenied(error) ? 'denied' : 'error', error: String(error) }
  if (loading || !catalog) return { kind: 'loading' }
  const hasGroups = catalog.sections.some((section) => section.groups.length > 0)
  if (!hasGroups && catalog.failures.length > 0) {
    const denied = catalog.failures.every((failure) => isPermissionDenied(failure.error))
    return { kind: denied ? 'denied' : 'error', error: catalog.failures.map((failure) => failure.error).join('\n') }
  }
  if (!hasGroups) return { kind: 'empty', noOnlineAccount: catalog.sections.length === 0 }
  const sections = filterGroupCatalog(catalog, query)
  if (sections.length === 0) return { kind: 'no-match' }
  return { kind: 'ready', sections }
}
