export function validateRuns(data) {
  if (!data || typeof data.projectId !== 'string' || !Array.isArray(data.runs)) throw new Error('Workroom 列表响应格式不正确');
  for (const run of data.runs) {
    if (!run || typeof run.runId !== 'string' || run.projectId !== data.projectId || typeof run.status !== 'string' || !run.counts) throw new Error('Workroom 运行摘要格式不正确');
    for (const key of ['tasks', 'assignments', 'reviewerAssignments', 'sponsorGates']) if (!Number.isInteger(run.counts[key]) || run.counts[key] < 0) throw new Error('Workroom 运行计数格式不正确');
  }
}
export function validateDetail(run) {
  validateRuns({ projectId: run?.projectId, runs: [run] });
  for (const key of ['tasks', 'assignments', 'blockers']) if (!Array.isArray(run[key])) throw new Error('Workroom 详情响应缺少治理投影');
}
export function retainRunDetail(current, summaries) {
  return current && summaries.some(run => run.runId === current.runId && run.projectId === current.projectId) ? current : null;
}
export function runTotals(runs) {
  return runs.reduce((sum, run) => ({ activeRuns: sum.activeRuns + Number(['active', 'blocked', 'needs_replan', 'cancelling'].includes(run.status)), tasks: sum.tasks + run.counts.tasks, assignments: sum.assignments + run.counts.assignments, blocked: sum.blocked + Number(run.status === 'blocked') }), { activeRuns: 0, tasks: 0, assignments: 0, blocked: 0 });
}
