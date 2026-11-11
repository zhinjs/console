import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Loaded lazily so the tests below fail on behaviour, not on a missing import, against older code.
const model = await import('../console-ui/src/pages/endpoint-detail/chat-scroll-model.mjs').catch(() => ({}))
const { isNearBottom, appendedMessageIds, planChatScroll, scrollTopAfterPrepend } = model
const settled = { settled: true, nearBottom: true, unread: 0, prepending: false }
const reading = { ...settled, nearBottom: false }

test('the bottom counts as reached within 80px', () => {
  assert.equal(typeof isNearBottom, 'function')
  assert.equal(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }), true)
  assert.equal(isNearBottom({ scrollTop: 520, scrollHeight: 1000, clientHeight: 400 }), true, '80px away')
  assert.equal(isNearBottom({ scrollTop: 519, scrollHeight: 1000, clientHeight: 400 }), false, '81px away')
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }), true, 'content shorter than the view')
  assert.equal(isNearBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 400 }, 200), true, 'custom threshold')
})

test('only messages after the previous last one are new', () => {
  assert.equal(typeof appendedMessageIds, 'function')
  assert.deepEqual(appendedMessageIds(['b', 'c'], ['a', 'b', 'c', 'd', 'e']), ['d', 'e'], 'history loaded above is not new')
  assert.deepEqual(appendedMessageIds(['b', 'c'], ['a', 'b', 'c']), [])
  assert.deepEqual(appendedMessageIds([], ['a']), ['a'])
  assert.deepEqual(appendedMessageIds(['a', 'local-1'], ['a', 'x', 'y']), ['x', 'y'], 'old tail merged away: every unseen id counts')
})

test('opening a conversation scrolls to the newest message once it has loaded', () => {
  assert.equal(typeof planChatScroll, 'function')
  assert.deepEqual(planChatScroll(null, { key: 'A', ids: [] }, { ...settled, settled: false }), { scroll: 'none', unread: 0, settled: false })
  assert.deepEqual(planChatScroll({ key: 'A', ids: [] }, { key: 'A', ids: ['1', '2'] }, { ...reading, settled: false }),
    { scroll: 'bottom', unread: 0, settled: true }, 'first load lands at the bottom even though scrollTop was 0')
  assert.deepEqual(planChatScroll({ key: 'A', ids: ['1'] }, { key: 'B', ids: ['9'] }, { ...reading, unread: 4 }),
    { scroll: 'bottom', unread: 0, settled: true }, 'switching conversation resets the unread count')
  assert.deepEqual(planChatScroll({ key: 'A', ids: ['1'] }, { key: 'B', ids: [] }, { ...reading, unread: 4 }),
    { scroll: 'none', unread: 0, settled: false }, 'the new conversation is still loading')
  assert.deepEqual(planChatScroll({ key: 'A', ids: ['1'] }, { key: 'A', ids: [] }, settled), { scroll: 'none', unread: 0, settled: false },
    'a cleared list (reload) scrolls to the bottom again when it refills')
})

test('new messages follow the bottom, or are counted while the user reads history', () => {
  const before = { key: 'A', ids: ['1', '2'] }
  assert.deepEqual(planChatScroll(before, { key: 'A', ids: ['1', '2', '3'] }, settled), { scroll: 'bottom', unread: 0, settled: true })
  assert.deepEqual(planChatScroll(before, { key: 'A', ids: ['1', '2', '3', '4'] }, { ...reading, unread: 1 }),
    { scroll: 'none', unread: 3, settled: true })
  assert.deepEqual(planChatScroll(before, { key: 'A', ids: ['1', '2', 'local-1'], ownIds: ['local-1'] }, { ...reading, unread: 2 }),
    { scroll: 'bottom', unread: 0, settled: true }, 'a message the user just sent always brings them to the bottom')
  assert.deepEqual(planChatScroll(before, { key: 'A', ids: ['1', '2'] }, { ...reading, unread: 2 }), { scroll: 'none', unread: 2, settled: true },
    'a re-render without new rows changes nothing')
})

test('loading earlier messages keeps the reading position', () => {
  const before = { key: 'A', ids: ['5', '6'] }
  assert.deepEqual(planChatScroll(before, { key: 'A', ids: ['3', '4', '5', '6'] }, { ...reading, prepending: true, unread: 1 }),
    { scroll: 'preserve', unread: 1, settled: true })
  assert.deepEqual(planChatScroll(before, { key: 'A', ids: ['3', '4', '5', '6'] }, { ...settled, prepending: true }),
    { scroll: 'preserve', unread: 0, settled: true }, 'even when the short list was at the bottom')
  assert.deepEqual(planChatScroll(before, { key: 'A', ids: ['5', '6', '7'] }, { ...reading, prepending: true }),
    { scroll: 'none', unread: 1, settled: true }, 'a live message during the load is still counted')
  assert.equal(typeof scrollTopAfterPrepend, 'function')
  assert.equal(scrollTopAfterPrepend({ scrollTop: 40, scrollHeight: 1000 }, 1800), 840)
  assert.equal(scrollTopAfterPrepend({ scrollTop: 40, scrollHeight: 1000 }, 1000), 40)
  assert.equal(scrollTopAfterPrepend({ scrollTop: 0, scrollHeight: 1000 }, 900), 0, 'never negative')
})

