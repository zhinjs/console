/**
 * 待确认的导入 (ADR 0060 §4.2): people lists and `ai.personalPrincipals` links named again in the
 * configuration wait for a global `iam.manage` holder to 「导入」 or 「忽略」 them one by one. RPC
 * names and the permission come from `@zhin.js/console-protocol`; nothing is granted until a
 * candidate is imported here.
 */
import { CHAT_ROLES_RPC, CHAT_ROLES_RPC_PERMISSIONS } from '@zhin.js/console-protocol'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { isUnsupportedRpcError } from '../utils/console-auth-model.mjs'
import { statusFromError } from '../components/status-state-model.mjs'
import { CHAT_ROLE_LABELS } from './chat-roles-model.mjs'
import { parseScopeKey, scopeHref } from './scope-tree.mjs'

export const CHAT_ROLE_IMPORTS_RPC = Object.freeze({ LIST: CHAT_ROLES_RPC.IMPORTS_LIST, RESOLVE: CHAT_ROLES_RPC.IMPORTS_RESOLVE })

/** `chat-roles.imports.*` need `iam.manage` — and only a **global** binding counts (imports may carry `owner`). */
export const CHAT_ROLE_IMPORTS_PERMISSION = CHAT_ROLES_RPC_PERMISSIONS[CHAT_ROLES_RPC.IMPORTS_LIST]

/** DOM id of the section on the global 角色 tab; the attention item's 「去处理」 lands on it. */
export const CHAT_ROLE_IMPORTS_ANCHOR = 'chat-role-imports'

/** Where 「去处理」 of `chat-roles.import-pending` goes: `/scope?tab=roles#chat-role-imports`. */
export function chatRoleImportsHref() {
  return `${scopeHref({}, 'roles')}#${CHAT_ROLE_IMPORTS_ANCHOR}`
}

/**
 * Whether the principal may list and resolve imports: a global `iam.manage` binding (or an
 * unrestricted session). Adapter / account bindings never count, whatever they cover.
 */
export function canResolveChatRoleImports(access) {
  return hasConsolePermission(CHAT_ROLE_IMPORTS_PERMISSION, access)
}

export function chatRoleImportsListRequest() {
  return { type: CHAT_ROLE_IMPORTS_RPC.LIST }
}

/** `chat-roles.imports.resolve` body for one candidate: `import` or `ignore`. */
export function chatRoleImportResolveRequest(decision, id) {
  if (decision !== 'import' && decision !== 'ignore') throw new Error(`Unsupported decision: ${decision}`)
  if (typeof id !== 'string' || !id) throw new Error('Missing candidate id')
  return { type: CHAT_ROLE_IMPORTS_RPC.RESOLVE, decision, id }
}

const text = value => typeof value === 'string' ? value.trim() : ''
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
const time = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const IMPORT_ROLES = Object.freeze(['owner', 'trusted'])
const IMPORT_LEVELS = Object.freeze(['global', 'adapter', 'endpoint'])

function readRoleCandidate(raw) {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const adapter = text(raw.adapter)
  const userId = text(raw.userId)
  const level = IMPORT_LEVELS.includes(raw.level) ? raw.level : null
  const role = IMPORT_ROLES.includes(raw.role) ? raw.role : null
  if (!id || !adapter || !userId || !level || !role) return null
  const key = level === 'global' ? '' : text(raw.key)
  const scope = parseScopeKey(key)
  if (!scope || scope.level !== level) return null
  return Object.freeze({
    kind: 'role', id, adapter, userId, level, key, role,
    ...(scope.endpoint ? { endpoint: scope.endpoint } : {}),
    ...(text(raw.source) ? { source: text(raw.source) } : {}),
    ...(time(raw.seenAt) !== null ? { seenAt: raw.seenAt } : {}),
  })
}

function readPersonalCandidate(raw) {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const consoleUserId = text(raw.consoleUserId)
  const adapter = text(raw.adapter)
  const userId = text(raw.userId)
  if (!id || !consoleUserId || !adapter || !userId) return null
  return Object.freeze({
    kind: 'personal', id, consoleUserId, adapter, userId,
    // ADR 0060 §4.1: personal link candidates are `ai.personalPrincipals` entries.
    source: 'ai.personalPrincipals',
    ...(time(raw.seenAt) !== null ? { seenAt: raw.seenAt } : {}),
  })
}

/**
 * `chat-roles.imports.list` reply → the candidates waiting for a decision: personal links first
 * (they unblock personal sessions), then role candidates; duplicates and malformed rows dropped.
 */
export function readChatRoleImports(payload) {
  const data = isRecord(payload) ? payload : {}
  const personal = Array.isArray(data.personalPending) ? data.personalPending.map(readPersonalCandidate).filter(Boolean) : []
  const roles = Array.isArray(data.pending) ? data.pending.map(readRoleCandidate).filter(Boolean) : []
  const seen = new Set()
  const rows = [...personal, ...roles].filter(row => !seen.has(row.id) && seen.add(row.id))
  return { rows, hasGlobalOwner: data.hasGlobalOwner === true }
}

