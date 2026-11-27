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
  // Review M3: the reference is fixed in the Console as soon as it is saved; the first call or a
  // successful 「测试连接」 only activates it.
  assert.doesNotMatch(accounts, /env:\/\/ 引用在首次调用时激活，之后不能在 Console 修改/u)
  const hint = '只能引用以 _API_KEY 结尾的变量。env:// 引用保存后不能在 Console 修改（首次调用或测试连接成功时激活）；要随时重设，请在「设置密钥」里填写 ${VAR:-}。'
  assert.ok(accounts.includes(`i18n.t("${hint}")`))
  const en = translate('en', hint)
  assert.notEqual(en, hint, 'the hint has an English entry')
  assert.match(en, /env:\/\/.*cannot be changed in the Console once saved.*first call or a successful connection test.*\$\{VAR:-\}.*Set key/u)
  assert.doesNotMatch(en, /afterwards/u)
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
  assert.equal(fallbackDocUrl('zh-CN'), 'https://zhin.js.org/ai/model-policy#' + encodeURIComponent('备用模型-fallbacks'))
  assert.equal(fallbackDocUrl('en'), 'https://zhin.js.org/en/ai/model-policy#fallback-models')
  assert.equal(translate('en', '切换规则'), 'Switching rules')
})

// `c111-repeated-help-text`: every model in use repeated 「（点名称到「用途」页签修改）」 although each
// 「谁在用」 entry is already a button.
test('clickable usages carry no repeated help text', () => {
  const profiles = inference('Profiles.tsx')
  assert.doesNotMatch(profiles, /点名称到「用途」页签修改/u)
  assert.doesNotMatch(read('console-ui/src/i18n/messages.en.insights.mjs'), /点名称到「用途」页签修改/u)
  assert.match(profiles, /\{allLinked \? null : <span className="ml-1">\{i18n\.t\("（在「用途」页签修改）"\)\}<\/span>\}/u)
  // Rendered both ways in console-small-1250-render.test.mjs (review L1 / L3).
})

// `c111-layout-audit-console-pages`: report-only CI job over the Console's own pages.
test('CI runs the console-ui layout audit as a report-only job', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = ci.slice(ci.indexOf('\n  layout-audit:'))
  assert.ok(ci.includes('\n  layout-audit:'))
  assert.match(job, /continue-on-error: true/u)
  assert.match(job, /playwright install --with-deps chromium/u)
  // Review L4: named apart from `pnpm audit`, pull requests only, no persisted token.
  assert.match(job, /pnpm check:layout-audit/u)
  assert.doesNotMatch(ci, /audit:layout/u)
  assert.match(job, /if: github\.event_name == 'pull_request'/u)
  assert.match(job, /- uses: actions\/checkout@[0-9a-f]{40}\n\s+with:\n\s+persist-credentials: false/u)
  assert.match(job, /GITHUB_STEP_SUMMARY/u)
  const script = read('scripts/layout-audit.mjs')
  assert.match(script, /from '@zhin\.js\/console-ui\/audit'/u)
  assert.match(script, /runLayoutAudit/u)
  const scripts = JSON.parse(read('package.json')).scripts
  assert.equal(scripts['check:layout-audit'], 'node scripts/layout-audit.mjs')
  assert.equal('audit:layout' in scripts, false)
  assert.match(read('README.md'), /pnpm check:layout-audit \[路由 …\]/u)
  assert.doesNotMatch(read('README.md'), /audit:layout/u)
})
