import test from 'node:test'
import assert from 'node:assert/strict'
import {
  consumeLoginLink, isLocalNetworkHost, loginFailureField, normalizeHostAddress, readLoginLink, withoutLoginLink,
} from '../console-ui/src/pages/login-model.mjs'

test('a Host address without a scheme gets http:// for IP and local-network hosts and https:// for public names', () => {
  const cases = [
    ['127.0.0.1:8086', 'http://127.0.0.1:8086'],
    ['  localhost:8086/  ', 'http://localhost:8086'],
    ['192.168.1.20:8086', 'http://192.168.1.20:8086'],
    ['10.0.0.2', 'http://10.0.0.2'],
    ['[::1]:8086', 'http://[::1]:8086'],
    ['raspberrypi:8086', 'http://raspberrypi:8086'],
    ['nas.local:8086', 'http://nas.local:8086'],
    ['203.0.113.7:8086', 'http://203.0.113.7:8086'],
    ['bot.example.com', 'https://bot.example.com'],
    ['bot.example.com/zhin/', 'https://bot.example.com/zhin'],
  ]
  for (const [input, value] of cases) assert.deepEqual(normalizeHostAddress(input), { ok: true, value }, input)
})

test('an explicit scheme is kept and trailing slashes are removed', () => {
  assert.deepEqual(normalizeHostAddress('http://localhost:8086///'), { ok: true, value: 'http://localhost:8086' })
  assert.deepEqual(normalizeHostAddress('HTTPS://Bot.Example.com/api/'), { ok: true, value: 'https://bot.example.com/api' })
  assert.deepEqual(normalizeHostAddress('http://bot.example.com:80'), { ok: true, value: 'http://bot.example.com' })
})

test('obviously invalid addresses are rejected with a reason', () => {
  assert.deepEqual(normalizeHostAddress(''), { ok: false, reason: 'empty' })
  assert.deepEqual(normalizeHostAddress('   '), { ok: false, reason: 'empty' })
  assert.deepEqual(normalizeHostAddress(null), { ok: false, reason: 'empty' })
  for (const input of ['ftp://bot.example.com', 'ws://localhost:8086', 'file:///etc/passwd']) assert.deepEqual(normalizeHostAddress(input), { ok: false, reason: 'protocol' }, input)
  for (const input of ['http://', 'local host', 'javascript:alert(1)', 'mailto:a@b', 'http://user:pass@bot.example.com', 'http://bot.example.com/?token=x', 'bot.example.com#x', '::1', 'http://[::1'])
    assert.deepEqual(normalizeHostAddress(input), { ok: false, reason: 'invalid' }, input)
})

test('local-network detection covers loopback and private ranges only', () => {
  for (const host of ['localhost', 'a.localhost', '127.1.2.3', '10.1.1.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '[::1]', 'fd00::1', 'fe80::1', 'printer'])
    assert.equal(isLocalNetworkHost(host), true, host)
  for (const host of ['172.32.0.1', '8.8.8.8', 'bot.example.com', '2001:db8::1'])
    assert.equal(isLocalNetworkHost(host), false, host)
})

test('a login link yields its Host address and token; empty values count as absent', () => {
  assert.deepEqual(readLoginLink('?apiBaseUrl=127.0.0.1%3A8086&token=%20secret-1%20'), { apiBase: '127.0.0.1:8086', token: 'secret-1' })
  assert.deepEqual(readLoginLink('?token='), { apiBase: null, token: null })
  assert.deepEqual(readLoginLink(''), { apiBase: null, token: null })
})

test('the token is removed from the address bar with replaceState, keeping other parameters and the hash', () => {
  const calls = []
  const history = { state: { idx: 3 }, replaceState: (...args) => calls.push(args) }
  const location = { href: 'https://console.example/app/?lang=en&token=secret-1&apiBaseUrl=127.0.0.1:8086#/chat', search: '?lang=en&token=secret-1&apiBaseUrl=127.0.0.1:8086' }
  assert.deepEqual(consumeLoginLink(location, history), { apiBase: '127.0.0.1:8086', token: 'secret-1' })
  assert.deepEqual(calls, [[{ idx: 3 }, '', '/app/?lang=en#/chat']])
  assert.ok(!calls[0][2].includes('secret-1'))
})

test('an empty or token-only parameter is still removed, and a clean address is left untouched', () => {
  const calls = []
  const history = { state: null, replaceState: (...args) => calls.push(args) }
  consumeLoginLink({ href: 'https://console.example/?token=', search: '?token=' }, history)
  consumeLoginLink({ href: 'https://console.example/?token=abc', search: '?token=abc' }, history)
  consumeLoginLink({ href: 'https://console.example/settings?tab=a', search: '?tab=a' }, history)
  assert.deepEqual(calls.map(call => call[2]), ['/', '/'])
  assert.equal(withoutLoginLink('https://console.example/settings?tab=a'), null)
})

test('failed sign-ins are placed on the field that caused them', () => {
  assert.equal(loginFailureField({ ok: false, status: 401, message: '' }), 'token')
  assert.equal(loginFailureField({ ok: false, message: '' }), 'apiBase')
  assert.equal(loginFailureField({ ok: false, status: 500, message: '' }), 'form')
})
