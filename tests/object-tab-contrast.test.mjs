// Inactive tabs (@zhin.js/console-ui Tabs, `.console-tabs-trigger`) wrote muted-foreground on the tab list fill —
// the page background with 6% foreground — and axe-core measured 4.45:1 in the light theme (#64 follow-up).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hslTokens } from './helpers/token-cascade.mjs'

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

for (const dark of [false, true]) {
  test(`${dark ? 'dark' : 'light'}: inactive tab labels reach 4.5:1 on the segmented track and its hover`, () => {
    // console-ui 1.3.0: Tabs are the soft-card segmented control — a sunken track; hover lays 4% ink over it.
    const tokens = hslTokens(dark)
    assert.ok(tokens['zc-tab-inactive'], 'the token resolves')
    for (const [name, fill] of [['sunken', rgb(tokens['console-sunken'])], ['sunken + hover', over(rgb(tokens['console-ink']), 0.04, rgb(tokens['console-sunken']))]]) {
      const value = ratio(rgb(tokens['zc-tab-inactive']), fill)
      assert.ok(value >= 4.5, `${name}: ${value.toFixed(2)}`)
    }
  })
}
