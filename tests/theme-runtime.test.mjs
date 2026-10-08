import test from 'node:test'
import assert from 'node:assert/strict'
import {applyTheme} from '../console-ui/src/theme/index.ts'
test('mode application removes legacy inline green palette and never overrides stylesheet tokens',()=>{
 const oldDocument=globalThis.document, oldStorage=globalThis.localStorage
 const properties=new Map([['--primary','154 54% 40%'],['--background','150 30% 97%'],['--host-extension-color','keep']])
 const classes=new Set(['light']), saved=[]
 globalThis.document={documentElement:{classList:{remove:(...items)=>items.forEach(item=>classes.delete(item)),add:item=>classes.add(item)},style:{removeProperty:key=>properties.delete(key),setProperty:()=>{throw new Error('palette must remain CSS owned')}}}}
 globalThis.localStorage={setItem:(...args)=>saved.push(args)}
 try {
  applyTheme('dark')
  assert.deepEqual([...classes],['dark'])
  assert.equal(properties.has('--primary'),false)
  assert.equal(properties.has('--background'),false)
  assert.equal(properties.get('--host-extension-color'),'keep')
  applyTheme('light')
  assert.deepEqual([...classes],['light'])
  assert.deepEqual(saved,[['theme','dark'],['theme','light']])
 } finally {globalThis.document=oldDocument;globalThis.localStorage=oldStorage}
})
