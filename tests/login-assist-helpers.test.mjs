import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPTCHA_NONCE_PATTERN, DEFAULT_CAPTCHA_HELPER_URL, isValidCaptchaNonce, LOGIN_CAPTCHA_MESSAGE_TYPE, buildCaptchaHelperUrl, captchaHelperOrigin, createCaptchaNonce,
  createCaptchaReplyGate, extractLoginTicket, openCaptchaPopup, isValidCaptchaHelperUrl, parseCaptchaHelperMessage, parseCaptchaHelperPayload, parseLoginTicket,
} from '../console-ui/src/pages/scope/login-assist-helpers.mjs'

// The same vectors as @zhin.js/core (packages/im/core/tests/login-flow.test.ts and login-captcha.test.ts).
const QUERY = 'uin=10001&sid=abc&cap_cd=x%2By&aid=2081081773'

test('parseLoginTicket accepts what core accepts', () => {
  for (const [input, expected] of [
    ['t03abc', { ok: true, ticket: 't03abc' }],
    ['  t03abc  ', { ok: true, ticket: 't03abc' }],
    ['t03abc,@rand', { ok: true, ticket: 't03abc', randstr: '@rand' }],
    ['{"ret":0,"ticket":"t03abc","randstr":"@r"}', { ok: true, ticket: 't03abc', randstr: '@r' }],
    ['{"data":{"ticket":"t03abc"}}', { ok: true, ticket: 't03abc' }],
    ['{"result":{"ticket":"t03abc","randstr":"@r"}}', { ok: true, ticket: 't03abc', randstr: '@r' }],
    ['https://ssl.captcha.qq.com/x?ticket=t03abc&randstr=%40r', { ok: true, ticket: 't03abc', randstr: '@r' }],
    ['https://example.com/cb#ticket=t03abc', { ok: true, ticket: 't03abc' }],
  ]) assert.deepEqual(parseLoginTicket(input), expected, input)
})

test('parseLoginTicket rejects with core\'s precise messages', () => {
  for (const [input, message] of [
    ['', '请粘贴'],
    ['{"ret":0', 'JSON 格式不完整'],
    ['{"ret":0}', 'JSON 中没有 ticket 字段'],
    ['https://example.com/?a=1', '链接中没有 ticket 参数'],
    ['a,b,c', 'ticket,randstr'],
    ['t03 abc', '空白字符'],
    ['{"ticket":"  "}', '没有找到 ticket'],
  ]) {
    const result = parseLoginTicket(input)
    assert.equal(result.ok, false, input)
    assert.ok(result.error.includes(message), `${input}: ${result.error}`)
  }
  assert.equal(parseLoginTicket(undefined).ok, false)
  assert.equal(parseLoginTicket(42).ok, false)
  assert.equal(extractLoginTicket('{"ticket":"t1","randstr":"r"}'), 't1')
  assert.equal(extractLoginTicket('  not,a,ticket '), 'not,a,ticket')
})

