// The Console's colors are the component library's soft-card roles (@zhin.js/console-ui 1.3.0,
// 「柔光卡片」, ADR 0063 D34–D41): one palette, light and dark. These tests read the cascade the
// browser sees (library tokens.css, then the Console's theme-tokens.css) and check the roles.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contrast as ratio, hslTokens, resolveToken, tokenValues } from './helpers/token-cascade.mjs'
const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

for (const dark of [false, true]) {
  test(`${dark ? 'dark' : 'light'} keeps text readable and controls visible`, () => {
    const tokens = hslTokens(dark)
    for (const [foreground, background] of [['foreground', 'background'], ['card-foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'secondary'], ['muted-foreground', 'muted'], ['primary-foreground', 'primary'], ['primary-action-foreground', 'primary-action'], ['sidebar-foreground', 'sidebar'], ['im-bubble-out-fg', 'im-bubble-out'], ['im-row-active-fg', 'im-row-active'], ['destructive', 'card'], ['success', 'card'], ['warning', 'card'], ['info-foreground', 'info'], ['warning-fill-foreground', 'warning-fill'], ['console-on-danger-solid', 'console-danger-solid']]) {
      const value = ratio(tokens[foreground], tokens[background]); assert.ok(value >= 4.5, `${foreground}/${background}: ${value.toFixed(2)}`)
    }
    for (const [foreground, background] of [['input', 'card'], ['ring', 'background'], ['ring', 'card'], ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ['chart-' + n, 'card'])]) {
      const value = ratio(tokens[foreground], tokens[background]); assert.ok(value >= 3, `${foreground}/${background}: ${value.toFixed(2)}`)
    }
  })
}

test('surfaces are warm greys stepping by lightness: bg → surface (cards) → sunken → raised', () => {
  for (const dark of [false, true]) {
    const tokens = hslTokens(dark)
    // Chroma, not HSL saturation (which inflates near white / black): warm greys stay below 3%.
    for (const name of ['background', 'card', 'secondary', 'popover']) { const { s, l } = tokens[name], chroma = (1 - Math.abs(2 * l / 100 - 1)) * s; assert.ok(chroma <= 3, `${name} stays grey (chroma ${chroma.toFixed(1)}%)`) }
    if (!dark) {
      assert.equal(tokens.card.l, 100, 'cards are white in the light theme')
      assert.ok(tokens.background.l >= 95 && tokens.background.l < 100, 'the page is a light warm grey, not white')
      assert.ok(tokens.secondary.l < tokens.card.l, 'sub-blocks inside a card are sunken below the card')
    } else {
      assert.ok(tokens.background.l < tokens.card.l && tokens.card.l < tokens.secondary.l && tokens.secondary.l < tokens.popover.l, 'dark surfaces step up from page to card to sunken to raised')
    }
  }
})

test('the primary is black (light) / white (dark); the former palette tint is the sunken secondary fill', () => {
  const light = hslTokens(false), dark = hslTokens(true)
  assert.ok(light.primary.l <= 15 && light.primary.s <= 25, `light primary is near-black (${JSON.stringify(light.primary)})`)
  assert.ok(dark.primary.l >= 85 && dark.primary.s <= 25, `dark primary is near-white (${JSON.stringify(dark.primary)})`)
  for (const tokens of [light, dark]) {
    assert.deepEqual(tokens['primary-action'], tokens.secondary, '--primary-action is sunken now (console-ui 1.3.0)')
    assert.deepEqual(tokens.ring, tokens['console-focus'])
  }
})

test('no blue or purple: every category tint, icon colour and chart colour stays out of 200°–300°', () => {
  for (const dark of [false, true]) {
    const tokens = hslTokens(dark)
    for (const name of [1, 2, 3, 4, 5].flatMap(n => [`console-tint-${n}`, `console-accent-${n}`]).concat([1, 2, 3, 4, 5, 6, 7, 8].map(n => `chart-${n}`), ['primary', 'ring', 'background', 'card'])) {
      const { h, s } = tokens[name]
      assert.ok(s < 8 || h < 200 || h > 300, `${dark ? 'dark' : 'light'} ${name}: hue ${h}`)
    }
  }
})

test('the Console defines no colors of its own: theme-tokens.css only points older names at library roles', () => {
  const tokens = read('console-ui/src/theme-tokens.css').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(tokens, /data-palette|--palette-|\d+(?:\.\d+)? \d+(?:\.\d+)?% \d+(?:\.\d+)?%/, 'no palette and no literal HSL values')
  for (const [, value] of tokens.matchAll(/--[\w-]+:\s*([^;]+);/g)) assert.match(value, /^var\(--console-[\w-]+\)$/, value)
  const design = read('console-ui/src/design-system.css')
  assert.match(design, /@import "\.\/theme-tokens\.css"/)
  for (const name of ['background', 'foreground', 'primary', 'card', 'border', 'muted-foreground']) assert.doesNotMatch(design, new RegExp(`\\n\\s*--${name}:`), `design-system.css redefines --${name}`)
  for (const path of ['client/style.css']) {
    const entry = read(path); assert.match(entry, /@import .*design-system\.css/); assert.doesNotMatch(entry, /--background:\s|fonts\.googleapis\.com/)
  }
})

test('design-system.css no longer redefines the library’s same-named --console-* scale (ADR 0063 第 37 条)', () => {
  const library = new Set([...read('node_modules/@zhin.js/console-ui/dist/tokens.css').matchAll(/(--console-[\w-]+):/g)].map(match => match[1]))
  for (const path of ['console-ui/src/design-system.css', 'console-ui/src/shell.css', 'console-ui/src/theme-tokens.css']) {
    const own = [...read(path).matchAll(/^\s*(--console-[\w-]+):/gm)].map(match => match[1])
    const same = own.filter(name => library.has(name))
    assert.deepEqual(same, [], `${path} redefines ${same.join(', ')}`)
  }
  for (const removed of ['--console-content-max: 90rem', '--console-control-height: 2.25rem', '--console-text-body: 0.875rem']) assert.ok(!read('console-ui/src/design-system.css').includes(removed), removed)
})

test('primary buttons and the composer use the solid primary; destructive controls keep their roles', () => {
  const button = read('node_modules/@zhin.js/console-ui/dist/components/ui/button.js')
  const composer = read('console-ui/src/im-workspace.css')
  // console-ui 1.3.0: `primary` is solid black / white, `soft` (the default) the sunken secondary,
  // `destructive` a text button, and only `destructive-solid` / `danger` are filled red.
  assert.match(button, /primary: "bg-primary text-primary-foreground/)
  assert.match(button, /const SECONDARY = "bg-sunken text-ink"/)
  assert.match(button, /soft: SECONDARY/)
  assert.ok(button.includes('destructive: "bg-transparent text-danger"'))
  assert.ok(button.includes('"destructive-solid": "bg-danger-solid text-on-danger-solid"'))
  assert.doesNotMatch(button, /bg-brand/)
  assert.match(composer, /\.im-insert-button, \.im-send-button \{ background: hsl\(var\(--console-primary\)\); color: hsl\(var\(--console-on-primary\)\)/)
})

test('the brand mark keeps #76EEC6 / #7FFFD4 with a near-black Z; it is never a button color', () => {
  for (const dark of [false, true]) {
    const tokens = hslTokens(dark)
    assert.deepEqual(tokens['console-brand'], dark ? { h: 159.8, s: 100, l: 74.9 } : { h: 160, s: 78, l: 69.8 })
    assert.ok(ratio(tokens['console-brand-foreground'], tokens['console-brand']) >= 7, 'the Z reads on the mark')
  }
})

test('each status keeps one hue for its text and fill in a theme; light text reads on cards', () => {
  for (const dark of [false, true]) {
    const tokens = hslTokens(dark)
    for (const name of ['success', 'warning', 'destructive']) {
      const hues = [tokens[name], tokens[`${name}-fill`]].map(value => value.h)
      assert.ok(Math.max(...hues) - Math.min(...hues) <= 6, `${name} hues ${hues}`)
      for (const surface of ['card', 'background']) assert.ok(ratio(tokens[name], tokens[surface]) >= 4.5, `${name} text on ${surface}`)
    }
  }
  const light = hslTokens(false), dark = hslTokens(true)
  for (const name of ['success', 'warning', 'destructive']) assert.ok(Math.abs(light[name].h - dark[name].h) <= 12, `${name}: one hue family across themes`)
})

test('status, fill and chart tokens are the library roles; received is chart-1 and sent is chart-2', () => {
  const values = tokenValues(false)
  for (const [name, role] of [['destructive', 'console-danger'], ['destructive-fill', 'console-signal-danger-fill'], ['success', 'console-ok'], ['success-fill', 'console-signal-success-fill'],
    ['warning', 'console-warn'], ['warning-fill', 'console-signal-warning-fill'], ['info-fill', 'console-signal-info-fill'],
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [`chart-${n}`, `console-chart-${n}`]), ['chart-other', 'console-chart-other']]) {
    assert.equal(values.get(name), `var(--${role})`, name)
  }
  const design = read('console-ui/src/design-system.css')
  assert.match(design, /--zc-chart-inbound: var\(--console-chart-1\);/)
  assert.match(design, /--zc-chart-outbound: var\(--console-chart-2\);/)
  // chart-1 is the apricot accent-1, chart-2 the peacock teal (console-ui 1.3.0).
  assert.equal(resolveToken(values, 'console-chart-1'), resolveToken(values, 'console-accent-1'))
  assert.equal(resolveToken(values, 'console-chart-2'), '185.26 44.88% 24.9%')
})
