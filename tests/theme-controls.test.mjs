import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/components/UserMenu.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
// Function components in the tree are rendered so their output can be searched too.
const expand = node => {
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props))
  const children = node.props?.children
  return children === undefined ? node : { ...node, props: { ...node.props, children: [children].flat(Infinity).map(expand) } }
}
function fixture(locale = 'en') {
  const calls = [], state = { theme: 'light', mode: 'system' }, module = { exports: {} }
  const mocks = {
    'react-router-dom': { Link: 'Link' },
    'lucide-react': new Proxy({}, { get: (_target, key) => key }),
    '../i18n': { useI18n: () => ({ locale, setLocale: value => calls.push(['locale', value]), t: (message, values) => translate(locale, message, values) }) },
    '../i18n/locale.mjs': { isLocale: value => value === 'en' || value === 'zh-CN' },
    '../hooks/useTheme': { useTheme: () => ({ ...state, setMode: mode => { calls.push(['mode', mode]); state.mode = mode } }) },
    '@zhin.js/console-ui': Object.fromEntries(['DropdownMenu', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel', 'DropdownMenuRadioGroup', 'DropdownMenuRadioItem', 'DropdownMenuSeparator', 'DropdownMenuTrigger', 'IconButton'].map(name => [name, name])),
  }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports)
  return { calls, state, module: module.exports, render: () => expand(module.exports.UserMenu({ accountLabel: 'lc-cn', accountHref: '/account', onSignOut: () => calls.push(['signout']) })) }
}
test('display mode offers 浅色 / 深色 / 跟随系统 and nothing else: the soft-card palette is fixed', () => {
  const f = fixture(), tree = f.render()
  const group = nodes(tree).find(node => node.type === 'DropdownMenuRadioGroup' && node.props.value === 'system')
  assert.ok(group, 'the mode group shows the current mode')
  const items = nodes(group).filter(node => node.type === 'DropdownMenuRadioItem')
  assert.deepEqual(items.map(node => node.props.value), ['light', 'dark', 'system'])
  assert.deepEqual(items.map(node => nodes(node).filter(child => typeof child === 'string').join('') || node.props.children.filter(child => typeof child === 'string').join('')), ['Light', 'Dark', 'System'])
  assert.doesNotMatch(source, /palette|Palette|ThemeToggle|外观与配色/)
})
test('choosing 跟随系统 sets mode "system" (the runtime then writes data-theme="system")', () => {
  const f = fixture()
  nodes(f.render()).find(node => node.type === 'DropdownMenuRadioGroup' && node.props.value === 'system').props.onValueChange('dark')
  nodes(f.render()).find(node => node.type === 'DropdownMenuRadioGroup' && node.props.value === 'dark').props.onValueChange('system')
  assert.deepEqual(f.calls, [['mode', 'dark'], ['mode', 'system']])
})
test('the account button is a round icon button with the account initial and a labelled menu', () => {
  const f = fixture(), tree = f.render()
  const trigger = nodes(tree).find(node => node.type === 'IconButton')
  assert.equal(trigger.props['aria-label'], translate('en', '用户菜单：{0}', ['lc-cn']))
  assert.equal(f.module.accountInitial('lc-cn'), 'L')
  assert.equal(f.module.accountInitial('  小林'), '小')
  assert.equal(f.module.accountInitial(''), '?')
  const signOut = nodes(tree).find(node => node.type === 'DropdownMenuItem' && node.props.variant === 'danger')
  signOut.props.onSelect(); assert.deepEqual(f.calls, [['signout']])
})
