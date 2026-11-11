import test from 'node:test'
import assert from 'node:assert/strict'

const { groupMembersKey, membersForGroup, membersPending } = await import('../console-ui/src/pages/endpoint-detail/group-members-model.mjs')

const group = id => ({ type: 'channel', channelType: 'group', id, name: id })

test('member list identity covers account and group; non-group selections have none', () => {
  assert.equal(groupMembersKey('icqq', 'bot', null), null)
  assert.equal(groupMembersKey('icqq', 'bot', { type: 'requests' }), null)
  assert.equal(groupMembersKey('icqq', 'bot', { type: 'channel', channelType: 'private', id: '1', name: '1' }), null)
  assert.notEqual(groupMembersKey('icqq', 'bot', group('1')), groupMembersKey('icqq', 'bot', group('2')))
  assert.notEqual(groupMembersKey('icqq', 'bot-a', group('1')), groupMembersKey('icqq', 'bot-b', group('1')))
  assert.equal(groupMembersKey('icqq', 'bot', group('1')), groupMembersKey('icqq', 'bot', { ...group('1'), name: 'renamed' }))
})

test('members loaded for one group are never shown for another group', () => {
  const g1 = groupMembersKey('icqq', 'bot', group('1')), g2 = groupMembersKey('icqq', 'bot', group('2'))
  const state = { key: g1, members: [{ user_id: 10 }] }
  assert.deepEqual(membersForGroup(state, g1), [{ user_id: 10 }])
  assert.deepEqual(membersForGroup(state, g2), [])
  assert.deepEqual(membersForGroup(state, null), [])
  assert.deepEqual(membersForGroup({ key: null, members: [{ user_id: 1 }] }, null), [])
})

test('a group whose members have not been read yet is pending, not empty', () => {
  const g1 = groupMembersKey('icqq', 'bot', group('1')), g2 = groupMembersKey('icqq', 'bot', group('2'))
  assert.equal(membersPending({ key: g1, members: [] }, g2), true)
  assert.equal(membersPending({ key: g2, members: [] }, g2), false, 'a finished empty read is a real empty list')
  assert.equal(membersPending({ key: null, members: [] }, null), false)
})
