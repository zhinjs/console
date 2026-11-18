// The merged interjection judge (zhinjs/zhin ADR 0066 D6 / D7, the five zhinjs/console items) and the
// judge usage of 「机器人状态」 (#1250 batch 47). Every block also checks an older instance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'
import * as judge from '../console-ui/src/pages/inference/ambient-judge-model.mjs'
import * as ambient from '../console-ui/src/pages/ambient-engagement-model.mjs'
import { ambientJudgeFacts } from '../console-ui/src/pages/bot-replay-model.mjs'
import { saveButtonMock } from './helpers/save-button-mock.mjs'

const NOW = Date.UTC(2026, 10, 18, 12)
const CJK = /[㐀-鿿]/u

function view({ purposes, effects, fallbacks = true } = {}) {
  const profile = (id, modelId) => ({ id, accountId: 'acc', model: modelId, label: id.toUpperCase() })
  return {
    rootId: '/host', ownerId: 'host', revision: 3, hostAdministrator: true, deployment: [], drivers: [], statuses: {},
    services: { svc: { id: 'svc', label: 'Service', driver: { id: 'd' }, models: {
      chat: { kinds: ['language'] }, flash: { kinds: ['language'] }, ts: { kinds: ['decision'] }, img: { kinds: ['image'] },
    } } },
    accounts: { acc: { id: 'acc', serviceId: 'svc', label: 'Main' } },
    profiles: { chat: profile('chat', 'chat'), flash: profile('flash', 'flash'), ts: profile('ts', 'ts'), img: profile('img', 'img') },
    purposes: purposes ?? { defaults: { chat: 'chat' }, decisions: {} },
    ...(effects ? { purposeEffects: effects } : {}),
    ...(fallbacks ? { modelAvailability: { notice: '', unavailable: [], recentFallbacks: [] } } : {}),
  }
}

const judgeView = (policy = { profile: 'ts', fallbacks: ['flash'], minConfidence: 0.7, mode: 'active' }, extra = {}) => ({
  policy, source: 'stored', chain: [{ profile: 'ts', kind: 'decision' }, { profile: 'flash', kind: 'language' }], ...extra,
})

// ------------------------------------------------------------- reading the judge and telling old from new

test('the judge route is read only in its documented shape; an instance without it is older', () => {
  const read = judge.readAmbientJudgeView(judgeView(undefined, { migration: { id: 'adr-0066-ambient-judge', status: 'migrated', at: 1, rows: [] } }))
  assert.equal(read.source, 'stored')
  assert.equal(read.migration.status, 'migrated')
  for (const bad of [null, {}, { policy: {}, source: 'odd', chain: [] }, { policy: {}, source: 'stored', chain: [{ profile: ' x' }] }, { adapters: [] }])
    assert.equal(judge.readAmbientJudgeView(bad), null)
  assert.equal(judge.readAmbientJudgeView({ ...judgeView(), migration: { id: 'other', status: 'migrated', at: 1 } }).migration, undefined)

  assert.equal(judge.ambientJudgeSupport({ view: view(), judge: read }), 'merged')
  assert.equal(judge.ambientJudgeSupport({ view: view({ purposes: { defaults: {}, ambient: {} } }) }), 'merged', 'a stored purposes.ambient is enough')
  assert.equal(judge.ambientJudgeSupport({ view: view({ effects: { ambient: { status: 'effective', chain: [] } } }) }), 'merged')
  assert.equal(judge.ambientJudgeSupport({ view: view(), judgeError: new model.InferenceRequestError('not-installed', 404) }), 'legacy')
  assert.equal(judge.ambientJudgeSupport({ view: view(), judgeError: new model.InferenceRequestError('unavailable', 503) }), 'unknown', 'a transient failure is not proof of an old instance')
})

// ------------------------------------------------------------- editing purposes.ambient

