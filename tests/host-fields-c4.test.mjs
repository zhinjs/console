// Batch C4: Host (zhin 1.3 / 1.4) fields the Console now reads. Each block also checks that an older
// Host, which does not send the field, keeps the previous display.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as protocol from '@zhin.js/console-protocol'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { scheduleTargetView, scheduleTargetWarning } from '../console-ui/src/pages/schedule-target-model.mjs'
import { filterTaskOverview, taskOverviewRows } from '../console-ui/src/pages/task-overview-model.mjs'
import { promptCacheNotices, mergeUsageModels, validateUsageStats } from '../console-ui/src/pages/token-usage-model.mjs'
import { foldReplayRows } from '../console-ui/src/pages/bot-replay-model.mjs'
import { readConversationPage, readFeatureDetail, readFeatureMatrix, mergeFeatureMatrix, rootFeatureName } from '../console-ui/src/pages/features/feature-model.mjs'
import { overrideProvenance } from '../console-ui/src/pages/features/feature-scope-model.mjs'
import {
  ADAPTER_CONFIG_RPC, adapterConfigPermission, adapterConfigRpcType, driftEntryActions, driftRows, importRequest, readConfigDrift, writebackRequest, writebackResultText,
} from '../console-ui/src/pages/scope/config-drift-model.mjs'
import { createConsoleAccess } from '../console-ui/src/utils/console-access.mjs'
import { featureDisabledState } from '../console-ui/src/utils/feature-disabled.mjs'
import { summarizeAssistantJobs } from '../console-ui/src/pages/task-hub-summary-model.mjs'
import { validateAssistantJobs } from '../console-ui/src/pages/assistant-jobs-model.mjs'
import * as live from '../console-ui/src/components/PluginConfigForm/config-live-status.mjs'
import { endpointTransportText } from '../console-ui/src/pages/endpoint-presentation.mjs'
import { CHAT_IDENTITY_SELF_PERMISSION } from '../console-ui/src/scope/chat-identity-model.mjs'
import { canSeeRoute, routePermissions } from '../console-ui/src/navigation-sections.mjs'

const source = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const cjk = /[㐀-鿿]/

/** Transpiles one component; relative `.mjs` imports load the real model, the rest come from `mocks`. */
function component(path, mocks, locale = 'zh-CN') {
  const file = new URL(`../console-ui/src/${path}`, import.meta.url)
  const local = createRequire(file)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const i18n = { locale, t: (key, values) => translate(locale, key, values) }
  const resolve = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (/(?:^|\/)i18n$/.test(name)) return { useI18n: () => i18n }
    if (name.endsWith('.css')) return {}
    if (name.startsWith('.') && name.endsWith('.mjs')) return local(name)
    if (name.startsWith('.')) throw new Error(`unmocked import ${name}`)
    return local(name)
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(resolve, module.exports, module)
  return module.exports
}

// ── 1. schedule-target-invisible ──────────────────────────────────────────────────────────────

