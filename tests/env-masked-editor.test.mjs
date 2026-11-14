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

const require = createRequire(import.meta.url)
const transpile = (source, extra = '') => ts.transpileModule(source + extra, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const envCode = transpile(await readFile(new URL('../console-ui/src/pages/env.tsx', import.meta.url), 'utf8'), '\nexport { EnvFileEditor, MaskedEnvFileEditor, EnvFileTab };')

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


const MASK = envModel.ENV_MASK_CHAR.repeat(8)
const VIEW = {
  format: 'masked', file: '.env', content: 'ignored',
  lines: [{ kind: 'comment', text: '# Bot' }, { kind: 'entry', key: 'BOT_TOKEN' }, { kind: 'entry', key: 'PORT' }, { kind: 'entry', key: 'EMPTY' }],
  variables: [
    { key: 'BOT_TOKEN', masked: `fa${MASK}en`, length: 14, hasValue: true },
    { key: 'PORT', masked: MASK, length: 4, hasValue: true },
    { key: 'EMPTY', masked: '', length: 0, hasValue: false },
  ],
}
const SECRET = 'fake-bot-token'

function mocks(runtime, { readOnly = false } = {}) {
  return {
    react: { ...require('react'), ...runtime.api },
    '../i18n': localeModule,
    '@zhin.js/client': { useEnvFiles: () => { throw new Error('page hook not used by the editor') } },
    '../utils/console-client': { getConsoleTransport: () => ({}) },
    '../utils/console-rpc': { requestConsole: async () => { throw new Error('tests pass request explicitly') } },
    'lucide-react': new Proxy({}, { get: (_, key) => key === '__esModule' ? false : `icon:${String(key)}` }),
    '../components/ui/card': { Card: 'card', CardContent: 'card-content', CardDescription: 'card-description', CardHeader: 'card-header', CardTitle: 'card-title' },
    '../components/PageHeader': { PageHeader: 'page-header' },
    '../components/ui/badge': { Badge: 'badge' },
    '../components/ui/button': { Button: 'button' }, '../components/StatusState': { StatusState: 'status-state' },
    '../components/ui/alert': { Alert: 'alert', AlertDescription: 'alert-description' },
    './ops/load-state': { OpsLoadState: 'error-alert' },
    '../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
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
}

/** A masking Host: `env:get` masks, `env:reveal` answers one value, `env:save` records changes. */
function maskedFixture({ readOnly = false, canReveal = !readOnly, reply = () => VIEW, revealFails = false } = {}) {
  const runtime = hooks(), requests = [], drafts = []
  let legacy = 0
  const { MaskedEnvFileEditor } = load(envCode, mocks(runtime, { readOnly }))
  const request = async message => {
    requests.push(message)
    if (message.type === 'env:get') return reply(requests)
    if (message.type === 'env:reveal') {
      if (revealFails) throw new Error('缺少权限 ops.env.write')
      return { file: '.env', key: message.key, value: message.key === 'BOT_TOKEN' ? SECRET : '8080' }
    }
    if (message.type === 'env:save') return { success: true, changed: message.changes.map(change => change.key) }
    throw new Error(`unexpected ${message.type}`)
  }
  const props = { filename: '.env', readOnly, canReveal, request, onDraftChange: draft => drafts.push(draft), onLegacyHost: () => { legacy++ } }
  let tree
  const render = () => {
    let n = 0
    do { assert.ok(++n < 50, 'render loop'); runtime.begin(); tree = MaskedEnvFileEditor(props); runtime.flush() } while (runtime.dirty())
    return tree
  }
  const act = async fn => { await fn(); await settle(); return render() }
  const start = async () => { render(); await settle(); return render() }
  return { render, act, start, requests, drafts, get legacy() { return legacy } }
}

test('a masking Host: every value starts masked and only env:get is requested', async () => {
  const f = maskedFixture()
  const tree = await f.start()
  assert.deepEqual(f.requests, [{ type: 'env:get', filename: '.env' }])
  assert.ok(visible(tree).includes(`BOT_TOKEN=fa${MASK}en`))
  assert.ok(visible(tree).includes(`PORT=${MASK}`))
  assert.equal(visible(tree).includes(SECRET), false)
  assert.ok(visible(tree).includes('值默认打码'), 'the page says why values are masked')
  assert.equal(byLabel(tree, '显示 EMPTY 的值'), undefined, 'an empty value has nothing to show')
})

test('显示 reveals one variable with env:reveal; 隐藏 clears it again', async () => {
  const f = maskedFixture()
  let tree = await f.start()
  tree = await f.act(() => byLabel(tree, '显示 BOT_TOKEN 的值').props.onClick())
  assert.deepEqual(f.requests.at(-1), { type: 'env:reveal', filename: '.env', key: 'BOT_TOKEN' })
  assert.equal(f.requests.filter(r => r.type === 'env:reveal').length, 1, 'only the clicked variable')
  assert.ok(visible(tree).includes(`BOT_TOKEN=${SECRET}`))
  assert.equal(visible(tree).includes('8080'), false)
  tree = await f.act(() => byLabel(tree, '隐藏 BOT_TOKEN 的值').props.onClick())
  assert.equal(visible(tree).includes(SECRET), false)
  assert.equal(JSON.stringify(f.drafts).includes(SECRET), false, 'revealed values never reach the tab drafts')
})

test('a failed reveal shows an error and no value', async () => {
  const f = maskedFixture({ revealFails: true })
  let tree = await f.start()
  tree = await f.act(() => byLabel(tree, '显示 BOT_TOKEN 的值').props.onClick())
  assert.ok(visible(tree).includes('显示失败'))
  assert.equal(visible(tree).includes(SECRET), false)
})

test('saving submits only the changed keys as env:save { changes }, never the file or a mask', async () => {
  const f = maskedFixture()
  let tree = await f.start()
  tree = await f.act(() => byLabel(tree, '编辑 PORT').props.onClick())
  assert.equal(byLabel(tree, 'PORT 的值').props.value, '', 'an unrevealed value is not prefilled')
  assert.equal(byLabel(tree, '变量名').props.disabled, true, 'an existing key is not renamed in place')
  tree = await f.act(() => byLabel(tree, 'PORT 的值').props.onChange({ target: { value: '9090' } }))
  tree = await f.act(() => buttonWith(tree, '应用').props.onClick())
  assert.ok(visible(tree).includes('已修改，未保存'))
  tree = await f.act(() => byLabel(tree, '删除 EMPTY').props.onClick())
  tree = await f.act(() => buttonWith(tree, '新增变量').props.onClick())
  tree = await f.act(() => byLabel(tree, '变量名').props.onChange({ target: { value: 'NEW_FLAG' } }))
  tree = await f.act(() => byLabel(tree, '新变量的值').props.onChange({ target: { value: 'on' } }))
  tree = await f.act(() => buttonWith(tree, '应用').props.onClick())
  tree = await f.act(() => buttonWith(tree, '保存').props.onClick())
  const saves = f.requests.filter(r => r.type === 'env:save')
  assert.deepEqual(saves, [{ type: 'env:save', filename: '.env', changes: [{ key: 'PORT', value: '9090' }, { key: 'EMPTY', delete: true }, { key: 'NEW_FLAG', value: 'on' }] }])
  assert.equal('content' in saves[0], false)
  assert.equal(JSON.stringify(saves).includes(envModel.ENV_MASK_CHAR), false)
  assert.equal(f.requests.at(-1).type, 'env:get', 'the view is read back after saving')
  const [feedback] = elements(tree).filter(node => node.type === 'apply-feedback')
  assert.deepEqual([feedback.props.outcome.kind, feedback.props.outcome.basis], ['restart', 'env-file'])
})

test('a mask placeholder typed as a value is refused before anything is sent', async () => {
  const f = maskedFixture()
  let tree = await f.start()
  tree = await f.act(() => byLabel(tree, '编辑 BOT_TOKEN').props.onClick())
  tree = await f.act(() => byLabel(tree, 'BOT_TOKEN 的值').props.onChange({ target: { value: `fa${MASK}en` } }))
  tree = await f.act(() => buttonWith(tree, '应用').props.onClick())
  assert.ok(visible(tree).includes('值不能是遮罩占位符'))
  assert.equal(f.requests.some(r => r.type === 'env:save'), false)
})

test('without reveal permission there is no 显示; read-only has no edits either', async () => {
  let f = maskedFixture({ canReveal: false })
  let tree = await f.start()
  assert.equal(byLabel(tree, '显示 BOT_TOKEN 的值'), undefined)
  assert.ok(byLabel(tree, '编辑 PORT'))
  f = maskedFixture({ readOnly: true })
  tree = await f.start()
  for (const label of ['显示 BOT_TOKEN 的值', '编辑 PORT', '删除 PORT']) assert.equal(byLabel(tree, label), undefined, label)
  assert.ok(visible(tree).includes('只读 · 值始终打码'))
  assert.equal(f.requests.some(r => r.type !== 'env:get'), false)
})

test('an older Host ({ content }) switches the tab to the legacy editor with a plain-text notice', async () => {
  const f = maskedFixture({ reply: () => ({ content: 'BOT_TOKEN=fake-bot-token\n' }) })
  await f.start()
  assert.equal(f.legacy, 1)
  const runtime = hooks()
  const { EnvFileTab } = load(envCode, mocks(runtime))
  let switchToLegacy
  const props = {
    filename: '.env', exists: true, readOnly: false, canReveal: true,
    getFile: async () => 'BOT_TOKEN=fake-bot-token\n', saveFile: async () => {},
    onLegacyDraftChange() {}, onMaskedDraftChange() {},
    request: async () => ({ content: 'BOT_TOKEN=fake-bot-token\n' }),
  }
  runtime.begin(); let tree = EnvFileTab(props); runtime.flush()
  const editor = elements(tree).find(node => typeof node.type === 'function' && node.props?.onLegacyHost)
  assert.ok(editor, 'the masked editor is tried first')
  switchToLegacy = editor.props.onLegacyHost
  switchToLegacy()
  runtime.begin(); tree = EnvFileTab(props); runtime.flush()
  assert.ok(visible(tree).includes('当前 Host 版本会显示原文'))
  assert.ok(elements(tree).some(node => typeof node.type === 'function' && node.props?.getFile), 'the legacy editor is shown')
})
