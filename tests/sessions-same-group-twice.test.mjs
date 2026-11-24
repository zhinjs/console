import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { sessionLabel, sessionLabelParts } from '../console-ui/src/utils/session-label.mjs'

// #64 `sessions-same-group-twice`: one group showed twice in the session list under the very same
// name — its shared group-chat session (`scene-task:v1:`) and someone's personal session in that
// group (`personal-session:v1:`) — with nothing telling them apart.
const CJK = /[一-鿿]/u
const personal = `personal-session:v1:${'ab12cd34'.repeat(8)}`
const shared = `scene-task:v1:${'9f8e7d6c'.repeat(8)}`
const described = { platform: 'icqq', scopeKind: 'group', sceneLabel: '产品试验群' }

test('a group\'s shared session and a personal session in it no longer read the same', () => {
  const a = sessionLabel({ sessionKey: shared, ...described })
  const b = sessionLabel({ sessionKey: personal, ...described })
  assert.notEqual(a, b)
  assert.equal(a, 'icqq · 群 产品试验群 · 群聊')
  assert.equal(b, 'icqq · 群 产品试验群 · 个人会话')
  // The added word follows the UI language (the group's own name is whatever the Host recorded).
  assert.equal(sessionLabel({ sessionKey: personal, ...described }, 'en'), 'icqq · Group 产品试验群 · Personal session')
  assert.doesNotMatch(sessionLabel({ sessionKey: shared, ...described }, 'en').split(' · ').pop(), CJK)
})

test('an older Host\'s 「平台 · 群 名称」 display name is told apart the same way', () => {
  const displayName = 'icqq · 群 产品试验群'
  assert.equal(sessionLabel({ sessionKey: shared, displayName }), 'icqq · 群 产品试验群 · 群聊')
  assert.equal(sessionLabel({ sessionKey: personal, displayName }), 'icqq · 群 产品试验群 · 个人会话')
})

test('only hashed sessions of a group get the word; the rest read as before', () => {
  // An old-style key names the group itself: nothing to tell apart.
  assert.equal(sessionLabel({ sessionKey: 'icqq:bot:group:20001', ...described }), 'icqq · 群 产品试验群')
  // A personal session of a private chat is not in a group.
  assert.equal(sessionLabel({ sessionKey: personal, platform: 'icqq', scopeKind: 'private', sceneLabel: '演示用户' }), 'icqq · 私聊 演示用户')
  // Without anything from the Host the hashed fallbacks already differ.
  assert.equal(sessionLabel({ sessionKey: personal, platform: 'icqq' }), 'icqq · 私聊会话 #ab12cd34')
  assert.equal(sessionLabel({ sessionKey: shared, platform: 'icqq' }), 'icqq · 群聊 #9f8e7d6c')
  // A channel's shared session is not called a group chat.
  assert.equal(sessionLabel({ sessionKey: shared, platform: 'kook', scopeKind: 'channel', sceneLabel: '公告' }), 'kook · 频道 公告 · 共享会话')
})

test('the narrow session picker puts 「群聊 / 个人会话」 on the second line, where truncation does not hide it', () => {
  assert.deepEqual(sessionLabelParts({ sessionKey: personal, ...described }), { name: 'icqq · 群 产品试验群', kind: '个人会话' })
  assert.deepEqual(sessionLabelParts({ sessionKey: shared, ...described }), { name: 'icqq · 群 产品试验群', kind: '群聊' })
  assert.deepEqual(sessionLabelParts({ sessionKey: 'icqq:bot:group:20001' }), { name: 'icqq · 群 20001', kind: '' })
  const picker = readFileSync(new URL('../console-ui/src/components/AgentSessionPicker.tsx', import.meta.url), 'utf8')
  assert.match(picker, /const \{ name, kind \} = sessionLabelParts\(/)
  assert.match(picker, /text-muted-foreground">\{kind\}\{kind && meta \? ' · ' : null\}\{meta\}/)
})
