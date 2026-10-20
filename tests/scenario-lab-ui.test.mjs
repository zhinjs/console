import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {scenarioPreviewItems} from '../console-ui/src/pages/scenario-lab/scenario-model.mjs'
const source=await readFile(new URL('../console-ui/src/pages/scenario-lab.tsx',import.meta.url),'utf8')
const ast=ts.createSourceFile('scenario-lab.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const definitions=['ScenarioPreview','ScenarioMarkdown'].map(name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name))
assert.ok(definitions.every(Boolean))
const code=`import{scenarioMarkdownBlocks}from ${JSON.stringify(new URL('../console-ui/src/pages/scenario-lab/scenario-model.mjs',import.meta.url).href)};const Card=({children,...props})=><section {...props}>{children}</section>;${definitions.map(node=>node.getText(ast)).join('\n')}`
let js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
js=js.replaceAll('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')))
const {ScenarioPreview}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
test('preview uses text nodes for hostile HTML, inert media and disabled controls',()=>{
 const items=scenarioPreviewItems([{type:'html',data:{html:'<img src="https://invalid.test"><script>alert(1)</script>'}},{type:'image',data:{media:{kind:'url',value:'https://invalid.test/a.png'}}},{type:'keyboard',data:{rows:[[{label:'执行',payload:'execute'}]]}}],'rich')
 const html=renderToStaticMarkup(React.createElement(ScenarioPreview,{items,error:''}))
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<(?:img|script|iframe|a|video|audio)\b/u);assert.match(html,/<button[^>]*disabled=""/u);assert.match(html,/不读取本地媒体/)
})
test('Markdown code blocks/lists/quotes/tables are readable semantic nodes without active HTML or network',()=>{
 const items=scenarioPreviewItems([{type:'markdown',data:{content:'# 标题\n\n- 第一项\n- 第二项\n\n```ts\n<script>bad()</script>\n```\n\n> 注释\n\n|键|值|\n|---|---|\n|a|b|'}}],'text')
 const html=renderToStaticMarkup(React.createElement(ScenarioPreview,{items,error:''}))
 assert.match(html,/<ul/);assert.match(html,/<li>第一项/);assert.match(html,/<code>&lt;script&gt;/);assert.match(html,/<blockquote/);assert.match(html,/<table/);assert.doesNotMatch(html,/<script/)
})
test('scene page declares local boundary and has no Host execution/renderer client dependencies',()=>{
 assert.doesNotMatch(source,/requestConsole|apiFetch|from ['"]@zhin\.js\/testing|dangerouslySetInnerHTML|<iframe|<img|eval\(|new Function/u)
 assert.match(source,/不会把上方浏览器预览自动复制为断言/);assert.match(source,/disabled=\{!exported\}/);assert.match(source,/ZHIN_SCENARIO_FIXTURE_ROOT/);assert.match(source,/PluginTestKit 不是安全沙箱/)
})