test('the draft writes the six keys only, always with an explicit mode, and nothing when unchanged', () => {
  const policy = { profile: 'ts', fallbacks: ['flash'], compare: 'chat', minConfidence: 0.8, mode: 'shadow', timeoutMs: 2500 }
  const draft = judge.ambientJudgeDraft(policy)
  assert.deepEqual(draft, { profile: 'ts', fallbacks: ['flash'], compare: 'chat', minConfidence: '0.8', mode: 'shadow', timeoutMs: '2500' })
  assert.deepEqual(judge.ambientJudgePolicyFromDraft(draft), policy)
  assert.equal(judge.ambientJudgePlanEntry(draft, policy), undefined, 'an unchanged judge is not written')
  assert.equal(judge.ambientJudgePlanEntry(judge.ambientJudgeDraft({}), {}), undefined)
  // While the retired yml mode still applies, a policy without `mode` would take it: always explicit.
  assert.deepEqual(judge.ambientJudgePlanEntry({ ...judge.ambientJudgeDraft({}), minConfidence: '0.6' }, {}), { minConfidence: 0.6, mode: 'active' })
  const inherit = judge.ambientJudgePolicyFromDraft({ ...draft, profile: '' })
  assert.equal(inherit.fallbacks, undefined, 'no chain without a primary (it follows chat)')
  assert.deepEqual(Object.keys(inherit).every(key => judge.AMBIENT_JUDGE_KEYS.includes(key)), true)
})

test('the draft is checked like the Host checks purposes.ambient, with the field it concerns', () => {
  const v = view()
  const fields = draft => judge.validateAmbientJudgeDraft({ ...judge.ambientJudgeDraft({}), ...draft }, v).map(problem => problem.field)
  assert.deepEqual(fields({ profile: 'ts', fallbacks: ['flash'], compare: 'chat', minConfidence: '0.7', timeoutMs: '3000' }), [])
  assert.deepEqual(fields({ profile: 'img' }), ['profile'], 'an image model cannot judge')
  assert.deepEqual(fields({ fallbacks: ['flash'] }), ['fallbacks'], 'a chain needs a primary')
  assert.deepEqual(fields({ profile: 'ts', fallbacks: ['flash', 'flash'] }), ['fallbacks'])
  assert.deepEqual(fields({ profile: 'ts', compare: 'ts' }), ['compare'], 'the compared model is not in the chain')
  assert.deepEqual(fields({ minConfidence: '1.2' }), ['minConfidence'])
  assert.deepEqual(fields({ minConfidence: 'abc' }), ['minConfidence'])
  assert.deepEqual(fields({ timeoutMs: '2.5' }), ['timeoutMs'])
  assert.deepEqual(fields({ timeoutMs: '0' }), ['timeoutMs'])
  const english = judge.validateAmbientJudgeDraft({ ...judge.ambientJudgeDraft({}), fallbacks: ['flash'], minConfidence: '2' }, v, 'en')
  assert.ok(english.length === 2 && english.every(problem => !CJK.test(problem.message)), 'English problems are English')
  assert.equal(judge.ambientJudgeHints({ ...judge.ambientJudgeDraft({ profile: 'ts' }), minConfidence: '0.3' }, v).length, 1, 'a threshold below 0.5 does nothing for a decision model')
  assert.equal(judge.ambientJudgeHints({ ...judge.ambientJudgeDraft({ profile: 'flash' }), minConfidence: '0.3' }, v).length, 0)
})

test('the pickers list language and decision Profiles together, grouped by kind', () => {
  const choices = judge.ambientJudgeChoices(view())
  assert.deepEqual(choices.map(choice => [choice.value, choice.kind]), [['chat', 'language'], ['flash', 'language'], ['ts', 'decision']])
  assert.deepEqual([...new Set(choices.map(choice => choice.group))], ['语言模型 · Service', '决策模型 · Service'])
  assert.deepEqual([...new Set(judge.ambientJudgeChoices(view(), 'en').map(choice => choice.group))], ['Language model · Service', 'Decision model · Service'])
})

test('purposePlan on an ADR 0066 instance writes purposes.ambient only when changed and no decisions.ambient', () => {
  const original = { defaults: { chat: 'chat', ambient: 'flash' }, decisions: { skills: { mode: 'active', profile: 'ts' }, ambient: { mode: 'active', profile: 'ts' } } }
  const unchanged = model.purposePlan(structuredClone(original), original, { ambientJudge: { entry: undefined } })
  assert.equal(Object.hasOwn(unchanged, 'ambient'), false, 'legacy fields are left to the migration')
  assert.deepEqual(Object.keys(unchanged.decisions), ['skills'])
  const changed = model.purposePlan(structuredClone(original), original, { ambientJudge: { entry: { profile: 'ts', mode: 'shadow' } } })
  assert.deepEqual(changed.ambient, { profile: 'ts', mode: 'shadow' })
  // An older instance keeps the two separate settings.
  const legacy = model.purposePlan(structuredClone(original), original)
  assert.deepEqual(legacy.ambient, { profile: 'flash' })
  assert.deepEqual(Object.keys(legacy.decisions).sort(), ['ambient', 'skills'])
})

