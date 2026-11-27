import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const shell = read('console-ui/src/shell.css')
const layout = read('console-ui/src/layouts/dashboard.tsx')
const commandCenter = read('console-ui/src/components/ConsoleCommandCenter.tsx')

/** The body of the first `@media <query>` block, brace-matched. */
function mediaBlock(css, query) {
  const start = css.indexOf(`@media ${query}`)
  assert.ok(start >= 0, `missing @media ${query}`)
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++
    else if (css[index] === '}' && --depth === 0) return css.slice(start, index + 1)
  }
  throw new Error('unbalanced media block')
}

const rule = (block, selector) => {
  const match = block.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

test('phone top bar: brand and round 44px actions in one row; the sections move to the TabBar', () => {
  const phone = mediaBlock(shell, '(width < 48rem)')
  // At 360/390px: the mark (40) and five round actions (44, the touch target) fit one unwrapped row.
  assert.match(rule(phone, '.console-topnav-bar'), /flex-wrap:\s*nowrap/)
  const actions = rule(phone, '.console-topnav-actions')
  assert.match(actions, /min-width:\s*0/, 'the action row may not force the bar wider than the screen')
  assert.match(actions, /gap:\s*var\(--console-space-1\)/)
  assert.match(rule(shell, '.console-topnav-actions .console-command-trigger,\n  .console-topnav-actions .console-log-panel-trigger'), /width:\s*var\(--console-size-icon-button\);\s*height:\s*var\(--console-size-icon-button\)/)
  assert.match(layout, /\{compact \? null : barNavigation\}/, 'no section icons in the phone top bar')
  assert.match(layout, /<TabBar floating aria-label=\{i18n\.t\("主导航"\)\}/)
  assert.match(phone, /--zc-tabbar-reserve:/, 'the page keeps its last rows above the floating tab bar')
  assert.match(commandCenter, /className="console-command-trigger max-md:min-h-0"/)
})

test('the language picker is not in the top bar; it stays reachable in the drawer and the account menu', () => {
  assert.doesNotMatch(layout.slice(layout.indexOf('<header'), layout.indexOf('</header>')), /LanguageSelect/)
  assert.doesNotMatch(shell, /@media \(max-width: 380px\)/, 'the old 380px breakpoint left 390px phones overflowing')
  const footer = layout.slice(layout.indexOf('console-nav-drawer-footer'), layout.indexOf('</aside>'))
  assert.match(footer, /<LanguageSelect \/>/)
  assert.match(read('console-ui/src/components/UserMenu.tsx'), /界面语言/)
})
