import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as locale from '../console-ui/src/i18n/locale.mjs'
import { listUnsupported, conversationListNotice } from '../console-ui/src/pages/endpoint-detail/conversation-list-notice.mjs'
import { deliveryFailureText } from '../console-ui/src/pages/endpoint-detail/chat-workspace-model.mjs'

const root = new URL('../console-ui/src/pages/endpoint-detail/', import.meta.url)
const read = name => readFileSync(new URL(name, root), 'utf8')

function loadLabels() {
  const { outputText } = ts.transpileModule(read('conversation-labels.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const deps = { '../../i18n/locale.mjs': locale, '../../contracts/zhin-console': { ENDPOINT_RPC: { CHANNELS: 'endpoint.channels' } } }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  return module.exports
}

test('an adapter without a channel list is not a read failure', () => {
  assert.equal(listUnsupported(new Error('当前适配器（sandbox）不支持频道列表')), true)
  assert.equal(listUnsupported({ message: 'Adapter sandbox does not support channel list' }), true)
  assert.equal(listUnsupported(new Error('Unknown RPC type: endpoint.channels')), false, 'an old Host is still reported')
  assert.equal(listUnsupported(new Error('Failed to fetch')), false)
  // With the unsupported list left out, the sidebar has nothing to warn about.
  assert.equal(conversationListNotice({ total: 2, errors: [], causes: [], connected: true }), null)
})

test('the chat hook leaves unsupported lists out of the errors and hides their section', () => {
  const hook = read('useChannelManager.tsx')
  assert.match(hook, /if \(listUnsupported\(e\)\) \{ unsupported\.add\(section\); return \}/)
  for (const [section, label] of [['private', '好友列表'], ['group', '群列表'], ['channel', '频道列表']]) {
    assert.match(hook, new RegExp(`failed\\('${section}', "${label}：\\{0\\}", e\\)`), `${label} goes through the unsupported check`)
  }
  assert.match(hook, /const showChannel = \(adapterSupportsChannels\(adapter\) && !unsupportedLists\.has\('channel'\)\) \|\| channelEntries\.length > 0/)
})

test('conversation ids stay strings: sandbox-user and QQ openids are not turned into 0', () => {
  const labels = loadLabels()
  const merged = labels.mergeInboxSessions([], [], [], [
    { channelType: 'private', id: 'sandbox-user', name: 'Sandbox 用户' },
    { channelType: 'group', id: 'EA152C5D9F', name: '测试群' },
  ])
  assert.equal(merged.friends[0].user_id, 'sandbox-user')
  assert.equal(merged.groups[0].group_id, 'EA152C5D9F')
  assert.equal(labels.normalizeFriendRecord({ user_id: 'EA152C5D' }).user_id, 'EA152C5D')
  assert.equal(labels.normalizeFriendRecord({ user_id: 10001, nickname: 'A' }).user_id, '10001')
  assert.equal(labels.normalizeFriendRecord({ user_id: 0 }).user_id, '', 'no id stays empty and is filtered out')
  assert.equal(labels.normalizeGroupRecord({ group_id: '0' }).group_id, '')
  assert.equal(labels.normalizeGroupRecord({ groupId: 'g-1', name: 'G' }).group_id, 'g-1')
})

test('a failed send says what to do instead of the Host\'s bare English error', () => {
  const generic = deliveryFailureText(new Error('Outbound delivery failed.'))
  assert.equal(generic, '平台没有接收这条消息。确认这个账号的客户端已连接后再发送。')
  assert.equal(deliveryFailureText(new Error('Outbound delivery failed.'), 'en'), "The platform did not accept this message. Make sure this account's client is connected, then send it again.")
  assert.equal(deliveryFailureText(new Error('没有 endpoint.operate 权限')), '没有 endpoint.operate 权限', 'a Chinese Host reason names the exact cause and is kept')
  assert.match(deliveryFailureText(new Error('HTTP 403 forbidden')), /没有查看或修改这里的权限/u)
  assert.doesNotMatch(deliveryFailureText(new Error('没有 endpoint.operate 权限'), 'en'), /[㐀-鿿]/u, 'English never shows the Chinese Host text')
})

test('the send path shows the translated failure on the bubble and in the toast', () => {
  const history = read('useMessageHistory.ts')
  assert.match(history, /const failure = deliveryFailureText\(e, i18n\.locale\)\n\s*updateLocal\(\{ delivery, failure \}\)/)
  assert.match(history, /toastError\(failure, i18n\.t\("发送到 \{0\} 失败"/)
  assert.doesNotMatch(history, /failure: \(e as Error\)\.message/)
})
