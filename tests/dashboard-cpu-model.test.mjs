import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpuMeterWidth, cpuUsagePercent, readCpuSample } from '../console-ui/src/pages/dashboard-cpu-model.mjs'

const status = (user, system, uptime, pid = 42) => ({ cpu: { user, system }, uptime, pid })

test('reads cumulative cpuUsage samples and rejects missing or malformed CPU data', () => {
  assert.deepEqual(readCpuSample(status(1_000, 500, 10)), { cpuMicros: 1_500, uptimeSeconds: 10, pid: 42 })
  assert.deepEqual(readCpuSample({ cpu: { user: 1, system: 2 }, uptime: 3 }), { cpuMicros: 3, uptimeSeconds: 3, pid: null })
  assert.equal(readCpuSample(null), null)
  assert.equal(readCpuSample({ uptime: 10 }), null)
  assert.equal(readCpuSample({ cpu: { user: 'x', system: 1 }, uptime: 10 }), null)
  assert.equal(readCpuSample({ cpu: { user: -1, system: 1 }, uptime: 10 }), null)
  assert.equal(readCpuSample({ cpu: { user: 1, system: 1 } }), null)
})

test('computes CPU percent of one core from two samples', () => {
  // 10 s wall time, 2.5 s CPU → 25 %
  assert.equal(cpuUsagePercent(readCpuSample(status(1_000_000, 0, 100)), readCpuSample(status(3_000_000, 500_000, 110))), 25)
  // two busy cores → above 100 %
  assert.equal(cpuUsagePercent(readCpuSample(status(0, 0, 0)), readCpuSample(status(15_000_000, 5_000_000, 10))), 200)
  assert.equal(cpuUsagePercent(readCpuSample(status(0, 0, 0)), readCpuSample(status(0, 0, 10))), 0)
})

test('returns null instead of 0 when samples cannot be compared', () => {
  const current = readCpuSample(status(2_000_000, 0, 20))
  assert.equal(cpuUsagePercent(null, current), null)
  assert.equal(cpuUsagePercent(current, null), null)
  assert.equal(cpuUsagePercent(current, current), null, 'no elapsed time')
  assert.equal(cpuUsagePercent(readCpuSample(status(9_000_000, 0, 500)), current), null, 'uptime went back: Host restarted')
  assert.equal(cpuUsagePercent(readCpuSample(status(1_000_000, 0, 10, 1)), readCpuSample(status(2_000_000, 0, 20, 2))), null, 'pid changed')
  assert.equal(cpuUsagePercent(readCpuSample(status(5_000_000, 0, 10)), readCpuSample(status(1_000_000, 0, 20))), null, 'cpu counter went back')
})

test('clamps meter width to 0–100', () => {
  assert.equal(cpuMeterWidth(42), 42)
  assert.equal(cpuMeterWidth(250), 100)
  assert.equal(cpuMeterWidth(-3), 0)
  assert.equal(cpuMeterWidth(null), 0)
})

test('dashboard resource card shows CPU from sampled deltas with a dash when missing', () => {
  const dashboard = readFileSync(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
  assert.match(dashboard, /from '\.\/dashboard-cpu-model\.mjs'/)
  assert.match(dashboard, /i18n\.t\("CPU 占用"\)/)
  assert.match(dashboard, /cpuRate !== null \? `\$\{cpuRate\}%` : '—'/)
  assert.match(dashboard, /cpuRate >= 85 \? 'is-warning' : ''/)
})
