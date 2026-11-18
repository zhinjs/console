import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { effectiveAuthMethod } from '../console-ui/src/pages/inference/model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `account-auth-single-option`: a new Codex account offered only 「订阅登录」 under 认证方式, yet left it
// unselected, so 「保存」 stayed disabled until that single option was picked by hand.
const source = readFileSync(new URL('../console-ui/src/pages/inference/Accounts.tsx', import.meta.url), 'utf8')

test('a single authentication method is the one used; a choice among several is still the user’s', () => {
  assert.equal(effectiveAuthMethod('', ['oauth']), 'oauth')
  assert.equal(effectiveAuthMethod('', ['api-key']), 'api-key')
  assert.equal(effectiveAuthMethod('', ['api-key', 'oauth']), '')
  assert.equal(effectiveAuthMethod('', []), '')
  assert.equal(effectiveAuthMethod('api-key', ['api-key', 'oauth']), 'api-key')
  assert.equal(effectiveAuthMethod('oauth', ['oauth']), 'oauth')
})

test('the form saves, shows and enables 保存 with that method; existing accounts keep theirs', () => {
  assert.match(source, /const authMethod = updating \? method : effectiveAuthMethod\(method, methods\)/)
  assert.match(source, /value=\{authMethod\}\s+onValueChange=\{setMethod\}/)
  assert.match(source, /\{ method: authMethod, \.\.\.\(authMethod === 'api-key' && authSource/)
  assert.match(source, /disabled=\{!optionsValid \|\| !authMethod \|\| !driver\}/)
  assert.doesNotMatch(source, /disabled=\{!optionsValid \|\| !method \|\| !driver\}/)
})

test('「新增服务」 says it is the same as 「添加服务」 on the Services tab', () => {
  const note = '在这里新增服务，和「服务」页签的「添加服务」是一样的：建好后其他账号也能选用。'
  assert.match(source, /\{!updating && !serviceId \? \(/)
  assert.ok(source.includes(`i18n.t("${note}")`))
  assert.notEqual(translate('en', note), note)
})
