// zhinjs/zhin #1250 第 87 / 88 批 (backend 8fb58725c / 65623b409, shipped in the next patch): the fields
// are optional, so every block also checks that a Host without them keeps the previous display.
// Plus the 无权限 panel for pages the principal cannot open (b89 follow-up).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as protocol from '@zhin.js/console-protocol'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'
import { CHAT_ROLE_COPY, chatRoleRefusal } from '../console-ui/src/scope/chat-roles-model.mjs'
import {
  grantCandidates, isSimulatedOnly, promoteGlobalOwnerRequest, readPrincipal, readRecentIdentities, readSimulatedSendersOmitted,
} from '../console-ui/src/scope/chat-identity-model.mjs'
import { normalizeAttentionItem } from '../console-ui/src/pages/attention/attention-model.mjs'
import { driftKindLabel, driftRows, isDriftDivergence, readConfigDrift } from '../console-ui/src/pages/scope/config-drift-model.mjs'
import { deniedRoutePermissions } from '../console-ui/src/navigation-sections.mjs'
import { createConsoleAccess } from '../console-ui/src/utils/console-access.mjs'

const source = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const cjk = /[㐀-鿿]/u

/** Transpiles one component; relative `.mjs` imports load the real model, the rest come from `mocks`. */
function component(path, mocks, locale = 'zh-CN') {
  const file = new URL(`../console-ui/src/${path}`, import.meta.url)
  const local = createRequire(file)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const i18n = { locale, t: (key, values) => translate(locale, key, values) }
  const resolve = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (/(?:^|\/)i18n$/.test(name)) return { useI18n: () => i18n }
    if (name.endsWith('.css')) return {}
    if (name.startsWith('.') && name.endsWith('.mjs')) return local(name)
    if (name.startsWith('.')) throw new Error(`unmocked import ${name}`)
    return local(name)
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(resolve, module.exports, module)
  return module.exports
}

// ── (a) 聊天角色 → 授予角色 ────────────────────────────────────────────────────────────────

const HOST_REFUSAL = '不能把角色授予模拟适配器 sandbox 上的 sandbox-user：Sandbox 里手填的发送者是模拟身份，消息以保留 id 发出、从不解析 zhin 角色，这条授予不会生效。'

test('a grant refused as simulated-identity shows the Host sentence as sent, never 已完成', () => {
  const refused = Object.assign(new Error(HOST_REFUSAL), { details: { httpStatus: 400, serverCode: 'simulated-identity' } })
  assert.deepEqual(chatRoleRefusal(statusFromError(refused)), { code: 'simulated-identity', message: HOST_REFUSAL })
  // Without a sentence (unexpected) the Console's own copy stands in; it is translated.
  const bare = Object.assign(new Error(''), { details: { httpStatus: 400, serverCode: 'simulated-identity' } })
  assert.deepEqual(chatRoleRefusal(statusFromError(bare)), { code: 'simulated-identity' })
  assert.ok(Object.hasOwn(englishMessages, CHAT_ROLE_COPY.simulatedIdentity))
  // Other coded refusals still stay unknown (only re-read), as before.
  assert.equal(chatRoleRefusal(statusFromError(Object.assign(new Error('x'), { details: { httpStatus: 504, serverCode: 'instance_timeout' } }))), null)
  const panel = source('scope/ChatRolesPanel.tsx')
  assert.match(panel, /refusal\.code === 'simulated-identity'\) return \{ status: 'failed', message: refusal\.message \?\? i18n\.t\(CHAT_ROLE_COPY\.simulatedIdentity\) \}/)
})

