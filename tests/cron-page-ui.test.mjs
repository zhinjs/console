import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import { describeCron, relativeUntil } from '../console-ui/src/pages/cron-schedule.mjs'
import { validateAssistantJobs, explainJobError } from '../console-ui/src/pages/assistant-jobs-model.mjs'
import * as applyOutcome from '../console-ui/src/components/apply-outcome-model.mjs'
import { taskTabHref } from '../console-ui/src/pages/task-hub-model.mjs'
import * as scheduleMemory from '../console-ui/src/pages/schedule-memory-model.mjs'
import * as scheduleTarget from '../console-ui/src/pages/schedule-target-model.mjs'
import * as scheduleAgent from '../console-ui/src/pages/schedule-agent-model.mjs'
import * as featureDisabled from '../console-ui/src/utils/feature-disabled.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'

const require = createRequire(import.meta.url)
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
const source = await readFile(new URL('../console-ui/src/pages/cron.tsx', import.meta.url), 'utf8')
function compile(source, mocks, extras = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions }).outputText
  new Function('require', 'exports', 'module', ...Object.keys(extras), code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module, ...Object.values(extras))
  return module.exports
}
// The real dropdown from the published @zhin.js/console-ui; the page's other components stay mocked.
const select = Object.fromEntries(Object.entries(await import('@zhin.js/console-ui')).filter(([name]) => name.startsWith('Select')))
const persistent = [
  { type: 'persistent', id: 'task:daily', label: '早间摘要', prompt: '整理今天的重要消息', cronExpression: '0 0 9 * * *', enabled: true, createdAt: 12345, nextExecution: Date.now() + 3600000, lastStatus: 'error' },
  { type: 'persistent', id: 'task:paused', prompt: '检查家里温度', cronExpression: '0 */10 * * * *', enabled: false },
  { type: 'persistent', id: 'task:unknown', label: '待确认结果', prompt: '检查服务', cronExpression: '0 0 9 1 * *', enabled: true },
]
const memory = [{ type: 'memory', id: 'plugin-cron', plugin: 'root/reminder', description: '检查新提醒', expression: '0 */5 * * * *', running: true }]
function fixture({ readOnly = false, available = true, jobs = [], deferJobs = false, autoLoad = true } = {}) {
  let connection = { host: 'https://host-a', credential: 'credential-a' }, scopeCounter = 0, slots = [], mountedKey
  const authority = createInboxCacheAuthority(() => connection, () => `scope-${++scopeCounter}`)
  const calls = [], httpCalls = [], effects = [], timers = [], errors = [], saves = []; let cursor = 0, dirty = false
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) { const index = cursor++, owned = slots; if (!(index in owned)) owned[index] = typeof initial === 'function' ? initial() : initial; return [owned[index], value => { owned[index] = typeof value === 'function' ? value(owned[index]) : value; if (slots === owned) dirty = true }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useCallback(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn },
    useEffect(effect, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect() }) } },
  }
  const module = compile(source + '\nexport { PersistentRunStatus, CronPageSession };', {
    react: hooks, 'react-router-dom': { Link: 'a' }, 'lucide-react': new Proxy({}, { get: () => 'i' }),
    '@zhin.js/console-ui': { Button: 'button', Card: 'article', CardContent: 'section', Badge: 'span', Alert: 'aside', AlertDescription: 'p', Skeleton: 'div', Input: 'input', Textarea: 'textarea', Separator: 'hr', ...(select), Dialog: 'dialog', DialogContent: 'section', DialogHeader: 'header', DialogFooter: 'footer', DialogTitle: 'h2', DialogDescription: 'p', DialogClose: 'close', PageHeader: 'page-header', Tabs: 'tabs', TabsList: 'tab-list', TabsTrigger: 'tab-trigger', TabsContent: 'tab-panel' }, '../components/StatusState': { StatusState: 'status-state' },
    '../components/ApplyFeedback': { useSaveOutcome: () => ({ value: null, clear() {}, element: null, report: async (subject, outcome, check) => { saves.push({ subject, outcome, check }) } }) },
    '../components/apply-outcome-model.mjs': applyOutcome, '../components/toast': { useToast: () => ({ error: message => errors.push(message) }) }, '../contracts/zhin-console': { CONSOLE_RPC: { SCHEDULE_LIST: 'schedule:list', CRON_VALIDATE: 'cron:validate', CRON_ADD: 'cron:add', CRON_REMOVE: 'cron:remove', CRON_PAUSE: 'cron:pause', CRON_RESUME: 'cron:resume', CRON_SET_AGENT: 'cron:set-agent' } },
    '../utils/console-rpc': { requestConsole: input => new Promise((resolve, reject) => calls.push({ input, resolve, reject, answered: false, scope: authority.current() })) },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() }, '../utils/inbox-cache': { isInboxCacheScopeActive: scope => authority.active(scope) },
    '../utils/console-access.mjs': { hasConsolePermission: () => !readOnly }, './cron-schedule.mjs': { describeCron, relativeUntil },
    './assistant-jobs-model.mjs': { validateAssistantJobs, explainJobError }, './task-hub-model.mjs': { taskTabHref }, './schedule-memory-model.mjs': scheduleMemory, './schedule-target-model.mjs': scheduleTarget, './schedule-agent-model.mjs': scheduleAgent, '../utils/feature-disabled.mjs': featureDisabled,
    './ScheduleExecutions': { ScheduleExecutions: 'schedule-executions' },
    '../components/log-panel/LogPanel': { useLogPanel: () => ({ available: false, open() {} }) },
    '../utils/auth': { apiFetch: (url, options) => new Promise((resolve, reject) => { httpCalls.push({ url, options, resolve, reject, scope: authority.current() }); if (!deferJobs) resolve({ ok: true, json: async () => ({ success: true, data: { jobs, eventsActive: false } }) }) }) }, './cron.css': {},
  }, { window: { setInterval: () => 1, clearInterval: () => {} }, setTimeout: callback => { timers.push(callback); return timers.length }, clearTimeout: () => {} })
  let tree
  const f = { calls, httpCalls, module, timers, errors, authority, saves,
    render() { let count = 0; do {
      assert.ok(++count < 20); dirty = false; cursor = 0
      const root = module.default()
      if (root?.type === module.CronPageSession) {
        if (mountedKey !== root.key) { slots.forEach(slot => slot?.cleanup?.()); slots = []; effects.splice(0); mountedKey = root.key }
        tree = root.type(root.props)
      } else { if (mountedKey !== undefined) { slots.forEach(slot => slot?.cleanup?.()); slots = []; effects.splice(0); mountedKey = undefined } tree = root }
      effects.splice(0).forEach(effect => effect())
    } while (dirty); return tree },
    async settle() { for (let count = 0; count < 12; count++) { await Promise.resolve(); if (dirty || effects.length) f.render() } return tree },
    answer(type, data, scope = authority.current()) { const call = calls.find(call => !call.answered && call.input.type === type && call.scope === scope); assert.ok(call, type); call.answered = true; call.resolve(data); return call },
    switchHost() { connection = { host: 'https://host-b', credential: 'credential-b' } },
    switchCredential() { connection = { ...connection, credential: 'credential-b' } },
    logout() { connection = undefined },
    close() { slots.forEach(slot => slot?.cleanup?.()) },
    get tree() { return tree },
  }
  f.render(); if (autoLoad) f.answer('schedule:list', { persistent, memory, capabilities: { persistent: available } })
  return f
}
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children, node.props?.actions].flat(Infinity).flatMap(elements)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const named = (tree, name) => elements(tree).find(node => node.props?.['aria-label'] === name)
const button = (tree, label) => elements(tree).find(node => node.type === 'button' && text(node).trim() === label)
const row = (tree, id) => elements(tree).find(node => node.type === 'article' && node.key === id)

