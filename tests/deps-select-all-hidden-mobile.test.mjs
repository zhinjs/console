import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// #64 `deps-select-all-hidden-mobile`: in card mode (the shared `console` container < 40rem) the table
// header — and the 「全选依赖」 checkbox in it — is clipped to 1px, so 项目依赖 could only be selected row by
// row on a phone, while the hidden checkbox still took keyboard focus. The card mode now shows its own
// 「全选」 above the rows (same toggleAllSelection, same mixed state); the header one leaves the tab order
// there. The shared Table styles are untouched (#125).
const page = readFileSync(new URL('../console-ui/src/pages/ops/instance.tsx', import.meta.url), 'utf8')
const card = page.slice(page.indexOf('<Table aria-label={i18n.t("项目依赖")}>') - 600, page.indexOf('<Table aria-label={i18n.t("项目依赖")}>') + 1200)

test('card mode shows a visible 「全选」 with the same toggle and mixed state, in the table\'s own container box', () => {
  const wrapper = card.indexOf('<div className="console-cq">')
  const control = card.indexOf('data-card-select-all')
  assert.ok(wrapper >= 0 && wrapper < control && control < card.indexOf('<Table'), 'the control and the table share one console-cq box')
  assert.match(card, /className="hidden @max-\[40rem\]\/console:flex[^"]*" data-card-select-all=""/u)
  const block = card.slice(control, card.indexOf('<Table'))
  assert.match(block, /checked=\{headerState\}/u, 'the same checked / mixed state as the header checkbox')
  assert.match(block, /setSelected\(toggleAllSelection\(listedNames, value === true\)\)/u)
  assert.match(block, /min-h-11/u, '44px touch target')
  assert.match(block, /disabled=\{busy\}/u, 'disabled while an operation runs, like the header one')
  assert.match(card.slice(wrapper, control), /\{canManage \? \(/u, 'only for identities that can manage packages')
  assert.match(block, /<label[^>]*>\s*<Checkbox[\s\S]*?\{i18n\.t\("全选依赖"\)\}\s*<\/label>/u, 'the label names the checkbox')
})

test('the header checkbox leaves the tab order in card mode', () => {
  const header = card.slice(card.indexOf('<TableHeader>'), card.indexOf('</TableHeader>'))
  assert.match(header, /aria-label=\{i18n\.t\("全选依赖"\)\}[^>]*className="@max-\[40rem\]\/console:invisible"|className="@max-\[40rem\]\/console:invisible"[^>]*aria-label=\{i18n\.t\("全选依赖"\)\}/u)
})
