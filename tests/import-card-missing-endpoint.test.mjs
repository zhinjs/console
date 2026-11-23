import assert from 'node:assert/strict'
import test from 'node:test'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { chatRoleImportIdentity, chatRoleImportSummary, readChatRoleImports } from '../console-ui/src/scope/chat-role-imports-model.mjs'

// #64 `import-card-missing-endpoint`: two pending imports read 「qq · <同一个 ID>」 although they are the
// same person under two different qq bot accounts (`endpoint` differs in the configuration, the subject
// id is the same). Nothing on the card said which account, so they looked like duplicates and one got
// 「忽略」. Suggested: 「qq · 账号 <endpoint> · <subjectId>」.
const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
const CJK = /[一-鿿]/u

test('two candidates for the same person on two accounts no longer read the same', () => {
  const { rows } = readChatRoleImports({
    pending: [
      { id: 'a', source: 'qq.endpoints[0].master', level: 'adapter', key: 'qq', adapter: 'qq', userId: '10001', role: 'owner' },
      { id: 'b', source: 'qq.endpoints[1].master', level: 'adapter', key: 'qq', adapter: 'qq', userId: '10001', role: 'owner' },
    ],
  })
  const [first, second] = rows.map(row => chatRoleImportSummary(row, zh))
  assert.notEqual(first, second)
  // Without an account id in the reply, the configuration path still tells them apart.
  assert.equal(chatRoleImportIdentity(rows[0], zh), 'qq · 配置第 1 个账号 · 10001')
  assert.equal(chatRoleImportIdentity(rows[1], zh), 'qq · 配置第 2 个账号 · 10001')
  assert.doesNotMatch(chatRoleImportIdentity(rows[1], en), CJK)
})

test('the account is named 「账号 <endpoint>」 whenever the reply carries it', () => {
  const { rows } = readChatRoleImports({
    pending: [
      // An account-level scope names the account.
      { id: 'e', source: 'qq.endpoints[0].master', level: 'endpoint', key: 'qq/bot-a', adapter: 'qq', userId: '10001', role: 'owner' },
      // A Host that sends `endpoint` on the candidate (not in protocol 1.9 yet) is shown as is.
      { id: 'f', source: 'qq.endpoints[1].master', level: 'adapter', key: 'qq', adapter: 'qq', userId: '10001', role: 'trusted', endpoint: 'bot-b' },
    ],
    personalPending: [{ id: 'p', consoleUserId: 'u-1', adapter: 'qq', userId: '10001', endpoint: 'bot-a', seenAt: 1 }],
  })
  const byId = Object.fromEntries(rows.map(row => [row.id, row]))
  assert.equal(chatRoleImportIdentity(byId.e, zh), 'qq · 账号 bot-a · 10001')
  assert.equal(chatRoleImportIdentity(byId.f, zh), 'qq · 账号 bot-b · 10001')
  assert.equal(chatRoleImportIdentity(byId.p, zh), 'qq · 账号 bot-a · 10001')
  assert.equal(chatRoleImportIdentity(byId.e, en), 'qq · Account bot-a · 10001')
})

test('a candidate that names no account and has no account path stays 「平台 · ID」', () => {
  const { rows } = readChatRoleImports({
    pending: [{ id: 'g', source: 'ai.trigger.trusted', level: 'global', key: '', adapter: 'icqq', userId: '10009', role: 'trusted' }],
    personalPending: [{ id: 'p', consoleUserId: 'u-1', adapter: 'icqq', userId: '10007' }],
  })
  assert.deepEqual(rows.map(row => chatRoleImportIdentity(row, zh)), ['icqq · 10007', 'icqq · 10009'])
  // A path of another adapter's accounts says nothing about this one.
  const other = readChatRoleImports({ pending: [{ id: 'h', source: 'icqq.endpoints[3].master', level: 'adapter', key: 'qq', adapter: 'qq', userId: '1', role: 'owner' }] }).rows[0]
  assert.equal(chatRoleImportIdentity(other, zh), 'qq · 1')
})
