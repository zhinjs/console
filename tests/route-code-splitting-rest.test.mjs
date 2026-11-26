import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { firstScreenScripts, firstScreenSize, FIRST_SCREEN_GZIP_BUDGET } from '../scripts/first-screen-size.mjs'

// #64 `route-code-splitting-rest`: the sign-in page downloaded ~922KB (gzip) of JS, because every page
// except five (#64 `route-code-splitting`) was imported statically by registerBuiltinShell.tsx — and the
// plugin page also by loadConsoleEntries.ts. Only 首页 (the first page after signing in) stays static.
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const shell = read('registerBuiltinShell.tsx')

test('every route page but 首页 is loaded when first opened', () => {
  const staticPages = [...shell.matchAll(/^import (\w+) from '(\.\/pages\/[^']+)'$/gmu)].map(match => `${match[1]} ← ${match[2]}`)
  assert.deepEqual(staticPages, ['HomePage ← ./pages/dashboard'])
  for (const [, name] of shell.matchAll(/element: <(\w+Page|ScopeObjectRoute) \/>/gu)) {
    assert.ok(name === 'HomePage' || new RegExp(`const ${name} = lazyPage\\(\\(\\) => import\\('\\./pages/`).test(shell), `${name} is loaded on demand`)
  }
})

test('the plugin page opened as a plugin page tab is loaded on demand too, with its props', () => {
  const entries = read('bootstrap/loadConsoleEntries.ts')
  assert.doesNotMatch(entries, /^import PluginDetailPage/mu, 'not imported statically')
  assert.match(entries, /const PluginDetailPage = lazyPage<PluginDetailPageProps>\(\(\) => import\('\.\.\/pages\/plugin-detail'\)\)/)
  assert.match(entries, /^import type \{ PluginDetailPageProps \} from '\.\.\/pages\/plugin-detail'$/mu)
  const helper = read('lazy-page.tsx')
  assert.match(helper, /<Page \{\.\.\.props\} \/>/, 'a lazy page passes its props on')
})

test('the first-screen size check reads the scripts index.html loads and gzips them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'first-screen-'))
  mkdirSync(join(dir, 'nested'))
  writeFileSync(join(dir, 'a.js'), 'x'.repeat(10_000))
  writeFileSync(join(dir, 'nested', 'b.js'), 'console.log(1)')
  writeFileSync(join(dir, 'lazy.js'), 'y'.repeat(50_000))
  const html = '<script>inline()</script><script src=/a.js data-farm-resource=true></script><script src="./nested/b.js" type="module"></script><link rel=stylesheet href=/x.css>'
  writeFileSync(join(dir, 'index.html'), html)
  assert.deepEqual(firstScreenScripts(html), ['a.js', 'nested/b.js'], 'only the scripts index.html loads; inline and lazy ones are not counted')
  const size = firstScreenSize(dir)
  assert.equal(size.files, 2)
  assert.ok(size.gzipBytes > 0 && size.gzipBytes < 1_000)
  assert.ok(FIRST_SCREEN_GZIP_BUDGET > 0)
})

test('pnpm build fails when the first screen grows past its budget', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.build, 'farm build && node scripts/first-screen-size.mjs dist')
  // 903 KB (gzip) before this change; the budget must stay well below it.
  assert.ok(FIRST_SCREEN_GZIP_BUDGET <= 600 * 1024, `budget ${FIRST_SCREEN_GZIP_BUDGET}`)
})
