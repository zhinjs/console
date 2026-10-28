import { configSectionKeys } from './config-navigation.mjs'

const GENERAL = {
  locale: ['界面与语言', '设置机器人使用的语言。'],
  menuKeyword: ['菜单入口', '设置用户打开机器人菜单的关键词。'],
  menuStyle: ['菜单样式', '设置机器人菜单的展示方式。'],
  log_level: ['运行日志', '调整运行日志的详细程度。'],
  http: ['连接与访问', '管理 Console 和 HTTP 服务的连接与访问设置。'],
  database: ['数据存储', '管理机器人使用的数据库连接。'],
}
const BUILTIN = {
  ai: ['对话与执行', '调整 AI 启用状态、工具执行和排队方式。'],
  assistant: ['助手任务', '设置助手任务和主动服务。'],
  speech: ['语音', '管理语音识别和语音合成。'],
  htmlRenderer: ['图片渲染', '设置 HTML 内容转为图片的方式。'],
  mcp: ['MCP 服务', '配置 Host 提供的 MCP 服务。'],
  a2a: ['Agent 互联', '配置 Host 提供的 Agent 互联服务。'],
}
// Presentation groups over the existing ai owner; these do not add configuration
// keys or change runtime defaults. Unknown future Host fields stay in the fallback.
const AI_CAPABILITIES = [
  { id: 'config:ai', title: '对话与执行', description: '调整 AI 启用状态、工具执行和排队方式。', fieldNames: ['enabled', 'agent'] },
  { id: 'ai:sessions', title: '会话与上下文', description: '管理会话保存、历史内容和上下文使用。', fieldNames: ['sessions', 'context'] },
  { id: 'ai:memory', title: '记忆与知识', description: '管理机器人记忆和知识检索。', fieldNames: ['memory', 'knowledge'] },
  { id: 'ai:images', title: '图片与感知', description: '设置多模态识别、图片生成和图片存储。', fieldNames: ['multimodal', 'imageGeneration', 'imageStorage'] },
  { id: 'ai:services', title: '外部服务', description: '管理 Agent 使用的 MCP 和 GitHub 服务。', fieldNames: ['mcpServers', 'githubMcp'] },
  { id: 'ai:responses', title: '回复与访问', description: '设置机器人何时回复，以及谁可以使用 AI。', fieldNames: ['trigger', 'access'] },
  { id: 'ai:usage', title: '用量与审计', description: '管理 AI 用量限制和审计记录。', fieldNames: ['usage', 'audit'] },
  { id: 'ai:collaboration', title: '协作与决策', description: '设置 Workroom 协作和决策能力。', fieldNames: ['workroom', 'decisions'] },
]
const NAMED_AI_FIELDS = ['providers', 'agents', ...AI_CAPABILITIES.flatMap(entry => entry.fieldNames)]
const SECTIONS = {
  general: ['基础运行', 'general'],
  builtin: ['内置能力', 'builtin'],
  extensions: ['已安装与自定义', 'extensions'],
  unavailable: ['未识别配置', 'unavailable'],
}
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function configPath(configPaths, key) {
  const path = configPaths && Object.hasOwn(configPaths, key) ? configPaths[key] : undefined
  return Array.isArray(path) && path.length && path.every(part => typeof part === 'string' && part.length && !FORBIDDEN_PATH_KEYS.has(part))
    ? path : undefined
}

function configEntry(key, group, section, definition, writable) {
  return {
    id: `config:${encodeURIComponent(key)}`,
    configKey: key,
    group,
    section: SECTIONS[section][1],
    sectionTitle: SECTIONS[section][0],
    title: definition[0],
    description: definition[1],
    writable,
    builtin: section === 'general' || section === 'builtin',
  }
}

