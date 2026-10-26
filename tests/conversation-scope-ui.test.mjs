import { prepareLocaleModule } from './locale-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const base = '../console-ui/src/components/PluginConfigForm/'
async function componentSource(file,names) {
 const source = await readFile(new URL(base+file,import.meta.url),'utf8')
 const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 return names.map(name => {const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name); assert.ok(node); return node.getText(ast)}).join('\n')
}
async function load(code) {
 let compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
 compiled=compiled.replaceAll('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')))
 compiled=compiled.replaceAll('"react"',JSON.stringify(import.meta.resolve('react')))
 return import(`data:text/javascript;base64,${Buffer.from(prepareLocaleModule(compiled)).toString('base64')}`)
}
const code=`import {useState} from ${JSON.stringify(import.meta.resolve('react'))};
 import {scopeAllowedKinds,CONVERSATION_KIND_LABELS,targetDraft} from ${JSON.stringify(new URL(base+'conversation-scope-model.mjs',import.meta.url).href)};
 import {updateListItem} from ${JSON.stringify(new URL(base+'schema-model.mjs',import.meta.url).href)};
 export const buttons=[];
 const Button=({children,...props})=>{buttons.push({label:children,...props});return <button {...props}>{children}</button>};
 const ConversationTargetEditor=({value,allowedKinds})=><article data-kinds={allowedKinds.join(',')}>{JSON.stringify(value)}</article>;
 ${await componentSource('ConversationScopeEditor.tsx',['ConversationScopeEditor'])}
 ${await componentSource('ConversationTargetEditor.tsx',['ConversationTargetSummary'])}`
const {ConversationScopeEditor,ConversationTargetSummary,buttons}=await load(code)
const field={type:'list',component:'conversation-scope',inner:{type:'object',object:{kind:{type:'string',enum:['group']}}}}

test('undefined and empty scope have opposite, explicit labels and no generic unset action',()=>{
 const all=renderToStaticMarkup(React.createElement(ConversationScopeEditor,{field,value:undefined,onChange(){}}))
 const none=renderToStaticMarkup(React.createElement(ConversationScopeEditor,{field,value:[],onChange(){}}))
 assert.match(all,/草稿范围：全部符合插件条件/); assert.match(all,/先设为空范围/)
 assert.match(none,/草稿范围：不允许任何会话/); assert.match(none,/清空范围（不允许任何会话）/)
 assert.match(none,/恢复覆盖全部…/); assert.doesNotMatch(none,/取消此项设置/)
})

test('scope list uses only schema allowed kinds and displays unsafe stored values without discarding them',()=>{
 const html=renderToStaticMarkup(React.createElement(ConversationScopeEditor,{field,value:[{kind:'group',id:'a'}],onChange(){}}))
 assert.match(html,/data-kinds="group"/); assert.match(html,/移除此会话/)
 const invalid=renderToStaticMarkup(React.createElement(ConversationScopeEditor,{field,value:'bad',onChange(){}}))
 assert.match(invalid,/原值仍保留/)
})

test('target summaries expose exact parent/thread absence and escape user data, with technical identity collapsed',()=>{
 const target={endpoint:{id:'full-id',adapter:'root/qq'},kind:'group',id:'<script>bad</script>'}
 const html=renderToStaticMarkup(React.createElement(ConversationTargetSummary,{value:target,accountName:'研发账号'}))
 assert.match(html,/研发账号/); assert.match(html,/群聊/); assert.match(html,/父容器：未提供/); assert.match(html,/话题：未提供/)
 assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script>|<details open/)
 assert.match(html,/完整身份草稿/); assert.match(html,/full-id/)
})

test('SchemaFieldEditor wires custom scope before generic lists and suppresses broadening unset',async()=>{
 const implementation=await componentSource('SchemaFieldEditor.tsx',['SchemaFieldEditor'])
 const module=await load(`import {useId} from ${JSON.stringify(import.meta.resolve('react'))};
 import {isConversationScopeField} from ${JSON.stringify(new URL(base+'conversation-scope-model.mjs',import.meta.url).href)};
 const ConversationScopeEditor=()=> <span>精确会话控件</span>;
 const numericFieldIssue=()=>null;
 const Button=({children,...props})=><button {...props}>{children}</button>;
 ${implementation}`)
 const html=renderToStaticMarkup(React.createElement(module.SchemaFieldEditor,{name:'scope',field,value:[],onChange(){assert.fail('render must not change scope')}}))
 assert.match(html,/精确会话控件/);assert.doesNotMatch(html,/取消此项设置|添加列表项/)
})


test('actual scope controls narrow first and keep the final removal as [] instead of undefined',()=>{
 const changes=[]
 buttons.length=0
 renderToStaticMarkup(React.createElement(ConversationScopeEditor,{field,value:undefined,onChange:value=>changes.push(value)}))
 buttons.find(button=>String(button.label).includes('限定到所选')).onClick()
 assert.deepEqual(changes,[[]])
 buttons.length=0
 renderToStaticMarkup(React.createElement(ConversationScopeEditor,{field,value:[{kind:'group',id:'a'}],onChange:value=>changes.push(value)}))
 buttons.find(button=>button.label==='移除此会话').onClick()
 assert.deepEqual(changes,[[],[]])
 buttons.find(button=>String(button.label).includes('清空范围')).onClick()
 assert.deepEqual(changes,[[],[],[]])
 assert.equal(buttons.some(button=>button.label==='确认恢复全部'),false)
})

test('restoring all has an explicit expansion warning bound to the current draft',async()=>{
 const expandedCode=code.replace(/import \{useState\} from [^;]+;/, 'export let confirmation; const useState=()=>[confirmation,value=>{confirmation=value}];')
 const expanded=await load(expandedCode)
 const changes=[], value=[]
 renderToStaticMarkup(React.createElement(expanded.ConversationScopeEditor,{field,value,onChange:value=>changes.push(value)}))
 expanded.buttons.find(button=>button.label==='恢复覆盖全部…').onClick()
 expanded.buttons.length=0
 const html=renderToStaticMarkup(React.createElement(expanded.ConversationScopeEditor,{field,value,onChange:value=>changes.push(value)}))
 assert.match(html,/包括以后新接入/); assert.match(html,/确定扩大范围/)
 assert.deepEqual(changes,[])
 expanded.buttons.find(button=>button.label==='确认恢复全部').onClick()
 assert.deepEqual(changes,[undefined])
 expanded.buttons.length=0
 renderToStaticMarkup(React.createElement(expanded.ConversationScopeEditor,{field,value,onChange(){}}))
 expanded.buttons.find(button=>button.label==='恢复覆盖全部…').onClick()
 expanded.buttons.length=0
 const stale=renderToStaticMarkup(React.createElement(expanded.ConversationScopeEditor,{field,value:[{kind:'group',id:'new-group'}],onChange(){}}))
 assert.doesNotMatch(stale,/确定扩大范围/)
 assert.equal(expanded.buttons.some(button=>button.label==='确认恢复全部'),false)
})
