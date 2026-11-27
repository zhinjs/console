// console#125 (visual direction, phase without the new @zhin.js/console-ui API).
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as theme from '../console-ui/src/theme/index.ts'
import { visibleActivityRange } from '../console-ui/src/pages/dashboard-activity-model.mjs'
import { normalizeEngagementSummary, collaborationEventSummary, venueLabel, engagementTotals } from '../console-ui/src/pages/engagements-model.mjs'
import { outcomeVariant } from '../console-ui/src/pages/access/access-model.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('one fixed soft-card palette (console-ui 1.3.0): no palette picker; Zhin green stays the brand mark only', () => {
  assert.equal('THEME_PALETTES' in theme, false)
  assert.equal('DEFAULT_PALETTE' in theme, false)
  assert.match(read('client/index.html'), /let mode = 'system';/)
  assert.doesNotMatch(read('client/index.html'), /palette/)
  assert.equal(existsSync(new URL('../console-ui/src/components/ThemeToggle.tsx', import.meta.url)), false)
})

test('one brand mark (the favicon shape) and one product name replace the lettered Z badges', () => {
  // The mark comes from the component library (console-ui 1.1); the local copy is gone.
  const favicon = read('client/favicon.svg'), mark = read('node_modules/@zhin.js/console-ui/dist/components/BrandMark.js')
  const path = /<path d="([^"]+)"/.exec(favicon)[1]
  assert.ok(mark.includes(`d: "${path}"`), 'BrandMark draws the favicon Z')
  assert.match(favicon, /fill="#76EEC6"/)
  assert.equal(existsSync(new URL('../console-ui/src/components/BrandMark.tsx', import.meta.url)), false)
  for (const file of ['console-ui/src/layouts/dashboard.tsx', 'console-ui/src/pages/login.tsx', 'console-ui/src/pages/setup/setup-wizard.tsx']) {
    const source = read(file)
    assert.match(source, /<BrandMark [^>]*withText/, file)
    assert.match(source, /import \{[^}]*\bBrandMark\b[^}]*\} from '@zhin\.js\/console-ui'/, file)
    assert.doesNotMatch(source, />Z<\//, `${file} no longer spells the mark`)
    assert.doesNotMatch(source, /Zhin\.js"|>Zhin\.js</, `${file} uses the product name`)
  }
  for (const file of ['console-ui/src/shell.css', 'console-ui/src/pages/login.css']) assert.doesNotMatch(read(file), /linear-gradient\(145deg, hsl\(var\(--primary\)\)/, file)
  assert.match(read('client/index.html'), /<title>Zhin Console<\/title>/)
})

test('received / sent use chart colors, and short activity drops the leading empty hours', () => {
  const css = read('console-ui/src/pages/dashboard.css')
  assert.match(css, /\.console-volume-legend i\.is-inbound \{ background: hsl\(var\(--zc-chart-inbound\)\); \}/)
  assert.match(css, /\.console-volume-legend i\.is-reply \{ background: hsl\(var\(--zc-chart-outbound\)\); \}/)
  // console-ui 1.3.0: chart-1 apricot (received), chart-2 peacock teal (sent) — chart-3 is rose, too near apricot.
  assert.match(read('console-ui/src/design-system.css'), /--zc-chart-inbound: var\(--console-chart-1\);\s*--zc-chart-outbound: var\(--console-chart-2\);/)
  const hours = Array.from({ length: 24 }, (_, index) => ({ start: index, inbound: 0, outbound: 0 }))
  assert.equal(visibleActivityRange(hours).length, 24, 'no data: the whole day')
  hours[23].inbound = 3
  assert.deepEqual(visibleActivityRange(hours).map(bucket => bucket.start), [18, 19, 20, 21, 22, 23], 'at least six hours')
  hours[10].outbound = 1
  assert.equal(visibleActivityRange(hours)[0].start, 10)
  hours[0].inbound = 1
  assert.equal(visibleActivityRange(hours).length, 24)
})

test('numbers are tabular everywhere, and full-width pages widen only the content, not the top bar', () => {
  assert.match(read('console-ui/src/design-system.css'), /body \{[^}]*font-variant-numeric: tabular-nums;/)
  assert.doesNotMatch(read('console-ui/src/shell.css'), /\[data-wide\] \.console-topnav-capsule/)
})

