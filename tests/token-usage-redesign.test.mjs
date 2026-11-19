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
  formatDelta, hostPreviousTotals, isNotableDelta, mergeUsageModels, previousUsageInput, previousUsagePlan, topSeriesKeys, usageAccountLabel, usageAgentLabel,
  usageCapabilities, usageDelta, usageModelIdGroups, usageModelLabel, usageProfileName, usagePurposeLabel, usageServiceGroups, usageSessionLabel, usageSessionNames,
  usageSessionShortKey, usageTrendSeries, validateUsageStats,
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
    ...stats.bySession.map((row, index) => index < 2 ? { ...row, scopeKind: 'group', sceneLabel: '产品试验群', shortKey: row.sessionKey, accountLabel: index ? '客服号' : '社区号' }
      // Batch 58 sends the platform of a hashed key from the recorded origin.
      : row.sessionKey === HASHED ? { ...row, platform: 'icqq', endpoint: 'bot-a', shortKey: usageSessionShortKey(row) }
      : { ...row, shortKey: usageSessionShortKey(row) }),
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
  // English uses ASCII brackets for the Driver.
  assert.deepEqual(mergeUsageModels(twins, 'en').byModel.map(row => row.model).sort(), ['OpenAI (Azure OpenAI) · m', 'OpenAI (OpenAI) · m'])
  for (const row of mergeUsageModels(twins, 'en').byModel) assert.doesNotMatch(row.model, /[（）]/)
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

/** Every raw part of a session row that must not become a visible qualifier. */
function rawParts(row) {
  const parts = [row.sessionKey, row.shortKey, row.endpoint, usageSessionShortKey(row), ...String(row.sessionKey).split(':').filter(part => part.length >= 4)]
  return parts.filter(part => typeof part === 'string' && part)
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}/i
function assertReadableQualifiers(rows, names) {
  for (const row of rows) {
    const { qualifier } = names.get(row.sessionKey)
    if (!qualifier) continue
    assert.doesNotMatch(qualifier, UUID, `${row.sessionKey}: no uuid in the qualifier`)
    for (const part of rawParts(row)) assert.ok(!qualifier.includes(part), `${row.sessionKey}: qualifier ${qualifier} shows raw ${part}`)
  }
}

