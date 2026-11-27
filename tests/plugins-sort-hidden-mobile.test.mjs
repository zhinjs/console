import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { applyInventorySort, INVENTORY_SORT_KEYS } from '../console-ui/src/pages/plugin-list-model.mjs'

// #64 `plugins-sort-hidden-mobile`: in card mode (the shared `console` container < 40rem) the table
// header is visually hidden, so 插件 had no visible way to sort, while its sort buttons stayed
// focusable inside the 1px header. The card mode now has its own 「排序」 control on the same `?sort=&dir=`
// parameters, and the header buttons leave the tab order there. The shared Table styles are untouched (#125).
const page = readFileSync(new URL('../console-ui/src/pages/plugins.tsx', import.meta.url), 'utf8')

test('one place writes ?sort=&dir= (name ascending is the default and leaves the URL clean)', () => {
  assert.deepEqual([...INVENTORY_SORT_KEYS], ['name', 'type', 'source', 'version', 'status'])
  assert.equal(applyInventorySort(new URLSearchParams('q=x&sort=status&dir=desc'), 'name', 'asc').toString(), 'q=x')
  assert.equal(applyInventorySort(new URLSearchParams('q=x'), 'version', 'desc').toString(), 'q=x&sort=version&dir=desc')
  assert.equal(applyInventorySort(new URLSearchParams(), 'name', 'desc').toString(), 'sort=name&dir=desc')
})

test('card mode shows a sort control (field and direction); the header buttons leave the tab order there', () => {
  const control = page.slice(page.indexOf('data-card-sort'), page.indexOf('data-card-sort') + 1400)
  assert.match(page, /className="hidden @max-\[40rem\]\/console:flex[^"]*" data-card-sort=""/u, 'only in card mode (the shared container query)')
  assert.match(control, /<SelectField/u)
  assert.match(control, /aria-label=\{i18n\.t\("排序字段"\)\}/u)
  assert.match(control, /setSortTo\(sortKey, sortDirection === 'asc' \? 'desc' : 'asc'\)/u, 'the direction toggles on the same parameters')
  assert.match(control, /i18n\.t\("升序"\)/u)
  assert.match(page, /'@max-\[40rem\]\/console:invisible'/u, 'header sort buttons are invisible (not focusable) in card mode')
  assert.doesNotMatch(control, /aria-pressed/u, 'the label already says the direction')
  assert.doesNotMatch(page, /next\.set\('sort'/u, 'the URL is written by applyInventorySort only')
})

test('the control and the table measure the same container, so they switch to cards at the same width', () => {
  // The shared Table is its own `console-cq` box; a control outside it would measure the wider page frame.
  const card = page.slice(page.indexOf('<Card className="overflow-hidden p-0">'), page.indexOf('</Card>', page.indexOf('<Card className="overflow-hidden p-0">')))
  const wrapper = card.indexOf('<div className="console-cq">')
  assert.ok(wrapper > 0, 'a console-cq box inside the card')
  assert.ok(wrapper < card.indexOf('data-card-sort') && card.indexOf('data-card-sort') < card.indexOf('<Table'), 'the control and the table are both inside it')
})
