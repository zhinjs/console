import test from 'node:test'
import assert from 'node:assert/strict'
import {
  summarizeAdminTasks,
  summarizeAssistantJobs,
  summarizeExecutions,
  summarizeSchedules,
} from '../console-ui/src/pages/task-hub-summary-model.mjs'

test('unreadable sources stay unknown instead of looking like zero', () => {
  assert.equal(summarizeAdminTasks(null), null)
  assert.equal(summarizeSchedules(null), null)
  assert.equal(summarizeAssistantJobs(null), null)
  assert.equal(summarizeExecutions(null), null)
  assert.equal(summarizeAssistantJobs({ eventsActive: true }), null)
})

test('admin tasks are counted across every provider', () => {
  const task = (state) => ({ id: state, state })
  const summary = summarizeAdminTasks({ generation: 1, providers: [
    { tasks: [task('scheduled'), task('paused')] },
    { tasks: [task('failed')] },
    { tasks: [] },
  ] })
  assert.deepEqual(summary, { total: 3, paused: 1, failed: 1, providers: 3 })
})

test('schedules combine memory timers and persistent reminders, counting both kinds of paused', () => {
  assert.deepEqual(summarizeSchedules({
    memory: [{ running: true }, { running: false }],
    persistent: [{ enabled: true }, { enabled: false }, { enabled: true }],
  }), { total: 5, persistent: 3, paused: 2 })
  assert.deepEqual(summarizeSchedules({}), { total: 0, persistent: 0, paused: 0 })
})

test('assistant jobs report enabled and failing jobs from their last run', () => {
  assert.deepEqual(summarizeAssistantJobs({ eventsActive: true, jobs: [
    { id: 'a', enabled: true, state: { lastStatus: 'ok' } },
    { id: 'b', enabled: true, state: { lastStatus: 'error' } },
    { id: 'c', enabled: false, state: { lastError: 'timeout' } },
  ] }), { total: 3, enabled: 2, failing: 2 })
})

test('executions only describe the first page and say when more exist', () => {
  const run = (status) => ({ runId: status, jobId: 'j', status })
  assert.deepEqual(summarizeExecutions({ runs: [run('succeeded'), run('failed'), run('interrupted'), run('running')], nextCursor: 'n' }),
    { recent: 4, hasMore: true, failed: 2, running: 1 })
  assert.deepEqual(summarizeExecutions({ runs: [], nextCursor: null }), { recent: 0, hasMore: false, failed: 0, running: 0 })
})
