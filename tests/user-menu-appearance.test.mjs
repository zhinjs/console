import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../console-ui/src/components/UserMenu.tsx', import.meta.url), 'utf8')

test('the appearance panel opens after the user menu has closed, not from a timer in onSelect', () => {
  // Opening it from onSelect (even via setTimeout) raced the menu's dismissal: a slow mouse press
  // closed the panel as soon as it appeared ("点了闪一下就没结果").
  assert.ok(!/setTimeout\(\s*\(\)\s*=>\s*setAppearanceOpen/u.test(source))
  assert.match(source, /onCloseAutoFocus=\{event => \{[\s\S]*?openAppearanceAfterClose\.current[\s\S]*?event\.preventDefault\(\)[\s\S]*?setAppearanceOpen\(true\)/u)
  assert.match(source, /onSelect=\{\(\) => \{ openAppearanceAfterClose\.current = true \}\}/u)
})
