import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  containsEnvironmentReference, readConversationPage, readFeatureDetail, readFeatureWriteResult,
} from '../console-ui/src/pages/features/feature-model.mjs'
import { readSubmitResult, receiptReducer } from '../console-ui/src/components/action-receipt-model.mjs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const detail = extra => ({ revision: '1', plugin: 'ai', level: 'conversation', key: 'qq/1/group:2', levels: ['global', 'conversation'], schema: null,
  values: {}, effective: {}, sources: {}, enabled: true, ...extra })

test('persistent is read from feature.get, write results and feature.conversations only when the Host says so', () => {
  assert.equal(readFeatureDetail(detail({ persistent: false })).persistent, false)
  assert.equal(readFeatureDetail(detail({ persistent: true })).persistent, true)
  assert.equal(Object.hasOwn(readFeatureDetail(detail({})), 'persistent'), false, 'an older Host says nothing: not shown as unpersisted')
  assert.equal(Object.hasOwn(readFeatureDetail(detail({ persistent: 'no' })), 'persistent'), false)
  assert.equal(readFeatureWriteResult({ status: 'saved', revision: '2', restartRequired: false, warnings: [], message: 'ok', persistent: false }).persistent, false)
  assert.equal(Object.hasOwn(readFeatureWriteResult({ status: 'unchanged', revision: '2', warnings: [] }), 'persistent'), false)
  assert.equal(readConversationPage({ conversations: [], recentAvailable: true, persistent: false }).persistent, false)
})

test('environment references are found in values and keys, like the Host check', () => {
  for (const value of ['${TOKEN}', 'prefix ${A} suffix', 'ENV://KEY', ['ok', { nested: 'env://X' }], { '${KEY}': 1 }]) {
    assert.equal(containsEnvironmentReference(value), true, JSON.stringify(value))
  }
  for (const value of ['plain', '$TOKEN', 'env:/x', 42, null, undefined, { a: ['b'] }]) {
    assert.equal(containsEnvironmentReference(value), false, JSON.stringify(value))
  }
})

test('400 environment-reference is a certain refusal, kept with its reason on the receipt', () => {
  const error = Object.assign(new Error('值不能包含环境变量引用'), { details: { httpStatus: 400, serverCode: 'environment-reference' } })
  assert.equal(statusFromError(error).serverCode, 'environment-reference')
  const result = readSubmitResult({ status: 'failed', message: 'blocked', reason: 'environment-reference' })
  assert.equal(result.phase, 'failed')
  assert.equal(result.status.reason, 'environment-reference')
  assert.equal(Object.hasOwn(result.status, 'serverCode'), false, 'the reason reads as an answer, not as technical details')
  const submitting = { phase: 'submitting', plan: { title: 'x', payload: { change: { kind: 'set', field: 'token' } } } }
  assert.equal(receiptReducer(submitting, { type: 'resolve', value: { status: 'failed', message: 'blocked', reason: 'environment-reference' } }).status.reason, 'environment-reference')
})

test('a child plugin locked by its parent reads as 已锁定 with the parent level', () => {
  const error = Object.assign(new Error('已被适配器层停用，下级开关已锁定'), { details: { httpStatus: 409, serverCode: 'locked', lockedBy: 'adapter' } })
  const status = statusFromError(error)
  assert.equal(status.kind, 'locked')
  assert.equal(status.lockedBy, 'adapter')
  assert.equal(statusFromError(new Error('已被账号层停用，下级开关已锁定')).lockedBy, 'endpoint', 'the level is recovered from the text of an older SDK')
})

test('the 功能 tab shows the persistence and environment-reference notes through i18n', async () => {
  const source = await readFile(new URL('../console-ui/src/pages/features/feature-level-panel.tsx', import.meta.url), 'utf8')
  for (const copy of ['当前数据库不支持持久化，重启后丢失', '不能在这里引用环境变量；如需使用密钥，请在环境变量页配置', '本插件或上级插件 {0} 在那一层停用']) {
    assert.ok(source.includes(`i18n.t('${copy}'`), copy)
    assert.ok(Object.hasOwn(englishMessages, copy), copy)
  }
  assert.match(source, /level === 'conversation' && Object\.values\(details\)\.some\(state => state\.value\?\.persistent === false\)/u)
  assert.match(source, /result\.status === 'saved' && result\.persistent === false/u)
  assert.match(source, /serverCode === 'environment-reference'/u)
})