// ------------------------------------------------------------- 「谁在用」

test('「谁在用」 lists the judge chain that runs, and dims references that do not take effect', () => {
  const purposes = { defaults: { chat: 'chat', chatFallbacks: ['flash'] }, ambient: { compare: 'ts' }, decisions: { skills: { mode: 'off', profile: 'ts' } } }
  const effects = {
    ambient: { status: 'effective', chain: [{ profile: 'chat', kind: 'language' }, { profile: 'flash', kind: 'language' }], inheritedFrom: 'chat', compare: { profile: 'ts', kind: 'decision' } },
    'decisions.skills': { status: 'ignored', reason: 'mode-off' },
  }
  const labels = id => model.profileUsages(purposes, id, 'zh-CN', effects).map(usage => usage.ignored ? `${usage.label}!${usage.reason}` : usage.label)
  assert.deepEqual(labels('chat'), ['默认聊天', '插话判断（跟随聊天）'])
  assert.deepEqual(labels('flash'), ['默认聊天（备选）', '插话判断（跟随聊天，第 1 个备用）'])
  assert.deepEqual(labels('ts'), ['插话判断（对照）', '决策：技能选择!mode-off'])
  const ignored = { ambient: { status: 'ignored', reason: 'ambient-not-configured', chain: [{ profile: 'ts', kind: 'decision' }] } }
  const [row] = model.profileUsages({ defaults: {}, ambient: { profile: 'ts' } }, 'ts', 'en', ignored)
  assert.deepEqual([row.label, row.ignored, model.ignoredReasonText(row.reason, 'en')], ['Interjection judge', true, 'interjection is not set up'])
  // Without purposeEffects (not a Host administrator) the stored policy is read.
  assert.deepEqual(model.profileUsages({ defaults: {}, ambient: { profile: 'ts', fallbacks: ['flash'] } }, 'flash').map(usage => usage.label), ['插话判断（第 1 个备用）'])
  // An older instance keeps 默认旁听 and 旁听参与判断.
  const old = { defaults: { ambient: 'flash' }, decisions: { ambient: { mode: 'active', profile: 'ts' } } }
  assert.deepEqual(model.profileUsages(old, 'flash').map(usage => usage.label), ['默认旁听'])
  assert.deepEqual(model.profileUsages(old, 'ts').map(usage => usage.label), ['决策：旁听参与判断'])
})

// ------------------------------------------------------------- errors and warnings from the Host

test('a refused plan names the field: the Host path is shown, interjection paths in words', async () => {
  const fetch = async () => ({ ok: false, status: 400, json: async () => ({ success: false, code: 'invalid-plan', details: { path: 'purposes.ambient.fallbacks[1]' } }) })
  const error = await model.inferenceRequest(fetch, { path: '/plan', body: {} }).catch(caught => caught)
  assert.equal(error.path, 'purposes.ambient.fallbacks[1]')
  assert.equal(model.inferenceError(error), '插话判断 · 备用链 第 2 项（purposes.ambient.fallbacks[1]） 无效，请检查后再保存。')
  assert.equal(model.inferenceError(error, 'en'), 'Interjection judge · Fallback chain item 2 (purposes.ambient.fallbacks[1]) is not valid. Check it and save again.')
  assert.equal(model.inferenceError(new model.InferenceRequestError('invalid-graph', 400, undefined, undefined, 'purposes.agents.x')), '配置 purposes.agents.x 引用的模型配置不存在或类型不对（删除模型配置前请先从这里移除）。')
  assert.equal(model.inferenceError(new model.InferenceRequestError('invalid-plan')), '请检查必填项、参数和模型能力。', 'no path: the general text')
  const warning = { path: 'purposes.decisions.ambient', code: 'deprecated-decisions-ambient', message: 'purposes.decisions.ambient is deprecated (ADR 0066)' }
  assert.match(judge.planWarningText(warning), /^purposes\.decisions\.ambient 已废弃/u)
  assert.doesNotMatch(judge.planWarningText(warning, 'en'), CJK)
  assert.equal(judge.planWarningText({ code: 'future', message: 'Host text' }), 'Host text')
})

// ------------------------------------------------------------- migration banner

