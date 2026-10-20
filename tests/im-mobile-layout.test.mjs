import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import postcss from 'postcss'

// Evaluate the relevant class selectors in source order, including specificity
// and media bounds. A fixed rule earlier in the file is not sufficient: the IM
// surface rule used to override it and leave the translated drawer in flex flow.
const layout = [{ classes: ['sandbox-container', 'im-layout'] }]
const sidebar = [...layout, { classes: ['channel-sidebar', 'im-sidebar'] }]
const toggle = [...layout, { classes: ['mobile-channel-toggle'] }]
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
for (const file of ['client/style.css', 'console-ui/src/style.css']) {
  const css = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  test(`${file}: a translated mobile sidebar is fixed rather than consuming the conversation's flex height`, () => {
    const drawer = computed(css, 390, sidebar), shell = computed(css, 390, layout), button = computed(css, 390, toggle)
    assert.equal(drawer.position, 'fixed')
    assert.equal(drawer['z-index'], '1000')
    assert.equal(shell['flex-direction'], 'column')
    assert.equal(button.display, 'flex')
    assert.equal(button['flex-shrink'], '0')
  })
  test(`${file}: desktop sidebar remains in flow and does not gain mobile drawer positioning`, () => {
    for (const width of [1024, 1440]) {
      assert.equal(computed(css, width, sidebar).position, 'relative')
      assert.equal(computed(css, width, toggle).display, 'none')
    }
  })
}
