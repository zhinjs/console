import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { diagnosticHelpLinks } from '../console-ui/src/pages/endpoint-detail/diagnostic-help.mjs'
import { readMessageDiagnostics } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'

const record = (overrides = {}) => ({ status: 'completed', steps: [], deliveries: [], ...overrides })
const ids = value => diagnosticHelpLinks(value).map(item => item.id)

test('a real Runtime diagnostic links to the guide without inventing a failure', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/message-diagnostics-command.json', import.meta.url), 'utf8'))
  const input = fixture.data[0]
  const [parsed] = readMessageDiagnostics(fixture, { conversation: input.conversation, messageId: input.messageId })
  assert.deepEqual(ids(parsed), ['overview'])
})

test('observed prefix, validation, permission and Agent states choose their own topics', () => {
  assert.deepEqual(ids(record({ steps: [{ stage: 'prefix', status: 'mismatch' }] })), ['overview', 'prefix'])
  assert.deepEqual(ids(record({ dispatchStatus: 'invalid' })), ['overview', 'input'])
  assert.deepEqual(ids(record({ dispatchStatus: 'denied' })), ['overview', 'permission'])
  assert.deepEqual(ids(record({ route: 'agent' })), ['overview', 'agent'])
  assert.deepEqual(ids(record({ status: 'processing' })), ['overview'])
})

test('uncertain delivery is never presented as a definite delivery failure', () => {
  for (const delivery of [{ status: 'failed', deliveryUnknown: true }, { status: 'unknown' }]) {
    assert.deepEqual(ids(record({ deliveries: [delivery, delivery] })), ['overview', 'unknown'])
  }
  assert.deepEqual(ids(record({ deliveries: [{ status: 'rejected' }] })), ['overview', 'delivery'])
  assert.deepEqual(ids(record({ deliveries: [{ status: 'sent', rendering: { fallbacks: ['html_to_text'] } }] })), ['overview', 'rendering'])
})

test('plugin investigation requires observed evidence and does not claim the plugin caused every failure', () => {
  assert.deepEqual(ids(record({ status: 'failed' })), ['overview'])
  assert.deepEqual(ids(record({ status: 'failed', steps: [{ stage: 'middleware', status: 'entered' }, { stage: 'middleware', status: 'completed' }] })), ['overview'])
  assert.deepEqual(ids(record({ steps: [{ stage: 'handlers', status: 'failed' }] })), ['overview', 'plugin'])
  assert.deepEqual(ids(record({ status: 'failed', steps: [{ stage: 'middleware', status: 'entered' }] })), ['overview', 'plugin'])
  assert.deepEqual(ids(record({ deliveries: [{ status: 'rejected', failureCode: 'outbound_middleware_failed' }] })), ['overview', 'plugin', 'delivery'])
})

test('documentation links never contain target identity, bodies, credentials or arbitrary failure codes', () => {
  const secret = 'must-not-leak'
  const links = diagnosticHelpLinks(record({ id: secret, messageId: secret, conversation: { id: secret },
    content: secret, token: secret, deliveries: [{ status: 'failed', failureCode: `https://evil.invalid/${secret}` }] }))
  for (const link of links) {
    const url = new URL(link.href)
    assert.equal(url.origin, 'https://zhin.js.org')
    assert.equal(url.pathname, '/troubleshooting/messages')
    assert.equal(url.search, '')
    assert.equal(link.href.includes(secret), false)
  }
})
