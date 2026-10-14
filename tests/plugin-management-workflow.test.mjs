import test from 'node:test';
import assert from 'node:assert/strict';
import { managementLabel, captureVerificationPlan, verifyApprovedPlugin, verificationSummary, mutationRequest, applyRequest, waitForManagementState, canApplyPlugin } from '../console-ui/src/pages/plugin-management-model.mjs';
export const state = { packageName:'reminder',instanceKey:'reminder',installed:true,plugin:true,declared:true,version:'1.0.0',revision:'config-a',projectRevision:'project-a',status:'enabled',dependencies:'passed',validation:{valid:true,errors:[],missingEnv:[]},generation:1,published:true,readiness:'unknown',restartRequired:false,disabled:false,issues:[],verification:'available' };
const plan = { packageName:'reminder',instanceKey:'reminder',generation:1,projectRevision:'project-a',checkRevision:'checks-a',checks:[{id:'roundtrip',title:'临时任务',scope:'local',effects:['写入、读取并取消任务；不投递']}] };
test('approval captures the displayed effects and original generation/revision before one business execution',async()=>{
 const effects=[...plan.checks[0].effects]; const mutable={...plan,checks:[{...plan.checks[0],effects}]};const approved=captureVerificationPlan(mutable,state); effects[0]='新平台操作';
 const calls=[];const result=await verifyApprovedPlugin(async request=>{calls.push(request);return {packageName:'reminder',instanceKey:'reminder',generation:1,checkId:'roundtrip',current:true,status:'passed',scope:'local',summary:'本地任务已取消',evidence:['读取成功']};},approved,'roundtrip',state);
 assert.equal(calls.length,1);assert.deepEqual(calls[0],{type:'plugin:verify',instanceKey:'reminder',checkId:'roundtrip',expectedGeneration:1,expectedProjectRevision:'project-a',expectedCheckRevision:'checks-a'});assert.equal(approved.checks[0].effects[0],plan.checks[0].effects[0]);assert.match(verificationSummary(result),/尚未验证平台投递/);
});
test('changed generation, instance, revision and unknown check cannot execute an approved old plan',async()=>{
 let calls=0;for(const changed of [{...state,generation:2},{...state,projectRevision:'project-b'},{...state,instanceKey:'other'}]) await assert.rejects(verifyApprovedPlugin(async()=>{calls++;},plan,'roundtrip',changed));
 await assert.rejects(verifyApprovedPlugin(async()=>{calls++;},plan,'missing',state));assert.equal(calls,0);
});
test('lost verification reply is unknown and never retried; retired result never means current pass',async()=>{
 let calls=0;await assert.rejects(verifyApprovedPlugin(async()=>{calls++;throw Error('lost reply');},plan,'roundtrip',state));assert.equal(calls,1);
 assert.match(verificationSummary({status:'passed',scope:'local',current:false}),/不能证明当前插件可用/);
});
test('apply uses exact package/config evidence across restart counter reset and ignores stale state',async()=>{
 const pending={...state,status:'pending-restart',restartRequired:true,published:false};assert.deepEqual(applyRequest(pending),{type:'plugin:apply',instanceKey:'reminder',expectedProjectRevision:'project-a'});
 let reads=0;const result=await waitForManagementState(async()=>{reads++;if(reads===1)throw Error('restarting');return reads===2?{...state,projectRevision:'old-project'}:{...state,generation:1};},pending,new AbortController().signal,{attempts:3,pause:async()=>{}});assert.equal(reads,3);assert.equal(result.generation,1);
 const controller=new AbortController();assert.equal(await waitForManagementState(async()=>{controller.abort();return {...state,generation:2};},pending,controller.signal),null);
 assert.equal(canApplyPlugin({...pending,status:'missing-config'}),false);
});
test('install/update/uninstall keep approved revisions and exact instance/version instead of fetching latest revision',()=>{
 const approved={packageName:'reminder',instanceKey:'second',projectRevision:'approved-project',configurationRevision:'approved-config',requestedSpec:'reminder@1.0.0'};
 assert.deepEqual(mutationRequest('plugin:install',approved),{type:'plugin:install',packageName:'reminder@1.0.0',expectedProjectRevision:'approved-project',expectedRevision:'approved-config'});
 assert.equal(mutationRequest('plugin:uninstall',approved).packageName,'second');assert.equal(mutationRequest('plugin:update',approved,{targetVersion:'1.1.0'}).expectedRevision,'approved-config');assert.throws(()=>mutationRequest('plugin:install',{...approved,projectRevision:undefined}));assert.throws(()=>mutationRequest('plugin:install',{...approved,requestedSpec:'other@1.0.0'}));
});
test('installation and publication states remain distinct labels',()=>{
 assert.equal(managementLabel({...state,status:'installed'}),'依赖已安装');assert.equal(managementLabel({...state,status:'missing-config'}),'需要完善配置');assert.equal(managementLabel({...state,status:'pending-restart'}),'等待应用');assert.equal(managementLabel(null),'状态未确认');
});

