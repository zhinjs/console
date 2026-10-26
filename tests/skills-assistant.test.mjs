import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ASSISTANT_TASKS,
  MODE_CHOICES,
  MODE_EXPLANATION,
  SKILLS_STATUS_PERMISSION,
  buildSkillsPatches,
  describeSaveResult,
  describeSkillsStatus,
  findAssistantInstanceKey,
  hasSkillsChanges,
  isPermissionDenied,
  readSkillsSettings,
  validateSkillsStatus,
} from '../console-ui/src/pages/skills-assistant-model.mjs'

const hostStatus = {
  tasks: [
    { task: 'skills', mode: 'shadow', calls: 6, selected: 0, abstained: 2, shadow: 3, failed: 1, averageMs: 420, inputTokens: 900, outputTokens: 60, lastModel: 'jev-1.14', lastAt: 1700000000000 },
    { task: 'tools', mode: 'active', calls: 2, selected: 2, abstained: 0, shadow: 0, failed: 0, averageMs: 1500, inputTokens: 300, outputTokens: 20, lastAt: 1699999990000 },
  ],
  totals: { calls: 8, inputTokens: 1200, outputTokens: 80 },
  recent: [
    { at: 1700000000000, task: 'skills', mode: 'shadow', outcome: 'failed', durationMs: 900, model: 'jev-1.14', reason: 'timeout' },
    { at: 1699999990000, task: 'tools', mode: 'active', outcome: 'selected', durationMs: 1500 },
  ],
  updatedAt: 1700000000000,
}

const installedConfig = {
  plugins: { typesafe: '@zhin.js/service-typesafe', sandbox: '@zhin.js/adapter-sandbox' },
  ai: { decisions: { provider: 'root/typesafe', skills: { mode: 'shadow', minConfidence: 0.6 }, tools: { mode: 'active' } } },
  typesafe: { apiKey: '${TYPESAFE_API_KEY}' },
}

test('the documented plugin.root.skills shape is accepted and declares skills:read', () => {
  assert.equal(SKILLS_STATUS_PERMISSION, 'skills:read')
  assert.equal(validateSkillsStatus(hostStatus), hostStatus)
  assert.doesNotThrow(() => validateSkillsStatus({ tasks: [], totals: { calls: 0, inputTokens: 0, outputTokens: 0 }, recent: [], updatedAt: null }))
})

test('malformed status never turns into an empty page', () => {
  const malformed = [
    null,
    [],
    { ...hostStatus, tasks: {} },
    { ...hostStatus, tasks: [{ ...hostStatus.tasks[0], mode: 'loud' }] },
    { ...hostStatus, tasks: [{ ...hostStatus.tasks[0], calls: -1 }] },
    { ...hostStatus, totals: null },
    { ...hostStatus, recent: [{ at: 'now', task: 'skills', outcome: 'selected', durationMs: 1 }] },
    { ...hostStatus, recent: [{ at: 1, task: 'skills', outcome: 'guessed', durationMs: 1 }] },
    { ...hostStatus, updatedAt: 'yesterday' },
  ]
  for (const body of malformed) assert.throws(() => validateSkillsStatus(body))
})

test('the status view uses plain words and hides models, reasons and token counts', () => {
  const view = describeSkillsStatus(hostStatus)
  assert.equal(view.totalCalls, 8)
  assert.equal(view.failedCalls, 1)
  assert.deepEqual(view.tasks.map((row) => [row.label, row.mode, row.helped, row.averageTime]), [
    ['帮机器人挑技能', '只观察', 3, '420 毫秒'],
    ['帮机器人挑工具', '正式使用', 2, '1.5 秒'],
  ])
  assert.deepEqual(view.recent.map((entry) => entry.text), ['这次没成功', '给出了建议'])
  const rendered = JSON.stringify(view)
  for (const jargon of ['jev', 'timeout', 'token', '1200', 'decision', 'judge', 'shadow"', 'confidence']) {
    assert.doesNotMatch(rendered, new RegExp(jargon, 'i'), jargon)
  }
})

test('choices are plain words without decision or judge jargon', () => {
  assert.deepEqual(MODE_CHOICES.map((choice) => choice.label), ['关闭', '只观察', '正式使用'])
  assert.deepEqual(ASSISTANT_TASKS.map((entry) => entry.task), ['skills', 'tools', 'memory', 'agents', 'approval', 'ambient'])
  const copy = [MODE_EXPLANATION, ...ASSISTANT_TASKS.flatMap((entry) => [entry.label, entry.hint])].join('')
  assert.doesNotMatch(copy, /judge|shadow|decision|TypeSafe|Jev|判官|决策/i)
})

test('the service instance comes from plugins, preferring the bound provider', () => {
  assert.equal(findAssistantInstanceKey(installedConfig), 'typesafe')
  assert.equal(findAssistantInstanceKey({ plugins: { first: '@zhin.js/service-typesafe', second: '@zhin.js/service-typesafe' }, ai: { decisions: { provider: 'root/second' } } }), 'second')
  assert.equal(findAssistantInstanceKey({ plugins: { jev: { package: '@zhin.js/service-typesafe' } } }), 'jev')
  assert.equal(findAssistantInstanceKey({ plugins: { sandbox: '@zhin.js/adapter-sandbox' } }), undefined)
  assert.equal(findAssistantInstanceKey({}), undefined)
})

