import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { httpRouteAccess } from '../console-ui/src/utils/http-permission.mjs'
import { sessionsPageDescription } from '../console-ui/src/pages/agent-sessions-description.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `sessions-description-permission-mismatch`: the 聊天记录 description followed endpoint.operate only,
// while 「从这里继续」 follows POST /agent/sessions/<key>/leaf (agent.configure in the protocol, #215).
const canBranch = permissions => httpRouteAccess('POST', '/agent/sessions/_/leaf', name => permissions.includes(name)).allowed
const describe = permissions => sessionsPageDescription({ canChat: permissions.includes('endpoint.operate'), canBranch: canBranch(permissions) })

test('the description names each ability the identity has, and says read-only only when it has neither', () => {
  assert.equal(canBranch(['agent.configure']), true, 'the protocol table maps the leaf route to agent.configure')
  const none = describe([])
  const chat = describe(['endpoint.operate'])
  const branch = describe(['agent.configure'])
  const both = describe(['endpoint.operate', 'agent.configure'])
  assert.match(none, /只读/u)
  for (const text of [chat, branch, both]) assert.doesNotMatch(text, /只读/u)
  assert.match(chat, /接着聊/u); assert.doesNotMatch(chat, /其他消息继续/u, 'an operator has no 「从这里继续」')
  assert.match(branch, /其他消息继续/u); assert.doesNotMatch(branch, /接着聊/u, 'agent.configure alone cannot chat')
  assert.match(both, /接着聊/u); assert.match(both, /其他消息继续/u)
  assert.equal(new Set([none, chat, branch, both]).size, 4)
  for (const text of [none, chat, branch, both]) assert.notEqual(translate('en', text), text, `English for ${text}`)
})

test('the page builds its description from both abilities and keeps readOnly for the trace read', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/agent-sessions.tsx', import.meta.url), 'utf8')
  assert.match(page, /sessionsPageDescription\(\{ canChat: !readOnly, canBranch: canSwitchLeaf \}\)/u)
  assert.match(page, /useConversationTraces\(readOnly \? '' : selectedKey/u)
})
