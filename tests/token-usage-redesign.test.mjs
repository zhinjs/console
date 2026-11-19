import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as usageModel from '../console-ui/src/pages/token-usage-model.mjs'

// zhinjs/zhin#1250 第 59 批：Token 用量页重排（汇总环比、服务 → 模型、Agent / 用途、详情 Sheet）
// 与第 57 批审查遗留（同名会话短键、ID 计数、ⓘ 可访问名、不透明 series 键、渲染级「原始 ID 只在 ⓘ / Sheet」）。

const {
  formatDelta, hostPreviousTotals, isNotableDelta, mergeUsageModels, previousUsageInput, topSeriesKeys, usageAgentLabel, usageCapabilities, usageDelta,
  usageModelIdGroups, usageModelLabel, usagePurposeLabel, usageServiceGroups, usageSessionLabel, usageSessionNames, usageSessionShortKey, usageTrendSeries,
  validateUsageStats,
} = usageModel

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const NIGHT = 'services:5e6ea66f-9b1d-4c3e-8a77-2f1d0c4b535a'
const NIGHT_ACCOUNT = 'accounts:3b7e1f20-9c4d-4a8b-bc15-6d2e0f9a1c47'
const DEEPSEEK = 'services:0c8f2a51-63d4-4b8e-9f10-7a2e64c1d9b0'
const REMOVED = 'profiles:9d41e7c2-58ab-4f6e-b2c0-1e3f5a7d8c90'
const HASHED = `personal-session:v1:${'ab12cd34'.padEnd(64, 'e')}`
const tokens = (calls, inputTokens, cacheReadTokens = 0) => ({ calls, inputTokens, outputTokens: calls * 10, cacheReadTokens })

/** The Host shape before zhin 第 58 批. */
function legacyStats() {
  const byModel = [
    { provider: NIGHT, model: 'gpt-6-luna', displayName: 'Night Router · gpt-6-luna', providerLabel: 'Night Router', providerIds: [NIGHT_ACCOUNT, NIGHT], claimsWithoutToolCall: 0, ...tokens(6, 6000, 3000) },
    { provider: NIGHT, model: 'gpt-6-luna-mini', displayName: 'Night Router · gpt-6-luna-mini', providerLabel: 'Night Router', providerIds: [NIGHT], claimsWithoutToolCall: 0, ...tokens(2, 1000, 200) },
    { provider: DEEPSEEK, model: 'deepseek-v4-flash', displayName: 'DeepSeek · deepseek-v4-flash', providerLabel: 'DeepSeek', providerIds: [DEEPSEEK], claimsWithoutToolCall: 1, ...tokens(3, 2500) },
    { provider: REMOVED, model: 'gemini-3.8-flash', displayName: 'gemini-3.8-flash', providerIds: [REMOVED], claimsWithoutToolCall: 0, ...tokens(1, 500) },
  ]
  return {
    range: { since: 0, until: 2 * 86_400_000, bucket: 'day', timeZone: 'Asia/Shanghai' },
    totals: { turns: 5, ...tokens(12, 10_000, 3200), cacheShare: 0.32 },
    byModel,
    bySession: [
      { sessionKey: 'icqq:bot-a:group:1', platform: 'icqq', endpoint: 'bot-a', scope: 'group', sceneId: '1', displayName: 'icqq · 群 产品试验群', turns: 2, ...tokens(5, 5000, 2000) },
      { sessionKey: 'icqq:bot-b:group:1', platform: 'icqq', endpoint: 'bot-b', scope: 'group', sceneId: '1', displayName: 'icqq · 群 产品试验群', turns: 1, ...tokens(3, 3000, 1000) },
      { sessionKey: HASHED, turns: 1, ...tokens(2, 1500, 200) },
      { sessionKey: 'icqq:bot-a:private:9', platform: 'icqq', scope: 'private', sceneId: '9', displayName: 'icqq · 私聊 小明', turns: 1, ...tokens(2, 500) },
    ],
    series: [
      { bucketStart: 0, ...tokens(6, 5000, 1600), byModel: { [`${NIGHT}/gpt-6-luna`]: 3000, [`${DEEPSEEK}/deepseek-v4-flash`]: 2000 } },
      { bucketStart: 86_400_000, ...tokens(6, 5000, 1600), byModel: { [`${NIGHT}/gpt-6-luna`]: 3000, [`${NIGHT}/gpt-6-luna-mini`]: 1000, [`${DEEPSEEK}/deepseek-v4-flash`]: 500, [`${REMOVED}/gemini-3.8-flash`]: 500 } },
    ],
    modelLabels: Object.fromEntries(byModel.map(row => [`${row.provider}/${row.model}`, row.displayName])),
    promptCacheHints: [{ provider: DEEPSEEK, label: 'DeepSeek', providerIds: [DEEPSEEK], zeroCacheCalls: 12, sessions: 3, samePrefixRatio: 0.9 }],
    segments: { history: 5000, fixed: 3000, user: 2000 }, filesRead: 1, malformedLines: 0,
  }
}

