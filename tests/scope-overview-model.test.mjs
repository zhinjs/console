import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ONBOARDING_PLATFORMS, accountCounts, accountStatus, adapterOverview, conversationHighlights, endpointAccessState, filterAccounts, loginTasksFor,
  overviewTotals, platformLabel, onboardingTarget,
} from '../console-ui/src/pages/scope/scope-overview-model.mjs'
import { ambientSettingsHref } from '../console-ui/src/pages/insights/scope-filter.mjs'
import { resolveLegacyRedirect } from '../console-ui/src/console-routes.mjs'
import { chatRoleMappingsRequest, mappingMatchParts, readChatRoleMappings } from '../console-ui/src/scope/chat-roles-model.mjs'
import { objectPageOwnsBreadcrumb } from '../console-ui/src/scope/scope-tree.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const endpoints = [
  { name: 'bot-1', adapter: 'qq', connected: true, status: 'online', pendingRequestCount: 1, pendingNoticeCount: 2 },
  { name: 'bot-2', adapter: 'qq', connected: false, status: 'offline' },
  { name: 'tg', adapter: 'telegram', connected: false, status: 'offline', pendingLogin: true },
]
const tasks = [{ id: 't1', adapter: 'qq', endpointKey: 'bot-2', type: 'qrcode' }]

test('adapter overview counts accounts, online, pending events, logins and configured-only accounts', () => {
  const items = adapterOverview(endpoints, { tasks, known: { qq: ['bot-1', 'bot-3', 'bot-3'], discord: ['d1'] } })
  assert.deepEqual(items.map(item => item.adapter), ['discord', 'qq', 'telegram'])
  assert.deepEqual(items[1], { adapter: 'qq', accounts: 2, online: 1, pending: 3, waitingLogin: 1, configuredOnly: ['bot-3'] })
  assert.deepEqual(items[0], { adapter: 'discord', accounts: 0, online: 0, pending: 0, waitingLogin: 0, configuredOnly: ['d1'] })
  assert.deepEqual(overviewTotals(items), { adapters: 3, accounts: 3, online: 1, pending: 3, waitingLogin: 1 })
})

test('account status, filters and counts treat an open login task as 等待登录', () => {
  assert.equal(accountStatus(endpoints[0], tasks), 'online')
  assert.equal(accountStatus(endpoints[1], tasks), 'waiting')
  assert.equal(accountStatus(endpoints[2], []), 'waiting')
  assert.equal(accountStatus(endpoints[1], []), 'offline')
  assert.deepEqual(accountCounts(endpoints, tasks), { all: 3, online: 1, waiting: 2, offline: 0 })
  assert.deepEqual(filterAccounts(endpoints, { filter: 'waiting', tasks }).map(item => item.name), ['bot-2', 'tg'])
  assert.deepEqual(filterAccounts(endpoints, { query: 'TELE' }).map(item => item.name), ['tg'])
  assert.deepEqual(loginTasksFor(tasks, 'qq', 'bot-2'), tasks)
  assert.deepEqual(loginTasksFor(tasks, 'qq', 'bot-1'), [])
  assert.deepEqual(loginTasksFor(tasks, 'qq'), tasks)
})

test('the 接入 tab tells an unlisted account apart from loading, failure and a listed one', () => {
  assert.deepEqual(endpointAccessState({ loaded: false, endpoints: [] }, 'qq', 'bot-1'), { kind: 'loading' })
  const error = new Error('boom')
  assert.deepEqual(endpointAccessState({ loaded: false, error, endpoints: [] }, 'qq', 'bot-1'), { kind: 'failed', error })
  assert.deepEqual(endpointAccessState({ loaded: true, endpoints }, 'qq', 'bot-1'), { kind: 'listed', endpoint: endpoints[0], siblings: 2 })
  // Not "no accounts at all": the account is just not running, and its adapter may still run others.
  assert.deepEqual(endpointAccessState({ loaded: true, endpoints }, 'qq', 'ghost'), { kind: 'unlisted', siblings: 2 })
  assert.deepEqual(endpointAccessState({ loaded: true, endpoints }, 'kook', 'k'), { kind: 'unlisted', siblings: 0 })
  // A row read earlier still wins over a later failure.
  assert.equal(endpointAccessState({ loaded: true, error, endpoints }, 'qq', 'bot-2').kind, 'listed')
})

test('the account 概览 shows a few overridden and recent conversations, not the full list', () => {
  const items = [
    { key: 'a', hasOverrides: true, lastActiveAt: 1 },
    { key: 'b', hasOverrides: false, lastActiveAt: 5 },
    { key: 'c', hasOverrides: false },
    { key: 'd', hasOverrides: true, lastActiveAt: 9 },
    { key: 'e', hasOverrides: false, lastActiveAt: 7 },
  ]
  const result = conversationHighlights(items, 1)
  assert.deepEqual(result.overridden.map(item => item.key), ['d'])
  assert.deepEqual(result.recent.map(item => item.key), ['e'])
  assert.equal(result.total, 5)
  assert.deepEqual(conversationHighlights(items).recent.map(item => item.key), ['e', 'b'])
})

