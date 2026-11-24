import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readRecentSessions, sessionsNeedingGroupNames, withGroupNames } from '../console-ui/src/pages/agent-session-recent.mjs'
import { sessionLabel } from '../console-ui/src/utils/session-label.mjs'

// #64 `session-group-name-missing`: some groups in the session list showed only their number, with
// no name — older traces did not record `conversation.name`. Suggested: fall back to the group name
// the adapter has now (the Console can read the group lists) instead of the bare id.
const now = 1_800_000_000_000
const hashed = `scene-task:v1:${'9f8e7d6c'.repeat(8)}`
const body = rows => ({ success: true, data: rows.map((row, index) => ({ turns: 3, last_started_at: now - index, last_status: 'completed', ...row })) })
const names = new Map([['icqq:20001', '产品试验群'], ['icqq:30002', '运维值班群']])

test('a group the record does not name gets the name from the group lists', () => {
  const rows = readRecentSessions(body([
    // Host 1.10: hashed key, the origin names the group but the old trace kept no name.
    { session_key: hashed, platform: 'icqq', scope_kind: 'group', scene_label: '20001', origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group:20001' } },
    // An address key without any name.
    { session_key: 'icqq:bot:group:30002' },
  ]))
  assert.deepEqual(sessionsNeedingGroupNames(rows), true)
  assert.equal(sessionLabel(rows[0]), 'icqq · 群 20001 · 群聊', 'before: only the number')
  const named = withGroupNames(rows, names)
  assert.equal(sessionLabel(named[0]), 'icqq · 群 产品试验群 · 群聊')
  assert.equal(sessionLabel(named[1]), 'icqq · 群 运维值班群')
})

test('a name the record has wins; unknown groups and other kinds stay as they are', () => {
  const rows = readRecentSessions(body([
    { session_key: hashed, platform: 'icqq', scope_kind: 'group', scene_label: '旧名字', origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'group:20001' } },
    { session_key: 'icqq:bot:group:40004' },
    { session_key: 'icqq:bot:private:10001' },
    { session_key: 'schedule:daily' },
  ]))
  const named = withGroupNames(rows, names)
  assert.equal(sessionLabel(named[0]), 'icqq · 群 旧名字 · 群聊')
  assert.equal(sessionLabel(named[1]), 'icqq · 群 40004', 'not in any group list: the number stays')
  assert.deepEqual(named.slice(2), rows.slice(2))
  // The recorded conversation name is used when the Host sends one but no scene label.
  const recorded = readRecentSessions(body([{ session_key: hashed, platform: 'icqq', origin: { kind: 'im', conversation: { endpoint: { adapter: 'icqq', id: 'bot' }, kind: 'group', id: '20001', name: '记录里的群名' } } }]))
  assert.equal(sessionLabel(recorded[0]), 'icqq · 群 记录里的群名 · 群聊')
  assert.equal(sessionsNeedingGroupNames(recorded), false, 'nothing to look up: the group lists are not read')
  assert.equal(sessionsNeedingGroupNames(readRecentSessions(body([{ session_key: 'icqq:bot:private:10001' }]))), false)
})

test('the 聊天记录 page reads the group lists only when a group lacks its name, and the picker shows the name', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/agent-sessions.tsx', import.meta.url), 'utf8')
  assert.match(page, /useAmbientGroupCatalog\(needGroupNames\)/)
  assert.match(page, /withGroupNames\(/)
  const picker = readFileSync(new URL('../console-ui/src/components/AgentSessionPicker.tsx', import.meta.url), 'utf8')
  assert.match(picker, /activity\?\.sceneLabel \|\| parsed\.sceneId/)
})

test('a row the Host calls a private chat is never given a group name', () => {
  const rows = readRecentSessions(body([{ session_key: hashed, platform: 'icqq', scope_kind: 'private', origin: { kind: 'im', conversation: { endpoint: { adapter: 'icqq', id: 'bot' }, kind: 'group', id: '20001', name: '记录里的群名' } } }]))
  assert.equal(rows[0].sceneLabel, undefined)
  assert.equal(sessionsNeedingGroupNames(rows), false)
  assert.equal(withGroupNames(rows, names)[0], rows[0])
})

// useAmbientGroupCatalog on a tiny hook runtime: what a read for one connection found is not shown
// for another, and turning the read off and on again does not read the lists again.
test('the group lists are read once per connection and never shown for another one', async () => {
  const { createRequire } = await import('node:module')
  const ts = (await import('typescript')).default
  const { localeModule, isLocaleImport } = await import('./locale-fixture.mjs')
  const model = await import('../console-ui/src/pages/ambient-group-picker-model.mjs')
  const url = new URL('../console-ui/src/pages/AmbientGroupPicker.tsx', import.meta.url)
  const source = readFileSync(url, 'utf8')
  const slots = []; let cursor = 0; let effects = []
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback(fn) { cursor++; return fn },
    useEffect(fn, deps) { const i = cursor++; const prev = slots[i]; if (!prev || deps.some((d, k) => d !== prev.deps[k])) { prev?.cleanup?.(); effects.push(() => { slots[i] = { deps, cleanup: fn() } }) } },
  }
  let scope = 'a'; const reads = []
  const requestConsole = async payload => {
    reads.push(`${scope}:${payload.type}`)
    if (payload.type === 'endpoint:list') return { endpoints: [{ adapter: 'icqq', name: 'bot', connected: true }] }
    return { groups: [{ group_id: 20001, name: scope === 'a' ? 'A 的群' : 'B 的群' }] }
  }
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mocks = {
    react, './ambient-group-picker-model.mjs': model, '../utils/console-rpc': { requestConsole },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => scope }, '../utils/inbox-cache': { isInboxCacheScopeActive: s => s === scope },
    '../contracts/zhin-console': { ENDPOINT_RPC: { LIST: 'endpoint:list', GROUPS: 'endpoint:groups' } },
  }
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : new Proxy({}, { get: () => 'x' }), module.exports, module)
  const render = enabled => { cursor = 0; const out = module.exports.useAmbientGroupCatalog(enabled); const run = effects; effects = []; run.forEach(fn => fn()); return out }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  render(false); await settle()
  assert.deepEqual(reads, [], 'nothing is read while not needed')
  render(true); await settle()
  let read = render(true)
  assert.equal(model.groupNamesFromCatalog(read.catalog).get('icqq:20001'), 'A 的群')
  render(false); render(true); await settle()
  assert.equal(reads.length, 2, 'turning it off and on again does not read the lists again')
  scope = 'b'
  read = render(false)
  assert.equal(read.catalog, null, "another connection does not see A's lists")
  render(true); await settle()
  read = render(true)
  assert.equal(model.groupNamesFromCatalog(read.catalog).get('icqq:20001'), 'B 的群')
})