test('list leads with task text and human schedule; native expansion reveals identifiers without mutating the schedule', async () => {
  const f = fixture(); await f.settle()
  const daily = row(f.tree, 'task:daily'), toggle = elements(daily).find(node => node.type === 'button' && node.props['aria-controls'])
  assert.equal(toggle.props.type, 'button'); assert.equal(toggle.props['aria-expanded'], false)
  assert.ok(text(toggle).includes('整理今天的重要消息')); assert.ok(text(toggle).includes('每天 09:00'))
  assert.ok(!text(daily).includes('0 0 9 * * *')); assert.ok(!text(daily).includes('task:daily'))
  const calls = f.calls.length; toggle.props.onClick(); f.render()
  const expanded = row(f.tree, 'task:daily'), control = elements(expanded).find(node => node.props?.id === toggle.props['aria-controls'])
  assert.equal(control.props.hidden, false); assert.ok(text(control).includes('0 0 9 * * *')); assert.ok(text(control).includes('task:daily'))
  assert.equal(f.calls.length, calls)
  assert.ok(text(row(f.tree, 'task:paused')).includes('检查家里温度'))
  f.close()
})

test('cron page keeps per-task filtered history; global history and run-detail links live in the task hub', async () => {
  const f = fixture({ available: false }); await f.settle()
  assert.equal(elements(f.tree).some(node => node.type === 'tab-panel'), false, 'the merged page owns tabs; the schedule panel has none of its own')
  assert.equal(elements(f.tree).some(node => node.type === 'page-header'), false, 'the hub renders the single page header')
  const task = row(f.tree, 'task:daily')
  elements(task).find(node => node.type === 'button' && node.props['aria-controls']).props.onClick(); f.render()
  const filtered = elements(row(f.tree, 'task:daily')).find(node => node.type === 'schedule-executions')
  assert.equal(filtered.props.jobId, 'task:daily'); assert.equal(filtered.props.connectionScope, f.authority.current())
  f.close()
})

test('icon-only schedule controls are labelled and use the shared control size', async () => {
  const f = fixture({ available: true }); await f.settle()
  const task = row(f.tree, 'task:daily')
  elements(task).find(node => node.type === 'button' && node.props['aria-controls']).props.onClick(); f.render()
  const icons = elements(row(f.tree, 'task:daily')).filter(node => node.type === 'button' && node.props.size === 'icon')
  assert.ok(icons.length >= 3)
  for (const button of icons) { assert.ok(button.props['aria-label'], 'icon button needs an accessible name'); assert.doesNotMatch(button.props.className ?? '', /\bh-6\b|\bw-6\b/) }
  f.close()
})

test('search and status filters use returned enablement and execution evidence, including missing results', async () => {
  const f = fixture(); await f.settle()
  const choose = value => { const field = named(f.tree, '任务状态'); select.SelectField.render(field.props, null).props.onValueChange(JSON.stringify(value)); f.render() }
  choose('error'); assert.ok(row(f.tree, 'task:daily')); assert.equal(row(f.tree, 'task:unknown'), undefined); assert.equal(row(f.tree, 'task:paused'), undefined)
  assert.ok(!text(f.tree).includes('检查新提醒'))
  choose('paused'); assert.ok(row(f.tree, 'task:paused')); assert.equal(row(f.tree, 'task:daily'), undefined)
  choose('all'); named(f.tree, '搜索定时任务').props.onChange({ target: { value: '检查新提醒' } }); f.render()
  assert.ok(text(f.tree).includes('检查新提醒')); assert.equal(row(f.tree, 'task:daily'), undefined)
  const missing = renderToStaticMarkup(React.createElement(f.module.PersistentRunStatus, { job: persistent[2], now: Date.now() }))
  assert.match(missing, /下次执行：—/); assert.match(missing, /最近结果：—/); assert.doesNotMatch(missing, /执行成功|已跳过|已失败/)
  f.close()
})

