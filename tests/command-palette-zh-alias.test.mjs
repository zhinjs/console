import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { commandScore, ROUTE_SEARCH_HINTS } from '../console-ui/src/components/command-center-model.mjs'

// #64 `command-palette-zh-alias`: the Workroom pages are titled in English, and ⌘K found nothing for
// 「工作室」, the Chinese name people search by.
const navigation = readFileSync(new URL('../console-ui/src/i18n/navigation.ts', import.meta.url), 'utf8')
const titles = Object.fromEntries([...navigation.matchAll(/^\s+"(\/[^"]+)": "([^"]+)",$/gmu)].map(match => [match[1], match[2]]))
const han = /\p{Script=Han}/u

const target = path => ({
  path,
  title: titles[path],
  group: 'AI',
  description: ROUTE_SEARCH_HINTS[path].description,
  keywords: ROUTE_SEARCH_HINTS[path].keywords,
})

test('「工作室」 finds both Workroom pages', () => {
  for (const path of ['/features/ai/workrooms', '/features/ai/workrooms/catalog']) {
    assert.ok(titles[path].startsWith('Workroom'), `${path} is still titled in English`)
    assert.ok(commandScore(target(path), '工作室') > 0, path)
  }
  assert.ok(commandScore(target('/features/ai/workrooms/catalog'), '工作室 配置') > 0, 'the catalog page by 「工作室 配置」')
})

test('a page whose title starts with an English word can be found by a Chinese name for it', () => {
  // `Token 用量`, `Console 角色`, `API 令牌` keep their Chinese half; `Workroom` needs the alias.
  const english = Object.entries(titles).filter(([path, title]) => /^[A-Za-z]/u.test(title) && !/[:*]/u.test(path))
  assert.ok(english.length >= 2)
  for (const [path, title] of english) {
    const word = title.match(/^[A-Za-z]+/u)[0]
    const rest = title.slice(word.length)
    const keywords = ROUTE_SEARCH_HINTS[path]?.keywords ?? []
    assert.ok(han.test(rest) || keywords.some(keyword => han.test(keyword)), `${path} 「${title}」`)
  }
  // The pure English title has its own Chinese alias, not only words for neighbouring concepts.
  assert.ok(ROUTE_SEARCH_HINTS['/features/ai/workrooms'].keywords.includes('工作室'))
})
