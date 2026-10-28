import { translate } from '../i18n/locale.mjs'
export function validateAssistantJobs(body, locale = 'zh-CN') {
  const data = body?.data;
  if (body?.success !== true || !data || !Array.isArray(data.jobs) || typeof data.eventsActive !== 'boolean') throw new Error(translate(locale, "助手任务响应格式不正确。"));
  for (const job of data.jobs) {
    if (!job || typeof job.id !== 'string' || !job.id || typeof job.enabled !== 'boolean' || !job.state || typeof job.state !== 'object' || Array.isArray(job.state)) throw new Error(translate(locale, "助手任务字段格式不正确。"));
    if (job.label !== undefined && typeof job.label !== 'string' || job.createdAt !== undefined && (typeof job.createdAt !== 'number' || !Number.isFinite(job.createdAt)) || ['lastStatus','lastError'].some(key => job.state[key] !== undefined && typeof job.state[key] !== 'string') || job.state.nextRunAtMs !== undefined && (typeof job.state.nextRunAtMs !== 'number' || !Number.isFinite(job.state.nextRunAtMs))) throw new Error(translate(locale, "助手任务字段格式不正确。"));
  }
  return data;
}
export function filterAssistantJobs(jobs, query, status) {
  const term = query.trim().toLowerCase();
  return jobs.filter(job => (!term || `${job.label ?? ''} ${job.id}`.toLowerCase().includes(term)) && (status === 'all' || status === 'enabled' && job.enabled || status === 'paused' && !job.enabled || status === 'error' && job.state.lastStatus === 'error'));
}

export async function probeAssistantJobs(fetchJobs, locale = 'zh-CN') {
  try {
    const response = await fetchJobs()
    if (!response.ok) return false
    validateAssistantJobs(await response.json(), locale)
    return true
  } catch { return false }
}

const KNOWN_JOB_ERRORS = [
  [/endpoint not found/i, "发送目标的聊天账号不存在或已改名。请确认该账号仍在“聊天账号”中在线，或修改任务的发送目标。"],
  [/timeout|timed out/i, "执行超时。请检查模型服务与网络，稍后会按计划重试。"],
  [/rate limit|429/i, "模型服务限流。请降低频率或检查 Provider 额度。"],
  [/unauthori[sz]ed|401|invalid api key/i, "模型服务鉴权失败。请检查 Provider 的 API Key 配置。"],
]
/** Explains a raw job error in task terms; unknown errors return null and the raw text stays the message. */
export function explainJobError(error, locale = 'zh-CN') {
  if (typeof error !== 'string' || !error) return null
  const known = KNOWN_JOB_ERRORS.find(([pattern]) => pattern.test(error))
  return known ? translate(locale, known[1]) : null
}
