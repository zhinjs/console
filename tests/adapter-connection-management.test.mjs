import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const src = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('the adapter page has one 刷新: the header re-reads accounts and the embedded SDK page', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /const refresh = \(\) => \{ data\.refresh\(\); setManagementRefresh\(value => value \+ 1\) \}/)
  // console-ui 1.3.0: secondary (sunken) is the everyday button; outline is kept only for pressed toggles.
  assert.match(page, /actions=\{<Button variant="secondary" size="sm" onClick=\{refresh\}/)
  assert.match(page, /<AdapterConsolePage adapterKey=\{adapter\} embedded refreshKey=\{refreshKey\} toolbar=\{toolbar\} hostAccounts=\{view\.hostAccounts\} \/>/)
  // The same refresh key re-reads the shared account state of the table rows.
  assert.match(page, /<ManagedAccountsProvider adapter=\{scope\.adapter!\} refreshKey=\{managementRefresh\} enabled=\{canManage\}>/)
  // The toolbar uses the Console's own button variants, never the SDK's zk-btn.
  const toolbar = page.slice(page.indexOf('const toolbar ='), page.indexOf('return (', page.indexOf('const toolbar =')))
  assert.match(toolbar, /<Button asChild variant="secondary" size="sm">/)
  assert.match(toolbar, /<Button size="sm" variant=\{add\.open \? 'outline' : 'soft'\}/)
  assert.doesNotMatch(toolbar, /zk-btn/)
})

