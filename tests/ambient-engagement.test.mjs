import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AMBIENT_STATUS_PERMISSION,
  BEHAVIOR_CHOICES,
  buildAmbientPatches,
  describeAmbientStatus,
  describeSaveResult,
  isPermissionDenied,
  parseGroupList,
  readAmbientSettings,
  validateAmbientSettings,
  validateAmbientStatus,
} from '../console-ui/src/pages/ambient-engagement-model.mjs'

const hostStatus = {
  enabled: true,
  mode: 'shadow',
  groups: 2,
  judges: ['groq/gpt-oss-120b', 'groq/gpt-oss-20b'],
  last24h: { spoke: 1, watched: 4, stayed_quiet: 7, skipped: 2 },
  decisionShadow: { agreed: 5, disagreed: 1 },
  recent: [
    { at: 1700000000000, group: 'qq:1', outcome: 'watched', confidence: 0.82, judge: 'decision' },
    { at: 1699999990000, group: 'qq:2', outcome: 'skipped', skipReason: 'hourly_cap' },
  ],
  updatedAt: 1700000000000,
}

test('the documented plugin.root.ambient shape is accepted and declares ambient:read', () => {
  assert.equal(AMBIENT_STATUS_PERMISSION, 'ambient:read')
  assert.equal(validateAmbientStatus(hostStatus), hostStatus)
  assert.doesNotThrow(() => validateAmbientStatus({ ...hostStatus, enabled: false, mode: 'off', groups: 0, recent: [], updatedAt: null }))
})

test('malformed status never turns into an empty page', () => {
  const malformed = [
    null,
    [],
    { ...hostStatus, mode: 'loud' },
    { ...hostStatus, groups: 'some' },
    { ...hostStatus, last24h: { spoke: 1 } },
    { ...hostStatus, recent: {} },
    { ...hostStatus, recent: [{ at: 'now', group: 'qq:1', outcome: 'spoke' }] },
    { ...hostStatus, recent: [{ at: 1, group: 'qq:1', outcome: 'shouted' }] },
    { ...hostStatus, updatedAt: 'yesterday' },
  ]
  for (const body of malformed) assert.throws(() => validateAmbientStatus(body))
})

test('the status view uses plain words and hides judges, models and confidence', () => {
  const view = describeAmbientStatus(hostStatus)
  assert.equal(view.behavior, '只观察')
  assert.equal(view.groupScope, '2 个群')
  assert.deepEqual(view.counts.map((count) => count.value), [1, 4, 7, 2])
  assert.deepEqual(view.recent.map((entry) => entry.text), ['想接话（只观察，没开口）', '这次没有判断：这个小时插话次数已用完'])
  const rendered = JSON.stringify(view)
  for (const jargon of ['judge', 'groq', 'gpt-oss', 'confidence', 'decision', 'shadow', '0.82']) {
    assert.doesNotMatch(rendered, new RegExp(jargon, 'i'), jargon)
  }
  assert.equal(describeAmbientStatus({ ...hostStatus, enabled: false, groups: 0 }).behavior, '关闭')
  assert.equal(describeAmbientStatus({ ...hostStatus, mode: 'active', groups: 'all' }).groupScope, '所有群')
})

test('the three choices are 关闭 / 只观察 / 主动参与', () => {
  assert.deepEqual(BEHAVIOR_CHOICES.map((choice) => choice.label), ['关闭', '只观察', '主动参与'])
  const hints = BEHAVIOR_CHOICES.map((choice) => choice.hint).join('')
  assert.doesNotMatch(hints, /judge|shadow|decision|判官|决策/i)
})

test('stored ai.trigger.ambient maps onto the simple form', () => {
  assert.deepEqual(readAmbientSettings({}), { behavior: 'off', groupScope: 'some', groups: [], maxPerHour: 3 })
  assert.deepEqual(readAmbientSettings({ ai: { trigger: { ambient: { conversations: ['*'] } } } }), { behavior: 'join', groupScope: 'all', groups: [], maxPerHour: 3 })
  assert.deepEqual(
    readAmbientSettings({ ai: { trigger: { ambient: { conversations: ['qq:1', 'qq:2'], mode: 'shadow', maxPerHour: 5 } } } }),
    { behavior: 'watch', groupScope: 'some', groups: ['qq:1', 'qq:2'], maxPerHour: 5 },
  )
  assert.equal(readAmbientSettings({ ai: { trigger: { ambient: { conversations: [], mode: 'active' } } } }).behavior, 'off')
})

