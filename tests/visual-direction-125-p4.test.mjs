// console#125 phase 4 (brand moments): the login page's product sketch and solid sign-in button, and the
// dashboard's 「需要你处理」 as one list with ids / long text collapsed. Console source only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as model from '../console-ui/src/pages/attention/attention-model.mjs'

const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(path, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module, module.exports)
  return module.exports
}
function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type(node.props))
  const children = node.props?.children
  return { ...node, props: { ...node.props, ...(children === undefined ? {} : { children: render(children) }) } }
}
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node !== 'object' ? String(node) : text(node.props?.children)
const icons = new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : String(name) })
const cn = (...names) => names.filter(Boolean).join(' ')

/** `state` is what every useState returns first, so a test can render the expanded state too. */
function attentionModules({ state } = {}) {
  const t = (message, values) => translate('zh-CN', message, values)
  const react = { useState: initial => [state ?? (typeof initial === 'function' ? initial() : initial), () => {}] }
  const common = { react, 'lucide-react': icons, 'react-router-dom': { Link: 'Link' }, '../../i18n': { useI18n: () => ({ t, locale: 'zh-CN' }) }, '@zhin.js/console-ui': { cn, Button: 'Button' }, './attention-model.mjs': model }
  const more = compile('pages/attention/AttentionMore.tsx', common)
  const row = compile('pages/attention/AttentionItemRow.tsx', { ...common, './AttentionMore': more })
  const list = compile('pages/attention/AttentionSummaryList.tsx', { ...common, './AttentionMore': more, './AttentionItemRow': row })
  return { row, list }
}

const items = [
  { id: 'tool-approval.pending:77aa0b13', revision: 'c1', kind: 'tool-approval.pending', severity: 'danger', source: 'tool-approvals', since: null,
    title: '工具 group_kick 等待审批', detail: '来自会话 icqq:preview-community:group:20001；超时无人处理会被拒绝。', action: { label: '去审批', path: '/ops/schedules?tab=admin' } },
  { id: 'mcp.disconnected:51e2a7d9', revision: 'e1', kind: 'mcp.disconnected', severity: 'warning', source: 'mcp', since: null,
    title: 'MCP 服务 web-search 未连接', detail: 'Agent 暂时无法调用它提供的工具。', action: { label: '', path: '/introspection?tab=mcp' } },
  { id: 'logs.errors:811c9dc5', revision: 'f1', kind: 'logs.errors', severity: 'info', source: 'logs', since: null,
    title: '日志里有 7 条错误', detail: '持久日志统计；清理日志后重新计数。', action: { label: '打开错误日志', path: '/logs?level=error' } },
]

test('the dashboard 「需要你处理」 is one list: each row an icon, one sentence and the action that fixes it', () => {
  const tree = render(attentionModules().list.AttentionSummaryList({ items }))
  assert.equal(tree.type, 'ul')
  assert.match(tree.props.className, /\bconsole-attention-list\b/)
  assert.match(tree.props.className, /\bis-summary\b/)
  const rows = nodes(tree).filter(node => node.type === 'li')
  assert.equal(rows.length, 3)
  for (const [index, row] of rows.entries()) {
    const [icon, body, actions] = row.props.children
    assert.match(icon.props.className, new RegExp(`console-attention-icon is-${items[index].severity}`))
    assert.equal(icon.props['aria-hidden'], 'true')
    assert.equal(text(nodes(body).find(node => node.props?.className === 'console-attention-row-title')), items[index].title)
    const link = nodes(actions).find(node => node.type === 'Link')
    assert.equal(link.props.to, items[index].action.path)
  }
  // The Host's own action label, or 「去处理」 when it sends none.
  assert.deepEqual(rows.map(row => text(nodes(row).find(node => node.type === 'Link'))), ['去审批', '去处理', '打开错误日志'])
  // No solid button in the list: the page keeps one primary action at most.
  for (const button of nodes(tree).filter(node => node.type === 'Button')) assert.ok(['ghost', 'outline'].includes(button.props.variant), button.props.variant)
})