test('pause/resume retain their exact calls and delete first opens the existing confirmation', async () => {
  const f = fixture(); await f.settle()
  const pause = elements(row(f.tree, 'task:daily')).find(node => node.type === 'button' && node.props.title === '暂停')
  pause.props.onClick(); f.render(); assert.equal(f.calls.at(-1).input.type, 'cron:pause'); assert.equal(f.calls.at(-1).input.id, 'task:daily')
  f.answer('cron:pause', {}); await f.settle(); f.answer('schedule:list', { persistent, memory, capabilities: { persistent: true } }); await f.settle()
  // The pause ends in one outcome (已生效, the engine disposes the timer on write) checked by a fresh list.
  assert.equal(f.saves.length, 1)
  assert.deepEqual([f.saves[0].outcome.kind, f.saves[0].outcome.basis], ['applied', 'scheduler'])
  const paused = f.saves[0].check(); await f.settle()
  f.answer('schedule:list', { persistent: persistent.map(job => job.id === 'task:daily' ? { ...job, enabled: false } : job), memory, capabilities: { persistent: true } })
  assert.equal(await paused, null, 'the re-read shows the task paused')
  const stillRunning = f.saves[0].check(); await f.settle()
  f.answer('schedule:list', { persistent, memory, capabilities: { persistent: true } })
  assert.deepEqual(await stillRunning, { path: 'enabled', submitted: 'false', readBack: 'true' }, 'a re-read that still runs it is a mismatch')
  const resume = elements(row(f.tree, 'task:paused')).find(node => node.type === 'button' && node.props.title === '恢复')
  resume.props.onClick(); f.render(); assert.equal(f.calls.at(-1).input.type, 'cron:resume'); assert.equal(f.calls.at(-1).input.id, 'task:paused')
  f.answer('cron:resume', {}); await f.settle(); f.answer('schedule:list', { persistent, memory, capabilities: { persistent: true } }); await f.settle()
  const remove = elements(row(f.tree, 'task:daily')).find(node => node.type === 'button' && node.props.title === '删除'), count = f.calls.length
  remove.props.onClick(); f.render(); assert.equal(f.calls.length, count)
  const confirmation = elements(f.tree).find(node => node.type === 'dialog' && node.props.open && text(node).includes('确认删除'))
  assert.ok(confirmation); button(confirmation, '删除').props.onClick(); f.render()
  assert.deepEqual(f.calls.at(-1).input, { type: 'cron:remove', id: 'task:daily' })
  f.close()
})

test('read-only and unsupported persistent scheduling expose no creation or mutation controls', async () => {
  for (const options of [{ readOnly: true }, { available: false }]) {
    const f = fixture(options); await f.settle()
    assert.equal(button(f.tree, '新建任务'), undefined)
    assert.equal(elements(row(f.tree, 'task:daily')).filter(node => node.type === 'button' && ['暂停', '恢复', '删除'].includes(node.props.title)).length, 0)
    assert.ok(text(f.tree).includes('检查新提醒'))
    f.close()
  }
})

test('creating a task still validates the expression and submits only the original explicit confirmation payload', async () => {
  const f = fixture(); await f.settle()
  button(f.tree, '新建任务').props.onClick(); f.render()
  const dialog = () => elements(f.tree).find(node => node.type === 'dialog' && node.props.open && text(node).includes('新建定时任务'))
  const expression = elements(dialog()).find(node => node.type === 'input' && node.props.placeholder.includes('秒 分 时 日 月 周'))
  expression.props.onChange({ target: { value: ' 0 0 9 * * * ' } }); f.render()
  const prompt = elements(dialog()).find(node => node.type === 'textarea')
  prompt.props.onChange({ target: { value: ' 整理今天的重要消息 ' } }); f.render()
  assert.equal(button(dialog(), '创建').props.disabled, true)
  f.timers.at(-1)(); assert.deepEqual(f.calls.at(-1).input, { type: 'cron:validate', cronExpression: '0 0 9 * * *' })
  f.answer('cron:validate', { valid: true }); await f.settle()
  assert.equal(f.calls.filter(call => call.input.type === 'cron:add').length, 0)
  assert.equal(button(dialog(), '创建').props.disabled, false)
  button(dialog(), '创建').props.onClick(); f.render()
  assert.deepEqual(f.calls.at(-1).input, { type: 'cron:add', cronExpression: '0 0 9 * * *', prompt: '整理今天的重要消息', label: '' })
  f.close()
})

