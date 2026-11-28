// zhinjs/zhin#1250 follow-ups on the soft-card Console: the overview's online-account ring and the
// shared 「功能未启用」 reading of a read that needs the Agent (`utils/feature-disabled.mjs`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { featureUnavailableState, featureDisabledState } from '../console-ui/src/utils/feature-disabled.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const library = path => read(`node_modules/@zhin.js/console-ui/dist/${path}`)

// ── dashboard-online-ring-text-overflow ─────────────────────────────────────────────────────────

/**
 * Advance widths of the label in Inter (weight 600, letter-spacing -0.04em), in em, measured in
 * Chromium with the self-hosted Inter (`fonts.css`): 「100%」 tabular 2.785 / proportional 2.588,
 * 「99%」 tabular 2.176, 「7%」 1.573. Digit height ≈ 0.73em.
 */
const WIDTH_EM = { tabular: { 3: 2.785, 2: 2.176, 1: 1.573 }, proportional: { 3: 2.588 } }
const DIGIT_HEIGHT_EM = 0.73
const REM = 16

function rem(value) {
  const match = /^([\d.]+)rem$/.exec(value.trim())
  assert.ok(match, value)
  return Number(match[1]) * REM
}

/** Ring geometry from the installed library: outer size, SVG radius and stroke width. */
function ringGeometry() {
  const css = library('styles.css')
  const block = /\.console-ring-gauge \{([^}]*)\}/.exec(css)[1]
  const size = rem(/width:\s*([^;]+);/.exec(block)[1])
  const source = library('components/StatCard.js')
  const radius = Number(/const r = (\d+(?:\.\d+)?);/.exec(source)[1])
  const stroke = Number(/strokeWidth: "([\d.]+)"/.exec(source)[1])
  const viewBox = Number(/viewBox: "0 0 (\d+) \1"/.exec(source)[1])
  return { size, inner: (size / viewBox) * (radius - stroke / 2) }
}

/** Free space on each side of a label of `width` × `height` px centred in the ring's inside. */
function margin({ inner }, width, height) {
  const chord = 2 * Math.sqrt(inner * inner - (height / 2) ** 2)
  return (chord - width) / 2
}

test('the overview ring names its digit count so the label can fit inside the ring', () => {
  const dashboard = read('console-ui/src/pages/dashboard.tsx')
  assert.match(dashboard, /<span className="console-ring-fit" data-digits=\{String\(endpointRate\)\.length\}>\s*<MiniRingGauge percent=\{endpointRate\}/)
  // endpointRate is a whole percentage 0–100: one to three digits.
  assert.match(dashboard, /Math\.min\(100, Math\.max\(0, Math\.round\(/)
})

test('「100%」 and two-digit rates fit inside the ring with room to the stroke; the library default did not', () => {
  const css = read('console-ui/src/design-system.css')
  const tokens = library('tokens.css')
  const xs = rem(/--console-text-xs:\s*([^;]+);/.exec(tokens)[1])
  const label = rem(/--console-text-label:\s*([^;]+);/.exec(tokens)[1])
  assert.match(css, /\.console-ring-fit \.console-ring-gauge-label \{ font-size: var\(--console-text-xs\); \}/)
  const three = /\.console-ring-fit\[data-digits="3"\] \.console-ring-gauge-label \{ font-size: calc\(var\(--console-text-xs\) \* 5 \/ 6\); font-variant-numeric: proportional-nums; \}/
  assert.match(css, three)
  const ring = ringGeometry()
  const fit = (digits, size, numerals = 'tabular') => margin(ring, WIDTH_EM[numerals][digits] * size, DIGIT_HEIGHT_EM * size)

  // Before: the library's label size with tabular digits puts 「100%」 over the stroke.
  assert.ok(fit(3, label) < 0, `「100%」 at the library size overflows (${fit(3, label).toFixed(1)}px)`)
  // After: at least 1.5px between the text and the stroke on each side, whatever the rate.
  for (const [digits, size, numerals] of [[3, xs * 5 / 6, 'proportional'], [2, xs, 'tabular'], [1, xs, 'tabular']]) {
    const room = fit(digits, size, numerals)
    assert.ok(room >= 1.5, `${digits} digit(s) at ${size}px leave ${room.toFixed(2)}px`)
  }
  // The ring keeps the library size: the stat row height does not change.
  assert.doesNotMatch(css, /\.console-ring-fit[^{]*\{[^}]*\b(?:width|height):/)
})

// ── disabled-feature-as-read-failure ────────────────────────────────────────────────────────────

test('a read that needs the Agent reads as 「功能未启用」: the Host 503 texts, as text or as { status, body }', () => {
  for (const reply of [
    'Agent Runtime 尚未就绪',
    new Error('Agent Runtime 尚未就绪'),
    { status: 503, body: { success: false, error: 'Agent Runtime 尚未就绪' } },
    { status: 503, body: { success: false, error: '未安装 @zhin.js/agent，无法读取 trace' } },
    'Agent runtime 未装配（basic/cli 未接线 acquireAgentRuntime）',
  ]) {
    const state = featureUnavailableState(reply)
    assert.equal(state?.reason, 'agent-unavailable', JSON.stringify(reply))
    assert.match(state.description, /AI 智能体（@zhin\.js\/agent）/)
    assert.match(state.description, /zhin setup --ai/)
    assert.match(featureUnavailableState(reply, 'en').description, /^This needs the AI agent \(@zhin\.js\/agent\)/)
  }
  // The Host's explicit disabled state (200 `data: { status: 'disabled' }`) is the same reading as before.
  const disabled = { status: 'disabled', reason: 'agent-not-installed', message: 'x' }
  assert.deepEqual(featureUnavailableState({ status: 200, body: { success: true, data: disabled } }), featureDisabledState(disabled))
})

test('only those texts count: permission, network, gateway and other failures stay 「读取失败」', () => {
  for (const reply of [
    { status: 403, body: { error: 'Agent Runtime 尚未就绪' } },
    { status: 500, body: { error: 'trace 读取失败' } },
    { status: 503, body: { code: 'instance_unavailable', error: 'The Zhin instance is not running' } },
    { status: 503, body: { code: 'database_busy', error: '数据库正忙' } },
    { status: 503, body: null },
    '连接已断开', 'HTTP 403', new TypeError('Failed to fetch'), '', null, undefined,
  ]) assert.equal(featureUnavailableState(reply), null, JSON.stringify(reply))
})
