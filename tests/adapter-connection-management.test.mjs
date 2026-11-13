import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const src = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('the adapter page has one 刷新: the header re-reads accounts and the embedded SDK page', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /const refresh = \(\) => \{ data\.refresh\(\); setManagementRefresh\(value => value \+ 1\) \}/)
  assert.match(page, /actions=\{<Button variant="outline" size="sm" onClick=\{refresh\}/)
  assert.match(page, /<AdapterConsolePage adapterKey=\{adapter\} embedded refreshKey=\{refreshKey\} toolbar=\{toolbar\} \/>/)
  // The toolbar uses the Console's own button variants, never the SDK's zk-btn.
  const toolbar = page.slice(page.indexOf('const toolbar ='), page.indexOf('return (', page.indexOf('const toolbar =')))
  assert.match(toolbar, /<Button asChild variant="outline" size="sm">/)
  assert.match(toolbar, /<Button size="sm" variant=\{add\.open \? 'outline' : 'default'\}/)
  assert.doesNotMatch(toolbar, /zk-btn/)
})

test('the published SDK embedded mode replaces the old header-hiding CSS', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /import \{ AdapterConsolePage, type AdapterConsoleToolbarControls \} from '@zhin\.js\/client'/)
  assert.doesNotMatch(page, /data-sdk-embedded|capabilities\?\./)
  const css = await src('pages/scope/scope-pages.css')
  assert.doesNotMatch(css, /data-sdk-embedded|\.zk-page-header/)
  const sdk = await readFile(new URL('../node_modules/@zhin.js/client/dist/adapter-console/AdapterConsolePage.js', import.meta.url), 'utf8')
  assert.match(sdk, /ADAPTER_CONSOLE_PAGE_CAPABILITIES = Object\.freeze\(\{ embedded: true, toolbar: true, refreshKey: true \}\)/)
  assert.match(sdk, /!embedded && _jsx\(PageHeader/, 'embedded mode draws no SDK page header')
})