test('recent speakers keep simulatedSender and simulatedSendersOmitted; older Hosts send neither', () => {
  const reply = {
    identities: [
      { adapter: 'sandbox', userId: 'console-u1', lastSeenAt: 5 },
      { adapter: 'sandbox', userId: 'sandbox-user', simulatedSender: true },
      { adapter: 'qq', userId: '1', simulatedSender: 'yes' },
    ],
    simulatedSendersOmitted: ['sandbox', 'sandbox', 3, ''],
  }
  const recent = readRecentIdentities(reply)
  assert.deepEqual(recent.map(identity => identity.simulatedSender ?? false), [false, true, false], 'only `true` counts')
  assert.deepEqual(readSimulatedSendersOmitted(reply), ['sandbox'])
  assert.deepEqual(readSimulatedSendersOmitted({ identities: [] }), [], 'older Host')
  const candidates = grantCandidates({ recent })
  assert.deepEqual(candidates.map(row => [row.userId, row.simulatedSender ?? false]), [['console-u1', false], ['sandbox-user', true], ['1', false]])
})

function renderPicker({ recent = [], principals = [], omitted = [] } = {}, locale = 'zh-CN') {
  const ready = { status: 'ready', recent, principals, simulatedOmitted: omitted }
  const { GrantIdentityPicker } = component('scope/ChatIdentityPanels.tsx', {
    react: {
      ...React,
      // The picker reads its candidates in an effect; render it as if that read had answered.
      useState: initial => { const value = typeof initial === 'function' ? initial() : initial; return [value && typeof value === 'object' && 'recent' in value ? ready : value, () => {}] },
      useEffect: () => {},
    },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
    '@zhin.js/console-ui': { Badge: 'span', Button: 'button', Card: 'div', Input: 'input', Dialog: 'dialog', DialogContent: 'div', DialogDescription: 'p', DialogFooter: 'footer', DialogHeader: 'header', DialogTitle: 'h2' },
    '../components/StatusState': { StatusState: () => null },
    '../utils/console-rpc': { requestConsole: async () => { throw new Error('unexpected') } },
    './ObjectPageLayout': { ObjectSection: ({ children }) => React.createElement('section', null, children) },
    '../hooks/use-console-access': { useConsoleAccess: () => createConsoleAccess(null) },
  }, locale)
  return renderToStaticMarkup(React.createElement(GrantIdentityPicker, { scope: {}, alias: null, value: null, onPick: () => {} }))
}

test('the grant picker disables simulated senders and explains the omitted ones under the list', () => {
  const recent = readRecentIdentities({ identities: [{ adapter: 'sandbox', userId: 'console-u1' }, { adapter: 'sandbox', userId: 'sandbox-user', simulatedSender: true }] })
  const html = renderPicker({ recent, omitted: ['sandbox'] })
  const options = html.match(/<button[^>]*role="option"[^>]*>.*?<\/button>/gu)
  assert.equal(options.length, 2)
  assert.doesNotMatch(options[0], /disabled/)
  assert.match(options[1], /disabled=""/)
  assert.match(options[1], /aria-disabled="true"/)
  assert.match(options[1], /模拟发送者，不会发言/)
  assert.match(html, /<p class="console-admin-note" role="note">模拟发送者不出现在这里；在 Sandbox 打开「以我的聊天身份发言」后，你的 Sandbox 身份会出现<\/p>/)
  const english = renderPicker({ recent, omitted: ['sandbox'] }, 'en')
  assert.match(english, /Simulated senders are not listed here; once you turn on &quot;Speak as my chat identity&quot; in the Sandbox, your Sandbox identity appears/)
  assert.match(english, /Simulated sender, never speaks/)
  // An older Host: no flag, no note.
  const older = renderPicker({ recent: readRecentIdentities({ identities: [{ adapter: 'qq', userId: '1' }] }) })
  assert.doesNotMatch(older, /模拟发送者/)
  assert.doesNotMatch(older, /disabled/)
})

// ── (b) 聊天成员 ──────────────────────────────────────────────────────────────────────────────

