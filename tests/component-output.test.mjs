import test from 'node:test'
import assert from 'node:assert/strict'
import { unwrapComponentOutput } from '../console-ui/src/pages/introspection/component-output.mjs'
test('actual status-card RawContent response reaches the existing HTML preview segment path', () => {
  const payload = { type: 'html', data: { html: '<div>Console component acceptance</div>', width: 540 } }
  assert.deepEqual(unwrapComponentOutput({ $content: 'zhin.raw-content/1', payload }), payload)
})
test('nested arrays and branded payloads normalize while other envelopes remain JSON fallback', () => {
  const code = { type: 'code', data: { code: 'sample', language: 'text' } }
  assert.deepEqual(unwrapComponentOutput([{ $content: 'zhin.raw-content/1', payload: [code] }, [code]]), [code, code])
  assert.equal(unwrapComponentOutput({ $content: 'zhin.raw-content/1', payload: 'text' }), 'text')
  const unknown = { $content: 'another-contract', payload: code }
  assert.equal(unwrapComponentOutput(unknown), unknown)
  const missing = { $content: 'zhin.raw-content/1' }
  assert.equal(unwrapComponentOutput(missing), missing)
})
