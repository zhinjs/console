import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import postcss from 'postcss'
import { highlightCode } from '../console-ui/src/pages/files/highlight-code.mjs'
const languageSource = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/files/language.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { getLanguage } = await import('data:text/javascript;base64,' + Buffer.from(languageSource).toString('base64'))

test('registered grammars produce actual token spans selected by file extension', () => {
  for (const [name, value] of [
    ['a.ts', 'export const title: string = "Hello"'], ['a.js', 'const title = "Hello"'],
    ['a.json', '{"title": "Hello", "count": 1}'], ['a.yml', 'title: Hello'],
    ['a.md', '# Hello\n**bold**'], ['a.css', '.title { color: red; }'],
    ['a.html', '<div class="title">Hello</div>'],
  ]) assert.match(highlightCode(value, getLanguage(name)), /<span class="hljs-/, name)
  assert.match(highlightCode('export const title = "Hello"', 'typescript'), /hljs-keyword/)
  assert.match(highlightCode('export const title = "Hello"', 'typescript'), /hljs-string/)
})

test('unknown text escapes markup and highlighting never interprets source HTML as real elements', () => {
  const source = '<img src=x onerror="evil()">&'
  assert.equal(highlightCode(source, getLanguage('a.unknown')), '&lt;img src=x onerror="evil()"&gt;&amp;')
  assert.doesNotMatch(highlightCode(source, 'xml'), /<img/)
  assert.equal(highlightCode(source, 'unregistered'), highlightCode(source, null))
})

test('editor uses bundled highlighter and identical overlay font metrics with local light/dark styling', async () => {
  const editor = await readFile(new URL('../console-ui/src/pages/files/code-editor.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../console-ui/src/pages/files/code-highlight.css', import.meta.url), 'utf8')
  assert.doesNotMatch(editor, /window.hljs/)
  assert.match(editor, /highlightCode\(value, language\)/)
  assert.match(editor, /scrollTop = textareaRef.current.scrollTop/)
  assert.match(editor, /scrollLeft = textareaRef.current.scrollLeft/)
  assert.match(editor, /\.\.\.editorFontStyle/)
  assert.match(editor, /if \(e.key === 'Tab'\)/)
  assert.match(css, /highlight\.js\/styles\/github\.css/)
  assert.match(css, /github-dark-scoped\.css/)
})


test('scoped GitHub Dark preserves every official theme selector and declaration', async () => {
  const official = postcss.parse(await readFile(new URL('../node_modules/highlight.js/styles/github-dark.css', import.meta.url), 'utf8'))
  const scoped = postcss.parse(await readFile(new URL('../console-ui/src/pages/files/github-dark-scoped.css', import.meta.url), 'utf8'))
  const rules = []
  official.walkRules(rule => rules.push({ selectors: rule.selectors, declarations: rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]) }))
  const actual = []
  scoped.walkRules(rule => actual.push({ selectors: rule.selectors.map(selector => { assert.ok(selector.startsWith('.dark ')); return selector.slice(6) }), declarations: rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]) }))
  assert.deepEqual(actual, rules)
})
