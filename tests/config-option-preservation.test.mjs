import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as schemaModel from '../console-ui/src/components/PluginConfigForm/schema-model.mjs'
import { numericFieldIssue } from '../console-ui/src/components/PluginConfigForm/numeric-validation.mjs'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/components/PluginConfigForm/SchemaFieldEditor.tsx', import.meta.url), 'utf8')
const module = { exports: {} }
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const mocks = {
  react: { useId: () => 'field-test' }, './schema-model.mjs': schemaModel, './numeric-validation.mjs': { numericFieldIssue },
  './ConversationScopeEditor': { ConversationScopeEditor: 'scope-editor' }, './conversation-scope-model.mjs': { isConversationScopeField: () => false },
  '../ui/input': { Input: 'input' }, '../ui/textarea': { Textarea: 'textarea' }, '../ui/button': { Button: 'button' }, '../ui/switch': { Switch: 'switch' },
  '../ui/select': { Select: 'select-root', SelectContent: 'select-content', SelectItem: 'option', SelectTrigger: 'select-trigger', SelectValue: 'select-value' },
  '../../pages/files/code-editor': { CodeEditor: 'code-editor' },
}
new Function('require', 'exports', 'module', code)(name => mocks[name] ?? require(name), module.exports, module)
const { SchemaFieldEditor } = module.exports
function elements(value) { return value && typeof value === 'object' ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)] : [] }
const field = { type: 'string', options: ['none', 'caldav', 'google', 'microsoft'].map(value => ({ label: value, value })) }
function render(value, extra = {}) {
  const changes = [], tree = SchemaFieldEditor({ name: 'provider', field, value, onChange: next => changes.push(next), ...extra })
  const select = elements(tree).find(item => item.type === 'select-root')
  return { tree, select, changes, html: renderToStaticMarkup(tree) }
}

test('production option editor retains unknown saved values without choosing the first option or writing on render', () => {
  for (const value of ['custom-backend', null, false, 0, { future: 'retain' }]) {
    const f = render(value)
    assert.equal(f.select.props.value, 'preserved'); assert.deepEqual(f.changes, [])
    assert.match(f.html, /当前保存值不在选项中/)
    assert.ok(elements(f.tree).some(item => item.type === 'option' && item.props.value === 'preserved' && item.props.disabled))
    for (const invalid of ['preserved', '', '-1', '01', '1.5', 'NaN', '99999999999999999999']) f.select.props.onValueChange(invalid)
    assert.deepEqual(f.changes, [])
    f.select.props.onValueChange('2'); assert.deepEqual(f.changes, ['google'])
  }
})

test('production option editor labels environment references without exposing or evaluating the source', () => {
  for (const value of ['${CALENDAR_PROVIDER}', '${CALENDAR_PROVIDER:-}', '${CALENDAR_PROVIDER:=caldav}']) {
    const f = render(value)
    assert.equal(f.select.props.value, 'preserved'); assert.deepEqual(f.changes, [])
    assert.match(f.html, /环境变量引用（原样保留）/); assert.match(f.html, /展开值未读取/)
    assert.ok(!f.html.includes(value))
  }
})

test('production option editor preserves actual choices and unset values without adding a selection', () => {
  assert.equal(render(undefined).select.props.value, '')
  const f = render('caldav'); assert.equal(f.select.props.value, '1'); assert.deepEqual(f.changes, [])
  assert.ok(!f.html.includes('当前保存值不在选项中'))
  f.select.props.onValueChange('0'); assert.deepEqual(f.changes, ['none'])
})

test('secret unknown option values stay hidden, and task fields do not claim environment expansion', () => {
  const secret = render('SECRET-EXISTING-VALUE', { field: { ...field, secret: true } })
  assert.ok(!secret.html.includes('SECRET-EXISTING-VALUE')); assert.match(secret.html, /未选择替换时会原样保留/)
  const literal = render('${LITERAL}', { allowEnvironmentReferences: false })
  assert.ok(!literal.html.includes('展开值未读取'))
})