test('schedule rows show the resolved target, or 「无效」 with the reason and the next run', () => {
  assert.equal(scheduleTargetView(undefined), null, 'older Host: no target field')
  assert.equal(scheduleTargetView({ display: 'x' }), null, 'malformed: no boolean resolved')
  assert.deepEqual(scheduleTargetView({ resolved: true, display: 'sandbox-bot（sandbox）· 私聊 u1' }), { valid: true, display: 'sandbox-bot（sandbox）· 私聊 u1', reason: null, code: null })
  assert.equal(scheduleTargetView({ resolved: true, display: '不投递' }, 'en').display, 'No delivery')
  const gone = scheduleTargetView({ resolved: false, reason: 'endpoint_not_found', display: 'gone（qq）· 群 1' })
  assert.equal(gone.valid, false)
  assert.match(gone.reason, /聊天账号不存在/)
  assert.match(scheduleTargetWarning(gone, Date.UTC(2026, 10, 16, 1), 'zh-CN'), /下次运行（.+）的结果不会送达/)
  assert.match(scheduleTargetWarning(scheduleTargetView({ resolved: false, reason: 'missing_target' }, 'en'), null, 'en'), /^No delivery target is set; run results will not be delivered\.$/)
  assert.equal(scheduleTargetView({ resolved: false, reason: 'future_code' }).reason, '发送目标无效')

  const persistent = (target, id = 'job-1') => ({ id, cronExpression: '0 0 9 * * *', prompt: '日报', enabled: true, nextExecution: 5000, ...(target ? { target } : {}) })
  const old = taskOverviewRows({ schedules: { persistent: [persistent()] } }, 'zh-CN').rows[0]
  assert.equal(old.target, 'AI 助手', 'older Host keeps the previous text')
  assert.equal(old.targetIssue, undefined)
  const ok = taskOverviewRows({ schedules: { persistent: [persistent({ resolved: true, display: 'bot（qq）· 群 1' })] } }).rows[0]
  assert.equal(ok.target, 'bot（qq）· 群 1')
  assert.equal(ok.nextRunAt, 5000)
  const bad = taskOverviewRows({ schedules: { persistent: [persistent({ resolved: false, reason: 'incomplete_target' })] }, assistant: { jobs: [{ id: 'job-2', enabled: true, state: { nextRunAtMs: 7000 }, target: { resolved: false, reason: 'endpoint_not_found', display: 'gone（qq）· 群 1' } }] } }, 'en').rows
  const job = bad.find(row => row.key === 'assistant:job-2')
  assert.equal(job.target, 'gone（qq）· 群 1')
  assert.match(job.targetIssue, /does not exist or was renamed; the results of the next run/)
  assert.equal(bad.find(row => row.key === 'persistent:job-1').target, null)
  assert.deepEqual(filterTaskOverview(bad, 'attention').map(row => row.key).sort(), ['assistant:job-2', 'persistent:job-1'], 'an undeliverable task needs attention')

  const view = source('pages/TaskOverview.tsx')
  assert.match(view, /i18n\.t\('⚠ 无效'\)/)
  assert.match(source('pages/cron.tsx'), /scheduleTargetView\(job\.target, i18n\.locale\)/)
})

// ── 2. usage-cache-unsupported-hint ───────────────────────────────────────────────────────────

const usage = extra => ({
  range: { since: 0, until: 10, bucket: 'hour' },
  totals: { turns: 3, calls: 30, inputTokens: 9000, outputTokens: 100, cacheReadTokens: 0, cacheShare: 0 },
  byModel: [], bySession: [], series: [], segments: { history: 1, fixed: 1, user: 1 }, ...extra,
})

test('the usage page explains a service that never reads the prompt cache, and a range without hits', () => {
  assert.equal(promptCacheNotices(usage()), null, 'older Host: no promptCacheHints, nothing new is shown')
  const hint = { provider: 'svc-1', label: 'DeepSeek', providerIds: ['deepseek'], zeroCacheCalls: 24, sessions: 4, reportedZeroCalls: 24, comparedPairs: 20, samePrefixPairs: 18, samePrefixRatio: 0.9, message: '…' }
  const stats = mergeUsageModels(validateUsageStats(usage({ promptCacheHints: [hint, { provider: '' }] })))
  const zh = promptCacheNotices(stats, 'zh-CN')
  assert.equal(zh.hints.length, 1, 'malformed hints are dropped')
  assert.match(zh.hints[0].text, /^DeepSeek：最近连续 24 次请求（4 个会话）没有命中提示缓存，而相邻请求有 90% 的前缀相同/)
  assert.equal(zh.missed, false)
  const en = promptCacheNotices(stats, 'en')
  assert.doesNotMatch(en.hints[0].text, cjk)
  assert.match(en.hints[0].text, /may not support or pass through prompt caching/)
  assert.deepEqual(promptCacheNotices(usage({ promptCacheHints: [] })), { hints: [], missed: true }, 'no hint, but nothing read the cache')
  assert.equal(promptCacheNotices(usage({ promptCacheHints: [], totals: { ...usage().totals, cacheReadTokens: 10 } })).missed, false)
  assert.match(source('pages/token-usage.tsx'), /promptCacheNotices\(stats, i18n\.locale\)/)
})

// ── 3. replay-two-rows-per-ambient ────────────────────────────────────────────────────────────

