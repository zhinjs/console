/**
 * Which Agent runs a persistent schedule job (zhinjs/zhin#1250 第 52 批 `schedule-agent-no-creation-path`).
 *
 * `schedule:list` persistent rows carry `agent` (absent = the default Agent `zhin`) and
 * `agentMissing: true` when the named Agent is no longer configured; the reply carries `agents`
 * (the names a job may run on). Older Hosts send neither: the Agent field and the 「修改 Agent」 action
 * stay hidden, because such an engine only accepts the default. `cron:add` takes `agent`;
 * `cron:set-agent { id, agent }` changes it (`agent: null` = back to the default). Pure.
 */
import { translate } from '../i18n/locale.mjs'

export const DEFAULT_SCHEDULE_AGENT = 'zhin'

/** Id of the Assistant Profile heartbeat routine (`PROFILE_HEARTBEAT_JOB_ID` in `@zhin.js/agent`). */
const PROFILE_HEARTBEAT_JOB_ID = 'assistant-profile-heartbeat'

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The Agent names a Host reported (deduplicated, trimmed), or null when it reported none (older engine). */
export function scheduleAgentNames(agents) {
  if (!Array.isArray(agents)) return null
  const names = []
  for (const name of agents) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed && !names.includes(trimmed)) names.push(trimmed)
  }
  return names
}

/**
 * Dropdown options: `''` is 「zhin（默认）」 (sent as no Agent / `null`), then the other configured
 * Agents. A job's current Agent that is no longer configured stays visible, disabled, so the dropdown
 * never shows a value it has no option for. Null when the Host reported no Agents.
 */
export function scheduleAgentOptions(agents, locale = 'zh-CN', current) {
  const names = scheduleAgentNames(agents)
  if (!names) return null
  const options = [{ value: '', label: translate(locale, '{0}（默认）', [DEFAULT_SCHEDULE_AGENT]) }]
  for (const name of names) if (name !== DEFAULT_SCHEDULE_AGENT) options.push({ value: name, label: name })
  const selected = typeof current === 'string' ? current.trim() : ''
  if (selected && selected !== DEFAULT_SCHEDULE_AGENT && !names.includes(selected)) {
    options.push({ value: selected, label: translate(locale, '{0}（不存在）', [selected]), disabled: true })
  }
  return options
}

/** The dropdown value for a job: its Agent, or `''` for the default. */
export function scheduleAgentValue(job) {
  const agent = isRecord(job) && typeof job.agent === 'string' ? job.agent.trim() : ''
  return agent && agent !== DEFAULT_SCHEDULE_AGENT ? agent : ''
}

/** The RPC `agent` for a dropdown value: `null` for the default. */
export function scheduleAgentParam(value) {
  const agent = typeof value === 'string' ? value.trim() : ''
  return agent && agent !== DEFAULT_SCHEDULE_AGENT ? agent : null
}

/** `{ name, isDefault, missing, label }` of the Agent a job runs on. */
export function scheduleAgentView(job, locale = 'zh-CN') {
  const agent = isRecord(job) && typeof job.agent === 'string' ? job.agent.trim() : ''
  // An explicit `zhin` is the default Agent, as `scheduleAgentValue` / `scheduleAgentParam` treat it.
  const isDefault = !agent || agent === DEFAULT_SCHEDULE_AGENT
  const name = agent || DEFAULT_SCHEDULE_AGENT
  const missing = !isDefault && isRecord(job) && job.agentMissing === true
  return { name, isDefault, missing, label: isDefault ? translate(locale, '{0}（默认）', [DEFAULT_SCHEDULE_AGENT]) : name }
}

/** Whether a row is a heartbeat job (its runs are not Agent turns; it cannot name an Agent). */
export function isHeartbeatSchedule(job) {
  if (!isRecord(job)) return false
  if (job.id === PROFILE_HEARTBEAT_JOB_ID || job.kind === 'heartbeat') return true
  return isRecord(job.action) && job.action.kind === 'heartbeat'
}

/**
 * Why a job's Agent cannot be changed here, or null when it can:
 * `{ code: 'heartbeat' | 'profile', reason }`. The Host refuses both (`schedule_agent_heartbeat`,
 * `schedule_agent_profile`); the Console says so before anyone tries.
 */
export function scheduleAgentEditBlock(job, locale = 'zh-CN') {
  if (isHeartbeatSchedule(job)) return { code: 'heartbeat', reason: translate(locale, '心跳任务固定由默认 Agent 执行，不能指定 Agent。') }
  if (isRecord(job) && job.source === 'profile') {
    return { code: 'profile', reason: translate(locale, '这是 Profile 例程，每次启动按 Profile 重新声明。请在 Profile 文件（默认 assistant.profile.yml）中该例程的 agent 字段修改。') }
  }
  return null
}

/** `data.code` of a refused schedule RPC (`details.dataCode`, see `rpc-reply-capture.mjs`). */
export function scheduleRpcErrorCode(error) {
  const details = isRecord(error) && isRecord(error.details) ? error.details : null
  if (details && typeof details.dataCode === 'string' && details.dataCode) return details.dataCode
  if (details && typeof details.serverCode === 'string' && details.serverCode.startsWith('schedule_')) return details.serverCode
  return null
}

const errorText = error => isRecord(error) && typeof error.message === 'string' ? error.message : typeof error === 'string' ? error : ''

/**
 * Readable text for a refused `cron:add` / `cron:set-agent`, or null to show the Host's own message.
 * The Host words its errors in Chinese; the Console rewords the known refusals in the UI language and
 * keeps the account / Agent names they carry.
 */
export function scheduleAgentErrorMessage(error, locale = 'zh-CN') {
  const code = scheduleRpcErrorCode(error)
  const message = errorText(error)
  if (code === 'schedule_target_forbidden') {
    const account = /需要 (.+?) 上的 endpoint\.operate/u.exec(message)?.[1]
    // Without an account name the Host refused for another reason (e.g. the target names no account):
    // its own message says which, so show it as is.
    return account
      ? translate(locale, '没有向投递账号发送消息的权限：需要 {0} 上的 endpoint.operate。请让管理员授予该账号的这项权限。', [account])
      : null
  }
  if (code === 'schedule_agent_profile') return translate(locale, '这是 Profile 例程，每次启动按 Profile 重新声明。请在 Profile 文件（默认 assistant.profile.yml）中该例程的 agent 字段修改。')
  if (code === 'schedule_agent_heartbeat') return translate(locale, '心跳任务固定由默认 Agent 执行，不能指定 Agent。')
  if (code === 'unsupported') return translate(locale, '运行中的 Agent 包不支持修改任务的 Agent，请升级 zhin.js 后再试。')
  // `schedule_agent_not_found`: `Agent 不存在：<name>。可用的 Agent：a、b` (cron:add sends no code for it).
  const missing = /Agent 不存在：(.+?)。可用的 Agent：(.+)$/u.exec(message)
  if (code === 'schedule_agent_not_found' || missing) {
    return missing
      ? translate(locale, 'Agent「{0}」不存在，可用的 Agent：{1}。请刷新后重新选择。', [missing[1], missing[2].split('、').join(locale === 'en' ? ', ' : '、')])
      : translate(locale, '所选 Agent 不存在。请刷新后重新选择。')
  }
  return null
}
