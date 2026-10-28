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
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'

const require = createRequire(import.meta.url)
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
const source = await readFile(new URL('../console-ui/src/pages/cron.tsx', import.meta.url), 'utf8')
const selectSource = await readFile(new URL('../console-ui/src/components/ui/select.tsx', import.meta.url), 'utf8')
function compile(source, mocks, extras = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions }).outputText
  new Function('require', 'exports', 'module', ...Object.keys(extras), code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module, ...Object.values(extras))
  return module.exports
}
const select = compile(selectSource, { '@zhin.js/client': { cn: (...classes) => classes.filter(Boolean).join(' ') } })
const persistent = [
  { type: 'persistent', id: 'task:daily', label: '早间摘要', prompt: '整理今天的重要消息', cronExpression: '0 0 9 * * *', enabled: true, createdAt: 12345, nextExecution: Date.now() + 3600000, lastStatus: 'error' },
  { type: 'persistent', id: 'task:paused', prompt: '检查家里温度', cronExpression: '0 */10 * * * *', enabled: false },
  { type: 'persistent', id: 'task:unknown', label: '待确认结果', prompt: '检查服务', cronExpression: '0 0 9 1 * *', enabled: true },
]
const memory = [{ type: 'memory', id: 'plugin-cron', plugin: 'root/reminder', description: '检查新提醒', expression: '0 */5 * * * *', running: true }]
function fixture({ demo = false, available = true, jobs = [], deferJobs = false, autoLoad = true } = {}) {
  let connection = { host: 'https://host-a', credential: 'credential-a' }, scopeCounter = 0, slots = [], mountedKey
  const authority = createInboxCacheAuthority(() => connection, () => `scope-${++scopeCounter}`)
  const calls = [], httpCalls = [], effects = [], timers = [], errors = []; let cursor = 0, dirty = false
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) { const index = cursor++, owned = slots; if (!(index in owned)) owned[index] = typeof initial === 'function' ? initial() : initial; return [owned[index], value => { owned[index] = typeof value === 'function' ? value(owned[index]) : value; if (slots === owned) dirty = true }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useCallback(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn },
    useEffect(effect, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect() }) } },
  }
  const module = compile(source + '\nexport { PersistentRunStatus, CronPageSession };', {
    react: hooks, 'react-router-dom': { Link: 'a' }, 'lucide-react': new Proxy({}, { get: () => 'i' }),
    '../components/ui/button': { Button: 'button' }, '../components/ui/card': { Card: 'article', CardContent: 'section' },
    '../components/ui/badge': { Badge: 'span' }, '../components/ui/alert': { Alert: 'aside', AlertDescription: 'p' },
    '../components/ui/skeleton': { Skeleton: 'div' }, '../components/ui/input': { Input: 'input' }, '../components/ui/textarea': { Textarea: 'textarea' }, '../components/ui/separator': { Separator: 'hr' }, '../components/ui/select': select,
    '../components/ui/dialog': { Dialog: 'dialog', DialogContent: 'section', DialogHeader: 'header', DialogFooter: 'footer', DialogTitle: 'h2', DialogDescription: 'p', DialogClose: 'close' },
    '../components/toast': { useToast: () => ({ error: message => errors.push(message) }) }, '../components/PageHeader': { PageHeader: 'page-header' },
    '../contracts/zhin-console': { CONSOLE_RPC: { SCHEDULE_LIST: 'schedule:list', CRON_VALIDATE: 'cron:validate', CRON_ADD: 'cron:add', CRON_REMOVE: 'cron:remove', CRON_PAUSE: 'cron:pause', CRON_RESUME: 'cron:resume' } },
    '../utils/console-rpc': { requestConsole: input => new Promise((resolve, reject) => calls.push({ input, resolve, reject, answered: false, scope: authority.current() })) },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() }, '../utils/inbox-cache': { isInboxCacheScopeActive: scope => authority.active(scope) },
    '../utils/demo-mode': { isDemoMode: () => demo }, './cron-schedule.mjs': { describeCron, relativeUntil },
    './assistant-jobs-model.mjs': { validateAssistantJobs, explainJobError },
    '../utils/auth': { apiFetch: (url, options) => new Promise((resolve, reject) => { httpCalls.push({ url, options, resolve, reject, scope: authority.current() }); if (!deferJobs) resolve({ ok: true, json: async () => ({ success: true, data: { jobs, eventsActive: false } }) }) }) }, './cron.css': {},
  }, { window: { setInterval: () => 1, clearInterval: () => {} }, setTimeout: callback => { timers.push(callback); return timers.length }, clearTimeout: () => {} })
  let tree
  const f = { calls, httpCalls, module, timers, errors, authority,
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
  for (const options of [{ demo: true }, { available: false }]) {
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
