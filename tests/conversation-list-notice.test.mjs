import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationListNotice } from '../console-ui/src/pages/endpoint-detail/conversation-list-notice.mjs'
test('empty and offline results are neutral, while a failed directory is an error', () => {
  assert.deepEqual(conversationListNotice({total:0,connected:true}),{text:'暂无会话。',tone:'neutral'})
  assert.equal(conversationListNotice({total:0,connected:false}).tone,'neutral')
  assert.equal(conversationListNotice({total:0}).text,'尚未获取到会话。')
  assert.deepEqual(conversationListNotice({total:0,connected:false,errors:['denied']}),{text:'会话列表读取失败，请重试。',tone:'error',details:'denied'})
})
test('history fallback never hides directory errors or invents a complete current result', () => {
  assert.equal(conversationListNotice({total:1,historyOnly:true,errors:['denied']}).tone,'warning')
  assert.deepEqual(conversationListNotice({total:1,historyOnly:true}),{text:'当前显示历史会话。',tone:'neutral'})
  assert.equal(conversationListNotice({total:1}),null)
})
test('a list that could not be read at all says why, instead of always 「请重试」', () => {
  const legacy = conversationListNotice({ total: 0, errors: ['好友列表：Unknown RPC type: endpoint.friends'], causes: [new Error('Unknown RPC type: endpoint.friends')] })
  assert.deepEqual(legacy, { text: '当前 Host 不支持读取会话列表，升级 Host 后再试。', tone: 'error', details: '好友列表：Unknown RPC type: endpoint.friends', kind: 'unsupported' })
  const denied = conversationListNotice({ total: 0, errors: ['好友列表：Forbidden'], causes: [new Error('Forbidden')] })
  assert.equal(denied.kind, 'forbidden'); assert.match(denied.text, /没有读取会话列表的权限，重试不会成功/)
  const down = conversationListNotice({ total: 0, errors: ['x'], causes: [{ success: false, code: 'instance_unavailable', error: 'The Zhin instance is not running' }] })
  assert.equal(down.kind, 'instance-unavailable'); assert.match(down.text, /实例恢复后点刷新/)
  assert.equal(conversationListNotice({ total: 0, errors: ['boom'], causes: [new Error('boom')] }).text, '会话列表读取失败，请重试。')
  assert.equal(conversationListNotice({ total: 0, errors: ['x'], causes: [new Error('Forbidden')] }, 'en').text, "Your identity is not allowed to list conversations, so retrying will not help. Ask an administrator for permission to view this account's conversations.")
  assert.equal(conversationListNotice({ total: 2, errors: ['x'], causes: [new Error('Forbidden')] }).tone, 'warning', 'a partial list keeps its existing warning')
})