test('same-named sessions are told apart by the account name, else by 「#n」; never by a raw key; English shows no Chinese type words', () => {
  const v2 = v2Stats()
  const names = usageSessionNames(v2.bySession)
  assert.deepEqual(names.get('icqq:bot-a:group:1'), { name: 'icqq · 群 产品试验群', qualifier: '社区号' })
  assert.deepEqual(names.get('icqq:bot-b:group:1'), { name: 'icqq · 群 产品试验群', qualifier: '客服号' })
  // Two HTTP sessions without an account name: their position, in list (usage) order.
  assert.deepEqual(names.get('http:api:session:7f3a9c21-55d0'), { name: 'HTTP', qualifier: '#1' })
  assert.deepEqual(names.get('http:api:session:c41e0b8d-2f6a'), { name: 'HTTP', qualifier: '#2' })
  assert.equal(names.get(HASHED).qualifier, '', 'a unique name has no qualifier')
  assertReadableQualifiers(v2.bySession, names)
  // Without accountLabel (older Host): positions, not the key or the endpoint.
  const legacyRows = legacyStats().bySession
  const legacy = usageSessionNames(legacyRows)
  assert.deepEqual([legacy.get('icqq:bot-a:group:1').qualifier, legacy.get('icqq:bot-b:group:1').qualifier], ['#1', '#2'])
  assertReadableQualifiers(legacyRows, legacy)
  assert.equal(usageSessionNames(legacyRows, 'en').get('icqq:bot-b:group:1').qualifier, '#2')
  // An account name two rows share, an opaque id or the bare endpoint is no qualifier either: positions again.
  const twins = [
    { sessionKey: 'icqq:preview-community:group:20001', endpoint: 'preview-community', displayName: 'icqq · 群 产品试验群', accountLabel: '同名号' },
    { sessionKey: 'icqq:preview-support:group:20001', endpoint: 'preview-support', displayName: 'icqq · 群 产品试验群', accountLabel: '同名号' },
    { sessionKey: 'icqq:8596238:group:20001', endpoint: '8596238', displayName: 'icqq · 群 产品试验群', accountLabel: '8596238' },
    { sessionKey: 'icqq:x:group:20001', endpoint: 'x', displayName: 'icqq · 群 产品试验群', accountLabel: NIGHT_ACCOUNT },
    { sessionKey: 'icqq:y:group:20001', endpoint: 'y', displayName: 'icqq · 群 产品试验群', accountLabel: '运营号' },
  ]
  const twinNames = usageSessionNames(twins)
  assert.deepEqual(twins.map(row => twinNames.get(row.sessionKey).qualifier), ['#1', '#2', '#3', '#4', '运营号'])
  assertReadableQualifiers(twins, twinNames)
  // The short key stays for the tooltip / detail.
  assert.equal(usageSessionShortKey({ sessionKey: HASHED }), 'personal-session:ab12cd34')
  assert.equal(usageSessionShortKey({ sessionKey: 'telegram:an-account-with-a-long-name:group:-100123456789' }).length, 24)

  const group = translate('en', '群')
  assert.equal(usageSessionLabel(v2.bySession[0], 'en'), `icqq · ${group} 产品试验群`)
  assert.equal(usageSessionLabel(legacyStats().bySession[0], 'en'), `icqq · ${group} 产品试验群`, 'an older displayName gets its type word translated')
  assert.equal(usageSessionLabel(legacyStats().bySession[3], 'en'), `icqq · ${translate('en', '私聊')} 小明`)
  assert.equal(usageSessionLabel({ sessionKey: 'schedule:x', scopeKind: 'schedule', sceneLabel: 'daily' }, 'en'), 'Scheduled task daily')
  assert.equal(usageSessionLabel({ sessionKey: 'a2a:x', scopeKind: 'a2a' }), 'A2A')
  // An older Host's displayName without a name part, and its task prefixes, are translated too.
  assert.equal(usageSessionLabel({ sessionKey: 'icqq:bot:group:1', displayName: 'icqq · 群' }, 'en'), `icqq · ${group}`)
  assert.equal(usageSessionLabel({ sessionKey: 'icqq:bot:group:1', displayName: 'icqq · 群' }), 'icqq · 群')
  assert.equal(usageSessionLabel({ sessionKey: 'schedule:abc', displayName: '定时任务 daily' }, 'en'), 'Scheduled task daily')
  assert.equal(usageSessionLabel({ sessionKey: 'schedule:abc', displayName: '定时任务' }, 'en'), 'Scheduled task')
  assert.equal(usageSessionLabel({ sessionKey: 'internal:abc', displayName: '内部 compaction' }, 'en'), 'Internal task compaction')
  assert.equal(usageSessionLabel({ sessionKey: 'internal:abc', displayName: '内部任务 compaction' }, 'en'), 'Internal task compaction')
  assert.equal(usageSessionLabel({ sessionKey: 'internal:abc', displayName: '内部' }, 'en'), 'Internal task')
  assert.equal(usageSessionLabel({ sessionKey: 'internal:abc', displayName: '内部 compaction' }), '内部任务 compaction')
  for (const displayName of ['icqq · 群', 'icqq · 私聊', '定时任务 x', '定时任务', '内部 x', '内部']) {
    assert.doesNotMatch(usageSessionLabel({ sessionKey: 'k:1', displayName }, 'en'), /[群私聊频道定时任务内部]/u, displayName)
  }
  for (const row of [...v2.bySession, ...legacyStats().bySession]) assert.doesNotMatch(usageSessionLabel(row, 'en'), / · (?:群|私聊|频道) |^(?:群|私聊|频道) |私聊会话|场景任务/)
})

