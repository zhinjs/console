import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInstall, canResumeInstall, planInstallRecovery } from '../console-ui/src/pages/marketplace-install-model.mjs';
const name='@zhin.js/repeater';
const state={packageName:name,instanceKey:'repeater',installed:true,plugin:true,declared:true,version:'1.0.0',revision:'config',projectRevision:'project',status:'pending-restart',dependencies:'passed',validation:null,generation:1,published:false,readiness:'unknown',restartRequired:true,disabled:false,issues:[],verification:'not-configured'};
const target={instanceKey:'repeater',version:'1.0.0'};
test('lost response reconciles real package version and exact mount without installing again',async()=>{
 let reads=0;const result=await reconcileInstall(name,async()=>{reads++;return state;},target);
 assert.equal(reads,1);assert.equal(result.confirmed,true);assert.match(result.message,/无需重复安装/);assert.match(result.message,/应用与业务功能/);
});
test('old installed version, partial mount or unavailable evidence cannot confirm the new install',async()=>{
 for(const read of [async()=>({...state,version:'0.9.0'}),async()=>({...state,declared:false}),async()=>{throw Error('offline');},async()=>({...state,instanceKey:'another'}),async()=>({...state,packageName:'different'})]){
  const result=await reconcileInstall(name,read,target);assert.equal(result.confirmed,false);assert.match(result.message,/旧安装计划已失效/);
 }
});

test('ordinary dependency installation is confirmed without inventing a mounted plugin',async()=>{
 const result=await reconcileInstall(name,async()=>({...state,plugin:false,declared:false,status:'installed'}),target);assert.equal(result.confirmed,true);assert.match(result.message,/不会挂载/);
});

test('partial installation gets a newly revision-bound plan, without submitting another installation',async()=>{
 const partial={...state,declared:false,status:'installed'};
 assert.equal(canResumeInstall(partial,name,target),true);
 assert.equal(canResumeInstall({...partial,version:'0.9.0'},name,target),false);
 const calls=[];
 const result=await planInstallRecovery(async request=>{calls.push(request);return request.type==='plugin:inspect'?partial:{packageName:name,instanceKey:'repeater',projectRevision:'fresh-project',configurationRevision:'fresh-config'};},name,target);
 assert.equal(result.projectRevision,'fresh-project');
 assert.equal(result.requestedSpec,`${name}@1.0.0`);
 assert.deepEqual(calls.map(call=>call.type),['plugin:inspect','plugin:plan-install']);
 await assert.rejects(planInstallRecovery(async()=>({...partial,declared:true}),name,target),/状态已变化/);
});
