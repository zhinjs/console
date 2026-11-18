import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// #64 `english-catalog-lazy`: the English catalog (~446KB) was statically imported by locale.mjs, so the
// default Chinese interface downloaded it with the first screen.
const locale = new URL('../console-ui/src/i18n/locale.mjs', import.meta.url)
const read = path => readFileSync(new URL(`../console-ui/src/i18n/${path}`, import.meta.url), 'utf8')

test('locale.mjs does not import the English catalog statically', () => {
  const source = read('locale.mjs')
  assert.doesNotMatch(source, /^import [^\n]*messages\.en\.mjs/mu)
  assert.match(source, /import\('\.\/messages\.en\.mjs'\)/u, 'loaded with a dynamic import')
})

test('English copy appears once the catalog is loaded; until then the source text stays', () => {
  // A fresh process without the test preload (tests/helpers/english-catalog.mjs).
  const script = `
    const m = await import(${JSON.stringify(locale.href)})
    const before = [m.englishCatalogReady(), m.translate('en', '刷新'), m.translate('zh-CN', '刷新')]
    await Promise.all([m.loadEnglishCatalog(), m.loadEnglishCatalog()])
    const after = [m.englishCatalogReady(), m.translate('en', '刷新'), m.translate('zh-CN', '刷新'), m.translate('en', '{0} 个工具', [1])]
    console.log(JSON.stringify({ before, after }))`
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }))
  assert.deepEqual(out.before, [false, '刷新', '刷新'])
  assert.equal(out.after[0], true)
  assert.notEqual(out.after[1], '刷新', 'English after loading')
  assert.equal(out.after[2], '刷新', 'Chinese unchanged')
  assert.doesNotMatch(out.after[3], /个/u)
})

test('the provider waits for the catalog on an English start and loads it before switching to English', () => {
  const provider = read('index.tsx')
  assert.match(provider, /useState\(\(\) => locale !== 'en' \|\| englishCatalogReady\(\)\)/)
  assert.match(provider, /if \(!catalogReady\) return null/)
  assert.match(provider, /if \(next !== 'en' \|\| englishCatalogReady\(\)\) \{ setValue\(next\); return \}\s+loadEnglishCatalog\(\)\.then\(\(\) => setValue\(next\)/)
  // A failed download falls back to Chinese instead of an empty page.
  assert.match(provider, /\(\) => \{ if \(current\) \{ setValue\(DEFAULT_LOCALE\); setCatalogReady\(true\) \} \}/)
})