test('enable/disable accepts only authoritative current publication, never the old active snapshot', async () => {
 const { waitForEnabledManagementState } = await import('../console-ui/src/pages/plugin-management-model.mjs');
 const previous = { ...state, disabled:true, published:false, restartRequired:true, status:'pending-restart' };
 let reads=0;
 const candidates=[{...state,status:'pending-restart',published:false,restartRequired:true,projectRevision:'lifecycle-new'}, {...state,projectRevision:'lifecycle-new',generation:1}];
 const enabled=await waitForEnabledManagementState(async()=>candidates[reads++],previous,true,new AbortController().signal,{attempts:2,pause:async()=>{}});
 assert.equal(reads,2);assert.equal(enabled.published,true);assert.equal(enabled.generation,1);
 for(const mismatch of [{...state,instanceKey:'other'},{...state,packageName:'other'},{...state,version:'2.0.0'},{...state,revision:'config-b'},{...state,generation:null}]) {
  assert.equal(await waitForEnabledManagementState(async()=>mismatch,previous,true,new AbortController().signal,{attempts:1}),null);
 }
 const disabled={...state,disabled:true,published:false,restartRequired:false,status:'declared',projectRevision:'lifecycle-disabled'};
 assert.equal(await waitForEnabledManagementState(async()=>disabled,state,false,new AbortController().signal,{attempts:1}),disabled);
 assert.equal(await waitForEnabledManagementState(async()=>({...disabled,published:true}),state,false,new AbortController().signal,{attempts:1}),null);
 const controller=new AbortController();
 assert.equal(await waitForEnabledManagementState(async()=>{controller.abort();return state},previous,true,controller.signal,{attempts:1}),null);
});

test('previous verification pass becomes invalid after HMR, config change, disable or instance replacement', async () => {
 const { verificationIsCurrent } = await import('../console-ui/src/pages/plugin-management-model.mjs');
 const passed={packageName:'reminder',instanceKey:'reminder',generation:1,checkId:'roundtrip',current:true,status:'passed',scope:'local',summary:'passed',evidence:['local only']};
 assert.equal(verificationIsCurrent(passed,plan,state),true);
 for(const changed of [{...state,generation:2},{...state,projectRevision:'project-b'},{...state,instanceKey:'other'},{...state,disabled:true},{...state,published:false},{...state,status:'pending-restart'},null]) assert.equal(verificationIsCurrent(passed,plan,changed),false);
 assert.equal(verificationIsCurrent({...passed,current:false},plan,state),false);
});

test('Host restart with identical generation/project still invalidates a pass through check incarnation', async () => {
 const { verificationIsCurrent } = await import('../console-ui/src/pages/plugin-management-model.mjs');
 const passed={packageName:'reminder',instanceKey:'reminder',generation:1,checkId:'roundtrip',current:true,status:'passed',scope:'local',summary:'passed',evidence:['old process']};
 assert.equal(verificationIsCurrent(passed,plan,state,{...plan}),true);
 assert.equal(verificationIsCurrent(passed,plan,state,{...plan,checkRevision:'same-check-new-host-incarnation'}),false);
 assert.equal(verificationIsCurrent(passed,plan,state,{...plan,instanceKey:'other'}),false);
 assert.equal(verificationIsCurrent(passed,plan,state,null),false);
});
