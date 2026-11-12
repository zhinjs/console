import test from 'node:test'
import assert from 'node:assert/strict'
import { translate } from './locale-fixture.mjs'
import {
  PACKAGE_OPERATION_RPC, packageSpec, packagePlanRequest, packageTransactionRequest, packageReceiptPlan, transactionReceiptValue,
  verifyPackageState, transactionBusy, installedPackage,
} from '../console-ui/src/pages/plugin-package-model.mjs'
import { pluginScopeSummary, scopeSummaryLine, pluginPermissionGroups, inferredPermissionLevel, capabilityPlugin, capabilityPlugins } from '../console-ui/src/pages/plugin-scope-model.mjs'
import { pluginHealth, pluginInventory, inventoryCounts, matchesHealthFilter } from '../console-ui/src/pages/plugin-list-model.mjs'
import { installedFromPackageList, installFollowUps } from '../console-ui/src/pages/marketplace-view-model.mjs'
import { GatewayRequestError, readGatewayReply, readDeclarationErrors } from '../console-ui/src/pages/ops/gateway-model.mjs'
import { readSubmitResult, receiptReducer } from '../console-ui/src/components/action-receipt-model.mjs'

const t = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)

test('package actions map to gateway.packages.* only, with the exact spec', () => {
  assert.deepEqual(PACKAGE_OPERATION_RPC, { install: 'gateway.packages.install', update: 'gateway.packages.update', uninstall: 'gateway.packages.uninstall' })
  assert.equal(packageSpec('install', '@zhin.js/rss', '1.2.0'), '@zhin.js/rss@1.2.0')
  assert.equal(packageSpec('update', '@zhin.js/rss', ' 1.3.0 '), '@zhin.js/rss@1.3.0')
  assert.equal(packageSpec('uninstall', '@zhin.js/rss', '1.2.0'), '@zhin.js/rss', 'the gateway refuses a version on uninstall')
  assert.throws(() => packageSpec('install', ''))
  assert.deepEqual(packagePlanRequest('install', ['a@1.0.0']), { operation: 'install', packages: ['a@1.0.0'] })
  assert.throws(() => packagePlanRequest('declare', ['a']))
  assert.deepEqual(packageTransactionRequest('install', { packages: ['a@1.0.0'] }), { type: 'gateway.packages.install', data: { packages: ['a@1.0.0'] } })
  assert.deepEqual(packageTransactionRequest('uninstall', { packages: ['a'], removeDependency: false, startInstance: true, enable: true }),
    { type: 'gateway.packages.uninstall', data: { packages: ['a'], removeDependency: false, startInstance: true } })
  assert.throws(() => packageTransactionRequest('install', { packages: [] }))
})

test('the receipt plan lists what the gateway will do; uninstall is a danger action', () => {
  const plan = { operation: 'install', packages: [{ name: 'a', version: '1.0.0', spec: 'a@1.0.0', source: 'market' }], all: false, packageManager: 'pnpm', instanceState: 'running', restartsInstance: true }
  const receipt = packageReceiptPlan('install', plan, { name: 'a', version: '1.0.0' }, t)
  assert.equal(receipt.title, '安装 a@1.0.0')
  assert.equal(receipt.danger, false)
  assert.ok(receipt.changes.includes('包 a@1.0.0（来源：插件市场）'))
  assert.ok(receipt.changes.includes('网关先停止实例，完成后重新启动并等待就绪'))
  assert.ok(receipt.changes.includes('包管理器：pnpm'))
  const stopped = packageReceiptPlan('update', { ...plan, operation: 'update', instanceState: 'crashed', restartsInstance: false }, { name: 'a', version: '1.1.0', from: '1.0.0' }, t)
  assert.equal(stopped.title, '更新 a：1.0.0 → 1.1.0')
  assert.ok(stopped.changes.includes('实例当前未运行，事务结束后不会自动启动'))
  const uninstall = packageReceiptPlan('uninstall', { ...plan, operation: 'uninstall' }, { name: 'a' }, en)
  assert.equal(uninstall.danger, true)
  assert.equal(uninstall.title, 'Uninstall a')
  assert.equal(uninstall.confirmLabel, 'Confirm Uninstall')
})