/** The same data with zhin 第 58 批's optional fields. */
function v2Stats() {
  const stats = legacyStats()
  stats.schemaVersion = 2
  stats.byModel[0] = { ...stats.byModel[0], driverLabel: 'OpenAI 兼容', profileId: 'profiles:1f0e', profileName: '夜间主力' }
  stats.bySession = [
    ...stats.bySession.map((row, index) => index < 2 ? { ...row, scopeKind: 'group', sceneLabel: '产品试验群', shortKey: row.sessionKey, accountLabel: index ? '客服号' : '社区号' } : { ...row, shortKey: usageSessionShortKey(row) }),
    { sessionKey: 'http:api:session:7f3a9c21-55d0', displayName: 'HTTP', scopeKind: 'http', shortKey: 'http:api:session:7f3a9c21-55d0', turns: 1, ...tokens(1, 100) },
    { sessionKey: 'http:api:session:c41e0b8d-2f6a', displayName: 'HTTP', scopeKind: 'http', shortKey: 'http:api:session:c41e0b8d-2f6a', turns: 1, ...tokens(1, 100) },
  ]
  stats.sessionsTotal = 9
  stats.othersTotals = { sessions: 3, turns: 3, ...tokens(3, 900), cacheWriteTokens: 0, cacheShare: 0 }
  stats.byAgent = [{ agent: '@main', label: '主助手', kind: 'main', turns: 4, ...tokens(9, 8000) }, { agent: 'researcher', label: 'researcher', kind: 'agent', turns: 1, ...tokens(3, 2000) }]
  stats.byPurpose = [{ purpose: 'chat', label: '对话', turns: 4, ...tokens(9, 8000) }, { purpose: 'ambient-judge', label: '插话判断', turns: 1, ...tokens(3, 2000) }]
  stats.previous = { since: -2 * 86_400_000, until: 0, truncated: false, totals: { turns: 4, ...tokens(10, 5000, 2500), cacheShare: 0.5 } }
  return stats
}

