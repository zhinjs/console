import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as protocol from '@zhin.js/console-protocol'
import { ConsoleTransport } from '../node_modules/@zhin.js/client/dist/transport/console-transport.js'
import {
  FEATURE_TOGGLE_PERMISSION, GLOBAL_PLUGIN_SWITCH_PERMISSION, featureSwitchPermission, globalSwitchDeniedTitle, globalSwitchPlanCopy,
  isGlobalFeatureSwitch, pluginSwitchRequestBody, switchPermissionNote, transactionDetailText, transactionFailureCopy, transactionNeedsInstanceCheck,
} from '../console-ui/src/pages/features/plugin-switch-model.mjs'
import { createConsoleAccess, hasConsolePermission, scopePermissionTarget } from '../console-ui/src/utils/console-access.mjs'
import { outcomeUnknown, statusFromError } from '../console-ui/src/components/status-state-model.mjs'
import { receiptReducer } from '../console-ui/src/components/action-receipt-model.mjs'
import { GatewayRequestError, readGatewayReply } from '../console-ui/src/pages/ops/gateway-model.mjs'
import { capturingFetch, requestWithCapture } from '../console-ui/src/utils/rpc-reply-capture.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

globalThis.localStorage ??= { getItem: key => (key === 'zhin_api_base' ? 'https://host.invalid' : null), setItem() {}, removeItem() {} }

const source = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
/** A `t` that records every message it is asked for. */
function recording() {
  const asked = []
  return { asked, t: (message, values) => { asked.push(message); return translate('zh-CN', message, values) } }
}

/** What the gateway answers for a failed switch transaction (`plugin-switch-rpc.ts`). */
const rolledBack = Object.freeze({
  success: false, code: 'transaction_failed', type: 'feature.set-enabled', requestId: 1,
  error: '停用 rss 失败，已回滚：instance did not become ready',
  transaction: { id: 't1', operation: 'disable', ok: false, status: 'rolledBack', failedPhase: 'start-instance', error: 'instance did not become ready', logTail: ['[rss] boot', 'Error: missing token'] },
})
const rollbackFailed = Object.freeze({
  success: false, code: 'rollback_failed', type: 'feature.set-enabled', requestId: 1,
  error: '启用 rss 失败，且回滚未完成：restart failed（原因：boom）',
  transaction: { id: 't2', operation: 'enable', ok: false, status: 'rollbackFailed', failedPhase: 'restart-instance', error: 'boom', rollbackError: 'restart failed' },
})
const PLUGIN_SWITCH_REQUIRES_GATEWAY = '插件全局启停由管理网关执行（停止实例 → 写入 disable_plugins → 启动，失败回滚）：请在 zhin start 启动的 Console 中操作，或运行 zhin enable / zhin disable <插件>'

test('the global switch needs plugin.manage; every lower level keeps feature.toggle', () => {
  assert.equal(GLOBAL_PLUGIN_SWITCH_PERMISSION, 'plugin.manage')
  assert.equal(FEATURE_TOGGLE_PERMISSION, 'feature.toggle')
  assert.equal(featureSwitchPermission('global'), 'plugin.manage')
  for (const level of ['adapter', 'endpoint', 'conversation']) assert.equal(featureSwitchPermission(level), 'feature.toggle', level)
  // Once the Console depends on a protocol release that has the helper, both must agree.
  if ('FEATURE_GLOBAL_SWITCH_PERMISSION' in protocol) assert.equal(protocol.FEATURE_GLOBAL_SWITCH_PERMISSION, GLOBAL_PLUGIN_SWITCH_PERMISSION)
  if (typeof protocol.isGlobalFeatureSwitch === 'function') {
    for (const message of [{ type: 'feature.set-enabled', level: 'global' }, { type: 'feature.set-enabled', data: { level: 'adapter' } }]) {
      assert.equal(protocol.isGlobalFeatureSwitch(message), isGlobalFeatureSwitch(message))
    }
  }
})

