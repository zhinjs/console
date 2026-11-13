import { LEGACY_ROUTE_REDIRECTS } from '../console-routes.mjs'

/**
 * Purpose text and search keywords for builtin Console pages.
 *
 * `description` is authored Chinese and displayed through i18n (English entries live in
 * messages.en.mjs). `keywords` are never displayed: they hold the words people search by
 * — synonyms, symptoms, English terms — in both languages, so a search matches in either
 * locale without a catalog entry per word.
 */
export const ROUTE_SEARCH_HINTS = Object.freeze({
  '/dashboard': { description: '机器人是否正常、有什么要处理', keywords: ['首页', '总览', '概览', '健康', '状态', '消息量', 'home', 'overview', 'health'] },
  '/attention': { description: '登录、离线账号、插件与配置问题、待审批：需要你动手的事项', keywords: ['需要处理', '待办', '提醒', '告警', '问题', '修复', '审批', 'attention', 'inbox', 'todo', 'issues', 'repairs'] },
  '/sandbox': { description: '与 Agent 对话并处理工作', keywords: ['对话', '聊天', '会话', '提问', 'chat', 'conversation'] },
  '/ops/schedules': { description: '管理员任务、定时提醒、助手任务与执行记录', keywords: ['任务', '定时', '提醒', '定时任务', 'cron', '计划', '助手任务', '执行记录', '待办', 'schedule', 'reminder', 'job'] },
  '/use-cases/group-welcome': { description: '一步步配置新成员入群欢迎并到真实群验证', keywords: ['欢迎', '新成员', '入群', '进群', '欢迎语', 'welcome', 'new member', 'onboarding'] },
  '/agent/workbench': { description: '看看 AI 机器人是否准备好、最近做了什么', keywords: ['机器人', 'AI', 'Agent', '就绪', '状态', '最近活动', 'bot', 'status', 'readiness'] },
  '/agent/replay': { description: '逐回合查看机器人为什么回或不回、调了哪些模型和工具', keywords: ['回放', '决策', '为什么没回', '为什么回复', '不回复', '排查', '回合', '调用过程', 'replay', 'decision', 'trace', 'debug'] },
  '/features/ai/ambient': { description: '没人 @ 机器人时，它要不要自己在群里接话', keywords: ['插话', '接话', '主动发言', '主动回复', '冒泡', '群聊', '没有 @', 'ambient', 'interject', 'proactive'] },
  '/features/ai/skills': { description: '让小助手帮机器人挑技能、挑工具、判断要不要接话', keywords: ['技能', '挑技能', '工具选择', '路由', '小助手', 'skill', 'skills', 'tool routing'] },
  '/agent/usage': { description: '按时间、模型和会话查看 token 花费与缓存命中', keywords: ['用量', '花费', '费用', '成本', '消耗', '账单', '缓存命中', 'token', 'usage', 'cost', 'billing', 'spend'] },
  '/features/ai': { description: '管理模型服务、账号密钥，以及各场景用哪个模型', keywords: ['模型', '大模型', '服务商', '密钥', 'API Key', '备用模型', '场景模型', 'LLM', 'provider', 'model', 'key'] },
  '/features/ai/workrooms': { description: '按 Project 查看 Workroom Run、Task 与 Assignment', keywords: ['协作', '协作空间', '多 Agent', '项目', 'workroom', 'project', 'run', 'assignment'] },
  '/features/ai/workrooms/catalog': { description: '配置协作空间、Bot Endpoint 与成员 Agent 映射', keywords: ['协作配置', '映射', '成员', 'workroom', 'catalog', 'mapping'] },
  '/agent/sessions': { description: '看看机器人和大家聊过什么，并从某段继续聊', keywords: ['聊天记录', '历史', '会话记录', '记录', '分支', '继续聊', 'history', 'sessions', 'transcript'] },
  '/scope': { description: '按全局、适配器、账号、会话查看接入、聊天、功能与角色', keywords: ['账号', '机器人账号', '平台', '适配器', '会话', '群', '登录', '扫码', '好友申请', '角色', '范围', 'endpoint', 'account', 'adapter', 'scope', 'conversation', 'qq'] },
  '/introspection': { description: '检查命令、中间件、组件、Endpoint、Agent、工具与 MCP', keywords: ['命令', '指令', '中间件', '组件', '工具', '能力', '自检', 'command', 'middleware', 'component', 'tool', 'mcp', 'capability'] },
  '/permissions': { description: '查看命令权限规则为什么匹配，可做假设检查', keywords: ['权限', '命令权限', '谁能用', '规则', '授权', '为什么不能用', 'permission', 'rbac', 'access'] },
  '/scenario-lab': { description: '预览插件的预期消息，并导出回归测试', keywords: ['场景', '试验台', '测试', '回归测试', '预览消息', '模拟', 'scenario', 'test', 'regression', 'preview'] },
  '/logs': { description: '查看出错、警告和运行过程', keywords: ['日志', '报错', '错误', '警告', '异常', '排查', 'log', 'logs', 'error', 'warning'] },
  '/plugins': { description: '查看已安装插件的来源、版本与健康状态，更新或卸载', keywords: ['插件', '插件管理', '已安装', '已装插件', '更新', '卸载', '健康状态', '启用', '停用', 'plugin', 'plugins', 'installed', 'update', 'uninstall', 'enable', 'disable'] },
  '/marketplace': { description: '找新功能并安装', keywords: ['市场', '插件市场', '安装', '下载', '新插件', 'marketplace', 'install', 'store'] },
  '/features': { description: '查看每个功能在全局和各适配器的启用状态', keywords: ['功能', '功能矩阵', '开关', '启用', '禁用', '全局配置', 'feature', 'features', 'matrix', 'toggle'] },
  '/ops/config': { description: '配置模型、Agent 和插件', keywords: ['设置', '配置', '选项', '配置文件', 'settings', 'config', 'configuration'] },
  '/ops/env': { description: '管理运行环境变量', keywords: ['环境变量', '变量', '密钥', '.env', 'env', 'environment', 'secret'] },
  '/ops/files': { description: '浏览和编辑项目文件', keywords: ['文件', '项目文件', '代码', '编辑', '目录', 'file', 'files', 'editor'] },
  '/ops/instance': { description: '查看实例状态与日志，启停实例，安装或更新依赖', keywords: ['实例', '重启', '启动', '停止', '依赖', '安装', '更新', '回滚', 'instance', 'restart', 'dependencies', 'install'] },
  '/ops/terminal': { description: '打开宿主机 Shell 或白名单 SSH 终端', keywords: ['终端', '命令行', 'Shell', 'SSH', '控制台', 'terminal', 'shell', 'ssh', 'console'] },
  '/ops/self-check': { description: '检查到 Host 的连接：地址、路径、WebSocket、事件流、时钟与登录', keywords: ['自检', '诊断', '连接', '代理', '反向代理', 'WebSocket', 'nginx', 'self-check', 'diagnostics', 'proxy', 'connection'] },
  '/ops/database': { description: '检查数据表、记录与持久化状态', keywords: ['数据库', '数据表', '表', '记录', '数据', 'database', 'db', 'sql', 'table'] },
  '/onboarding': { description: '接入 AI 和聊天平台，完成首次引导', keywords: ['引导', '开始使用', '初始化', '向导', '上手', 'onboarding', 'setup', 'getting started'] },
  '/account': { description: '修改密码、管理我的 API 令牌', keywords: ['个人设置', '我的账号', '密码', '修改密码', 'API 令牌', '令牌', 'account', 'password', 'token', 'profile'] },
  '/access/users': { description: '管理能登录 Console 的用户与角色绑定', keywords: ['用户', '账户', '成员', '密码', '禁用', 'user', 'users', 'account'] },
  '/access/roles': { description: '查看内置角色，创建自定义角色与权限', keywords: ['角色', '权限', '所有者', '管理员', 'role', 'roles', 'permission', 'rbac'] },
  '/access/tokens': { description: '查看并吊销所有用户的 API 令牌', keywords: ['令牌', 'API 令牌', '吊销', 'token', 'tokens', 'api key', 'revoke'] },
  '/access/audit': { description: '查看登录、权限变更与被拒绝的请求', keywords: ['审计', '日志', '登录记录', '安全', 'audit', 'log', 'security'] },
})

