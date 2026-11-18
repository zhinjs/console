// #64 `light-contrast-crumb-readout`: axe-core found two light-theme text runs below 4.5:1 — the level word of the
// object-tree breadcrumb (muted-foreground with an extra opacity: 0.75, 3.06:1) and the percent badge of the
// cache-hit readout on /agent/usage (chart-3 as text on a 14% chart-3 tint, 3.77:1).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hslTokens } from './helpers/token-cascade.mjs'
import { THEME_PALETTES } from '../console-ui/src/theme/index.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const rgb = ({ h, s, l }) => {
  const chroma = (1 - Math.abs(2 * l / 100 - 1)) * s / 100, hue = h / 60, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = l / 100 - chroma / 2
  const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x]
  return channels.map(channel => channel + m)
}
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
const luminance = channels => channels.map(linear).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
const ratio = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05) }
const over = (top, alpha, bottom) => top.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha))

test('the breadcrumb level word has no opacity on top of muted-foreground; weight sets it apart', () => {
  const css = read('console-ui/src/scope/object-page.css')
  const level = css.match(/\.console-scope-crumb-level \{([^}]*)\}/)?.[1]
  assert.ok(level, 'the level rule exists')
  assert.doesNotMatch(level, /opacity/)
  assert.match(level, /font-weight: var\(--console-weight-regular\)/)
  assert.match(css, /\.console-scope-crumb \{[^}]*color: hsl\(var\(--muted-foreground\)\);[^}]*font-weight: var\(--console-weight-medium\)/, 'the name is heavier than the level word')
})

test('the cache-hit readout badge writes its text in foreground; chart-3 only fills', () => {
  const charts = read('console-ui/src/pages/token-usage-charts.tsx')
  assert.doesNotMatch(charts, /text-\[hsl\(var\(--chart-\d\)/, 'no chart color used as a text color')
  assert.match(charts, /bg-\[hsl\(var\(--chart-3\)\/0\.14\)\][^"]*text-foreground/)
})

for (const palette of THEME_PALETTES) for (const dark of [false, true]) {
  test(`${palette.id}/${dark ? 'dark' : 'light'}: both text runs reach 4.5:1`, () => {
    const tokens = hslTokens(palette.id, dark)
    for (const surface of ['background', 'card']) {
      const base = rgb(tokens[surface])
      const crumb = ratio(rgb(tokens['muted-foreground']), base)
      assert.ok(crumb >= 4.5, `crumb level on ${surface}: ${crumb.toFixed(2)}`)
      const badge = ratio(rgb(tokens.foreground), over(rgb(tokens['chart-3']), 0.14, base))
      assert.ok(badge >= 4.5, `readout badge on ${surface}: ${badge.toFixed(2)}`)
    }
  })
}
