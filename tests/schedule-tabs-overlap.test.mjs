import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { summarizeAssistantJobs, summarizeSchedules } from '../console-ui/src/pages/task-hub-summary-model.mjs'

// #64 `schedule-tabs-overlap`: 「成都工作日天气早报」 and 「Profile heartbeat」 are persistent reminders, which
// are also assistant jobs: the summary said 「定时提醒 2」「助手任务 2」 while 「全部」 had 2 tasks, and the
// same next run read `2026/11/17 09:00:00` in 全部任务 but 「24 小时后」 in 定时提醒.
const schedules = { memory: [], persistent: [{ id: 'job-weather', enabled: true }, { id: 'job-heartbeat', enabled: true }] }
const jobs = { eventsActive: true, jobs: [
  { id: 'job-weather', enabled: true, state: {} },
  { id: 'job-heartbeat', enabled: true, state: { lastStatus: 'error' } },
  { id: 'job-chat-promise', enabled: true, state: {} },
] }

test('the assistant card does not count jobs that are already counted as reminders', () => {
  const reminders = summarizeSchedules(schedules)
  assert.equal(reminders.total, 2)
  assert.deepEqual(summarizeAssistantJobs(jobs, 'zh-CN', ['job-weather', 'job-heartbeat']), { total: 1, enabled: 1, failing: 0, reminders: 2 })
  // Without the reminder list (older call sites) nothing changes.
  assert.deepEqual(summarizeAssistantJobs(jobs), { total: 3, enabled: 3, failing: 1, reminders: 0 })
})

test('the task hub passes the reminder ids, and 全部任务 shows the next run like 定时提醒', () => {
  const hub = readFileSync(new URL('../console-ui/src/pages/task-hub.tsx', import.meta.url), 'utf8')
  // The cards are built from what 全部任务 read (#64 task-hub-overview-double-read); the reminder ids go along.
  assert.match(hub, /summarizeOverviewSources\(sources, i18n\.locale\)/)
  const model = readFileSync(new URL('../console-ui/src/pages/task-hub-summary-model.mjs', import.meta.url), 'utf8')
  assert.match(model, /summarizeAssistantJobs\(sources\.assistant, locale, reminderIds\)/)
  assert.match(hub, /i18n\.t\("另有 \{0\} 个来自定时提醒，已算在「定时提醒」里"/)
  const overview = readFileSync(new URL('../console-ui/src/pages/TaskOverview.tsx', import.meta.url), 'utf8')
  assert.match(overview, /relativeUntil\(value, Date\.now\(\), i18n\.locale\)/)
})
