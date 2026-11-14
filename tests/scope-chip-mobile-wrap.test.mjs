import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const css = read('console-ui/src/pages/plugins.css')
const page = read('console-ui/src/pages/introspection/index.tsx')

test('provider chips wrap on narrow screens so the 功能 link stays inside the chip', () => {
  const chip = css.match(/\.console-plugin-scope-chip\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.match(chip, /flex-wrap:\s*wrap/, 'at 360px the summary pushed 功能 to 393–417px, off screen')
  assert.match(chip, /min-width:\s*0/)
  assert.match(chip, /max-width:\s*100%/)
})

test('the scope summary badge may wrap instead of forcing one nowrap line', () => {
  const summary = page.slice(page.indexOf('function ProviderSummary'))
  assert.match(summary, /<Badge [^>]*className="max-w-full whitespace-normal"[^>]*>\{scopeSummaryLine\(/, 'Badge defaults to whitespace-nowrap')
  assert.match(summary, /className="min-w-0 truncate font-mono[^"]*" title=\{plugin\}/, 'a long plugin name truncates and keeps its title')
})
