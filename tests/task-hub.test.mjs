import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import {
  TASK_HUB_TABS, DEFAULT_TASK_TAB, resolveTaskTab, taskTabHref, legacyTaskRedirect,
} from '../console-ui/src/pages/task-hub-model.mjs'
import { resolveLegacyRedirect } from '../console-ui/src/console-routes.mjs'

const src = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('legacy routes redirect to the matching task tab and keep the query', () => {
  assert.equal(legacyTaskRedirect('/cron'), '/ops/schedules?tab=schedule')
  assert.equal(legacyTaskRedirect('/assistant/jobs'), '/ops/schedules?tab=assistant')
  assert.equal(legacyTaskRedirect('/assistant/jobs', '?q=task%3Adaily'), '/ops/schedules?tab=assistant&q=task%3Adaily')
  assert.equal(legacyTaskRedirect('/assistant/jobs', '?tab=history&q=x'), '/ops/schedules?tab=assistant&q=x')
  assert.equal(legacyTaskRedirect('/logs'), null)
  assert.equal(taskTabHref('assistant', { q: 'a b' }), '/ops/schedules?tab=assistant&q=a+b')
  // The shell-wide redirect table agrees with the hub's own legacy mapping.
  for (const [path, search] of [['/cron', ''], ['/assistant/jobs', '?q=task%3Adaily'], ['/assistant/jobs', '?tab=history&q=x']]) {
    assert.equal(resolveLegacyRedirect(path, search), legacyTaskRedirect(path, search), path + search)
  }
})

test('tab id from the URL resolves to a visible tab, unknown ids fall back', () => {
  assert.deepEqual(TASK_HUB_TABS.map(tab => tab.id), ['overview', 'admin', 'schedule', 'assistant', 'history'])
  assert.equal(resolveTaskTab(null), DEFAULT_TASK_TAB)
  assert.equal(resolveTaskTab('bogus'), DEFAULT_TASK_TAB)
  for (const tab of TASK_HUB_TABS) assert.equal(resolveTaskTab(tab.id), tab.id)
})

test('the 运维 section has one schedule entry; /tasks, /cron and /assistant/jobs are hidden redirects', async () => {
  const text = await src('registerBuiltinShell.tsx')
  assert.match(text, /path: P\.opsSchedules, name: '定时任务'[^\n]*element: <TaskHubPage \/>[^\n]*group: NAV_GROUPS\.OPS/)
  assert.doesNotMatch(text, /pages\/cron'|pages\/assistant-jobs'/, 'the shell registers the hub, not the old pages')
  assert.match(text, /LEGACY_ROUTE_REDIRECTS\)\) \{\s*app\.addRoute\(\{ path, name: path, parent: rule\.to, element: <LegacyRedirect \/>, meta: \{ hideInMenu: true \} \}\)/)
  for (const path of ['/tasks', '/cron', '/assistant/jobs']) assert.ok(resolveLegacyRedirect(path)?.startsWith('/ops/schedules'), path)
})

test('in-app links point at hub tabs, not retired routes', async () => {
  for (const file of ['pages/cron.tsx', 'pages/assistant-jobs.tsx', 'pages/task-center.tsx', 'pages/welcome-use-case.tsx', 'pages/ScheduleExecutions.tsx']) {
    assert.doesNotMatch(await src(file), /['"`]\/(cron|assistant\/jobs)\b[^'"`]*['"`]/, file)
  }
  const hub = await src('pages/task-hub.tsx')
  for (const panel of ['TaskCenterPage', 'CronPage', 'AssistantJobsPage', 'ScheduleExecutions']) assert.match(hub, new RegExp(`<${panel}\\b`))
  assert.match(hub, /useSearchParams/)
})

test('the summary cards live inside 全部任务, so tabs are the only task navigation', async () => {
  const hub = await src('pages/task-hub.tsx')
  const page = hub.slice(hub.indexOf('export default function TaskHubPage'))
  assert.doesNotMatch(page, /<StatGrid/, 'no stat cards above the tabs')
  assert.match(hub.slice(hub.indexOf('function OverviewPanel'), hub.indexOf('export default function TaskHubPage')), /<StatGrid[\s\S]*<TaskOverview/)
  assert.doesNotMatch(hub, /pressed=/, 'cards open a tab; they are not a filter')
})

test('tab and filter labels are authored constants with English entries', async () => {
  const { englishMessages } = await import('../console-ui/src/i18n/messages.en.mjs')
  const { TASK_OVERVIEW_FILTERS } = await import('../console-ui/src/pages/task-overview-model.mjs')
  for (const { label } of [...TASK_HUB_TABS, ...TASK_OVERVIEW_FILTERS]) assert.equal(typeof englishMessages[label], 'string', label)
})
