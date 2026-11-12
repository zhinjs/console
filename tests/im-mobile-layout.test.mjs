import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'

// Evaluate the relevant class selectors in source order, including specificity
// and media bounds. A fixed rule earlier in the file is not sufficient: the IM
// surface rule used to override it and leave the translated drawer in flex flow.
const shell = pane => [{ classes: ['sandbox-container', 'im-layout', 'im-layout--account', `is-${pane}-pane`] }]
const sidebar = pane => [...shell(pane), { classes: ['channel-sidebar', 'im-sidebar'] }]
const main = pane => [...shell(pane), { classes: ['im-main-split'] }]
const back = [...shell('chat'), { classes: ['im-main-split'] }, { classes: ['im-chat-header'] }, { classes: ['im-chat-back'] }]
function matches(selector, path) {
  const parts = selector.trim().split(/\s*(>)\s*|\s+/u).filter(Boolean)
  const match = (part, node) => /^(?:\.[\w-]+)+$/u.test(part) && [...part.matchAll(/\.([\w-]+)/gu)].every(([, name]) => node.classes.includes(name))
  let index = path.length - 1
  if (!match(parts.pop(), path[index])) return false
  while (parts.length) {
    const part = parts.pop()
    if (part === '>') { if (--index < 0 || !match(parts.pop(), path[index])) return false }
    else { do { index-- } while (index >= 0 && !match(part, path[index])); if (index < 0) return false }
  }
  return true
}
function computed(css, width, path) {
  const values = new Map()
  postcss.parse(css).walkRules(rule => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule' || parent.name !== 'media') continue
      if (/print/u.test(parent.params)) return
      const min = /min-width:\s*(\d+)px/u.exec(parent.params), max = /max-width:\s*(\d+)px/u.exec(parent.params)
      if (min && width < Number(min[1]) || max && width > Number(max[1])) return
    }
    for (const selector of rule.selectors) {
      if (!matches(selector, path)) continue
      const specificity = [...selector.matchAll(/\.[\w-]+/gu)].length
      rule.walkDecls(declaration => {
        const previous = values.get(declaration.prop), rank = specificity + (declaration.important ? 1000 : 0)
        if (!previous || previous.rank <= rank) values.set(declaration.prop, { rank, value: declaration.value })
      })
    }
  })
  return Object.fromEntries([...values].map(([key, entry]) => [key, entry.value]))
}
for (const file of ['client/style.css']) {
  const entry = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.match(entry, /@import ["'][^"']*im-workspace\.css["']/u)
  const css = `${entry}\n${await readFile(new URL('../console-ui/src/im-workspace.css', import.meta.url), 'utf8')}`
  test(`${file}: below 1024px the list or the chat is shown, never both and never a drawer`, () => {
    for (const width of [390, 768, 1023]) {
    assert.equal(computed(css, width, sidebar('list')).width, '100%', 'the list fills the workspace')
    assert.notEqual(computed(css, width, sidebar('list')).position, 'fixed')
    assert.equal(computed(css, width, main('list')).display, 'none')
    assert.equal(computed(css, width, sidebar('chat')).display, 'none')
    assert.notEqual(computed(css, width, main('chat')).display, 'none')
    assert.equal(computed(css, width, back).display, 'inline-flex', 'the chat pane has a way back to the list')
    }
  })
  test(`${file}: message actions do not steal mobile bubble width or precede inbound text`, () => {
    for (const outgoing of [false, true]) {
      const row = [{ classes: ['im-message-row', ...(outgoing ? ['im-message-row--out'] : [])] }]
      const bubble = [...row, { classes: ['im-message-main'] }]
      const actions = [...row, { classes: ['im-message-actions'] }]
      assert.equal(computed(css, 1440, bubble).order, '1')
      assert.equal(computed(css, 1440, actions).order, outgoing ? '0' : '2')
      assert.equal(computed(css, 390, row)['flex-direction'], 'column')
      assert.equal(computed(css, 390, bubble).order, '1')
      assert.equal(computed(css, 390, actions).order, '2')
      assert.equal(computed(css, 390, actions).display, 'none', 'on a phone the actions appear only for a tapped (focused) message')
    }
  })
  test(`${file}: from 1024px the list and the chat sit side by side`, () => {
    for (const width of [1024, 1440]) for (const pane of ['list', 'chat']) {
      assert.equal(computed(css, width, sidebar(pane)).position, 'relative')
      assert.notEqual(computed(css, width, sidebar(pane)).display, 'none')
      assert.notEqual(computed(css, width, main(pane)).display, 'none')
      assert.equal(computed(css, width, back).display, 'none')
    }
  })
}
