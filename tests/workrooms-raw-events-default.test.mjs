import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { collaborationEventSummary, engagementEventKind, maskPlatformIds } from '../console-ui/src/pages/engagements-model.mjs'

// #64 `workrooms-raw-events-default`: the default 「协作链路」 view printed every event the Console had no
// summary for (the Host journal's events) as its full JSON, with QQ numbers, group numbers and session
// ids in it, so a screenshot of the default view leaked them. The JSON belongs to 「原始事件」 only.
const journalEvent = {
  type: 'mail_denied', at: 1_763_700_000_000, from: 'agent:zhin', to: 'agent:draw',
  reason: 'limit', session: 'qq:group:987654321', sender: { platform: 'qq', userId: '1234567890' },
}

test('an event the Console has no summary for shows its kind and readable fields, never its JSON', () => {
  assert.equal(engagementEventKind(journalEvent), 'mail_denied')
  assert.equal(engagementEventKind({ kind: 'mail.sent' }), 'mail.sent')
  assert.equal(engagementEventKind({}), 'event')
  const summary = collaborationEventSummary(journalEvent)
  assert.doesNotMatch(summary, /[{}"]/)
  // Scalars are shown, nested objects and timestamps are left to 「原始事件」.
  assert.match(summary, /from=agent:zhin/)
  assert.match(summary, /to=agent:draw/)
  assert.match(summary, /reason=limit/)
  assert.doesNotMatch(summary, /1234567890|userId|1763700000000/)
  assert.equal(collaborationEventSummary({ kind: 'future.kind', n: 1 }), 'n=1')
  assert.equal(collaborationEventSummary({ type: 'tick' }), '')
  // A string value that is an account number on its own is masked too; numeric counts are not.
  assert.equal(maskPlatformIds(collaborationEventSummary({ type: 'x', peer: '1234567890', tokens: 18400 })), 'peer=12***90 tokens=18400')
})

test('platform account numbers are masked in the readable view', () => {
  assert.equal(maskPlatformIds('session=qq:group:987654321'), 'session=qq:group:98***21')
  assert.equal(maskPlatformIds('external:qq:12345'), 'external:qq:12***45')
  // Short numbers (counts, versions, small ids) stay as written.
  assert.equal(maskPlatformIds('hops=2 turns=3 tokens=18400 v123456'), 'hops=2 turns=3 tokens=18400 v123456')
  assert.equal(maskPlatformIds('1234567890'), '12***90')
  assert.equal(maskPlatformIds(''), '')
})

test('the timeline uses the kind reader and masks; only 「原始事件」 prints the JSON', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/workrooms.tsx', import.meta.url), 'utf8')
  const timeline = source.slice(source.indexOf("{view === 'timeline' ?"), source.indexOf("{view === 'board' ?"))
  assert.match(timeline, /\{engagementEventKind\(event\)\}/)
  assert.match(timeline, /maskPlatformIds\(collaborationEventSummary\(event\)\)/)
  assert.doesNotMatch(timeline, /JSON\.stringify/)
  assert.match(source, /\{view === 'raw' \? \(\s*<pre[^>]*>\{JSON\.stringify\(events, null, 2\)\}/)
})
