import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { sourceFilesUnder } from './cjk-fixture.mjs'
import { tabPanelProps, tabTriggerProps } from '../console-ui/src/utils/tab-panel-link.mjs'

// #64 `tabs-without-panels`: three places used Tabs only as a switch and rendered the content outside any
// `TabsContent`, so every tab's `aria-controls` pointed at an element that does not exist (axe
// `aria-valid-attr-value` on /agent/usage) and screen readers found no tabpanel: the usage report's
// dimension switch, the marketplace package details (README / 版本 / 依赖) and the database table details
// (数据 / 结构). Their layout keeps the switch apart from the content, so instead of moving the content
// (which would change the look during the style freeze) the tabs point at the real content region.
const root = new URL('../console-ui/src/', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('the tabs and the region they switch reference each other', () => {
  const tab = tabTriggerProps(':r1:', 'service')
  const panel = tabPanelProps(':r1:', 'service')
  assert.equal(tab['aria-controls'], panel.id)
  assert.equal(panel['aria-labelledby'], tab.id)
  assert.equal(panel.role, 'tabpanel')
  assert.notEqual(tabTriggerProps(':r1:', 'model').id, tab.id, 'each tab has its own id')
})

test('every file with a TabsTrigger gives its tabs a panel: TabsContent, or the panel-link props', () => {
  const offences = sourceFilesUnder(root.pathname)
    .filter(file => file.endsWith('.tsx') && !file.includes('/components/ui/'))
    .map(file => ({ file: file.slice(root.pathname.length), text: readFileSync(file, 'utf8') }))
    .filter(({ text }) => text.includes('<TabsTrigger'))
    .filter(({ text }) => !text.includes('<TabsContent') && !(text.includes('tabTriggerProps(') && text.includes('tabPanelProps(')))
    .map(({ file }) => file)
  assert.deepEqual(offences, [])
})

test('the three places link their tabs to the region they switch', () => {
  const usage = read('pages/token-usage-report.tsx')
  const dimension = usage.slice(usage.indexOf('function DimensionSwitch'), usage.indexOf('function timeZoneNote'))
  assert.match(dimension, /<TabsTrigger key=\{option\.value\} value=\{option\.value\} \{\.\.\.tabTriggerProps\(panelId, option\.value\)\}>/)
  // The trend card and the details card each name their content region after the active tab.
  assert.match(usage, /<CardContent className="space-y-3 text-foreground" \{\.\.\.\(narrow \? \{\} : tabPanelProps\(panelId, dimension\)\)\}>/)
  assert.match(usage, /<CardContent \{\.\.\.\(narrow \? \{\} : tabPanelProps\(panelId, active\)\)\}>/)
  const market = read('pages/marketplace.tsx')
  assert.match(market, /\{\.\.\.tabTriggerProps\(detailTabsId, key\)\}/)
  assert.match(market, /\{\.\.\.tabPanelProps\(detailTabsId, detailTab\)\}/)
  const database = read('pages/database/database-page.tsx')
  assert.match(database, /data-tab="data" \{\.\.\.tabTriggerProps\(modeTabsId, 'data'\)\}/)
  assert.match(database, /data-tab="structure" \{\.\.\.tabTriggerProps\(modeTabsId, 'structure'\)\}/)
  assert.match(database, /\{\.\.\.\(showTools \? tabPanelProps\(modeTabsId, mode\) : \{\}\)\}/)
})
