// @zhin.js/console-ui 1.1 adoption (zhinjs/console#125, ADR 0063 D23–D33): the Console uses the
// library's components instead of the local stand-ins it wrote while waiting for the release.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { isLocaleImport, localeModule } from './locale-fixture.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = path => readFileSync(join(root, path), 'utf8')
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const sources = walk(join(root, 'console-ui/src')).filter(path => /\.(tsx?|css|mjs)$/.test(path))

test('no local stand-ins for BrandMark or the primary button remain', () => {
  assert.equal(existsSync(join(root, 'console-ui/src/components/BrandMark.tsx')), false)
  for (const path of sources) {
    const text = readFileSync(path, 'utf8'), file = relative(root, path)
    assert.doesNotMatch(text, /components\/BrandMark|\bPRODUCT_NAME\b(?<!CONSOLE_PRODUCT_NAME)/, file)
    assert.doesNotMatch(text, /组件库 [^\s]+ 发布后|console-login-submit/, file)
  }
})

test('primary: the one next step of each view, at most one per view (ADR 0063 D25)', () => {
  const views = {
    'console-ui/src/pages/login.tsx': '<Button type="submit" variant="primary"',
    'console-ui/src/pages/dashboard.tsx': '<Button variant="primary" onClick={() => navigate(\'/scope\')}>',
    'console-ui/src/pages/access/audit.tsx': '<Button type="submit" size="sm" variant="primary"><Search />{i18n.t("筛选")}',
    'console-ui/src/pages/not-found.tsx': '<Button variant="primary" asChild><Link to={homePath}><Home />',
  }
  for (const [file, button] of Object.entries(views)) {
    const text = read(file)
    assert.ok(text.includes(button), file)
    assert.equal(text.match(/variant="primary"/g).length, 1, `${file}: one primary`)
  }
  // 保存 of AI 与模型 · 用途 is a SaveButton, primary by default.
  assert.match(read('console-ui/src/components/SaveButton.tsx'), /variant = 'primary', \.\.\.props/)
  assert.match(read('console-ui/src/pages/inference/Purposes.tsx'), /<SaveButton type="submit"/)
  assert.doesNotMatch(read('console-ui/src/pages/inference/Purposes.tsx'), /variant="primary"/)
})

test('the deprecated `default` button variant is not used; `soft` is its name', () => {
  for (const path of sources.filter(path => path.endsWith('.tsx'))) {
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/<Button\b[^>]*>/g)) {
      assert.doesNotMatch(match[0], /variant=(?:"default"|\{[^}]*'default'[^}]*\})/, `${relative(root, path)}: ${match[0]}`)
    }
  }
})

test('destructive: solid red only on confirm buttons; entry points are the ghost / outline variants', () => {
  // Confirm buttons outside ConfirmDialog (which picks destructive-solid itself in console-ui 1.1).
  const solid = {
    'console-ui/src/components/PluginConfigForm/ConversationScopeEditor.tsx': '确认恢复全部',
    'console-ui/src/components/ActionReceipt.tsx': '确认执行',
    'console-ui/src/components/ApplyFeedback.tsx': '确认重启',
    'console-ui/src/pages/env.tsx': '确认清空',
    'console-ui/src/pages/cron.tsx': '删除中...',
    'console-ui/src/pages/ScheduleExecutions.tsx': '清理过期记录',
    'console-ui/src/pages/access/users.tsx': '重置密码',
  }
  for (const [file, label] of Object.entries(solid)) {
    const text = read(file)
    assert.equal(text.match(/variant="destructive-solid"/g)?.length, 1, file)
    assert.ok(text.includes(label), `${file}: ${label}`)
  }
  for (const path of sources.filter(path => path.endsWith('.tsx'))) {
    const text = readFileSync(path, 'utf8'), file = relative(root, path)
    for (const match of text.matchAll(/<Button\b[^>]*>/g)) {
      // Hand-made red buttons give way to the library's destructive (ghost) / destructive-outline.
      assert.doesNotMatch(match[0], /className="[^"]*\btext-destructive\b/, `${file}: ${match[0]}`)
      if (!Object.hasOwn(solid, file)) assert.doesNotMatch(match[0], /destructive-solid/, `${file}: solid red outside a confirmation`)
    }
  }
  assert.match(read('console-ui/src/pages/dashboard.tsx'), /<Button variant="destructive-outline" disabled=\{restarting\}/)
  assert.doesNotMatch(read('console-ui/src/pages/dashboard.css'), /console-danger-outline/)
})

