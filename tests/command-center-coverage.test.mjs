import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { commandName, commandScore, commandSearchTargets, pluginSearchTargets } from '../console-ui/src/components/command-center-model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const t = (message, values) => translate('zh-CN', message, values)

test('every installed plugin becomes one search-only entry opening its detail page', () => {
  const info = { name: 'weather', packageName: '@zhin.js/plugin-weather', description: '查询城市天气' }
  const bare = { name: 'dice' }
  // `/api/plugins` lists a plugin under its instance key and its name: one entry, keyed by the first.
  const targets = pluginSearchTargets({ 'weather#1': info, weather: info, dice: bare }, t)
  assert.deepEqual(targets.map(target => target.path), ['/plugins/weather%231', '/plugins/dice'])
  assert.equal(targets[0].title, 'weather')
  assert.equal(targets[0].description, '查询城市天气')
  assert.equal(targets[1].description, '插件 dice', 'a plugin without a description is still described')
  assert.ok(targets.every(target => target.searchOnly === true && target.kind === 'page'))
  assert.deepEqual(pluginSearchTargets({ weather: info, dice: bare }, t, ['weather']).map(target => target.path), ['/plugins/dice'], 'plugins with a page of their own are not listed twice')
  assert.deepEqual(pluginSearchTargets(null, t), [])
})

test('chat commands become search-only entries that open the commands tab filtered to them', () => {
  assert.equal(commandName('welcome [text]'), 'welcome')
  assert.equal(commandName('rss add <url>'), 'rss')
  assert.equal(commandName('签到'), '签到')
  const targets = commandSearchTargets([
    { pattern: 'welcome [text]', desc: '查看或修改欢迎语', plugin: 'welcome', aliases: ['欢迎'] },
    { pattern: '签到', plugin: 'sign-in' },
    { pattern: 'welcome [text]', desc: 'duplicate' },
    { desc: 'no pattern' },
    null,
  ], t)
  assert.deepEqual(targets.map(target => target.path), ['/introspection?tab=commands&filter=welcome', `/introspection?tab=commands&filter=${encodeURIComponent('签到')}`])
  assert.equal(targets[0].description, '查看或修改欢迎语 · 插件 welcome')
  assert.equal(targets[1].description, '聊天命令 · 插件 sign-in')
  const scored = { ...targets[0], group: '命令' }
  assert.ok(commandScore(scored, '欢迎') > 0, 'aliases match')
  assert.ok(commandScore(scored, 'welcome') > 0)
  assert.ok(targets.every(target => target.searchOnly === true))
  assert.equal(translate('en', '聊天命令'), 'Chat command')
})

test('the palette reads the command catalog when opened, for identities that can see 运行时能力, and keeps search-only entries out of the idle list', () => {
  const source = readFileSync(new URL('../console-ui/src/components/ConsoleCommandCenter.tsx', import.meta.url), 'utf8')
  assert.match(source, /const commandsVisible = routes\.some\(route => route\.path === '\/introspection' && canSeeRoute\(route, access\)\)/)
  assert.match(source, /if \(commandsVisible\) \{\n\s+void read\(`\$\{CONSOLE_REST\.INTROSPECTION\}\/commands\?page=1&pageSize=100`\)/)
  assert.match(source, /if \(pluginsVisible\) \{\n\s+void read\('\/api\/plugins'\)/, 'installed plugins are read when the palette opens')
  assert.match(source, /entry\.score > 0 && \(!entry\.target\.searchOnly \|\| query\.trim\(\)\)/)
  assert.match(source, /const pluginsVisible = routes\.some\(route => route\.path === '\/plugins\/:name' && canSeeRoute\(route, access\)\)/, 'plugins are offered only to identities that can open a plugin')
})