test('raw ids and long text stay collapsed until 「详情」 opens them', () => {
  const collapsed = render(attentionModules().list.AttentionSummaryList({ items }))
  const row = nodes(collapsed).filter(node => node.type === 'li')[0]
  const toggle = nodes(row).find(node => node.type === 'Button' && 'aria-expanded' in node.props)
  assert.equal(toggle.props['aria-expanded'], false)
  assert.match(text(toggle), /详情/)
  const panel = nodes(row).find(node => node.props?.id === toggle.props['aria-controls'])
  assert.ok(panel, 'aria-controls names the collapsed part')
  assert.equal(panel.props.hidden, true)
  assert.match(text(panel), /icqq:preview-community:group:20001/, 'the long detail is inside the collapsed part')
  assert.match(text(panel), /tool-approval\.pending:77aa0b13/, 'and so is the item id')
  // Outside the collapsed part the row is one sentence: no id, no detail.
  const outside = text(row).replace(text(panel), '')
  assert.doesNotMatch(outside, /77aa0b13|icqq:preview-community/)
  assert.match(toggle.props['aria-controls'], /^[a-zA-Z0-9_-]+$/, 'a valid id attribute')

  const expanded = render(attentionModules({ state: new Set([items[0].id]) }).list.AttentionSummaryList({ items }))
  const open = nodes(expanded).filter(node => node.type === 'li')[0]
  assert.equal(nodes(open).find(node => node.type === 'Button' && 'aria-expanded' in node.props).props['aria-expanded'], true)
  assert.equal(nodes(open).find(node => node.props?.className === 'console-attention-more').props.hidden, false)
})

test('the /attention page uses the same row and the same 「详情」 for the raw id', () => {
  const tree = render(attentionModules().row.AttentionItemRow({ item: items[0], now: Date.now() }))
  assert.equal(tree.type, 'li')
  assert.match(tree.props.className, /console-attention-row/)
  const toggle = nodes(tree).find(node => node.type === 'button' && 'aria-expanded' in node.props)
  assert.match(text(toggle), /详情/)
  assert.equal(toggle.props['aria-expanded'], false)
  const panel = nodes(tree).find(node => node.props?.id === toggle.props['aria-controls'])
  assert.equal(panel.props.hidden, true)
  assert.match(text(panel), /tool-approval\.pending:77aa0b13/)
})