const decision = (id, kind, extra = {}) => ({
  id, ts: Number(id.replace(/\D/g, '')), turn_id: 't1', instance_id: '1', platform: 'qq', scene_id: 'group:1', user_id: null,
  kind, outcome: kind === 'model_skip' ? 'skip' : 'deny', reason_code: 'ambient_not_engaged', reason_detail: null, payload: {}, actor: 'policy', actor_id: null, ...extra,
})

test('a model_skip carrying payload.parent folds into its parent decision of the same turn', () => {
  // Newest first, like plugin.root.decisions: the skip comes before its gate.
  const rows = [
    decision('r3', 'model_skip', { payload: { source: 'ambient', parent: 'ambient_decision' } }),
    decision('r2', 'ambient_decision'),
    decision('r1', 'inbound_wake'),
  ]
  const entries = foldReplayRows(rows)
  assert.deepEqual(entries.map(entry => entry.row.id), ['r2', 'r1'])
  assert.deepEqual(entries[0].folded.map(row => row.id), ['r3'])
  // Older Hosts (no parent) and a parent outside the list keep one row each.
  assert.deepEqual(foldReplayRows(rows.map(row => ({ ...row, payload: {} }))).map(entry => entry.row.id), ['r3', 'r2', 'r1'])
  assert.deepEqual(foldReplayRows([rows[0]]).map(entry => entry.row.id), ['r3'])
  assert.deepEqual(foldReplayRows([rows[0], { ...rows[1], turn_id: 't2' }]).map(entry => entry.folded.length), [0, 0], 'another turn is not the parent')
  assert.match(source('pages/bot-replay.tsx'), /foldReplayRows\(list\.rows\)/)
  assert.match(source('pages/bot-replay.tsx'), /foldReplayRows\(turn\.events\)/)
})

// ── 4. self-service-scope-feedback ────────────────────────────────────────────────────────────

const detail = extra => readFeatureDetail({ revision: 'r', plugin: 'rss', level: 'conversation', key: 'qq/bot/group:1', levels: ['global', 'conversation'], schema: null, values: {}, effective: {}, sources: {}, enabled: true, ...extra })

test('an override says who changed it and through what, with the conversation name', () => {
  assert.equal(overrideProvenance(detail({ updatedBy: 'chat:qq:10001' })), null, 'older Host: no operator, nothing new')
  const chat = detail({ updatedAt: Date.UTC(2026, 10, 15), operator: { source: 'chat', adapter: 'qq', userId: '10001', displayName: '张三' }, conversation: { adapter: 'qq', endpointId: 'bot', kind: 'group', id: '1', name: '测试群' } })
  assert.equal(chat.conversationName, '测试群')
  assert.match(overrideProvenance(chat), /^最后修改：张三（qq \/ 10001） · 在会话「测试群」的聊天里 · /)
  assert.match(overrideProvenance(chat, 'en'), /^Last changed: 张三（qq \/ 10001） · in the chat of “测试群” · /)
  assert.equal(overrideProvenance(detail({ operator: { source: 'console', principalId: 'u_1', displayName: 'admin' } })), '最后修改：admin（u_1） · 通过 Console')
  assert.equal(overrideProvenance(detail({ operator: { source: 'cli' } }), 'en'), 'Last changed: Unknown user · from the command line')
  assert.equal(detail({ operator: { source: 'fax' } }).operator, undefined, 'unknown sources are ignored')
  const page = readConversationPage({ conversations: [{ key: 'qq/bot/group:1', adapter: 'qq', endpointId: 'bot', kind: 'group', id: '1', hasOverrides: true,
    overrides: [{ plugin: 'rss', fields: ['maxItems'], revision: '1', updatedAt: 1, operator: { source: 'chat', userId: '10001' } }] }], recentAvailable: true })
  assert.deepEqual(page.items[0].overrides[0].operator, { source: 'chat', userId: '10001' })
  assert.match(source('pages/features/feature-level-panel.tsx'), /overrideProvenance\(value, i18n\.locale\)/)
})

// ── 5. console-configured-endpoint-no-enable ──────────────────────────────────────────────────