test('previous window: the Host value; none when cut short; an older Host gets the same length right before', () => {
  assert.equal(hostPreviousTotals(legacyStats()), null)
  assert.equal(hostPreviousTotals(v2Stats()).inputTokens, 5000)
  assert.equal(hostPreviousTotals({ previous: { ...v2Stats().previous, truncated: true } }), null, 'a truncated window would mislead')
  assert.equal(hostPreviousTotals({ previous: { totals: { calls: 'x' } } }), null)
  assert.deepEqual(previousUsageInput({ since: 1000, until: 1600, bucket: 'hour', session: 'icqq:*' }), { since: 400, until: 1000, bucket: 'hour', session: 'icqq:*' })
  assert.equal(previousUsageInput({ since: 0, until: 10, bucket: 'day' }), null)
  // A window the epoch would cut short is no previous window.
  assert.equal(previousUsageInput({ since: 400, until: 1000, bucket: 'hour' }), null)
  assert.deepEqual(previousUsageInput({ since: 500, until: 1000, bucket: 'hour' }), { since: 0, until: 500, bucket: 'hour' }, 'exactly as long is fine')

  // The second request uses the main request's time zone: its own, else the one the Host answered in.
  const input = { since: 1000, until: 1600, bucket: 'hour' }
  assert.equal(previousUsageInput(input, legacyStats()).timeZone, 'Asia/Shanghai')
  assert.equal(previousUsageInput({ ...input, timeZone: 'Europe/Berlin' }, legacyStats()).timeZone, 'Europe/Berlin')
  assert.equal('timeZone' in previousUsageInput(input, { range: {} }), false, 'no zone is invented')

  // An untruncated `previous` (any range up to 31 days, 「近 30 天」 included) needs no second request.
  const full = previousUsagePlan(v2Stats(), input)
  assert.deepEqual([full.totals.inputTokens, full.request], [5000, undefined])
  // Cut short (only near the epoch): no change is shown, and the same short window is not asked for again.
  const cut = v2Stats()
  cut.previous = { ...cut.previous, since: -86_400_000, truncated: true }
  assert.deepEqual(previousUsagePlan(cut, input), {})
  assert.deepEqual(previousUsagePlan({ ...cut, previous: { truncated: true } }, input), {}, 'even with malformed totals')
  // Absent (older Host): the Console asks for the full window, in the same zone.
  const plan = previousUsagePlan(legacyStats(), input)
  assert.equal(plan.totals, undefined)
  assert.deepEqual(plan.request, { since: 400, until: 1000, bucket: 'hour', timeZone: 'Asia/Shanghai' })
  assert.deepEqual(previousUsagePlan(legacyStats(), { since: 300, until: 1000, bucket: 'hour' }), {}, 'an older Host near the epoch: no shorter window either')
  assert.deepEqual(previousUsagePlan(legacyStats(), { since: 0, until: 10, bucket: 'day' }), {}, 'nothing before the epoch')

  assert.deepEqual(usageDelta(112, 100), { kind: 'change', ratio: 0.12 })
  assert.deepEqual(usageDelta(5, 0), { kind: 'new' })
  assert.deepEqual(usageDelta(0, 0), { kind: 'same' })
  assert.equal(usageDelta(1, undefined), null)
  assert.equal(formatDelta(usageDelta(112, 100)), '↑12%')
  // Huge rises stay short: whole percent from ×10 on, grouped digits.
  assert.equal(formatDelta(usageDelta(1_234_567, 1)), '↑123,456,600%')
  assert.equal(formatDelta(usageDelta(25, 2)), '↑1,150%')
  assert.equal(formatDelta(usageDelta(10.5, 1), 'en'), '↑950%')
  assert.equal(formatDelta(usageDelta(1, 3)), '↓66.7%')
  assert.equal(isNotableDelta(usageDelta(1_234_567, 1)), true)
  assert.equal(formatDelta(usageDelta(0.4, 0.5, { points: true }), 'zh-CN', { points: true }), '↓10 个百分点')
  assert.equal(formatDelta(usageDelta(0.4, 0.5, { points: true }), 'en', { points: true }), '↓10 pts')
  assert.equal(isNotableDelta(usageDelta(150, 100)), false, 'an ordinary rise stays neutral')
  assert.equal(isNotableDelta(usageDelta(200, 100)), true)
  assert.equal(isNotableDelta(usageDelta(0.2, 0.5, { points: true }), { points: true }), true)
})

test('optional dimensions are read only when present and well formed', () => {
  const old = usageCapabilities(legacyStats())
  assert.deepEqual([old.schemaVersion, old.agents.length, old.purposes.length, old.others], [1, 0, 0, null])
  const next = usageCapabilities(v2Stats())
  assert.deepEqual([next.schemaVersion, next.agents.length, next.purposes.length, next.others.sessions], [2, 2, 2, 3])
  assert.deepEqual(Object.keys(next).sort(), ['agents', 'others', 'purposes', 'schemaVersion'], 'no per-bucket Agent trend: the Host does not send one')
  const broken = usageCapabilities({ ...v2Stats(), byAgent: [{ agent: 'x', calls: 'many' }, ...v2Stats().byAgent], byPurpose: 'chat' })
  assert.equal(broken.agents.length, 2, 'a malformed row is left out')
  assert.equal(broken.purposes.length, 0)
  assert.equal(usageAgentLabel({ agent: '@main', label: '主助手' }, 'en'), 'Main assistant')
  assert.equal(usageAgentLabel({ agent: 'researcher' }, 'en'), 'researcher')
  assert.equal(usagePurposeLabel({ purpose: 'ambient-judge', label: '插话判断' }, 'en'), translate('en', '插话判断'))
  assert.equal(usagePurposeLabel({ purpose: 'custom-x', label: '自定义' }, 'en'), 'custom-x', 'an unknown purpose is not shown with a Chinese Host label in English')
})