test('stored ai.decisions maps onto one choice per task; missing tasks are off', () => {
  const settings = readSkillsSettings(installedConfig)
  assert.equal(settings.instanceKey, 'typesafe')
  assert.equal(settings.provider, 'root/typesafe')
  assert.equal(settings.usesOtherService, false)
  assert.deepEqual(settings.modes, { skills: 'shadow', tools: 'active', memory: 'off', agents: 'off', approval: 'off', ambient: 'off' })
  const other = readSkillsSettings({ ...installedConfig, ai: { decisions: { provider: 'root/other-decider' } } })
  assert.equal(other.usesOtherService, true)
  const unbound = readSkillsSettings({ plugins: installedConfig.plugins })
  assert.equal(unbound.provider, undefined)
  assert.equal(unbound.usesOtherService, false)
})

test('saving only writes the changed task modes under ai.decisions', () => {
  const initial = readSkillsSettings(installedConfig)
  assert.equal(hasSkillsChanges(initial, initial.modes), false)
  const nextModes = { ...initial.modes, skills: 'active', approval: 'shadow' }
  assert.equal(hasSkillsChanges(initial, nextModes), true)
  assert.deepEqual(buildSkillsPatches(initial, nextModes), [
    { op: 'set', path: ['ai', 'decisions', 'skills', 'mode'], value: 'active' },
    { op: 'set', path: ['ai', 'decisions', 'approval', 'mode'], value: 'shadow' },
  ])
})

test('an unbound installation also points ai.decisions.provider at the installed instance', () => {
  const initial = readSkillsSettings({ plugins: { typesafe: '@zhin.js/service-typesafe' } })
  const patches = buildSkillsPatches(initial, { ...initial.modes, skills: 'shadow' })
  assert.deepEqual(patches, [
    { op: 'set', path: ['ai', 'decisions', 'provider'], value: 'root/typesafe' },
    { op: 'set', path: ['ai', 'decisions', 'skills', 'mode'], value: 'shadow' },
  ])
  for (const patch of patches) assert.deepEqual(patch.path.slice(0, 2), ['ai', 'decisions'])
})

test('a successful save always says whether a restart is needed', () => {
  const saved = describeSaveResult({ status: 'saved', restartRequired: true })
  assert.equal(saved.restartRequired, true)
  assert.match(saved.text, /重启/)
  assert.equal(describeSaveResult({ status: 'saved' }).restartRequired, true)
  assert.match(describeSaveResult({ status: 'saved', restartRequired: false }).text, /不用重启/)
  assert.equal(describeSaveResult({ status: 'conflict' }).kind, 'conflict')
  assert.equal(describeSaveResult({ status: 'invalid', errors: [] }).kind, 'invalid')
  assert.equal(describeSaveResult(undefined).kind, 'error')
})

test('401 and 403 from the Host mean the account lacks skills:read', () => {
  assert.equal(isPermissionDenied({ status: 403 }), true)
  assert.equal(isPermissionDenied({ status: 401 }), true)
  assert.equal(isPermissionDenied({ status: 502 }), false)
  assert.equal(isPermissionDenied(null), false)
})

test('the page reads status through pluginRpc(root, skills) and writes with config:patch + instanceKey + expectedRevision', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/skills-assistant.tsx', import.meta.url), 'utf8')
  assert.match(page, /pluginRpc<unknown>\('root', 'skills'\)/)
  assert.match(page, /type: 'config:patch'/)
  assert.match(page, /instanceKey: initial\.settings\.instanceKey/)
  assert.match(page, /expectedRevision: initial\.revision/)
  assert.doesNotMatch(page, /config:set/)
  assert.doesNotMatch(page, /判官|决策模型|judge|TypeSafe|Jev/)
})


test('English display retains status meaning, unknown task names and exact configuration patches', () => {
  const view=describeSkillsStatus({...hostStatus, tasks:[...hostStatus.tasks,{...hostStatus.tasks[0],task:'第三方任务'}]}, 'en')
  assert.equal(view.tasks[0].label, 'Choose skills for the bot')
  assert.equal(view.tasks[0].mode, 'Observe only'); assert.equal(view.tasks[0].modeVariant, 'info')
  assert.equal(view.tasks[1].modeVariant, 'success'); assert.equal(view.tasks[1].averageTime,'1.5 s')
  assert.equal(view.tasks[2].label,'第三方任务')
  assert.equal(view.recent[0].text,'Unsuccessful attempt')
  assert.match(describeSaveResult({status:'saved',restartRequired:true},'en').text,/Restart the bot/)
  assert.throws(()=>validateSkillsStatus({},'en'),/Invalid skills assistant status/)
})
