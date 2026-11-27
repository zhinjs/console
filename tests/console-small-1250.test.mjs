import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { fallbackDocUrl } from '../console-ui/src/pages/inference/model.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const inference = path => read(`console-ui/src/pages/inference/${path}`)

// zhinjs/zhin#1250 `account-env-create-dialog-unclear`: the new-account dialog did not say how an env://
// reference differs from ${VAR:-} under 「设置密钥」, and still claimed the service had to be an existing
// one or a built-in service's official address (the Host no longer restricts the address for Console owners).
test('the new-account dialog explains env:// against ${VAR:-} and drops the address rule', () => {
  const accounts = inference('Accounts.tsx')
  assert.doesNotMatch(accounts, /服务需为已有服务或内置服务的官方地址/u)
  const hint = '只能引用以 _API_KEY 结尾的变量。env:// 引用在首次调用时激活，之后不能在 Console 修改；要随时重设，请在「设置密钥」里填写 ${VAR:-}。'
  assert.ok(accounts.includes(`i18n.t("${hint}")`))
  const en = translate('en', hint)
  assert.notEqual(en, hint, 'the hint has an English entry')
  assert.match(en, /env:\/\/.*first call.*\$\{VAR:-\}.*Set key/u)
  assert.doesNotMatch(en, /official address/u)
})

// `console-fallback-hint-stale`: the hint named only quota, credit and rejected keys, while network errors,
// 5xx and repeated timeouts switch too (zhin packages/im/ai/src/llm/model-fallback.ts, docs/ai/model-policy.md).
test('the fallback hint names every switching class and links the rules', () => {
  const purposes = inference('Purposes.tsx')
  assert.doesNotMatch(purposes, /主模型额度用完、余额不足或密钥被拒时/u)
  const hint = '主模型额度用完、余额不足、密钥被拒、连续超时，或网络错误和 5xx 在同模型重试后仍失败时，按顺序换用这一层配置的备用模型。'
  assert.ok(purposes.includes(`i18n.t("${hint}")`))
  assert.match(translate('en', hint), /quota.*key is rejected.*times out repeatedly.*network errors and 5xx/u)
  assert.match(purposes, /href=\{fallbackDocUrl\(i18n\.locale\)\}/u)
  assert.equal(fallbackDocUrl('zh-CN'), 'https://zhin.js.org/ai/model-policy#' + encodeURIComponent('备用模型fallbacks'))
  assert.equal(fallbackDocUrl('en'), 'https://zhin.js.org/en/ai/model-policy#fallback-models')
  assert.equal(translate('en', '切换规则'), 'Switching rules')
})

// `c111-repeated-help-text`: every model in use repeated 「（点名称到「用途」页签修改）」 although each
// 「谁在用」 entry is already a button.
test('clickable usages carry no repeated help text', () => {
  const profiles = inference('Profiles.tsx')
  assert.doesNotMatch(profiles, /点名称到「用途」页签修改/u)
  assert.doesNotMatch(read('console-ui/src/i18n/messages.en.insights.mjs'), /点名称到「用途」页签修改/u)
  assert.match(profiles, /\{onOpen \? null : <span className="ml-1">\{i18n\.t\("（在「用途」页签修改）"\)\}<\/span>\}/u)
})

// `c111-layout-audit-console-pages`: report-only CI job over the Console's own pages.
test('CI runs the console-ui layout audit as a report-only job', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = ci.slice(ci.indexOf('\n  layout-audit:'))
  assert.ok(ci.includes('\n  layout-audit:'))
  assert.match(job, /continue-on-error: true/u)
  assert.match(job, /playwright install --with-deps chromium/u)
  assert.match(job, /pnpm audit:layout/u)
  assert.match(job, /GITHUB_STEP_SUMMARY/u)
  const script = read('scripts/layout-audit.mjs')
  assert.match(script, /from '@zhin\.js\/console-ui\/audit'/u)
  assert.match(script, /runLayoutAudit/u)
  assert.equal(JSON.parse(read('package.json')).scripts['audit:layout'], 'node scripts/layout-audit.mjs')
})