test('a member whose identities are simulated senders reads 「模拟发送者，不会发言」 and cannot be promoted', () => {
  const simulated = readPrincipal({ id: 'implicit:sandbox:sandbox-user', identities: [{ adapter: 'sandbox', userId: 'sandbox-user', simulatedSender: true }] })
  const mixed = readPrincipal({ id: 'cp_1', identities: [{ adapter: 'sandbox', userId: 'sandbox-user', simulatedSender: true }, { adapter: 'sandbox', userId: 'console-u1' }] })
  const older = readPrincipal({ id: 'cp_2', identities: [{ adapter: 'qq', userId: '1' }] })
  assert.equal(isSimulatedOnly(simulated), true)
  assert.equal(isSimulatedOnly(mixed), false)
  assert.equal(isSimulatedOnly(older), false, 'older Host: no flag, still 「90 天内没有发言」')
  assert.equal(promoteGlobalOwnerRequest(mixed).userId, 'console-u1', 'the grant goes to the identity that speaks')
  assert.throws(() => promoteGlobalOwnerRequest(simulated), /speaks/)
  const page = source('pages/chat-members/index.tsx')
  assert.match(page, /isSimulatedOnly\(principal\) \? i18n\.t\(CHAT_ROLE_COPY\.simulatedSender\) : i18n\.t\('90 天内没有发言'\)/)
  const panels = source('scope/ChatIdentityPanels.tsx')
  assert.match(panels, /identity\.simulatedSender \? <em>\{i18n\.t\(CHAT_ROLE_COPY\.simulatedSender\)\}<\/em>/, 'the identity chip says so too')
  assert.match(panels, /disabled=\{busy \|\| !speaks\}/, '「设为全局 owner」 is disabled without an identity that speaks')
  assert.equal(translate('en', CHAT_ROLE_COPY.simulatedSender), 'Simulated sender, never speaks')
})

// ── (c) 需要你处理 / 首页: chat-roles.no-owner ──────────────────────────────────────────────

const noOwner = (extra = {}) => ({
  id: 'chat-roles.no-owner', revision: 'r', kind: 'chat-roles.no-owner', severity: 'warning', title: '还没有聊天主人',
  detail: '当前只装了模拟适配器（Sandbox），认领与绑定在这里都不被接受……', action: { label: '聊天角色', path: '/scope?tab=roles' }, source: 'roles', ...extra,
})

test('chat-roles.no-owner keeps the Host detail and offers 打开 Sandbox only for a Sandbox-only project', () => {
  const plain = normalizeAttentionItem(noOwner())
  assert.equal(plain.detail, noOwner().detail, 'the Host detail is shown as sent')
  assert.equal(plain.simulationOnly, undefined, 'a Host without the flag gets the plain item')
  assert.equal(normalizeAttentionItem(noOwner({ state: { simulationOnly: true } })).simulationOnly, true)
  assert.equal(normalizeAttentionItem(noOwner({ kind: 'mcp.disconnected', state: { simulationOnly: true } })).simulationOnly, undefined, 'only for no-owner')

  const mocks = {
    'lucide-react': new Proxy({}, { get: () => 'i' }),
    'react-router-dom': { Link: ({ to, children }) => React.createElement('a', { href: to }, children) },
    '@zhin.js/console-ui': { Button: ({ children, asChild: _asChild, ...props }) => React.createElement('span', props, children), cn: (...names) => names.filter(Boolean).join(' '), InlineCode: 'code' },
    '../../console-routes.mjs': { CONSOLE_PATHS: { sandbox: '/sandbox' } },
  }
  const more = component('pages/attention/AttentionMore.tsx', mocks)
  const { AttentionItemRow } = component('pages/attention/AttentionItemRow.tsx', { ...mocks, './AttentionMore': more })
  const { AttentionSummaryList } = component('pages/attention/AttentionSummaryList.tsx', { ...mocks, './AttentionMore': more, './AttentionItemRow': { AttentionSeverityIcon: () => null } })
  const sandboxItem = normalizeAttentionItem(noOwner({ state: { simulationOnly: true } }))
  const row = renderToStaticMarkup(React.createElement(AttentionItemRow, { item: sandboxItem, now: Date.now() }))
  assert.match(row, /<a href="\/sandbox"><i><\/i>打开 Sandbox<\/a>/)
  assert.match(row, /当前只装了模拟适配器/)
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(AttentionItemRow, { item: plain, now: Date.now() })), /打开 Sandbox/)
  const summary = renderToStaticMarkup(React.createElement(AttentionSummaryList, { items: [sandboxItem] }))
  assert.match(summary, /<a href="\/sandbox"><i><\/i>打开 Sandbox<\/a>/)
  assert.equal(translate('en', '打开 Sandbox'), 'Open Sandbox')
})