test('the dashboard renders the list (no equal-height cards) and keeps 查看全部', () => {
  const dashboard = read('pages/dashboard.tsx')
  assert.match(dashboard, /<AttentionSummaryList items=\{attention\.active\.slice\(0, DASHBOARD_ATTENTION_LIMIT\)\} \/>/)
  assert.match(dashboard, /<Link to=\{ATTENTION_PATH\}>\{i18n\.t\("查看全部 \(\{0\}\)"/)
  assert.doesNotMatch(dashboard, /console-attention-strip|console-attention-item/)
  for (const file of ['pages/dashboard.css', 'design-system.css']) assert.doesNotMatch(read(file), /console-attention-strip|console-attention-item\b/, file)
})

test('only real problems are red or amber, icons included: 留意 (info) is neutral', () => {
  const css = read('pages/attention/attention.css')
  assert.match(css, /\.console-attention-icon\.is-danger \{ color: hsl\(var\(--destructive\)\); \}/)
  assert.match(css, /\.console-attention-icon\.is-warning \{ color: hsl\(var\(--warning\)\); \}/)
  assert.match(css, /\.console-attention-icon\.is-info \{ color: hsl\(var\(--muted-foreground\)\); \}/)
  // The summary list sits flat inside the dashboard panel: no card in a card.
  assert.match(css, /\.console-attention-list\.is-summary \{[^}]*background: transparent;[^}]*box-shadow: none;/)
})

function loginPreview() {
  const t = (message, values) => translate('en', message, values)
  return compile('pages/login-preview.tsx', {
    'lucide-react': icons,
    '@zhin.js/console-ui': { BrandMark: 'brand-mark', StatCard: props => ({ type: 'stat-card', props: { ...props, children: [props.label, props.value, props.sub] } }) },
    '../i18n': { useI18n: () => ({ t, locale: 'en' }) },
  })
}

test('the login sketch is hidden from assistive technology, takes no focus and sends no request', () => {
  const tree = render(loginPreview().LoginPreview())
  assert.equal(tree.props['aria-hidden'], 'true')
  assert.equal(tree.props.inert, true)
  const cards = nodes(tree).filter(node => node.type === 'stat-card')
  assert.deepEqual(cards.map(card => card.props.label), ['Messages received', 'Sent by the bot'])
  for (const card of cards) assert.equal(card.props.onOpen, undefined, 'not a link: nothing to click in a sketch')
  assert.ok(nodes(tree).some(node => /\bim-bubble-in\b/.test(node.props?.className ?? '')), 'a user message bubble')
  assert.ok(nodes(tree).some(node => /\bim-bubble-out\b/.test(node.props?.className ?? '')), 'a bot reply bubble')
  assert.ok(!nodes(tree).some(node => ['img', 'button', 'a', 'input'].includes(node.type)), 'no bitmap and nothing interactive')
  const source = read('pages/login-preview.tsx')
  assert.doesNotMatch(source, /\bfetch\(|apiFetch|useEffect|utils\/|console-client|pluginRpc|\.png|\.jpe?g|\.webp/, 'static sample data only')
})

test('the login page shows the sketch under the title, hides it on phones and narrows the gap', () => {
  const page = read('pages/login.tsx')
  const intro = page.slice(page.indexOf('<section className="console-login-intro">'), page.indexOf('<section className="console-login-panel"'))
  assert.match(intro, /<LoginPreview \/>/)
  const css = read('pages/login.css')
  assert.match(css, /\.console-login-layout \{[^}]*gap: var\(--console-space-7\);/)
  const phone = css.slice(css.indexOf('@media (width < 48rem)'))
  assert.match(phone, /\.console-login-preview \{ display: none; \}/)
  assert.match(css, /\.console-login-preview-swatch\.is-inbound \{ background: hsl\(var\(--zc-chart-inbound\)\); \}/)
  assert.match(css, /\.console-login-preview-swatch\.is-outbound \{ background: hsl\(var\(--zc-chart-outbound\)\); \}/)
})

// WCAG contrast from HSL triples.
const hslToRgb = (h, s, l) => {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))
}
const luminance = rgb => { const [r, g, b] = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const hex = rgb => '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase()

test('the sign-in button is the component library primary (console-ui 1.1); the local brand button is gone', () => {
  assert.match(read('pages/login.tsx'), /<Button type="submit" variant="primary" /)
  const css = read('pages/login.css')
  assert.doesNotMatch(css, /console-login-submit|--console-login-primary/)
  // primary: the solid brand (#76EEC6 / #7FFFD4) with the brand's near-black green; both well above 4.5:1.
  const tokens = readFileSync(new URL('../node_modules/@zhin.js/console-ui/dist/tokens.css', import.meta.url), 'utf8')
  const triples = name => [...tokens.matchAll(new RegExp(`${name}: (\\d+(?:\\.\\d+)?) (\\d+(?:\\.\\d+)?)% (\\d+(?:\\.\\d+)?)%;`, 'g'))].map(match => hslToRgb(...match.slice(1).map(Number)))
  const [lightBg, darkBg] = triples('--console-brand'), [lightFg, darkFg] = triples('--console-brand-foreground')
  assert.equal(hex(darkBg), '#7FFFD4')
  for (const [bg, fg] of [[lightBg, lightFg], [darkBg, darkFg]]) assert.ok(contrast(bg, fg) >= 4.5, `${hex(bg)} / ${hex(fg)}: ${contrast(bg, fg).toFixed(2)}`)
})
