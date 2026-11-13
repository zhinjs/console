/**
 * What a save did to the running instance — one outcome per save, shown next to the action that
 * saved (ApplyFeedback, inside ActionReceipt or on its own):
 *
 *   applied       已生效            the Host reported the running instance uses the new value
 *   next-message  下一条消息生效    in-place layer (features.md#apply): no restart, read per message
 *   restart       需要重启          saved, the running instance keeps the old value until a restart
 *   failed        未生效 / 未确认生效 saved but not applied, or the Host could not confirm it (reason)
 *
 * The outcome is read from what the Host returned (`application` groups, `restartRequired`, the
 * gateway transaction) or from the documented apply table — never guessed from the action. A save
 * whose read-back differs from what was submitted is not an outcome at all: it is a mismatch
 * ({@link readBackMismatch}), shown instead of success.
 *
 * The restart that a `restart` outcome offers (立即重启) is tracked by {@link restartReducer}: sent →
 * waiting for the instance to come back (run facts changed, or seen down and answering again) →
 * 已重启并生效, or a timeout that says what to check. Pure: tests and components share it.
 */
import { configurationRuntimeStatus } from './PluginConfigForm/config-live-status.mjs'
import { instanceLifecycleApplied } from '../pages/ops/gateway-model.mjs'

export const APPLY_OUTCOME_KINDS = Object.freeze(['applied', 'next-message', 'restart', 'failed'])

/** Authored copy per outcome (displayed through i18n). */
export const APPLY_OUTCOME_COPY = Object.freeze({
  applied: Object.freeze({ title: '已生效', description: '运行中的实例已经在用新值。' }),
  'next-message': Object.freeze({ title: '下一条消息生效', description: '不需要重启：从下一条消息起读到新值。' }),
  restart: Object.freeze({ title: '需要重启', description: '已保存，但运行中的实例还在用旧值，重启后生效。' }),
  failed: Object.freeze({ title: '未生效', description: '已保存，但没有应用到运行中的实例。' }),
  unconfirmed: Object.freeze({ title: '未确认生效', description: '已保存，但 Host 没有确认运行中的实例是否已在用新值。' }),
  restarted: Object.freeze({ title: '已重启并生效', description: '实例已重新启动，重新读取的数据已更新。' }),
})

/** Where an outcome came from (shown as 依据 so nobody has to trust the Console's word). */
export const APPLY_BASIS_COPY = Object.freeze({
  application: 'Host 返回的生效明细',
  'restart-flag': 'Host 返回的 restartRequired',
  'apply-table': '功能覆盖原地生效（features.md「生效方式」）',
  'gateway-transaction': '网关启停事务已重启实例',
  unchanged: '内容没有变化',
  'env-file': '环境变量在实例启动时读取',
  restart: '实例已重启',
})

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function outcome(kind, basis, extra = {}) {
  return Object.freeze({ kind, basis, ...extra })
}

/**
 * A config-file save (`config:replace-source` / `config:patch` / `config:apply`). `revision` is the
 * revision the save produced (defaults to `result.revision`). Failed / blocked groups and their
 * reason codes ride along as `groups`.
 */
export function outcomeFromConfigSave(result, revision) {
  const rev = typeof revision === 'string' && revision ? revision : isRecord(result) && typeof result.revision === 'string' ? result.revision : undefined
  const state = configurationRuntimeStatus(result, rev)
  const groups = state.groups.filter(group => group.status !== 'applied')
    .map(group => Object.freeze({ id: group.id, status: group.status, ...(group.reasonCode ? { reasonCode: group.reasonCode } : {}) }))
  const statuses = new Set(state.groups.map(group => group.status))
  const withGroups = groups.length ? { groups: Object.freeze(groups) } : {}
  switch (state.kind) {
    case 'applied':
      return outcome('applied', 'application')
    case 'pending':
    case 'partial':
      if (statuses.has('failed') || statuses.has('blocked')) {
        return outcome('failed', 'application', { reason: statuses.has('failed') ? '有配置项应用失败。' : '有配置项依赖的条件尚未满足。', ...withGroups })
      }
      return outcome('restart', 'application', { ...(state.kind === 'partial' ? { partial: true } : {}), ...withGroups })
    case 'failed':
      return outcome('failed', 'application', { reason: result?.applicationError === 'invalid' ? '配置校验失败，没有应用到运行中的实例。' : '有配置项应用失败。', ...withGroups })
    case 'stale':
      return outcome('failed', 'application', { unconfirmed: true, reason: '这次生效申请已被更新的修订替代，请刷新后查看当前状态。' })
    case 'unknown':
      return outcome('failed', 'application', { unconfirmed: true, reason: 'Host 没有确认这次修改是否已应用，请只读刷新核对，不要重复提交。' })
    default:
      // A Host without the apply protocol only says whether a restart is needed.
      if (isRecord(result) && result.restartRequired === true) return outcome('restart', 'restart-flag')
      return outcome('failed', 'restart-flag', { unconfirmed: true, reason: 'Host 没有报告生效结果（需要新版 Host）。保存不代表已经生效。' })
  }
}