const result = (extra = {}) => ({ id: 't1', operation: 'install', packages: [{ name: 'a', spec: 'a@1.0.0', source: 'market' }], ok: true, status: 'succeeded',
  logTail: [], instance: { before: 'running', after: 'running' }, startedAt: 1, finishedAt: 2, ...extra })

test('transaction results become receipt outcomes: success, needs configuration, rolled back, rollback failed', () => {
  const ok = readSubmitResult(transactionReceiptValue(result(), t))
  assert.equal(ok.phase, 'succeeded')
  assert.deepEqual(ok.items, [{ label: '安装 a@1.0.0', ok: true }])
  const needs = readSubmitResult(transactionReceiptValue(result({ needsConfiguration: [{ name: 'a', instanceKey: 'a', missing: ['endpoints'], missingEnv: ['QQ_SECRET'] }] }), t))
  assert.equal(needs.phase, 'partial')
  assert.deepEqual(needs.items[1], { label: 'a 需要配置后才能启用', ok: false, message: 'endpoints, $QQ_SECRET' })
  const rolledBack = readSubmitResult(transactionReceiptValue(result({ ok: false, status: 'rolledBack', failedPhase: 'start-instance', error: 'ready timeout' }), t))
  assert.equal(rolledBack.phase, 'failed', 'rolled back: nothing changed, may be prepared again')
  assert.match(rolledBack.status.message, /已回滚.*启动实例并等待就绪.*ready timeout/u)
  const broken = readSubmitResult(transactionReceiptValue(result({ ok: false, status: 'rollbackFailed', failedPhase: 'package-manager', rollbackError: 'EACCES' }), t))
  assert.equal(broken.phase, 'unknown', 'a failed rollback only offers a read-only check')
  assert.match(broken.message, /EACCES/)
  assert.equal(readSubmitResult(transactionReceiptValue(null, t)).phase, 'unknown')
})

test('a refused transaction is not applied; a lost reply is unknown and never replayed', () => {
  const plan = { title: 'x' }
  const busy = new GatewayRequestError('另一个依赖事务正在进行，请等待它结束', { status: 409, code: 'conflict' })
  assert.equal(transactionBusy(busy), true)
  const refused = receiptReducer({ phase: 'submitting', plan }, { type: 'reject', error: busy })
  assert.equal(refused.phase, 'failed')
  assert.equal(refused.status.kind, 'conflict')
  const lost = receiptReducer({ phase: 'submitting', plan }, { type: 'reject', error: new TypeError('Failed to fetch') })
  assert.equal(lost.phase, 'unknown')
})

test('the read-only check compares the dependency list with what was asked', () => {
  const list = { packages: [{ name: 'a', range: '^1.0.0', dependencyType: 'dependencies', installedVersion: '1.1.0' }] }
  assert.equal(installedPackage(list, 'a').installedVersion, '1.1.0')
  assert.equal(verifyPackageState('update', 'a', '1.1.0', list, t).applied, true)
  assert.equal(verifyPackageState('update', 'a', '1.2.0', list, t).applied, false)
  assert.equal(verifyPackageState('install', 'a', undefined, list, t).applied, undefined)
  assert.equal(verifyPackageState('install', 'b', '1.0.0', list, t).applied, false)
  assert.equal(verifyPackageState('uninstall', 'a', undefined, list, t).applied, false)
  assert.equal(verifyPackageState('uninstall', 'b', undefined, list, t).applied, true)
})

test('gateway error replies keep the structured errors and missingEnv of a refused declaration', () => {
  let caught
  try {
    readGatewayReply(400, { success: false, code: 'invalid_input', error: '配置未通过插件 Schema 校验，未声明：$.endpoints required',
      errors: [{ path: '$.endpoints', message: 'required' }, { path: '$.endpoints.0.id', message: 'must be string' }], missingEnv: ['QQ_SECRET'] }, t)
  } catch (error) { caught = error }
  assert.ok(caught instanceof GatewayRequestError)
  assert.deepEqual(caught.details, { errors: [{ path: '$.endpoints', message: 'required' }, { path: '$.endpoints.0.id', message: 'must be string' }], missingEnv: ['QQ_SECRET'] })
  assert.deepEqual(readDeclarationErrors(caught.hostMessage, caught.details), {
    general: null, fields: [{ path: 'endpoints', message: 'required' }, { path: 'endpoints.0.id', message: 'must be string' }], missingEnv: ['QQ_SECRET'],
  })
  try { readGatewayReply(409, { ok: false, error: { code: 'conflict', message: 'busy', status: 409 } }, t) } catch (error) { caught = error }
  assert.equal(caught.details, undefined)
  assert.equal(caught.code, 'conflict')
})