/** Presentation only: configPaths remain the Host's authority for all writes. */
export function buildSettingsCatalog(config, configKeys, configPaths) {
  const groups = [
    { id: 'general', title: '通用设置', description: '管理机器人的基础运行设置。', entries: [] },
    { id: 'models', title: '模型', description: '连接模型服务并管理可用模型。', entries: [] },
    { id: 'presets', title: 'Agent 预设', description: '组合模型、角色和能力，设置不同助手的工作方式。', entries: [] },
    { id: 'plugins', title: '插件配置', description: '按能力查看插件，需要调整时再打开具体设置。', entries: [] },
  ]
  const byGroup = Object.fromEntries(groups.map(group => [group.id, group]))
  const declared = new Set(configKeys)
  const instances = config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins)
    ? new Set(Object.keys(config.plugins)) : new Set()
  const keys = configSectionKeys(config, configKeys)

  for (const key of keys) {
    const path = configPath(configPaths, key)
    const writable = declared.has(key) && path !== undefined
    // Reserved Host names only describe Host settings when the Host supplies their
    // root path. An aliased/nested plugin keeps its own owner and config identity.
    const hostOwned = declared.has(key) && !instances.has(key) && path?.length === 1 && path[0] === key
    if (hostOwned && Object.hasOwn(GENERAL, key)) {
      byGroup.general.entries.push(configEntry(key, 'general', 'general', GENERAL[key], writable))
    } else if (hostOwned && Object.hasOwn(BUILTIN, key)) {
      const entry = configEntry(key, 'plugins', 'builtin', BUILTIN[key], writable)
      if (key === 'ai') {
        byGroup.models.entries.push({ ...entry, id: 'ai:providers', group: 'models', title: '模型服务',
          description: '设置模型服务商、连接凭据和可用模型。', fieldNames: ['providers'] })
        byGroup.presets.entries.push({ ...entry, id: 'ai:agents', group: 'presets', title: 'Agent 预设',
          description: '为已有 Agent 配置模型、名称与可用服务。', fieldNames: ['agents'] })
        byGroup.plugins.entries.push(...AI_CAPABILITIES.map(capability => ({ ...entry, ...capability,
          fieldNames: [...capability.fieldNames] })), { ...entry, id: 'ai:other', title: '其他 AI 设置',
          description: '查看当前 Host 提供的其他 AI 配置字段。', excludedFieldNames: [...NAMED_AI_FIELDS] })
      } else byGroup.plugins.entries.push(entry)
    } else {
      const section = declared.has(key) ? 'extensions' : 'unavailable'
      byGroup.plugins.entries.push(configEntry(key, 'plugins', section,
        key === 'plugin' ? ['项目插件', '管理当前项目根插件的业务设置。']
          : [key, section === 'unavailable' ? '已保存的配置项；Host 尚未提供可编辑路径。' : '查看此插件实例的配置。'], writable))
    }
  }

  const generalOrder = Object.keys(GENERAL)
  byGroup.general.entries.sort((a, b) => generalOrder.indexOf(a.configKey) - generalOrder.indexOf(b.configKey))
  const sectionOrder = ['builtin', 'extensions', 'unavailable']
  byGroup.plugins.entries.sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section)
    || (a.configKey < b.configKey ? -1 : a.configKey > b.configKey ? 1 : 0))
  return groups
}

/** Search labels and stable identities only; never inspect saved configuration values. */
export function filterSettingsCatalog(catalog, query) {
  const search = query.trim().toLocaleLowerCase()
  if (!search) return catalog
  return catalog.map(group => ({ ...group, entries: group.entries.filter(entry =>
    [group.title, entry.title, entry.description, entry.configKey, entry.sectionTitle]
      .some(value => value.toLocaleLowerCase().includes(search))) }))
}

/** Preserve existing config links while making group landing pages explicit. */
export function resolveSettingsSelection(selection, catalog) {
  const entryId = selection?.startsWith('plugin:') ? `config:${encodeURIComponent(selection.slice(7))}` : selection
  for (const group of catalog) {
    const entry = group.entries.find(candidate => candidate.id === entryId)
    if (entry) return { group: group.id, entry }
    if (group.id === selection) return { group: group.id,
      ...((group.id === 'models' || group.id === 'presets') && group.entries.length === 1 ? { entry: group.entries[0] } : {}) }
  }
  return { group: 'general' }
}