/**
 * A `feature.*` write at the adapter / account / conversation level. Overrides and the per-level
 * switch apply in place, read per message (features.md「生效方式」); a Host that still reports
 * `restartRequired` wins. `unchanged` means the stored value already was the effective one.
 */
export function outcomeFromFeatureWrite(result, level) {
  if (!isRecord(result)) return null
  if (result.status !== 'saved' && result.status !== 'unchanged') return null
  if (result.status === 'unchanged') return outcome('applied', 'unchanged')
  if (result.restartRequired === true) return outcome('restart', 'restart-flag')
  if (level === 'adapter' || level === 'endpoint' || level === 'conversation') return outcome('next-message', 'apply-table')
  return null
}

/**
 * The global plugin switch (gateway transaction, ADR 0054 §4). A success means the gateway already
 * restarted the instance with the new `disable_plugins` (`restartRequired: true` = restarted for it);
 * `unchanged` left it alone because it already was in that state.
 */
export function outcomeFromPluginSwitch(result) {
  if (!isRecord(result)) return null
  if (result.status === 'unchanged') return outcome('applied', 'unchanged')
  if (result.status !== 'saved' && result.success !== true) return null
  if (result.restartRequired === true) return outcome('applied', 'gateway-transaction')
  return outcome('failed', 'gateway-transaction', { unconfirmed: true, reason: '网关没有报告实例已为这次修改重启，请在「实例」页核对。' })
}

/** `env:save`: dotenv files are read when the instance starts (the page's documented contract). */
export function outcomeFromEnvSave() {
  return outcome('restart', 'env-file')
}

/** Title / description keys of an outcome (`unconfirmed` failures have their own copy). */
export function applyOutcomeCopy(value) {
  if (!value) return null
  if (value.kind === 'failed' && value.unconfirmed) return APPLY_OUTCOME_COPY.unconfirmed
  return APPLY_OUTCOME_COPY[value.kind] ?? null
}

/** Tone of an outcome surface. */
export function applyOutcomeTone(value) {
  if (!value) return 'muted'
  if (value.kind === 'applied' || value.kind === 'next-message') return 'success'
  if (value.kind === 'restart') return 'warning'
  return 'destructive'
}

// ---- read-back verification ----

const SECRET_NAME = /pass(?:word|wd)?|secret|token|api[-_]?key|private[-_]?key|credential|cookie|session[-_]?key|^key$/iu

/** Whether a key name looks like it holds a secret (masked in a mismatch). */
export function secretLikeKey(key) {
  return typeof key === 'string' && SECRET_NAME.test(key)
}

/** Stable JSON: object keys sorted, `undefined` members dropped (YAML / JSON round trips drop them too). */
export function canonicalJson(value) {
  return JSON.stringify(normalize(value))
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : normalize(item))
  if (isRecord(value)) {
    const out = {}
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = normalize(value[key])
    return out
  }
  return value
}

/** The first path where two values differ, or null when they are equal. */
export function firstDifference(left, right, path = []) {
  const a = normalize(left)
  const b = normalize(right)
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (isRecord(a) && isRecord(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const found = firstDifference(a[key], b[key], [...path, key])
      if (found) return found
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const found = firstDifference(a[index], b[index], [...path, String(index)])
      if (found) return found
    }
  }
  return { path, submitted: a, readBack: b }
}

export const MASKED_VALUE = '••••••'
const ABSENT = Symbol('absent')

