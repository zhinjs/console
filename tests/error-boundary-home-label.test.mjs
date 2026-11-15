import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const source = readFileSync(new URL('../console-ui/src/components/page-error-boundary.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../console-ui/src/registerBuiltinShell.tsx', import.meta.url), 'utf8')

test('the error page sends people home under the name the navigation uses', () => {
  const link = source.split('\n').find(line => line.includes('to="/dashboard"'))
  assert.ok(link, 'the fallback still links to /dashboard')
  assert.match(link, /message='返回首页'/)
  assert.doesNotMatch(source, /Dashboard'/, 'no English page name in the Chinese copy')
  assert.match(shell, /path: P\.dashboard, name: '首页'/, 'the navigation calls /dashboard 首页')
  assert.equal(translate('en', '返回首页'), 'Back to Home')
  assert.equal(translate('en', '首页'), 'Home')
  assert.equal(Object.hasOwn(englishMessages, '返回 Dashboard'), false, 'the old entry is removed')
})

test('both fallback actions are full touch targets on phones', () => {
  for (const marker of ['<button type="button"', 'to="/dashboard"']) {
    const line = source.split('\n').find(row => row.includes(marker))
    assert.match(line, /max-md:min-h-11/, `${marker} reaches 44px on phones`)
  }
})