test('session names: the platform comes from bySession[].platform first, hashed keys keep it', () => {
  const v2 = v2Stats()
  assert.equal(usageSessionNames(v2.bySession).get(HASHED).name, 'icqq · 私聊会话 #ab12cd34')
  assert.equal(usageSessionLabel({ sessionKey: HASHED }), '私聊会话 #ab12cd34', 'an older Host sends no platform for a hashed key')
  assert.equal(usageSessionLabel({ sessionKey: HASHED, platform: 'sandbox' }, 'en'), `sandbox · ${translate('en', '私聊会话')} #ab12cd34`)
  const scene = `scene-task:v1:${'9f8e7d6c'.padEnd(64, '0')}`
  // A hashed key with a scope but no name: its short hash, never the raw key.
  assert.equal(usageSessionLabel({ sessionKey: scene, platform: 'icqq', scopeKind: 'group' }), 'icqq · 群 #9f8e7d6c')
  assert.equal(usageSessionLabel({ sessionKey: scene, platform: 'icqq', scopeKind: 'private', sceneLabel: '小明' }), 'icqq · 私聊 小明')
  // The Host's platform wins over the first part of the key.
  assert.equal(usageSessionLabel({ sessionKey: 'icqq:bot:group:1', platform: 'onebot', scopeKind: 'group', sceneLabel: '群名' }), 'onebot · 群 群名')
  assert.equal(usageSessionLabel({ sessionKey: 'icqq:bot:group:1', scopeKind: 'group', sceneLabel: '群名' }), 'icqq · 群 群名', 'the key only without a platform')
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
    ProgressMeter: ({ label }) => h('progress-meter', { 'aria-label': label }),
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
      // Same-named groups are told apart by a visible, readable qualifier at every width — never their key.
      const body = mainView(html)
      if (shape === 'v2') { assert.match(body, />社区号</); assert.match(body, />客服号</); assert.match(body, />#1<[\s\S]*>#2</, 'the two HTTP sessions') }
      else assert.match(body, />#1<[\s\S]*>#2</)
      assert.doesNotMatch(body, /icqq:bot-[ab]|bot-a:group|bot-b:group|>bot-[ab]</, 'no session key or endpoint in the main view')
      // A hashed key keeps the platform the batch-58 Host sends (none from an older Host).
      assert.match(mainView(html), shape === 'v2' ? /icqq · 私聊会话 #ab12cd34/ : />私聊会话 #ab12cd34/)
    }
    if (view === 'models' && !narrow) {
      assert.match(html, /<info-hint><span><span class="sr-only">Night Router · gpt-6-luna 的 ID<\/span>/, 'the ⓘ is named after its model')
      assert.match(html.match(/<info-hint>[\s\S]*?<\/info-hint>/)[0], new RegExp(`合并自 3 个 ID[\\s\\S]*统计键（1）[\\s\\S]*服务 / 账号 ID（2）`))
    }
    assert.equal(/<tabs/.test(html), !narrow, 'tabs on wide containers')
    assert.equal(/<select-field aria-label="明细维度"/.test(html), narrow, 'a select on narrow containers')
    assert.equal(/>Agent</.test(html), shape === 'v2', 'the Agent tab only with byAgent')
    assert.doesNotMatch(html, /按 Agent/, 'the trend has no Agent dimension')
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

test('missing accountLabel / profileName fall back without showing raw ids', () => {
  assert.equal(usageAccountLabel({ sessionKey: 'icqq:bot-a:group:1', endpoint: 'bot-a', accountLabel: '社区号' }), '社区号')
  assert.equal(usageAccountLabel({ sessionKey: 'icqq:8596238:group:1', endpoint: '8596238' }), '8596238', 'the endpoint when the Host leaves the label out')
  assert.equal(usageAccountLabel({ sessionKey: 'icqq:bot-b:group:1' }), 'bot-b', 'the endpoint part of the key')
  assert.equal(usageAccountLabel({ sessionKey: HASHED }), '', 'nothing to show')
  assert.equal(usageAccountLabel({ sessionKey: HASHED, accountLabel: NIGHT_ACCOUNT, endpoint: NIGHT_ACCOUNT }), '', 'an opaque id is never the name')
  assert.equal(usageProfileName({ model: 'm', modelName: 'm', profileName: '夜间主力' }), '夜间主力')
  assert.equal(usageProfileName({ model: 'm', modelName: 'm' }), '', 'no subtitle when the Host cannot attribute the calls')
  assert.equal(usageProfileName({ model: 'm', modelName: 'm', profileName: 'm' }), '', 'a subtitle repeating the model adds nothing')
  assert.equal(usageProfileName({ model: 'm', profileName: REMOVED }), '')

  // Rendered: the model row and Sheet show no profile line, the session Sheet falls back to the endpoint.
  const stats = v2Stats()
  delete stats.byModel[0].profileName
  delete stats.byModel[0].profileId
  stats.bySession[0] = { ...stats.bySession[0], accountLabel: undefined }
  const model = renderReport(stats, { selection: { kind: 'model', key: 'Night Router · gpt-6-luna' } })
  assert.doesNotMatch(model, /模型配置|夜间主力/)
  assert.doesNotMatch(mainView(model), RAW)
  const session = renderReport(stats, { view: 'sessions', selection: { kind: 'session', key: 'icqq:bot-a:group:1' } })
  assert.match(session.match(/<sheet-root>[\s\S]*<\/sheet-root>/)[0], /<dt>账号<\/dt><dd>bot-a<\/dd>/)
  const hashed = renderReport(stats, { view: 'sessions', selection: { kind: 'session', key: HASHED } })
  const sheet = hashed.match(/<sheet-root>[\s\S]*<\/sheet-root>/)[0]
  assert.match(sheet, /<dt>平台<\/dt><dd>icqq<\/dd>/)
  assert.match(sheet, /<dt>账号<\/dt><dd>bot-a<\/dd>/)
  assert.doesNotMatch(mainView(hashed), RAW)
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
  assert.equal(v2.previous.truncated, false, 'the full previous window')
  assert.deepEqual(previousUsagePlan(v2, input).request, undefined, 'no second request')
  const hashed = v2.bySession.filter(row => /^[a-z-]+:v\d+:/.test(row.sessionKey))
  assert.ok(hashed.length >= 2 && hashed.every(row => row.platform === 'icqq'), 'hashed sessions carry their platform')
  const v2Names = usageSessionNames(v2.bySession)
  for (const row of hashed) assert.match(v2Names.get(row.sessionKey).name, /^icqq · /)
  assert.ok(v2.bySession.some(row => row.endpoint && !row.accountLabel), 'an account without a name')
  assert.ok(v2.byModel.some(row => !row.profileName), 'a model without a Profile name')
  const legacy = await previewUsage({ UI_PREVIEW_USAGE: 'legacy' }, input)
  for (const field of ['schemaVersion', 'byAgent', 'byPurpose', 'previous', 'sessionsTotal', 'othersTotals']) assert.equal(field in legacy, false, field)
  assert.ok(legacy.bySession.every(row => !('shortKey' in row) && !('scopeKind' in row)))
  for (const stats of [v2, legacy]) for (const view of ['models', 'sessions']) for (const narrow of [false, true]) {
    const html = renderReport(stats, { view, narrow })
    assert.doesNotMatch(mainView(html), RAW)
    assert.match(html, /Night Router/)
  }
  // The legacy shape falls back to a second request for the previous window, in the main request's zone.
  const request = previousUsagePlan(legacy, input).request
  assert.equal(request.timeZone, legacy.range.timeZone)
  const previous = await previewUsage({ UI_PREVIEW_USAGE: 'legacy' }, request)
  assert.ok(previous.totals.inputTokens < legacy.totals.inputTokens)
  // A `previous` cut short shows no change, and the Console does not ask for it again.
  const zoned = { ...input, timeZone: 'Europe/Berlin' }
  const truncated = await previewUsage({ UI_PREVIEW_USAGE: 'truncated' }, zoned)
  assert.equal(truncated.previous.truncated, true)
  assert.deepEqual(previousUsagePlan(truncated, zoned), {})
  // Same-named sessions of the fixture carry readable qualifiers only.
  assertReadableQualifiers(v2.bySession, v2Names)
  assertReadableQualifiers(legacy.bySession, usageSessionNames(legacy.bySession))
})

// ── Interaction and page data flow (a hook harness: effects run, state updates re-render) ──────────

function hookHarness() {
  let slots = [], cursor = 0, pending = [], dirty = false
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const api = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(v, slots[i])) { slots[i] = v; dirty = true } }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value },
    useEffect(fn, deps) {
      const i = cursor++
      if (same(slots[i]?.deps, deps)) return
      const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }
      pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() })
    },
  }
  return {
    react: { ...React, ...api },
    invalidate() { dirty = true },
    render(component, props) {
      let tree, n = 0
      do {
        assert.ok(++n < 50, 'render loop')
        cursor = 0; dirty = false
        tree = component(props)
        if (dirty) continue
        const run = pending; pending = []; run.forEach(fn => fn())
      } while (dirty)
      return tree
    },
  }
}
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' ? [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)] : []
const textOf = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value)
  ? value.map(textOf).join('') : value && typeof value === 'object' ? textOf(value.props?.children ?? '') : ''
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)) }

