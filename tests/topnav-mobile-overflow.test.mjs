import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

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

test('phones: --zc-tabbar-reserve is declared on <html> as the TabBar’s whole extent, and every fixed or scroll consumer reads it', () => {
  const sources = {
    shell: postcss.parse(shell),
    toast: postcss.parse(read('console-ui/src/components/toast.css')),
    library: postcss.parse(read('node_modules/@zhin.js/console-ui/dist/styles.css')),
  }
  const declarations = []
  for (const [file, root] of Object.entries(sources)) root.walkDecls('--zc-tabbar-reserve', decl => declarations.push({ file, decl }))
  assert.equal(declarations.length, 1, 'one declaration, so nothing narrower shadows it')
  const [{ file, decl }] = declarations
  assert.equal(file, 'shell')
  // On <html>: the notice stack and the Toaster are siblings of the shell, and html's own
  // scroll-padding reads its own custom property — a declaration on .console-app-shell reaches neither.
  assert.equal(decl.parent.selector, 'html:has(.console-app-shell)')
  assert.equal(decl.parent.parent.type, 'atrule')
  assert.equal(`${decl.parent.parent.name} ${decl.parent.parent.params}`, 'media (width < 48rem)', 'only while the TabBar is shown')

  // The value is the library TabBar's height plus its floating offset from the bottom edge.
  const libraryDecl = (selector, prop) => {
    let value
    sources.library.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(prop, d => { value = d.value }) })
    assert.ok(value, `library ${selector} { ${prop} }`)
    return value
  }
  const height = libraryDecl('.console-tabbar', 'height')
  const bottom = libraryDecl('.console-tabbar[data-floating]', 'inset').match(/^\S+\s+\S+\s+(max\([^)]*\)\)|\S+)/)[1]
  assert.equal(decl.value, `calc(${height} + ${bottom})`)

  const reads = (root, selector, prop) => {
    let value
    root.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(prop, d => { value = d.value }) })
    return value ?? ''
  }
  assert.match(reads(sources.shell, 'html:has(.console-app-shell)', 'scroll-padding-bottom'), /var\(--zc-tabbar-reserve, 0px\)/, 'keyboard focus scrolls clear of the TabBar')
  assert.match(reads(sources.shell, '.console-main-scroll', 'padding-bottom'), /var\(--zc-tabbar-reserve, 0px\)/)
  assert.match(reads(sources.toast, '.console-notice-stack', 'bottom'), /var\(--zc-tabbar-reserve, 0px\)/, 'the Console notices stay above the TabBar')
  // The library Toaster sits 1.5rem above the edge (inset: auto 0 1.5rem 0); ours adds the reserves.
  assert.match(libraryDecl('.console-toaster', 'inset'), /^auto 0 1\.5rem 0$/)
  // Ours outranks the library's `.console-toaster { inset }` (the two stylesheets load in either order).
  assert.equal(reads(sources.toast, '.console-toaster[data-slot="toaster"]', 'bottom'), 'calc(1.5rem + var(--zc-log-panel-reserve, 0px) + var(--zc-tabbar-reserve, 0px))')
})
