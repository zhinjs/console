import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EMPTY_PROGRESS, GATEWAY_RPC, GatewayRequestError, INSTANCE_STATES, MAX_PACKAGE_SPECS, PACKAGE_PHASES, formatDuration, gatewayErrorKind,
  gatewayRequestBody, instanceActions, instanceStateLabel, instanceStateTone, mergeLogLines, parsePackageSpecs, phaseLabel, readGatewayReply,
  readInstanceStatus, readLogLines, readPackageList, readPackagePlan, readTransactionResult, reducePackageProgress, transactionSummary, uptimeMs,
} from '../console-ui/src/pages/ops/gateway-model.mjs'
import { ROUTE_PERMISSIONS, buildNavigation, canSeeRoute } from '../console-ui/src/navigation-sections.mjs'
import { CONSOLE_PATHS } from '../console-ui/src/console-routes.mjs'
import { createConsoleAccess } from '../console-ui/src/utils/console-access.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('the local mirror names the gateway RPCs of ADR 0054 §4–§5', () => {
  assert.deepEqual(Object.values(GATEWAY_RPC).sort(), [
    'gateway.instance.logs', 'gateway.instance.restart', 'gateway.instance.start', 'gateway.instance.status', 'gateway.instance.stop',
    'gateway.packages.install', 'gateway.packages.list', 'gateway.packages.plan', 'gateway.packages.uninstall', 'gateway.packages.update',
    'gateway.plugins.declare',
  ])
  const mirror = read('contracts/console-protocol-mirror.mjs')
  assert.match(read('contracts/gateway.ts'), /from '\.\/console-protocol-mirror\.mjs'/u, 'constants come from the single protocol mirror')
  for (const name of Object.values(GATEWAY_RPC)) assert.ok(mirror.includes(`'${name}'`), name)
  assert.deepEqual(gatewayRequestBody('gateway.instance.logs', { lines: 10 }, 7), { type: 'gateway.instance.logs', requestId: 7, data: { lines: 10 } })
  assert.deepEqual(gatewayRequestBody('gateway.instance.status', undefined, 1).data, {})
})

test('replies: both envelopes succeed, an old Host reads as unsupported, codes are kept', () => {
  assert.deepEqual(readGatewayReply(200, { success: true, data: { state: 'running' } }, zh), { state: 'running' })
  assert.deepEqual(readGatewayReply(200, { ok: true, data: [1] }, zh), [1])
  for (const body of [{ success: false, error: 'Unknown RPC type: gateway.instance.status' }, { ok: false, error: { code: 'unmapped', message: 'RPC "x" 未登记权限', status: 403 } }]) {
    assert.throws(() => readGatewayReply(400, body, zh), error => error instanceof GatewayRequestError && gatewayErrorKind(error) === 'unsupported' && /需要新版网关/u.test(error.message))
  }
  assert.throws(() => readGatewayReply(200, { ok: false, error: { code: 'conflict', message: '依赖事务进行中', status: 409 } }, zh),
    error => gatewayErrorKind(error) === 'conflict' && error.message === '依赖事务进行中' && error.status === 409)
  assert.throws(() => readGatewayReply(403, {}, en), error => gatewayErrorKind(error) === 'forbidden' && !/[㐀-鿿]/u.test(error.message))
  assert.throws(() => readGatewayReply(503, { success: false, error: '网关未管理实例', code: 'unavailable' }, zh), error => gatewayErrorKind(error) === 'unavailable')
  assert.throws(() => readGatewayReply(500, null, en), /HTTP 500/u)
  assert.equal(gatewayErrorKind(new Error('x')), 'failed')
})

const status = {
  instanceId: 'default', state: 'crashed', pid: 42, startedAt: 1_000, generation: 3, lastExitCode: 1, lastExitSignal: null, recentRestarts: 10,
  lastFailure: { reason: 'restart-storm', message: 'Too many restarts', at: 5_000, exitCode: 1, signal: null, logTail: ['boom', 7] },
}

test('instance status is read defensively; labels, tones and actions follow the state', () => {
  const parsed = readInstanceStatus(status)
  assert.equal(parsed.state, 'crashed')
  assert.deepEqual(parsed.lastFailure.logTail, ['boom'])
  assert.equal(readInstanceStatus({ state: 'weird' }), null)
  assert.equal(readInstanceStatus(null), null)
  assert.equal(readInstanceStatus({ state: 'stopped' }).recentRestarts, 0)
  for (const state of INSTANCE_STATES) {
    assert.match(instanceStateLabel(state, zh), /[㐀-鿿]/u, state)
    assert.doesNotMatch(instanceStateLabel(state, en), /[㐀-鿿]/u, state)
  }
  assert.equal(instanceStateTone('running'), 'success')
  assert.equal(instanceStateTone('crashed'), 'destructive')
  assert.deepEqual(instanceActions('running'), { start: false, stop: true, restart: true })
  assert.deepEqual(instanceActions('stopped'), { start: true, stop: false, restart: false })
  assert.deepEqual(instanceActions('starting'), { start: false, stop: false, restart: false })
  assert.deepEqual(instanceActions('crashed'), { start: true, stop: true, restart: true })
})

