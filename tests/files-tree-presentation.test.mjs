import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

async function compile(name, imports = {}) {
  let source = ts.transpileModule(await readFile(new URL(`../console-ui/src/pages/files/${name}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const specifier of ['react', 'react/jsx-runtime', 'lucide-react']) {
    source = source.replaceAll(`"${specifier}"`, JSON.stringify(import.meta.resolve(specifier)))
      .replaceAll(`'${specifier}'`, JSON.stringify(import.meta.resolve(specifier)))
  }
  for (const [specifier, url] of Object.entries(imports)) source = source.replaceAll(`'${specifier}'`, JSON.stringify(url))
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
}
const iconsURL = await compile('file-icons')
const { getFileIcon } = await import(iconsURL)
const { TreeNode } = await import(await compile('tree-node', { './file-icons': iconsURL }))

test('file types retain code/document shape with shared monochrome token and nonshrinking icons', () => {
  for (const name of ['a.ts', 'a.tsx', 'a.js', 'a.json', 'a.yaml', 'a.md', '.env.example', 'a.txt']) {
    const html = renderToStaticMarkup(getFileIcon(name))
    assert.match(html, /text-muted-foreground/)
    assert.match(html, /shrink-0/)
    assert.doesNotMatch(html, /text-(blue|yellow|green|red|orange|amber)-/)
    assert.match(html, /aria-hidden="true"/)
  }
  assert.match(renderToStaticMarkup(getFileIcon('a.ts')), /lucide-file-code/)
  assert.match(renderToStaticMarkup(getFileIcon('a.json')), /lucide-file/)
})

test('file tree scopes expansion and selection while long names remain available by full path', () => {
  const path = 'src/' + 'long-name-'.repeat(30) + '.ts'
  const html = renderToStaticMarkup(React.createElement(TreeNode, {
    node: { type: 'directory', name: 'src', path: 'src', children: [{ type: 'file', name: path.slice(4), path }] },
    selectedPath: path, onSelect: () => {},
  }))
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /aria-current="true"/)
  assert.ok(html.includes(`title="${path}"`))
  assert.match(html, /min-w-0 flex-1 truncate/)
  assert.doesNotMatch(html, /text-amber-/)
  const collapsed = renderToStaticMarkup(React.createElement(TreeNode, {
    node: { type: 'directory', name: 'nested', path: 'src/nested', children: [{ type: 'file', name: 'hidden.ts', path: 'src/nested/hidden.ts' }] },
    selectedPath: null, onSelect: () => {}, depth: 1,
  }))
  assert.match(collapsed, /aria-expanded="false"/)
  assert.doesNotMatch(collapsed, /hidden.ts/)
})


test('file tree constrains Radix intrinsic table sizing locally without changing shared scroll areas', async () => {
  const page = await readFile(new URL('../console-ui/src/pages/files/files-page.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../console-ui/src/pages/files/file-tree.css', import.meta.url), 'utf8')
  assert.match(page, /import '\.\/file-tree\.css'/)
  assert.match(page, /file-tree-scroll flex-1 min-w-0 w-full/)
  assert.match(css, /\.file-tree-scroll \[data-radix-scroll-area-viewport\] > div/)
  assert.match(css, /display: block !important/)
  assert.match(css, /min-width: 0 !important/)
  assert.match(css, /max-width: 100%/)
})


test('Files reserves split view for desktop and scopes responsive touch controls', async () => {
  const page = await readFile(new URL('../console-ui/src/pages/files/files-page.tsx', import.meta.url), 'utf8')
  const editor = await readFile(new URL('../console-ui/src/pages/files/file-editor.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../console-ui/src/pages/files/file-tree.css', import.meta.url), 'utf8')
  assert.match(page, /lg:flex-row/)
  assert.match(page, /hidden lg:flex/)
  assert.match(page, /hidden lg:block/)
  assert.doesNotMatch(page, /md:(?:flex-row|w-64|flex|block)/)
  for (const source of [page, editor]) {
    assert.equal((source.match(/<Button /g) ?? []).length, (source.match(/<Button className="file-control"/g) ?? []).length)
  }
  assert.match(css, /min-height: 44px/)
  assert.match(css, /min-width: 44px/)
  assert.match(css, /min-width: 768px[\s\S]*min-height: 36px/)
  assert.match(css, /min-width: 1024px[\s\S]*min-height: 32px/)
})