test('an unknown address gets a not-found page and no 其他 › 首页 breadcrumb', () => {
  const host = read('client/host/ConsoleWebHost.tsx'), layout = read('console-ui/src/layouts/dashboard.tsx'), page = read('console-ui/src/pages/not-found.tsx')
  assert.match(host, /<Route path="\*" element=\{<NotFoundPage homePath=\{defaultHomePath\} \/>\} \/>/)
  assert.match(layout, /const showBreadcrumb = !onHome && Boolean\(navigation\.current\) && !firstLevel && !objectPageOwnsBreadcrumb/)
  assert.match(page, /i18n\.t\('找不到这个页面'\)/)
  assert.match(page, /openCommandCenter\(\)/)
  assert.match(page, /location\.pathname/)
})

test('the ⌘K field has no ring of its own, and the top bar has no section menus left to refocus', () => {
  assert.match(read('client/style.css'), /\.console-command-search input:focus-visible \{\s*outline: none;/)
  // Sections are links now (NavPill / NavIcon, console-ui 1.3.0): no DropdownMenu whose closing could refocus a trigger.
  assert.doesNotMatch(read('console-ui/src/layouts/dashboard.tsx'), /DropdownMenu|onCloseAutoFocus/)
})

test('steady states carry no signal color: audit successes are plain text, failures stand out', () => {
  assert.equal(outcomeVariant('ok'), null)
  assert.equal(outcomeVariant('error'), 'destructive')
  assert.equal(outcomeVariant('denied'), 'warning')
  const plugins = read('console-ui/src/pages/plugins.tsx')
  assert.match(plugins, /undeclared: 'disabled'/, '已安装，待配置 is a neutral badge')
  const workrooms = read('console-ui/src/pages/workrooms.tsx')
  assert.match(workrooms, /tone=\{totals\.failed \? 'danger' : undefined\}/, '失败 0 is not colored')
  assert.doesNotMatch(workrooms, /text-success/)
})

test('a journal-shaped engagement summary shows its venue, actors and status instead of [object Object]', () => {
  const journal = { engagementId: 'eng-1', venue: { kind: 'group', id: '20001' }, status: 'open', startedAt: 1, actors: ['agent:planner'], mailCount: 3, toolCallCount: 1, boardEntries: [] }
  const summary = normalizeEngagementSummary(journal)
  assert.equal(summary.venue, 'group:20001')
  assert.equal(summary.status, 'running')
  assert.deepEqual(summary.participants, ['agent:planner'])
  assert.equal(summary.hops, undefined)
  const blocked = normalizeEngagementSummary({ ...journal, status: 'blocked' })
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.stopReason, 'blocked')
  assert.equal(normalizeEngagementSummary({ ...journal, status: 'cancelled', reason: 'user' }).stopReason, 'user')
  assert.equal(engagementTotals([summary, blocked]).failed, 1)
  assert.equal(venueLabel('room'), 'room'); assert.equal(venueLabel({}), undefined); assert.equal(venueLabel(null), undefined)
  assert.equal(collaborationEventSummary({ kind: 'engagement.started', initiator: 'human:u1', venue: { kind: 'group', id: '7' } }), 'initiator=human:u1 venue=group:7')
  for (const value of Object.values(summary)) assert.doesNotMatch(String(value), /\[object Object\]/)
  // The protocol shape passes through.
  const protocol = normalizeEngagementSummary({ engagementId: 'e', venue: 'room', status: 'completed', startedAt: 1, participants: ['a'], hops: 2, turns: 3, tokensUsed: 4, wallClockMs: 5 })
  assert.deepEqual([protocol.venue, protocol.status, protocol.hops, protocol.turns, protocol.tokensUsed, protocol.wallClockMs], ['room', 'completed', 2, 3, 4, 5])
})

test('the message-volume chart has a hover / focus readout and one keyboard stop that walks the hours', () => {
  const dashboard = read('console-ui/src/pages/dashboard.tsx')
  const chart = dashboard.slice(dashboard.indexOf('function MessageVolumeChart('), dashboard.indexOf('function MessageFeedRow('))
  assert.match(chart, /role="group" aria-label=\{summary\}/)
  assert.match(chart, /role="img"\s+aria-label=\{describe\(bucket\)\}\s+tabIndex=\{index === tabStop \? 0 : -1\}/, 'each hour is read by describe; one tab stop')
  assert.match(chart, /event\.key === 'ArrowRight'/)
  assert.match(chart, /event\.key === 'Home'/)
  assert.match(chart, /onPointerMove=\{fromPointer\}/, 'the readout follows the pointer')
  assert.match(chart, /className="console-volume-readout" aria-hidden="true"/)
  assert.match(chart, /i18n\.t\("收到"\)\}<b>\{shown\.inbound\}<\/b>/)
  assert.match(chart, /i18n\.t\("发出"\)\}<b>\{shown\.outbound\}<\/b>/)
  assert.doesNotMatch(read('console-ui/src/pages/dashboard.css'), /data-tip/, 'the CSS-only tooltip is gone')
})
