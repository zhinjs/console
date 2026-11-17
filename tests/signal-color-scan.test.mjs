// console#125 phase 2: signal colors only where something needs a look, chart data only in --chart-*.
// Static scan of the Console's own sources (console-ui/src, client). The component library is out of scope.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveToken, tokenValues } from './helpers/token-cascade.mjs'
import { instanceStateTone } from '../console-ui/src/pages/ops/gateway-model.mjs'
import { taskOverviewRows } from '../console-ui/src/pages/task-overview-model.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const sources = ['console-ui/src', 'client']
  .flatMap(dir => walk(join(root, dir)))
  .filter(path => /\.(?:tsx?|mjs|css)$/.test(path) && !/\.d\.mts$/.test(path))
  .map(path => ({ file: relative(root, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }))
const read = file => readFileSync(join(root, file), 'utf8')

/**
 * The success color expressed in source: utility classes (bg-success, text-success …), the CSS variable, and a
 * 'success' used as a variant / tone value (variant="success", ? 'success', tone: 'success', return 'success').
 * Comparisons such as `status === 'success'` are not uses.
 */
const SUCCESS_PATTERNS = [
  /\b(?:bg|text|border|fill|stroke|ring|from|to)-success\b/g,
  /var\(--success/g,
  /(?:[?:]\s*|variant=|(?:variant|tone|Variant|Tone)\s*[:=]\s*|return\s+)["']success["']/g,
]
const successUses = text => SUCCESS_PATTERNS.reduce((count, pattern) => count + (text.match(pattern) ?? []).length, 0)

/**
 * Every place that may still use the success color, with the number of uses and why. A steady state (running,
 * connected, succeeded, done, enabled, applied, online, a count of 0) is never one of them: those are neutral
 * (outline badge, plain text, or nothing). What is left is feedback to an action the user just took, a value whose
 * color is the content itself (ANSI, diff), or the token / variant definitions.
 */
const SUCCESS_ALLOWED = {
  'console-ui/src/theme-tokens.css': [1, '令牌定义（--status-success 别名）'],
  'console-ui/src/design-system.css': [4, 'Badge success 变体的样式定义（3）；把组件库 MiniRingGauge 的 success 描边改成图表色的覆盖规则（1）'],
  'console-ui/src/components/ansi-text.css': [1, '日志里 ANSI 绿色（32 / 92）的原样还原，颜色就是内容'],
  'console-ui/src/utils/ansi-log.mjs': [2, 'ANSI 颜色码到 tone 的映射表，同上'],
  'console-ui/src/pages/HostSelfChangesPanel.tsx': [2, 'diff 新增行的语法着色，不是状态'],
  'console-ui/src/components/toast.tsx': [1, 'toast.success()：用户刚做完的操作的一次性反馈'],
  'console-ui/src/components/toast.css': [2, 'success toast 的图标（一次性反馈）'],
  'console-ui/src/components/status-surfaces.css': [6, 'ActionReceipt / ApplyFeedback：保存、应用之后的一次性回执'],
  'console-ui/src/components/ApplyFeedback.tsx': [1, '重启后已生效的回执，同上'],
  'console-ui/src/components/apply-outcome-model.mjs': [1, '回执语气（applied → success），同上'],
  'console-ui/src/pages/ops/gateway-model.mjs': [1, '依赖事务完成后的结果摘要（一次性回执）'],
  'console-ui/src/pages/ops/ops-components.tsx': [1, '显示上面那条结果摘要的 Alert'],
  'console-ui/src/pages/marketplace-view-model.mjs': [1, '「检查更新」后的 toast'],
  'console-ui/src/pages/endpoint-test-result-model.mjs': [1, '点了「测试连接」后的结果'],
  'console-ui/src/pages/scope/scope-pages.css': [1, '「测试连接」结果的图标'],
  'console-ui/src/pages/setup/setup.css': [1, '设置向导里「测试连接」通过的结果'],
  'console-ui/src/pages/scope/login-flow-model.mjs': [3, '登录流程的语义 tone；徽标经 BADGE_VARIANT 映射为中性 outline，只有结果提示用色'],
  'console-ui/src/pages/scope/login-flow.css': [6, '登录这一步刚完成的提示：扫码成功、校验通过、登录完成的结果框'],
  'console-ui/src/pages/agent-sessions.tsx': [1, '切换分支后的一次性提示'],
  'console-ui/src/pages/database/document-collection-view.tsx': [3, '添加 / 更新记录后的一次性提示'],
  'console-ui/src/pages/database/kv-bucket-view.tsx': [3, '添加 / 更新键值后的一次性提示'],
  'console-ui/src/pages/database/related-table-view.tsx': [4, '添加 / 更新行后的一次性提示'],
  'console-ui/src/pages/files/file-editor.tsx': [3, '保存文件后的一次性提示'],
  'console-ui/src/pages/scope/configured-account-actions.tsx': [4, '导入 / 回写账号配置后的一次性提示'],
  'console-ui/src/pages/scope/adapter-accounts.tsx': [1, '保存账号后的一次性提示'],
}

test('the success color never marks a steady state: every remaining use is listed with its reason', () => {
  const found = Object.fromEntries(sources.map(({ file, text }) => [file, successUses(text)]).filter(([, count]) => count > 0))
  for (const [file, count] of Object.entries(found)) {
    assert.ok(SUCCESS_ALLOWED[file], `${file}: ${count} success-colored use(s). Steady states (运行中、已连接、成功、已完成、已启用、在线、0) take the neutral outline badge or plain text; feedback to an action belongs in SUCCESS_ALLOWED with a reason`)
    assert.equal(count, SUCCESS_ALLOWED[file][0], `${file}: update SUCCESS_ALLOWED (now ${count})`)
  }
  for (const file of Object.keys(SUCCESS_ALLOWED)) assert.ok(found[file], `${file} no longer uses the success color: drop it from SUCCESS_ALLOWED`)
  for (const [file, [, reason]] of Object.entries(SUCCESS_ALLOWED)) assert.ok(reason.length >= 4, `${file} needs a reason`)
})

test('the scan catches the steady-state spellings it is meant to catch', () => {
  for (const sample of ['<Badge variant="success">', "variant={ok ? 'success' : 'secondary'}", 'className="text-success"', 'bg-success/10', "tone: 'success'", 'color: hsl(var(--success));', 'hsl(var(--success-fill))'])
    assert.equal(successUses(sample), 1, sample)
  for (const sample of ["status === 'success'", "Record<Tone, 'success' | 'warning'>", 'useToast().success(text)'])
    assert.equal(successUses(sample), 0, sample)
})

/** CSS rules (innermost blocks) of every Console stylesheet, comments stripped. */
const cssRules = sources.filter(({ file }) => file.endsWith('.css')).flatMap(({ file, text }) =>
  [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ file, selector: match[1].trim(), body: match[2] })))
const CHART_SELECTOR = /chart|volume|meter|gauge|spark|severity|context-bar|metric-progress|trace-dot|model-bar/
const PRIMARY = /--primary\b(?!-)/

test('charts take their data colors from --chart-*, never the accent', () => {
  const offenders = cssRules.filter(rule => CHART_SELECTOR.test(rule.selector) && PRIMARY.test(rule.body)).map(rule => `${rule.file}: ${rule.selector}`)
  assert.deepEqual(offenders, [], 'chart rules must not color data with --primary')
  // Success / info are not data colors; warning and destructive only mark a threshold or a problem.
  const signals = cssRules.filter(rule => CHART_SELECTOR.test(rule.selector) && (/--(?:success|info)\b/.test(rule.body)
    || (/--(?:warning|destructive)\b/.test(rule.body) && !/warning|warn\b|error|problem|offline/.test(rule.selector))))
  assert.deepEqual(signals.map(rule => `${rule.file}: ${rule.selector}`), [], 'chart rules must not use a status color as a data color')
  for (const file of ['console-ui/src/pages/token-usage-charts.tsx', 'console-ui/src/pages/ConversationUsage.tsx', 'console-ui/src/pages/logs/LogWorkbench.tsx'])
    assert.doesNotMatch(read(file), /--primary\b(?!-)|\b(?:bg|text|fill|stroke)-primary\b/, `${file} draws charts; no accent color in it`)
  const dashboard = read('console-ui/src/pages/dashboard.tsx')
  const chart = dashboard.slice(dashboard.indexOf('function MessageVolumeChart('), dashboard.indexOf('function MessageFeedRow('))
  assert.doesNotMatch(chart, /primary|success|warning|info\b/)
  assert.match(read('console-ui/src/pages/token-usage-model.mjs'), /'hsl\(var\(--chart-1\)\)', 'hsl\(var\(--chart-2\)\)'/)
})

test('chart gridlines are hairlines, not dashed borders', () => {
  const css = read('console-ui/src/pages/dashboard.css')
  assert.match(css, /\.console-volume-gridline \{[^}]*border-top: var\(--console-hairline\) solid var\(--console-chart-grid\);/)
  const charts = read('console-ui/src/pages/token-usage-charts.tsx')
  assert.doesNotMatch(charts, /strokeDasharray=\{tick === 0/, 'token-usage gridlines are solid')
  assert.match(charts, /vectorEffect="non-scaling-stroke"/)
})

test('status dots are neutral while connected / online; only a lost connection or offline account is colored', () => {
  const shell = read('console-ui/src/shell.css'), picker = read('console-ui/src/scope/object-page.css'), gallery = read('console-ui/src/pages/introspection/component-gallery.css')
  assert.doesNotMatch(shell, /\.console-connection-(?:dot|state)\.is-online[^{]*\{[^}]*--(?:success|primary)/)
  assert.match(picker, /\.console-scope-picker-dot\.is-online \{ background: hsl\(var\(--muted-foreground\) \/ 0\.4\); \}/)
  assert.match(picker, /\.console-scope-picker-dot\.is-offline \{ background: hsl\(var\(--warning-fill\)\); \}/)
  assert.match(gallery, /\.console-runtime-status-dot\.is-online \{\s*background-color: hsl\(var\(--muted-foreground\) \/ 0\.55\);/)
})

test('one badge per kind of state across pages: steady = outline, offline = warning, failed = destructive', () => {
  assert.equal(instanceStateTone('running'), 'outline')
  assert.equal(instanceStateTone('crashed'), 'destructive')
  assert.equal(instanceStateTone('starting'), 'secondary')
  const { rows } = taskOverviewRows({ admin: { providers: [{ owner: 'root/r', title: 'r', tasks: [
    { id: 'done', title: 'done', state: 'succeeded', lastRunAt: 1, parameters: {}, actions: [] },
    { id: 'bad', title: 'bad', state: 'failed', lastRunAt: 1, parameters: {}, actions: [] },
  ] }] } }, 'zh-CN')
  const done = rows.find(row => row.key === 'admin:root/r:done'), bad = rows.find(row => row.key === 'admin:root/r:bad')
  assert.deepEqual([done.status.tone, done.lastResult.tone], ['outline', 'outline'], '已完成 / 成功 are neutral')
  assert.deepEqual([bad.status.tone, bad.lastResult.tone], ['destructive', 'destructive'], '失败 stands out')
  const online = [
    ['console-ui/src/pages/scope/overview-panels.tsx', /variant=\{status === 'online' \? 'outline' : 'warning'\}/],
    ['console-ui/src/pages/scope/endpoint-page.tsx', /variant=\{connected \? 'outline' : 'warning'\}/],
    ['console-ui/src/pages/scope/endpoint-access.tsx', /variant=\{endpoint\.connected \? 'outline' : 'warning'\}/],
    ['console-ui/src/pages/introspection/CapabilityExplorer.tsx', /variant=\{connected \? 'outline' : 'warning'\}/],
  ]
  for (const [file, pattern] of online) assert.match(read(file), pattern, file)
})

// ---- ΔE2000 between the message-volume series and the warning color, from the Console's own tokens ----
const hslToRgb = (h, s, l) => {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map(n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))
}
const toLab = ([r, g, b]) => {
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [r, g, b].map(lin)
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const X = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), Y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), Z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883)
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]
}
function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7))), a1p = (1 + G) * a1, a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2)
  const hue = (b, a) => { const x = Math.atan2(b, a) / rad; return x < 0 ? x + 360 : x }
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p)
  let dh = h2 - h1; if (C1p * C2p === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad), Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2
  let hm = h1 + h2; if (C1p * C2p !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad)
  const RC = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7)), RT = -Math.sin(2 * 30 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad) * RC
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cmp, SH = 1 + 0.015 * Cmp * T
  return Math.sqrt(((L2 - L1) / SL) ** 2 + ((C2p - C1p) / SC) ** 2 + (dH / SH) ** 2 + RT * ((C2p - C1p) / SC) * (dH / SH))
}

test('received / sent stay apart from each other and from the warning color (ΔE2000 ≥ 20, light and dark)', () => {
  // The colors are the component library's roles (console-ui 1.1); resolve them as the browser does.
  const design = read('console-ui/src/design-system.css')
  const inbound = /--console-chart-inbound: var\(--([\w-]+)\)/.exec(design)[1], outbound = /--console-chart-outbound: var\(--([\w-]+)\)/.exec(design)[1]
  for (const [theme, dark] of [['light', false], ['dark', true]]) {
    const values = tokenValues('zhin', dark)
    const value = name => toLab(hslToRgb(...resolveToken(values, name).split(/\s+/).map(parseFloat)))
    const [a, b] = [value(inbound), value(outbound)]
    assert.ok(deltaE2000(a, b) >= 20, `${theme}: received / sent ΔE ${deltaE2000(a, b).toFixed(1)}`)
    for (const warning of ['warning', 'warning-fill']) for (const [series, color] of [['received', a], ['sent', b]]) {
      const d = deltaE2000(color, value(warning))
      assert.ok(d >= 20, `${theme}: ${series} vs ${warning} ΔE ${d.toFixed(1)}`)
    }
  }
})