for (const change of ['switchHost', 'switchCredential']) {
  test(`actual page masks old task rows, cancels assistant reads and rejects late schedule results after ${change}`, async () => {
    for (const loaded of [false, true]) {
      const f = fixture({ autoLoad: false, deferJobs: true }), scopeA = f.authority.current()
      const original = f.calls[0]
      if (loaded) { f.answer('schedule:list', { persistent, memory, capabilities: { persistent: true } }); await f.settle(); assert.ok(row(f.tree, 'task:daily')) }
      f[change](); f.render()
      assert.equal(row(f.tree, 'task:daily'), undefined)
      if (loaded) assert.equal(f.httpCalls[0].options.signal.aborted, true)
      const taskB = { ...persistent[0], id: 'task:b', label: 'B 的任务' }
      f.answer('schedule:list', { persistent: [taskB], memory: [], capabilities: { persistent: true } }); await f.settle()
      if (loaded) f.httpCalls[0].resolve({ ok: true, json: async () => ({ success: true, data: { jobs: [{ id: 'task:b', enabled: true, state: { lastStatus: 'ok' } }], eventsActive: false } }) })
      else original.resolve({ persistent, memory, capabilities: { persistent: true } })
      await f.settle(); assert.ok(row(f.tree, 'task:b')); assert.equal(row(f.tree, 'task:daily'), undefined)
      const status = elements(row(f.tree, 'task:b')).find(node => node.type === f.module.PersistentRunStatus)
      assert.equal(status.props.state, undefined)
      assert.equal(f.calls.filter(call => call.scope === scopeA && call.input.type === 'schedule:list').length, 1)
      f.close()
    }
  })

  test(`actual old errors and all captured write callbacks retire on ${change}`, async () => {
    const failure = fixture({ autoLoad: false }); failure.calls[0].reject(new Error('private A failure')); await failure.settle()
    assert.ok(text(failure.tree).includes('private A failure')); failure[change](); failure.render(); assert.ok(!text(failure.tree).includes('private A failure')); failure.close()
    for (const action of ['pause', 'resume', 'delete', 'create']) {
      const f = fixture(); await f.settle()
      let handler
      if (action === 'create') {
        button(f.tree, '新建任务').props.onClick(); f.render()
        const dialog = elements(f.tree).find(node => node.type === 'dialog' && node.props.open && text(node).includes('新建定时任务'))
        elements(dialog).find(node => node.type === 'input' && node.props.placeholder.includes('秒 分 时 日 月 周')).props.onChange({ target: { value: '0 0 9 * * *' } })
        elements(dialog).find(node => node.type === 'textarea').props.onChange({ target: { value: 'A 私人任务内容' } }); f.render()
        f.timers.at(-1)(); f.answer('cron:validate', { valid: true }); await f.settle()
        handler = button(f.tree, '创建').props.onClick
      } else {
        const item = row(f.tree, action === 'resume' ? 'task:paused' : 'task:daily')
        const control = elements(item).find(node => node.type === 'button' && node.props.title === ({ pause: '暂停', resume: '恢复', delete: '删除' })[action])
        if (action === 'delete') { control.props.onClick(); f.render(); handler = button(f.tree, '删除').props.onClick }
        else handler = control.props.onClick
      }
      const count = f.calls.length
      f[change](); handler(); await f.settle()
      assert.equal(f.calls.length, count, `${action} cannot validate or write through a retired scope`)
      f.render(); assert.equal(f.calls.length, count + 1, 'new scope starts its own single schedule read')
      assert.equal(row(f.tree, 'task:daily'), undefined); f.close()
    }
  })

  test(`a submitted write settling after ${change} cannot refresh the new Host or publish a toast`, async () => {
    for (const reject of [false, true]) {
      const f = fixture(); await f.settle()
      elements(row(f.tree, 'task:daily')).find(node => node.type === 'button' && node.props.title === '暂停').props.onClick()
      const write = f.calls.at(-1); assert.equal(write.input.type, 'cron:pause')
      f[change](); f.render(); const count = f.calls.length
      reject ? write.reject(new Error('old private write failure')) : write.resolve({})
      await f.settle(); assert.equal(f.calls.length, count); assert.deepEqual(f.errors, [])
      assert.ok(!text(f.tree).includes('old private write failure')); f.close()
    }
  })
}

test('same-scope refresh sequence rejects both older task rows and older assistant status results', async () => {
  const f = fixture({ deferJobs: true }); await f.settle()
  const firstAssistant = f.httpCalls[0]
  const refresh = button(f.tree, '刷新').props.onClick
  refresh(); refresh(); const earlier = f.calls.at(-2), newer = f.calls.at(-1)
  assert.equal(firstAssistant.options.signal.aborted, true)
  const current = { ...persistent[0], label: '当前最新任务' }
  newer.resolve({ persistent: [current], memory: [], capabilities: { persistent: true } }); await f.settle()
  f.httpCalls.at(-1).resolve({ ok: true, json: async () => ({ success: true, data: { jobs: [{ id: current.id, enabled: true, state: { lastStatus: 'error' } }], eventsActive: false } }) }); await f.settle()
  earlier.resolve({ persistent: [{ ...persistent[0], label: '旧刷新内容' }], memory, capabilities: { persistent: true } })
  firstAssistant.resolve({ ok: true, json: async () => ({ success: true, data: { jobs: [{ id: current.id, enabled: true, state: { lastStatus: 'ok' } }], eventsActive: false } }) }); await f.settle()
  assert.ok(text(f.tree).includes('当前最新任务')); assert.ok(!text(f.tree).includes('旧刷新内容'))
  assert.equal(elements(row(f.tree, current.id)).find(node => node.type === f.module.PersistentRunStatus).props.state.lastStatus, 'error')
  f.close()
})