test('merging keeps claimsWithoutToolCall sums, service / model parts and splits same-named services of different Drivers', () => {
  const stats = legacyStats()
  stats.byModel.push({ provider: 'services:aa11', model: 'deepseek-v4-flash', displayName: 'DeepSeek · deepseek-v4-flash', providerLabel: 'DeepSeek', providerIds: ['services:aa11'], claimsWithoutToolCall: 4, ...tokens(1, 100) })
  const merged = mergeUsageModels(validateUsageStats(stats))
  const deepseek = merged.byModel.find(row => row.model === 'DeepSeek · deepseek-v4-flash')
  assert.equal(deepseek.claimsWithoutToolCall, 5, 'claims of merged rows add up')
  assert.equal(deepseek.calls, 4)
  assert.equal(deepseek.serviceName, 'DeepSeek')
  assert.equal(deepseek.modelName, 'deepseek-v4-flash')
  assert.equal(merged.byModel.find(row => row.modelName === 'gemini-3.8-flash').serviceName, '未知服务')
  assert.equal(merged.modelServices['Night Router · gpt-6-luna-mini'], 'Night Router')

  // Two services named 「OpenAI」 on different Drivers stay apart and carry the Driver.
  const twins = legacyStats()
  twins.byModel = [
    { provider: 'services:a1', model: 'm', displayName: 'OpenAI · m', providerLabel: 'OpenAI', driverLabel: 'OpenAI', providerIds: ['services:a1'], ...tokens(1, 10) },
    { provider: 'services:b2', model: 'm', displayName: 'OpenAI · m', providerLabel: 'OpenAI', driverLabel: 'Azure OpenAI', providerIds: ['services:b2'], ...tokens(1, 20) },
  ]
  twins.series = [{ bucketStart: 0, ...tokens(2, 30), byModel: { 'services:a1/m': 10, 'services:b2/m': 20 } }]
  const split = mergeUsageModels(twins)
  assert.deepEqual(split.byModel.map(row => row.model).sort(), ['OpenAI（Azure OpenAI） · m', 'OpenAI（OpenAI） · m'])
  assert.deepEqual(Object.keys(split.series[0].byModel).sort(), ['OpenAI（Azure OpenAI） · m', 'OpenAI（OpenAI） · m'])
})

test('a name carrying an opaque id anywhere is not used, and an opaque series key without a model is 「未知服务」', () => {
  assert.equal(usageModelLabel({ provider: NIGHT, model: 'm', displayName: `Night Router（${NIGHT}） · m`, providerLabel: 'Night Router' }), 'Night Router · m')
  assert.equal(usageModelLabel({ provider: NIGHT, model: 'm', providerLabel: `名称（${NIGHT}）` }), '未知服务 · m')
  assert.equal(usageModelLabel({ provider: NIGHT, model: 'm', displayName: `名称（${NIGHT}）` }, null, 'en'), 'Unknown service · m')
  const stats = legacyStats()
  stats.series[0].byModel[NIGHT] = 7
  stats.series[0].byModel['plainkey'] = 1
  const merged = mergeUsageModels(stats)
  assert.equal(merged.series[0].byModel['未知服务'], 7, 'an opaque key without `/` is named 「未知服务」')
  assert.equal(merged.series[0].byModel.plainkey, 1, 'a readable key without `/` stays as it is')
  for (const key of Object.keys(merged.series[0].byModel)) assert.doesNotMatch(key, /(services|accounts|profiles):/)
  assert.equal(mergeUsageModels(stats, 'en').series[0].byModel['Unknown service'], 7)
})

test('the id count next to a model matches the ids listed, in groups', () => {
  const merged = mergeUsageModels(legacyStats())
  const luna = merged.byModel.find(row => row.model === 'Night Router · gpt-6-luna')
  const groups = usageModelIdGroups(luna)
  assert.deepEqual(groups, [{ kind: 'keys', ids: [`${NIGHT}/gpt-6-luna`] }, { kind: 'services', ids: [NIGHT_ACCOUNT, NIGHT] }])
  assert.equal(groups.flatMap(group => group.ids).length, usageModel.usageModelIds(luna).length)
  assert.deepEqual(usageModelIdGroups({ provider: 'x', model: 'y', rawKeys: ['x/y'], providerIds: ['x/y'] }), [{ kind: 'keys', ids: ['x/y'] }], 'an id is listed once')
})