function reportParts(runtime, locale = 'zh-CN') {
  const i18n = { locale, t: (message, values) => translate(locale, message, values) }
  const ui = consoleUi({ narrow: false })
  const base = { react: runtime.react, '../i18n': { useI18n: () => i18n }, '@zhin.js/console-ui': ui, './token-usage-model.mjs': usageModel, 'lucide-react': new Proxy({}, { get: () => 'svg' }) }
  return compile(`${reportSource}\nexport { SessionTable, ModelTable, UsageIdList, UsageDetails };`, {
    ...base, './token-usage-charts': {}, './features/conversation-list': { ConversationKindBadge: 'kind-badge' }, './clipboard-copy.mjs': { copyText: async () => true },
  })
}
const merged = (stats, locale = 'zh-CN') => mergeUsageModels(validateUsageStats(stats, locale), locale)

test('sort headers carry aria-sort and keep their visible text as the button name', () => {
  const runtime = hookHarness()
  const { SessionTable } = reportParts(runtime)
  const props = { stats: merged(v2Stats()), narrow: false, open() {} }
  const sorts = tree => Object.fromEntries(nodes(tree).filter(node => node.type === 'table-head' && node.props['aria-sort']).map(node => [textOf(node), node.props['aria-sort']]))
  let tree = runtime.render(SessionTable, props)
  assert.deepEqual(sorts(tree), { 回合: 'none', 调用: 'none', 输入: 'descending', 输出: 'none', 缓存命中率: 'none' })
  for (const node of nodes(tree).filter(node => node.type === 'table-head' && node.props['aria-sort'])) {
    const button = nodes(node.props.children).find(child => child.type === 'button')
    assert.equal(button.props['aria-label'], undefined, 'the visible column name is the button name')
  }
  const click = (tree, label) => nodes(tree).find(node => node.type === 'table-head' && textOf(node) === label).props.children.props.onClick()
  click(tree, '回合'); tree = runtime.render(SessionTable, props)
  assert.deepEqual([sorts(tree).回合, sorts(tree).输入], ['descending', 'none'])
  click(tree, '回合'); tree = runtime.render(SessionTable, props)
  assert.equal(sorts(tree).回合, 'ascending')
})