test('new schedule facts immediately replace the previous assistant snapshot while current enrichment is pending or fails', async () => {
  const f = fixture({ deferJobs: true }); await f.settle()
  const now = Date.now(), oldNext = now + 100000, newNext = now + 200000
  f.httpCalls[0].resolve({ ok: true, json: async () => ({ success: true, data: { jobs: [{ id: persistent[0].id, enabled: true, state: { lastStatus: 'ok', nextRunAtMs: oldNext } }], eventsActive: false } }) }); await f.settle()
  const status = () => elements(row(f.tree, persistent[0].id)).find(node => node.type === f.module.PersistentRunStatus)
  assert.equal(status().props.state.lastStatus, 'ok')
  assert.match(renderToStaticMarkup(React.createElement(f.module.PersistentRunStatus, status().props)), /上次执行成功/)
  button(f.tree, '刷新').props.onClick()
  f.answer('schedule:list', { persistent: [{ ...persistent[0], lastStatus: 'error', nextExecution: newNext }], memory: [], capabilities: { persistent: true } }); await f.settle()
  const assertCurrentSchedule = () => {
    assert.equal(status().props.state, undefined)
    const html = renderToStaticMarkup(React.createElement(f.module.PersistentRunStatus, status().props))
    assert.match(html, /上次执行失败/); assert.doesNotMatch(html, /上次执行成功/)
    assert.ok(html.includes(relativeUntil(newNext, status().props.now)))
    assert.ok(!html.includes(relativeUntil(oldNext, status().props.now)))
  }
  assertCurrentSchedule()
  f.httpCalls.at(-1).reject(new Error('current enrichment unavailable')); await f.settle()
  assertCurrentSchedule(); f.close()
})

// #1250 b52 `schedule-agent-no-creation-path`: which Agent runs a persistent task.
const agentRows = [
  { ...persistent[0], agent: 'researcher' },
  { ...persistent[1], agent: 'gone', agentMissing: true },
  { type: 'persistent', id: 'profile:morning', label: 'Profile 早报', prompt: '早报', cronExpression: '0 0 8 * * *', enabled: true, source: 'profile' },
  { type: 'persistent', id: 'assistant-profile-heartbeat', label: 'Profile heartbeat', prompt: '巡检', cronExpression: '', enabled: true, source: 'profile' },
  { type: 'persistent', id: 'task:plain', label: '普通任务', prompt: '普通', cronExpression: '0 0 10 * * *', enabled: true },
]
async function agentFixture({ agents = ['zhin', 'researcher', 'writer'], rows = agentRows, readOnly = false } = {}) {
  const f = fixture({ autoLoad: false, readOnly })
  f.answer('schedule:list', { persistent: rows, memory, capabilities: { persistent: true }, ...(agents ? { agents } : {}) }); await f.settle()
  return f
}
const expand = (f, id) => { elements(row(f.tree, id)).find(node => node.type === 'button' && node.props['aria-controls']).props.onClick(); f.render() }
const runStatus = (f, id) => { const node = elements(row(f.tree, id)).find(node => node.type === f.module.PersistentRunStatus); return { node, html: renderToStaticMarkup(React.createElement(f.module.PersistentRunStatus, node.props)) } }
const agentDialog = f => elements(f.tree).find(node => node.type === 'dialog' && node.props.open && text(node).includes('选择由哪个 Agent 执行任务'))
const chooseIn = (scope, label, value, f) => { const field = elements(scope).find(node => node.props?.['aria-labelledby'] && node.props.options && text(elements(scope).find(item => item.props?.id === node.props['aria-labelledby'])) === label); select.SelectField.render(field.props, null).props.onValueChange(JSON.stringify(value)); f.render(); return field }
const refused = (code, message) => Object.assign(new Error(message), { details: { dataCode: code } })

test('task rows say which Agent runs them; a deleted Agent is flagged with a way to change it', async () => {
  const f = await agentFixture()
  assert.match(runStatus(f, 'task:daily').html, /Agent：researcher/)
  assert.match(runStatus(f, 'task:plain').html, /Agent：zhin（默认）/)
  const missing = runStatus(f, 'task:paused')
  assert.match(missing.html, /⚠ Agent 不存在/); assert.match(missing.html, /「gone」已从配置中删除，任务运行会失败。/)
  assert.equal(typeof missing.node.props.onChangeAgent, 'function', 'the warning leads to 修改 Agent')
  missing.node.props.onChangeAgent(); f.render()
  assert.ok(agentDialog(f)); assert.ok(text(agentDialog(f)).includes('当前的 Agent「gone」已从配置中删除'))
  const field = elements(agentDialog(f)).find(node => node.props?.options && node.props['aria-labelledby'] === 'cron-set-agent-label')
  assert.deepEqual(field.props.options.map(option => [option.value, option.label, !!option.disabled]),
    [['', 'zhin（默认）', false], ['researcher', 'researcher', false], ['writer', 'writer', false], ['gone', 'gone（不存在）', true]])
  assert.equal(button(agentDialog(f), '保存').props.disabled, true, 'saving the missing Agent again is not offered')
  expand(f, 'task:daily')
  assert.ok(text(row(f.tree, 'task:daily')).includes('执行的 Agent'))
  f.close()
})

test('Profile routines and heartbeat tasks explain why their Agent cannot be changed here', async () => {
  const f = await agentFixture()
  for (const [id, reason] of [['profile:morning', 'assistant.profile.yml'], ['assistant-profile-heartbeat', '心跳任务固定由默认 Agent 执行']]) {
    expand(f, id)
    const change = button(row(f.tree, id), '修改 Agent')
    assert.equal(change.props.disabled, true)
    const note = elements(row(f.tree, id)).find(node => node.props?.id === change.props['aria-describedby'])
    assert.ok(text(note).includes(reason), id)
    assert.equal(runStatus(f, id).node.props.onChangeAgent, undefined)
  }
  expand(f, 'task:plain'); assert.equal(button(row(f.tree, 'task:plain'), '修改 Agent').props.disabled, false)
  f.close()
})