test('uptime counts only while running and formats compactly', () => {
  assert.equal(uptimeMs({ state: 'running', startedAt: 1_000 }, 61_000), 60_000)
  assert.equal(uptimeMs({ state: 'stopped', startedAt: 1_000 }, 61_000), null)
  assert.equal(formatDuration(5_400, zh), '5 秒')
  assert.equal(formatDuration(125_000, zh), '2 分 5 秒')
  assert.equal(formatDuration(3_726_000, en), '1 h 2 min')
  assert.equal(formatDuration(90_000_000, zh), '1 天 1 小时')
})

test('log tails merge by sequence, start over after a collector restart and stay capped', () => {
  const line = (seq, stream = 'stdout') => ({ seq, time: seq, stream, line: `l${seq}` })
  const first = readLogLines({ lines: [line(1), line(2), { seq: 'x' }, line(3, 'stderr')] })
  assert.deepEqual(first.map(item => item.seq), [1, 2, 3])
  const merged = mergeLogLines(first, [line(2), line(3), line(4), line(5)])
  assert.deepEqual(merged.map(item => item.seq), [1, 2, 3, 4, 5])
  assert.equal(mergeLogLines(merged, [line(4), line(5)]), merged, 'nothing new keeps the same array')
  assert.deepEqual(mergeLogLines(merged, [line(1), line(2)]).map(item => item.seq), [1, 2], 'gateway restarted: new tail replaces the old')
  assert.deepEqual(mergeLogLines([], [line(3), line(1), line(2)], 2).map(item => item.seq), [2, 3])
})

test('package specs are validated before planning', () => {
  assert.deepEqual(parsePackageSpecs(' @zhin.js/adapter-qq, sqlite3@^5  sqlite3@^5 ', zh), { specs: ['@zhin.js/adapter-qq', 'sqlite3@^5'], problem: null })
  assert.match(parsePackageSpecs('', zh).problem, /至少/u)
  assert.match(parsePackageSpecs('Bad Name!', zh).problem, /不是有效/u)
  assert.match(parsePackageSpecs('../evil', en).problem, /not a valid npm package name/u)
  assert.match(parsePackageSpecs(Array.from({ length: MAX_PACKAGE_SPECS + 1 }, (_, index) => `p${index}`).join(' '), zh).problem, /最多/u)
})

test('package list and plan are read defensively', () => {
  const list = readPackageList({ packageManager: 'pnpm', packages: [
    { name: 'zhin.js', range: '^1', dependencyType: 'dependencies', installedVersion: '1.2.0' },
    { name: '@zhin.js/adapter-qq', range: '^1', dependencyType: 'weird', installedVersion: null, catalog: 'adapter' },
    { nope: true },
  ] })
  assert.equal(list.packageManager, 'pnpm')
  assert.deepEqual(list.packages.map(item => item.name), ['@zhin.js/adapter-qq', 'zhin.js'])
  assert.equal(list.packages[0].dependencyType, 'dependencies')
  assert.deepEqual(readPackageList(null), { packageManager: '', packages: [] })
  const plan = readPackagePlan({ operation: 'install', packages: [{ name: 'sqlite3', spec: 'sqlite3@^5', source: 'database-driver' }], all: false, packageManager: 'pnpm', instanceState: 'running', restartsInstance: true })
  assert.equal(plan.restartsInstance, true)
  assert.equal(plan.packages[0].spec, 'sqlite3@^5')
  assert.equal(readPackagePlan({ operation: 'nuke' }), null)
})

const result = (status, extra = {}) => ({
  id: 'tx1', operation: 'install', packages: [], ok: status === 'succeeded', status, instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 2, ...extra,
})

