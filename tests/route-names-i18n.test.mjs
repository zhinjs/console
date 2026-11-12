import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const root = new URL('../', import.meta.url)
const routeNames = (file) => [...readFileSync(new URL(file, root), 'utf8').matchAll(/\bname:\s*'([^']+)'/g)].map(match => match[1])

test('every built-in and optional route name has an English entry', () => {
  const names = [...routeNames('console-ui/src/registerBuiltinShell.tsx')]
  assert.ok(names.length >= 20, 'route names were found')
  const missing = names.filter(name => typeof englishMessages[name] !== 'string' || englishMessages[name].trim() === '')
  assert.deepEqual(missing, [])
})

test('route names follow the glossary: plugins, logs, chat accounts', () => {
  const names = routeNames('console-ui/src/registerBuiltinShell.tsx')
  for (const retired of ['功能管理', '功能商店', '运行记录', '渠道详情', '插件管理']) assert.ok(!names.includes(retired), `${retired} was replaced`)
  for (const required of ['插件', '插件市场', '插件详情', '运行日志', '账号与会话', '聊天账号详情', '会话详情']) assert.ok(names.includes(required), `${required} is a route name`)
})

test('every built-in route path is in the navigation name table (sidebar, breadcrumbs and titles translate)', async () => {
  const { CONSOLE_PATHS } = await import('../console-ui/src/console-routes.mjs')
  const table = readFileSync(new URL('console-ui/src/i18n/navigation.ts', root), 'utf8')
  const shell = readFileSync(new URL('console-ui/src/registerBuiltinShell.tsx', root), 'utf8')
  const registered = [...shell.matchAll(/path:\s*P\.(\w+)/g)].map(match => CONSOLE_PATHS[match[1]])
  assert.ok(registered.length >= 30)
  const missing = registered.filter(path => !table.includes(`"${path}":`))
  assert.deepEqual(missing, [])
})

test('one name for the plugin list: 插件 in navigation, page title, palette and buttons', async () => {
  const read = file => readFileSync(new URL(file, root), 'utf8')
  const retired = /插件管理|已装插件|全部插件|子插件|"返回插件列表"/
  for (const file of ['registerBuiltinShell.tsx', 'i18n/navigation.ts', 'pages/plugins.tsx', 'pages/plugin-detail.tsx', 'pages/marketplace.tsx', 'pages/dashboard.tsx', 'components/command-center-model.mjs', 'pages/welcome-use-case-model.mjs']) {
    const text = read(`console-ui/src/${file}`).replace(/keywords: \[[^\]]*\]/g, '')
    assert.doesNotMatch(text, retired, file)
  }
  assert.match(read('console-ui/src/pages/plugins.tsx'), /\{ key: 'all', label: '已安装' \}/, 'the list filters use state words')
  assert.equal(englishMessages['插件'], 'Plugins')
  assert.equal(englishMessages['field\u0004插件'], 'Plugin')
  for (const key of ['插件管理', '已装插件', '全部插件']) assert.equal(englishMessages[key], undefined, key)
  const { ROUTE_SEARCH_HINTS } = await import('../console-ui/src/components/command-center-model.mjs')
  assert.ok(ROUTE_SEARCH_HINTS['/plugins'].keywords.includes('插件管理'), 'the old name still finds the page in the palette')
})