test('service rows toggle aria-expanded; another range starts collapsed to the first service again', () => {
  const runtime = hookHarness()
  const { ModelTable, UsageDetails } = reportParts(runtime)
  const stats = merged(v2Stats())
  const groups = usageServiceGroups(stats.byModel)
  const props = { groups, total: stats.totals.inputTokens, narrow: false, open() {} }
  const expanded = tree => nodes(tree).filter(node => node.props?.['aria-expanded'] !== undefined).map(node => node.props['aria-expanded'])
  let tree = runtime.render(ModelTable, props)
  assert.deepEqual(expanded(tree), [true, false, false])
  const toggle = index => nodes(tree).filter(node => node.props?.['aria-expanded'] !== undefined)[index].props.onClick({ stopPropagation() {} })
  toggle(0); tree = runtime.render(ModelTable, props)
  assert.deepEqual(expanded(tree), [false, false, false])
  toggle(2); tree = runtime.render(ModelTable, props)
  assert.deepEqual(expanded(tree), [false, false, true])
  // The table is keyed by the range, so its expanded state does not survive a range change.
  const key = range => nodes(runtime.render(UsageDetails, { stats: { ...stats, range }, groups, narrow: false, view: 'models', onViewChange() {}, open() {} })).find(node => node.type === ModelTable).key
  assert.notEqual(key({ ...stats.range, since: 1 }), key(stats.range))
  assert.equal(key(stats.range), key({ ...stats.range }))
})