test('buildCaptchaHelperUrl is byte-for-byte what core builds', () => {
  // Produced by @zhin.js/core buildCaptchaHelperUrl() for the same inputs.
  assert.equal(
    buildCaptchaHelperUrl({ query: `?${QUERY}`, nonce: 'nonce-12345', origin: 'https://console.example' }),
    'https://zhin.js.org/login-assist/tcaptcha.html#eyJxIjoidWluPTEwMDAxJnNpZD1hYmMmY2FwX2NkPXglMkJ5JmFpZD0yMDgxMDgxNzczIiwibiI6Im5vbmNlLTEyMzQ1IiwibyI6Imh0dHBzOi8vY29uc29sZS5leGFtcGxlIn0',
  )
  assert.equal(
    buildCaptchaHelperUrl({ helperUrl: 'http://localhost:5173/tcaptcha.html?v=2#old', query: 'q=中文&x=1', nonce: 'Ab9._~-zzzz', origin: 'http://127.0.0.1:8086/' }),
    'http://localhost:5173/tcaptcha.html?v=2#eyJxIjoicT3kuK3mlocmeD0xIiwibiI6IkFiOS5ffi16enp6IiwibyI6Imh0dHA6Ly8xMjcuMC4wLjE6ODA4NiJ9',
  )
  const url = new URL(buildCaptchaHelperUrl({ query: `?${QUERY}`, nonce: 'nonce-12345', origin: 'https://console.example' }))
  assert.equal(`${url.origin}${url.pathname}`, DEFAULT_CAPTCHA_HELPER_URL)
  assert.equal(url.search, '')
  assert.match(url.hash, /^#[A-Za-z0-9_-]+$/u)
  assert.deepEqual(parseCaptchaHelperPayload(url.hash), { q: QUERY, n: 'nonce-12345', o: 'https://console.example' })
})

test('buildCaptchaHelperUrl refuses unsafe helpers, origins, short nonces and empty queries', () => {
  assert.match(buildCaptchaHelperUrl({ helperUrl: 'http://localhost:5173/tcaptcha.html', query: QUERY, nonce: 'nonce-12345', origin: 'http://127.0.0.1:8086' }), /^http:\/\/localhost:5173\/tcaptcha\.html#/u)
  assert.throws(() => buildCaptchaHelperUrl({ helperUrl: 'http://evil.example/x', query: QUERY, nonce: 'nonce-12345', origin: 'https://c.example' }), /https/u)
  assert.throws(() => buildCaptchaHelperUrl({ helperUrl: 'javascript:alert(1)', query: QUERY, nonce: 'nonce-12345', origin: 'https://c.example' }))
  assert.throws(() => buildCaptchaHelperUrl({ helperUrl: 'https://user:pw@helper.example/x', query: QUERY, nonce: 'nonce-12345', origin: 'https://c.example' }))
  assert.throws(() => buildCaptchaHelperUrl({ query: QUERY, nonce: 'short', origin: 'https://c.example' }), /nonce/u)
  assert.throws(() => buildCaptchaHelperUrl({ query: QUERY, nonce: 'nonce-12345', origin: 'https://c.example/path' }), /origin/u)
  assert.throws(() => buildCaptchaHelperUrl({ query: QUERY, nonce: 'nonce-12345', origin: 'null' }), /origin/u)
  assert.throws(() => buildCaptchaHelperUrl({ query: '', nonce: 'nonce-12345', origin: 'https://c.example' }), /query/u)
  assert.equal(parseCaptchaHelperPayload('#not-base64!'), null)
  assert.equal(isValidCaptchaHelperUrl('https://helper.example/x'), true)
  assert.equal(isValidCaptchaHelperUrl('http://helper.example/x'), false)
  assert.equal(isValidCaptchaHelperUrl(42), false)
  assert.equal(captchaHelperOrigin('ftp://x/y'), null)
})

test('helper messages are accepted only from the helper origin with the opener nonce', () => {
  const helperOrigin = captchaHelperOrigin()
  assert.equal(helperOrigin, 'https://zhin.js.org')
  const data = { type: LOGIN_CAPTCHA_MESSAGE_TYPE, nonce: 'nonce-12345', ticket: 't03abc', randstr: '@xyz' }
  const expected = { helperOrigin, nonce: 'nonce-12345' }
  assert.deepEqual(parseCaptchaHelperMessage({ origin: helperOrigin, data }, expected), { ticket: 't03abc', randstr: '@xyz' })
  assert.equal(parseCaptchaHelperMessage({ origin: 'https://evil.example', data }, expected), null, 'wrong origin')
  assert.equal(parseCaptchaHelperMessage({ origin: helperOrigin, data }, { helperOrigin, nonce: 'other-nonce' }), null, 'wrong nonce')
  assert.equal(parseCaptchaHelperMessage({ origin: helperOrigin, data: { ...data, type: 'other' } }, expected), null)
  assert.equal(parseCaptchaHelperMessage({ origin: helperOrigin, data: { ...data, ticket: 'a,b' } }, expected), null)
  assert.equal(parseCaptchaHelperMessage({ origin: helperOrigin, data: { ...data, randstr: 'a b' } }, expected), null)
  assert.equal(parseCaptchaHelperMessage({ origin: helperOrigin, data: { ...data, ticket: 'x'.repeat(4097) } }, expected), null)
  assert.equal(parseCaptchaHelperMessage({ origin: helperOrigin, data: 'string' }, expected), null)
  assert.equal(parseCaptchaHelperMessage({ origin: helperOrigin, data }, { helperOrigin, nonce: '' }), null)
})

test('the reply gate takes one reply per nonce: replays, wrong origins and wrong nonces are ignored', () => {
  const gate = createCaptchaReplyGate({ helperUrl: 'https://helper.example/tcaptcha.html', nonce: 'nonce-abcdef' })
  assert.equal(gate.helperOrigin, 'https://helper.example')
  const data = { type: LOGIN_CAPTCHA_MESSAGE_TYPE, nonce: 'nonce-abcdef', ticket: 't1', randstr: 'r1' }
  assert.equal(gate.accept({ origin: 'https://zhin.js.org', data }), null, 'the default helper is not this helper')
  assert.equal(gate.accept({ origin: 'https://helper.example', data: { ...data, nonce: 'nonce-other' } }), null)
  assert.equal(gate.used, false)
  assert.deepEqual(gate.accept({ origin: 'https://helper.example', data }), { ticket: 't1', randstr: 'r1' })
  assert.equal(gate.used, true)
  assert.equal(gate.accept({ origin: 'https://helper.example', data }), null, 'a replay is ignored')
  assert.equal(gate.accept({ origin: 'https://helper.example', data: { ...data, ticket: 't2' } }), null, 'a second answer is ignored')
  const invalid = createCaptchaReplyGate({ helperUrl: 'http://evil.example/x', nonce: 'nonce-abcdef' })
  assert.equal(invalid.helperOrigin, null)
  assert.equal(invalid.accept({ origin: 'http://evil.example', data }), null)
})

test('nonces are base64url from a CSPRNG and follow the helper page rule (16–64 of [A-Za-z0-9._~-])', () => {
  assert.equal(String(CAPTCHA_NONCE_PATTERN), String(/^[A-Za-z0-9._~-]{16,64}$/u))
  const nonce = createCaptchaNonce()
  assert.equal(nonce.length, 24)
  assert.match(nonce, /^[A-Za-z0-9_-]{24}$/u, 'base64url: no +, / or =')
  assert.notEqual(createCaptchaNonce(), nonce)
  // Bytes 0xfb 0xff map to "+/" in base64 and must come out as "-_".
  const fake = { getRandomValues(array) { array.fill(0xff); array[0] = 0xfb; return array } }
  const fixed = createCaptchaNonce(fake, 18)
  assert.equal(fixed, '-___________________________'.slice(0, 24))
  assert.ok(isValidCaptchaNonce(fixed))
  assert.throws(() => createCaptchaNonce(fake, 9), /16–64/u, '12 characters are too short')
  assert.throws(() => createCaptchaNonce(fake, 60), /16–64/u, '80 characters are too long')
  assert.throws(() => createCaptchaNonce(null), /getRandomValues/u)
  assert.throws(() => createCaptchaNonce({}), /getRandomValues/u)
  for (const value of ['short', 'a'.repeat(65), 'has space in it!!', 'plus+slash/equals=1', 42]) assert.equal(isValidCaptchaNonce(value), false, String(value))
  assert.equal(isValidCaptchaNonce('Ab9._~-zzzzzzzzzz'), true)
  assert.doesNotThrow(() => buildCaptchaHelperUrl({ query: QUERY, nonce, origin: 'https://c.example' }))
})

test('the popup opens about:blank, gets no-referrer and navigates itself through a noreferrer link (opener kept)', () => {
  const calls = []
  const element = tag => ({ tag, attributes: {}, setAttribute(name, value) { this.attributes[name] = value }, click() { calls.push(['click', this.attributes]) } })
  const doc = { head: { children: [], appendChild(node) { this.children.push(node) } }, body: { children: [], appendChild(node) { this.children.push(node) } }, createElement: element }
  const popup = { document: doc, closed: false, close() { this.closed = true } }
  const win = { open: (...args) => { calls.push(['open', ...args]); return popup } }
  const url = buildCaptchaHelperUrl({ query: QUERY, nonce: 'nonce-1234567890abcdef', origin: 'https://console.example' })
  assert.equal(openCaptchaPopup(win, url), popup)
  assert.deepEqual(calls[0], ['open', 'about:blank', 'zhin-login-captcha', 'popup=yes,width=440,height=640'])
  assert.doesNotMatch(calls[0][3], /noopener|noreferrer/u, 'the window feature would cut window.opener')
  assert.deepEqual(doc.head.children[0].attributes, { name: 'referrer', content: 'no-referrer' })
  assert.deepEqual(calls[1], ['click', { href: url, rel: 'noreferrer', referrerpolicy: 'no-referrer' }])
  // Blocked: null. Not preparable (cross-origin document): closed, null — never a navigation with the referrer.
  assert.equal(openCaptchaPopup({ open: () => null }, url), null)
  const hostile = { get document() { throw new Error('SecurityError') }, closed: false, close() { this.closed = true } }
  assert.equal(openCaptchaPopup({ open: () => hostile }, url), null)
  assert.equal(hostile.closed, true)
})
