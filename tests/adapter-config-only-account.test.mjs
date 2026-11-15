import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { endpointAccessState, endpointInfoWanted } from '../console-ui/src/pages/scope/scope-overview-model.mjs'

const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('an account the Host does not run is not asked for endpoint.info', () => {
  const row = { name: 'bot-a', adapter: 'icqq' }
  const listed = endpointAccessState({ loaded: true, endpoints: [row] }, 'icqq', 'bot-a')
  const unlisted = endpointAccessState({ loaded: true, endpoints: [row] }, 'icqq', 'bot-b')
  assert.equal(unlisted.kind, 'unlisted')
  assert.equal(endpointInfoWanted(unlisted), false, 'it can only answer 「endpoint not found」')
  assert.equal(endpointInfoWanted(listed), true)
  assert.equal(endpointInfoWanted(endpointAccessState({ loaded: false, endpoints: [] }, 'icqq', 'bot-a')), false, 'waits for the list instead of racing it')
  assert.equal(endpointInfoWanted(endpointAccessState({ loaded: false, error: new Error('x'), endpoints: [] }, 'icqq', 'bot-a')), true, 'an unreadable list still lets the details be read')
})

test('the account page wires the decision in and explains an unlisted account instead of a read failure', () => {
  const page = read('pages/scope/endpoint-page.tsx')
  assert.match(page, /useEndpointInfo\(adapter, endpoint, endpointInfoWanted\(listed\)\)/)
  assert.ok(page.indexOf('const listed = endpointAccessState') < page.indexOf('useEndpointInfo('), 'the list decides before the read')
  const hook = read('pages/scope/scope-panels.tsx')
  assert.match(hook, /if \(!enabled\) return\n/)
  assert.match(hook, /return enabled \? state : \{ info: null, error: null, loaded: false \}/, 'held back, not reported as loaded')
  assert.match(page, /unlisted=\{listed\.kind === 'unlisted'\}/)
  const overview = read('pages/scope/overview-panels.tsx')
  const body = overview.slice(overview.indexOf('export function EndpointOverview'))
  assert.ok(body.indexOf('{unlisted ? (') < body.indexOf('读取账号状态失败'), 'the explanation wins over the read-failure state')
  assert.match(body, /账号 \{0\} 当前没有运行/)
  assert.match(body, /onOpenTab\('access'\)/)
})
