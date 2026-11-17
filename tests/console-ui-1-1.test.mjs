// @zhin.js/console-ui 1.1 adoption (zhinjs/console#125, ADR 0063 D23–D33): the Console uses the
// library's components instead of the local stand-ins it wrote while waiting for the release.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

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
