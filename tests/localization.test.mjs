import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, readLocale, saveLocale, translate, localizeSchemaField } from '../console-ui/src/i18n/locale.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import { taskParameterFields, taskParameterSummary, taskDateTimeLabel, taskMutationBody } from '../console-ui/src/pages/task-center-model.mjs'
import { renderingLabels } from '../console-ui/src/pages/endpoint-detail/rendering-diagnostics.mjs'
import { readScenarioJson } from '../console-ui/src/pages/scenario-lab/scenario-model.mjs'

test('only an explicit valid preference changes the Chinese default, including blocked storage', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-CN')
  for (const value of [null, '', 'en-US', 'EN', 'fr', 'null']) assert.equal(readLocale({getItem: () => value}), 'zh-CN')
  assert.equal(readLocale({getItem: () => 'en'}), 'en')
  assert.equal(readLocale({getItem() {throw Error('blocked')}}), 'zh-CN')
  assert.equal(readLocale(), 'zh-CN')
  const writes=[]; assert.equal(saveLocale({setItem: (...args) => writes.push(args)}, 'en'), true)
  assert.deepEqual(writes, [[LOCALE_STORAGE_KEY, 'en']])
  assert.equal(saveLocale({setItem() {throw Error('blocked')}}, 'en'), false)
  assert.throws(() => saveLocale({}, 'fr'), /Unsupported/)
})

test('interpolation preserves user content, protocol values and braces without recursive translation', () => {
  const userText='保存 <script> {1} ${TOKEN} 😀'
  assert.equal(translate('en', '打开 {0}', [userText]), `Open ${userText}`)
  assert.equal(translate('zh-CN', '打开 {0}', [userText]), `打开 ${userText}`)
  assert.equal(translate('en', 'Third-party provider text'), 'Third-party provider text')
  assert.equal(translate('en','关闭'), 'Close')
  assert.equal(translate('en','关闭',undefined,'state'), 'Off')
  assert.equal(translate('zh-CN','关闭',undefined,'state'), '关闭')
  assert.equal(translate('en', '{0} {1}', ['{1}']), '{1} {1}')
})

