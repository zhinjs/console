import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSOLE_PATHS, LEGACY_ROUTE_REDIRECTS, adapterEndpointHref, adapterHref, endpointWorkspaceHref, featureGlobalHref, resolveLegacyRedirect,
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
  for (const path of ['/dashboard', '/ops/config', '/features', '/plugins/x', '/configure', '/']) assert.equal(resolveLegacyRedirect(path), null, path)
  assert.equal(resolveLegacyRedirect('/env/'), '/ops/env')
})

test('every redirect target is a page path of the new tree', () => {
  const pages = new Set(Object.values(CONSOLE_PATHS))
  for (const [path, rule] of Object.entries(LEGACY_ROUTE_REDIRECTS)) {
    assert.ok(pages.has(rule.to), `${path} -> ${rule.to}`)
    assert.ok(!pages.has(path), `${path} is no longer a page`)
  }
})

test('link helpers encode each segment once', () => {
  assert.equal(featureGlobalHref('root/demo'), '/features/global/root%2Fdemo')
  assert.equal(featureGlobalHref('x', { useCase: 'group-welcome' }), '/features/global/x?useCase=group-welcome')
  assert.equal(adapterHref('qq bot'), '/features/adapters/qq%20bot')
  assert.equal(adapterEndpointHref('icqq', '10001/a'), '/features/adapters/icqq/endpoints/10001%2Fa')
  assert.equal(endpointWorkspaceHref('icqq', 'main'), '/endpoints/icqq/main')
})
