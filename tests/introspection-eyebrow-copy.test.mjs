import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const source = readFileSync(new URL('../console-ui/src/pages/introspection/CapabilityExplorer.tsx', import.meta.url), 'utf8')
const TABS = ['commands', 'middlewares', 'components', 'endpoints', 'bindings', 'tools', 'prompt-sections', 'mcp']

function headerCopy(tab) {
  const key = tab.includes('-') ? `'${tab}'` : tab
  const line = source.split('\n').find(row => row.trimStart().startsWith(`${key}: { eyebrow:`))
  assert.ok(line, `${tab} has header copy`)
  const [eyebrow, title] = [...line.matchAll(/t\('([^']*)'\)/g)].map(match => match[1])
  return { eyebrow, title }
}

test('every capability tab eyebrow is authored in Chinese and translated for English', () => {
  for (const tab of TABS) {
    const { eyebrow, title } = headerCopy(tab)
    assert.match(eyebrow, /[㐀-鿿]/, `${tab} eyebrow "${eyebrow}" would show untranslated in the Chinese UI`)
    assert.ok(Object.hasOwn(englishMessages, eyebrow), `${tab} eyebrow "${eyebrow}" has an English entry`)
    if (tab !== 'components') assert.notEqual(eyebrow, title, `${tab} eyebrow repeats the title`)
  }
})

test('the header reads its eyebrow through the translated copy, not a raw table value', () => {
  assert.match(source, /const meta = kindCopy\(\(message\) => i18n\.t\(message\)\)\[kind\]/)
  assert.doesNotMatch(source, /eyebrow: '[^']*'/)
})
