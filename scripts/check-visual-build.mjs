// Validate actual stylesheet entry loading and compiled responsive component rules.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import postcss from 'postcss'
const dir=resolve('dist')
const html=readFileSync(resolve(dir,'index.html'),'utf8')
const links=[...html.matchAll(/<link\b[^>]*rel=\"?stylesheet\"?[^>]*href=\"?([^\s>\"]+)/g)].map(match=>match[1])
assert.ok(links.length,'entry must actually link stylesheets')
const roots=links.map(href=>postcss.parse(readFileSync(resolve(dir,href.replace(/^\//,'')),'utf8')))
function mediaActive(rule,width){
 for(let parent=rule.parent;parent;parent=parent.parent){
  if(parent.type!=='atrule'||parent.name!=='media')continue
  const condition=parent.params
  const min=condition.match(/min-width:\s*(\d+)px|width\s*>=\s*(\d+)px/)
  const max=condition.match(/max-width:\s*(\d+)px|width\s*<=\s*(\d+)px/)
  if(min&&width<Number(min[1]??min[2])||max&&width>Number(max[1]??max[2]))return false
 }
 return true
}
function compiledStyles(width,dark){
 const variables={},selectors=new Map()
 for(const root of roots)root.walkRules(rule=>{
  if(!mediaActive(rule,width))return
  const parts=rule.selector.split(',').map(part=>part.trim())
  if(parts.includes(':root')||dark&&parts.includes('.dark'))rule.walkDecls(decl=>{if(decl.prop.startsWith('--'))variables[decl.prop]=decl.value})
  for(const selector of parts){const styles=selectors.get(selector)??{};rule.walkDecls(decl=>styles[decl.prop]=decl.value);selectors.set(selector,styles)}
 })
 const expand=(value,depth=0)=>{
  assert.ok(depth<20,'cyclic CSS variable')
  return value.replace(/var\((--[\w-]+)\)/g,(_,key)=>{assert.ok(key in variables,`missing compiled ${key}`);return expand(variables[key],depth+1)})
 }
 return {variables,expand,selectors}
}
for(const [width,title,label,control,compact,radius] of [[390,'1.375rem','.75rem','2.75rem','2.75rem','.5rem'],[768,'1.5rem','.8125rem','2.25rem','2.25rem','.625rem'],[1920,'1.75rem','.8125rem','2.25rem','2rem','.625rem']])for(const dark of [false,true]){
 const {variables,expand,selectors}=compiledStyles(width,dark)
 const number=value=>parseFloat(value)
 assert.equal(number(variables['--console-text-title']),number(title))
 assert.equal(number(variables['--console-text-label']),number(label))
 assert.equal(number(variables['--console-control-height']),number(control))
 assert.equal(number(variables['--console-control-height-sm']),number(compact))
 assert.equal(number(expand(selectors.get('.console-control')['border-radius'])),number(radius))
 assert.equal(number(expand(selectors.get('.console-page-title')['font-size'])),number(title))
 assert.match(expand(selectors.get('.console-card').background),/hsl\(/)
 assert.doesNotMatch(expand(selectors.get('.console-card')['box-shadow']),/var\(/)
 assert.ok((expand(selectors.get('.console-card')['box-shadow']).match(/hsl\(/g)??[]).length>=3,'card needs contact/middle/ambient shadow layers')
 const selectedShadow=expand(selectors.get('.console-runtime-component.is-selected')['box-shadow'])
 assert.doesNotMatch(selectedShadow,/inset/,'selection must not restore the hard inset rail')
 assert.ok((expand(variables['--console-shadow-button']).match(/hsl\(/g)??[]).length>=4,'button needs material highlight plus three soft shadow layers')
 assert.ok([...selectors.keys()].some(selector=>selector.includes('console-text-body')))
 assert.ok([...selectors.values()].some(styles=>styles.height?.includes('--console-control-height')),'shared control utility must be emitted')
 assert.equal(variables['--background'],dark?'0 0% 4%':'0 0% 100%')
}
console.log('Compiled linked styles: 390/768/1920px × light/dark role/radius/shadow/surface/control checks passed.')