test('the detail Sheet closes when the range changes', () => {
  const runtime = hookHarness()
  const report = reportParts(runtime)
  const stats = merged(v2Stats())
  const props = { stats, previous: null, view: 'models', onViewChange() {}, initialSelection: { kind: 'model', key: 'Night Router · gpt-6-luna' } }
  const sheet = tree => nodes(tree).find(node => node.props && 'selection' in node.props && 'groups' in node.props)
  assert.deepEqual(sheet(runtime.render(report.UsageReport, props)).props.selection, props.initialSelection)
  assert.deepEqual(sheet(runtime.render(report.UsageReport, { ...props, stats: { ...stats } })).props.selection, props.initialSelection, 'same range: still open')
  assert.equal(sheet(runtime.render(report.UsageReport, { ...props, stats: { ...stats, range: { ...stats.range, since: 1 } } })).props.selection, null)
})

test('「已复制」 resets when another row is shown and after a few seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const runtime = hookHarness()
  const { UsageIdList, COPIED_RESET_MS } = reportParts(runtime)
  const hadDocument = 'document' in globalThis
  globalThis.document ??= {}
  try {
    const first = { groups: [{ kind: 'session', ids: ['icqq:a:group:1'] }] }
    const label = tree => textOf(nodes(tree).find(node => node.type === 'button'))
    const copy = async tree => { nodes(tree).find(node => node.type === 'button').props.onClick(); await Promise.resolve(); await Promise.resolve() }
    let tree = runtime.render(UsageIdList, first)
    assert.match(label(tree), /复制 ID/)
    await copy(tree); tree = runtime.render(UsageIdList, first)
    assert.match(label(tree), /已复制/)
    tree = runtime.render(UsageIdList, { groups: [{ kind: 'session', ids: ['icqq:b:group:2'] }] })
    assert.match(label(tree), /复制 ID/, 'another row starts at 「复制 ID」')
    await copy(tree); tree = runtime.render(UsageIdList, { groups: [{ kind: 'session', ids: ['icqq:b:group:2'] }] })
    assert.match(label(tree), /已复制/)
    t.mock.timers.tick(COPIED_RESET_MS)
    tree = runtime.render(UsageIdList, { groups: [{ kind: 'session', ids: ['icqq:b:group:2'] }] })
    assert.match(label(tree), /复制 ID/, 'reverts after a moment')
  } finally { if (!hadDocument) delete globalThis.document }
})

test('compact rows and share cells name the share after their row', () => {
  const narrow = renderReport(v2Stats(), { narrow: true, view: 'sessions' })
  assert.match(narrow, /占比 \d+(?:\.\d+)?%/, 'the share is in the row button text')
  assert.match(narrow, /<progress-meter aria-label="icqq · 群 产品试验群 社区号 占比">/)
  assert.doesNotMatch(narrow, /<progress-meter aria-label="占比">/, 'no bare 「占比」 label')
  const wide = renderReport(v2Stats())
  assert.match(wide, /<progress-meter aria-label="Night Router 占比">/)
  assert.match(wide, /<progress-meter aria-label="Night Router · gpt-6-luna 占比">/)
  assert.doesNotMatch(wide, /<progress-meter aria-label="占比">/)
  assert.match(renderReport(v2Stats(), { narrow: true, locale: 'en' }), /aria-label="[^"]+ share"/)
})