test('same-named sessions get a short key; scopeKind / sceneLabel are localized; English shows no Chinese type words', () => {
  const v2 = v2Stats()
  const names = usageSessionNames(v2.bySession)
  assert.deepEqual(names.get('icqq:bot-a:group:1'), { name: 'icqq · 群 产品试验群', qualifier: 'icqq:bot-a:group:1' })
  assert.deepEqual(names.get('icqq:bot-b:group:1'), { name: 'icqq · 群 产品试验群', qualifier: 'icqq:bot-b:group:1' })
  assert.equal(names.get('http:api:session:7f3a9c21-55d0').name, 'HTTP')
  assert.equal(names.get('http:api:session:7f3a9c21-55d0').qualifier, 'http:api:session:7f3a9c21-55d0'.replace(/^(.{12}).*(.{11})$/, '$1…$2'))
  assert.notEqual(names.get('http:api:session:7f3a9c21-55d0').qualifier, names.get('http:api:session:c41e0b8d-2f6a').qualifier)
  assert.equal(names.get(HASHED).qualifier, '', 'a unique name has no qualifier')
  // Without shortKey (older Host): hashed keys by their first 8 hex digits, others shortened in the middle.
  const legacy = usageSessionNames(legacyStats().bySession)
  assert.equal(legacy.get('icqq:bot-a:group:1').qualifier, 'icqq:bot-a:group:1')
  assert.equal(usageSessionShortKey({ sessionKey: HASHED }), 'personal-session:ab12cd34')
  // Shortened keys that would still look alike fall back to the account part of the key.
  const twins = usageSessionNames([
    { sessionKey: 'icqq:preview-community:group:20001', displayName: 'icqq · 群 产品试验群' },
    { sessionKey: 'icqq:preview-support:group:20001', displayName: 'icqq · 群 产品试验群' },
  ])
  assert.deepEqual([...twins.values()].map(item => item.qualifier), ['preview-community', 'preview-support'])
  assert.equal(usageSessionShortKey({ sessionKey: 'telegram:an-account-with-a-long-name:group:-100123456789' }).length, 24)

  const group = translate('en', '群')
  assert.equal(usageSessionLabel(v2.bySession[0], 'en'), `icqq · ${group} 产品试验群`)
  assert.equal(usageSessionLabel(legacyStats().bySession[0], 'en'), `icqq · ${group} 产品试验群`, 'an older displayName gets its type word translated')
  assert.equal(usageSessionLabel(legacyStats().bySession[3], 'en'), `icqq · ${translate('en', '私聊')} 小明`)
  assert.equal(usageSessionLabel({ sessionKey: 'schedule:x', scopeKind: 'schedule', sceneLabel: 'daily' }, 'en'), 'Scheduled task daily')
  assert.equal(usageSessionLabel({ sessionKey: 'a2a:x', scopeKind: 'a2a' }), 'A2A')
  for (const row of [...v2.bySession, ...legacyStats().bySession]) assert.doesNotMatch(usageSessionLabel(row, 'en'), / · (?:群|私聊|频道) |^(?:群|私聊|频道) |私聊会话|场景任务/)
})

test('previous window: the Host value unless missing or cut short; otherwise the Console asks for the same length right before', () => {
  assert.equal(hostPreviousTotals(legacyStats()), null)
  assert.equal(hostPreviousTotals(v2Stats()).inputTokens, 5000)
  assert.equal(hostPreviousTotals({ previous: { ...v2Stats().previous, truncated: true } }), null, 'a truncated window would mislead')
  assert.equal(hostPreviousTotals({ previous: { totals: { calls: 'x' } } }), null)
  assert.deepEqual(previousUsageInput({ since: 1000, until: 1600, bucket: 'hour', session: 'icqq:*' }), { since: 400, until: 1000, bucket: 'hour', session: 'icqq:*' })
  assert.equal(previousUsageInput({ since: 0, until: 10, bucket: 'day' }), null)

  assert.deepEqual(usageDelta(112, 100), { kind: 'change', ratio: 0.12 })
  assert.deepEqual(usageDelta(5, 0), { kind: 'new' })
  assert.deepEqual(usageDelta(0, 0), { kind: 'same' })
  assert.equal(usageDelta(1, undefined), null)
  assert.equal(formatDelta(usageDelta(112, 100)), '↑12%')
  assert.equal(formatDelta(usageDelta(0.4, 0.5, { points: true }), 'zh-CN', { points: true }), '↓10 个百分点')
  assert.equal(formatDelta(usageDelta(0.4, 0.5, { points: true }), 'en', { points: true }), '↓10 pts')
  assert.equal(isNotableDelta(usageDelta(150, 100)), false, 'an ordinary rise stays neutral')
  assert.equal(isNotableDelta(usageDelta(200, 100)), true)
  assert.equal(isNotableDelta(usageDelta(0.2, 0.5, { points: true }), { points: true }), true)
})

