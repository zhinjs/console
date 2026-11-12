import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { readEndpointList } from '../console-ui/src/pages/endpoint-list-model.mjs'
import * as consoleRoutes from '../console-ui/src/console-routes.mjs'
import * as scopeTree from '../console-ui/src/scope/scope-tree.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/pages/endpoint-detail/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const accountSource = await source('AccountSwitcher.tsx')
const attachmentSource = await source('ComposerAttachmentMenu.tsx')
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const ui = Object.fromEntries(['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel', 'DropdownMenuSeparator'].map(name => [name, name]))
const settle = () => new Promise(resolve => setImmediate(resolve))
const i18n = { locale: 'en', t: (message, values) => translate('en', message, values) }
function fixture(props = {}) {
  const slots = [], calls = [], navigations = [], confirmations = []
  let cursor = 0, effects = [], scope = 'host-a', tree
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useEffect(fn, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) { previous?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = fn() }) } },
  }
  const module = compile(accountSource, {
    react: hooks,
    'react-router-dom': { Link: 'a', useNavigate: () => path => navigations.push(path) },
    'lucide-react': new Proxy({}, { get: (_target, key) => key }),
    '../../i18n': { useI18n: () => i18n },
    '../../components/confirm-dialog': { useConfirm: () => ({ confirm: options => new Promise(resolve => confirmations.push({ options, resolve })), ConfirmDialog: null }) },
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/dropdown-menu': ui,
    '../../contracts/zhin-console': { ENDPOINT_RPC: { LIST: 'endpoint.list' } },
    '../../utils/console-rpc': { requestConsole: input => new Promise((resolve, reject) => calls.push({ input, resolve, reject })) },
    '../../utils/useInboxCacheScope': { useInboxCacheScope: () => scope },
    '../../utils/inbox-cache': { isInboxCacheScopeActive: expected => expected === scope },
    '../endpoint-list-model.mjs': { readEndpointList },
    '../../console-routes.mjs': consoleRoutes,
    '../../scope/scope-tree.mjs': scopeTree,
  })
  const settings = { adapter: 'root/icqq', endpointId: 'bot:1', info: null, loadErr: null, ...props }
  const f = {
    calls, navigations, confirmations,
    render() { cursor = 0; tree = module.AccountSwitcher(settings); const run = effects; effects = []; run.forEach(fn => fn()); return tree },
    setScope(next) { scope = next },
    open() { nodes(tree).find(node => node.type === 'DropdownMenu').props.onOpenChange(true); f.render(); f.render() },
    closeMenu() { nodes(tree).find(node => node.type === 'DropdownMenu').props.onOpenChange(false); f.render() },
    get tree() { return tree },
    close() { slots.forEach(slot => slot?.cleanup?.()) },
  }
  f.render()
  return f
}
const endpoints = [
  { adapter: 'root/icqq', name: 'bot:1', connected: true, status: 'online' },
  { adapter: 'telegram', name: 'support bot', connected: false, status: 'offline' },
]
const findLink = (f, path) => nodes(f.tree).find(node => node.type === 'a' && node.props.to === path)
const click = patch => ({ button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...patch })

test('account directory reads only when opened and retains encoded identity, current selection and offline accounts', async () => {
  const f = fixture()
  try {
    assert.equal(f.calls.length, 0)
    assert.ok(text(f.tree).includes(translate('en', '状态未知')))
    f.open(); assert.deepEqual(f.calls[0].input, { type: 'endpoint.list' })
    f.calls[0].resolve({ endpoints }); await settle(); f.render()
    const current = findLink(f, '/scope/root%2Ficqq/bot%3A1?tab=chat')
    assert.equal(current.props['aria-current'], 'page')
    const event = click(); current.props.onClick(event); assert.equal(event.defaultPrevented, true)
    assert.ok(text(findLink(f, '/scope/telegram/support%20bot?tab=chat')).includes('Offline'))
    assert.ok(findLink(f, '/scope'))
    assert.equal(f.navigations.length, 0)
  } finally { f.close() }
})

test('malformed or failed directories show retry instead of presenting a normal empty account list', async () => {
  const f = fixture()
  try {
    f.open(); f.calls[0].resolve({}); await settle(); f.render()
    assert.ok(nodes(f.tree).some(node => node.props?.role === 'alert'))
    const retry = nodes(f.tree).find(node => node.type === 'button' && text(node).includes('Retry'))
    retry.props.onClick(); f.render(); f.render(); assert.equal(f.calls.length, 2)
    f.calls[1].resolve({ endpoints: [] }); await settle(); f.render()
    assert.ok(text(f.tree).includes('No chat accounts to switch to'))
    assert.ok(!nodes(f.tree).some(node => node.props?.role === 'alert'))
  } finally { f.close() }
})