test('group lists accept one group per line and drop blanks and repeats', () => {
  assert.deepEqual(parseGroupList(' qq:1 \n\nqq:2，qq:1\n'), ['qq:1', 'qq:2'])
})

test('settings are checked before saving', () => {
  assert.deepEqual(validateAmbientSettings({ behavior: 'off', groupScope: 'some', groups: [], maxPerHour: 0 }), [])
  assert.deepEqual(validateAmbientSettings({ behavior: 'join', groupScope: 'all', groups: [], maxPerHour: 3 }), [])
  assert.equal(validateAmbientSettings({ behavior: 'join', groupScope: 'some', groups: [], maxPerHour: 3 }).length, 1)
  assert.match(validateAmbientSettings({ behavior: 'watch', groupScope: 'some', groups: ['123456'], maxPerHour: 3 })[0], /平台:群号/)
  assert.equal(validateAmbientSettings({ behavior: 'join', groupScope: 'all', groups: [], maxPerHour: 61 }).length, 1)
  assert.equal(validateAmbientSettings({ behavior: 'join', groupScope: 'all', groups: [], maxPerHour: 1.5 }).length, 1)
})

test('saving only patches keys under ai.trigger.ambient', () => {
  assert.deepEqual(buildAmbientPatches({ behavior: 'off', groupScope: 'some', groups: ['qq:1'], maxPerHour: 3 }), [
    { op: 'set', path: ['ai', 'trigger', 'ambient', 'conversations'], value: [] },
  ])
  assert.deepEqual(buildAmbientPatches({ behavior: 'watch', groupScope: 'some', groups: ['qq:1'], maxPerHour: 4 }), [
    { op: 'set', path: ['ai', 'trigger', 'ambient', 'conversations'], value: ['qq:1'] },
    { op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'], value: 'shadow' },
    { op: 'set', path: ['ai', 'trigger', 'ambient', 'maxPerHour'], value: 4 },
  ])
  const joinAll = buildAmbientPatches({ behavior: 'join', groupScope: 'all', groups: ['qq:1'], maxPerHour: 3 })
  assert.deepEqual(joinAll[0].value, ['*'])
  assert.equal(joinAll[1].value, 'active')
  for (const patch of joinAll) assert.deepEqual(patch.path.slice(0, 3), ['ai', 'trigger', 'ambient'])
})

test('a successful save always says whether a restart is needed', () => {
  const saved = describeSaveResult({ status: 'saved', restartRequired: true, revision: 'r2', paths: [], missingEnv: [], message: '配置已保存，需重启进程才能生效' })
  assert.equal(saved.kind, 'saved')
  assert.equal(saved.restartRequired, true)
  assert.match(saved.text, /重启/)
  const savedWithoutFlag = describeSaveResult({ status: 'saved' })
  assert.equal(savedWithoutFlag.restartRequired, true)
  const hotApplied = describeSaveResult({ status: 'saved', restartRequired: false })
  assert.match(hotApplied.text, /不用重启/)
  assert.equal(describeSaveResult({ status: 'conflict', revision: 'r3', current: [] }).kind, 'conflict')
  assert.equal(describeSaveResult({ status: 'invalid', errors: [] }).kind, 'invalid')
  assert.equal(describeSaveResult(null).kind, 'error')
})

test('401 and 403 from the Host mean the account lacks ambient:read', () => {
  assert.equal(isPermissionDenied({ status: 403 }), true)
  assert.equal(isPermissionDenied({ status: 401 }), true)
  assert.equal(isPermissionDenied({ status: 500 }), false)
  assert.equal(isPermissionDenied(undefined), false)
})

test('the page reads status through pluginRpc(root, ambient) and writes with config:patch + expectedRevision', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/ambient-engagement.tsx', import.meta.url), 'utf8')
  assert.match(page, /pluginRpc<unknown>\('root', 'ambient'\)/)
  assert.match(page, /type: 'config:patch'/)
  assert.match(page, /expectedRevision: initial\.revision/)
  assert.doesNotMatch(page, /config:set/)
  assert.doesNotMatch(page, /判官|决策模型|judge/)
  const rpc = readFileSync(new URL('../console-ui/src/utils/plugin-rpc.ts', import.meta.url), 'utf8')
  assert.match(rpc, /type: `plugin\.\$\{pluginId\}\.\$\{method\}`/)
  assert.match(rpc, /'\/api\/console\/request'/)
})
