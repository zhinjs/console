import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultI18n } from './locale-fixture.mjs'
import { BEHAVIOR_CHOICES } from '../console-ui/src/pages/ambient-engagement-model.mjs'
import { MODE_CHOICES } from '../console-ui/src/pages/skills-assistant-model.mjs'

const require = createRequire(import.meta.url)
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
const module = { exports: {} }
const shared = await readFile(new URL('../console-ui/src/components/ui/radio-group.tsx', import.meta.url), 'utf8')
new Function('require', 'exports', 'module', ts.transpileModule(shared, { compilerOptions }).outputText)(name => name === '@zhin.js/client' ? { cn: (...classes) => classes.filter(Boolean).join(' ') } : require(name), module.exports, module)
const { RadioGroup, RadioGroupItem } = module.exports

async function page(file) {
  const source = await readFile(new URL(`../console-ui/src/pages/${file}.tsx`, import.meta.url), 'utf8')
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function evaluate(source, bindings) {
  const code = ts.transpileModule(`const result = ${source};`, { compilerOptions }).outputText
  return new Function('require', 'exports', 'RadioGroup', 'RadioGroupItem', 'i18n', ...Object.keys(bindings), `${code}; return result;`)(require, {}, RadioGroup, RadioGroupItem, defaultI18n, ...Object.values(bindings))
}
function group(ast, name, bindings) {
  let element
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'RadioGroup'
      && node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'name' && prop.initializer?.getText(ast).includes(name))) element = node
    ts.forEachChild(node, visit)
  }
  visit(ast); assert.ok(element, name)
  return evaluate(element.getText(ast), bindings)
}

test('ambient radio groups retain their values and group identity and change only the original drafts', async () => {
  const ast = await page('ambient-engagement')
  let behavior = 'watch', groupScope = 'some'
  const behaviorGroup = group(ast, 'ambient-behavior', { BEHAVIOR_CHOICES, behavior, setBehavior: value => { behavior = value } })
  const actual = RadioGroup.render(behaviorGroup.props, null)
  assert.equal(actual.props.name, 'ambient-behavior'); assert.equal(actual.props.value, 'watch')
  assert.equal(actual.props['aria-label'], '机器人要不要自己接话？')
  const html = renderToStaticMarkup(behaviorGroup)
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3)
  assert.match(html, /value="watch"[^>]*data-state="checked"|data-state="checked"[^>]*value="watch"/)
  actual.props.onValueChange('join'); assert.equal(behavior, 'join'); assert.equal(groupScope, 'some')
  const scopeGroup = group(ast, 'ambient-group-scope', { groupScope, setGroupScope: value => { groupScope = value } })
  const scopeRoot = RadioGroup.render(scopeGroup.props, null)
  assert.equal(scopeRoot.props.name, 'ambient-group-scope'); assert.equal(scopeRoot.props.value, 'some')
  assert.equal(scopeRoot.props['aria-label'], '在哪些群里？')
  scopeRoot.props.onValueChange('all'); assert.equal(groupScope, 'all'); assert.equal(behavior, 'join')
})

test('assistant radio callback updates one task mode and clears the existing server problems without touching siblings', async () => {
  const ast = await page('skills-assistant')
  let chooseModeNode
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'chooseMode') chooseModeNode = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(ast); assert.ok(chooseModeNode)
  let modes = { skills: 'off', tools: 'active', memory: 'shadow', agents: 'off', approval: 'off', ambient: 'off' }, serverProblems = ['old error']
  const chooseMode = evaluate(chooseModeNode.getText(ast), { setModes: update => { modes = update(modes) }, setServerProblems: value => { serverProblems = value } })
  const modeGroup = group(ast, 'skills-mode-', { entry: { task: 'skills', label: '为机器人选择技能' }, modes, MODE_CHOICES, chooseMode })
  const actual = RadioGroup.render(modeGroup.props, null)
  assert.equal(actual.props.name, 'skills-mode-skills'); assert.equal(actual.props.value, 'off')
  assert.equal(actual.props['aria-label'], '为机器人选择技能')
  assert.equal((renderToStaticMarkup(modeGroup).match(/role="radio"/g) ?? []).length, 3)
  actual.props.onValueChange('shadow')
  assert.deepEqual(modes, { skills: 'shadow', tools: 'active', memory: 'shadow', agents: 'off', approval: 'off', ambient: 'off' })
  assert.deepEqual(serverProblems, [])
})
