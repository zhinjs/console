import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { THEME_PALETTES } from '../console-ui/src/theme/index.ts'
const root = new URL('../', import.meta.url)
const css = postcss.parse(readFileSync(new URL('console-ui/src/theme-tokens.css', root), 'utf8'))
function tokensFor(palette, dark) {
  const values = new Map()
  css.walkRules(rule => {
    if (!rule.selectors.some(selector => selector === ':root' || selector === `:root[data-palette="${palette}"]` || dark && selector === '.dark')) return
    rule.walkDecls(declaration => { if (declaration.prop.startsWith('--')) values.set(declaration.prop.slice(2), declaration.value) })
  })
  const resolve = (value, depth = 0) => {
    assert.ok(depth < 32, 'color variables must not cycle')
    return value.replace(/var\(--([\w-]+)\)/g, (_match, name) => { assert.ok(values.has(name), `missing ${name}`); return resolve(values.get(name), depth + 1) })
  }
  return new Proxy({}, { get(_target, name) { assert.ok(values.has(name), `missing ${name}`); const [h, s, l] = resolve(values.get(name)).split(/\s+/).map(parseFloat); assert.ok([h, s, l].every(Number.isFinite), `invalid HSL ${name}`); return { h, s, l } } })
}
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
const luminance = ({ h, s, l }) => {
  const chroma = (1 - Math.abs(2 * l / 100 - 1)) * s / 100, hue = h / 60, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = l / 100 - chroma / 2
  const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x]
  return channels.map(channel => linear(channel + m)).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
}
const ratio = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05) }
for (const palette of THEME_PALETTES) for (const dark of [false, true]) {
  test(`${palette.id}/${dark ? 'dark' : 'light'} preserves readable text and visible controls`, () => {
    const tokens = tokensFor(palette.id, dark)
    for (const [foreground, background] of [['foreground', 'background'], ['card-foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['primary-foreground', 'primary'], ['primary-action-foreground', 'primary-action'], ['primary', 'card'], ['sidebar-foreground', 'sidebar'], ['im-bubble-out-fg', 'im-bubble-out'], ['im-row-active-fg', 'im-row-active'], ['destructive-foreground', 'destructive'], ['success-foreground', 'success'], ['info-foreground', 'info'], ['warning-foreground', 'warning']]) {
      const contrast = ratio(tokens[foreground], tokens[background]); assert.ok(contrast >= 4.5, `${foreground}/${background}: ${contrast.toFixed(2)}`)
    }
    for (const [foreground, background] of [['input', 'card'], ['input', 'background'], ['ring', 'background'], ['destructive', 'background'], ['success', 'background'], ['info', 'background'], ['warning', 'background'], ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ['chart-' + n, 'background'])]) {
      const contrast = ratio(tokens[foreground], tokens[background]); assert.ok(contrast >= 3, `${foreground}/${background}: ${contrast.toFixed(2)}`)
    }
    assert.equal(tokens.background.s === 0, palette.id === 'graphite', 'only Graphite intentionally removes surface tint')
  })
}
test('surfaces stay neutral: a gray canvas carries white cards, and the palette hue tints only faintly', () => {
  for (const palette of THEME_PALETTES) for (const dark of [false, true]) {
    const tokens = tokensFor(palette.id, dark)
    assert.ok(tokens.background.s <= 16, `${palette.id}: canvas saturation ${tokens.background.s}`)
    if (!dark) {
      assert.equal(tokens.card.l, 100, 'cards are white in the light theme')
      assert.ok(tokens.background.l >= 94 && tokens.background.l <= 97, 'the canvas is a light gray, not white')
      assert.ok(tokens.secondary.l > tokens.background.l && tokens.secondary.l < tokens.card.l, 'grouped fills sit between canvas and card')
    } else {
      assert.ok(tokens.background.l < tokens.card.l && tokens.card.l < tokens.secondary.l, 'dark surfaces step up from canvas to card to grouped fill')
    }
  }
})
test('primary actions are a soft tint of the palette hue with hue-colored text; links keep the readable accent', () => {
  for (const palette of THEME_PALETTES) for (const dark of [false, true]) {
    const tokens = tokensFor(palette.id, dark)
    assert.deepEqual(tokens['primary-action-foreground'], tokens.primary, 'action text is the accent color')
    assert.equal(tokens['primary-action'].h, tokens.primary.h, 'the tint shares the accent hue')
    if (!dark) assert.ok(tokens['primary-action'].l >= 92, `${palette.id}: tint lightness ${tokens['primary-action'].l}`)
    else assert.ok(tokens['primary-action'].l <= 22, `${palette.id}: dark tint lightness ${tokens['primary-action'].l}`)
  }
  // The default palette is the blue accent.
  const ocean = tokensFor('ocean', false).primary
  assert.ok(ocean.h >= 205 && ocean.h <= 222 && ocean.s >= 70)
})
test('status semantics and chart category colors do not change with decorative palette selection', () => {
  for (const dark of [false, true]) for (const palette of THEME_PALETTES) {
    const current = tokensFor(palette.id, dark), reference = tokensFor('ocean', dark)
    for (const name of ['destructive', 'success', 'info', 'warning', ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => 'chart-' + n)]) assert.deepEqual(current[name], reference[name])
  }
})
test('primary buttons and the composer use action fills, while links and destructive controls keep their roles', () => {
  const button = readFileSync(new URL('console-ui/src/components/ui/button.tsx', root), 'utf8')
  const composer = readFileSync(new URL('console-ui/src/im-workspace.css', root), 'utf8')
  assert.ok(button.includes('bg-[hsl(var(--primary-action))]'))
  assert.ok(button.includes('text-[hsl(var(--primary-action-foreground))]'))
  assert.ok(button.includes('link: "text-primary'))
  assert.ok(button.includes('destructive: "bg-destructive'))
  assert.match(composer, /\.im-insert-button, \.im-send-button \{ background: hsl\(var\(--primary-action\)\); color: hsl\(var\(--primary-action-foreground\)\)/)
})
test('the Console entry stylesheet shares the design-system palette without remote font requests', () => {
  const design = readFileSync(new URL('console-ui/src/design-system.css', root), 'utf8')
  assert.match(design, /@import "\.\/theme-tokens\.css"/)
  for (const path of ['client/style.css']) {
    const entry = readFileSync(new URL(path, root), 'utf8'); assert.match(entry, /@import .*design-system\.css/); assert.doesNotMatch(entry, /--background:\s|fonts\.googleapis\.com/)
  }
})
