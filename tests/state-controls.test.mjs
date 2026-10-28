import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
async function load(name) {
  const source = await readFile(new URL(`../console-ui/src/components/ui/${name}.tsx`, import.meta.url), 'utf8')
  const module = { exports: {} }
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  new Function('require', 'exports', 'module', code)(
    name => name === '@zhin.js/client' ? { cn: (...values) => values.filter(Boolean).join(' ') } : require(name),
    module.exports, module,
  )
  return module.exports
}
const [{ Checkbox }, { RadioGroup, RadioGroupItem }, { Switch }] = await Promise.all([
  load('checkbox'), load('radio-group'), load('switch'),
])

test('state wrappers forward controlled/default values, refs, accessibility and callbacks directly to Radix', () => {
  for (const Control of [Checkbox, Switch]) {
    const changes = [], onCheckedChange = value => changes.push(value), ref = createRef()
    const element = Control.render({ checked: false, defaultChecked: true, onCheckedChange, disabled: true,
      name: 'preference', value: 'enabled', required: true, 'aria-describedby': 'control-help', 'aria-invalid': true,
    }, ref)
    assert.equal(element.props.checked, false)
    assert.equal(element.props.defaultChecked, true)
    assert.equal(element.props.ref, ref)
    assert.equal(element.props.onCheckedChange, onCheckedChange)
    assert.equal(element.props.name, 'preference')
    assert.equal(element.props.value, 'enabled')
    assert.equal(element.props.required, true)
    assert.equal(element.props.disabled, true)
    assert.equal(element.props['aria-describedby'], 'control-help')
    assert.equal(element.props['aria-invalid'], true)
    assert.deepEqual(changes, [])
    element.props.onCheckedChange(true)
    element.props.onCheckedChange(false)
    assert.deepEqual(changes, [true, false])
  }
  const ref = createRef(), onValueChange = () => {}
  const root = RadioGroup.render({ value: 'a', defaultValue: 'b', onValueChange, name: 'tier', required: true }, ref)
  assert.equal(root.props.value, 'a')
  assert.equal(root.props.defaultValue, 'b')
  assert.equal(root.props.onValueChange, onValueChange)
  assert.equal(root.props.name, 'tier')
  assert.equal(root.props.required, true)
  assert.equal(root.props.ref, ref)
  const item = RadioGroupItem.render({ value: 'a', disabled: true, 'aria-label': 'A' }, ref)
  assert.equal(item.props.value, 'a')
  assert.equal(item.props.disabled, true)
  assert.equal(item.props['aria-label'], 'A')
  assert.equal(item.props.ref, ref)
})

test('actual Radix checkbox exposes unchecked, checked and indeterminate states with a state-aware indicator', () => {
  const changes = []
  for (const [checked, state, aria] of [[false, 'unchecked', 'false'], [true, 'checked', 'true'], ['indeterminate', 'indeterminate', 'mixed']]) {
    const html = renderToStaticMarkup(createElement(Checkbox, {
      checked, onCheckedChange: value => changes.push(value), name: 'bulk', value: 'selected', 'aria-label': '批量选择',
    }))
    assert.match(html, /role="checkbox"/)
    assert.match(html, new RegExp(`aria-checked="${aria}"`))
    assert.match(html, new RegExp(`data-state="${state}"`))
    assert.match(html, /type="checkbox"[^>]*name="bulk"[^>]*value="selected"/)
    if (checked) {
      assert.match(html, /lucide-check/)
      assert.match(html, /lucide-minus/)
      assert.match(html, /group-data-\[state=checked\]\/indicator:block/)
      assert.match(html, /group-data-\[state=indeterminate\]\/indicator:block/)
    } else assert.doesNotMatch(html, /lucide-(check|minus)/)
  }
  assert.deepEqual(changes, [])
})

test('actual Radix radios and switches retain named form values, checked state and disabled semantics', () => {
  const changes = []
  const radio = renderToStaticMarkup(createElement(RadioGroup, {
    name: 'tier', value: 'a', required: true, onValueChange: value => changes.push(value),
  }, createElement(RadioGroupItem, { value: 'a', 'aria-label': 'A' }),
  createElement(RadioGroupItem, { value: 'b', disabled: true, 'aria-label': 'B' })))
  assert.match(radio, /role="radiogroup"/)
  assert.match(radio, /role="radio" aria-checked="true"/)
  assert.match(radio, /role="radio" aria-checked="false"[^>]*disabled=""/)
  assert.match(radio, /<input(?=[^>]*type="radio")(?=[^>]*name="tier")(?=[^>]*value="a")(?=[^>]*checked="")[^>]*>/)
  for (const checked of [false, true]) {
    const html = renderToStaticMarkup(createElement(Switch, {
      checked, onCheckedChange: value => changes.push(value), disabled: true,
      name: 'notifications', value: 'on', 'aria-label': '通知',
    }))
    assert.match(html, new RegExp(`role="switch" aria-checked="${checked}"`))
    assert.match(html, /disabled=""/)
    assert.match(html, /type="checkbox"[^>]*name="notifications"[^>]*value="on"/)
  }
  assert.deepEqual(changes, [])
})
