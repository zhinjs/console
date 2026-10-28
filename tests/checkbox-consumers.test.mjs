import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { defaultI18n } from './locale-fixture.mjs'
import { welcomeTargetKey } from '../console-ui/src/pages/welcome-use-case-model.mjs'

const require = createRequire(import.meta.url)
const component = { exports: {} }
const checkboxSource = await readFile(new URL('../console-ui/src/components/ui/checkbox.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(checkboxSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
new Function('require', 'exports', 'module', compiled)(name => name === '@zhin.js/client' ? { cn: (...classes) => classes.filter(Boolean).join(' ') } : require(name), component.exports, component)
const { Checkbox } = component.exports
const pages = new Map()
async function checkbox(file, state, bindings) {
  if (!pages.has(file)) {
    const source = await readFile(new URL(`../console-ui/src/pages/${file}.tsx`, import.meta.url), 'utf8')
    pages.set(file, ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
  }
  const ast = pages.get(file)
  let element
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'Checkbox'
      && node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'checked' && prop.initializer?.getText(ast) === `{${state}}`)) element = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(element, `${file}: ${state} uses shared Checkbox`)
  let label = element.parent
  while (label && !(ts.isJsxElement(label) && label.openingElement.tagName.getText(ast) === 'label')) label = label.parent
  assert.ok(label, `${file}: ${state} keeps an associated label`)
  const js = ts.transpileModule(`const result = ${element.getText(ast)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const original = new Function('require', 'exports', 'Checkbox', 'i18n', ...Object.keys(bindings), `${js}; return result;`)(require, {}, Checkbox, defaultI18n, ...Object.values(bindings))
  return Checkbox.render(original.props, null)
}

test('Workroom enable controls preserve read-only guards and exact draft transitions', async () => {
  const patches = [], value = {enabled: false, members: []}
  const project = await checkbox('workroom-catalog', 'value.enabled !== false', {value, readOnly: true, patch: patch => patches.push(patch)})
  assert.equal(project.props.checked, false)
  assert.equal(project.props.disabled, true)
  assert.deepEqual(patches, [])
  project.props.onCheckedChange(true)
  project.props.onCheckedChange('indeterminate')
  assert.deepEqual(patches, [{enabled: true}, {enabled: false}])
  const changes = [], binding = {adapter: 'qq', endpoint: 'bot', kind: 'group', id: 'room', agent: 'main'}
  const room = await checkbox('workroom-catalog', 'enabled', {enabled: true, value: binding, props: {readOnly: true, onChange: value => changes.push(value)}})
  assert.equal(room.props.disabled, true)
  assert.deepEqual(changes, [])
  room.props.onCheckedChange(false)
  room.props.onCheckedChange(true)
  assert.deepEqual(changes, [undefined, binding])
})

test('permission toggles invalidate the prior explanation before changing the hypothesis', async () => {
  for (const [state, setter] of [['hypothesis', 'setHypothesis'], ['includeTarget', 'setIncludeTarget']]) {
    const calls = []
    const control = await checkbox('command-permissions', state, {[state]: false, invalidateHypothesis: () => calls.push('invalidate'), [setter]: value => calls.push(value)})
    assert.deepEqual(calls, [])
    control.props.onCheckedChange(true)
    control.props.onCheckedChange('indeterminate')
    assert.deepEqual(calls, ['invalidate', true, 'invalidate', false])
  }
})

test('scenario consent and optional-identity toggles accept only boolean checked, without initial writes', async () => {
  for (const state of ['withName', 'withRoles', 'withFixture', 'withAssertions']) {
    const writes = [], setter = `set${state[0].toUpperCase()}${state.slice(1)}`
    const control = await checkbox('scenario-lab', state, {[state]: false, [setter]: value => writes.push(value)})
    assert.equal(control.props.checked, false)
    assert.deepEqual(writes, [])
    control.props.onCheckedChange(true)
    control.props.onCheckedChange(false)
    control.props.onCheckedChange('indeterminate')
    assert.deepEqual(writes, [true, false, false])
  }
})

test('human welcome observation remains blocked until evidence and a complete target exist', async () => {
  const target = {endpoint: {adapter: 'qq', id: 'bot'}, kind: 'group', id: 'room'}
  for (const [ready, value, disabled] of [[false, target, true], [true, {kind: 'group'}, true], [true, target, false]]) {
    const writes = []
    const control = await checkbox('welcome-use-case', 'observed', {observed: false, ready, target: value, welcomeTargetKey, setObserved: value => writes.push(value)})
    assert.equal(control.props.disabled, disabled)
    assert.deepEqual(writes, [])
    control.props.onCheckedChange(true)
    control.props.onCheckedChange('indeterminate')
    assert.deepEqual(writes, [true, false])
  }
})
