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