test('the published SDK embedded mode replaces the old header-hiding CSS', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /import \{ AdapterConsolePage, type AdapterConsoleToolbarControls \} from '@zhin\.js\/client'/)
  assert.doesNotMatch(page, /data-sdk-embedded/)
  const css = await src('pages/scope/scope-pages.css')
  assert.doesNotMatch(css, /data-sdk-embedded|\.zk-page-header/)
  const sdk = await readFile(new URL('../node_modules/@zhin.js/client/dist/adapter-console/AdapterConsolePage.js', import.meta.url), 'utf8')
  assert.match(sdk, /ADAPTER_CONSOLE_PAGE_CAPABILITIES = Object\.freeze\(\{ embedded: true, toolbar: true, refreshKey: true[ ,}]/)
  // client 1.4 draws its header through RendererPage, which leaves the page chrome to the host when embedded.
  assert.match(sdk, /_jsxs?\(RendererPage, \{[^]*?embedded: embedded,/, 'embedded mode hands the page header to the host')
})

test('headless accounts come from the installed client, typed by the SDK; only viewers who manage connections get the provider', async () => {
  // The pinned client (~1.4.0) ships the whole headless API and the page honours `hostAccounts`.
  const client = await import('@zhin.js/client')
  assert.equal(client.AdapterConsolePage.capabilities?.hostAccounts, true)
  assert.equal(client.ADAPTER_CONSOLE_PAGE_CAPABILITIES.hostAccounts, true)
  for (const name of ['AdapterConsolePage', 'AdapterAccountsProvider', 'useAdapterAccounts', 'AdapterAccountEditor']) {
    assert.equal(typeof client[name], 'function', name)
  }
  const types = await readFile(new URL('../node_modules/@zhin.js/client/dist/index.d.ts', import.meta.url), 'utf8')
  assert.match(types, /type AdapterAccountRow, type AdapterAccounts,/)

  const accounts = await src('pages/scope/adapter-accounts.tsx')
  assert.match(accounts, /import \{ AdapterAccountEditor, AdapterAccountsProvider, useAdapterAccounts, type AdapterAccountRow, type AdapterAccounts \} from '@zhin\.js\/client'/)
  // No local copy of the SDK's row / controller types and no namespace-import feature detection.
  assert.match(accounts, /export type HeadlessAccountRow = AdapterAccountRow/)
  assert.match(accounts, /export type HeadlessAccounts = AdapterAccounts/)
  assert.doesNotMatch(accounts, /interface HeadlessAccount|import \* as zhinClient|detectHeadlessAccounts/)
  assert.match(accounts, /if \(!enabled\) return <>\{children\}<\/>/)
})

test('each managed account row carries its labelled switch, 编辑 and 删除; 管理连接 keeps add and the editor only', async () => {
  const accounts = await src('pages/scope/adapter-accounts.tsx')
  const controls = accounts.slice(accounts.indexOf('export function ManagedAccountControls'), accounts.indexOf('export function ManagedAccountsStatus'))
  // The switch's state is visible text (「运行中 / 已停止」 from the SDK row), not a bare toggle.
  assert.match(controls, /<span aria-hidden="true">\{row\.enabledLabel\}<\/span>/)
  assert.match(controls, /onCheckedChange=\{enabled => \{ void row\.setEnabled\(enabled\) \}\}/)
  assert.match(controls, /onClick=\{row\.edit\}/)
  assert.match(controls, /variant: 'destructive'/)
  assert.doesNotMatch(controls, /i18n\.t\('启动'\)|i18n\.t\('停止'\)/, 'no start / stop button next to the switch')

  const panels = await src('pages/scope/overview-panels.tsx')
  assert.match(panels, /\{managedRows\.get\(endpoint\.name\) \? <ManagedAccountControls row=\{managedRows\.get\(endpoint\.name\)!\} \/> : null\}/)
  // Stopped managed accounts stay in the same list; configured-only rows keep their action slot.
  assert.match(panels, /managedOnly\.map\(row => <ManagedOnlyRow/)
  assert.match(panels, /const configuredIds = \(configuredOnly\?\.ids \?\? \[\]\)\.filter\(id => !managedRows\.has\(id\)\)/)
  assert.match(panels, /<ConfiguredAccountActions adapter=\{configuredOnly\.adapter\} endpoint=\{id\} \/>/)
  assert.match(panels, /\{hosted \? <ManagedAccountsStatus accounts=\{hosted\} \/> : null\}/)
  assert.match(panels, /managed=\{hosted \? \{ adapter, accounts: hosted \} : undefined\}/)

  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /\{view\.hostAccounts \? <ManagedAccountEditor \/> : null\}/)
})

test('the rows carry the account controls only once the controller is ready; otherwise the copy and 管理连接 stay on the SDK cards', async () => {
  const { adapterAccountsView, hostRendersAccounts, ACCOUNT_LIST_COPY, CONNECTION_MANAGER_COPY } = await import('../console-ui/src/pages/scope/adapter-accounts-model.mjs')
  assert.deepEqual(adapterAccountsView({ state: 'ready' }), { hostAccounts: true, listDescription: ACCOUNT_LIST_COPY.host, managerHint: CONNECTION_MANAGER_COPY.host })
  assert.match(ACCOUNT_LIST_COPY.host, /每行的开关启停账号/)
  // An older Host without an account directory, the first read, a failed read, no provider: the table rows have no
  // switch, so the copy points to 「管理连接」 and the SDK page keeps its own account cards (hostAccounts off).
  for (const accounts of [{ state: 'unmanaged' }, { state: 'loading' }, { state: 'error' }, undefined, null]) {
    const view = adapterAccountsView(accounts)
    assert.equal(view.hostAccounts, false, String(accounts?.state))
    assert.equal(hostRendersAccounts(accounts), false)
    assert.equal(view.listDescription, ACCOUNT_LIST_COPY.sdk)
    assert.equal(view.managerHint, CONNECTION_MANAGER_COPY.sdk)
    assert.doesNotMatch(view.listDescription, /每行的开关/)
    assert.match(view.listDescription, /添加、编辑与启停在列表下方的「管理连接」里/)
    assert.match(view.managerHint, /添加、编辑、启停账号/)
  }
  // Both pages decide by the same view; neither keys the copy or hostAccounts on the provider alone.
  const page = await src('pages/scope/adapter-page.tsx')
  const panels = await src('pages/scope/overview-panels.tsx')
  assert.match(page, /const view = adapterAccountsView\(managed\)/)
  assert.match(page, /i18n\.t\(view\.managerHint\)/)
  assert.match(panels, /const view = adapterAccountsView\(managed\)/)
  assert.match(panels, /const hosted = view\.hostAccounts \? managed : undefined/)
  assert.match(panels, /description=\{i18n\.t\(view\.listDescription\)\}/)
  for (const text of [page, panels]) assert.doesNotMatch(text, /hostAccounts=\{!!managed\}|\{managed \? (?:i18n|<Managed)/)
  // The copy has English translations.
  const { englishMessages } = await import('../console-ui/src/i18n/messages.en.mjs')
  for (const copy of [ACCOUNT_LIST_COPY, CONNECTION_MANAGER_COPY]) for (const text of Object.values(copy)) assert.ok(Object.hasOwn(englishMessages, text), text)
})

test('the migration prompt says what migrating changes and offers 立即迁移 when the SDK can migrate now', async () => {
  const accounts = await src('pages/scope/adapter-accounts.tsx')
  assert.match(accounts, /迁移后账号以数据库为准，配置文件中的 endpoints 不再生效/)
  assert.match(accounts, /accounts\.migrate \? \(/)
  assert.match(accounts, /onClick=\{\(\) => void accounts\.migrate\?\.\(\)\}>\{i18n\.t\('立即迁移'\)\}/)
  assert.match(accounts, /第一次编辑或启停账号时会请求确认迁移/)
})