// ── (d) 账号页 endpoint-drift ────────────────────────────────────────────────────────────────

const drift = (entries) => ({ authority: 'snapshot', revision: 4, generation: 7, canImport: true, canWriteback: true, entries, unverified: [] })

test('an account added in the Console reads 「Console 新增」, keeps 写回配置文件 and is not a divergence', () => {
  const read = readConfigDrift(drift([
    { id: 'bot-c', kind: 'snapshot_only', origin: 'console' },
    { id: 'bot-b', kind: 'snapshot_only' },
    { id: 'bot-a', kind: 'changed', origin: 'console' },
  ]))
  assert.deepEqual(read.entries.map(entry => entry.origin ?? null), ['console', null, null], 'origin only counts on snapshot_only')
  assert.equal(isDriftDivergence(read.entries[0]), false)
  assert.equal(isDriftDivergence(read.entries[1]), true)
  assert.equal(driftKindLabel('snapshot_only', 'zh-CN', 'console'), 'Console 新增')
  assert.equal(driftKindLabel('snapshot_only', 'en', 'console'), 'Added in the Console')
  assert.equal(driftKindLabel('snapshot_only'), '配置文件中没有', 'older Host: the previous label')

  const contextValue = { adapter: 'qq', pluginId: 'root/qq', drift: readConfigDrift(drift([{ id: 'bot-c', kind: 'snapshot_only', origin: 'console' }])), busy: null, run: async () => {} }
  const render = (value, locale = 'zh-CN') => {
    const { ConfigDriftSection } = component('pages/scope/configured-account-actions.tsx', {
      react: { ...React, useContext: () => value },
      'lucide-react': { FileDown: 'i', FileUp: 'i', ShieldOff: 'i' },
      '@zhin.js/client': { resolvePluginId: async () => 'root/qq' },
      '@zhin.js/console-ui': { Alert: ({ variant, children }) => React.createElement('aside', { 'data-variant': variant }, children), AlertDescription: 'div', AlertTitle: 'h4', Badge: ({ variant, children }) => React.createElement('span', { 'data-variant': variant }, children), Button: 'button', useConfirm: () => ({ confirm: async () => true, ConfirmDialog: null }) },
      '../../components/status-state-model.mjs': { statusFromError: () => ({ message: '' }) },
      '../../hooks/use-console-access': { useConsoleAccess: () => createConsoleAccess(null) },
      '../../utils/plugin-rpc': { pluginRpc: async () => { throw new Error('unexpected') } },
    }, locale)
    return renderToStaticMarkup(React.createElement(ConfigDriftSection))
  }
  const added = render(contextValue)
  assert.match(added, /data-variant="default"/, 'not a warning')
  assert.match(added, /Console 新增的账号还没写进配置文件/)
  assert.match(added, /<span data-variant="secondary">Console 新增<\/span>/)
  assert.match(added, /写回配置文件/)
  assert.doesNotMatch(added, /已不在配置文件|配置文件中没有|账号与配置文件不一致/)
  assert.doesNotMatch(render(contextValue, 'en').replace(/bot-c/g, ''), cjk)
  // A real divergence next to it keeps the warning.
  const both = render({ ...contextValue, drift: readConfigDrift(drift([{ id: 'bot-c', kind: 'snapshot_only', origin: 'console' }, { id: 'bot-b', kind: 'snapshot_only' }])) })
  assert.match(both, /data-variant="warning"/)
  assert.match(both, /账号与配置文件不一致/)
  assert.match(both, /<span data-variant="warning">配置文件中没有<\/span>/)
  assert.equal(driftRows(contextValue.drift).length, 1)
})

// ── (e) 初始化向导第 1 步 ────────────────────────────────────────────────────────────────────