const driftReply = { authority: 'snapshot', revision: 4, configRevision: 'c1', generation: 7, canImport: true, canWriteback: true,
  entries: [{ id: 'bot-new', kind: 'config_only' }, { id: 'bot-a', kind: 'changed', instanceId: 'i-a', desiredEnabled: true, fields: [{ path: 'token', sensitive: true }, { path: 'name', sensitive: false }] },
    { id: 'bot-b', kind: 'snapshot_only', instanceId: 'i-b' }, { id: '', kind: 'changed' }],
  unverified: [{ id: 'bot-a', paths: ['secret'] }] }

test('the adapter account RPC names are the ones the protocol permission table knows', () => {
  for (const method of Object.values(ADAPTER_CONFIG_RPC)) {
    const rule = protocol.resolveConsoleRpcPermission(adapterConfigRpcType('root/qq', method))
    assert.equal(rule?.kind, 'exact', `${method} is classified by @zhin.js/console-protocol`)
  }
  assert.equal(protocol.consoleRpcPermission('plugin.root/qq.endpoint-drift'), 'endpoint.view')
  assert.equal(protocol.consoleRpcPermission('plugin.root/qq.endpoint-import'), 'endpoint.manage')
  assert.deepEqual(protocol.resolveConsoleRpcPermission('plugin.root/qq.endpoint-writeback').alsoRequires, ['ops.config.write'])
  const view = source('pages/scope/configured-account-actions.tsx')
  assert.doesNotMatch(view, /'endpoint-(?:drift|import|writeback)'/, 'the component takes the names from the model constant')
  assert.doesNotMatch(view, /return null\n}\s*$/, 'the slot is no longer empty')
})

test('configuration drift offers import / write-back by kind, with the protocol permission check', () => {
  assert.equal(readConfigDrift(null), null)
  assert.equal(readConfigDrift({ authority: 'snapshot', revision: 'x', entries: [] }), null)
  const drift = readConfigDrift(driftReply)
  assert.equal(drift.entries.length, 3, 'entries without an id are dropped')
  assert.deepEqual(driftRows(drift).map(entry => entry.id), ['bot-a', 'bot-b'], 'an account only in the file is a table row of its own')
  assert.deepEqual(importRequest(drift, 'bot-new'), { id: 'bot-new', expectedRevision: 4, expectedGeneration: 7, start: false })
  assert.deepEqual(writebackRequest(drift, ['bot-b']), { ids: ['bot-b'], expectedGeneration: 7 })

  const owner = createConsoleAccess(null)
  const byKind = Object.fromEntries(drift.entries.map(entry => [entry.id, Object.keys(driftEntryActions(drift, entry, 'root/qq', owner)).sort()]))
  assert.deepEqual(byKind, { 'bot-new': ['import'], 'bot-a': ['import', 'writeback'], 'bot-b': ['writeback'] })
  assert.deepEqual(driftEntryActions({ ...drift, canImport: false, canWriteback: false }, drift.entries[1], 'root/qq', owner), {}, 'the Host decides what it can do')

  // An account manager without configuration write may import but not write back.
  const operator = createConsoleAccess({ permissions: ['endpoint.view', 'endpoint.manage'] })
  const actions = driftEntryActions(drift, drift.entries[1], 'root/qq', operator)
  assert.deepEqual(actions.import, { allowed: true, missing: [] })
  assert.deepEqual(actions.writeback, { allowed: false, missing: ['ops.config.write'] })
  // Scoped to one account: overwriting that account is allowed, adding a new one (adapter level) is not.
  const scoped = createConsoleAccess({ permissions: ['endpoint.view'], bindings: [{ scope: { kind: 'endpoint', key: 'qq/bot-a' }, permissions: ['endpoint.manage'] }] })
  assert.equal(driftEntryActions(drift, drift.entries[1], 'root/qq', scoped).import.allowed, true)
  assert.deepEqual(driftEntryActions(drift, drift.entries[0], 'root/qq', scoped).import, { allowed: false, missing: ['endpoint.manage'] })
  assert.equal(adapterConfigPermission('root/qq', ADAPTER_CONFIG_RPC.DRIFT, undefined, createConsoleAccess({ permissions: ['status.view'] })).allowed, false)

  assert.match(writebackResultText({ saved: true, placeholders: [{ id: 'bot-b', path: 'token', variable: 'QQ_TOKEN' }] }), /请在 \.env 中设置 QQ_TOKEN/)
  assert.doesNotMatch(writebackResultText({ saved: true, placeholders: [] }, 'en'), cjk)
})

