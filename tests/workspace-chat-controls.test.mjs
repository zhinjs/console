import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/pages/endpoint-detail/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return module.exports
}
const attachmentSource = await source('ComposerAttachmentMenu.tsx')
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const ui = Object.fromEntries(['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel', 'DropdownMenuSeparator'].map(name => [name, name]))
const i18n = { locale: 'en', t: (message, values) => translate('en', message, values) }
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

test('the account workspace stays mounted across its conversations; a conversation page mounts its own', async () => {
  const page = await source('index.tsx')
  const view = page.slice(page.indexOf('export function EndpointWorkspaceView'), page.indexOf('function EndpointWorkspace('))
  // Account mode is keyed by the account only: switching conversations keeps drafts, caches and scroll memory.
  assert.match(view, /: `\$\{target\.adapter\}\\u0000\$\{target\.endpointId\}`/)
  assert.match(view, /mode === 'conversation'\s*\? `\$\{target\.adapter\}\\u0000\$\{target\.endpointId\}\\u0000\$\{target\.channelType \?\? ''\}\\u0000\$\{target\.channelId \?\? ''\}`/)
  assert.match(view, /<EndpointWorkspace key=\{key\}/)
  // Every pick goes to the URL; deleting a friend clears it.
  assert.match(page, /const select = \(next: SidebarSelection \| null\) => \{\s*setSelection\(next\)\s*onSelectionChange\?\.\(next\)/)
  assert.match(page, /if \(ok && await deleteFriend\(\)\) onSelectionChange\?\.\(null\)/)
  // Unsent text or attachments keep a refresh from dropping them silently.
  assert.match(page, /const unsent = hasTextDrafts \|\| Object\.keys\(extrasDrafts\)\.length > 0/)
  assert.match(page, /addEventListener\('beforeunload', warn\)/)
  assert.match(page, /<ComposerAttachmentMenu[\s\S]*?disabled=\{sending\}/)
  // No message box at all where nothing can be sent.
  assert.match(page, /availability\.mode === 'notice' \?/)
})
