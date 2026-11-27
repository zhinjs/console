import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { endpointStatusLabel, endpointStatusTone, latestConversations } from '../console-ui/src/pages/dashboard-overview-model.mjs'
import { accountStatus } from '../console-ui/src/pages/scope/scope-overview-model.mjs'

const account = (fields = {}) => ({ name: 'bot', adapter: 'qq', connected: false, ...fields })

test('account rows: 在线 / 待登录 / 连接中 / 离线 with the library status tones', () => {
  assert.equal(endpointStatusTone(account({ connected: true })), 'ok')
  assert.equal(endpointStatusTone(account({ status: 'online' })), 'ok')
  assert.equal(endpointStatusTone(account({ pendingLogin: true })), 'warn')
  assert.equal(endpointStatusTone(account({ transportState: 'connecting' })), 'progress')
  assert.equal(endpointStatusTone(account({ transportState: 'reconnecting' })), 'progress')
  assert.equal(endpointStatusTone(account()), 'neutral')
  assert.equal(endpointStatusTone(null), 'neutral')
  assert.equal(endpointStatusTone(undefined, [{ adapter: 'qq', endpointKey: 'bot' }]), 'neutral')
})

test('待登录 uses the object pages’ test: an unfinished loginStep or a LoginAssist task counts too', () => {
  // ADR 0058: the Host reports an unfinished login flow on the row itself.
  assert.equal(endpointStatusTone(account({ loginStep: { kind: 'qrcode' } })), 'warn')
  assert.equal(endpointStatusTone(account({ loginStep: null })), 'neutral')
  assert.equal(endpointStatusTone(account({ loginStep: 'done' })), 'neutral', 'only an object is a login step')
  // A LoginAssist task (`login.list`) for this account, not for another one.
  const tasks = [{ id: 't1', adapter: 'qq', endpointKey: 'bot' }]
  assert.equal(endpointStatusTone(account(), tasks), 'warn')
  assert.equal(endpointStatusTone(account({ transportState: 'connecting' }), tasks), 'warn', 'a login prompt outranks 连接中')
  assert.equal(endpointStatusTone(account({ name: 'other' }), tasks), 'neutral')
  assert.equal(endpointStatusTone(account({ adapter: 'kook' }), tasks), 'neutral')
  assert.equal(endpointStatusTone(account(), null), 'neutral')
  assert.equal(endpointStatusTone(account(), [null]), 'neutral')
})

test('the overview and the account pages agree on 在线 / 待登录', () => {
  const tasks = [{ id: 't1', adapter: 'qq', endpointKey: 'bot' }]
  const rows = [
    account({ connected: true }),
    account({ connected: true, pendingLogin: true }),
    account({ pendingLogin: true }),
    account({ loginStep: { kind: 'sms' } }),
    account(),
    account({ name: 'other' }),
  ]
  const expected = { online: 'ok', waiting: 'warn' }
  for (const row of rows) {
    const status = accountStatus(row, tasks)
    if (status in expected) assert.equal(endpointStatusTone(row, tasks), expected[status], JSON.stringify(row))
    else assert.notEqual(endpointStatusTone(row, tasks), 'warn', JSON.stringify(row))
  }
})

test('the status word follows the tone and is translated', () => {
  const t = text => `[${text}]`
  assert.equal(endpointStatusLabel(account({ connected: true })), '在线')
  assert.equal(endpointStatusLabel(account(), t, [{ adapter: 'qq', endpointKey: 'bot' }]), '[待登录]')
  assert.equal(endpointStatusLabel(account({ transportState: 'connecting' }), t), '[连接中]')
  assert.equal(endpointStatusLabel(account(), t), '[离线]')
})

test('latest conversations: newest record per conversation, newest first, at most limit', () => {
  const records = [
    { conversationKey: 'a', timestamp: 1 },
    { conversationKey: 'a', timestamp: 5 },
    { conversationKey: 'b', timestamp: 3 },
    null,
    { adapter: 'qq', endpoint: 'bot', kind: 'group', channelId: '1', timestamp: 4 },
    { adapter: 'qq', endpoint: 'bot', kind: 'group', channelId: '1', timestamp: 2 },
  ]
  assert.deepEqual(latestConversations(records).map(record => record.timestamp), [5, 4, 3])
  assert.deepEqual(latestConversations(records, 2).map(record => record.timestamp), [5, 4])
  assert.deepEqual(latestConversations(records, -1), [])
  assert.deepEqual(latestConversations(undefined), [])
})

test('the overview account list passes the LoginAssist tasks and shows a read error with 重试 instead of a skeleton', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
  assert.match(page, /endpointStatusTone\(endpoint, accounts\.tasks\)/)
  assert.match(page, /endpointStatusLabel\(endpoint, i18n\.t, accounts\.tasks\)/)
  const list = page.slice(page.indexOf('aria-labelledby="accounts-title"'), page.indexOf('aria-labelledby="resource-title"'))
  const error = list.indexOf('accounts.error && !accounts.loaded ?')
  assert.ok(error > 0, 'an error branch before the empty state and the skeleton')
  assert.ok(error < list.indexOf('<Skeleton'), 'the error is checked before the skeleton')
  assert.match(list, /<StatusState compact error=\{accounts\.error\} onRetry=\{accounts\.refresh\} \/>/)
})

test('the open-Host banner and the unreachable-Host hero keep their full explanation, in both languages', async () => {
  const { translate } = await import('../console-ui/src/i18n/locale.mjs')
  const banner = readFileSync(new URL('../console-ui/src/components/onboarding-banner.tsx', import.meta.url), 'utf8')
  const risk = '没有访问令牌也没有所有者，任何能访问的人都有全部权限'
  assert.ok(banner.includes(`<span className="console-banner-detail"> · {i18n.t('${risk}')}</span>`), 'the risk is the banner detail')
  assert.equal(translate('en', risk), 'no access token and no owner, so anyone who can reach it has full access')
  const page = readFileSync(new URL('../console-ui/src/pages/dashboard.tsx', import.meta.url), 'utf8')
  const note = '页面导航、配置入口和能力目录保持可用。重新连接后，聊天账号、Agent 与运行状态会在这里恢复。'
  const hero = page.slice(page.indexOf('{!hostAvailable ? <div className="console-overview-hero-muted">'), page.indexOf('<dl className="console-overview-hero-stats">'))
  assert.ok(hero.includes(`i18n.t("控制面仍可继续使用")`) && hero.includes(`i18n.t("${note}")`), 'the short state and the longer note, as secondary text')
  assert.notEqual(translate('en', note), note)
})
