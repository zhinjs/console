import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { engagementTotals, normalizeEngagementSummary } from '../console-ui/src/pages/engagements-model.mjs'

// #64 `workrooms-summary-shape-mismatch`: the Host's `EngagementSummary` carries `hops` as an array of
// hops and the token count in `consumed.tokens`, with no `turns` / `tokensUsed`. The Console read
// `hops` / `tokensUsed` as numbers, so 跳转 and Tokens were always 「—」, and the top cards added
// nothing up and showed 「轮次 0」「Tokens 0」 although the collaborations did use tokens.
const journal = {
  engagementId: 'm17', venue: { kind: 'group', id: '20001' }, status: 'escalated', startedAt: 1_000, endedAt: 12_299,
  actors: ['icqq', 'zhin', 'draw'],
  hops: [{ from: 'icqq', to: 'zhin' }, { from: 'zhin', to: 'draw' }, { from: 'draw', to: 'zhin' }],
  consumed: { tokens: 1_234 },
}

test('hops are counted from the hop list and tokens read from consumed.tokens', () => {
  const summary = normalizeEngagementSummary(journal)
  assert.equal(summary.hops, 3)
  assert.equal(summary.tokensUsed, 1_234)
  // The Host has no turn count yet: unknown, not 0.
  assert.equal(summary.turns, undefined)
  assert.equal(normalizeEngagementSummary({ ...journal, consumed: { tokens: 9, turns: 4 } }).turns, 4)
  assert.equal(normalizeEngagementSummary({ ...journal, hops: [] }).hops, 0)
  // Junk stays unknown instead of becoming NaN.
  const junk = normalizeEngagementSummary({ ...journal, hops: 'x', consumed: { tokens: 'many' } })
  assert.equal(junk.hops, undefined)
  assert.equal(junk.tokensUsed, undefined)
  assert.equal(normalizeEngagementSummary({ ...journal, consumed: null }).tokensUsed, undefined)
  // The protocol's numbers still win when both are present.
  assert.equal(normalizeEngagementSummary({ ...journal, hops: 5, tokensUsed: 7 }).hops, 5)
  assert.equal(normalizeEngagementSummary({ ...journal, hops: 5, tokensUsed: 7 }).tokensUsed, 7)
})

test('the totals add up what is known and say 「unknown」 when no collaboration reports a count', () => {
  const list = [normalizeEngagementSummary(journal), normalizeEngagementSummary({ ...journal, engagementId: 'm18', status: 'open', consumed: { tokens: 66 } })]
  assert.deepEqual(engagementTotals(list), { running: 1, failed: 1, turns: null, tokens: 1_300 })
  assert.deepEqual(engagementTotals([{ status: 'completed' }]), { running: 0, failed: 0, turns: null, tokens: null })
  // No collaborations at all: nothing to add up, so 0 is the truth.
  assert.deepEqual(engagementTotals([]), { running: 0, failed: 0, turns: 0, tokens: 0 })
})

test('the summary cards show 「—」 for an unknown total instead of 0', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/workrooms.tsx', import.meta.url), 'utf8')
  assert.match(source, /label=\{i18n\.t\("轮次"\)\} value=\{totals\.turns === null \? '—' : i18n\.number\(totals\.turns\)\}/)
  assert.match(source, /label="Tokens" value=\{totals\.tokens === null \? '—' : i18n\.number\(totals\.tokens\)\}/)
})
