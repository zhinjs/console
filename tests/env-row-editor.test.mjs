import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule } from './locale-fixture.mjs'
import * as envModel from '../console-ui/src/pages/env-editor-model.mjs'
import * as draftSession from '../console-ui/src/pages/files/draft-session.mjs'
import * as readError from '../console-ui/src/utils/read-error.mjs'
import * as applyOutcome from '../console-ui/src/components/apply-outcome-model.mjs'
import * as statusModel from '../console-ui/src/components/status-state-model.mjs'
import { createRestartTracker } from '../console-ui/src/components/restart-tracker.mjs'

const require = createRequire(import.meta.url)
const transpile = (source, extra = '') => ts.transpileModule(source + extra, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const envCode = transpile(await readFile(new URL('../console-ui/src/pages/env.tsx', import.meta.url), 'utf8'), '\nexport { EnvFileEditor };')
const restartCode = transpile(await readFile(new URL('../console-ui/src/hooks/use-host-restart.ts', import.meta.url), 'utf8'))

const elements = value => Array.isArray(value) ? value.flatMap(elements)
  : value && typeof value === 'object' ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value)
  ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children ?? '') : ''
/** Everything a user could read from the tree, including control values and attributes. */
const visible = tree => elements(tree).map(node => [text(node), node.props?.value, node.props?.['aria-label'], node.props?.title].filter(v => typeof v === 'string').join(' ')).join('\n')
const byLabel = (tree, label) => elements(tree).find(node => node.props?.['aria-label'] === label)
const buttonWith = (tree, label) => elements(tree).find(node => node.type === 'button' && text(node).includes(label))
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function hooks() {
  let slots = [], cursor = 0, pending = [], dirty = false
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  return {
    dirty: () => dirty,
    begin() { cursor = 0; dirty = false },
    flush() { const run = pending; pending = []; run.forEach(fn => fn()) },
    api: {
      useState(initial) {
        const i = cursor++
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
        return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(v, slots[i])) { slots[i] = v; dirty = true } }]
      },
      useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
      useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
      useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value },
      useEffect(fn, deps) {
        const i = cursor++
        if (same(slots[i]?.deps, deps)) return
        const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }
        pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() })
      },
    },
  }
}

function load(code, mocks) {
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('.')) throw new Error(`missing mock for ${name}`)
    return require(name)
  }, module.exports, module)
  return module.exports
}

function editorFixture({ file, fresh = () => file, readOnly = false, saveFails = false, stored = content => content } = {}) {
  const runtime = hooks(), writes = [], reads = [], drafts = []
  const ui = name => new Proxy({}, { get: (_, key) => key === '__esModule' ? false : `${name}:${String(key)}` })
  const mocks = {
    react: { ...require('react'), ...runtime.api },
    '../i18n': localeModule,
    '@zhin.js/client': { useEnvFiles: () => { throw new Error('page hook not used by the editor') } },
    '../utils/console-client': { getConsoleTransport: () => ({}) },
    'lucide-react': ui('icon'),
    '../components/ui/card': { Card: 'card', CardContent: 'card-content', CardDescription: 'card-description', CardHeader: 'card-header', CardTitle: 'card-title' },
    '../components/PageHeader': { PageHeader: 'page-header' },
    '../components/ui/badge': { Badge: 'badge' },
    '../components/ui/button': { Button: 'button' },
    '../components/ui/alert': { Alert: 'alert', AlertDescription: 'alert-description' },
    '../components/error-alert': { ErrorAlert: 'error-alert' }, './ops/load-state': { OpsLoadState: 'error-alert' },
    '../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog', useConfirm: () => ({ confirm: async () => false, ConfirmDialog: null }) },
    '../components/ui/tabs': { Tabs: 'tabs', TabsList: 'tabs-list', TabsTrigger: 'tabs-trigger', TabsContent: 'tabs-content' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' },
    '../components/ui/textarea': { Textarea: 'textarea' },
    '../components/ui/input': { Input: 'input' },
    './files/draft-session.mjs': draftSession,
    './env-editor-model.mjs': envModel,
    '../utils/read-error.mjs': readError,
    '../utils/console-access.mjs': { hasConsolePermission: () => !readOnly },
    '../components/ApplyFeedback': { ApplyFeedback: 'apply-feedback' },
    '../components/apply-outcome-model.mjs': applyOutcome,
  }
  const { EnvFileEditor } = load(envCode, mocks)
  let current = file
  const props = {
    filename: '.env', exists: true, readOnly,
    // First load, then the re-read before the write (`fresh`), then what the Host stored.
    getFile: async name => { reads.push(name); return writes.length ? current : reads.length === 1 ? current : fresh(current) },
    saveFile: async (name, content) => { if (saveFails) throw new Error('disk full'); writes.push({ name, content }); current = stored(content) },
    onDraftChange: draft => drafts.push(draft),
  }
  let tree
  const render = () => {
    let n = 0
    do { assert.ok(++n < 50, 'render loop'); runtime.begin(); tree = EnvFileEditor(props); runtime.flush() } while (runtime.dirty())
    return tree
  }
  const act = async fn => { await fn(); await settle(); return render() }
  return { render, act, writes, reads, drafts, get tree() { return tree } }
}