test('progress events of one transaction fold into phases, capped output and the result', () => {
  let state = EMPTY_PROGRESS
  state = reducePackageProgress(state, { type: 'start', id: 'tx1', operation: 'install', packages: [{ name: 'sqlite3', spec: 'sqlite3', source: 'database-driver' }] })
  state = reducePackageProgress(state, { type: 'phase', id: 'tx1', phase: 'snapshot' })
  state = reducePackageProgress(state, { type: 'phase', id: 'tx1', phase: 'snapshot' })
  state = reducePackageProgress(state, { type: 'phase', id: 'tx1', phase: 'stop-instance' })
  state = reducePackageProgress(state, { type: 'output', id: 'tx1', stream: 'stdout', chunk: 'added 1 package\n' })
  state = reducePackageProgress(state, { type: 'phase', id: 'other', phase: 'done' })
  state = reducePackageProgress(state, { type: 'output', id: 'tx1', stream: 'stderr', chunk: 'x'.repeat(70 * 1024) })
  state = reducePackageProgress(state, { type: 'phase', id: 'tx1', phase: 'start-instance' })
  state = reducePackageProgress(state, { type: 'phase', id: 'tx1', phase: 'rollback' })
  state = reducePackageProgress(state, { type: 'result', id: 'tx1', result: result('rolledBack', { failedPhase: 'start-instance', error: 'ready timeout', logTail: ['Error: x'] }) })
  assert.equal(state.id, 'tx1')
  assert.equal(state.operation, 'install')
  assert.deepEqual(state.phases, ['snapshot', 'stop-instance', 'start-instance', 'rollback'])
  assert.equal(state.output.length, 64 * 1024)
  assert.equal(state.result.status, 'rolledBack')
  assert.deepEqual(state.result.logTail, ['Error: x'])
  assert.equal(reducePackageProgress(state, null), state)
  assert.equal(reducePackageProgress(state, { type: 'phase' }), state)
})

test('transaction results read as success, rollback or a failed rollback in both languages', () => {
  assert.equal(readTransactionResult({ status: 'maybe' }), null)
  const ok = readTransactionResult(result('succeeded'))
  assert.equal(transactionSummary(ok, zh).tone, 'success')
  assert.equal(transactionSummary(ok, en).title, 'Install succeeded')
  assert.equal(transactionSummary(readTransactionResult(result('rolledBack')), zh).tone, 'warning')
  const broken = readTransactionResult(result('rollbackFailed', { rollbackError: 'disk full' }))
  assert.equal(broken.rollbackError, 'disk full')
  assert.equal(transactionSummary(broken, zh).tone, 'destructive')
  for (const phase of PACKAGE_PHASES) {
    assert.match(phaseLabel(phase, zh), /[㐀-鿿]/u, phase)
    assert.doesNotMatch(phaseLabel(phase, en), /[㐀-鿿]/u, phase)
  }
})

const access = permissions => createConsoleAccess({ permissions })

test('the instance and terminal pages sit in 运维 with their own permissions', () => {
  assert.equal(CONSOLE_PATHS.opsInstance, '/ops/instance')
  assert.equal(CONSOLE_PATHS.opsTerminal, '/ops/terminal')
  assert.deepEqual(ROUTE_PERMISSIONS['/ops/terminal'], ['ops.terminal'])
  assert.deepEqual(ROUTE_PERMISSIONS['/ops/instance'], ['status.view', 'ops.restart', 'plugin.manage'])
  const terminal = { path: '/ops/terminal', meta: { group: '运维' } }
  const instance = { path: '/ops/instance', meta: { group: '运维' } }
  assert.equal(canSeeRoute(terminal, access(['ops.*'])), true)
  assert.equal(canSeeRoute(terminal, access(['status.view', 'ops.restart'])), false, 'admin without ops.terminal')
  assert.equal(canSeeRoute(instance, access(['status.view'])), true)
  assert.equal(canSeeRoute(instance, access(['endpoint.view'])), false)
  const nav = buildNavigation([terminal, instance], access(['status.view']))
  assert.deepEqual(nav.flatMap(tier => tier.sections.flatMap(section => section.routes.map(route => route.path))), ['/ops/instance'])
  const shell = read('registerBuiltinShell.tsx')
  assert.match(shell, /path: P\.opsInstance, name: '实例'/u)
  assert.match(shell, /path: P\.opsTerminal, name: '终端'/u)
})

test('the instance page confirms lifecycle actions, plans before mutating and subscribes to progress first', () => {
  const page = read('pages/ops/instance.tsx')
  assert.match(page, /useActionReceipt\(/u, 'lifecycle actions and package transactions go through the receipt')
  assert.match(page, /GATEWAY_RPC\.PACKAGES_PLAN/u)
  assert.match(page, /useGatewayTransaction\(\)/u, 'transactions run through the shared runner')
  const runner = read('pages/ops/use-gateway.ts')
  assert.ok(runner.indexOf('subscribePackageProgress(event') < runner.indexOf('await gatewayRequest(type, data'), 'subscribe before sending')
  assert.match(page, /hasConsolePermission\('ops\.restart'/u)
  assert.match(read('pages/ops/use-gateway.ts'), /onConsoleEvent\(GATEWAY_PACKAGES_PROGRESS/u)
})
