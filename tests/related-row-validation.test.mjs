import assert from 'node:assert/strict'
import test from 'node:test'
import { relatedFieldIssue, relatedRowIssues } from '../console-ui/src/pages/database/related-row-validation.mjs'

test('typed numbers reject wrong types, fractions for integers and precision loss', () => {
  for (const value of ['1.5', '"123"', 'true', 'hello', '9007199254740993']) assert.ok(relatedFieldIssue(value, { type: 'integer' }))
  for (const value of ['0', '-12', '123']) assert.equal(relatedFieldIssue(value, { type: 'integer' }), null)
  assert.equal(relatedFieldIssue('1.5', { type: 'float' }), null)
  assert.ok(relatedFieldIssue('1e999', { type: 'float' }))
})

test('dates reject impossible calendar dates and preserve valid timestamp formats', () => {
  for (const value of ['not-a-date', '2026-02-30', '2026-13-01', '2026-04-31', '2026-00-00']) assert.ok(relatedFieldIssue(value, { type: 'date' }))
  for (const value of ['2024-02-29', '2026-10-08', '2026-10-08T00:00:00.000Z', '"2026-10-08T00:00:00Z"']) assert.equal(relatedFieldIssue(value, { type: 'date' }), null)
})

test('JSON, boolean and null follow declared types without validating plain text as JSON', () => {
  assert.ok(relatedFieldIssue('{bad', { type: 'json' }))
  assert.equal(relatedFieldIssue('{"enabled":true}', { type: 'json' }), null)
  for (const value of ['true', 'false', '0', '1']) assert.equal(relatedFieldIssue(value, { type: 'boolean' }), null)
  assert.ok(relatedFieldIssue('"false"', { type: 'boolean' }))
  assert.ok(relatedFieldIssue('null', { type: 'integer', nullable: false }))
  assert.equal(relatedFieldIssue('null', { type: 'integer', nullable: true }), null)
  assert.equal(relatedFieldIssue('null', { type: 'text', nullable: false }), null)
  assert.equal(relatedFieldIssue('', { type: 'integer' }), null)
})

test('row validation reports the offending fields and recovers after correction', () => {
  const definitions = { id: { type: 'integer' }, timestamp: { type: 'date' }, message: { type: 'text' } }
  const draft = { id: '1.5', timestamp: 'not-a-date', message: 'true' }
  assert.deepEqual(Object.keys(relatedRowIssues(Object.keys(draft), draft, definitions)), ['id', 'timestamp'])
  assert.deepEqual(relatedRowIssues(Object.keys(draft), { ...draft, id: '1', timestamp: '2026-10-08' }, definitions), {})
})