test('Host change hides a previous directory before effects reset state and rejects its pending results', async () => {
  const f = fixture()
  try {
    f.open(); f.calls[0].resolve({ endpoints }); await settle(); f.render()
    assert.ok(text(f.tree).includes('support bot'))
    f.setScope('host-b'); f.render()
    assert.ok(!text(f.tree).includes('support bot'))
    f.closeMenu(); f.open(); const stale = f.calls.at(-1)
    f.setScope('host-c'); f.render(); const fresh = f.calls.at(-1)
    stale.resolve({ endpoints: [{ ...endpoints[1], name: 'PRIVATE-STALE' }] }); await settle(); f.render()
    assert.ok(!text(f.tree).includes('PRIVATE-STALE'))
    fresh.resolve({ endpoints: [{ ...endpoints[1], name: 'new account' }] }); await settle(); f.render()
    assert.ok(text(f.tree).includes('new account'))
  } finally { f.close() }
})

test('closing the account menu cancels pending directory publication', async () => {
  const f = fixture()
  try {
    f.open(); f.closeMenu(); f.calls[0].resolve({ endpoints }); await settle(); f.render()
    assert.ok(!text(f.tree).includes('support bot'))
  } finally { f.close() }
})

test('drafts require explicit confirmation, cancellation stays put, and only approval navigates', async () => {
  let drawersClosed = 0
  const f = fixture({ hasDraft: true, onBeforeLeave: () => { drawersClosed++ } })
  try {
    f.open(); f.calls[0].resolve({ endpoints }); await settle(); f.render()
    let event = click(); findLink(f, '/scope/telegram/support%20bot?tab=chat').props.onClick(event)
    f.render()
    assert.equal(nodes(f.tree).find(node => node.type === 'DropdownMenu').props.open, false, 'the menu closes before opening the confirmation')
    assert.equal(drawersClosed, 1, 'the mobile drawer closes before opening the confirmation')
    let focusPrevented = false
    nodes(f.tree).find(node => node.type === 'DropdownMenuContent').props.onCloseAutoFocus({ preventDefault() { focusPrevented = true } })
    assert.equal(focusPrevented, true, 'a closing menu must not steal focus from the dialog')
    assert.equal(event.defaultPrevented, true); assert.equal(f.navigations.length, 0)
    f.confirmations[0].resolve(false); await settle()
    assert.equal(f.navigations.length, 0)
    event = click(); findLink(f, '/scope').props.onClick(event)
    f.confirmations[1].resolve(true); await settle()
    assert.deepEqual(f.navigations, ['/scope'])
  } finally { f.close() }
})

test('confirmation from a former Host cannot navigate the new connection', async () => {
  const f = fixture({ hasDraft: true })
  try {
    f.open(); f.calls[0].resolve({ endpoints }); await settle(); f.render()
    findLink(f, '/scope/telegram/support%20bot?tab=chat').props.onClick(click())
    f.setScope('host-b'); f.render(); f.confirmations[0].resolve(true); await settle()
    assert.equal(f.navigations.length, 0)
  } finally { f.close() }
})

test('sending disables account switching while ordinary links and modified clicks keep native navigation', async () => {
  const busy = fixture({ sending: true })
  try { assert.equal(nodes(busy.tree).find(node => node.props?.['aria-label'] === 'Switch chat account').props.disabled, true) } finally { busy.close() }
  const f = fixture({ hasDraft: true })
  try {
    f.open(); f.calls[0].resolve({ endpoints }); await settle(); f.render()
    const event = click({ ctrlKey: true }); findLink(f, '/scope/telegram/support%20bot?tab=chat').props.onClick(event)
    assert.equal(event.defaultPrevented, false); assert.equal(f.confirmations.length, 0)
  } finally { f.close() }
})

test('attachment menu keeps all five actions, correct media types, and a named disabled trigger', () => {
  const calls = []
  const { ComposerAttachmentMenu } = compile(attachmentSource, {
    'lucide-react': new Proxy({}, { get: (_target, key) => key }), '../../i18n': { useI18n: () => i18n },
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/dropdown-menu': ui,
  })
  const tree = ComposerAttachmentMenu({ disabled: true, onImage: () => calls.push('image-file'), onFile: () => calls.push('file'), onMedia: type => calls.push(type) })
  const trigger = nodes(tree).find(node => node.type === 'button')
  assert.equal(trigger.props['aria-label'], 'Add attachment'); assert.equal(trigger.props.disabled, true)
  const items = nodes(tree).filter(node => node.type === 'DropdownMenuItem')
  assert.equal(items.length, 5); items.forEach(item => item.props.onSelect())
  assert.deepEqual(calls, ['image-file', 'file', 'image', 'video', 'audio'])
})

test('account routes remount the workspace and explicitly guard text, attachments, references and unfinished URLs', async () => {
  const page = await source('index.tsx')
  assert.match(page, /<EndpointWorkspace key=\{`\$\{target\.adapter\}\\u0000\$\{target\.endpointId\}\\u0000\$\{target\.channelType \?\? ''\}\\u0000\$\{target\.channelId \?\? ''\}`\} target=\{target\} \/>/)
  assert.match(page, /hasDraft=\{.*msgContent\.trim\(\).*composerAttachments\.length.*quoteDraft.*forwardDraft.*mediaUrl\.trim\(\)/)
  assert.match(page, /<ComposerAttachmentMenu[\s\S]*?disabled=\{sending\}/)
})