const matrix = {
  revision: 'r1', adapters: ['icqq', 'telegram'], endpoints: { icqq: ['bot-1', 'bot-2'], telegram: ['tg'] },
  rows: [
    { plugin: 'welcome', global: { enabled: true, overridden: false }, adapters: { icqq: { enabled: true, overridden: true }, telegram: { enabled: false, overridden: true } },
      conversationOverrides: { icqq: { 'bot-1': 3, 'bot-2': 0 }, telegram: { tg: 1 } } },
    { plugin: 'rss', global: { enabled: false, overridden: true }, adapters: { icqq: { enabled: false, overridden: false, lockedBy: 'global' } } },
  ],
}

test('「在哪开了」 summarises the matrix row and links every level into the object tree', () => {
  const summary = pluginScopeSummary(matrix, 'welcome')
  assert.deepEqual(summary.global, { enabled: true, overridden: false, href: '/features/global/welcome' })
  assert.deepEqual(summary.adapters.map(item => [item.alias, item.enabled, item.overridden, item.accounts, item.href]), [
    ['icqq', true, true, 2, '/scope/icqq?tab=features'], ['telegram', false, true, 1, '/scope/telegram?tab=features'],
  ])
  assert.deepEqual(summary.conversations, [
    { alias: 'icqq', endpoint: 'bot-1', count: 3, href: '/scope/icqq/bot-1?tab=features' },
    { alias: 'telegram', endpoint: 'tg', count: 1, href: '/scope/telegram/tg?tab=features' },
  ])
  assert.deepEqual(summary.totals, { adaptersOn: 1, adaptersOff: 1, adapterOverrides: 2, conversationOverrides: 4 })
  assert.equal(scopeSummaryLine(summary, t), '全局开启 · 1/2 个适配器开启 · 4 个会话有覆盖')
  const rss = pluginScopeSummary(matrix, 'rss')
  assert.equal(rss.adapters[0].lockedBy, 'global')
  assert.equal(rss.adapters[1].enabled, null, 'a missing cell is unknown, not off')
  assert.equal(scopeSummaryLine(rss, t), '全局已停用')
  assert.equal(pluginScopeSummary(matrix, 'missing'), null)
  assert.equal(scopeSummaryLine(null, en), 'Switch state unknown')
})

test('plugin permissions group by level; undeclared levels follow the Host suffix rule', () => {
  assert.equal(inferredPermissionLevel('ops:approve'), 'manage')
  assert.equal(inferredPermissionLevel('onebot11:read'), 'read')
  assert.equal(inferredPermissionLevel('ops:config.write'), 'manage')
  assert.equal(inferredPermissionLevel('ambient:trigger'), 'operate')
  const groups = pluginPermissionGroups([
    { permission: 'ambient:read', plugin: 'ambient', level: 'read', description: '查看' },
    { permission: 'ambient:trigger', plugin: 'ambient' },
    { permission: 'other:read', plugin: 'other', level: 'read' },
  ], ['ambient'])
  assert.deepEqual(groups.map(group => [group.level, group.catalogPermission, group.permissions.map(item => item.permission)]), [
    ['read', 'plugin.perms.read', ['ambient:read']], ['operate', 'plugin.perms.operate', ['ambient:trigger']], ['manage', 'plugin.perms.manage', []],
  ])
  assert.equal(groups[1].permissions[0].declared, false)
})

test('runtime capability rows name the plugin that provides them', () => {
  assert.equal(capabilityPlugin({ plugin: 'rss' }), 'rss')
  assert.equal(capabilityPlugin({ owner: 'root/rss/child' }), 'rss/child')
  assert.equal(capabilityPlugin({ owner: 'root' }), null)
  assert.equal(capabilityPlugin({ source: '/abs/path.ts' }), null)
  assert.equal(capabilityPlugin({ source: '@zhin.js/rss' }), null)
  assert.equal(capabilityPlugin({ source: 'mcp://server' }), null)
  assert.deepEqual(capabilityPlugins([{ plugin: 'a' }, { owner: 'root/b' }, { plugin: 'a' }, {}]), ['a', 'b'])
})

