import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const source = readFileSync(new URL('../console-ui/src/components/UserMenu.tsx', import.meta.url), 'utf8')

test('the user menu holds the whole appearance setting: no separate appearance panel to race the menu', () => {
  // The old 「外观与配色…」 item opened a popover after the menu closed (onCloseAutoFocus) because opening
  // it from onSelect raced the menu's dismissal. console-ui 1.3.0 has one fixed palette, so the panel and
  // its race are gone: the three display modes are radio items of the menu itself.
  assert.equal(existsSync(new URL('../console-ui/src/components/ThemeToggle.tsx', import.meta.url)), false)
  assert.equal(existsSync(new URL('../console-ui/src/theme/appearance.css', import.meta.url)), false)
  assert.doesNotMatch(source, /setAppearanceOpen|openAppearanceAfterClose|Popover/u)
  assert.match(source, /<DropdownMenuRadioGroup value=\{mode\} onValueChange=\{value => setMode\(value as ThemeMode\)\}>/u)
})
