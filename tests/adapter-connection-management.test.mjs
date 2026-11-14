import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const src = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('the adapter page has one 刷新: the header re-reads accounts and the embedded SDK page', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /const refresh = \(\) => \{ data\.refresh\(\); setManagementRefresh\(value => value \+ 1\) \}/)
  assert.match(page, /actions=\{<Button variant="outline" size="sm" onClick=\{refresh\}/)
  assert.match(page, /<ConnectionManagementPage adapterKey=\{adapter\} embedded refreshKey=\{refreshKey\} toolbar=\{toolbar\} hostAccounts=\{!!managed\} \/>/)
  // The same refresh key re-reads the shared account state of the table rows.
  assert.match(page, /<ManagedAccountsProvider adapter=\{scope\.adapter!\} refreshKey=\{managementRefresh\} enabled=\{canManage\}>/)
  // The toolbar uses the Console's own button variants, never the SDK's zk-btn.
  const toolbar = page.slice(page.indexOf('const toolbar ='), page.indexOf('return (', page.indexOf('const toolbar =')))
  assert.match(toolbar, /<Button asChild variant="outline" size="sm">/)
  assert.match(toolbar, /<Button size="sm" variant=\{add\.open \? 'outline' : 'default'\}/)
  assert.doesNotMatch(toolbar, /zk-btn/)
})

test('the published SDK embedded mode replaces the old header-hiding CSS', async () => {
  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /import \{ AdapterConsolePage, type AdapterConsolePageProps, type AdapterConsoleToolbarControls \} from '@zhin\.js\/client'/)
  assert.doesNotMatch(page, /data-sdk-embedded/)
  const css = await src('pages/scope/scope-pages.css')
  assert.doesNotMatch(css, /data-sdk-embedded|\.zk-page-header/)
  const sdk = await readFile(new URL('../node_modules/@zhin.js/client/dist/adapter-console/AdapterConsolePage.js', import.meta.url), 'utf8')
  assert.match(sdk, /ADAPTER_CONSOLE_PAGE_CAPABILITIES = Object\.freeze\(\{ embedded: true, toolbar: true, refreshKey: true[ ,}]/)
  assert.match(sdk, /!embedded && _jsx\(PageHeader/, 'embedded mode draws no SDK page header')
})

/** Transpiles `adapter-accounts.tsx` far enough to run its feature detection without React or the SDK. */
async function loadDetection() {
  const source = await src('pages/scope/adapter-accounts.tsx')
  const start = source.indexOf('export function detectHeadlessAccounts')
  const end = source.indexOf('\n}\n', start) + 3
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return (await import(`data:text/javascript,${encodeURIComponent(js)}`)).detectHeadlessAccounts
}

test('headless accounts are used only when the installed client has the whole API; older clients keep the SDK cards', async () => {
  const detect = await loadDetection()
  const fn = () => null
  const page = Object.assign(fn, { capabilities: { embedded: true, toolbar: true, refreshKey: true, renderRow: true, hostAccounts: true } })
  const full = { AdapterConsolePage: page, AdapterAccountsProvider: fn, useAdapterAccounts: fn, AdapterAccountEditor: fn }
  assert.equal(detect(full), full)
  // client ≤ 1.1.34: no headless exports, capabilities without hostAccounts.
  assert.equal(detect({ AdapterConsolePage: Object.assign(fn, { capabilities: { embedded: true, toolbar: true, refreshKey: true } }) }), undefined)
  assert.equal(detect({ ...full, AdapterAccountEditor: undefined }), undefined)
  assert.equal(detect({ ...full, AdapterConsolePage: () => null }), undefined)

  const accounts = await src('pages/scope/adapter-accounts.tsx')
  // The namespace import keeps the build working when the named exports do not exist yet.
  assert.match(accounts, /import \* as zhinClient from '@zhin\.js\/client'/)
  assert.match(accounts, /if \(!api \|\| !enabled\) return <>\{children\}<\/>/)
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
  assert.match(panels, /\{managed \? <ManagedAccountsStatus accounts=\{managed\} \/> : null\}/)

  const page = await src('pages/scope/adapter-page.tsx')
  assert.match(page, /\{managed \? <ManagedAccountEditor \/> : null\}/)
})

test('the migration prompt says what migrating changes and offers 立即迁移 when the SDK can migrate now', async () => {
  const accounts = await src('pages/scope/adapter-accounts.tsx')
  assert.match(accounts, /迁移后账号以数据库为准，配置文件中的 endpoints 不再生效/)
  assert.match(accounts, /accounts\.migrate \? \(/)
  assert.match(accounts, /onClick=\{\(\) => void accounts\.migrate\?\.\(\)\}>\{i18n\.t\('立即迁移'\)\}/)
  assert.match(accounts, /第一次编辑或启停账号时会请求确认迁移/)
})