test('setup step 1 says plugin data lives in the database and Console accounts in the gateway', () => {
  const wizard = source('pages/setup/setup-wizard.tsx')
  const copy = '插件数据、聊天记录等存放在这里；Console 账号由网关单独保存。可以先保持当前数据库，以后在「运维 → 配置文件」里修改。每一步都会保存在 Host 上，中途关闭页面后用同一个初始化链接回来会从这里继续。'
  assert.ok(wizard.includes(copy))
  assert.doesNotMatch(wizard, /账号、角色与审计日志存放在这里/)
  assert.match(englishMessages[copy], /^Plugin data, chat history and the like are stored here; Console accounts are kept separately by the gateway\./)
})

// ── (f) 无权限 ─────────────────────────────────────────────────────────────────────────────

test('a page the principal cannot open is replaced by the 无权限 panel naming the permissions', () => {
  const operator = createConsoleAccess({ permissions: protocol.CONSOLE_BUILTIN_ROLES.operator.permissions })
  assert.deepEqual(deniedRoutePermissions({ path: '/ops/config', meta: { group: '运维' } }, operator), ['ops.config.read', 'ops.config.write'])
  assert.deepEqual(deniedRoutePermissions({ path: '/access/users', meta: { group: '访问控制' } }, operator), ['iam.view'])
  assert.equal(deniedRoutePermissions({ path: '/ops/schedules', meta: { group: '运维' } }, operator), null, 'operator reads schedules')
  assert.equal(deniedRoutePermissions({ path: '/ops/config' }, createConsoleAccess(null)), null, 'older Host: unrestricted')
  // A plugin page whose own requiredPermissions are missing names those.
  assert.deepEqual(deniedRoutePermissions({ path: '/p-x', meta: { group: '功能' }, requiredPermissions: ['ops.restart'] }, operator), ['ops.restart'])
  const layout = source('layouts/dashboard.tsx')
  assert.match(layout, /!Object\.hasOwn\(LEGACY_ROUTE_REDIRECTS, navigation\.current\.path\) && !isPluginPageRedirect\(navigation\.current\.path\)/, 'redirects still redirect')
  assert.match(layout, /\{deniedPermissions \? <StatusState kind="forbidden" permissions=\{deniedPermissions\} \/> : <Outlet \/>\}/)
})

test('访问控制 never says 「只能查看」 next to a 无权限 panel', () => {
  const render = (permissions, errorKind) => {
    const { ReadOnlyNotice } = component('pages/access/access-components.tsx', {
      'lucide-react': new Proxy({}, { get: () => 'i' }),
      '@zhin.js/console-ui': { Badge: 'span', Button: 'button', Checkbox: 'input', Input: 'input', SelectField: 'select' },
      '../../components/StatusState': { StatusState: () => null },
      '../features/use-feature-data': { useEndpointList: () => ({ data: [] }) },
      '../../hooks/use-console-access': { useConsoleAccess: () => createConsoleAccess(permissions) },
    })
    return renderToStaticMarkup(React.createElement(ReadOnlyNotice, { errorKind }))
  }
  assert.match(render({ permissions: ['iam.view'] }, null), /当前身份只能查看访问控制/)
  assert.equal(render({ permissions: ['iam.view'] }, 'forbidden'), '', 'the Host refused the read: only the 无权限 panel')
  assert.equal(render({ permissions: ['status.view'] }, null), '', 'without iam.view the page is the 无权限 panel')
})

test('every new string has an English translation', () => {
  for (const key of [
    CHAT_ROLE_COPY.simulatedIdentity, CHAT_ROLE_COPY.simulatedSender, CHAT_ROLE_COPY.simulatedSendersOmitted, '打开 Sandbox', 'Console 新增',
    'Console 新增的账号还没写进配置文件', '这些账号是在 Console 里新增的，按已保存的账号照常运行；需要让 zhin.config.yml 也记下它们时，写回配置文件。',
  ]) {
    assert.ok(Object.hasOwn(englishMessages, key), key)
    assert.doesNotMatch(englishMessages[key], cjk, key)
  }
})