const pending = { packageName: '@zhin.js/rss', instanceKey: 'rss', installed: true, plugin: true, declared: true, version: '1.0.0', revision: 'r', projectRevision: 'p',
  status: 'pending-restart', dependencies: 'passed', validation: null, generation: 2, published: false, readiness: 'unknown', restartRequired: true, disabled: false, issues: [], verification: 'not-configured' }

test('the plugin list shows installation and health only, plus installed packages that wait for configuration', () => {
  assert.equal(pluginHealth({ name: 'a', status: 'active' }), 'healthy')
  assert.equal(pluginHealth({ name: 'a', status: 'inactive' }), 'inactive')
  assert.equal(pluginHealth({ name: 'a', status: 'active', management: pending }), 'pending')
  assert.equal(pluginHealth({ name: 'a', status: 'active', management: { ...pending, status: 'enabled', published: true } }), 'healthy')
  assert.equal(pluginHealth({ name: 'a', status: 'active', management: { ...pending, disabled: true } }), 'inactive')
  assert.equal(pluginHealth({ name: 'a', status: 'active', managementError: 'denied' }), 'pending')
  const packages = { packages: [
    { name: '@zhin.js/rss', installedVersion: '1.0.0', dependencyType: 'dependencies', catalog: 'market' },
    { name: '@zhin.js/adapter-qq', installedVersion: '2.0.0', dependencyType: 'dependencies', catalog: 'adapter' },
    { name: 'typescript', installedVersion: '5.0.0', dependencyType: 'devDependencies' },
    { name: 'lodash', installedVersion: '4.0.0', dependencyType: 'dependencies' },
  ] }
  const rows = pluginInventory([{ name: 'rss', status: 'active', instanceKey: 'rss', packageName: '@zhin.js/rss', management: pending }], packages)
  assert.deepEqual(rows.map(row => [row.kind, row.name, row.version, row.health]), [
    ['plugin', 'rss', '1.0.0', 'pending'], ['package', '@zhin.js/adapter-qq', '2.0.0', 'undeclared'],
  ])
  assert.deepEqual(inventoryCounts(rows), { all: 2, healthy: 0, pending: 2, inactive: 0 })
  assert.equal(matchesHealthFilter(rows[1], 'pending'), true)
  assert.equal(matchesHealthFilter(rows[1], 'healthy'), false)
  const down = pluginInventory(null, packages)
  assert.deepEqual(down.map(row => [row.name, row.health]), [['@zhin.js/rss', 'unreported'], ['@zhin.js/adapter-qq', 'unreported']])
  assert.deepEqual(inventoryCounts(down), { all: 2, healthy: 0, pending: 0, inactive: 0 }, 'an unanswered instance is not a plugin problem')
  assert.equal(matchesHealthFilter(down[0], 'pending'), false)
})

test('marketplace installed status falls back to the gateway list; follow-ups only after a settled install', () => {
  const index = installedFromPackageList({ packages: [{ name: '@zhin.js/adapter-qq', installedVersion: '1.0.0', dependencyType: 'dependencies' }, { name: 'missing', installedVersion: null }] })
  assert.deepEqual([...index.entries()], [['@zhin.js/adapter-qq', { instanceKeys: ['qq'], version: '1.0.0' }]])
  assert.equal(installedFromPackageList(null), null)
  assert.deepEqual(installFollowUps({ phase: 'submitting', operation: 'install', packageName: 'a' }), [])
  assert.deepEqual(installFollowUps({ phase: 'partial', operation: 'install', packageName: 'a' }), [])
  assert.deepEqual(installFollowUps({ phase: 'succeeded', operation: 'update', packageName: 'a' }), [])
  assert.deepEqual(installFollowUps({ phase: 'succeeded', operation: 'install', packageName: '@zhin.js/plugin-rss', welcomePackage: '@zhin.js/plugin-rss' }).map(link => link.to), [
    '/use-cases/group-welcome?instance=rss', '/features/global/rss', '/scope?tab=features', '/plugins/rss',
  ])
})
