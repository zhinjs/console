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

test('phone top bar shrinks its actions so 退出登录 stays inside the capsule at 360/390px', () => {
  const phone = mediaBlock(shell, '(width < 48rem)')
  const actions = rule(phone, '.console-topnav-actions')
  assert.match(actions, /--console-control-height:\s*2\.5rem/, 'icon buttons, the attention badge and the account link use 2.5rem')
  assert.match(actions, /--console-control-height-compact:\s*2\.5rem/)
  assert.match(actions, /min-width:\s*0/, 'the action row may not force the capsule wider than the screen')
  assert.match(rule(phone, '.console-topnav-actions .console-command-trigger'), /width:\s*2\.5rem;\s*height:\s*2\.5rem/)
  assert.match(rule(phone, '.console-topnav-capsule'), /gap:\s*var\(--console-space-1\)/)
  // The trigger's shared 44px min-height utility would otherwise keep it at 2.75rem.
  assert.match(commandCenter, /className="console-command-trigger max-md:min-h-0"/)
})

test('the language picker leaves the top bar below 40rem but stays reachable in the drawer', () => {
  assert.match(rule(mediaBlock(shell, '(width < 40rem)'), '.console-topnav-actions .console-language-select'), /display:\s*none/)
  assert.doesNotMatch(shell, /@media \(max-width: 380px\)/, 'the old 380px breakpoint left 390px phones overflowing')
  const footer = layout.slice(layout.indexOf('console-nav-drawer-footer'), layout.indexOf('</aside>'))
  assert.match(footer, /<LanguageSelect \/>/)
})