test('修改 Agent calls cron:set-agent with the chosen Agent, and 恢复默认 clears it with null', async () => {
  const f = await agentFixture()
  expand(f, 'task:plain'); button(row(f.tree, 'task:plain'), '修改 Agent').props.onClick(); f.render()
  assert.equal(button(agentDialog(f), '恢复默认'), undefined, 'a task on the default Agent has nothing to restore')
  chooseIn(agentDialog(f), '执行的 Agent', 'writer', f)
  button(agentDialog(f), '保存').props.onClick(); f.render()
  assert.deepEqual(f.calls.at(-1).input, { type: 'cron:set-agent', id: 'task:plain', agent: 'writer' })
  f.answer('cron:set-agent', { success: true }); await f.settle()
  assert.equal(agentDialog(f), undefined)
  assert.equal(f.saves.at(-1).subject, '定时任务 普通任务 改由 Agent writer 执行')
  f.answer('schedule:list', { persistent: agentRows, memory, capabilities: { persistent: true }, agents: ['zhin', 'researcher', 'writer'] }); await f.settle()
  const check = f.saves.at(-1).check(); await f.settle()
  f.answer('schedule:list', { persistent: agentRows.map(job => job.id === 'task:plain' ? { ...job, agent: 'writer' } : job), memory, capabilities: { persistent: true }, agents: ['zhin', 'researcher', 'writer'] })
  assert.equal(await check, null, 'the re-read shows the new Agent')
  expand(f, 'task:daily'); button(row(f.tree, 'task:daily'), '修改 Agent').props.onClick(); f.render()
  button(agentDialog(f), '恢复默认').props.onClick(); f.render()
  assert.deepEqual(f.calls.at(-1).input, { type: 'cron:set-agent', id: 'task:daily', agent: null })
  f.answer('cron:set-agent', { success: true }); await f.settle()
  assert.equal(f.saves.at(-1).subject, '定时任务 早间摘要 已恢复由默认 Agent 执行')
  f.close()
})

test('refused Agent changes are explained in the dialog by their code', async () => {
  const cases = [
    [refused('schedule_target_forbidden', '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate'), '没有向投递账号发送消息的权限：需要 icqq / bot-1 上的 endpoint.operate。'],
    [refused('schedule_agent_profile', '请在 Profile 文件中该 routine 的 agent 字段修改'), 'assistant.profile.yml'],
    [refused('schedule_agent_heartbeat', '心跳任务不能指定 Agent: x'), '心跳任务固定由默认 Agent 执行'],
    [new Error('Agent 不存在：writer。可用的 Agent：zhin、researcher'), 'Agent「writer」不存在。可用的 Agent：zhin、researcher，请从中改选。'],
    [new Error('其它错误'), '其它错误'],
  ]
  for (const [error, expected] of cases) {
    const f = await agentFixture()
    expand(f, 'task:plain'); button(row(f.tree, 'task:plain'), '修改 Agent').props.onClick(); f.render()
    chooseIn(agentDialog(f), '执行的 Agent', 'writer', f)
    button(agentDialog(f), '保存').props.onClick(); f.render()
    const call = f.calls.at(-1); call.answered = true; call.reject(error); await f.settle()
    const alert = elements(agentDialog(f)).find(node => node.props?.role === 'alert')
    assert.ok(text(alert).includes(expected), `${expected} in ${text(alert)}`)
    assert.deepEqual(f.errors, [])
    f.close()
  }
})

test('the creation form offers the Host Agents, sends the choice, and shows a delivery refusal in place', async () => {
  const f = await agentFixture()
  button(f.tree, '新建任务').props.onClick(); f.render()
  const dialog = () => elements(f.tree).find(node => node.type === 'dialog' && node.props.open && text(node).includes('新建定时任务'))
  const field = elements(dialog()).find(node => node.props?.['aria-labelledby'] === 'cron-new-agent-label')
  assert.equal(field.props.value, ''); assert.equal(field.props.options[0].label, 'zhin（默认）')
  assert.equal(field.props.options.some(option => option.value === 'zhin'), false, 'the default is offered once')
  elements(dialog()).find(node => node.type === 'input' && node.props.placeholder.includes('秒 分 时 日 月 周')).props.onChange({ target: { value: '0 0 9 * * *' } }); f.render()
  elements(dialog()).find(node => node.type === 'textarea').props.onChange({ target: { value: '写周报' } }); f.render()
  chooseIn(dialog(), '执行的 Agent', 'researcher', f)
  f.timers.at(-1)(); f.answer('cron:validate', { valid: true }); await f.settle()
  button(dialog(), '创建').props.onClick(); f.render()
  assert.deepEqual(f.calls.at(-1).input, { type: 'cron:add', cronExpression: '0 0 9 * * *', prompt: '写周报', label: '', agent: 'researcher' })
  const call = f.calls.at(-1); call.answered = true
  call.reject(refused('schedule_target_forbidden', '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate')); await f.settle()
  assert.ok(dialog(), 'the draft stays open')
  assert.ok(text(elements(dialog()).find(node => node.props?.role === 'alert')).includes('需要 icqq / bot-1 上的 endpoint.operate'))
  assert.deepEqual(f.errors, [])
  f.close()
})

// #1250 b61: `schedule_agent_not_found` carries `data.available` (b55); the forms offer exactly those.
const agentNotFound = (agent, available) => Object.assign(new Error(`Agent 不存在：${agent}。可用的 Agent：${available.join('、')}`),
  { details: { dataCode: 'schedule_agent_not_found', dataAgent: agent, dataAvailable: available } })