test('the migration banner shows once: migrated and not yet noticed', () => {
  const migration = { id: 'adr-0066-ambient-judge', status: 'migrated', at: NOW, rows: [
    { field: 'profile', value: 'ts', from: 'purposes.decisions.ambient.profile' },
    { field: 'fallbacks', value: ['flash'], from: 'purposes.ambient (language)' },
    { field: 'minConfidence', value: 0.8, from: 'max(...)' },
  ], notes: [{ code: 'language-judge-became-fallback', value: 'flash' }, { code: 'threshold-max', value: 0.8 }, { code: 'unknown-future' }] }
  const notice = judge.ambientMigrationNotice({ ...judgeView(), migration }, view())
  assert.deepEqual(notice.rows.map(row => [row.field, row.value]), [['插话判断模型', 'TS'], ['备用链', 'FLASH'], ['门槛', '0.8']])
  assert.equal(notice.notes.length, 2, 'unknown note codes are skipped')
  assert.ok(judge.ambientMigrationNotice({ ...judgeView(), migration }, view(), 'en').notes.every(note => !CJK.test(note)))
  assert.equal(judge.ambientMigrationNotice({ ...judgeView(), migration: { ...migration, noticedAt: NOW } }, view()), null)
  assert.equal(judge.ambientMigrationNotice({ ...judgeView(), migration: { ...migration, status: 'reverted' } }, view()), null)
  assert.equal(judge.ambientMigrationNotice(judgeView(), view()), null)
  assert.match(judge.ambientMigrationFailure({ migration: { status: 'failed', failure: { reason: 'not-visible', path: 'purposes.ambient.profile' } } }), /purposes\.ambient\.profile/u)
  assert.equal(judge.ambientMigrationFailure({ migration }), null)
  assert.equal(judge.ambientJudgeDocUrl('en'), 'https://zhin.js.org/en/migrations/ambient-judge')
})

test('closing the banner posts …/migration/noticed', async () => {
  const calls = []
  await judge.noticeAmbientJudgeMigration(async (path, body, method) => { calls.push([path, body, method]); return { noticedAt: 1 } })
  assert.deepEqual(calls, [['/ambient-judge/migration/noticed', {}, 'POST']])
})

// ------------------------------------------------------------- the interjection status

const status = (extra = {}) => ({
  enabled: true, mode: 'active', groups: 2, judges: ['svc/ts', 'svc/flash'], last24h: { spoke: 1, watched: 0, stayed_quiet: 3, skipped: 1 },
  decisionShadow: { agreed: 7, disagreed: 3 }, recent: [], updatedAt: null, ...extra,
})
const compare = { windowMs: 86_400_000, agreed: 8, primaryOnly: 1, comparedOnly: 1, failed: 2, comparedProfiles: ['chat'],
  byMember: [{ member: 0, profile: 'ts', agreed: 6, primaryOnly: 1, comparedOnly: 1, failed: 2 }, { member: 1, profile: 'flash', agreed: 2, primaryOnly: 0, comparedOnly: 0, failed: 0 }] }

test('validateAmbientStatus accepts older and newer instances and rejects malformed new fields', () => {
  assert.doesNotThrow(() => ambient.validateAmbientStatus(status()), 'an older instance')
  const { judges: _judges, decisionShadow: _shadow, ...minimal } = status()
  assert.doesNotThrow(() => ambient.validateAmbientStatus(minimal), 'a later instance may drop the deprecated fields')
  const newer = status({
    judgeChain: [{ profile: 'ts', label: 'svc/ts', kind: 'decision', role: 'primary', skippedUntil: NOW + 60_000, skipReason: 'quota_exhausted' }, { profile: 'chat', label: 'svc/chat', role: 'compare' }],
    minConfidence: 0.7, compare, judgeTimeZone: 'Asia/Shanghai',
    judgeDaily: [{ day: '2026-11-17', calls: 4, failed: 1, fallbacks: 1, byKind: { language: 1, decision: 3 }, averageMs: 800, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, unreportedCalls: 1 }],
  })
  assert.equal(ambient.validateAmbientStatus(newer), newer)
  assert.equal(ambient.hasMergedJudge(newer), true)
  assert.equal(ambient.hasMergedJudge(status()), false)
  for (const bad of [
    { judgeChain: [{ profile: 'ts', role: 'boss', label: 'x' }] },
    { judgeChain: 'ts' },
    { minConfidence: 2 },
    { compare: { ...compare, byMember: [{ member: -1, agreed: 0, primaryOnly: 0, comparedOnly: 0, failed: 0 }] } },
    { compare: { ...compare, agreed: 'many' } },
    { judgeDaily: [{ day: '17/11', calls: 1 }] },
    { judgeDaily: [{ ...newer.judgeDaily[0], byKind: null }] },
    { judgeTimeZone: 8 },
    { decisionShadow: { agreed: 1 } },
  ]) assert.throws(() => ambient.validateAmbientStatus(status(bad)), /格式不正确/u, JSON.stringify(bad))
})