const FILE = '# Bot\nBOT_TOKEN=fake-bot-token\nAPI_SECRET="fake-api-secret"\nPORT=8080\n'

test('every secret starts masked and editing one row reveals only that row', async () => {
  const f = editorFixture({ file: FILE })
  f.render(); await settle(); let tree = f.render()
  assert.equal(/fake-bot-token|fake-api-secret/.test(visible(tree)), false)
  assert.ok(visible(tree).includes('8080'))
  tree = await f.act(() => byLabel(tree, '编辑 BOT_TOKEN').props.onClick())
  assert.equal(byLabel(tree, 'BOT_TOKEN 的值').props.value, 'fake-bot-token')
  assert.equal(visible(tree).includes('fake-api-secret'), false, 'rows that are not being edited stay masked')
  assert.equal(byLabel(tree, '编辑 API_SECRET').props.disabled, true, 'only one row is open at a time')
})

test('a secret can be shown and hidden per row without opening the editor', async () => {
  const f = editorFixture({ file: FILE })
  f.render(); await settle(); let tree = f.render()
  tree = await f.act(() => byLabel(tree, '显示 API_SECRET 的值').props.onClick())
  assert.ok(visible(tree).includes('"fake-api-secret"'))
  assert.equal(visible(tree).includes('fake-bot-token'), false)
  tree = await f.act(() => byLabel(tree, '隐藏 API_SECRET 的值').props.onClick())
  assert.equal(visible(tree).includes('fake-api-secret'), false)
})

test('editing a plain row saves only that change and never writes a masked placeholder over unrevealed secrets', async () => {
  const f = editorFixture({ file: FILE })
  f.render(); await settle(); let tree = f.render()
  tree = await f.act(() => byLabel(tree, '编辑 PORT').props.onClick())
  tree = await f.act(() => byLabel(tree, 'PORT 的值').props.onChange({ target: { value: '9090' } }))
  tree = await f.act(() => buttonWith(tree, '应用').props.onClick())
  assert.equal(visible(tree).includes('fake-bot-token'), false)
  tree = await f.act(() => buttonWith(tree, '保存').props.onClick())
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].content, '# Bot\nBOT_TOKEN=fake-bot-token\nAPI_SECRET="fake-api-secret"\nPORT=9090\n')
  assert.equal(f.writes[0].content.includes(envModel.ENV_MASK_CHAR), false)
})

test('saving re-reads the Host file and changes only edited keys, keeping lines written elsewhere', async () => {
  const f = editorFixture({ file: FILE, fresh: current => current.replace('BOT_TOKEN=fake-bot-token', 'BOT_TOKEN=rotated-elsewhere') + 'ADDED_ELSEWHERE=1\n' })
  f.render(); await settle(); let tree = f.render()
  tree = await f.act(() => buttonWith(tree, '新增变量').props.onClick())
  tree = await f.act(() => byLabel(tree, '变量名').props.onChange({ target: { value: 'NEW_FLAG' } }))
  tree = await f.act(() => byLabel(tree, '新变量的值').props.onChange({ target: { value: 'on' } }))
  tree = await f.act(() => buttonWith(tree, '应用').props.onClick())
  tree = await f.act(() => byLabel(tree, '删除 API_SECRET').props.onClick())
  tree = await f.act(() => buttonWith(tree, '保存').props.onClick())
  // Read before the write (merge), then once after it (read-back verification).
  assert.deepEqual(f.reads, ['.env', '.env', '.env'])
  assert.equal(f.writes[0].content, '# Bot\nBOT_TOKEN=rotated-elsewhere\nPORT=8080\nADDED_ELSEWHERE=1\nNEW_FLAG=on\n')
})

test('an invalid row stays open with its error and cannot be saved until it is applied or cancelled', async () => {
  const f = editorFixture({ file: FILE })
  f.render(); await settle(); let tree = f.render()
  tree = await f.act(() => byLabel(tree, '编辑 PORT').props.onClick())
  tree = await f.act(() => byLabel(tree, '变量名').props.onChange({ target: { value: 'BOT_TOKEN' } }))
  tree = await f.act(() => buttonWith(tree, '应用').props.onClick())
  assert.ok(visible(tree).includes('已存在同名变量'))
  assert.equal(buttonWith(tree, '保存').props.disabled, true)
  tree = await f.act(() => buttonWith(tree, '取消').props.onClick())
  assert.equal(f.writes.length, 0)
})