function display(value, secret) {
  if (value === undefined || value === ABSENT) return null
  if (secret) return `${MASKED_VALUE} (${typeof value === 'string' ? value.length : canonicalJson(value).length})`
  const text = typeof value === 'string' ? JSON.stringify(value) : canonicalJson(value)
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

/**
 * Compares what was submitted with what a fresh read returned. Equal → null. Otherwise
 * `{ path, submitted, readBack }` with display text (null = absent); a value on a secret-looking path
 * (`isSecret(path)` or a key name like `token`, `password`) is masked, keeping only its length.
 */
export function readBackMismatch(submitted, readBack, { isSecret } = {}) {
  const found = firstDifference(submitted, readBack)
  if (!found) return null
  const secret = found.path.some(secretLikeKey) || (typeof isSecret === 'function' && isSecret(found.path) === true)
  return Object.freeze({
    path: found.path.join('.'),
    submitted: display(found.submitted, secret),
    readBack: display(found.readBack, secret),
    ...(secret ? { masked: true } : {}),
  })
}

// ---- restart progress ----

/** How long 立即重启 waits for the instance to come back before saying what to check. */
export const RESTART_TIMEOUT_MS = 90_000
/** How often the restart progress checks whether the instance is back. */
export const RESTART_POLL_MS = 2_000

export const IDLE_RESTART = Object.freeze({ phase: 'idle' })

/**
 * Whether one observation says the instance is answering again after the restart:
 * - with run facts (gateway `instance.status` before and now): the run changed (generation, pid or
 *   start time) and it is `running` — the strongest evidence;
 * - without them: it was seen down (a failed probe, the event stream dropped or a non-running state)
 *   and answers again.
 */
export function restartObservedBack(state, observation) {
  const status = observation?.status
  if (state?.before && status) {
    if (instanceLifecycleApplied('restart', state.before, status) === true && status.state === 'running') return true
  }
  const answering = observation?.probeOk === true && (!status || status.state === 'running')
  return Boolean(state?.sawDown) && answering
}

function observedDown(observation) {
  if (!observation) return false
  if (observation.probeOk === false || observation.connected === false) return true
  return Boolean(observation.status && observation.status.state !== 'running')
}

/**
 * Restart progress reducer. Events: `start { now }` · `sent { before? }` · `refused { error }` ·
 * `observe { status?, probeOk?, connected?, now }` · `tick { now }` · `keep-waiting { now }` · `dismiss`.
 * Phases: idle → requesting → waiting → back | timeout; `failed` when the restart was refused.
 */
export function restartReducer(state, event) {
  const current = state ?? IDLE_RESTART
  switch (event?.type) {
    case 'start':
      if (current.phase === 'requesting' || current.phase === 'waiting') return current
      return Object.freeze({ phase: 'requesting', startedAt: event.now ?? Date.now() })
    case 'sent':
      if (current.phase !== 'requesting') return current
      return Object.freeze({ phase: 'waiting', startedAt: current.startedAt, sawDown: false, ...(event.before ? { before: event.before } : {}) })
    case 'refused':
      if (current.phase !== 'requesting') return current
      return Object.freeze({ phase: 'failed', startedAt: current.startedAt, reason: typeof event.error === 'string' ? event.error : event.error instanceof Error ? event.error.message : String(event.error ?? '') })
    case 'observe': {
      if (current.phase !== 'waiting') return current
      const now = event.now ?? Date.now()
      const next = observedDown(event) && !current.sawDown ? { ...current, sawDown: true } : current
      if (restartObservedBack(next, event)) return Object.freeze({ phase: 'back', startedAt: current.startedAt, finishedAt: now })
      if (now - current.startedAt >= RESTART_TIMEOUT_MS) return Object.freeze({ phase: 'timeout', startedAt: current.startedAt, finishedAt: now, sawDown: next.sawDown, ...(current.before ? { before: current.before } : {}) })
      return next === current ? current : Object.freeze(next)
    }
    case 'tick': {
      const now = event.now ?? Date.now()
      if (current.phase === 'waiting' && now - current.startedAt >= RESTART_TIMEOUT_MS) {
        return Object.freeze({ phase: 'timeout', startedAt: current.startedAt, finishedAt: now, sawDown: current.sawDown, ...(current.before ? { before: current.before } : {}) })
      }
      return current
    }
    case 'keep-waiting':
      // Another full window after a timeout; what was seen so far still counts.
      if (current.phase !== 'timeout') return current
      return Object.freeze({ phase: 'waiting', startedAt: event.now ?? Date.now(), sawDown: Boolean(current.sawDown), ...(current.before ? { before: current.before } : {}) })
    case 'dismiss':
      if (current.phase === 'requesting' || current.phase === 'waiting') return current
      return IDLE_RESTART
    default:
      return current
  }
}

/** Whole seconds since the restart was requested (frozen once it settled). */
export function restartElapsedSeconds(state, now = Date.now()) {
  if (!state || state.phase === 'idle' || typeof state.startedAt !== 'number') return 0
  const end = typeof state.finishedAt === 'number' ? state.finishedAt : now
  return Math.max(0, Math.floor((end - state.startedAt) / 1000))
}

/** Whether the restart is still running (no new restart may start, the buttons stay busy). */
export function restartInProgress(state) {
  return state?.phase === 'requesting' || state?.phase === 'waiting'
}

/**
 * Whether a config schema marks the value at `path` (or one of its ancestors) secret. Walks
 * `object` / `properties` / `dict` members and `inner` / `items` / `additional` for maps and lists.
 */
export function schemaSecretAt(schema, path) {
  let node = schema
  if (node?.secret === true) return true
  for (const key of path ?? []) {
    if (!isRecord(node)) return false
    const members = isRecord(node.object) ? node.object : isRecord(node.properties) ? node.properties : isRecord(node.dict) ? node.dict : null
    node = members && Object.hasOwn(members, key) ? members[key]
      : isRecord(node.inner) ? node.inner : isRecord(node.items) ? node.items : isRecord(node.additional) ? node.additional : null
    if (node?.secret === true) return true
  }
  return false
}
