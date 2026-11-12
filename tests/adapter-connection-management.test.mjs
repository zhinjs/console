import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const src = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('the adapter page has one 刷新: the header re-reads accounts and the embedded SDK page', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /const refresh = \(\) => \{ data\.refresh\(\); setManagementRefresh\(value => value \+ 1\) \}/)
  assert.match(page, /actions=\{<Button variant="outline" size="sm" onClick=\{refresh\}/)
  assert.match(page, /<SdkAdapterPage adapterKey=\{adapter\} embedded refreshKey=\{refreshKey\} toolbar=\{toolbar\} \/>/)
  // The toolbar uses the Console's own button variants, never the SDK's zk-btn.
  const toolbar = page.slice(page.indexOf('const toolbar ='), page.indexOf('return (', page.indexOf('const toolbar =')))
  assert.match(toolbar, /<Button asChild variant="outline" size="sm">/)
  assert.match(toolbar, /<Button size="sm" variant=\{add\.open \? 'outline' : 'default'\}/)
  assert.doesNotMatch(toolbar, /zk-btn/)
})

test('capability detection: an older SDK keeps working behind the CSS wrapper', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /capabilities\?\.embedded/)
  assert.match(page, /data-sdk-embedded=\{SDK_ADAPTER_PAGE_EMBEDDABLE \? '' : undefined\}/)
  const css = await src('pages/scope/scope-pages.css')
  assert.match(css, /\.console-adapter-console:not\(\[data-sdk-embedded\]\) \.zk-page-header__identity \{ display: none; \}/)
  assert.match(css, /\.console-adapter-console:not\(\[data-sdk-embedded\]\) \.zk-page-header \.zk-row > button\.zk-btn:not\(\.zk-btn--primary\) \{ display: none; \}/)
})

test('the installed SDK still matches what the compatibility CSS targets', async () => {
  const sdk = await readFile(new URL('../node_modules/@zhin.js/client/dist/adapter-console/AdapterConsolePage.js', import.meta.url), 'utf8')
  const supportsEmbedded = /capabilities/.test(sdk) && /embedded/.test(sdk)
  if (supportsEmbedded) return // released SDK: the wrapper is inert (see report: drop it after upgrading)
  const header = sdk.slice(sdk.indexOf('_jsx(PageHeader'), sdk.indexOf('status && _jsxs("nav"'))
  assert.match(header, /className: "zk-btn zk-btn--secondary", children: t\(locale, '文档'\)/, '文档 is a link')
  assert.match(header, /_jsx\(Button, \{ busy: isBusy\('refresh'\)/, '刷新 is a default (secondary) Button')
  assert.match(header, /_jsx\(Button, \{ variant: "primary"[^}]*onClick: toggleAdd/, '添加 is the primary Button')
})
