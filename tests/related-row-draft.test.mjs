import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRelatedRow } from '../console-ui/src/pages/database/related-row-draft.mjs'

test('editing text preserves empty strings and literal JSON-looking content', () => {
 for (const value of ['', '123', 'true', 'null', '"quoted"']) {
  assert.deepEqual(parseRelatedRow(['message'], {message:value}, {message:{type:'text'}}, {message:'previous'}), {message:value})
 }
 assert.deepEqual(parseRelatedRow(['message'], {message:''}, {}, {message:'previous'}), {message:''})
})
test('new blank fields retain defaults and non-text JSON retains its types', () => {
 assert.deepEqual(parseRelatedRow(['message'], {message:''}, {message:{type:'text'}}), {})
 assert.deepEqual(parseRelatedRow(['id','payload'], {id:'12',payload:'{"ok":true}'}, {id:{type:'integer'},payload:{type:'json'}}), {id:12,payload:{ok:true}})
})
