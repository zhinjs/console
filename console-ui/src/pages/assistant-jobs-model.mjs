export function validateAssistantJobs(body) {
  const data = body?.data;
  if (body?.success !== true || !data || !Array.isArray(data.jobs) || typeof data.eventsActive !== 'boolean') throw new Error('助手任务响应格式不正确。');
  for (const job of data.jobs) {
    if (!job || typeof job.id !== 'string' || !job.id || typeof job.enabled !== 'boolean' || !job.state || typeof job.state !== 'object' || Array.isArray(job.state)) throw new Error('助手任务字段格式不正确。');
    if (job.label !== undefined && typeof job.label !== 'string' || job.createdAt !== undefined && (typeof job.createdAt !== 'number' || !Number.isFinite(job.createdAt)) || ['lastStatus','lastError'].some(key => job.state[key] !== undefined && typeof job.state[key] !== 'string') || job.state.nextRunAtMs !== undefined && (typeof job.state.nextRunAtMs !== 'number' || !Number.isFinite(job.state.nextRunAtMs))) throw new Error('助手任务字段格式不正确。');
  }
  return data;
}
export function filterAssistantJobs(jobs, query, status) {
  const term = query.trim().toLowerCase();
  return jobs.filter(job => (!term || `${job.label ?? ''} ${job.id}`.toLowerCase().includes(term)) && (status === 'all' || status === 'enabled' && job.enabled || status === 'paused' && !job.enabled || status === 'error' && job.state.lastStatus === 'error'));
}

export async function probeAssistantJobs(fetchJobs) {
  try {
    const response = await fetchJobs()
    if (!response.ok) return false
    validateAssistantJobs(await response.json())
    return true
  } catch { return false }
}