test('agreement reads compare (both kinds of disagreement and failures), else decisionShadow', () => {
  const fromCompare = judge.ambientAgreement(status({ compare }))
  assert.deepEqual([fromCompare.source, fromCompare.rate, fromCompare.total], ['compare', 80, 10])
  assert.equal(fromCompare.text, '与对照模型一致 80%（共 10 次，最近 24 小时）')
  assert.equal(fromCompare.detail, '主判断插话、对照不插 1 次 · 主判断不插、对照插话 1 次 · 对照失败 2 次')
  assert.deepEqual(fromCompare.byMember.map(row => row.label), ['主判断 · ts', '第 1 个备用 · flash'])
  const fallback = judge.ambientAgreement(status())
  assert.deepEqual([fallback.source, fallback.rate, fallback.total], ['decisionShadow', 70, 10])
  assert.equal(judge.ambientAgreement(status({ decisionShadow: { agreed: 0, disagreed: 0 } })), null)
  assert.equal(judge.ambientAgreement(status({ compare: { ...compare, agreed: 0, primaryOnly: 0, comparedOnly: 0, failed: 0, byMember: [] } })), null)
  assert.doesNotMatch(`${judge.ambientAgreement(status({ compare }), 'en').text} ${judge.ambientAgreement(status(), 'en').detail}`, CJK)
})

test('the chain card shows primary, fallbacks, the compared model and active skip periods', () => {
  const rows = judge.ambientJudgeChainRows(status({ judgeChain: [
    { profile: 'ts', label: 'svc/ts', kind: 'decision', role: 'primary', skippedUntil: NOW + 60_000, skipReason: 'quota_exhausted' },
    { profile: 'flash', label: 'svc/flash', kind: 'language', role: 'fallback', skippedUntil: NOW - 1 },
    { profile: 'chat', label: 'svc/chat', kind: 'language', role: 'compare' },
  ] }), 'zh-CN', NOW)
  assert.deepEqual(rows.map(row => [row.role, row.label, row.kind]), [['主判断', 'svc/ts', '决策模型'], ['第 1 个备用', 'svc/flash', '语言模型'], ['对照（只记录）', 'svc/chat', '语言模型']])
  assert.match(rows[0].skipped, /^暂时跳过：额度用完，/u)
  assert.equal(rows[1].skipped, '', 'an expired skip is not shown')
  assert.deepEqual(judge.ambientJudgeChainRows(status()), [], 'an older instance has no chain')
})

