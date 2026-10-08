/** Host returns a successful empty introspection envelope plus a note when Agent is absent. */
export function summarizeOptional(logs: unknown, agents: unknown) {
  const stats = logs as { byLevel?: { error?: number; warn?: number } } | null
  const bindings = agents as { note?: string } | null
  return {
    errorLogs: stats?.byLevel ? stats.byLevel.error ?? 0 : null,
    warningLogs: stats?.byLevel ? stats.byLevel.warn ?? 0 : null,
    agentStatus: bindings === null ? 'unknown' as const
      : bindings.note?.includes('Agent runtime 未装配') ? 'unavailable' as const : 'available' as const,
  }
}