/** `平台 · 账号 · 身份` of a candidate (the account only when the candidate names one). */
export function chatRoleImportIdentity(row) {
  return [row.adapter, row.endpoint, row.userId].filter(Boolean).join(' · ')
}

/** The Console user of a personal link: their name from `iam.users.list`, else `#<id prefix>`. */
export function consoleUserLabel(consoleUserId, users = []) {
  const user = users.find(item => item?.id === consoleUserId)
  const name = text(user?.displayName) || text(user?.username)
  return name || `#${String(consoleUserId).slice(0, 8)}`
}

function scopeLabel(row, t) {
  if (row.level === 'global') return t('全局')
  if (row.level === 'adapter') return t('适配器 {0}', [row.key])
  return t('账号 {0}', [row.key])
}

/**
 * What importing the candidate would do, in one line:
 * - personal link: `Console 用户 <name> → 平台 · 账号 · 身份`
 * - role: `平台 · 账号 · 身份 → 角色（全局 / 适配器 x / 账号 x/y）`
 */
export function chatRoleImportSummary(row, t, users = []) {
  if (row.kind === 'personal') return t('Console 用户 {0} → {1}', [consoleUserLabel(row.consoleUserId, users), chatRoleImportIdentity(row)])
  return t('{0} → {1}（{2}）', [chatRoleImportIdentity(row), t(CHAT_ROLE_LABELS[row.role]), scopeLabel(row, t)])
}

/** The consequence of 「导入」, stated plainly. */
export function chatRoleImportEffect(row, t) {
  if (row.kind === 'personal') return t('导入后，这位 Console 用户与这个聊天身份算作同一个人（个人会话归其所有）；不授予任何角色。')
  return t('导入后授予这个角色；已有相同或更高的角色时保持不变，导入不会降低或移除角色。')
}

/** `chat-roles.imports.resolve` reply, defensively. */
export function readChatRoleImportResolve(payload) {
  const data = isRecord(payload) ? payload : {}
  const status = ['imported', 'ignored', 'acknowledged', 'unchanged'].includes(data.status) ? data.status : 'imported'
  const result = ['written', 'upgraded', 'kept', 'memory', 'skipped'].includes(data.result) ? data.result : undefined
  const reason = ['simulated', 'unknown-adapter', 'owned-elsewhere'].includes(data.reason) ? data.reason : undefined
  return { status, ...(result ? { result } : {}), ...(reason ? { reason } : {}) }
}

/** Authored copy (displayed through i18n). */
export const CHAT_ROLE_IMPORT_COPY = Object.freeze({
  written: '已导入：授予了这个角色。',
  linked: '已导入：这位 Console 用户与这个聊天身份现在算作同一个人。',
  upgraded: '已导入：原来较低的角色已提升为这个角色。',
  kept: '已处理：已有相同或更高的角色，保持不变；导入不会降低或移除角色。',
  memory: '已导入，但项目没有关系型数据库：只保存在内存里，重启后不保留。',
  skipped: '没有导入：Host 跳过了这一条。',
  simulated: '没有导入：这是本地模拟适配器，发送者 ID 由客户端自行填写，不能据此授予。',
  'unknown-adapter': '没有导入：这个适配器当前没有加载。',
  'owned-elsewhere': '没有导入：这个聊天身份已经属于另一个人。',
  ignored: '已忽略：这一条不会导入。',
  unchanged: '没有变化：这一条已经处理过了。',
})

/** Which {@link CHAT_ROLE_IMPORT_COPY} line tells the truth about one resolve reply. */
export function chatRoleImportOutcomeCopy(reply, kind) {
  if (reply.status === 'ignored') return 'ignored'
  if (reply.status === 'unchanged') return 'unchanged'
  if (reply.result === 'skipped') return reply.reason ?? 'skipped'
  if (reply.result === 'kept') return 'kept'
  if (reply.result === 'upgraded') return 'upgraded'
  if (reply.result === 'memory') return 'memory'
  return kind === 'personal' ? 'linked' : 'written'
}

/** Whether a role took effect (so the receipt says when: from the next message). */
export function chatRoleImportGranted(reply, kind) {
  return kind === 'role' && reply.status === 'imported' && (reply.result === 'written' || reply.result === 'upgraded' || reply.result === 'memory' || reply.result === undefined)
}

/**
 * Read-only check after an unknown outcome: a resolved candidate leaves the pending list. Still
 * listed → the decision certainly did not land; gone → it did (how exactly is not re-readable).
 */
export function chatRoleImportResolved(rows, id) {
  return !rows.some(row => row.id === id)
}

/**
 * A Host before `chat-roles.imports.*` (Unknown RPC, unmapped, `unknown_rpc`, 404): the section
 * stays out of the way, no error banner.
 */
export function chatRoleImportsUnsupported(error) {
  const code = error?.details?.serverCode ?? error?.code
  if (code === 'unmapped' || code === 'unsupported' || code === 'unknown_rpc') return true
  if (error?.details?.httpStatus === 404 || error?.status === 404) return true
  return isUnsupportedRpcError(error) || statusFromError(error).kind === 'unsupported'
}
