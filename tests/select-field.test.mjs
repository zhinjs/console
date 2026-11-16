import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// SelectField ships in @zhin.js/console-ui (ADR 0063 P1a); these checks hold the Console to the published build.
const { SelectField, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = await import('@zhin.js/console-ui')
const options = [
  { value: '', label: '全部' },
  { value: '\0', label: 'NUL' },
  { value: '""', label: '引号' },
  { value: 'ordinary', label: createElement('span', null, '正常选项') },
  { value: 'occupied', label: '不可用选项', disabled: true },
]
function fixture(value, extra = {}) {
  const changes = []
  const tree = SelectField.render({ value, options, onValueChange: next => changes.push(next), ...extra }, null)
  const [trigger, content] = tree.props.children
  return { tree, trigger, content, items: content.props.children, changes }
}

test('production SelectField round-trips real empty/NUL/string values through collision-free Radix items', () => {
  for (const option of options) {
    const f = fixture(option.value)
    assert.equal(f.tree.type, Select)
    assert.equal(f.trigger.type, SelectTrigger)
    assert.equal(f.trigger.props.children.type, SelectValue)
    assert.equal(f.content.type, SelectContent)
    assert.equal(f.tree.props.value, JSON.stringify(option.value))
    assert.equal(f.trigger.props.children.props.children, option.label)
    assert.deepEqual(f.changes, [])
    assert.equal(new Set(f.items.map(item => item.props.value)).size, options.length)
    for (const [index, item] of f.items.entries()) {
      assert.equal(item.type, SelectItem)
      assert.notEqual(item.props.value, '')
      assert.equal(JSON.parse(item.props.value), options[index].value)
      assert.equal(item.props.disabled, options[index].disabled)
    }
    for (const item of f.items.filter(item => !item.props.disabled)) f.tree.props.onValueChange(item.props.value)
    assert.deepEqual(f.changes, options.filter(item => !item.disabled).map(item => item.value))
  }
})

test('unknown values stay visible without a fabricated option or render-time change; reordering preserves callbacks', () => {
  const f = fixture('saved-outside-current-options')
  assert.equal(f.trigger.props.children.props.children, 'saved-outside-current-options')
  assert.ok(f.items.every(item => item.props.value !== f.tree.props.value))
  assert.deepEqual(f.changes, [])
  // Radix's internal native form control can report no match as ''; it is not the real empty option.
  f.tree.props.onValueChange('')
  f.tree.props.onValueChange('not-an-encoded-option')
  f.tree.props.onValueChange(JSON.stringify('saved-outside-current-options'))
  assert.deepEqual(f.changes, [])
  const reordered = fixture('\0', { options: [...options].reverse() })
  const emptyItem = f.items.find(item => JSON.parse(item.props.value) === '')
  reordered.tree.props.onValueChange(emptyItem.props.value)
  assert.deepEqual(reordered.changes, [''])
  assert.equal(reordered.trigger.props.children.props.children, 'NUL')
  assert.equal(fixture('blank', { options: [{ value: 'blank', label: null }] }).trigger.props.children.props.children, null)
})

test('actual Radix trigger renders the controlled label, disabled and ARIA contract without calling onValueChange', () => {
  const changes = []
  const html = renderToStaticMarkup(createElement(SelectField, {
    options, value: '', onValueChange: next => changes.push(next), disabled: true,
    id: 'provider-choice', 'aria-label': '选择供应商', 'aria-invalid': true,
    'aria-describedby': 'provider-error', title: '供应商', className: 'provider-control',
  }))
  assert.match(html, /role="combobox"/)
  assert.match(html, /id="provider-choice"/)
  assert.match(html, /aria-label="选择供应商"/)
  assert.match(html, /aria-invalid="true"/)
  assert.match(html, /aria-describedby="provider-error"/)
  assert.match(html, /title="供应商"/)
  assert.match(html, /class="[^"]*provider-control/)
  assert.match(html, /disabled=""/)
  assert.match(html, />全部</)
  assert.deepEqual(changes, [])
  const unknown = renderToStaticMarkup(createElement(SelectField, {
    options, value: '<saved-value>', onValueChange: next => changes.push(next),
  }))
  assert.match(unknown, /&lt;saved-value&gt;/)
  assert.deepEqual(changes, [])
})
