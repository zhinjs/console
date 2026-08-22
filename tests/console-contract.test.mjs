import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

const ROOT = new URL('..', import.meta.url).pathname
const SOURCE_ROOT = join(ROOT, 'console-ui', 'src')

function sourceFiles(directory = SOURCE_ROOT) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(name) ? [path] : []
  })
}

function sourceText(path) {
  return readFileSync(path, 'utf8')
}

test('Console does not call removed Zhin APIs or legacy Endpoint aliases', () => {
  const removed = [
    'workrooms:get',
    'workrooms:set',
    '/api/agent/orchestration',
    '/api/agent/traces',
    '/api/introspection/middlewares',
    '/api/introspection/components',
    'endpoint:list',
    'endpoint:info',
    'endpoint:sendMessage',
    'endpoint:friends',
    'endpoint:groups',
    'endpoint:channels',
    'endpoint:deleteFriend',
    'endpoint:groupMembers',
    'endpoint:groupKick',
    'endpoint:groupMute',
    'endpoint:groupAdmin',
    'endpoint:requests',
    'endpoint:inboxMessages',
    'endpoint:inboxRequests',
    'endpoint:inboxNotices',
  ]

  for (const path of sourceFiles()) {
    const source = sourceText(path)
    for (const token of removed) {
      assert.equal(
        source.includes(token),
        false,
        `${relative(ROOT, path)} still references removed API ${token}`,
      )
    }
  }
})

test('built-in Agent navigation only exposes current Workbench, Workroom and Sessions', () => {
  const source = sourceText(join(SOURCE_ROOT, 'registerBuiltinShell.tsx'))
  assert.match(source, /path: '\/agent\/workbench'/)
  assert.match(source, /path: '\/agent\/workrooms'/)
  assert.match(source, /path: '\/agent\/sessions'/)
  assert.doesNotMatch(source, /\/agent\/(?:studio|orchestration)/)
})

test('introspection surface is the exact current Host capability set', () => {
  const source = sourceText(join(SOURCE_ROOT, 'contracts', 'zhin-console.ts'))
  for (const kind of ['commands', 'endpoints', 'bindings', 'tools', 'mcp']) {
    assert.match(source, new RegExp(`\\| '${kind}'`))
  }
  assert.doesNotMatch(source, /\| '(?:middlewares|components)'/)
})

test('Console shell only consumes public route metadata', () => {
  const layout = sourceText(join(SOURCE_ROOT, 'layouts', 'dashboard.tsx'))
  const routes = sourceText(join(SOURCE_ROOT, 'registerBuiltinShell.tsx'))
  assert.doesNotMatch(layout, /meta\?\.flush|"flush"|'flush'/)
  assert.doesNotMatch(routes, /flush\s*:/)
})

test('Endpoint transport uses canonical endpointKey and the public client push event', () => {
  const endpointSources = [
    'pages/endpoint-detail/useMessageHistory.ts',
    'pages/endpoint-detail/useEndpointConsole.tsx',
    'pages/endpoint-detail/useChannelManager.tsx',
    'pages/endpoint-detail/useGroupActions.ts',
    'pages/endpoint-detail/conversation-labels.ts',
  ].map((path) => sourceText(join(SOURCE_ROOT, path))).join('\n')
  assert.doesNotMatch(endpointSources, /data:\s*\{\s*adapter,\s*endpointId(?:\s*[,}])/)
  assert.match(endpointSources, /endpointKey/)

  const push = sourceText(join(SOURCE_ROOT, 'utils', 'endpoint-push.ts'))
  assert.match(push, /zhin-console-bot-push/)
  assert.doesNotMatch(push, /dispatchEvent|callbacks/)
  assert.equal(sourceFiles().some((path) => path.endsWith('/sse-bridge.ts')), false)
})

test('Workroom selection is represented by projectId and runId in the URL', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'workrooms.tsx'))
  assert.match(source, /searchParams\.get\('projectId'\)/)
  assert.match(source, /searchParams\.get\('runId'\)/)
  assert.match(source, /setSearchParams\(\{ projectId, runId \}\)/)
})

test('Demo-capable mutation pages expose explicit read-only branches', () => {
  for (const path of [
    'pages/config.tsx',
    'pages/env.tsx',
    'pages/files/files-page.tsx',
    'pages/database/database-page.tsx',
    'pages/agent-sessions.tsx',
    'pages/endpoint-detail/index.tsx',
    'pages/logs.tsx',
    'pages/cron.tsx',
    'pages/dashboard.tsx',
  ]) {
    const source = sourceText(join(SOURCE_ROOT, path))
    assert.match(source, /isDemoMode/, `${path} must derive its Demo permission boundary`)
    assert.match(source, /readOnly|DemoConfigPage/, `${path} must render a read-only Demo state`)
  }
})

test('Demo config is split before the full-config hook can execute', () => {
  const source = sourceText(join(SOURCE_ROOT, 'pages', 'config.tsx'))
  const editableStart = source.indexOf('function EditableConfigPage()')
  const hookCall = source.indexOf('useConfigYaml()', editableStart)
  const wrapper = source.indexOf('export default function ConfigPage()')
  assert.ok(editableStart >= 0 && hookCall > editableStart)
  assert.ok(wrapper > hookCall)
  assert.match(source.slice(wrapper), /isDemoMode\(\) \? <DemoConfigPage \/> : <EditableConfigPage \/>/)
})