const require = createRequire(import.meta.url)
function compile(path, mocks) {
  const module = { exports: {} }
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const resolve = name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : name === 'react/jsx-runtime' || name === 'react' ? require(name) : new Proxy({}, { get: (_target, key) => String(key) })
  new Function('require', 'exports', 'module', code)(resolve, module.exports, module)
  return module.exports
}
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []

test('StatusState kind="empty" is the library EmptyState inside a status wrapper', async () => {
  const { StatusState } = compile('console-ui/src/components/StatusState.tsx', {
    './status-state-model.mjs': await import('../console-ui/src/components/status-state-model.mjs'),
    '@zhin.js/console-ui': { Button: 'button', EmptyState: 'empty-state', cn: (...values) => values.filter(Boolean).join(' ') },
    'react-router-dom': { Link: 'a' }, './status-surfaces.css': {},
  })
  const render = props => { const tree = StatusState(props); return typeof tree.type === 'function' ? tree.type(tree.props) : tree }
  const plain = render({ kind: 'empty', title: '还没有消息', compact: true, illustration: 'messages', className: 'm-3' })
  assert.equal(plain.props.role, 'status')
  assert.equal(plain.props['data-status-kind'], 'empty')
  assert.match(plain.props.className, /\bm-3\b/)
  const empty = elements(plain).find(node => node.type === 'empty-state')
  assert.deepEqual({ title: empty.props.title, illustration: empty.props.illustration, compact: empty.props.compact, description: empty.props.description, icon: empty.props.icon },
    { title: '还没有消息', illustration: 'messages', compact: true, description: undefined, icon: undefined })
  // No title: the standard copy; no illustration: the icon. An action object or `actions` element is the one action.
  const generic = elements(render({ kind: 'empty', action: { label: '新建' } })).find(node => node.type === 'empty-state')
  assert.equal(generic.props.title, '还没有内容')
  assert.equal(generic.props.description, '有了新内容会显示在这里。')
  assert.ok(generic.props.icon)
  assert.deepEqual(generic.props.action, { label: '新建' })
  assert.equal(elements(render({ kind: 'empty', actions: 'link' })).find(node => node.type === 'empty-state').props.action, 'link')
  // Other kinds keep the status panel.
  assert.equal(elements(render({ kind: 'error' })).some(node => node.type === 'empty-state'), false)
})