test('optional dimensions are read only when present and well formed', () => {
  const old = usageCapabilities(legacyStats())
  assert.deepEqual([old.schemaVersion, old.agents.length, old.purposes.length, old.agentSeries, old.others], [1, 0, 0, false, null])
  const next = usageCapabilities(v2Stats())
  assert.deepEqual([next.schemaVersion, next.agents.length, next.purposes.length, next.agentSeries, next.others.sessions], [2, 2, 2, false, 3])
  const broken = usageCapabilities({ ...v2Stats(), byAgent: [{ agent: 'x', calls: 'many' }, ...v2Stats().byAgent], byPurpose: 'chat' })
  assert.equal(broken.agents.length, 2, 'a malformed row is left out')
  assert.equal(broken.purposes.length, 0)
  assert.equal(usageAgentLabel({ agent: '@main', label: '主助手' }, 'en'), 'Main assistant')
  assert.equal(usageAgentLabel({ agent: 'researcher' }, 'en'), 'researcher')
  assert.equal(usagePurposeLabel({ purpose: 'ambient-judge', label: '插话判断' }, 'en'), translate('en', '插话判断'))
  assert.equal(usagePurposeLabel({ purpose: 'custom-x', label: '自定义' }, 'en'), 'custom-x', 'an unknown purpose is not shown with a Chinese Host label in English')

  const withSeries = v2Stats()
  withSeries.series = withSeries.series.map(point => ({ ...point, byAgent: { '@main': 4000, researcher: 1000 } }))
  assert.equal(usageCapabilities(withSeries).agentSeries, true)
  assert.deepEqual(usageTrendSeries(withSeries, 'agent')[0].byModel, { 主助手: 4000, researcher: 1000 })
})

test('services group their models; the trend sums by service', () => {
  const merged = mergeUsageModels(legacyStats())
  const groups = usageServiceGroups(merged.byModel)
  assert.deepEqual(groups.map(group => [group.name, group.models.length, group.inputTokens]), [['Night Router', 2, 7000], ['DeepSeek', 1, 2500], ['未知服务', 1, 500]])
  assert.equal(groups[0].share, 0.7)
  assert.deepEqual(groups[0].providerIds, [NIGHT_ACCOUNT, NIGHT])
  const byService = usageTrendSeries(merged, 'service')
  assert.deepEqual(byService[1].byModel, { 'Night Router': 4000, DeepSeek: 500, 未知服务: 500 })
  assert.deepEqual(topSeriesKeys(byService, 2), ['Night Router', 'DeepSeek'])
})

// ── Render: raw ids only in ⓘ / tooltip / Sheet ─────────────────────────────────────────────────

