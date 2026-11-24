import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as hubModel from '../console-ui/src/pages/task-hub-model.mjs'
import * as summaryModel from '../console-ui/src/pages/task-hub-summary-model.mjs'
import * as providersModel from '../console-ui/src/pages/task-center-model.mjs'
import * as assistantModel from '../console-ui/src/pages/assistant-jobs-model.mjs'
import * as executionsModel from '../console-ui/src/pages/schedule-executions-model.mjs'

// #64 `task-hub-overview-double-read`: opening 定时任务 on 总览 read `/api/tasks/providers`,
// `schedule:list` and `/api/assistant/jobs` twice — once for the summary cards (useTaskHubSummary)
// and once for the table under them (TaskOverview), in parallel.
const url = new URL('../console-ui/src/pages/task-hub.tsx', import.meta.url)
const source = await readFile(url, 'utf8')

function mount() {
  const slots = []; let cursor = 0; let effects = []
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useMemo(fn, deps) { const i = cursor++; const prev = slots[i]; if (prev && deps.every((d, k) => d === prev.deps[k])) return prev.value; const value = fn(); slots[i] = { deps, value }; return value },
    useCallback(fn) { cursor++; return fn },
    useEffect(fn, deps) { const i = cursor++; const prev = slots[i]; if (!prev || !deps || deps.some((d, k) => d !== prev.deps[k])) { prev?.cleanup?.(); effects.push(() => { slots[i] = { deps, cleanup: fn() } }) } },
  }
  const reads = []
  const json = body => ({ ok: true, status: 200, json: async () => body })
  const apiFetch = async path => {
    reads.push(path.split('?')[0])
    if (path.startsWith('/api/tasks/providers')) return json({ providers: [] })
    if (path.startsWith('/api/assistant/jobs')) return json({ jobs: [] })
    return json({ items: [], hasMore: false })
  }
  const requestConsole = async payload => { reads.push(payload.type); return { memory: [], persistent: [] } }
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const tag = name => name
  const mocks = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: () => 'icon' }), 'react-router-dom': { useSearchParams: () => [new URLSearchParams(), () => {}] },
    '@zhin.js/console-ui': new Proxy({}, { get: (_, name) => tag(String(name)) }),
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope-a' }, '../utils/inbox-cache': { isInboxCacheScopeActive: scope => scope === 'scope-a' },
    './task-center': { default: 'task-center' }, './cron': { default: 'cron' }, './assistant-jobs': { default: 'assistant-jobs' },
    './ScheduleExecutions': { ScheduleExecutions: 'schedule-executions' }, './TaskOverview': { TaskOverview: 'task-overview' },
    '../components/StatusState': { StatusState: 'status-state' },
    './task-hub-model.mjs': hubModel, './task-hub-summary-model.mjs': summaryModel, './task-center-model.mjs': providersModel,
    './assistant-jobs-model.mjs': assistantModel, './schedule-executions-model.mjs': executionsModel,
    '../utils/auth': { apiFetch }, '../utils/console-rpc': { requestConsole },
    '../contracts/zhin-console': { CONSOLE_REST: { TASK_PROVIDERS: '/api/tasks/providers' }, CONSOLE_RPC: { SCHEDULE_LIST: 'schedule:list' } },
  }
  const require = createRequire(url)
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  const elements = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)]
  // Renders the page and the overview panel it shows (a function component), then runs effects.
  const render = () => {
    cursor = 0
    const page = module.exports.default()
    const panelElement = elements(page).find(node => typeof node.type === 'function')
    const panel = panelElement.type(panelElement.props)
    const run = effects; effects = []; run.forEach(fn => fn())
    return elements(panel)
  }
  return { reads, render }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('总览 reads each task source once: the cards are built from what the task table read', async () => {
  const page = mount()
  let tree = page.render(); await settle()
  // The table (mocked here) is the only reader of providers / schedule:list / assistant jobs.
  assert.deepEqual(page.reads.filter(path => path !== '/api/assistant/executions').sort(), [], 'the cards read none of the table\'s sources again')
  const overview = tree.find(node => node.type === 'task-overview')
  assert.equal(typeof overview.props.onSources, 'function', 'the table hands its sources to the cards')
  // What the table read fills the cards.
  overview.props.onSources({ admin: { providers: [{ owner: 'root', title: 'x', tasks: [{ id: 't', enabled: false }] }] }, schedules: { memory: [{ running: true }], persistent: [{ id: 'r1', enabled: false }] }, assistant: { jobs: [] } })
  tree = page.render(); await settle()
  const cards = tree.filter(node => node.type === 'StatCard')
  assert.deepEqual(cards.slice(0, 3).map(card => card.props.value), [1, 2, 0])
  assert.deepEqual(page.reads.filter(path => path !== '/api/assistant/executions'), [], 'still no second read')
})

test('the cards from the table sources: a null source stays unknown, reminders are counted once', async () => {
  const { summarizeOverviewSources } = summaryModel
  assert.deepEqual(summarizeOverviewSources(null), { admin: null, schedule: null, assistant: null })
  const summary = summarizeOverviewSources({
    admin: null,
    schedules: { memory: [], persistent: [{ id: 'r1', enabled: true }] },
    assistant: { jobs: [{ id: 'r1', enabled: true }, { id: 'j2', enabled: true }] },
  })
  assert.equal(summary.admin, null, 'a failed read is 「—」, not 0')
  assert.equal(summary.schedule.total, 1)
  assert.equal(summary.assistant.total, 1, 'the reminder is counted on 定时提醒 only')
})
