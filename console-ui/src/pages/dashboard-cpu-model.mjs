// Host `/api/system/status` exposes `cpu` as the cumulative `process.cpuUsage()`
// (microseconds) and `uptime` as `process.uptime()` (seconds). A usage percentage
// is the CPU time spent between two samples divided by the wall time between them.

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Reads a CPU sample from a system status payload; `null` when the Host omits CPU data. */
export function readCpuSample(status) {
  if (!status || typeof status !== 'object') return null
  const cpu = status.cpu
  if (!cpu || typeof cpu !== 'object') return null
  if (!finite(cpu.user) || !finite(cpu.system) || cpu.user < 0 || cpu.system < 0) return null
  if (!finite(status.uptime) || status.uptime < 0) return null
  return {
    cpuMicros: cpu.user + cpu.system,
    uptimeSeconds: status.uptime,
    pid: finite(status.pid) ? status.pid : null,
  }
}

/**
 * Process CPU usage between two samples, as a percentage of one core (like `top`):
 * values above 100 mean several cores were busy. `null` when the samples cannot be
 * compared — no previous sample, Host restarted, or no wall time elapsed.
 */
export function cpuUsagePercent(previous, current) {
  if (!previous || !current) return null
  if (previous.pid !== null && current.pid !== null && previous.pid !== current.pid) return null
  const elapsedMicros = (current.uptimeSeconds - previous.uptimeSeconds) * 1_000_000
  const cpuMicros = current.cpuMicros - previous.cpuMicros
  if (!(elapsedMicros > 0) || cpuMicros < 0) return null
  return Math.round((cpuMicros / elapsedMicros) * 100)
}

/** Width for a `console-meter` bar: clamped to 0–100. */
export function cpuMeterWidth(percent) {
  if (!finite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}
