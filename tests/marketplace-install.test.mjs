import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInstall } from '../console-ui/src/pages/marketplace-install-model.mjs';
const name='@zhin.js/repeater';
test('lost response reconciles persisted dependency and mount without installing again',async()=>{
 let reads=0;const result=await reconcileInstall(name,async()=>{reads++;return {packageName:name,alreadyInstalled:true,alreadyDeclared:true};});
 assert.equal(reads,1);assert.equal(result.confirmed,true);assert.match(result.message,/无需重复安装/);
});
test('partial or unavailable state remains unknown and cannot authorize retry',async()=>{
 for(const read of [async()=>({packageName:name,alreadyInstalled:true,alreadyDeclared:false}),async()=>{throw Error('offline')},async()=>({packageName:'different',alreadyInstalled:true,alreadyDeclared:true})]){
  const result=await reconcileInstall(name,read);assert.equal(result.confirmed,false);assert.match(result.message,/旧安装计划已失效/);
 }
});
