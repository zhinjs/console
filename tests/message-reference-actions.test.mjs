import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// Loaded lazily so the page tests below fail on behaviour, not on a missing import, against old code.
const referenceModel = await import('../console-ui/src/pages/endpoint-detail/message-reference-model.mjs').catch(() => ({}))
const require = createRequire(import.meta.url)
const t = (message, values) => translate('zh-CN', message, values)

test('quote and forward drafts are sent as an honest plain-text prefix', () => {
  const { textReferenceSendOptions } = referenceModel
  assert.equal(typeof textReferenceSendOptions, 'function')
  const reference = { id: 'platform-1', senderName: '甲', summary: '原消息摘要' }
  assert.deepEqual(textReferenceSendOptions({ quote: null, forward: null }, t), {})
  const quote = textReferenceSendOptions({ quote: reference, forward: null }, t)
  assert.equal(quote.textPrefix, '引用 甲: 原消息摘要')
  assert.deepEqual(quote.displayPrefixSegments, [{ type: 'text', data: { text: '引用 甲: 原消息摘要\n' } }])
  assert.ok(!JSON.stringify(quote).includes('platform-1'), 'no reply segment or original id is invented')
  assert.equal(textReferenceSendOptions({ quote: null, forward: reference }, t).textPrefix, '转发 甲: 原消息摘要')
})

test('copying a summary reports copied, failed and unavailable clipboards', async () => {
  const { copyMessageSummary } = referenceModel
  assert.equal(typeof copyMessageSummary, 'function')
  const written = []
  assert.equal(await copyMessageSummary('摘要', { writeText: async text => { written.push(text) } }, undefined), 'copied')
  assert.deepEqual(written, ['摘要'])
  assert.equal(await copyMessageSummary('摘要', { writeText: async () => { throw new Error('denied') } }, undefined), 'failed')
  assert.equal(await copyMessageSummary('摘要', undefined, undefined), 'unavailable')
  // Without the Clipboard API the textarea + execCommand path is tried before giving up.
  const doc = result => ({ activeElement: null, createElement: () => ({ style: {}, select() {} }), body: { appendChild(el) { el.parentNode = this }, removeChild(el) { el.parentNode = null } }, execCommand: () => result })
  assert.equal(await copyMessageSummary('摘要', undefined, doc(true)), 'copied')
  assert.equal(await copyMessageSummary('摘要', undefined, doc(false)), 'failed')
})

const source = await readFile(new URL('../console-ui/src/pages/endpoint-detail/ChatMessageRow.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function renderRow({ toasts, onQuote = () => {}, onForward = () => {} }) {
  const module = { exports: {} }
  const record = variant => (description, title) => { toasts.push({ variant, description, title }) }
  const mocks = {
    '../../i18n/locale.mjs': { translate },
    '../../i18n': { useI18n: () => ({ locale: 'zh-CN', t }) },
    'lucide-react': new Proxy({}, { get: (_object, key) => key }),
    '@zhin.js/client': { cn: (...values) => values.filter(Boolean).join(' ') },
    './RenderingDiagnostics': { RenderingDiagnostics: 'rendering-diagnostics' },
    './MessageBody': { MessageBody: 'message-body', messageContentSummary: content => content.map(seg => seg.data?.text ?? '').join(' ') },
    './MessageDiagnostics': { MessageDiagnosticsAction: 'message-diagnostics-action' },
    '../../components/toast': { useToast: () => ({ success: record('success'), error: record('error'), toast() {}, warning() {}, info() {} }) },
    './message-reference-model.mjs': referenceModel,
  }
  new Function('require', 'module', 'exports', compiled)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  const message = { id: 'row-1', messageId: 'platform-1', channelId: 'g', channelType: 'group', sender: { id: 'u1', name: '甲' }, content: [{ type: 'text', data: { text: '你好' } }], timestamp: 0 }
  return module.exports.ChatMessageRow({ message, onQuote, onForward })
}

function buttons(node, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) { node.forEach(child => buttons(child, found)); return found }
  if (node.type === 'button') found.push(node.props)
  buttons(node.props?.children, found)
  return found
}

test('message actions are named after what they really send', () => {
  const quoted = [], forwarded = []
  const actions = buttons(renderRow({ toasts: [], onQuote: ref => quoted.push(ref), onForward: ref => forwarded.push(ref) }))
  const labels = actions.map(props => props['aria-label'])
  assert.deepEqual(labels, ['引用文本', '以文本转发', '复制摘要'], 'no button claims a platform quote or an original forward')
  assert.match(actions[0].title, /纯文本/)
  assert.match(actions[1].title, /不是原样转发/)
  actions[0].onClick(); actions[1].onClick()
  assert.deepEqual(quoted, [{ id: 'platform-1', senderName: '甲', summary: '你好' }])
  assert.deepEqual(forwarded, quoted)
})

async function clickCopy(clipboard, document) {
  const toasts = []
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousDocument = globalThis.document
  Object.defineProperty(globalThis, 'navigator', { value: clipboard ? { clipboard } : {}, configurable: true })
  globalThis.document = document
  try {
    const copy = buttons(renderRow({ toasts })).find(props => props['aria-label'] === '复制摘要')
    copy.onClick()
    for (let i = 0; i < 10 && !toasts.length; i++) await new Promise(resolve => setImmediate(resolve))
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator
    globalThis.document = previousDocument
  }
  return toasts
}

test('copying a summary always tells the user whether it worked', async () => {
  const copied = []
  assert.deepEqual(await clickCopy({ writeText: async text => { copied.push(text) } }), [{ variant: 'success', description: '已复制消息摘要', title: undefined }])
  assert.deepEqual(copied, ['你好'])
  const denied = await clickCopy({ writeText: async () => { throw new Error('denied') } })
  assert.equal(denied[0]?.variant, 'error'); assert.match(denied[0].description, /手动复制/)
  const unavailable = await clickCopy(undefined, undefined)
  assert.equal(unavailable[0]?.variant, 'error'); assert.match(unavailable[0].description, /无法访问剪贴板/)
})
