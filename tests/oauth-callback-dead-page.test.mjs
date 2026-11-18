import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { oauthCallbackProblem } from '../console-ui/src/pages/inference/model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `oauth-callback-dead-page`: after authorizing, the browser lands on http://localhost:1455/auth/callback?code=…,
// which nothing answers, so it shows 「无法访问此网站」; the dialog only said 「粘贴最终回调地址」 and took any URL.
const redirect = 'http://localhost:1455/auth/callback'
const source = readFileSync(new URL('../console-ui/src/pages/inference/Accounts.tsx', import.meta.url), 'utf8')

test('the pasted address must be this login’s callback address and carry a code', () => {
  assert.equal(oauthCallbackProblem(`${redirect}?code=ac_123&state=s`, redirect), null)
  assert.equal(oauthCallbackProblem(`  ${redirect}/?code=ac_123  `, redirect), null, 'surrounding spaces and a trailing slash are fine')
  assert.equal(oauthCallbackProblem(`${redirect}?error=access_denied`, redirect), null, 'a provider error is for the Host to report')
  assert.equal(oauthCallbackProblem('', redirect), 'empty')
  assert.equal(oauthCallbackProblem('ac_123', redirect), 'not-url', 'only the code')
  assert.equal(oauthCallbackProblem('localhost:1455/auth/callback?code=1', redirect), 'not-url')
  assert.equal(oauthCallbackProblem('https://auth.openai.com/oauth/authorize?client_id=x', redirect), 'other-address', 'the authorization page itself')
  assert.equal(oauthCallbackProblem('http://localhost:1455/other?code=1', redirect), 'other-address')
  assert.equal(oauthCallbackProblem(redirect, redirect), 'no-code', 'copied before the redirect happened')
  assert.equal(oauthCallbackProblem('http://x.test/cb?code=1', ''), null, 'no challenge address: only the code is checked')
})

test('the dialog explains the dead page, checks before spending the login, and says to close the tab', () => {
  assert.match(source, /并显示「无法访问此网站」之类的错误页：这是正常的/)
  assert.doesNotMatch(source, /i18n\.t\("在浏览器中授权后，粘贴最终回调地址。"\)/)
  assert.match(source, /if \(oauthCallbackProblem\(callback, login\.challenge\.redirectUri\)\) \{ setCallbackChecked\(true\); return \}\s+const callbackUrl = callback/)
  assert.match(source, /placeholder=\{`\$\{login\.challenge\.redirectUri\}\?code=…`\}/)
  assert.match(source, /提交后可以关掉那个标签页/)
  for (const text of ['请粘贴授权后浏览器地址栏里的完整网址。', '这不是一个完整的网址：请从浏览器地址栏复制，以 http:// 或 https:// 开头。', '这不是本次登录的回调地址：网址应以 {0} 开头。', '网址里没有授权码（code=…）：请在授权完成、浏览器跳转之后再复制地址栏。']) {
    assert.ok(source.includes(`i18n.t("${text}"`), text)
    assert.notEqual(translate('en', text), text, `${text} has an English entry`)
  }
})
