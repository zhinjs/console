import { test } from 'node:test';import assert from 'node:assert/strict';
import { copyText } from '../console-ui/src/pages/clipboard-copy.mjs';
function fixture(result) {
 let removed=0,focused=0;
 const doc={activeElement:{focus(){focused++}},createElement(){return {style:{},select(){}}},body:{appendChild(el){el.parentNode=this},removeChild(el){el.parentNode=null;removed++}},execCommand(){if(result instanceof Error)throw result;return result}};
 return {doc,counts:()=>({removed,focused})};
}
test('successful Clipboard API avoids fallback and only explicit fallback true succeeds',async()=>{
 assert.equal(await copyText('sample',{writeText:async()=>{}},{}),true);
 const {doc,counts}=fixture(true);assert.equal(await copyText('sample',{writeText:async()=>{throw Error('denied')}},doc),true);assert.deepEqual(counts(),{removed:1,focused:1});
});
test('false or throwing fallback is failure and temporary textarea is always removed',async()=>{
 for(const value of [false,new Error('unsupported')]){
  const {doc,counts}=fixture(value);assert.equal(await copyText('sample',undefined,doc),false);assert.deepEqual(counts(),{removed:1,focused:1});
 }
});