const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
function compile(source, mocks) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions }).outputText)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const h = React.createElement
const tag = name => name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
function consoleUi({ narrow }) {
  const special = {
    cn: (...classes) => classes.filter(Boolean).join(' '),
    useContainerAtLeast: () => !narrow,
    InfoHint: ({ label, children }) => h('info-hint', null, h('span', null, label), children),
    Sheet: ({ open, children }) => open ? h('sheet-root', null, children) : null,
    StatCard: ({ label, value, sub, footer }) => h('stat-card', null, label, ' ', value, sub, footer),
    StatGrid: ({ children }) => h('stat-grid', null, children),
    Disclosure: ({ summary, description, badge, children, defaultOpen }) => h('details', { open: defaultOpen }, h('summary', null, summary, description, badge), children),
    SelectField: ({ options, 'aria-label': label }) => h('select-field', { 'aria-label': label }, options.map(option => h('option', { key: option.value }, option.label))),
    KeyValueList: ({ items }) => h('dl', null, items.map(item => h('div', { key: item.key }, h('dt', null, item.label), h('dd', null, item.value)))),
    ProgressMeter: () => h('progress-meter'),
  }
  return new Proxy({}, { get: (_, name) => special[name] ?? tag(String(name)) })
}
const reportSource = await readFile(new URL('../console-ui/src/pages/token-usage-report.tsx', import.meta.url), 'utf8')
const chartsSource = await readFile(new URL('../console-ui/src/pages/token-usage-charts.tsx', import.meta.url), 'utf8')
function renderReport(stats, { narrow = false, locale = 'zh-CN', selection = null, view = 'models' } = {}) {
  const i18n = { locale, t: (message, values) => translate(locale, message, values) }
  const ui = consoleUi({ narrow })
  const base = { '../i18n': { useI18n: () => i18n }, '@zhin.js/console-ui': ui, './token-usage-model.mjs': usageModel, 'lucide-react': new Proxy({}, { get: () => 'svg' }) }
  const charts = compile(chartsSource, base)
  const report = compile(reportSource, { ...base, './token-usage-charts': charts, './features/conversation-list': { ConversationKindBadge: ({ kind }) => h('kind-badge', null, kind) }, './clipboard-copy.mjs': { copyText: async () => true } })
  const merged = mergeUsageModels(validateUsageStats(stats, locale), locale)
  return renderToStaticMarkup(h(report.UsageReport, { stats: merged, previous: hostPreviousTotals(merged), view, onViewChange() {}, onPickSession() {}, initialSelection: selection }))
}
const RAW = /(?:services|accounts|profiles):[0-9a-f]|personal-session:v1:|http:api:session:/
/** The markup with every place a raw id may appear (ⓘ panel, tooltip, Sheet) cut out. */
const mainView = html => html.replace(/<info-hint>[\s\S]*?<\/info-hint>/g, '').replace(/<tooltip-content[^>]*>[\s\S]*?<\/tooltip-content>/g, '').replace(/<sheet-root>[\s\S]*<\/sheet-root>/g, '')

