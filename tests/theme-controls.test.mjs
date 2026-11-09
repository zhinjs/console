import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { THEME_PALETTES } from '../console-ui/src/theme/index.ts'
import { translate } from '../console-ui/src/i18n/locale.mjs'
const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/components/ThemeToggle.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
function fixture() {
  const calls = [], state = { theme: 'light', mode: 'system', palette: 'forest' }, module = { exports: {} }
  const mocks = {
    react: { useId: () => 'appearance-test' },
    'lucide-react': new Proxy({}, { get: (_target, key) => key }),
    '../i18n': { useI18n: () => ({ t: (message, values) => translate('en', message, values) }) },
    '../theme': { THEME_PALETTES },
    '../hooks/useTheme': { useTheme: () => ({ ...state, setMode: mode => { calls.push(['mode', mode]); state.mode = mode; if (mode !== 'system') state.theme = mode }, setPalette: palette => { calls.push(['palette', palette]); state.palette = palette }, resetTheme: () => { calls.push(['reset']); state.mode = 'system'; state.palette = 'forest' } }) },
    './ui/popover': Object.fromEntries(['Popover', 'PopoverTrigger', 'PopoverContent'].map(name => [name, name])),
  }
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module, module.exports)
  return { calls, state, render: () => module.exports.ThemeToggle() }
}
test('appearance panel exposes independent native radio groups with named palettes and modes', () => {
  const f = fixture(), tree = f.render(), radios = nodes(tree).filter(node => node.type === 'input')
  assert.equal(radios.length, 7); assert.ok(radios.every(node => node.props.type === 'radio'))
  assert.deepEqual(radios.filter(node => node.props.checked).map(node => node.props.value), ['system', 'forest'])
  assert.equal(new Set(radios.map(node => node.props.name)).size, 2)
  assert.equal(nodes(tree).find(node => node.props?.['aria-label'] === translate('en', '切换主题')).type, 'button')
  assert.equal(nodes(tree).find(node => node.type === 'PopoverContent').props['aria-labelledby'], 'appearance-test-title')
  for (const palette of THEME_PALETTES) assert.notEqual(translate('en', palette.label), palette.label)
})
test('selecting a palette does not replace System mode; switching mode retains palette; Reset restores both', () => {
  const f = fixture()
  nodes(f.render()).find(node => node.type === 'input' && node.props.value === 'plum').props.onChange()
  assert.equal(f.state.mode, 'system'); assert.equal(f.state.palette, 'plum')
  nodes(f.render()).find(node => node.type === 'input' && node.props.value === 'dark').props.onChange()
  assert.equal(f.state.mode, 'dark'); assert.equal(f.state.palette, 'plum')
  nodes(f.render()).find(node => node.type === 'button' && node.props.onClick).props.onClick()
  assert.equal(f.state.mode, 'system'); assert.equal(f.state.palette, 'forest')
  assert.deepEqual(f.calls, [['palette', 'plum'], ['mode', 'dark'], ['reset']])
})
