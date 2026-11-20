import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `fallback-select-no-visible-label`: under 「识图」 two identical-looking pickers were stacked —
// the second is the first fallback, but only `aria-label` said so, so it read as a second primary model.
const source = readFileSync(new URL('../console-ui/src/pages/inference/Purposes.tsx', import.meta.url), 'utf8')
const chain = source.slice(source.indexOf('function FallbackChain('), source.indexOf('function RecentFallbacks('))

test('every fallback picker carries a visible 「备用 N」 label next to it', () => {
  const row = chain.slice(chain.indexOf('{list.map((id, index) => ('), chain.indexOf('<SearchableSelectField', chain.indexOf('{list.map((id, index) => (')))
  assert.match(row, /<span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">\{i18n\.t\("备用 \{0\}", \[index \+ 1\]\)\}<\/span>/)
  // The screen-reader name stays the full one.
  assert.match(chain, /aria-label=\{i18n\.t\("\{0\}备用模型 \{1\}", \[label, index \+ 1\]\)\}/)
  assert.equal(translate('en', '备用 {0}', [2]), 'Fallback 2')
})