test('a configured-only account row offers 导入 or the no-permission state', () => {
  const contextValue = { adapter: 'qq', pluginId: 'root/qq', drift: readConfigDrift(driftReply), busy: null, run: async () => {} }
  const mocks = (permissions) => ({
    react: { ...React, useContext: () => contextValue },
    'lucide-react': { FileDown: 'i', FileUp: 'i', ShieldOff: 'i' },
    '@zhin.js/client': { resolvePluginId: async () => 'root/qq' },
    '@zhin.js/console-ui': { Alert: 'aside', AlertDescription: 'div', AlertTitle: 'h4', Badge: 'span', Button: 'button', useConfirm: () => ({ confirm: async () => true, ConfirmDialog: null }) },
    '../../components/status-state-model.mjs': { statusFromError: () => ({ message: '' }) },
    '../../hooks/use-console-access': { useConsoleAccess: () => createConsoleAccess(permissions) },
    '../../utils/plugin-rpc': { pluginRpc: async () => { throw new Error('unexpected') } },
  })
  const render = (permissions, props) => {
    const { ConfiguredAccountActions } = component('pages/scope/configured-account-actions.tsx', mocks(permissions))
    return renderToStaticMarkup(React.createElement(ConfiguredAccountActions, props))
  }
  assert.match(render(null, { adapter: 'qq', endpoint: 'bot-new' }), /导入到账号管理/)
  assert.equal(render(null, { adapter: 'qq', endpoint: 'bot-unknown' }), '', 'no drift entry: the slot stays empty, as before')
  const denied = render({ permissions: ['endpoint.view'] }, { adapter: 'qq', endpoint: 'bot-new' })
  assert.match(denied, /无权导入/)
  assert.match(denied, /endpoint\.manage/)
  const { ConfigDriftSection } = component('pages/scope/configured-account-actions.tsx', mocks({ permissions: ['endpoint.view', 'endpoint.manage'] }), 'en')
  const section = renderToStaticMarkup(React.createElement(ConfigDriftSection))
  assert.match(section, /Accounts differ from the configuration file/)
  assert.match(section, /Import into account management/)
  assert.match(section, /No permission to write back/)
  assert.match(section, /token \(secret\)/)
})

// ── 6. disabled-feature-as-read-failure ───────────────────────────────────────────────────────