test('「机器人状态」 judge usage: seven days in the instance zone, unreported calls noted, nothing for older instances', () => {
  const day = (date, extra = {}) => ({ day: date, calls: 0, failed: 0, fallbacks: 0, byKind: { language: 0, decision: 0 }, averageMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, unreportedCalls: 0, ...extra })
  const usage = judge.ambientJudgeDaily(status({ judgeTimeZone: 'Asia/Shanghai', judgeDaily: [
    day('2026-11-14', { calls: 5, failed: 1, fallbacks: 2, inputTokens: 300, outputTokens: 40 }),
    day('2026-11-18', { calls: 2, inputTokens: 50, outputTokens: 5, unreportedCalls: 1 }),
  ] }), 'zh-CN', NOW)
  assert.deepEqual(usage.rows.map(row => row.day), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'])
  assert.deepEqual(usage.rows.map(row => row.calls), [0, 0, 5, 0, 0, 0, 2], 'days without calls read 0')
  assert.equal(usage.rows[2].tokens, 340)
  assert.deepEqual(usage.total, { calls: 7, failed: 1, fallbacks: 2, inputTokens: 350, outputTokens: 45, unreportedCalls: 1 })
  assert.equal(usage.unreported, true)
  assert.equal(usage.timeZone, 'Asia/Shanghai')
  assert.equal(judge.ambientJudgeDaily(status({ judgeTimeZone: 'Asia/Shanghai', judgeDaily: [] }), 'zh-CN', NOW).unreported, false)
  assert.equal(judge.ambientJudgeDaily(status()), null, 'an instance without judgeDaily shows nothing')
  assert.equal(judge.ambientJudgeDaily(status({ judgeTimeZone: 'Not/AZone', judgeDaily: [day('2026-11-18', { calls: 1 })] })).rows.length, 1, 'a zone the browser does not know keeps the reported days')
  assert.doesNotMatch(usage.rows.map(row => judge.ambientJudgeDaily(status({ judgeTimeZone: 'UTC', judgeDaily: [] }), 'en', NOW).rows[0].label).join(''), CJK)
})

// ------------------------------------------------------------- the interjection page settings

test('an ADR 0066 instance reads 只观察 from purposes.ambient.mode and never writes ai.trigger.ambient.mode', () => {
  const config = { ai: { trigger: { ambient: { conversations: ['qq:1'], mode: 'active', maxPerHour: 4 } } } }
  assert.equal(ambient.readAmbientSettings(config, { judgeMode: 'shadow' }).behavior, 'watch', 'the judge mode wins over the retired yml key')
  assert.equal(ambient.readAmbientSettings(config).behavior, 'join', 'an older instance reads the yml key')
  const settings = { behavior: 'watch', groupScope: 'some', groups: ['qq:1'], maxPerHour: 4 }
  assert.deepEqual(ambient.buildAmbientPatches(settings, { mergedJudge: true }).map(patch => patch.path.at(-1)), ['conversations', 'maxPerHour'])
  assert.deepEqual(ambient.buildAmbientPatches(settings).map(patch => patch.path.at(-1)), ['conversations', 'mode', 'maxPerHour'], 'older instances keep the old key')
  const policy = { profile: 'ts', fallbacks: ['flash'], minConfidence: 0.8, mode: 'active' }
  assert.deepEqual(ambient.ambientJudgeModeChange(settings, policy, 'active'), { ...policy, mode: 'shadow' }, 'the whole policy is written with the new mode')
  assert.equal(ambient.ambientJudgeModeChange(settings, policy, 'shadow'), null, 'same mode: nothing to write')
  assert.equal(ambient.ambientJudgeModeChange({ ...settings, behavior: 'off' }, policy, 'active'), null, '关闭 only clears the groups')
})

test('writing the judge mode goes through owners → view → /plan → /apply with the view bindings', async () => {
  const calls = []
  const answer = data => ({ ok: true, status: 200, json: async () => ({ success: true, data }) })
  const fetch = async (url, init = {}) => {
    const path = new URL(url, 'https://host').pathname.replace('/api/agent/inference', '') || '/'
    calls.push([path, init.body ? JSON.parse(init.body) : undefined])
    if (path === '/owners') return answer([{ id: 'personal', kind: 'personal' }, { id: 'host', kind: 'host' }])
    if (path === '/') return answer(view())
    if (path === '/plan') return answer({ prepared: { sealed: true }, fingerprint: 'f', baseRevision: 3, warnings: [{ code: 'deprecated-decisions-ambient', path: 'purposes.decisions.ambient', message: 'x' }] })
    if (path === '/apply') return answer({ status: 'committed', receipt: { graphRevision: 4 } })
    throw new Error(path)
  }
  const result = await judge.writeAmbientJudgePolicy(fetch, { profile: 'ts', mode: 'shadow' }, { mutationId: 'm-1' })
  assert.equal(result.status, 'committed')
  assert.equal(result.warnings.length, 1)
  assert.deepEqual(calls.map(([path]) => path), ['/owners', '/', '/plan', '/apply'])
  assert.deepEqual(calls[2][1].plan, { version: 1, purposes: { ambient: { profile: 'ts', mode: 'shadow' } } })
  assert.deepEqual(calls[2][1].bindings.profiles.ts, 'ts')
  assert.deepEqual(calls[3][1], { prepared: { sealed: true }, mutationId: 'm-1' })
})

// ------------------------------------------------------------- decision replay

test('ambient_decision rows show the judge, fallback, tokens, error class and the compared verdict', () => {
  const row = (payload, kind = 'ambient_decision') => ({ kind, payload })
  assert.deepEqual(ambientJudgeFacts(row({ judge: 'svc/flash', judgeKind: 'language', judgeFallbackFrom: 'svc/ts', judgeUsage: { inputTokens: 90, outputTokens: 10 }, compare: 'quiet', compareJudge: 'svc/chat' })),
    ['判断：svc/flash（语言模型）', '备用接手，原来是 svc/ts', '用量 100 token', '对照 svc/chat：不插话'])
  assert.deepEqual(ambientJudgeFacts(row({ decision: 'skipped', judgeError: 'timeout', judgeAttempts: [{ kind: 'decision', profile: 'ts', model: 'm', error: 'timeout' }], compare: 'failed', compareJudgeError: 'auth' })),
    ['失败：超时', '尝试过：ts (超时)', '对照：失败'])
  assert.deepEqual(ambientJudgeFacts(row({ judge: 'x' }, 'model_skip')), [], 'other rows have no judge facts')
  assert.deepEqual(ambientJudgeFacts(row({})), [], 'an older Host without the keys')
  assert.doesNotMatch(ambientJudgeFacts(row({ judge: 'svc/ts', judgeKind: 'decision', judgeUsage: { inputTokens: 1 }, compare: 'engage' }), 'en').join(' '), CJK)
})

// ------------------------------------------------------------- the purposes page

async function purposesPage(v, { judgeRead = judgeView(), request: answer } = {}) {
  const runtime = pageRuntime(), plans = [], requests = []
  const management = { view: v, source: { view: v }, busy: false, pending: null, active: () => true, setError: message => assert.fail(message),
    request: async (path, body, method) => {
      requests.push([path, method])
      if (answer) return answer(path, body, method)
      if (path === '/ambient-judge') { if (judgeRead instanceof Error) throw judgeRead; return judgeRead }
      return { adapters: [], endpoints: [], scenes: [], agents: [] }
    },
    savePlan: async (plan, options) => { plans.push(plan); options?.onWarnings?.([]); return true } }
  const code = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/inference/Purposes.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const deps = {
    react: runtime.api, 'react/jsx-runtime': jsxRuntime, './model.mjs': model, './ambient-judge-model.mjs': judge, '../../components/SaveButton': saveButtonMock,
    '../../utils/plugin-rpc': { pluginRpc: async () => status({ compare }) },
    '../../i18n': { useI18n: () => ({ locale: 'zh-CN', t: (m, values) => translate('zh-CN', m, values) }) },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '@zhin.js/console-ui': { Alert: 'alert', AlertTitle: 'alert-title', AlertDescription: 'alert-description', Button: 'button', Input: 'input', InlineCode: 'code', Switch: 'switch',
      SelectField: 'select', SearchableSelectField: 'select', Card: 'card', useConfirm: () => ({ confirm: async () => true, ConfirmDialog: null }),
      DropdownMenu: 'menu', DropdownMenuContent: 'menu-content', DropdownMenuItem: 'menu-item', DropdownMenuTrigger: 'menu-trigger' },
    './SupportInfo': { supportLabel: label => label },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports.Purposes, props: { management } }))
  await runtime.settle()
  const all = () => nodes(runtime.value)
  const select = label => all().find(node => node.type === 'select' && node.props['aria-label'] === label)
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  return { runtime, plans, requests, all, select, text: () => text(runtime.value), submit: () => runtime.value.props.onSubmit({ preventDefault() {} }) }
}

