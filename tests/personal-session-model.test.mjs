import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isPersonalSessionKey,
  readPersonalSessionRows,
  readPersonalSessionState,
  samePersonalSessionSelection,
} from '../console-ui/src/pages/personal-session-model.mjs'
import { isLikelySessionKey, parseImSessionKey } from '../console-ui/src/utils/agent-session.ts'

const key = `personal-session:v1:${'a'.repeat(64)}`
const owner = {
  rootId: '/host',
  platform: 'qq',
  endpoint: 'account',
  adapterId: 'root\0adapter\0qq',
  subjectId: 'user',
}
const address = {
  rootId: owner.rootId,
  platform: owner.platform,
  endpoint: owner.endpoint,
  subjectId: owner.subjectId,
  conversation: {
    endpoint: { adapter: 'feature', id: owner.adapterId },
    kind: 'channel',
    id: 'room',
    parent: { kind: 'group', id: 'guild' },
    threadId: 'topic',
  },
}

test('selection equality uses every persistent identity field and ignores mutable Profile content', () => {
  const profile = {
    id: 'p',
    rootId: '/host',
    accountId: 'account',
    accountIncarnation: 'one',
    kind: 'language',
  }
  const selected = { kind: 'profile', profile }
  for (const field of ['id', 'rootId', 'accountId', 'accountIncarnation', 'kind'])
    assert.equal(
      samePersonalSessionSelection(selected, {
        kind: 'profile',
        profile: { ...profile, [field]: 'different' },
      }),
      false,
      field
    )
  assert.equal(
    samePersonalSessionSelection(selected, {
      kind: 'profile',
      profile: { ...profile, revision: 3, model: 'new-native', parameters: { temperature: 0.5 } },
    }),
    true
  )
  assert.equal(samePersonalSessionSelection({ kind: 'inherit' }, { kind: 'inherit' }), true)
  assert.equal(samePersonalSessionSelection(selected, { kind: 'inherit' }), false)
  assert.equal(samePersonalSessionSelection(undefined, undefined), false)
})

test('recognizes only complete personal hashes without pretending they are legacy IM identities', () => {
  assert.equal(isLikelySessionKey(key), true)
  assert.equal(parseImSessionKey(key), null)
  for (const value of [
    'personal-session:v1:fake',
    `personal-session:v2:${'a'.repeat(64)}`,
    `im:${key}`,
    'qq:account:group:room',
  ])
    assert.equal(isPersonalSessionKey(value), false)
})
test('keeps every canonical personal address dimension from the owner-scoped Host directory', () => {
  const body = {
    success: true,
    data: { rows: [{ sessionKey: key, address, updatedAt: 1 }], hasMore: true },
  }
  assert.deepEqual(readPersonalSessionRows(body, owner), body.data)
  for (const property of ['rootId', 'platform', 'endpoint', 'subjectId']) {
    assert.throws(() =>
      readPersonalSessionRows(
        {
          ...body,
          data: {
            ...body.data,
            rows: [{ ...body.data.rows[0], address: { ...address, [property]: 'foreign' } }],
          },
        },
        owner
      )
    )
  }
  const partial = {
    ...address,
    conversation: { ...address.conversation, parent: { kind: 'group' } },
  }
  assert.throws(() =>
    readPersonalSessionRows(
      {
        success: true,
        data: { rows: [{ sessionKey: key, address: partial, updatedAt: 1 }], hasMore: false },
      },
      owner
    )
  )
})
test('requires the selection GET identity to match the selected hash and complete address', () => {
  const view = {
    success: true,
    data: {
      state: {
        identity: { key, address },
        revision: 3,
        selection: {
          kind: 'profile',
          profile: {
            id: 'explicit-missing-reference',
            rootId: '/host',
            accountId: 'account',
            accountIncarnation: 'one',
            kind: 'language',
          },
        },
      },
      presets: { personal: [], deployment: [] },
    },
  }
  assert.equal(
    readPersonalSessionState(view.data.state, key, address).selection.profile.id,
    'explicit-missing-reference'
  )
  assert.throws(() =>
    readPersonalSessionState(view.data.state, `personal-session:v1:${'b'.repeat(64)}`, address)
  )
  assert.throws(() =>
    readPersonalSessionState(view.data.state, key, {
      ...address,
      conversation: { ...address.conversation, threadId: 'another-topic' },
    })
  )
  assert.throws(() => readPersonalSessionState(view.data.state, 'qq:account:group:room', address))
})
