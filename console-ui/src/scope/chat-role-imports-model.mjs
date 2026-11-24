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

/**
 * Which bot account a candidate belongs to (#64 `import-card-missing-endpoint`): the same person under
 * two accounts otherwise reads the same on two cards. An account-level scope names it first (that is
 * what the grant targets); else an `endpoint` the reply carries (protocol 1.10 has none on candidates
 * yet); else a `<adapter>.endpoints[N]` configuration path gives where in the configuration the entry
 * came from (1-based) — provenance only: the grant's reach is still its scope (e.g. the whole adapter).
 */
function candidateAccount(raw, adapter, scopeEndpoint) {
  const endpoint = scopeEndpoint || text(raw.endpoint)
  if (endpoint) return { endpoint }
  const match = /^([^.[\]]+)\.endpoints\[(\d+)\]/u.exec(text(raw.source))
  return match && match[1] === adapter ? { configAccount: Number(match[2]) + 1 } : {}
}
const IMPORT_LEVELS = Object.freeze(['global', 'adapter', 'endpoint'])

/**
 * A role candidate. One the Console cannot read (unknown level / role, a scope key it cannot parse)
 * is kept as `unrecognized`: the Host resolves by id alone, so it can still be ignored.
 */
function readRoleCandidate(raw) {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  if (!id) return null
  const adapter = text(raw.adapter)
  const userId = text(raw.userId)
  const level = IMPORT_LEVELS.includes(raw.level) ? raw.level : null
  const role = IMPORT_ROLES.includes(raw.role) ? raw.role : null
  const key = level === 'global' ? '' : text(raw.key)
  const scope = level ? parseScopeKey(key) : null
  const common = {
    ...(text(raw.source) ? { source: text(raw.source) } : {}),
    ...(time(raw.seenAt) !== null ? { seenAt: raw.seenAt } : {}),
  }
  if (!adapter || !userId || !level || !role || !scope || scope.level !== level) {
    const rawKey = [text(raw.level), typeof raw.key === 'string' ? raw.key : '', adapter && userId ? `${adapter}/${userId}` : '', text(raw.role)].filter(Boolean).join(' ')
    return Object.freeze({ kind: 'unrecognized', id, rawKey, ...common })
  }
  return Object.freeze({
    kind: 'role', id, adapter, userId, level, key, role,
    ...candidateAccount(raw, adapter, scope.endpoint),
    ...common,
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
    ...(text(raw.endpoint) ? { endpoint: text(raw.endpoint) } : {}),
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

/** `平台 · 账号 <endpoint> · 身份` of a candidate (the account part only when it is known). */
export function chatRoleImportIdentity(row, t) {
  if (row.kind === 'unrecognized') return ''
  const account = row.endpoint ? t('账号 {0}', [row.endpoint])
    : row.configAccount ? t('来自配置第 {0} 个账号', [row.configAccount]) : ''
  return [row.adapter, account, row.userId].filter(Boolean).join(' · ')
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
  if (row.kind === 'unrecognized') return t('无法识别的条目')
  if (row.kind === 'personal') return t('Console 用户 {0} → {1}', [consoleUserLabel(row.consoleUserId, users), chatRoleImportIdentity(row, t)])
  return t('{0} → {1}（{2}）', [chatRoleImportIdentity(row, t), t(CHAT_ROLE_LABELS[row.role]), scopeLabel(row, t)])
}

/** The consequence of 「导入」, stated plainly. */
export function chatRoleImportEffect(row, t) {
  // Host wording (attention `chat-roles.import-pending`): a link lets that Console account speak as the person (Sandbox).
  if (row.kind === 'personal') return t('导入后，这个 Console 账号在 Sandbox 里可以以此人身份发言，个人会话也归其所有；不授予任何角色。')
  if (row.kind === 'unrecognized') return t('Console 读不懂这一条的范围或角色，只能忽略；要导入请先检查配置。')
  return t('导入后授予这个角色；已有相同或更高的角色时保持不变，导入不会降低或移除角色。')
}

/**
 * `chat-roles.imports.resolve` reply to an `import` / `ignore`. Anything else (an unknown status, an
 * import without a known result) throws: the receipt then says 结果未知 and only re-reads.
 */
export function readChatRoleImportResolve(payload) {
  const data = isRecord(payload) ? payload : {}
  if (data.status === 'ignored' || data.status === 'unchanged') return { status: data.status }
  if (data.status !== 'imported') throw new Error(`Unrecognized chat-roles.imports.resolve status: ${String(data.status)}`)
  if (!['written', 'upgraded', 'kept', 'memory', 'skipped'].includes(data.result)) throw new Error(`Unrecognized chat-roles.imports.resolve result: ${String(data.result)}`)
  const reason = ['simulated', 'unknown-adapter', 'owned-elsewhere'].includes(data.reason) ? data.reason : undefined
  return { status: 'imported', result: data.result, ...(reason ? { reason } : {}) }
}

/**
 * The candidate was already handled (the Host answers 404 「没有这个待确认的导入候选」): nothing to
 * refuse, the list is simply out of date.
 */
export function chatRoleImportAlreadyHandled(error) {
  const details = error?.details ?? {}
  return Number(details.httpStatus) === 404 || error?.status === 404
}

/** Authored copy (displayed through i18n). */
export const CHAT_ROLE_IMPORT_COPY = Object.freeze({
  written: '已导入：授予了这个角色。',
  linked: '已导入：这位 Console 用户与这个聊天身份现在算作同一个人。',
  upgraded: '已导入：原来较低的角色已提升为这个角色。',
  kept: '已处理：已有相同或更高的角色，保持不变；导入不会降低或移除角色。',
  memory: '已导入，但项目没有关系型数据库：只保存在内存里，重启后不保留。',
  // `skipped`: the Host still removes the candidate from the pending list (it cannot be imported here later).
  skipped: '没有导入：Host 跳过了这一条，它已移出待确认列表。',
  simulated: '没有导入：这是本地模拟适配器，发送者 ID 由客户端自行填写，不能据此授予。这一条已移出待确认列表。',
  'unknown-adapter': '没有导入：这个适配器当前没有加载。这一条已移出待确认列表；要导入，请在适配器加载后到聊天角色里手动授予。',
  'owned-elsewhere': '没有导入：这个聊天身份已经属于另一个人。这一条已移出待确认列表；要改关联，请到「聊天成员」里调整。',
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
  return kind === 'role' && reply.status === 'imported' && (reply.result === 'written' || reply.result === 'upgraded' || reply.result === 'memory')
}

/** `skipped`: resolved (gone from the list) but nothing imported — the receipt shows it as partial, not done. */
export function chatRoleImportSkipped(reply) {
  return reply.status === 'imported' && reply.result === 'skipped'
}

/** Personal links (speak as the person in Sandbox) and `owner` grants are confirmed twice. */
export function chatRoleImportDanger(row, decision) {
  return decision === 'import' && (row.kind === 'personal' || (row.kind === 'role' && row.role === 'owner'))
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