for (const [shape, stats] of [['legacy', legacyStats], ['v2', v2Stats]]) for (const narrow of [false, true]) for (const view of ['models', 'sessions']) {
  test(`render (${shape}, ${narrow ? 'narrow' : 'wide'}, ${view}): raw ids only in ⓘ, tooltips and the Sheet`, () => {
    const html = renderReport(stats(), { narrow, view })
    assert.doesNotMatch(mainView(html), RAW, 'no raw id in the main view')
    assert.match(html, /Night Router/)
    if (view === 'sessions') {
      // Same-named groups are told apart by a visible short key, at every width.
      assert.match(mainView(html), /icqq:bot-a:group:1/)
      assert.match(mainView(html), /icqq:bot-b:group:1/)
      assert.match(mainView(html), /私聊会话 #ab12cd34/)
    }
    if (view === 'models' && !narrow) {
      assert.match(html, /<info-hint><span><span class="sr-only">Night Router · gpt-6-luna 的 ID<\/span>/, 'the ⓘ is named after its model')
      assert.match(html.match(/<info-hint>[\s\S]*?<\/info-hint>/)[0], new RegExp(`合并自 3 个 ID[\\s\\S]*统计键（1）[\\s\\S]*服务 / 账号 ID（2）`))
    }
    assert.equal(/<tabs/.test(html), !narrow, 'tabs on wide containers')
    assert.equal(/<select-field aria-label="明细维度"/.test(html), narrow, 'a select on narrow containers')
    assert.equal(/>Agent</.test(html), shape === 'v2', 'the Agent tab only with byAgent')
    assert.equal(/较上一周期/.test(html), shape === 'v2', 'the change shows with the Host previous window')
    assert.match(html, /<details open="">/, 'the cache section is open while a cache alert is up')
  })
}

test('render: the Sheet shows every number and the raw ids with a copy button', () => {
  const model = renderReport(v2Stats(), { selection: { kind: 'model', key: 'Night Router · gpt-6-luna' } })
  const sheet = model.match(/<sheet-root>[\s\S]*<\/sheet-root>/)[0]
  for (const text of [NIGHT, NIGHT_ACCOUNT, `${NIGHT}/gpt-6-luna`, '夜间主力', 'OpenAI 兼容', '复制 ID', '缓存读取', '占总输入']) assert.ok(sheet.includes(text), text)
  const session = renderReport(v2Stats(), { selection: { kind: 'session', key: HASHED }, view: 'sessions' })
  const sessionSheet = session.match(/<sheet-root>[\s\S]*<\/sheet-root>/)[0]
  assert.ok(sessionSheet.includes(HASHED), 'the full session key is in the Sheet')
  assert.match(sessionSheet, /只看这个会话/)
  assert.doesNotMatch(mainView(session), RAW)
})

test('render in English: no Chinese type words or Host labels in names', () => {
  const html = mainView(renderReport(v2Stats(), { locale: 'en', view: 'sessions' }))
  assert.doesNotMatch(html, / · (?:群|私聊|频道) |私聊会话|主助手|未知服务/)
  assert.match(html, /Unknown service|Night Router/)
})

test('render without cache alerts keeps the cache section folded', () => {
  const stats = legacyStats()
  stats.promptCacheHints = []
  assert.match(renderReport(stats), /<details>/)
})

// ── The preview Host fixture answers both shapes, and both render ───────────────────────────────

const { spawn } = await import('node:child_process')
async function previewUsage(env, data) {
  const port = 20_000 + Math.floor(Math.random() * 20_000)
  const child = spawn(process.execPath, [new URL('../scripts/ui-preview-host.mjs', import.meta.url).pathname, String(port)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', chunk => { if (String(chunk).includes('Read-only UI fixture')) resolve() }); child.on('exit', reject) })
    const response = await fetch(`http://127.0.0.1:${port}/api/console/request`, { method: 'POST', headers: { authorization: 'Bearer ui-preview', 'content-type': 'application/json' }, body: JSON.stringify({ type: 'plugin.root.usage-stats', data }) })
    return (await response.json()).data
  } finally { child.kill() }
}

test('preview Host: the batch-58 shape and the legacy shape both render without raw ids', async () => {
  const now = Date.now()
  const input = { since: now - 7 * 86_400_000, until: now, bucket: 'day', compare: 'previous' }
  const v2 = await previewUsage({}, input)
  assert.equal(v2.schemaVersion, 2)
  assert.ok(v2.byAgent.length && v2.byPurpose.length && v2.previous.totals.inputTokens < v2.totals.inputTokens)
  assert.ok(v2.bySession.every(row => typeof row.shortKey === 'string'))
  const legacy = await previewUsage({ UI_PREVIEW_USAGE: 'legacy' }, input)
  for (const field of ['schemaVersion', 'byAgent', 'byPurpose', 'previous', 'sessionsTotal', 'othersTotals']) assert.equal(field in legacy, false, field)
  assert.ok(legacy.bySession.every(row => !('shortKey' in row) && !('scopeKind' in row)))
  for (const stats of [v2, legacy]) for (const view of ['models', 'sessions']) for (const narrow of [false, true]) {
    const html = renderReport(stats, { view, narrow })
    assert.doesNotMatch(mainView(html), RAW)
    assert.match(html, /Night Router/)
  }
  // The legacy shape falls back to a second request for the previous window.
  const previous = await previewUsage({ UI_PREVIEW_USAGE: 'legacy' }, previousUsageInput(input))
  assert.ok(previous.totals.inputTokens < legacy.totals.inputTokens)
})
