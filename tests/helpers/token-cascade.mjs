/**
 * The color tokens as the browser resolves them: the component library's tokens.css first
 * (@zhin.js/console-ui/styles.css is imported before the Console's stylesheet), then the Console's
 * theme-tokens.css, which redefines the older names as aliases of the library's roles. Only the
 * top-level `:root`, `:root[data-palette]` and `.dark` rules count (no @media / @container blocks).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

const root = new URL('../../', import.meta.url)
const sheets = ['node_modules/@zhin.js/console-ui/dist/tokens.css', 'console-ui/src/theme-tokens.css']
  .map(path => postcss.parse(readFileSync(new URL(path, root), 'utf8')))

const topLevel = rule => { for (let node = rule.parent; node; node = node.parent) if (node.type === 'atrule' && node.name !== 'layer') return false; return true }

/** name → raw value, for one palette and theme. */
export function tokenValues(palette, dark) {
  const values = new Map()
  for (const css of sheets) css.walkRules(rule => {
    if (!topLevel(rule)) return
    if (!rule.selectors.some(selector => selector === ':root' || selector === `:root[data-palette="${palette}"]` || dark && selector === '.dark')) return
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
export function hslTokens(palette, dark) {
  const values = tokenValues(palette, dark)
  return new Proxy({}, { get(_target, name) {
    const [h, s, l] = resolveToken(values, name).split(/\s+/).map(parseFloat)
    assert.ok([h, s, l].every(Number.isFinite), `invalid HSL ${name}`)
    return { h, s, l }
  } })
}
