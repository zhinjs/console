import assert from 'node:assert/strict'
import test from 'node:test'
import { validateConfigSource } from '../console-ui/src/pages/config-source-validation.mjs'

test('source validation accepts mapping documents and rejects invalid syntax or root types', () => {
  for (const [format, valid, invalid] of [
    ['yaml', ['plugins: {}', '{}', 'http:\n  port: 18181'], ['', 'null', '- one', '42', 'http: [']],
    ['json', ['{}', '{"http":{"port":18181}}'], ['', 'null', '[]', '42', '{"http":']],
  ]) {
    for (const source of valid) assert.equal(validateConfigSource(source, format), null)
    for (const source of invalid) assert.equal(typeof validateConfigSource(source, format), 'string')
  }
})

test('syntax feedback never repeats source values', () => {
  for (const format of ['yaml', 'json']) {
    const issue = validateConfigSource('credential: [private-fixture-value', format)
    assert.ok(issue)
    assert.ok(!issue.includes('private-fixture-value'))
  }
})