test('a feature the Host reports as off reads as 「未启用」 with the reason, not as a failure', () => {
  const body = { success: true, data: { ...protocol.consoleFeatureDisabled('assistant-disabled'), jobs: [], eventsActive: false } }
  const data = validateAssistantJobs(body)
  assert.match(featureDisabledState(data).description, /assistant\.enabled: true/)
  assert.doesNotMatch(featureDisabledState(protocol.consoleFeatureDisabled('agent-not-installed'), 'en').description, cjk)
  assert.equal(featureDisabledState({ status: 'disabled', reason: 'future', message: 'Host 说明' }).description, 'Host 说明')
  assert.equal(featureDisabledState({ jobs: [], eventsActive: true }), null, 'older Host: a normal reply')
  assert.equal(summarizeAssistantJobs(data).disabled, featureDisabledState(data).description)
  assert.equal(summarizeAssistantJobs({ jobs: [], eventsActive: true }).disabled, undefined)
  assert.match(source('pages/assistant-jobs.tsx'), /featureDisabledState\(data, i18n\.locale\)/)
  assert.match(source('pages/cron.tsx'), /setAssistantOff\(featureDisabledState\(data, i18n\.locale\)/)
  assert.match(source('pages/TaskOverview.tsx'), /featureDisabledState\(sources\?\.assistant, i18n\.locale\)/)
})

// ── 7. config-apply-status-internal-ids ───────────────────────────────────────────────────────

test('configuration apply status speaks in settings; hashes, generations and pointers move into 详情', () => {
  assert.equal(live.configurationGroupTitle('plugins'), '插件列表')
  assert.equal(live.configurationGroupTitle('plugin-host:rss', 'en'), 'Setup of plugin rss')
  assert.equal(live.configurationGroupTitle('host:http/port'), '配置项 HTTP 服务 › port')
  assert.equal(live.configurationGroupTitle('custom-handler'), 'custom-handler')
  assert.equal(live.configurationPathLabel(['plugins', 'rss', 'maxItems']), '插件 rss › maxItems')
  assert.equal(live.configurationPathLabel(['ai', 'model'], 'en'), 'AI › model')

  const markup = locale => {
    const { ConfigurationLiveStatus } = component('components/PluginConfigForm/ConfigurationLiveStatus.tsx', {
      '@zhin.js/console-ui': { Badge: 'span', Button: 'button' }, './config-live-status.mjs': live,
    }, locale)
    const application = { operationId: 'config:1', sourceRevision: 'sha256-0123456789abcdef0123', saved: true, generation: 3, applicationRevision: 9,
      groups: [{ id: 'plugin-host:rss', paths: [['plugins', 'rss']], effect: 'restart-process', status: 'restart-pending', dependsOn: ['host-document'], reasonCode: 'needs-restart' }] }
    return renderToStaticMarkup(React.createElement(ConfigurationLiveStatus, { result: { application }, revision: application.sourceRevision }))
  }
  const zh = markup('zh-CN')
  const [visible, details] = zh.split('<details')
  assert.match(visible, /插件 rss 的装配/)
  assert.match(visible, /依赖：基础配置/)
  assert.doesNotMatch(visible, /运行代|应用序号|文件版本|sha256|needs-restart|plugin-host:/, 'no internal id outside 详情')
  assert.match(details, /运行代：3/); assert.match(details, /应用序号：9/); assert.match(details, /\/plugins\/rss/); assert.match(details, /needs-restart/)
  const en = markup('en')
  assert.match(en, /Setup of plugin rss/)
  assert.doesNotMatch(en.split('<details')[0], cjk)
})

// ── 8. endpoint-transport-raw-state ───────────────────────────────────────────────────────────

test('the 传输 fact prefers the Host transportLabel and falls back to the raw state', () => {
  assert.equal(endpointTransportText({}), null)
  assert.deepEqual(endpointTransportText({ transportState: 'open' }), { text: 'open', raw: 'open', labeled: false }, 'older Host: raw state as before')
  assert.deepEqual(endpointTransportText({ transportState: 'open', transportLabel: '已连接' }), { text: '已连接', raw: 'open', labeled: true })
  assert.equal(endpointTransportText({ transportState: 'reconnecting', transportLabel: '重连中' }, 'en').text, 'Reconnecting')
  assert.equal(endpointTransportText({ transportLabel: '自定义' }, 'en').text, '自定义')
  for (const path of ['pages/scope/endpoint-access.tsx', 'pages/scope/overview-panels.tsx']) {
    assert.match(source(path), /endpointTransportText\((?:endpoint|info), i18n\.locale\)/, path)
    assert.doesNotMatch(source(path), /<code className="text-sm">\{(?:endpoint|info)\.transportState\}<\/code>/, path)
  }
})

// ── 9. feature-matrix-adapter-only ────────────────────────────────────────────────────────────

test('the feature matrix lists the Host root row 「本项目」 apart from the switchable plugins', () => {
  const cell = { enabled: true, overridden: false }
  const payload = { revision: 'r', adapters: ['qq'], endpoints: { qq: ['bot'] }, rows: [
    { plugin: '', displayName: '本项目（my-bot）', kind: 'root', readOnly: true, capabilities: { commands: ['hello', 'card'], components: [], tools: ['t'] }, global: cell, adapters: { qq: cell } },
    { plugin: 'rss', displayName: 'RSS', kind: 'plugin', global: cell, adapters: { qq: cell } },
  ] }
  const matrix = readFeatureMatrix(payload)
  assert.deepEqual(matrix.rows.map(row => row.plugin), ['rss'], 'the root row is not a switchable plugin row')
  assert.deepEqual(matrix.root.capabilities, { commands: ['hello', 'card'], components: [], tools: ['t'] })
  assert.equal(rootFeatureName(matrix.root), '本项目（my-bot）')
  assert.equal(rootFeatureName(matrix.root, 'en'), 'This project (my-bot)')
  assert.equal(rootFeatureName({ ...matrix.root, displayName: 'My Bot', displayNameI18n: { en: 'My bot' } }, 'en'), 'My bot')
  const merged = mergeFeatureMatrix([{ plugin: 'rss', name: 'RSS', description: '', hasSchema: false, global: cell }], matrix)
  assert.equal(merged.root, matrix.root)
  assert.deepEqual(merged.rows.map(row => row.plugin), ['rss'])
  assert.equal(readFeatureMatrix({ ...payload, rows: payload.rows.slice(1) }).root, undefined, 'older Host: no root row')
  assert.throws(() => readFeatureMatrix({ ...payload, rows: [{ plugin: '', global: cell }] }), /Invalid feature\.matrix row/, 'an empty plugin id is still rejected outside the root row')
  const page = source('pages/features/feature-matrix.tsx')
  assert.match(page, /\{root \? <RootRow root=\{root\} adapters=\{adapterColumns\} \/> : null\}/)
})

// ── 10. self.chat-identity forbidden state ────────────────────────────────────────────────────

test('「我的聊天身份」 without self.chat-identity is a forbidden state, not a failure', () => {
  assert.equal(CHAT_IDENTITY_SELF_PERMISSION, protocol.CHAT_PRINCIPALS_RPC_PERMISSIONS[protocol.CHAT_PRINCIPALS_RPC.ME])
  assert.deepEqual(routePermissions({ path: '/chat-members' }), ['self.chat-identity', 'iam.manage'])
  assert.equal(canSeeRoute({ path: '/chat-members' }, createConsoleAccess({ permissions: ['self.chat-identity'] })), true)
  assert.equal(canSeeRoute({ path: '/chat-members' }, createConsoleAccess({ permissions: ['status.view'] })), false)
  for (const role of protocol.CONSOLE_BUILTIN_ROLE_NAMES) {
    assert.equal(canSeeRoute({ path: '/chat-members' }, createConsoleAccess({ permissions: protocol.CONSOLE_BUILTIN_ROLES[role].permissions })), true, role)
  }

  const requests = []
  const render = permissions => {
    const { MyChatIdentitySection } = component('scope/ChatIdentityPanels.tsx', {
      'lucide-react': new Proxy({}, { get: () => 'i' }),
      '@zhin.js/console-ui': { Badge: 'span', Button: 'button', Card: 'div', Input: 'input', Dialog: 'dialog', DialogContent: 'div', DialogDescription: 'p', DialogFooter: 'footer', DialogHeader: 'header', DialogTitle: 'h2' }, '../components/StatusState': { StatusState: props => React.createElement('status-state', { kind: props.kind ?? 'error', permissions: props.permissions?.join(',') }) },
      '../utils/console-rpc': { requestConsole: async input => { requests.push(input); return new Promise(() => {}) } },
      '../components/status-state-model.mjs': { statusFromError: () => ({ kind: 'error', message: '' }) },
      './ObjectPageLayout': { ObjectSection: ({ children }) => React.createElement('section', null, children) },
      '../hooks/use-console-access': { useConsoleAccess: () => createConsoleAccess(permissions) },
    })
    return renderToStaticMarkup(React.createElement(MyChatIdentitySection))
  }
  assert.match(render({ permissions: ['status.view'] }), /<status-state kind="forbidden" permissions="self\.chat-identity">/)
  assert.match(render({ permissions: ['self.chat-identity'] }), /<status-state kind="loading"/)
  assert.deepEqual(requests, [], 'nothing is requested while rendering')
  assert.match(source('scope/ChatIdentityPanels.tsx'), /statusFromError\(error\)\.kind === 'forbidden' \? \{ status: 'forbidden' \}/, 'a Host refusal is forbidden too')
})