test('a refused creation Agent names the available ones, narrows the dropdown to them and keeps the refused choice unselectable', async () => {
  const f = await agentFixture()
  button(f.tree, '新建任务').props.onClick(); f.render()
  const dialog = () => elements(f.tree).find(node => node.type === 'dialog' && node.props.open && text(node).includes('新建定时任务'))
  const field = () => elements(dialog()).find(node => node.props?.['aria-labelledby'] === 'cron-new-agent-label')
  elements(dialog()).find(node => node.type === 'input' && node.props.placeholder.includes('秒 分 时 日 月 周')).props.onChange({ target: { value: '0 0 9 * * *' } }); f.render()
  elements(dialog()).find(node => node.type === 'textarea').props.onChange({ target: { value: '写周报' } }); f.render()
  chooseIn(dialog(), '执行的 Agent', 'writer', f)
  f.timers.at(-1)(); f.answer('cron:validate', { valid: true }); await f.settle()
  button(dialog(), '创建').props.onClick(); f.render()
  const call = f.calls.at(-1); call.answered = true
  call.reject(agentNotFound('writer', ['zhin', 'researcher'])); await f.settle()
  const alert = elements(dialog()).find(node => node.props?.role === 'alert')
  assert.ok(text(alert).includes('Agent「writer」不存在。可用的 Agent：zhin、researcher，请从中改选。'), text(alert))
  assert.doesNotMatch(text(alert), /schedule_agent_not_found/)
  assert.deepEqual(field().props.options, [
    { value: '', label: 'zhin（默认）' }, { value: 'researcher', label: 'researcher' },
    { value: 'writer', label: 'writer（不存在）', disabled: true },
  ])
  assert.equal(button(dialog(), '创建').props.disabled, true, 'the refused Agent cannot be sent again')
  assert.equal(button(dialog(), '创建').props['aria-describedby'], 'cron-new-agent-missing')
  assert.ok(text(elements(dialog()).find(node => node.props?.id === 'cron-new-agent-missing')).includes('所选 Agent「writer」不存在'))
  chooseIn(dialog(), '执行的 Agent', 'researcher', f)
  assert.equal(elements(dialog()).find(node => node.props?.id === 'cron-new-agent-missing'), undefined)
  assert.equal(button(dialog(), '创建').props['aria-describedby'], undefined)
  assert.equal(elements(dialog()).find(node => node.props?.role === 'alert'), undefined)
  assert.equal(button(dialog(), '创建').props.disabled, false)
  assert.deepEqual(f.errors, [])
  f.close()
})

test('closing the creation dialog drops a refused Agent from the draft; reopening starts on the default (#1250 b61)', async () => {
  const f = await agentFixture()
  const dialog = () => elements(f.tree).find(node => node.type === 'dialog' && text(node).includes('新建定时任务'))
  const field = () => elements(dialog()).find(node => node.props?.['aria-labelledby'] === 'cron-new-agent-label')
  button(f.tree, '新建任务').props.onClick(); f.render()
  elements(dialog()).find(node => node.type === 'input' && node.props.placeholder.includes('秒 分 时 日 月 周')).props.onChange({ target: { value: '0 0 9 * * *' } }); f.render()
  elements(dialog()).find(node => node.type === 'textarea').props.onChange({ target: { value: '写周报' } }); f.render()
  chooseIn(dialog(), '执行的 Agent', 'writer', f)
  f.timers.at(-1)(); f.answer('cron:validate', { valid: true }); await f.settle()
  button(dialog(), '创建').props.onClick(); f.render()
  const call = f.calls.at(-1); call.answered = true
  call.reject(agentNotFound('writer', ['zhin', 'researcher'])); await f.settle()
  assert.equal(field().props.value, 'writer')
  dialog().props.onOpenChange(false); f.render()
  assert.equal(dialog().props.open, false)
  button(f.tree, '新建任务').props.onClick(); f.render()
  assert.equal(dialog().props.open, true)
  assert.equal(field().props.value, '', 'back to the default Agent')
  assert.deepEqual(field().props.options.map(option => option.value), ['', 'researcher'], 'the refused Agent is no longer offered')
  assert.equal(elements(dialog()).find(node => node.props?.role === 'alert'), undefined)
  assert.equal(elements(dialog()).find(node => node.props?.id === 'cron-new-agent-missing'), undefined)
  assert.equal(button(dialog(), '创建').props['aria-describedby'], undefined)
  assert.equal(elements(dialog()).find(node => node.type === 'textarea').props.value, '写周报', 'the rest of the draft is kept')
  // An Agent the Host runs survives closing.
  chooseIn(dialog(), '执行的 Agent', 'researcher', f)
  dialog().props.onOpenChange(false); f.render()
  button(f.tree, '新建任务').props.onClick(); f.render()
  assert.equal(field().props.value, 'researcher')
  f.close()
})

test('a later list refresh replaces the Agents narrowed by a refusal (#1250 b61)', async () => {
  const f = await agentFixture()
  expand(f, 'task:plain'); button(row(f.tree, 'task:plain'), '修改 Agent').props.onClick(); f.render()
  chooseIn(agentDialog(f), '执行的 Agent', 'writer', f)
  button(agentDialog(f), '保存').props.onClick(); f.render()
  const call = f.calls.at(-1); call.answered = true
  call.reject(agentNotFound('writer', ['zhin'])); await f.settle()
  const field = () => elements(agentDialog(f)).find(node => node.props?.['aria-labelledby'] === 'cron-set-agent-label')
  assert.equal(button(agentDialog(f), '保存').props['aria-describedby'], 'cron-set-agent-missing')
  assert.ok(text(elements(agentDialog(f)).find(node => node.props?.id === 'cron-set-agent-missing')).includes('所选 Agent「writer」不存在'))
  button(f.tree, '刷新').props.onClick(); f.render()
  f.answer('schedule:list', { persistent: agentRows, memory, capabilities: { persistent: true }, agents: ['zhin', 'researcher', 'writer'] }); await f.settle()
  assert.deepEqual(field().props.options, [
    { value: '', label: 'zhin（默认）' }, { value: 'researcher', label: 'researcher' }, { value: 'writer', label: 'writer' },
  ])
  assert.equal(button(agentDialog(f), '保存').props.disabled, false)
  assert.equal(button(agentDialog(f), '保存').props['aria-describedby'], undefined)
  f.close()
})

