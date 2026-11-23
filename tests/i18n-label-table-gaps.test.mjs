import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import { verifySubmission } from '../console-ui/src/pages/scope/login-flow-model.mjs'

// #64 `i18n-label-table-gaps`: two tables keep Chinese text and hand it to `i18n.t()` only when
// rendering, so localization.test (which checks literals written inside `t()`) never saw them. Each
// had one entry without English: the English UI showed 「Stop retrying: 执行超时」 and a Chinese
// sentence on the login card.
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const CJK = /[一-鿿]/u
const missing = texts => texts.filter(text => !Object.hasOwn(englishMessages, text))

test('every retry reason of the schedule execution record has English', () => {
  const source = read('pages/ScheduleExecutions.tsx')
  const table = source.match(/const retryReasons: Record<string, string> = \{([^}]*)\}/)
  assert.ok(table, 'retryReasons table found')
  const values = [...table[1].matchAll(/:\s*'([^']+)'/g)].map(match => match[1])
  assert.ok(values.length >= 8)
  assert.ok(values.includes('执行超时'))
  assert.deepEqual(missing(values), [])
  assert.equal(translate('en', '停止重试：{0}', [translate('en', '执行超时')]).match(CJK), null)
})

test('every message verifySubmission returns for the login card has English', () => {
  const source = read('pages/scope/login-flow-model.mjs')
  const body = source.slice(source.indexOf('export function verifySubmission('), source.indexOf('\n}\n', source.indexOf('export function verifySubmission(')))
  const messages = [...body.matchAll(/message: '([^']+)'/g)].map(match => match[1])
  assert.ok(messages.includes('这次验证已超时，请按当前步骤重新验证。'))
  assert.deepEqual(missing(messages), [])
  // The abandoned-verification case itself (the flow expired and was reopened) reads in English.
  const flow = { state: 'waiting', steps: [{ id: 's1', kind: 'challenge', status: 'done' }, { id: 'v1', kind: 'verifying', status: 'skipped' }, { id: 's2', kind: 'challenge', status: 'active' }] }
  const verdict = verifySubmission(flow, 's1')
  assert.equal(verdict.message, '这次验证已超时，请按当前步骤重新验证。')
  assert.equal(translate('en', verdict.message).match(CJK), null)
})
