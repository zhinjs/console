import assert from 'node:assert/strict'
import test from 'node:test'
import { relatedUpdateReadback } from '../console-ui/src/pages/database/related-update-result.mjs'

test('zero affected updates distinguish a missing record, unapplied patch and unchanged saved values', () => {
  const patch = { message: 'draft' }
  assert.equal(relatedUpdateReadback([], patch), 'missing')
  assert.equal(relatedUpdateReadback([{ message: 'before' }], patch), 'unconfirmed')
  assert.equal(relatedUpdateReadback([{ message: 'draft', id: 1 }], patch), 'saved')
  assert.equal(relatedUpdateReadback([{ message: 'draft' }, { message: 'draft' }], patch), 'unconfirmed')
})

test('readback compares structured JSON and declared date/boolean representations without coercing text', () => {
  const patch = { json: { a: 1, b: [true, null] }, date: '2026-10-08T00:00:00.000Z', bool: true, text: 'true' }
  const actual = { json: { b: [true, null], a: 1 }, date: '2026-10-08T00:00:00Z', bool: 1, text: 'true' }
  const defs = { date: { type: 'date' }, bool: { type: 'boolean' }, text: { type: 'text' } }
  assert.equal(relatedUpdateReadback([actual], patch, defs), 'saved')
  assert.equal(relatedUpdateReadback([{ ...actual, text: true }], patch, defs), 'unconfirmed')
  assert.equal(relatedUpdateReadback([{ ...actual, bool: 2 }], patch, defs), 'unconfirmed')
})