test('isGlobalFeatureSwitch reads the payload like the Host: data when it is an object, else the message', () => {
  assert.equal(isGlobalFeatureSwitch({ type: 'feature.set-enabled', plugin: 'rss', level: 'global', enabled: false }), true)
  assert.equal(isGlobalFeatureSwitch({ type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global' } }), true)
  assert.equal(isGlobalFeatureSwitch({ type: 'feature.set-enabled', level: 'global', data: { level: 'adapter' } }), false)
  assert.equal(isGlobalFeatureSwitch({ type: 'feature.set-enabled', level: 'adapter', key: 'qq' }), false)
  assert.equal(isGlobalFeatureSwitch({ type: 'feature.get', level: 'global' }), false)
  for (const value of [null, undefined, 'feature.set-enabled', []]) assert.equal(isGlobalFeatureSwitch(value), false)
  assert.deepEqual(pluginSwitchRequestBody({ type: 'feature.set-enabled', plugin: 'rss', level: 'global', enabled: true }, 4),
    { type: 'feature.set-enabled', plugin: 'rss', level: 'global', enabled: true, requestId: 4 }, 'the same flat message the SDK sends')
})

test('an identity with feature.toggle only cannot use the global switch; plugin.manage alone cannot use adapter switches', () => {
  const operator = createConsoleAccess({ permissions: ['feature.view', 'feature.configure', 'feature.toggle'] })
  const manager = createConsoleAccess({ permissions: ['feature.view', 'plugin.manage'] })
  const scoped = createConsoleAccess({ permissions: ['feature.view'], bindings: [{ role: 'qq-admin', scope: { kind: 'adapter', key: 'qq' }, permissions: ['feature.toggle', 'plugin.manage'] }] })
  const qq = scopePermissionTarget({ level: 'adapter', adapter: 'qq' })
  assert.equal(hasConsolePermission(featureSwitchPermission('global'), operator), false)
  assert.equal(hasConsolePermission(featureSwitchPermission('adapter'), operator, qq), true)
  assert.equal(hasConsolePermission(featureSwitchPermission('global'), manager), true)
  assert.equal(hasConsolePermission(featureSwitchPermission('adapter'), manager, qq), false)
  assert.equal(hasConsolePermission(featureSwitchPermission('global'), scoped), false, 'an adapter binding never opens the global switch')
  assert.equal(hasConsolePermission(featureSwitchPermission('adapter'), scoped, qq), true)

  assert.equal(switchPermissionNote({ global: true, lower: true, hasLower: true }), null)
  assert.equal(switchPermissionNote({ global: true, lower: false, hasLower: false }), null, 'the list shows only global switches')
  assert.equal(switchPermissionNote({ global: false, lower: false, hasLower: true }), '当前身份只能查看功能开关，无法启停。')
  assert.match(switchPermissionNote({ global: false, lower: true, hasLower: true }), /plugin\.manage[\s\S]*适配器上的开关仍可启停/u)
  assert.match(switchPermissionNote({ global: false, lower: true, hasLower: false }), /plugin\.manage[\s\S]*只能查看/u, 'feature.toggle does not help on the list')
  assert.match(switchPermissionNote({ global: true, lower: false, hasLower: true }), /feature\.toggle/u)
  assert.match(globalSwitchDeniedTitle(), /plugin\.manage/u)
})

test('every UI global switch checks plugin.manage and goes through the gateway transaction; lower levels stay on feature.toggle', () => {
  for (const path of ['pages/features/feature-matrix.tsx', 'pages/features/global-features-panel.tsx', 'pages/features/global-feature-summary.tsx']) {
    const page = source(path)
    assert.match(page, /hasConsolePermission\(GLOBAL_PLUGIN_SWITCH_PERMISSION, access\)/u, `${path}: the global switch needs plugin.manage`)
    assert.match(page, /useGlobalPluginSwitch\(/u, `${path}: through the shared receipt`)
    assert.match(page, /<ActionReceipt controller=\{(?:globalSwitch\.)?receipt\}/u, `${path}: the receipt is shown next to the switch`)
    assert.doesNotMatch(page, /level: 'global'/u, `${path}: no global write of its own`)
    assert.doesNotMatch(page, /useConfirm\(/u, `${path}: a confirm dialog with a toast is not a receipt`)
  }
  const matrix = source('pages/features/feature-matrix.tsx')
  assert.match(matrix, /canToggle=\{canToggleGlobal && /u, 'the 全局 column')
  assert.match(matrix, /hasConsolePermission\(FEATURE_TOGGLE_PERMISSION, access\)/u, 'the adapter columns')
  assert.match(matrix, /level: 'adapter', key: adapter/u)
  const level = source('pages/features/feature-level-panel.tsx')
  assert.match(level, /hasConsolePermission\('feature\.toggle', access, target\)/u, 'adapter / endpoint / conversation switches')

  const hook = source('pages/features/use-global-plugin-switch.ts')
  assert.match(hook, /requestGlobalPluginSwitch\(setEnabledRequest\(\{ plugin: target\.plugin, level: 'global'/u)
  assert.match(hook, /apiFetch\('\/api\/console\/request'/u, 'posted like the other gateway transactions')
  assert.doesNotMatch(hook, /AbortSignal\.timeout/u, 'no client deadline shorter than the transaction')
  assert.doesNotMatch(hook, /requestConsole<unknown>\(setEnabledRequest/u, 'not through the SDK transport and its 10 s timeout')
  assert.match(hook, /danger: true/u)
})

test('the plan says the gateway stops and restarts the instance and rolls a failure back', () => {
  for (const enabled of [true, false]) {
    const { asked, t } = recording()
    const copy = globalSwitchPlanCopy(enabled, 'RSS', t)
    assert.match(copy.title, /RSS/u)
    assert.match(copy.summary, /管理网关会停止实例[\s\S]*重新启动实例[\s\S]*自动回滚/u)
    for (const message of asked) assert.ok(Object.hasOwn(englishMessages, message), message)
    assert.match(globalSwitchPlanCopy(enabled, 'RSS', en).summary, /stops the instance[\s\S]*rolled back automatically/u)
  }
  assert.match(globalSwitchPlanCopy(false, 'RSS').summary, /所有适配器、账号与会话/u)
})

test('500 transaction_failed is 未执行 (rolled back) with the failed phase and the log tail; never 结果未知', () => {
  const error = Object.assign(new Error(rolledBack.error), { name: 'ConsoleTransportError', code: 'SERVER_ERROR', details: { serverCode: 'transaction_failed', httpStatus: 500, transaction: rolledBack.transaction } })
  const reading = statusFromError(error)
  assert.equal(reading.kind, 'error')
  assert.equal(outcomeUnknown(reading), false)
  assert.deepEqual(reading.transaction, { outcome: 'rolled-back', failedPhase: 'start-instance', cause: 'instance did not become ready', logTail: ['[rss] boot', 'Error: missing token'] })
  const receipt = receiptReducer({ phase: 'submitting', plan: { title: 'x' } }, { type: 'reject', error })
  assert.equal(receipt.phase, 'failed')
  assert.equal(receipt.status.transaction.outcome, 'rolled-back')
  assert.equal(transactionNeedsInstanceCheck(receipt.status.transaction), false)

  const detail = transactionDetailText(reading, zh)
  assert.match(detail, /^transaction_failed: 停用 rss 失败，已回滚/u)
  assert.match(detail, /失败阶段：启动实例并等待就绪/u)
  assert.doesNotMatch(detail, /原因：/u, 'the cause is already in the Host text')
  assert.match(detail, /实例最后的日志：\n\[rss\] boot\nError: missing token$/u)
  assert.match(transactionDetailText(reading, en), /Failed phase: /u)
  const copy = transactionFailureCopy('rolled-back', zh)
  assert.match(copy.title, /已自动回滚/u)
  assert.match(copy.description, /恢复到操作前的状态/u)
})

test('500 rollback_failed is an error that sends the user to the instance page', () => {
  const reading = statusFromError(Object.assign(new Error(rollbackFailed.error), { details: { serverCode: 'rollback_failed', transaction: rollbackFailed.transaction } }))
  assert.equal(reading.kind, 'error')
  assert.equal(reading.transaction.outcome, 'rollback-failed')
  assert.equal(reading.transaction.rollbackError, 'restart failed')
  assert.equal(transactionNeedsInstanceCheck(reading.transaction), true)
  assert.match(transactionFailureCopy('rollback-failed', zh).description, /「实例」页/u)
  assert.match(transactionDetailText(reading, zh), /失败阶段：启动旧版本实例/u)
  // Without the code, the transaction result alone still tells the two apart.
  assert.equal(statusFromError({ message: 'x', details: { transaction: rollbackFailed.transaction } }).transaction.outcome, 'rollback-failed')
  assert.equal(statusFromError({ message: 'x', details: { transaction: rolledBack.transaction } }).transaction.outcome, 'rolled-back')
  const receipt = receiptReducer({ phase: 'submitting', plan: { title: 'x' } }, { type: 'reject', error: { message: 'x', details: { serverCode: 'rollback_failed' } } })
  assert.equal(receipt.phase, 'failed', 'the gateway answered: nothing to verify')
})

test('gateway-required (409 feature.set-enabled, 400 plugin:set-enabled under --standalone) explains zhin start / zhin enable', () => {
  const coded = statusFromError(Object.assign(new Error(PLUGIN_SWITCH_REQUIRES_GATEWAY), { details: { serverCode: 'gateway-required', httpStatus: 409 } }))
  assert.equal(coded.kind, 'error', 'not 内容已被修改')
  assert.equal(coded.transaction.outcome, 'gateway-required')
  const plain = statusFromError(new Error(PLUGIN_SWITCH_REQUIRES_GATEWAY))
  assert.equal(plain.transaction?.outcome, 'gateway-required', 'the text-only 400 of plugin:set-enabled')
  const copy = transactionFailureCopy('gateway-required', zh)
  assert.match(copy.description, /zhin start[\s\S]*zhin enable \/ zhin disable/u)
  assert.match(transactionFailureCopy('gateway-required', en).description, /zhin start[\s\S]*zhin enable \/ zhin disable/u)
  assert.equal(statusFromError(new Error('请稍后再试')).transaction, undefined)
  assert.equal(statusFromError(Object.assign(new Error('x'), { details: { serverCode: 'conflict' } })).kind, 'conflict', 'other codes unchanged')
})

test('a rolled-back transaction with missingEnv stays a transaction failure, not 需要配置', () => {
  const reading = statusFromError({ message: rolledBack.error, details: { serverCode: 'transaction_failed', missingEnv: ['RSS_TOKEN'], transaction: rolledBack.transaction } })
  assert.equal(reading.kind, 'error')
  assert.equal(reading.transaction.outcome, 'rolled-back')
})

test('the gateway reply keeps code and transaction on GatewayRequestError; the SDK path keeps them in details', async () => {
  assert.throws(() => readGatewayReply(500, rolledBack, zh), error => {
    assert.ok(error instanceof GatewayRequestError)
    assert.equal(error.code, 'transaction_failed')
    assert.equal(error.details.transaction.failedPhase, 'start-instance')
    const reading = statusFromError(error)
    assert.equal(reading.serverCode, 'transaction_failed')
    assert.equal(reading.transaction.outcome, 'rolled-back')
    return true
  })
  assert.throws(() => readGatewayReply(409, { success: false, code: 'gateway-required', error: PLUGIN_SWITCH_REQUIRES_GATEWAY }, zh), error => {
    assert.equal(error.code, 'gateway-required', 'not folded into the dependency-transaction conflict')
    assert.equal(statusFromError(error).transaction.outcome, 'gateway-required')
    return true
  })
  assert.equal(readGatewayReply(200, { success: true, data: { status: 'saved', revision: 'r2', transaction: { ok: true } } }, zh).status, 'saved', 'the reply shape is unchanged')

  // Older Consoles still send through the SDK transport: the capture puts `transaction` back.
  const transport = new ConsoleTransport({ fetch: capturingFetch(async () => new Response(JSON.stringify(rolledBack), { status: 500, headers: { 'content-type': 'application/json' } })) })
  const error = await requestWithCapture(() => transport.sendRequest({ type: 'feature.set-enabled', plugin: 'rss', level: 'global', enabled: false })).catch(caught => caught)
  assert.equal(error.details.serverCode, 'transaction_failed')
  assert.deepEqual(error.details.transaction, rolledBack.transaction)
  assert.equal(statusFromError(error).transaction.failedPhase, 'start-instance')
})

test('the receipt shows a refused transaction with its own copy, technical details and an instance link', () => {
  const receipt = source('components/ActionReceipt.tsx')
  assert.match(receipt, /state\.phase === 'failed' && state\.status\?\.transaction \?/u)
  assert.match(receipt, /transactionFailureCopy\(state\.status\.transaction\.outcome, i18n\.t\)/u)
  assert.match(receipt, /error=\{transactionDetailText\(state\.status, i18n\.t\) \|\| undefined\}/u, 'failedPhase and logTail under 技术详情')
  assert.match(receipt, /transactionNeedsInstanceCheck\(state\.status\.transaction\)[\s\S]{0,200}to="\/ops\/instance"/u)
  assert.match(receipt, /'rollback-failed' \? i18n\.t\('失败'\)/u, 'a rollback that did not finish is not 未执行')
  for (const outcome of ['rolled-back', 'rollback-failed', 'gateway-required']) {
    const { asked, t } = recording()
    transactionFailureCopy(outcome, t)
    for (const message of asked) assert.ok(Object.hasOwn(englishMessages, message), message)
  }
  const { asked, t } = recording()
  transactionDetailText(statusFromError({ message: 'x', details: { serverCode: 'rollback_failed', transaction: { ...rollbackFailed.transaction, logTail: ['a'] } } }), t)
  for (const message of asked) assert.ok(Object.hasOwn(englishMessages, message), message)
  for (const access of [{ global: false, lower: false, hasLower: false }, { global: false, lower: true, hasLower: true }, { global: true, lower: false, hasLower: true }]) {
    const note = recording()
    switchPermissionNote(access, note.t)
    for (const message of note.asked) assert.ok(Object.hasOwn(englishMessages, message), message)
  }
})

test('the permission catalog explains that plugin.manage now includes the global switch', () => {
  const model = source('pages/access/access-model.mjs')
  assert.match(model, /'feature\.toggle': t\('在适配器、账号与会话启用或禁用功能'\)/u)
  assert.match(model, /'plugin\.manage': t\('安装、更新、卸载插件，在全局启用或停用插件'\)/u)
})
