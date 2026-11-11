import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ASSISTANT_TASKS,
  SKILLS_STATUS_PERMISSION,
  describeSkillsStatus,
  isPermissionDenied,
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

test('all six graph-managed tasks retain plain status labels', () => {
  assert.deepEqual(ASSISTANT_TASKS.map(entry => entry.task), ['skills', 'tools', 'memory', 'agents', 'approval', 'ambient'])
  assert.doesNotMatch(ASSISTANT_TASKS.flatMap(entry => [entry.label, entry.hint]).join(''), /judge|shadow|decision|TypeSafe|Jev|判官|决策/i)
  for (const [mode, label] of [['off', '关闭'], ['shadow', '只观察'], ['active', '正式使用']]) {
    const view = describeSkillsStatus({ ...hostStatus, tasks: [{ ...hostStatus.tasks[0], mode }] })
    assert.equal(view.tasks[0].mode, label)
  }
})

test('401 and 403 from the Host mean the account lacks skills:read', () => {
  assert.equal(isPermissionDenied({ status: 403 }), true)
  assert.equal(isPermissionDenied({ status: 401 }), true)
  assert.equal(isPermissionDenied({ status: 502 }), false)
  assert.equal(isPermissionDenied(null), false)
})

test('the page keeps status permission and routes configuration to graph purposes', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/skills-assistant.tsx', import.meta.url), 'utf8')
  assert.match(page, /pluginRpc<unknown>\('root', 'skills'\)/)
  assert.match(page, /to="\/features\/ai\?tab=purposes"/)
  assert.doesNotMatch(page, /config:(?:set|patch|get-source)|ai\.decisions|root\/\$\{|instanceKey/)
  assert.doesNotMatch(page, /判官|决策模型|judge|TypeSafe|Jev/)
})


test('English display retains status meaning and unknown task names', () => {
  const view=describeSkillsStatus({...hostStatus, tasks:[...hostStatus.tasks,{...hostStatus.tasks[0],task:'第三方任务'}]}, 'en')
  assert.equal(view.tasks[0].label, 'Choose skills for the bot')
  assert.equal(view.tasks[0].mode, 'Observe only'); assert.equal(view.tasks[0].modeVariant, 'info')
  assert.equal(view.tasks[1].modeVariant, 'success'); assert.equal(view.tasks[1].averageTime,'1.5 s')
  assert.equal(view.tasks[2].label,'第三方任务')
  assert.equal(view.recent[0].text,'Unsuccessful attempt')
  assert.throws(()=>validateSkillsStatus({},'en'),/Invalid skills assistant status/)
})
