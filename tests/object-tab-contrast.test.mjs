// Inactive tabs (@zhin.js/console-ui Tabs, `.console-tabs-trigger`) wrote muted-foreground on the tab list fill —
// the page background with 6% foreground — and axe-core measured 4.45:1 in the light theme (#64 follow-up).
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

test('inactive tabs use their own token; hover and disabled keep the library styles', () => {
  const css = read('console-ui/src/design-system.css')
  assert.match(css, /\.console-tabs-trigger\[data-state="inactive"\]:not\(:hover, :disabled\) \{ color: hsl\(var\(--zc-tab-inactive\)\); \}/)
})

for (const palette of THEME_PALETTES) for (const dark of [false, true]) {
  test(`${palette.id}/${dark ? 'dark' : 'light'}: inactive tab labels reach 4.5:1 on the tab list fill`, () => {
    const tokens = hslTokens(palette.id, dark)
    assert.ok(tokens['zc-tab-inactive'], 'the token resolves')
    for (const surface of ['background', 'card']) {
      const fill = over(rgb(tokens.foreground), 0.06, rgb(tokens[surface]))
      const value = ratio(rgb(tokens['zc-tab-inactive']), fill)
      assert.ok(value >= 4.5, `${surface}: ${value.toFixed(2)}`)
    }
  })
}