test('the purposes page shows one 插话判断 (mixed models, chain, compared model) and five decision purposes', async () => {
  const page = await purposesPage(view({ purposes: { defaults: { chat: 'chat' }, ambient: { profile: 'ts', fallbacks: ['flash'], minConfidence: 0.7, mode: 'active' }, decisions: {} } }))
  try {
    assert.match(page.text(), /插话判断：群里没人叫机器人时，决定要不要插话。只决定说不说，说什么由「聊天」用途写。/u)
    assert.equal(page.select('旁听'), undefined, '旁听 is part of the judge')
    assert.equal(page.select('旁听参与判断模式'), undefined)
    assert.deepEqual(page.all().filter(node => node.type === 'select' && / 模式$|模式$/u.test(node.props['aria-label'] ?? '')).map(node => node.props['aria-label']),
      ['技能选择模式', '工具选择模式', '记忆选择模式', 'Agent 选择模式', '工具审批建议模式'])
    assert.deepEqual(page.select('插话判断模型').props.options.map(option => option.value), ['', 'chat', 'flash', 'ts'], 'language and decision models in one picker')
    assert.equal(page.select('插话判断备用模型 1').props.value, 'flash')
    assert.deepEqual(page.select('对照模型').props.options.map(option => option.value), ['', 'chat'], 'chain members cannot be compared')
    assert.match(page.text(), /与对照模型一致 80%（共 10 次，最近 24 小时）/u)
    // Nothing changed: the judge is not written.
    await page.submit()
    assert.equal(Object.hasOwn(page.plans[0].purposes, 'ambient'), false)
    assert.equal(Object.hasOwn(page.plans[0].purposes.decisions, 'ambient'), false)
    page.all().find(node => node.type === 'switch').props.onCheckedChange(true); page.runtime.render()
    page.select('对照模型').props.onValueChange('chat'); page.runtime.render()
    await page.submit()
    assert.deepEqual(page.plans[1].purposes.ambient, { profile: 'ts', fallbacks: ['flash'], compare: 'chat', minConfidence: 0.7, mode: 'shadow' })
  } finally { page.runtime.unmount() }
})

