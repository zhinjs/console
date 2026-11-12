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
  for (const retired of ['功能管理', '功能商店', '运行记录', '渠道详情']) assert.ok(!names.includes(retired), `${retired} was replaced`)
  for (const required of ['插件管理', '插件市场', '插件详情', '运行日志', '账号与会话', '聊天账号详情', '会话详情']) assert.ok(names.includes(required), `${required} is a route name`)
})
