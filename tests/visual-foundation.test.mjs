import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hslTokens, resolveToken, tokenValues } from './helpers/token-cascade.mjs'
import { THEME_PALETTES } from '../console-ui/src/theme/index.ts'
const root = new URL('../', import.meta.url)
const tokensFor = (palette, dark) => hslTokens(palette, dark)
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
    for (const [foreground, background] of [['foreground', 'background'], ['card-foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'secondary'], ['muted-foreground', 'muted'], ['primary-foreground', 'primary'], ['primary-action-foreground', 'primary-action'], ['primary', 'card'], ['sidebar-foreground', 'sidebar'], ['im-bubble-out-fg', 'im-bubble-out'], ['im-row-active-fg', 'im-row-active'], ['destructive-foreground', 'destructive'], ['success-foreground', 'success'], ['info-foreground', 'info'], ['warning-foreground', 'warning']]) {
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
  const button = readFileSync(new URL('node_modules/@zhin.js/console-ui/dist/components/ui/button.js', root), 'utf8')
  const composer = readFileSync(new URL('console-ui/src/im-workspace.css', root), 'utf8')
  // console-ui 1.1: `soft` (the former `default`) is the palette tint, `primary` the solid brand fill,
  // `destructive` a ghost, and only `destructive-solid` is filled red.
  assert.match(button, /const SOFT = "[^"]*bg-primary-action text-primary-action-foreground/)
  assert.match(button, /primary: "[^"]*bg-brand text-brand-foreground/)
  assert.ok(button.includes('link: "text-brand-text'))
  assert.ok(button.includes('destructive: "text-destructive'))
  assert.ok(button.includes('"destructive-solid": "bg-destructive'))
  assert.match(composer, /\.im-insert-button, \.im-send-button \{ background: hsl\(var\(--primary-action\)\); color: hsl\(var\(--primary-action-foreground\)\)/)
})
test('the Console entry stylesheet shares the design-system palette without remote font requests', () => {
  const design = readFileSync(new URL('console-ui/src/design-system.css', root), 'utf8')
  assert.match(design, /@import "\.\/theme-tokens\.css"/)
  for (const path of ['client/style.css']) {
    const entry = readFileSync(new URL(path, root), 'utf8'); assert.match(entry, /@import .*design-system\.css/); assert.doesNotMatch(entry, /--background:\s|fonts\.googleapis\.com/)
  }
})
test('Zhin green is the default palette: light text is the brand hue darkened to 4.5:1, dark uses #7FFFD4 with dark text on it (console#125)', () => {
  const light = tokensFor('zhin', false), dark = tokensFor('zhin', true)
  assert.ok(Math.abs(light.primary.h - 160) <= 1 && Math.abs(dark.primary.h - 160) <= 1, 'one hue in both themes')
  assert.deepEqual(dark.primary, { h: 159.8, s: 100, l: 74.9 }, 'dark primary is #7FFFD4')
  for (const surface of ['card', 'background']) assert.ok(ratio(light.primary, light[surface]) >= 4.5, `light primary on ${surface}`)
  assert.ok(ratio(dark['primary-foreground'], dark.primary) >= 4.5, 'fills of the bright brand color carry dark text')
  assert.ok(dark['primary-foreground'].l < 20)
})
test('the brand mark colors are #76EEC6 / #7FFFD4 with a near-black Z, in every palette (console#125)', () => {
  for (const palette of THEME_PALETTES) for (const dark of [false, true]) {
    const tokens = tokensFor(palette.id, dark)
    // The component library's brand role (console-ui 1.1), never redefined by a palette.
    assert.deepEqual(tokens['console-brand'], dark ? { h: 159.8, s: 100, l: 74.9 } : { h: 160, s: 78, l: 69.8 })
    assert.ok(ratio(tokens['console-brand-foreground'], tokens['console-brand']) >= 7, `${palette.id}: the Z reads on the mark`)
  }
})
test('each status has a text value and a fill value sharing one hue across themes; warning fill is amber (console#125)', () => {
  const light = tokensFor('zhin', false), dark = tokensFor('zhin', true)
  for (const name of ['success', 'warning', 'info', 'destructive']) {
    const hues = [light[name], light[`${name}-fill`], dark[name], dark[`${name}-fill`]].map(value => value.h)
    assert.ok(Math.max(...hues) - Math.min(...hues) <= 6, `${name} hues ${hues}`)
    for (const surface of ['card', 'background']) assert.ok(ratio(light[name], light[surface]) >= 4.5, `${name} text on ${surface}`)
  }
  assert.ok(light['warning-fill'].l >= 45 && light['warning-fill'].s >= 85, 'a bright amber, not brown')
  assert.ok(ratio(light['warning-fill-foreground'], light['warning-fill']) >= 4.5)
})

test('the library accent roles stay Zhin green in every palette (ADR 0063 D23); under Zhin green they equal --primary', () => {
  const light = tokensFor('zhin', false), dark = tokensFor('zhin', true)
  // #0A7551 vs the library's brand-text hsl(160 84% 25%): the same color within rounding.
  assert.ok(Math.abs(light.primary.h - 160) <= 0.5 && light.primary.s === 84 && light.primary.l === 25)
  assert.deepEqual(dark.primary, { h: 159.8, s: 100, l: 74.9 })
  for (const palette of THEME_PALETTES) for (const theme of [false, true]) {
    const tokens = tokensFor(palette.id, theme), zhin = theme ? dark : light
    assert.deepEqual(tokens['console-brand-text'], zhin['console-brand-text'], `${palette.id}: brand-text is palette-independent`)
    assert.deepEqual(tokens['console-brand-tint'], zhin['console-brand-tint'], `${palette.id}: brand-tint is palette-independent`)
    assert.deepEqual(tokens.ring, tokens['console-brand-text'], `${palette.id}: focus ring is the brand accent`)
  }
})
test('status, fill and chart tokens are the library roles; sent is still chart-3 (console-ui 1.1)', () => {
  const values = tokenValues('zhin', false)
  for (const [name, role] of [['destructive', 'signal-danger-text'], ['destructive-fill', 'signal-danger-fill'], ['success', 'signal-success-text'], ['success-fill', 'signal-success-fill'],
    ['info', 'signal-info-text'], ['info-fill', 'signal-info-fill'], ['warning', 'signal-warning-text'], ['warning-fill', 'signal-warning-fill'],
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [`chart-${n}`, `console-chart-${n}`.slice(8)]), ['chart-other', 'chart-other']]) {
    assert.equal(values.get(name), `var(--console-${role})`, name)
  }
  const design = readFileSync(new URL('console-ui/src/design-system.css', root), 'utf8')
  assert.match(design, /--zc-chart-inbound: var\(--console-chart-1\);/)
  assert.match(design, /--zc-chart-outbound: var\(--console-chart-3\);/)
  assert.equal(resolveToken(values, 'console-chart-3'), '164 72% 32%')
})