/** Legacy paths only redirect to another page; that page carries their keywords. */
export const COMMAND_EXCLUDED_PATHS = Object.freeze(Object.keys(LEGACY_ROUTE_REDIRECTS))

/**
 * Whether a registered route can be opened directly from the command palette.
 * Hidden routes are included: hiding only removes them from the navigation. Routes whose
 * path needs a value (`:name`, `*`) cannot be opened without one, legacy redirects would
 * duplicate their target, and a route may opt out with `meta.commandPalette: false`.
 */
export function isCommandRoute(route) {
  const path = route?.path
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  if (/[:*]/u.test(path)) return false
  if (COMMAND_EXCLUDED_PATHS.includes(path)) return false
  return route.meta?.commandPalette !== false
}

/** Relevance of a palette entry for the query; 0 hides it. Every query term must match somewhere. */
export function commandScore(target, rawQuery) {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return 1
  const title = target.title.toLocaleLowerCase()
  const path = target.path.toLocaleLowerCase()
  const group = target.group.toLocaleLowerCase()
  const description = target.description.toLocaleLowerCase()
  const keywords = (target.keywords ?? []).map((keyword) => keyword.toLocaleLowerCase())
  const terms = query.split(/\s+/u).filter(Boolean)
  const haystack = [title, path, group, description, ...keywords].join('\n')
  if (!terms.every((term) => haystack.includes(term))) return 0
  return terms.reduce((score, term) => {
    if (title === term) return score + 120
    if (title.startsWith(term)) return score + 90
    if (title.includes(term)) return score + 70
    if (keywords.includes(term)) return score + 60
    if (group.includes(term)) return score + 45
    if (keywords.some((keyword) => keyword.includes(term))) return score + 40
    if (description.includes(term)) return score + 35
    if (path.includes(term)) return score + 20
    return score
  }, 0)
}