test('a successful save says 需要重启 next to 保存 and checks the file it reads back', async () => {
  const f = editorFixture({ file: FILE })
  f.render(); await settle(); let tree = f.render()
  tree = await f.act(() => byLabel(tree, '删除 PORT').props.onClick())
  tree = await f.act(() => buttonWith(tree, '保存').props.onClick())
  const [feedback] = elements(tree).filter(node => node.type === 'apply-feedback')
  assert.ok(feedback, 'the outcome is shown')
  assert.deepEqual([feedback.props.outcome.kind, feedback.props.outcome.basis], ['restart', 'env-file'])
  assert.equal(feedback.props.mismatch, null, 'the read-back matches what was written')
  assert.equal(feedback.props.unverified, false)
  assert.equal(typeof feedback.props.onRestarted, 'function', '立即重启 refreshes the file afterwards')
  assert.equal(elements(tree).some(node => node.type === 'alert' && node.props.variant === 'success'), false, 'no second success notice')
})

test('a read-back that differs from the write is shown instead of success, secrets masked', async () => {
  const f = editorFixture({ file: FILE, stored: content => content.replace('BOT_TOKEN=fake-bot-token', 'BOT_TOKEN=changed-by-host') })
  f.render(); await settle(); let tree = f.render()
  tree = await f.act(() => byLabel(tree, '删除 PORT').props.onClick())
  tree = await f.act(() => buttonWith(tree, '保存').props.onClick())
  const [feedback] = elements(tree).filter(node => node.type === 'apply-feedback')
  assert.equal(feedback.props.mismatch.path, 'BOT_TOKEN')
  assert.equal(feedback.props.mismatch.masked, true)
  assert.doesNotMatch(JSON.stringify(feedback.props.mismatch), /fake-bot-token|changed-by-host/)
  assert.equal(visible(tree).includes('changed-by-host'), false, 'the editor shows the stored file, still masked')
})

test('Demo read-only keeps every secret masked and offers no reveal or row edits', async () => {
  const f = editorFixture({ file: FILE, readOnly: true })
  f.render(); await settle(); const tree = f.render()
  assert.equal(/fake-bot-token|fake-api-secret/.test(visible(tree)), false)
  for (const label of ['编辑 PORT', '删除 PORT', '显示 BOT_TOKEN 的值']) assert.equal(byLabel(tree, label), undefined, label)
  assert.equal(buttonWith(tree, '新增变量'), undefined)
})

test('Restart Host reuses the one confirm-then-system:restart flow shared with the dashboard and the save outcomes', async () => {
  const requests = [], confirms = []
  let answer = false
  const runtime = hooks()
  const tracker = []
  const { useHostRestart, hostRestart } = load(restartCode, {
    react: { ...require('react'), ...runtime.api, useSyncExternalStore: (_subscribe, read) => read() },
    '../i18n': localeModule,
    '../contracts/zhin-console': { CONSOLE_RPC: { SYSTEM_RESTART: 'system:restart' } },
    '../contracts/gateway': { GATEWAY_INSTANCE_RPC: { STATUS: 'gateway.instance.status' } },
    '../utils/console-rpc': { requestConsole: async request => { requests.push(request); return request.type === 'gateway.instance.status' ? { state: 'running', generation: 1 } : { success: true } } },
    '../utils/console-client': { getConsoleTransport: () => ({ isConnected: () => true, onConnectionChange: () => () => {} }) },
    '../utils/instance-availability.mjs': { probeInstance: async () => true },
    '../components/status-state-model.mjs': statusModel,
    '../components/restart-tracker.mjs': { createRestartTracker: deps => { const made = createRestartTracker({ ...deps, setTimer: fn => { tracker.push(fn); return tracker.length }, clearTimer() {} }); return made } },
    '../components/apply-outcome-model.mjs': applyOutcome,
  })
  runtime.begin()
  const { confirmRestart } = useHostRestart(async options => { confirms.push(options); return answer })
  await confirmRestart()
  assert.equal(confirms.length, 1); assert.equal(confirms[0].variant, 'destructive'); assert.deepEqual(requests, [])
  answer = true
  await confirmRestart()
  // The run facts are read first, then the restart is sent once and the progress waits for the instance.
  assert.deepEqual(requests.map(request => request.type), ['gateway.instance.status', 'system:restart'])
  assert.equal(hostRestart.get().phase, 'waiting')
  assert.deepEqual(hostRestart.get().before, { state: 'running', generation: 1 })
  await confirmRestart()
  assert.equal(requests.filter(request => request.type === 'system:restart').length, 1, 'no second restart while one is running')
  hostRestart.reset()
  for (const page of ['pages/env.tsx', 'pages/dashboard.tsx']) {
    const source = await readFile(new URL(`../console-ui/src/${page}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /SYSTEM_RESTART/, `${page} must not keep its own restart request`)
  }
  const dashboard = await readFile(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
  assert.match(dashboard, /useHostRestart\(confirm\)/)
  assert.match(dashboard, /<RestartProgress onRestarted=\{refreshAll\} \/>/, '首页 shows the restart progress next to its button')
  const env = await readFile(new URL('../console-ui/src/pages/env.tsx', import.meta.url), 'utf8')
  assert.match(env, /outcomeFromEnvSave\(\)/, '环境变量 restarts through the save outcome (ApplyFeedback)')
})