test('platform labels and onboarding copy have English entries', () => {
  assert.equal(platformLabel('@zhin.js/adapter-icqq'), 'ICQQ 协议端')
  assert.equal(platformLabel('custom'), 'custom')
  for (const platform of ONBOARDING_PLATFORMS) for (const text of [platform.title, platform.badge, platform.desc]) if (/[\u3400-\u9fff]/u.test(text)) assert.ok(englishMessages[text], text)
})

test('mapping rules: no request at 全局; malformed layers and removed rules are dropped', () => {
  assert.equal(chatRoleMappingsRequest({ level: 'global' }), null)
  assert.deepEqual(chatRoleMappingsRequest({ adapter: 'qq', endpoint: 'bot' }), { type: 'chat-roles.mappings', level: 'endpoint', key: 'qq/bot' })
  const read = readChatRoleMappings({
    layers: [{ level: 'default', rules: [{ match: { standing: ['owner', 1] }, grant: 'admin' }, { match: {}, grant: 'boss' }] }, { level: 'nope', rules: [] },
      { level: 'conversation', rules: [], inherit: false, revision: 3 }],
    effective: [{ match: { standing: ['owner'] }, grant: 'admin', level: 'default' }, { match: { role: ['x'] }, grant: 'none', level: 'adapter' }, { match: {}, grant: 'admin' }],
  })
  assert.deepEqual(read.layers.map(layer => [layer.level, layer.rules.length, layer.inherit]), [['default', 1, true], ['conversation', 0, false]])
  assert.deepEqual(read.layers[0].rules[0].match, { standing: ['owner'], role: [], permission: [] })
  assert.equal(read.layers[1].revision, 3)
  assert.deepEqual(read.effective, [{ match: { standing: ['owner'], role: [], permission: [] }, grant: 'admin', level: 'default' }])
  assert.deepEqual(readChatRoleMappings(null), { layers: [], effective: [] })
  assert.deepEqual(mappingMatchParts(undefined), { standing: [], role: [], permission: [] })
})

test('one breadcrumb per page: object pages below 全局 own it, the shell keeps it elsewhere', () => {
  assert.equal(objectPageOwnsBreadcrumb('/scope'), false)
  assert.equal(objectPageOwnsBreadcrumb('/scope/qq'), true)
  assert.equal(objectPageOwnsBreadcrumb('/scope/qq/bot/group%3A1'), true)
  assert.equal(objectPageOwnsBreadcrumb('/scope/qq/bot/bad-segment'), true)
  assert.equal(objectPageOwnsBreadcrumb('/logs'), false)
  const layout = readFileSync(new URL('../console-ui/src/layouts/dashboard.tsx', import.meta.url), 'utf8')
  assert.match(layout, /objectPageOwnsBreadcrumb\(location\.pathname\)/)
})

test('group conversations link straight to 群聊插话 (not the legacy redirect); private chats do not', () => {
  assert.equal(ambientSettingsHref({ level: 'conversation', adapter: 'qq', endpoint: 'bot/1', kind: 'group', id: 'a/b%c' }),
    '/features/ai/ambient?adapter=qq&endpoint=bot%2F1&conversation=group%3Aa%2Fb%25c')
  // Old bookmarks keep their scope through the redirect.
  assert.equal(resolveLegacyRedirect('/agent/ambient', '?adapter=qq&endpoint=bot%2F1&conversation=group%3Aa%2Fb%25c'),
    '/features/ai/ambient?adapter=qq&endpoint=bot%2F1&conversation=group%3Aa%2Fb%25c')
  assert.equal(ambientSettingsHref({ level: 'conversation', adapter: 'qq', endpoint: 'bot', kind: 'private', id: '1' }), null)
  assert.equal(ambientSettingsHref({ level: 'conversation', adapter: 'qq', endpoint: 'bot', kind: 'channel', id: '1' }), null)
  const page = readFileSync(new URL('../console-ui/src/pages/scope/conversation-page.tsx', import.meta.url), 'utf8')
  assert.match(page, /ambientSettingsHref\(scope\)/)
  assert.match(page, /from '\.\.\/insights\/scope-filter\.mjs'/)
})

test('接入新平台账号: an adapter page that is not registered sends the card to the marketplace', () => {
  const icqq = ONBOARDING_PLATFORMS.find(item => item.id === 'icqq')
  assert.deepEqual(onboardingTarget(icqq, new Set(['/icqq'])), { to: '/icqq', install: false })
  assert.deepEqual(onboardingTarget(icqq, new Set()), { to: '/marketplace?category=adapter&q=%40zhin.js%2Fadapter-icqq', install: true })
  const market = ONBOARDING_PLATFORMS.find(item => item.id === 'marketplace')
  assert.deepEqual(onboardingTarget(market, new Set()), { to: '/marketplace', install: false })
  assert.ok(englishMessages['先安装适配器'])
})
