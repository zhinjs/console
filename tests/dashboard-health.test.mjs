import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../console-ui/src/pages/dashboard-health.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { summarizeOptional } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('unreadable log statistics remain unknown while readable empty levels mean zero', () => {
  assert.equal(summarizeOptional(null, null).errorLogs, null)
  assert.equal(summarizeOptional({ byLevel: {} }, null).errorLogs, 0)
  assert.equal(summarizeOptional({ byLevel: { error: 2 } }, null).errorLogs, 2)
})
test('missing Agent runtime is distinct from an installed runtime with no bindings', () => {
  assert.equal(summarizeOptional(null, { total: 0, note: 'Agent runtime 未装配（basic/cli 未接线 acquireAgentRuntime）' }).agentStatus, 'unavailable')
  assert.equal(summarizeOptional(null, { total: 0 }).agentStatus, 'available')
  assert.equal(summarizeOptional(null, null).agentStatus, 'unknown')
})

test('dashboard requires known zero errors and labels root-excluding statistics honestly', () => {
  const dashboard = readFileSync(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
  assert.match(dashboard, /optional\.errorLogs === 0/)
  assert.match(dashboard, /\.\.\.optionalSummary/)
  assert.match(dashboard, /运行子插件/)
  const plugins = readFileSync(new URL('../console-ui/src/pages/plugins.tsx', import.meta.url), 'utf8')
  assert.match(plugins, /项目根插件不计入此列表/)
})

test('optional empty Agent does not become an operational incident and unreadable logs never look stable', () => {
 const dashboard = readFileSync(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
 assert.doesNotMatch(dashboard, /title: '尚未配置 Agent'/)
 const logs = readFileSync(new URL('../console-ui/src/pages/logs/LogWorkbench.tsx', import.meta.url), 'utf8')
 assert.match(logs, /state\.stats \? levelCount\(level\) : '—'/)
 assert.match(logs, /state\.error \?/)
 const page = readFileSync(new URL('../console-ui/src/pages/logs.tsx', import.meta.url), 'utf8')
 assert.match(page, /setStats\(null\)/)
})
