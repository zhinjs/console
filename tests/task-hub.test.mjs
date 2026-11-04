import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import {
  TASK_HUB_TABS, DEFAULT_TASK_TAB, visibleTaskTabs, resolveTaskTab, taskTabHref, legacyTaskRedirect,
} from '../console-ui/src/pages/task-hub-model.mjs'

const src = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('legacy routes redirect to the matching task tab and keep the query', () => {
  assert.equal(legacyTaskRedirect('/cron'), '/tasks?tab=schedule')
  assert.equal(legacyTaskRedirect('/assistant/jobs'), '/tasks?tab=assistant')
  assert.equal(legacyTaskRedirect('/assistant/jobs', '?q=task%3Adaily'), '/tasks?tab=assistant&q=task%3Adaily')
  assert.equal(legacyTaskRedirect('/assistant/jobs', '?tab=history&q=x'), '/tasks?tab=assistant&q=x')
  assert.equal(legacyTaskRedirect('/logs'), null)
  assert.equal(taskTabHref('assistant', { q: 'a b' }), '/tasks?tab=assistant&q=a+b')
})

test('tab id from the URL resolves to a visible tab, unknown ids fall back', () => {
  assert.deepEqual(TASK_HUB_TABS.map(tab => tab.id), ['admin', 'schedule', 'assistant', 'history'])
  assert.equal(resolveTaskTab(null), DEFAULT_TASK_TAB)
  assert.equal(resolveTaskTab('bogus'), DEFAULT_TASK_TAB)
  for (const tab of TASK_HUB_TABS) assert.equal(resolveTaskTab(tab.id), tab.id)
})

test('tabs only appear when their required permissions are held', () => {
  const tabs = [
    { id: 'admin', label: 'a', permissions: [] },
    { id: 'schedule', label: 's', permissions: ['schedule:read'] },
    { id: 'history', label: 'h', permissions: ['full'] },
  ]
  const gated = (granted) => tabs.filter(tab => tab.permissions.every(permission => new Set(granted).has(permission)))
  assert.deepEqual(gated([]).map(tab => tab.id), ['admin'])
  assert.deepEqual(resolveTaskTab('schedule', gated([])), 'admin', 'a hidden tab cannot be opened through the URL')
  assert.deepEqual(resolveTaskTab('schedule', gated(['schedule:read'])), 'schedule')
  assert.deepEqual(resolveTaskTab('x', []), DEFAULT_TASK_TAB)
  // Current tabs declare no permission, so they are all visible with or without a permission set.
  assert.equal(visibleTaskTabs().length, 4)
  assert.equal(visibleTaskTabs([]).length, 4)
})

test('the sidebar has one task entry; /cron and /assistant/jobs are hidden redirects', async () => {
  const source = ts.createSourceFile('r.tsx', await src('registerBuiltinShell.tsx'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const text = await src('registerBuiltinShell.tsx')
  const block = path => { const start = text.indexOf(`path: '${path}'`); return text.slice(start, text.indexOf('})', start)) }
  assert.ok(source)
  assert.match(block('/tasks'), /name: '任务'/)
  assert.doesNotMatch(block('/tasks'), /hideInMenu/)
  for (const path of ['/cron', '/assistant/jobs']) {
    assert.match(block(path), /LegacyTaskRoute/)
    assert.match(block(path), /hideInMenu: true/)
  }
  assert.doesNotMatch(text, /pages\/cron'|pages\/assistant-jobs'/, 'the shell registers the hub, not the old pages')
  const visibleTaskGroupEntries = [...text.matchAll(/path: '([^']+)'[\s\S]*?\}\)/g)]
    .filter(([block]) => /NAV_GROUPS\.TASKS/.test(block) && !/hideInMenu: true/.test(block)).map(([, path]) => path)
  assert.deepEqual(visibleTaskGroupEntries.filter(path => ['/tasks', '/cron', '/assistant/jobs'].includes(path)), ['/tasks'])
})

test('in-app links point at hub tabs, not retired routes', async () => {
  for (const file of ['pages/cron.tsx', 'pages/assistant-jobs.tsx', 'pages/task-center.tsx', 'pages/welcome-use-case.tsx', 'pages/ScheduleExecutions.tsx']) {
    assert.doesNotMatch(await src(file), /['"`]\/(cron|assistant\/jobs)\b[^'"`]*['"`]/, file)
  }
  const hub = await src('pages/task-hub.tsx')
  for (const panel of ['TaskCenterPage', 'CronPage', 'AssistantJobsPage', 'ScheduleExecutions']) assert.match(hub, new RegExp(`<${panel}\\b`))
  assert.match(hub, /useSearchParams/)
})
