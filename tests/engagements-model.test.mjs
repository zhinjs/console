import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actorLabel, collaborationEventSummary, engagementTotals, hasRunningEngagement, venueChannelLabel } from '../console-ui/src/pages/engagements-model.mjs'

const detail = JSON.parse(readFileSync(new URL('./fixtures/engagement-detail.json', import.meta.url))).body.data

test('totals count running and failed engagements and add up their budgets', () => {
  const running = { ...detail.summary, engagementId: 'eng-2', status: 'running', turns: 1, tokensUsed: 10 }
  const failed = { ...detail.summary, engagementId: 'eng-3', status: 'failed', turns: 2, tokensUsed: 5 }
  assert.deepEqual(engagementTotals([detail.summary, running, failed]), { running: 1, failed: 1, turns: 6, tokens: 1855 })
  assert.deepEqual(engagementTotals([]), { running: 0, failed: 0, turns: 0, tokens: 0 })
  assert.equal(hasRunningEngagement([detail.summary]), false, 'finished records do not keep the page polling')
  assert.equal(hasRunningEngagement([detail.summary, running]), true)
})

test('each Host event kind gets a one-line summary and unknown kinds keep their payload', () => {
  assert.deepEqual(detail.events.map(collaborationEventSummary), [
    'initiator=human:u-1 venue=war-room',
    'agent:planner -> agent:reviewer [request]',
    'm-1 -> external:a2a://peer (accepted)',
    'plan (v2) by agent:planner',
    'hops=2 turns=3 tokens=1840',
    'status=completed reason=done',
  ])
  assert.equal(collaborationEventSummary({ kind: 'future.kind', n: 1 }), '{"kind":"future.kind","n":1}')
  assert.equal(actorLabel(null), 'unknown')
  assert.equal(actorLabel({ kind: 'robot', id: 7 }), '{"kind":"robot","id":7}')
})

test('a venue is labelled by the conversation it is bound to', () => {
  assert.equal(venueChannelLabel({ key: 'war-room', channel: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'group', id: '42' } }), 'sandbox:bot/group:42')
})