test('English catalog preserves every numbered interpolation slot', () => {
  const slots=s=>[...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort()
  for (const [source, english] of Object.entries(englishMessages)) assert.deepEqual(slots(english), slots(source), source)
})

const schema = {type:'string', key:'mode', title:'方式', description:'原说明', default:'off', required:true,
  options:[{value:'on',label:'启用'},{value:'off',label:'关闭'}], 'x-i18n':{en:{title:'Mode',description:'Choose a mode',enumLabels:{off:'Off',on:'On'}}}}

test('schema localization changes display only and matches enum labels by stable value after reorder', () => {
  const original=structuredClone(schema), localized=localizeSchemaField(schema,'en')
  assert.equal(localized.title,'Mode'); assert.equal(localized.description,'Choose a mode')
  assert.deepEqual(localized.options,[{value:'on',label:'On'},{value:'off',label:'Off'}])
  assert.equal(localized.key,'mode'); assert.equal(localized.default,'off'); assert.equal(localized.required,true)
  assert.deepEqual(schema,original); assert.strictEqual(localizeSchemaField(schema,'zh-CN'),schema)
  assert.deepEqual(localizeSchemaField({...schema,options:[...schema.options].reverse()},'en').options.map(o=>o.label),['Off','On'])
  const enumOnly=localizeSchemaField({type:'boolean',enum:[false,true],'x-i18n':{en:{enumLabels:{false:'No',true:'Yes'}}}},'en')
  assert.deepEqual(enumOnly.options,[{value:false,label:'No'},{value:true,label:'Yes'}])
  const branch={value:'custom',label:'原文','x-i18n':{en:{title:'Custom'}}}
  assert.equal(localizeSchemaField({type:'string',options:[branch]},'en').options[0].label,'Custom')
  assert.equal(localizeSchemaField({type:'string',title:'第三方原文'},'en').title,'第三方原文')
})

test('task schema titles localize while parameters and mutation identity remain exact', () => {
  const field={type:'string',title:'原名','x-i18n':{en:{title:'Task text'}}}
  const model={type:'object',properties:{text:field},additionalProperties:false}
  assert.equal(taskParameterFields(model,'en').fields.text.key,'Task text')
  assert.deepEqual(taskParameterSummary(model,{text:'用户的原文'},undefined,'en'),[{key:'text',title:'Task text',value:'用户的原文'}])
  const input={generation:1,provider:{owner:'root/reminder',revision:'revision'},requestId:'00000000-0000-4000-8000-000000000001',target:{endpoint:{id:'account',adapter:'root/test'},kind:'group',id:'room'},parameters:{text:'用户的原文'}}
  assert.deepEqual(taskMutationBody(input,'en'), taskMutationBody(input,'zh-CN'))
})

test('localized diagnostic and validation helpers retain their business meaning', () => {
  assert.deepEqual(renderingLabels({forms:['text'],fallbacks:['renderer_failed']},'en'),{forms:['Text'],fallbacks:['Screenshot rendering failed']})
  assert.throws(()=>readScenarioJson('{','en'),/Invalid scenario JSON/)
  const iso='2026-10-26T18:30:00+08:00'
  assert.match(taskDateTimeLabel(iso,undefined,'en'),/18:30.*UTC\+08:00/)
  assert.match(taskDateTimeLabel(iso,'UTC','en'),/10:30/)
})

async function loadLocaleReact() {
  const file=new URL('../console-ui/src/i18n/index.tsx',import.meta.url)
  let code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText
  for(const specifier of ['react','react/jsx-runtime','./locale.mjs']) {
    const url=specifier.startsWith('.')?new URL(specifier,file).href:import.meta.resolve(specifier)
    code=code.replaceAll(JSON.stringify(specifier),JSON.stringify(url)).replaceAll(`'${specifier}'`,JSON.stringify(url))
  }
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

test('real React Context keeps providers independent and escapes interpolated user text', async()=>{
  const {LocaleProvider,useI18n}=await loadLocaleReact()
  function View(){const i18n=useI18n();return React.createElement('p',null,i18n.t('打开 {0}',['<用户>']))}
  const render=locale=>renderToStaticMarkup(React.createElement(LocaleProvider,{initialLocale:locale},React.createElement(View)))
  assert.equal(render('en'),'<p>Open &lt;用户&gt;</p>')
  assert.equal(render('zh-CN'),'<p>打开 &lt;用户&gt;</p>')
  assert.equal(render('en'),'<p>Open &lt;用户&gt;</p>')
})


test('every explicit authored translation literal has an English catalog entry', async () => {
  const roots = [new URL('../console-ui/src/',import.meta.url), new URL('../client/',import.meta.url)]
  let count = 0
  async function scan(dir) {
    for (const entry of await readdir(dir,{withFileTypes:true})) {
      const file = new URL(entry.name + (entry.isDirectory()?'/':''),dir)
      if(entry.isDirectory()) { await scan(file); continue }
      if(!/\.(tsx?|mjs)$/.test(entry.name) || file.pathname.includes('/i18n/')) continue
      const text = await readFile(file,'utf8')
      const ast = ts.createSourceFile(file.pathname,text,ts.ScriptTarget.Latest,true,entry.name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS)
      function visit(node) {
        if(ts.isCallExpression(node)) {
          const name = node.expression.getText(ast)
          const index = name.endsWith('.t') ? 0 : name === 'translate' ? 1 : -1
          const arg = node.arguments[index]
          if(arg && ts.isStringLiteralLike(arg) && /[\u3400-\u9fff]/.test(arg.text)) {
            assert.ok(Object.hasOwn(englishMessages,arg.text),`${file.pathname}: missing ${arg.text}`); count++
          }
        }
        ts.forEachChild(node,visit)
      }
      visit(ast)
    }
  }
  for(const root of roots) await scan(root)
  assert.ok(count>2000,'guard must inspect production copy, not only the locale selector')
})