test('an invalid judge is reported next to its field and nothing is saved', async () => {
  const page = await purposesPage(view({ purposes: { defaults: { chat: 'chat' }, ambient: {}, decisions: {} } }), { judgeRead: judgeView({}, { chain: [{ profile: 'chat', kind: 'language' }], inheritedFrom: 'chat' }) })
  try {
    assert.match(page.text(), /跟随聊天：CHAT/u)
    const threshold = page.all().find(node => node.type === 'input' && node.props['aria-label'] === '门槛（0 到 1）')
    threshold.props.onChange({ target: { value: '1.5' } }); page.runtime.render()
    await page.submit(); page.runtime.render()
    assert.equal(page.plans.length, 0)
    assert.match(page.text(), /门槛要在 0 到 1 之间/u)
  } finally { page.runtime.unmount() }
})

test('the migration banner explains the migration and the revert, and closing it posts noticed', async () => {
  const migration = { id: 'adr-0066-ambient-judge', status: 'migrated', at: NOW, rows: [{ field: 'profile', value: 'ts', from: 'purposes.decisions.ambient.profile' }], notes: [{ code: 'language-judge-became-fallback', value: 'flash' }] }
  let noticed = false
  const page = await purposesPage(view({ purposes: { defaults: { chat: 'chat' }, ambient: { profile: 'ts', fallbacks: ['flash'] }, decisions: {} } }), {
    request: async (path, _body, method) => {
      if (path === '/ambient-judge') return judgeView(undefined, { migration: noticed ? { ...migration, noticedAt: NOW } : migration })
      if (path === '/ambient-judge/migration/noticed') { assert.equal(method, 'POST'); noticed = true; return { noticedAt: NOW } }
      return { adapters: [], endpoints: [], scenes: [], agents: [] }
    },
  })
  try {
    assert.match(page.text(), /插话判断已从旧配置迁移/u)
    assert.match(page.text(), /zhin ai purposes revert ambient-judge/u)
    assert.match(page.text(), /原来的旁听模型 FLASH 现在是第一个备用/u, 'the note names the Profile by its label')
    const button = page.all().find(node => node.type === 'button' && [node.props.children].flat(Infinity).includes('知道了'))
    await button.props.onClick(); await page.runtime.settle()
    assert.equal(noticed, true)
    assert.doesNotMatch(page.text(), /插话判断已从旧配置迁移/u, 'shown once')
  } finally { page.runtime.unmount() }
})

test('an older instance keeps 旁听 and 旁听参与判断, says to upgrade, and writes the old keys', async () => {
  const page = await purposesPage(view({ purposes: { defaults: { chat: 'chat', ambient: 'flash' }, decisions: { ambient: { mode: 'active', profile: 'ts' } } } }), {
    judgeRead: new model.InferenceRequestError('not-installed', 404),
  })
  try {
    assert.ok(page.select('旁听'))
    assert.ok(page.select('旁听参与判断模式'))
    assert.equal(page.select('插话判断模型'), undefined)
    assert.match(page.text(), /这个实例还是旧版本/u)
    await page.submit()
    assert.deepEqual(page.plans[0].purposes.ambient, { profile: 'flash' })
    assert.deepEqual(page.plans[0].purposes.decisions.ambient, { mode: 'active', profile: 'ts' })
  } finally { page.runtime.unmount() }
})
