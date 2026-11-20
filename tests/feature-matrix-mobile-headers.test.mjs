import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// #64 `feature-matrix-mobile-headers`: in the narrow card view the shared Table copies each header's
// text into the cells' `data-label`, so an adapter column read 「icqqpreview-community：2 个会话有覆盖」,
// and the header with its adapter and override links is visually hidden, so neither could be tapped.
const source = readFileSync(new URL('../console-ui/src/pages/features/feature-matrix.tsx', import.meta.url), 'utf8')

test('each adapter cell names its adapter itself instead of inheriting the header text', () => {
  const cells = source.slice(source.indexOf('{adapterColumns.map(adapter => {'), source.indexOf('</TableRow>', source.indexOf('{adapterColumns.map(adapter => {')))
  assert.match(cells, /<TableCell key=\{adapter\} label=\{adapter\}>/)
})

test('the card view has its own row of adapter links and override links, shown only when the header is hidden', () => {
  // The table switches to cards when its `console` container is under 40rem; the row uses the same query.
  assert.match(source, /<div className="console-cq">/)
  const strip = source.slice(source.indexOf('data-adapter-links'), source.indexOf('<Table aria-label'))
  assert.match(strip, /className="hidden @max-\[40rem\]\/console:flex /)
  assert.match(strip, /<Link to=\{adapterHref\(adapter, 'features'\)\}[^>]*min-h-11[^>]*>\{i18n\.t\("打开 \{0\} 的功能设置", \[adapter\]\)\}<\/Link>/)
  assert.match(strip, /<ConversationOverrideLinks counts=\{conversationOverrides\} adapter=\{adapter\} linkClassName="inline-flex min-h-11 items-center" \/>/)
  // Shown only when there are adapter columns to point at.
  assert.match(source, /\{adapterColumns\.length \? \(\s*<nav data-adapter-links=""/)
})