test('empty states with a clear scene carry the library illustration and their next step (ADR 0063 D28)', () => {
  const scenes = {
    'console-ui/src/pages/database/database-page.tsx': [/<EmptyState illustration="table"/, /<EmptyState compact illustration="table" title=\{i18n\.t\("这个数据库还没有表"\)\}/],
    'console-ui/src/pages/workrooms.tsx': [/<EmptyState illustration="record" title=\{i18n\.t\("选择一条协作记录"\)\}/],
    'console-ui/src/pages/logs/LogWorkbench.tsx': [/<EmptyState illustration="logs" title=\{i18n\.t\("当前筛选没有日志"\)\}/],
    'console-ui/src/pages/access/audit.tsx': [/<StatusState kind="empty" illustration="logs"/],
    'console-ui/src/pages/cron.tsx': [/<StatusState kind="empty" illustration="tasks" title=\{i18n\.t\("暂无持久化定时任务"\)\}/, /action=\{[^}]*label: i18n\.t\("新建定时任务"\)/],
    'console-ui/src/pages/TaskOverview.tsx': [/<StatusState kind="empty" illustration="tasks" title=\{i18n\.t\("还没有任务"\)\}/],
    'console-ui/src/pages/assistant-jobs.tsx': [/<StatusState kind="empty" illustration="tasks" title=\{i18n\.t\("暂无任务"\)\}/],
    'console-ui/src/pages/dashboard.tsx': [/illustration="messages" title=\{i18n\.t\("缓冲里还没有消息"\)\}/, /illustration="messages" title=\{i18n\.t\("还没有消息"\)\}/],
    'console-ui/src/pages/scope/records-panel.tsx': [/illustration="messages" title=\{i18n\.t\('还没有聊天记录'\)\}/],
    'console-ui/src/pages/agent-sessions.tsx': [/illustration="messages"\s+title=\{i18n\.t\('个人会话没有聊天记录'\)\}/, /action=\{\{ label: i18n\.t\('查看轨迹'\)/],
    'console-ui/src/pages/not-found.tsx': [/<EmptyIllustration name="not-found"/],
    'console-ui/src/components/connection-required.tsx': [/action=\{\{ label: i18n\.t\("重新登录"\), icon: LogIn, variant: 'primary'/],
  }
  for (const [file, patterns] of Object.entries(scenes)) for (const pattern of patterns) assert.match(read(file), pattern, file)
  assert.doesNotMatch(read('console-ui/src/design-system.css'), /\.console-log-empty/)
})

test('forms: secondary purpose fields are ghost controls; no native date inputs remain (ADR 0063 D29)', () => {
  const purposes = read('console-ui/src/pages/inference/Purposes.tsx')
  assert.match(purposes, /variant=\{key !== 'chat' && !draft\.defaults\[key\] \? 'ghost' : 'default'\}/)
  assert.match(purposes, /variant=\{policy\?\.mode && policy\.mode !== 'off' \? 'default' : 'ghost'\}/)
  assert.match(purposes, /variant=\{policy\?\.profile \? 'default' : 'ghost'\}/)
  assert.equal(purposes.match(/variant="ghost"\s+(?:className="min-w-0 flex-1"\s+)?aria-label=\{i18n\.t\("(?:\{0\}备用模型 \{1\}|添加\{0\}备用模型)"/g)?.length, 2, 'both fallback selects are ghost')
  for (const path of sources.filter(path => path.endsWith('.tsx'))) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /type="(?:date|datetime-local|time|month|week)"/, relative(root, path))
  }
  assert.match(read('console-ui/src/pages/access/audit.tsx'), /<DateTimeField id=\{`\$\{id\}-since`\}/)
  assert.match(read('console-ui/src/pages/access/audit.tsx'), /<DateTimeField id=\{`\$\{id\}-until`\}/)
  assert.equal(read('console-ui/src/pages/token-usage.tsx').match(/<DateTimeField /g)?.length, 2)
})

test('visual regressions found in the 1.1 screenshots stay fixed', () => {
  // PageShell pads itself since 1.1; inside the Console's padded main it must not add a second inset.
  assert.match(read('console-ui/src/shell.css'), /\.console-main \.console-page-frame \{ padding: 0; \}/)
  // The library's cn() drops a variant's text color next to size classes (text-label / text-body):
  // solid red, brand, soft and destructive buttons get it back from their surviving classes.
  const css = read('console-ui/src/design-system.css')
  for (const rule of [/\.console-control\.bg-destructive \{ color: hsl\(var\(--destructive-foreground\)\); \}/, /\.console-control\.bg-brand \{ color: hsl\(var\(--console-brand-foreground\)\); \}/,
    /\.console-control\.bg-primary-action \{ color: hsl\(var\(--primary-action-foreground\)\); \}/, /\.console-control\.hover\\:bg-destructive\\\/8, \.console-control\[data-tone="destructive"\] \{ color: hsl\(var\(--destructive\)\); \}/]) assert.match(css, rule)
  for (const path of sources.filter(path => path.endsWith('.tsx'))) {
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/<Button\b[^>]*variant="destructive-outline"[^>]*>/g)) {
      if (/size="sm"/.test(match[0])) assert.match(match[0], /data-tone="destructive"/, relative(root, path))
    }
  }
})
