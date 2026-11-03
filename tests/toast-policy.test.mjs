import test from 'node:test'
import assert from 'node:assert/strict'
import { appendToast, toastDuration, MAX_TOASTS } from '../console-ui/src/components/toast-policy.mjs'

const toast = (id, variant = 'info', description = `Notice ${id}`) => ({ id, variant, description })

test('errors and warnings require dismissal while routine notifications have time to be read', () => {
  assert.equal(toastDuration('error'), 0)
  assert.equal(toastDuration('warning'), 0)
  assert.equal(toastDuration('success'), 5000)
  assert.equal(toastDuration('info'), 5000)
  assert.equal(toastDuration('info', 0), 0)
  assert.equal(toastDuration('info', Infinity), 5000)
  assert.equal(toastDuration('info', -1), 0)
  assert.equal(toastDuration('info', 100_000), 30_000)
})

test('repeated feedback is coalesced and the visible notification list stays bounded', () => {
  let state = []
  for (let index = 0; index < 20; index++) state = appendToast(state, toast(String(index)))
  assert.equal(state.length, MAX_TOASTS)
  assert.deepEqual(state.map(item => item.id), ['15', '16', '17', '18', '19'])
  state = appendToast(state, toast('replacement', 'info', 'Notice 19'))
  assert.equal(state.length, MAX_TOASTS)
  assert.equal(state.at(-1).id, 'replacement')
  assert.equal(state.filter(item => item.description === 'Notice 19').length, 1)
  state = appendToast(state, toast('different-tone', 'error', 'Notice 19'))
  assert.equal(state.filter(item => item.description === 'Notice 19').length, 2)
})