// --- ChatScrollArea wiring, rendered with minimal hooks and a fake scroll container ---

function hooks() {
  const slots = []; let cursor = 0, pending = [], dirty = false, render, value
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const api = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(slots[i], v)) { slots[i] = v; dirty = true } }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useLayoutEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() }) } },
  }
  return {
    api,
    mount(fn) { render = fn; return this.render() },
    render() { let n = 0; do { assert.ok(++n < 50); dirty = false; cursor = 0; value = render(); const effects = pending; pending = []; effects.forEach(fn => fn()) } while (dirty); return value },
    get value() { return value },
  }
}

async function loadScrollArea(bindings) {
  const file = 'pages/endpoint-detail/ChatScrollArea.tsx'
  const source = await readFile(new URL(`../console-ui/src/${file}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration; (function find(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === 'ChatScrollArea') declaration = n; ts.forEachChild(n, find) })(ast)
  assert.ok(declaration, 'ChatScrollArea')
  let code = declaration.getText(ast).replace(/^export /, '')
  const stop = code.lastIndexOf('  return (')
  code = code.slice(0, stop) + 'return { listRef, onScroll, loadOlder, jumpToLatest, unread };}'
  code = ts.transpileModule(code, { fileName: 'scroll.tsx', compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return Function(...Object.keys(bindings), `${code};return ChatScrollArea`)(...Object.values(bindings))
}

test('the message list opens at the bottom, follows or counts new messages, and keeps place on load-earlier', async () => {
  const runtime = hooks()
  const ChatScrollArea = await loadScrollArea({ ...runtime.api, ...model, useI18n: () => ({ t: (m, v) => m.replace('{0}', v?.[0]) }) })
  const rowsOf = (...ids) => ids.map(id => ({ id, local: id.startsWith('local-') }))
  const list = { scrollTop: 0, scrollHeight: 400, clientHeight: 400 }
  let props = { conversationKey: 'A', rows: [], hasMore: true, loadingOlder: true, onLoadOlder() { loads++ } }
  let loads = 0
  runtime.mount(() => ChatScrollArea(props))
  runtime.value.listRef.current = list
  const update = (next, height) => { if (height) list.scrollHeight = height; props = { ...props, ...next }; runtime.render() }
  const scrollTo = top => { list.scrollTop = top; runtime.value.onScroll(); runtime.render() }

  update({ rows: rowsOf('1', '2', '3'), loadingOlder: false }, 2000)
  assert.equal(list.scrollTop, 2000, 'first load lands on the newest message')

  scrollTo(300)
  update({ rows: rowsOf('1', '2', '3', '4') }, 2100)
  assert.equal(list.scrollTop, 300, 'reading history is not interrupted')
  update({ rows: rowsOf('1', '2', '3', '4', '5') }, 2200)
  assert.equal(runtime.value.unread, 2)

  runtime.value.jumpToLatest(); runtime.render()
  assert.equal(runtime.value.unread, 0); assert.equal(list.scrollTop, 2200)

  scrollTo(1750) // 50px from the bottom
  update({ rows: rowsOf('1', '2', '3', '4', '5', '6') }, 2300)
  assert.equal(list.scrollTop, 2300, 'near the bottom: follow the new message')

  scrollTo(40)
  runtime.value.loadOlder(); assert.equal(loads, 1)
  update({ loadingOlder: true })
  update({ rows: rowsOf('0a', '0b', '1', '2', '3', '4', '5', '6'), loadingOlder: false }, 3100)
  assert.equal(list.scrollTop, 840, 'the message being read stays in place')
  assert.equal(runtime.value.unread, 0)

  update({ rows: rowsOf('0a', '0b', '1', '2', '3', '4', '5', '6', '7') }, 3200)
  assert.equal(list.scrollTop, 840); assert.equal(runtime.value.unread, 1)
  update({ rows: rowsOf('0a', '0b', '1', '2', '3', '4', '5', '6', '7', 'local-8') }, 3300)
  assert.equal(list.scrollTop, 3300, 'sending a message brings the user to it'); assert.equal(runtime.value.unread, 0)

  scrollTo(100)
  update({ rows: rowsOf('0a', '0b', '1', '2', '3', '4', '5', '6', '7', 'local-8', '9') }, 3400)
  assert.equal(runtime.value.unread, 1)
  scrollTo(3000) // scrolling down by hand clears the count
  assert.equal(runtime.value.unread, 0)

  scrollTo(100)
  update({ conversationKey: 'B', rows: [] })
  update({ rows: rowsOf('b1', 'b2') }, 1500)
  assert.equal(list.scrollTop, 1500, 'another conversation opens at its newest message')
})

test('the conversation page renders its messages inside ChatScrollArea', async () => {
  const source = await readFile(new URL('../console-ui/src/pages/endpoint-detail/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /<ChatScrollArea[\s\S]*?rows=\{channelMessages\}/)
  assert.doesNotMatch(source, /className="im-message-list/, 'the scroll container lives in ChatScrollArea')
})