test('a refused Agent change offers the available Agents; with none it points to the configuration', async () => {
  const f = await agentFixture()
  expand(f, 'task:plain'); button(row(f.tree, 'task:plain'), '修改 Agent').props.onClick(); f.render()
  chooseIn(agentDialog(f), '执行的 Agent', 'writer', f)
  button(agentDialog(f), '保存').props.onClick(); f.render()
  let call = f.calls.at(-1); call.answered = true
  call.reject(agentNotFound('writer', ['zhin'])); await f.settle()
  const field = () => elements(agentDialog(f)).find(node => node.props?.['aria-labelledby'] === 'cron-set-agent-label')
  assert.deepEqual(field().props.options.map(option => option.value), ['', 'writer'])
  assert.equal(field().props.options[1].disabled, true)
  assert.equal(button(agentDialog(f), '保存').props.disabled, true)
  assert.ok(text(elements(agentDialog(f)).find(node => node.props?.role === 'alert')).includes('可用的 Agent：zhin，请从中改选。'))
  f.close()

  const g = await agentFixture()
  expand(g, 'task:plain'); button(row(g.tree, 'task:plain'), '修改 Agent').props.onClick(); g.render()
  chooseIn(agentDialog(g), '执行的 Agent', 'writer', g)
  button(agentDialog(g), '保存').props.onClick(); g.render()
  call = g.calls.at(-1); call.answered = true
  call.reject(agentNotFound('writer', [])); await g.settle()
  // Defensive: the Host lists the default Agent among the available ones, so an empty list rarely arrives.
  assert.ok(text(elements(agentDialog(g)).find(node => node.props?.role === 'alert')).includes('Agent「writer」不存在。当前没有其他可用的 Agent，可选择默认 Agent，或先在配置中添加 Agent。'))
  g.close()
})

test('resuming a task whose delivery target the caller may not send to explains why, without the raw code', async () => {
  const cases = [
    [refused('schedule_target_forbidden', '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate'), '你没有权限向这个任务的投递目标（icqq / bot-1）发消息，无法恢复。请让管理员授予你该账号的 endpoint.operate 权限。'],
    [refused('schedule_target_forbidden', '投递目标需要指明账号（scene.platform 与 scene.endpointKey）'), '你没有权限向这个任务的投递目标发消息，无法恢复。请让管理员授予你投递账号的 endpoint.operate 权限。'],
    // The HTTP route's 403 (`code` on the body, kept as `serverCode`).
    [Object.assign(new Error('没有向该账号投递的权限：需要 qq / b 上的 endpoint.operate'), { details: { serverCode: 'schedule_target_forbidden', httpStatus: 403 } }), '你没有权限向这个任务的投递目标（qq / b）发消息，无法恢复。'],
    [new Error('任务不存在: task:paused'), '任务不存在: task:paused'],
  ]
  for (const [error, expected] of cases) {
    const f = fixture(); await f.settle()
    elements(row(f.tree, 'task:paused')).find(node => node.type === 'button' && node.props.title === '恢复').props.onClick(); f.render()
    const call = f.calls.at(-1); assert.equal(call.input.type, 'cron:resume'); call.answered = true
    call.reject(error); await f.settle()
    assert.equal(f.errors.length, 1); assert.ok(f.errors[0].includes(expected), `${expected} in ${f.errors[0]}`)
    assert.doesNotMatch(f.errors[0], /schedule_target_forbidden/)
    f.close()
  }
})

test('pausing an enabled task that fails shows the Host message, not the resume explanation (#1250 b61)', async () => {
  const f = fixture(); await f.settle()
  elements(row(f.tree, 'task:daily')).find(node => node.type === 'button' && node.props.title === '暂停').props.onClick(); f.render()
  const call = f.calls.at(-1); assert.equal(call.input.type, 'cron:pause'); call.answered = true
  call.reject(refused('schedule_target_forbidden', '没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate')); await f.settle()
  assert.deepEqual(f.errors, ['没有向该账号投递的权限：需要 icqq / bot-1 上的 endpoint.operate'])
  assert.doesNotMatch(f.errors[0], /无法恢复/)
  f.close()
})

test('an older engine without agents hides the Agent field and the change action', async () => {
  const f = await agentFixture({ agents: null, rows: [persistent[0], { ...persistent[1], agent: 'researcher' }] })
  assert.doesNotMatch(runStatus(f, 'task:daily').html, /Agent：/)
  assert.match(runStatus(f, 'task:paused').html, /Agent：researcher/, 'a named Agent is still shown')
  expand(f, 'task:paused'); assert.equal(button(row(f.tree, 'task:paused'), '修改 Agent'), undefined)
  button(f.tree, '新建任务').props.onClick(); f.render()
  assert.equal(elements(f.tree).some(node => node.props?.['aria-labelledby'] === 'cron-new-agent-label'), false)
  f.close()
})

test('read-only identities see the Agent but cannot change it', async () => {
  const f = await agentFixture({ readOnly: true })
  assert.match(runStatus(f, 'task:daily').html, /Agent：researcher/)
  assert.equal(runStatus(f, 'task:paused').node.props.onChangeAgent, undefined)
  expand(f, 'task:plain'); assert.equal(button(row(f.tree, 'task:plain'), '修改 Agent'), undefined)
  f.close()
})
