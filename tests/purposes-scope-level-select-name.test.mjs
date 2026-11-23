import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `purposes-scope-level-select-name`: on 「用途」→「按场景选择」 the level select (适配器 / 账号终端 /
// 会话场景) had no accessible name, so a screen reader only said "combo box" (axe `button-name`), while
// the target select next to it is named 「选择目标」.
const source = readFileSync(new URL('../console-ui/src/pages/inference/Purposes.tsx', import.meta.url), 'utf8')

/** Every <SelectField> / <SearchableSelectField> element in the file, with the names of its attributes. */
function selectElements() {
  const file = ts.createSourceFile('Purposes.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  const visit = node => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && /^(Searchable)?SelectField$/.test(node.tagName.getText())) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
      found.push({
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        names: attributes.map(attribute => attribute.name.getText()),
        text: node.getText(),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

test('the 「按场景选择」 level select has an accessible name', () => {
  const scopes = source.slice(source.indexOf('{i18n.t("按场景选择")}'))
  const level = scopes.slice(scopes.indexOf('<SelectField'), scopes.indexOf('/>', scopes.indexOf('<SelectField')))
  assert.match(level, /aria-label=\{i18n\.t\("选择层级"\)\}/)
  assert.doesNotMatch(translate('en', '选择层级'), /[一-鿿]/u, 'translated')
})

// An `id` alone names nothing (it needs a <label htmlFor> pointing at it), so it does not count here.
test('no select on 用途 is left without a name (aria-label or aria-labelledby)', () => {
  const unnamed = selectElements().filter(element => !element.names.some(name => name === 'aria-label' || name === 'aria-labelledby'))
  assert.deepEqual(unnamed.map(element => `${element.line}: ${element.text.slice(0, 80)}`), [])
})
