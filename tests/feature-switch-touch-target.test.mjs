// #64 `feature-switch-touch-target`: on phones the feature switches were 36×20px targets right next to the feature
// name link. The Console wraps every feature switch in a label hit area of at least 44×44px below 48rem; the shared
// Switch keeps its default size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const read = path => readFileSync(new URL(`../console-ui/src/pages/features/${path}`, import.meta.url), 'utf8')

test('every feature switch sits inside SwitchHitArea, a label that forwards taps to it', () => {
  const component = read('feature-switch.tsx')
  assert.match(component, /export function SwitchHitArea\(\{ children \}[^)]*\) \{\s*return <label className="console-feature-switch-hit"/)
  assert.match(component, /import '\.\/feature-level-panel\.css'/, 'the matrix and the global summary load the hit-area rule too')
  assert.match(component, /<SwitchHitArea>\s*<Switch\s+aria-label=\{label\}/)
  const panel = read('feature-level-panel.tsx')
  assert.match(panel, /<div className="console-feature-row-switch">\s*<SwitchHitArea>\s*<Switch aria-label=\{i18n\.t\('\{0\} · 启用'/)
  for (const source of [component, panel]) {
    for (const [, attributes] of source.matchAll(/<Switch\b([^>]*)\/>/g)) assert.doesNotMatch(attributes, /\b(?:h|w|size)-\d/, 'the shared switch keeps its default size')
  }
})

test('below 48rem the hit area is at least the 44px touch target; the row keeps ≥ 8px to the name link', () => {
  const css = postcss.parse(read('feature-level-panel.css'))
  const phone = css.nodes.filter(node => node.type === 'atrule' && node.name === 'media' && node.params === '(width < 48rem)')
  const hit = phone.flatMap(media => media.nodes).find(rule => rule.selector === '.console-feature-switch-hit')
  assert.ok(hit, 'a phone rule for the hit area')
  const decls = Object.fromEntries(hit.nodes.map(decl => [decl.prop, decl.value]))
  assert.equal(decls['min-width'], 'var(--console-touch-target)')
  assert.equal(decls['min-height'], 'var(--console-touch-target)')
  const base = css.nodes.find(node => node.type === 'rule' && node.selector === '.console-feature-switch-hit')
  assert.match(base.toString(), /align-items: center; justify-content: center/, 'the switch is centred in its hit area')
  const designSystem = readFileSync(new URL('../console-ui/src/design-system.css', import.meta.url), 'utf8')
  assert.match(designSystem, /--console-touch-target: 2\.75rem;/)
  // Column gap of the row head (name link | switch) is space-3 = 12px, above the 8px the issue asks for.
  const head = css.nodes.find(node => node.type === 'rule' && node.selector === '.console-feature-row-head')
  assert.match(head.toString(), /gap: var\(--console-space-2\) var\(--console-space-3\)/)
})
