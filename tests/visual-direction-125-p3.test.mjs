// console#125 phase 3 (fonts, inline code, surfaces, motion, focus, icons, empty copy), Console source only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SAVED_HOLD_MS, saveButtonPhase } from '../console-ui/src/components/save-feedback-model.mjs'
import { pluginIconType, pluginType } from '../console-ui/src/pages/plugin-list-model.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = path => readFileSync(join(root, path), 'utf8')
function walk(dir, ext, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) walk(path, ext, out)
    else if (name.endsWith(ext)) out.push(path)
  }
  return out
}
const consoleCss = () => [...walk('console-ui/src', '.css'), ...walk('client', '.css')].map(path => ({ path, css: read(path).replace(/\/\*[\s\S]*?\*\//g, '') }))

test('Inter and JetBrains Mono are self-hosted (Latin subset, swap) and the stacks name exactly those families', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.devDependencies['@fontsource-variable/inter'], /^~\d+\.\d+\.\d+$/)
  assert.match(pkg.devDependencies['@fontsource-variable/jetbrains-mono'], /^~\d+\.\d+\.\d+$/)
  const fonts = read('console-ui/src/fonts.css')
  const faces = [...fonts.matchAll(/@font-face \{([^}]*)\}/g)].map(match => match[1])
  assert.equal(faces.length, 2)
  for (const face of faces) {
    assert.match(face, /font-display: swap;/)
    assert.match(face, /-latin-wght-normal\.woff2'\) format\('woff2'\)/, 'only the Latin subset, variable weight')
    assert.match(face, /unicode-range: U\+0000-00FF/)
  }
  const families = faces.map(face => /font-family: '([^']+)'/.exec(face)[1])
  assert.deepEqual(families, ['Inter', 'JetBrains Mono'])
  // The stacks are the library's tokens (console-ui 1.3.0); the Console loads the fonts and does not redefine them.
  const tokens = read('node_modules/@zhin.js/console-ui/dist/tokens.css')
  assert.match(tokens, /--console-font-sans: 'Inter', /)
  assert.match(tokens, /--console-font-mono: 'JetBrains Mono', /)
  assert.doesNotMatch(read('console-ui/src/design-system.css'), /--console-font-(sans|mono):/)
  assert.match(read('client/main.tsx'), /import "\.\.\/console-ui\/src\/fonts\.css";/)
  assert.match(read('client/style.css'), /--font-mono: var\(--console-font-mono\);/, 'Tailwind font-mono follows the Console stack')
  for (const { path, css } of consoleCss()) {
    if (path.endsWith('design-system.css')) continue
    assert.doesNotMatch(css, /font-family:[^;]*(ui-monospace|SFMono-Regular|Geist Mono)/, `${path} uses var(--console-font-mono)`)
  }
})

test('short identifiers use the library InlineCode (console-ui 1.1): one .console-code, no local copy', () => {
  // The Console no longer redefines .console-code over the component library's rule.
  assert.doesNotMatch(read('console-ui/src/design-system.css'), /\.console-code \{/)
  const library = readFileSync(new URL('../node_modules/@zhin.js/console-ui/dist/styles.css', import.meta.url), 'utf8')
  const rule = /\.console-code \{([^}]*)\}/.exec(library)[1]
  assert.match(rule, /font-family: var\(--console-font-mono\);/)
  assert.doesNotMatch(rule, /border:/)
  const detail = read('console-ui/src/pages/plugin-detail.tsx')
  assert.doesNotMatch(detail, /<Badge [^>]*className="font-mono"/, 'permission names are not boxed badges')
  assert.match(detail, /<InlineCode title=\{item\.description\}>\{item\.permission\}<\/InlineCode>/)
  assert.match(read('console-ui/src/pages/access/audit.tsx'), /<InlineCode>\{entry\.action\}<\/InlineCode>/)
  for (const file of ['plugin-detail.tsx', 'access/audit.tsx', 'marketplace.tsx', 'ops/plugin-declare.tsx', 'introspection/CapabilityExplorer.tsx', 'attention/AttentionMore.tsx']) {
    assert.doesNotMatch(read(`console-ui/src/pages/${file}`), /<code className="console-code/, file)
  }
  assert.doesNotMatch(read('console-ui/src/pages/introspection/CapabilityExplorer.tsx'), /<Badge [^>]*className="font-mono"/)
  assert.doesNotMatch(read('console-ui/src/pages/plugins.css'), /\.console-plugin-detail-identity > code \{[^}]*background/)
})

test('two surface levels: the model list sits in one panel, and panels hold hairlines instead of grey blocks', () => {
  const profiles = read('console-ui/src/pages/inference/Profiles.tsx')
  assert.match(profiles, /<Card className="console-profile-list overflow-hidden">/)
  assert.doesNotMatch(profiles, /divide-y rounded-lg border/)
  for (const file of ['Accounts', 'Services', 'PersonalSessions']) assert.doesNotMatch(read(`console-ui/src/pages/inference/${file}.tsx`), /divide-y rounded-lg border/, file)
  const detail = read('console-ui/src/pages/plugin-detail.tsx')
  const capabilities = detail.slice(detail.indexOf('i18n.t("能力清单")'))
  assert.match(capabilities, /<ul className="max-h-48 divide-y divide-border/)
  assert.doesNotMatch(capabilities, /rounded-md bg-muted\/50/)
})

test('motion has three durations on one curve; no CSS hard-codes a transition or animation time', () => {
  // The durations and curves are the library's (console-ui 1.3.0: fast 120 / base 200 / slow 280 / exit 180).
  const library = read('node_modules/@zhin.js/console-ui/dist/tokens.css')
  for (const [name, value] of [['fast', '120ms'], ['base', '200ms'], ['slow', '280ms'], ['exit', '180ms']]) assert.match(library, new RegExp(`--console-motion-${name}: ${value};`))
  const tokens = read('console-ui/src/design-system.css')
  assert.doesNotMatch(tokens, /--console-motion-(fast|base|slow):/, 'not redefined by the Console')
  // Reduced motion turns every remaining Console transition and animation off.
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{\s*animation-duration: 0\.01ms !important;[\s\S]*?transition-duration: 0\.01ms !important;/)
  assert.match(tokens, /--console-duration-fast: var\(--console-motion-fast\);/)
  const literal = /(?<![\w-])(transition|animation)(-duration|-delay)?\s*:([^;{}]*)/g
  const offenders = []
  for (const { path, css } of consoleCss()) {
    for (const match of css.matchAll(literal)) {
      const value = match[3]
      if (/0\.01ms\s*!important/.test(value)) continue // the prefers-reduced-motion: reduce reset
      if (/(?<![\w.(-])\d*\.?\d+m?s\b/.test(value)) offenders.push(`${relative(root, join(root, path))}: ${match[0].trim()}`)
      else if (/(?<![\w-])(ease|ease-in|ease-out|ease-in-out|cubic-bezier\([^)]*\))(?![\w-])/.test(value) && !/infinite/.test(value)) offenders.push(`${path}: ${match[0].trim()} (curve)`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('toasts rise 8px and fade in, fade out on exit, and only when motion is allowed', () => {
  const css = read('console-ui/src/components/toast.css')
  const allowed = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n  \}/.exec(css)[1]
  // The Console's own notices are `.console-notice` (the library's `.console-toast` is the one-line pill).
  assert.match(allowed, /\.console-notice \{ animation: console-notice-in var\(--console-motion-base\) var\(--console-ease-out\) both; \}/)
  assert.match(allowed, /\.console-notice\[data-state="closing"\] \{ animation: console-notice-out var\(--console-motion-exit\)/)
  assert.match(css, /@keyframes console-notice-in \{\s*from \{ opacity: 0; transform: translate3d\(0, 8px, 0\); \}/)
  const toast = read('console-ui/src/components/toast.tsx')
  assert.match(toast, /data-state=\{closing\.has\(notification\.id\) \? 'closing' : 'open'\}/)
  assert.match(toast, /getPropertyValue\('--console-motion-exit'\)/, 'the exit waits exactly the token')
  assert.match(toast, /prefers-reduced-motion: reduce\)'\)\.matches\) return 0/, 'and not at all when motion is reduced')
})

test('save feedback stays on the button: 保存中… → 已保存 for 1.5 s → the label', () => {
  assert.equal(SAVED_HOLD_MS, 1500)
  assert.equal(saveButtonPhase({ saving: true, saved: true }), 'saving')
  assert.equal(saveButtonPhase({ saving: false, saved: true }), 'saved')
  assert.equal(saveButtonPhase({ saving: false, saved: false }), 'idle')
  assert.match(read('console-ui/src/pages/inference/Purposes.tsx'), /<SaveButton type="submit"/)
  assert.match(read('console-ui/src/components/PluginConfigForm/index.tsx'), /if \(reread && !mismatch\) saveFeedback\.markSaved\(\)/)
  const button = read('console-ui/src/components/SaveButton.tsx')
  assert.match(button, /i18n\.t\('保存中…'\)/)
  assert.match(button, /i18n\.t\('已保存'\)/)
})

test('focus rings appear on :focus-visible only', () => {
  for (const { path, css } of consoleCss()) {
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1], body = match[2]
      if (!/outline:\s*var\(--console-focus-width\)|--ring\)\)?;?\s*$/m.test(body) || !/outline:\s*var\(--console-focus-width\)/.test(body)) continue
      assert.match(selector, /:focus-visible|:has\(:focus-visible\)|:focus-within|\.console-skip-link/, `${path}: ${selector.trim()}`)
    }
  }
  assert.doesNotMatch(read('console-ui/src/shell.css'), /\.console-language-select:focus-within/)
})

test('icons: one stroke, 18px in navigation, no tiles in lists or ⌘K, and the plugin row icon tells the type', () => {
  assert.match(read('console-ui/src/design-system.css'), /svg\.lucide \{ stroke-width: 1\.75; \}/)
  const shell = read('console-ui/src/shell.css')
  assert.match(shell, /\.console-nav-icon svg \{\s*width: 1\.125rem;/)
  // Top-bar sections are the library's NavPill / NavIcon (20px icons, console-ui 1.3.0); no menu tiles any more.
  assert.doesNotMatch(shell, /console-topnav-menu-icon/)
  assert.doesNotMatch(read('console-ui/src/layouts/workspace-navigation.css'), /console-topnav-menu/, 'no rules left for the removed top-bar menus')
  const command = /\.console-command-icon \{([^}]*)\}/.exec(read('console-ui/src/design-system.css'))[1]
  assert.doesNotMatch(command, /background/)
  assert.doesNotMatch(/\.console-plugin-catalog-icon \{([^}]*)\}/.exec(read('console-ui/src/pages/plugins.css'))[1], /background/)
  // @zhin.js/adapter-sandbox 1.2.0 styles its own playground: the Console keeps no agent-playground.css.
  assert.equal(existsSync(new URL('../console-ui/src/agent-playground.css', import.meta.url)), false)
  assert.equal(pluginIconType({ kind: 'plugin', name: 'adapter-qq', packageName: '@zhin.js/adapter-qq' }), 'adapter')
  assert.equal(pluginIconType({ kind: 'package', name: 'x', packageName: 'x', catalog: 'ai' }), 'ai')
  assert.equal(pluginIconType({ kind: 'plugin', name: 'welcome', packageName: '@zhin.js/plugin-welcome' }), 'feature')
  const unknown = { kind: 'package', name: 'zhin-thing', packageName: 'zhin-thing' }
  assert.equal(pluginType(unknown), 'feature', 'the 类型 column still says 功能插件')
  assert.equal(pluginIconType(unknown), null, 'but no icon is drawn for a guess')
  const page = read('console-ui/src/pages/plugins.tsx')
  assert.match(page, /\{TypeIcon \? <TypeIcon \/> : null\}/)
})

test('no lone 暂无数据: empty copy says what is missing', () => {
  const offenders = walk('console-ui/src', '.tsx').concat(walk('console-ui/src', '.mjs')).filter(path => !path.includes('/i18n/') && read(path).includes('暂无数据'))
  assert.deepEqual(offenders, [])
})
