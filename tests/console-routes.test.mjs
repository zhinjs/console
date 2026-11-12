import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSOLE_PATHS, LEGACY_ROUTE_REDIRECTS, adapterHref, conversationHref, endpointHref, featureGlobalHref, matchLegacyPattern, resolveLegacyRedirect,
} from '../console-ui/src/console-routes.mjs'

test('old routes redirect into the ADR 0052 tree and keep their query string', () => {
  const cases = [
    ['/env', '', '/ops/env'],
    ['/files', '?path=src%2Fplugin.ts', '/ops/files?path=src%2Fplugin.ts'],
    ['/database', '?table=users', '/ops/database?table=users'],
    ['/config', '', '/ops/config'],
    ['/config', '?section=presets&q=agent', '/ops/config?section=presets&q=agent'],
    ['/tasks', '?tab=history', '/ops/schedules?tab=history'],
    ['/cron', '', '/ops/schedules?tab=schedule'],
    ['/assistant/jobs', '?tab=history&q=x', '/ops/schedules?tab=assistant&q=x'],
    ['/agent/models', '?tab=purposes', '/features/ai?tab=purposes'],
    ['/agent/skills', '', '/features/ai/skills'],
    ['/agent/ambient', '', '/features/ai/ambient'],
    ['/agent/workrooms', '?projectId=p1', '/features/ai/workrooms?projectId=p1'],
    ['/agent/workrooms/catalog', '', '/features/ai/workrooms/catalog'],
    ['/features/global', '', '/features'],
    ['/features/ai/models', '?tab=accounts', '/features/ai?tab=accounts'],
  ]
  for (const [path, search, expected] of cases) assert.equal(resolveLegacyRedirect(path, search), expected, `${path}${search}`)
})

test('a plugin settings link moves to its global feature configuration, keeping the rest of the query', () => {
  assert.equal(resolveLegacyRedirect('/config', '?plugin=welcome'), '/features/global/welcome')
  assert.equal(resolveLegacyRedirect('/config', '?plugin=a%20b%2Fc&useCase=group-welcome'), '/features/global/a%20b%2Fc?useCase=group-welcome')
  assert.equal(resolveLegacyRedirect('/config', '?plugin=%20%20'), '/ops/config?plugin=++', 'a blank plugin is not a plugin link')
})

test('non-legacy paths are not redirected, and a trailing slash still matches', () => {
  for (const path of ['/dashboard', '/ops/config', '/features', '/plugins/x', '/configure', '/', '/scope', '/scope/qq/bot', '/endpoints/a/b/c', '/features/adapters/qq/x']) assert.equal(resolveLegacyRedirect(path), null, path)
  assert.equal(resolveLegacyRedirect('/env/'), '/ops/env')
})

test('every redirect target is a page path of the new tree', () => {
  const pages = new Set(Object.values(CONSOLE_PATHS))
  for (const [path, rule] of Object.entries(LEGACY_ROUTE_REDIRECTS)) {
    assert.ok(pages.has(rule.to), `${path} -> ${rule.to}`)
    assert.ok(!pages.has(path), `${path} is no longer a page`)
  }
  for (const key of ['endpoints', 'endpointWorkspace', 'adapters', 'adapter', 'adapterEndpoint', 'adapterConversation']) assert.ok(!Object.hasOwn(CONSOLE_PATHS, key), `${key} was merged into the object tree`)
})

test('link helpers encode each segment once', () => {
  assert.equal(featureGlobalHref('root/demo'), '/features/global/root%2Fdemo')
  assert.equal(featureGlobalHref('x', { useCase: 'group-welcome' }), '/features/global/x?useCase=group-welcome')
  assert.equal(adapterHref('qq bot'), '/scope/qq%20bot')
  assert.equal(adapterHref('qq', 'features'), '/scope/qq?tab=features')
  assert.equal(endpointHref('icqq', '10001/a'), '/scope/icqq/10001%2Fa')
  assert.equal(endpointHref('icqq', 'main', 'chat'), '/scope/icqq/main?tab=chat')
  assert.equal(endpointHref('icqq', 'main', 'overview'), '/scope/icqq/main', '概览 is the default and stays out of the URL')
  assert.equal(conversationHref('qq', 'b', 'private', 'u:1', 'roles'), '/scope/qq/b/private%3Au%3A1?tab=roles')
  assert.equal(endpointHref('qq', 'b', 'nope'), '/scope/qq/b', 'an unknown tab is dropped')
})

test('merged pages redirect into the object tree: 聊天账号, 账号工作区, 适配器 and 账号/会话功能配置', () => {
  const cases = [
    ['/endpoints', '', '/scope'],
    ['/endpoints', '?q=bot', '/scope?q=bot'],
    ['/endpoints/icqq/main', '', '/scope/icqq/main?tab=chat'],
    ['/endpoints/root%2Ficqq/bot%3A1', '', '/scope/root%2Ficqq/bot%3A1?tab=chat'],
    // A selected conversation of the workspace opens that conversation's 聊天 tab.
    ['/endpoints/icqq/main', '?channelType=group&channelId=a%2Fb%3F', '/scope/icqq/main/group%3Aa%2Fb%3F?tab=chat'],
    ['/endpoints/icqq/main', '?channelType=room&channelId=1&x=y', '/scope/icqq/main?tab=chat&channelType=room&channelId=1&x=y'],
    ['/features/adapters', '', '/scope'],
    ['/features/adapters/qq', '', '/scope/qq'],
    ['/features/adapters/qq/endpoints/10001', '', '/scope/qq/10001?tab=features'],
    ['/features/adapters/qq/endpoints/10001', '?tab=conversations', '/scope/qq/10001'],
    ['/features/adapters/qq/endpoints/10001/conversations/group%3A9', '', '/scope/qq/10001/group%3A9?tab=features'],
    ['/features/adapters/qq/endpoints/10001/conversations/private%3Aa%252Fb', '?x=1', '/scope/qq/10001/private%3Aa%252Fb?tab=features&x=1'],
    ['/features/adapters/qq/endpoints/10001/conversations/nonsense', '', '/scope/qq/10001?tab=features'],
    ['/features/adapters/qq/', '', '/scope/qq'],
  ]
  for (const [path, search, expected] of cases) assert.equal(resolveLegacyRedirect(path, search), expected, `${path}${search}`)
})

test('legacy patterns match raw segments and decode each once', () => {
  assert.deepEqual(matchLegacyPattern('/endpoints/:adapter/:endpointId', '/endpoints/a%2Fb/c%25d'), { adapter: 'a/b', endpointId: 'c%d' })
  assert.equal(matchLegacyPattern('/endpoints/:adapter/:endpointId', '/endpoints/a'), null)
  assert.equal(matchLegacyPattern('/endpoints/:adapter/:endpointId', '/endpoints/a/'), null)
  assert.equal(matchLegacyPattern('/endpoints/:adapter/:endpointId', '/endpoints/%E0%A4%A/b'), null, 'a malformed escape is no match')
})
