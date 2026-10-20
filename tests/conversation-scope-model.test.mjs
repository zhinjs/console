import test from 'node:test'
import assert from 'node:assert/strict'
import { isConversationScopeField, scopeAllowedKinds, endpointKey, targetDraftIssue, updateTargetField, updateTargetParent, createScopeReadGate } from '../console-ui/src/components/PluginConfigForm/conversation-scope-model.mjs'
import { readPreviewEndpoints, buildPreviewTarget } from '../console-ui/src/pages/introspection/target-preview.mjs'

const endpoint = { id: 'root\0zhin.adapter\0qq~account', adapter: 'root/qq' }
const target = { endpoint, kind: 'group', id: '123', parent: { kind: 'channel', id: 'guild' }, threadId: 'thread' }

test('scope metadata accepts Host namespaced projection and derives allowed conversation kinds', () => {
  const field = { type: 'list', 'x-zhin-config': { component: 'conversation-scope' }, inner: { type: 'object', object: { kind: {type: 'string', enum: ['group']} } } }
  assert.equal(isConversationScopeField(field), true)
  assert.deepEqual(scopeAllowedKinds(field), ['group'])
  assert.equal(isConversationScopeField({...field, type:'string'}), false)
  assert.deepEqual(scopeAllowedKinds({inner:{type:'object',object:{kind:{options:[{value:'channel',label:'频道'}]}}}}), ['channel'])
})

test('field updates preserve unknown siblings and partial invalid drafts instead of normalizing identity', () => {
  const original = {...target, extra: {keep: true}, parent:{...target.parent, extension:'keep'}}
  const partial = updateTargetParent(original, 'id', '')
  assert.equal(partial.parent.id, '')
  assert.equal(partial.parent.extension, 'keep')
  assert.deepEqual(partial.extra, {keep:true})
  assert.match(targetDraftIssue(partial), /必须同时填写/)
  assert.equal(original.parent.id, 'guild')
  const whitespace = updateTargetField(original, 'id', ' 123 ')
  assert.equal(whitespace.id, ' 123 ')
  const removed = updateTargetField(original, 'parent', undefined)
  assert.equal(Object.hasOwn(removed,'parent'), false)
  assert.equal(removed.threadId, 'thread')
  assert.equal(targetDraftIssue({...target, threadId:''}), '话题 ID 不能为空；没有话题时请明确移除。')
})

test('exact identity keys never collapse equal nicknames or naked conversation IDs', () => {
  const other = {...endpoint, adapter:'root/second'}
  assert.notEqual(endpointKey(endpoint), endpointKey(other))
  assert.equal(endpointKey({adapter:endpoint.adapter,id:endpoint.id}), endpointKey(endpoint))
  const rows = readPreviewEndpoints({endpoints:[{name:'同名',endpoint,connected:true},{name:'同名',endpoint:other}]})
  assert.equal(rows.length, 2)
  assert.notEqual(endpointKey(rows[0].endpoint), endpointKey(rows[1].endpoint))
  assert.equal(targetDraftIssue(target,['group']), null)
  assert.match(targetDraftIssue({...target,kind:'private'},['group']), /允许的会话类型/)
  const exact = buildPreviewTarget(endpoint, {kind:'group',id:'123'})
  assert.equal(Object.hasOwn(exact,'parent'), false)
  assert.equal(Object.hasOwn(exact,'threadId'), false)
})

test('late account reads cannot publish after unmount, a replacement request or Host/credential scope changes', async () => {
  let scope = 'host-A-credential-A', resolve
  const gate = createScopeReadGate(() => scope)
  const first = gate.begin(), late = new Promise(yes => {resolve=yes})
  const published = []
  const pending = late.then(rows => {if(first.current()) published.push(...rows)})
  scope = 'host-B-credential-B'; resolve([endpoint]); await pending
  assert.deepEqual(published, [])
  const second = gate.begin(); gate.begin(); assert.equal(second.current(), false)
  const third = gate.begin(); gate.cancel(); assert.equal(third.current(), false)
  scope = undefined; assert.equal(gate.begin().current(), false)
})
