/**
 * The color tokens as the browser resolves them: the component library's tokens.css first
 * (@zhin.js/console-ui/styles.css is imported before the Console's stylesheet), then the Console's
 * theme-tokens.css, which only adds a few older names pointing at library roles (console-ui 1.3.0
 * 「柔光卡片」: no palette, no `data-palette`). Only top-level rules count (no @media / @container),
 * selected by theme: light reads every rule whose selector list has `:root`; dark adds the rules
 * whose selector list has `.dark`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const root = new URL('../../', import.meta.url)
const sheets = ['node_modules/@zhin.js/console-ui/dist/tokens.css', 'console-ui/src/theme-tokens.css']
  .map(path => postcss.parse(readFileSync(new URL(path, root), 'utf8')))

const topLevel = rule => { for (let node = rule.parent; node; node = node.parent) if (node.type === 'atrule' && node.name !== 'layer') return false; return true }

/** name → raw value, for one theme. */
export function tokenValues(dark) {
  const values = new Map()
  for (const css of sheets) css.walkRules(rule => {
    if (!topLevel(rule)) return
    const selectors = rule.selectors
    const light = selectors.includes(':root')
    // The theme roots list (`:root, .light, .dark, …`) is the light base; a `.dark` rule without `:root` is the dark tier.
    if (!(light || dark && selectors.includes('.dark'))) return
    rule.walkDecls(declaration => { if (declaration.prop.startsWith('--')) values.set(declaration.prop.slice(2), declaration.value) })
  })
  return values
}

/** The `h s% l%` triple a token resolves to (var() chains followed). */
export function resolveToken(values, name) {
  const resolve = (value, depth = 0) => {
    assert.ok(depth < 32, 'color variables must not cycle')
    return value.replace(/var\(--([\w-]+)\)/g, (_match, next) => { assert.ok(values.has(next), `missing ${next}`); return resolve(values.get(next), depth + 1) })
  }
  assert.ok(values.has(name), `missing ${name}`)
  return resolve(values.get(name))
}

/** Proxy of `{ h, s, l }` numbers, one per token name. */
export function hslTokens(dark) {
  const values = tokenValues(dark)
  return new Proxy({}, { get(_target, name) {
    const [h, s, l] = resolveToken(values, name).split(/\s+/).map(parseFloat)
    assert.ok([h, s, l].every(Number.isFinite), `invalid HSL ${name}`)
    return { h, s, l }
  } })
}

/** WCAG contrast of two `{ h, s, l }` colors. */
export function contrast(a, b) {
  const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  const luminance = ({ h, s, l }) => {
    const chroma = (1 - Math.abs(2 * l / 100 - 1)) * s / 100, hue = h / 60, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = l / 100 - chroma / 2
    const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x]
    return channels.map(channel => linear(channel + m)).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  }
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05)
}
