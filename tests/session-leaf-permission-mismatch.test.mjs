import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { httpRouteAccess, httpRoutePermission } from '../console-ui/src/utils/http-permission.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `session-leaf-permission-mismatch` (the page behaviour is in conversation-page.test.mjs).
test('the protocol table decides: switching a session branch needs agent.configure, reading it agent.view', () => {
  assert.equal(httpRoutePermission('POST', '/agent/sessions/icqq%3Abot%3Agroup%3Aroom/leaf'), 'agent.configure')
  assert.equal(httpRoutePermission('GET', '/agent/sessions/icqq%3Abot%3Agroup%3Aroom/tree'), 'agent.view')
  assert.equal(httpRoutePermission('POST', '/no/such/route'), null, 'unmapped: the Host denies it')
  const operator = new Set(['endpoint.operate', 'agent.view'])
  assert.deepEqual(httpRouteAccess('POST', '/agent/sessions/k/leaf', name => operator.has(name)), { allowed: false, missing: 'agent.configure' })
  assert.deepEqual(httpRouteAccess('POST', '/agent/sessions/k/leaf', () => true), { allowed: true, missing: null })
  assert.deepEqual(httpRouteAccess('POST', '/no/such/route', () => true), { allowed: false, missing: null }, 'never open for an unmapped route')
})

test('the page no longer gates the switch on endpoint.operate, and the note is translated', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/agent-sessions.tsx', import.meta.url), 'utf8')
  assert.match(page, /httpRouteAccess\('POST', '\/agent\/sessions\/_\/leaf', name => hasConsolePermission\(name\)\)/)
  assert.doesNotMatch(translate('en', '需要「{0}」权限才能从其他消息继续。', ['x']), /[一-鿿]/u)
  assert.doesNotMatch(translate('en', '当前协议没有登记切换会话分支的权限，不能从其他消息继续。'), /[一-鿿]/u)
})

test('rpc and bootstrap rules are closed, any other named permission (plugin ones too) is required as is', async () => {
  const { CONSOLE_HTTP_PERMISSIONS } = await import('@zhin.js/console-protocol')
  for (const rule of CONSOLE_HTTP_PERMISSIONS) {
    if (rule.method === '*' || rule.prefix) continue
    const expected = ['rpc', 'bootstrap'].includes(rule.permission) ? null : ['authenticated', 'public'].includes(rule.permission) ? '' : rule.permission
    assert.equal(httpRoutePermission(rule.method, rule.path), expected, `${rule.method} ${rule.path}`)
  }
})
