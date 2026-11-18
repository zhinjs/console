import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { pageRuntime } from './helpers/inference-page-runtime.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as notice from '../console-ui/src/pages/endpoint-detail/conversation-list-notice.mjs'
import * as chatModel from '../console-ui/src/pages/endpoint-detail/chat-workspace-model.mjs'

// #64 `chat-list-double-load`: opening an account's chat read every conversation list twice — once with the
// account info still loading, again when `connected` arrived — because the list loader depended on it.

/** useMemo / useCallback on the runtime's keyed refs, so effects that depend on them settle like React. */
function memo(runtime, make, deps) {
  const ref = runtime.api.useRef(null)
  if (!ref.current || deps.length !== ref.current.deps.length || deps.some((item, i) => !Object.is(item, ref.current.deps[i]))) ref.current = { value: make(), deps }
  return ref.current.value
}

async function mountChat({ empty = false } = {}) {
  const runtime = pageRuntime()
  const calls = []
  const request = async body => {
    calls.push(body.type === 'db:select' ? `db:select ${body.table} ${body.pageSize}` : body.type)
    if (body.type === 'endpoint.friends') return { friends: empty ? [] : [{ user_id: 1, nickname: '演示同事' }] }
    if (body.type === 'endpoint.groups') return { groups: empty ? [] : [{ group_id: 20001, group_name: '产品试验群' }] }
    if (body.type === 'endpoint.channels') return { channels: [] }
    return { rows: [] }
  }
  const i18n = { locale: 'zh-CN', t: (m, v) => translate('zh-CN', m, v) }
  const deps = {
    react: { ...runtime.api, useMemo: (fn, d) => memo(runtime, () => fn(), d), useCallback: (fn, d) => memo(runtime, () => fn, d) },
    '../../i18n': { useI18n: () => i18n },
    './conversation-list-notice.mjs': notice,
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../../components/toast': { useToast: () => ({ success() {}, error() {} }) },
    '../../contracts/zhin-console': { ENDPOINT_RPC: { FRIENDS: 'endpoint.friends', GROUPS: 'endpoint.groups', CHANNELS: 'endpoint.channels' }, SIDE_EVENT_PUSH: {} },
    '../../utils/console-rpc': { requestConsole: request },
    '../../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope-1' },
    '../../utils/inbox-cache': { listInboxCache: () => [], isInboxCacheScopeActive: () => true },
    '../../utils/endpoint-adapter': { adapterSupportsChannels: () => true, adapterSupportsPrivateGroups: () => true, sectionEmptyHint: () => '' },
    '../../utils/endpoint-push': { subscribeEndpointPush: () => () => {} },
    './conversation-metadata': {
      buildMetadataIndex: async (adapter, endpointId, send) => { await send({ type: 'db:select', table: 'unified_inbox_message', pageSize: 500 }); return { meta: new Map(), names: new Map() } },
      conversationKey: (type, id) => `${type}:${id}`, ingestInboxRow() {}, previewFromMessageContent: () => '', unreadCountForConversation: () => 0,
    },
    './conversation-labels': {
      channelNameFromMessagePayload: () => undefined, channelEntryFromPushPayload: () => null, displayNameForConversation: (type, id, name) => name || id,
      fetchEndpointChannelCatalog: async (send, adapter, endpointKey) => ((await send({ type: 'endpoint.channels', adapter, endpointKey })).channels ?? []),
      normalizeFriendRecord: raw => ({ user_id: String(raw.user_id ?? ''), nickname: raw.nickname }), normalizeGroupRecord: raw => ({ group_id: String(raw.group_id ?? ''), group_name: raw.group_name }),
      pickLabel: value => value || undefined, toConsoleChannelParent: () => undefined,
      mergeInboxSessions: (friends, groups, channels) => ({ friends, groups, channels, mergedCount: 0 }),
    },
    './conversation-read-state': { setLastReadAt() {} },
    './chat-workspace-model.mjs': chatModel,
  }
  const code = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/endpoint-detail/useChannelManager.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  let info = null
  const Probe = () => ({ type: 'probe', props: { value: module.exports.useChannelManager({ adapter: 'icqq', endpointId: 'preview-community', info }) } })
  runtime.mount(() => ({ type: Probe, props: {} }))
  await runtime.settle()
  return {
    calls, runtime, value: () => chatValue(runtime),
    async setInfo(next) { info = next; runtime.render(); await runtime.settle() },
  }
}

const chatValue = runtime => [runtime.value].flat(Infinity).find(node => node?.type === 'probe')?.props.value
const countOf = (calls, type) => calls.filter(call => call === type).length

test('opening an account chat reads each conversation list once, also after the account info arrives', async () => {
  const chat = await mountChat()
  await chat.setInfo({ connected: true })
  await chat.setInfo({ connected: true, nickname: 'bot' })
  for (const type of ['endpoint.friends', 'endpoint.groups', 'endpoint.channels', 'db:select unified_inbox_message 200', 'db:select unified_inbox_message 500']) {
    assert.equal(countOf(chat.calls, type), 1, `${type}: ${chat.calls.join(', ')}`)
  }
})

test('the list notice still follows the connection state without another read', async () => {
  const chat = await mountChat({ empty: true })
  assert.equal(chat.value().listNotice.text, '尚未获取到会话。', 'account info not read yet')
  const before = chat.calls.length
  await chat.setInfo({ connected: false })
  assert.equal(chat.calls.length, before, 'no new requests')
  assert.equal(chat.value().listNotice.text, '渠道离线，暂未获取到会话。')
  await chat.setInfo({ connected: true })
  assert.equal(chat.calls.length, before, 'still no new requests')
  assert.equal(chat.value().listNotice.text, '暂无会话。')
})