const pageSource = await readFile(new URL('../console-ui/src/pages/token-usage.tsx', import.meta.url), 'utf8')
function pageFixture(rpc) {
  const runtime = hookHarness()
  const i18n = { locale: 'zh-CN', t: (message, values) => translate('zh-CN', message, values) }
  let params = new URLSearchParams()
  const calls = []
  const page = compile(pageSource, {
    react: runtime.react,
    'react-router-dom': { useSearchParams: () => [params, (next) => { params = typeof next === 'function' ? next(params) : next; runtime.invalidate() }] },
    '../i18n': { useI18n: () => i18n },
    '../components/StatusState': { StatusState: 'status-state' },
    './insights/ScopeFilterBar': { ScopeFilterBar: 'scope-filter-bar', useScopeFilter: () => ({ scope: {}, identity: 'all' }) },
    './insights/scope-filter.mjs': { usageSessionPattern: () => '' },
    'lucide-react': new Proxy({}, { get: () => 'svg' }),
    '../utils/plugin-rpc': { pluginRpc: (plugin, method, input) => { calls.push({ plugin, method, input }); return rpc(input, calls.length) } },
    '@zhin.js/console-ui': new Proxy({}, { get: (_, name) => tag(String(name)) }),
    './token-usage-report': { UsageBasisHint: 'usage-basis-hint', UsageReport: 'usage-report' },
    './token-usage-model.mjs': usageModel,
  }).default
  let tree
  const render = () => (tree = runtime.render(page, {}))
  return {
    calls, render,
    async flush() { render(); await settle(); return render() },
    report: () => nodes(tree).find(node => node.type === 'usage-report')?.props ?? null,
    status: () => nodes(tree).find(node => node.type === 'status-state')?.props ?? null,
    setRange(value) { nodes(tree).find(node => node.props?.['aria-label'] === '时间范围').props.onValueChange(value) },
  }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('page: a full Host previous needs one request; the report gets the Host totals', async () => {
  const f = pageFixture(async () => v2Stats())
  await f.flush()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].input.compare, 'previous')
  assert.equal(f.report().previous.inputTokens, 5000)
})

test('page: a truncated Host previous shows no change and asks for nothing more', async () => {
  const stats = v2Stats()
  stats.previous = { ...stats.previous, truncated: true }
  const f = pageFixture(async () => stats)
  await f.flush()
  assert.equal(f.calls.length, 1)
  assert.equal(f.report().previous, null)
  assert.ok(f.report().stats)
})

test('page: an older Host gets one request for the previous window, null when it fails', async () => {
  const old = legacyStats()
  const previousStats = { ...legacyStats(), totals: { turns: 3, ...tokens(4, 4000), cacheShare: 0 } }
  const f = pageFixture(async (input, n) => n === 1 ? old : previousStats)
  await f.flush()
  assert.equal(f.calls.length, 2)
  assert.equal('compare' in f.calls[1].input, false)
  assert.equal(f.calls[1].input.until, f.calls[0].input.since, 'right before the main window')
  assert.equal(f.calls[1].input.until - f.calls[1].input.since, f.calls[0].input.until - f.calls[0].input.since, 'as long as it')
  assert.equal(f.calls[1].input.timeZone, 'Asia/Shanghai')
  assert.equal(f.report().previous.inputTokens, 4000)

  const failing = pageFixture(async (input, n) => { if (n === 1) return legacyStats(); throw new Error('boom') })
  await failing.flush()
  assert.equal(failing.calls.length, 2)
  assert.equal(failing.report().previous, null, 'without the previous window there is no change')
  assert.ok(failing.report().stats, 'the report itself stays')
})

test('page: switching the range drops the result of the request still in flight', async () => {
  const first = deferred(), second = deferred()
  const f = pageFixture((input, n) => n === 1 ? first.promise : second.promise)
  await f.flush()
  f.setRange('30d')
  await f.flush()
  assert.equal(f.calls.length, 2)
  const fresh = v2Stats(); fresh.totals = { ...fresh.totals, inputTokens: 30_030 }
  const stale = v2Stats(); stale.totals = { ...stale.totals, inputTokens: 7_007 }
  second.resolve(fresh)
  await f.flush()
  first.resolve(stale)
  await f.flush()
  assert.equal(f.report().stats.totals.inputTokens, 30_030, 'the earlier range never overwrites the current one')
  assert.equal(f.calls.length, 2, 'the stale result triggers no previous-window request')
})

test('page: 503 is an empty state, 403 the forbidden state', async () => {
  const unavailable = pageFixture(async () => { throw Object.assign(new Error('AI 运行时尚未就绪'), { status: 503 }) })
  await unavailable.flush()
  assert.deepEqual([unavailable.status().kind, unavailable.status().description], ['empty', 'AI 运行时尚未就绪'])
  assert.equal(unavailable.report(), null)
  const forbidden = pageFixture(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }) })
  await forbidden.flush()
  assert.equal(forbidden.status().kind, 'forbidden')
  assert.deepEqual(forbidden.status().permissions, ['control:read'])
  assert.equal(forbidden.calls.length, 1, 'no previous-window request after a failure')
})
