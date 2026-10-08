import { test } from 'node:test';import assert from 'node:assert/strict';
import { waitForPluginStatus } from '../console-ui/src/pages/plugin-lifecycle-model.mjs';
test('restart outage and stale state do not finish until formal target status',async()=>{
 const signal=new AbortController().signal;let count=0;const expected={status:'active',features:[{name:'command',count:1}]};
 const result=await waitForPluginStatus(async()=>{count++;if(count===1)throw Error('offline');return count===2?{status:'inactive'}:expected;},'active',signal,{attempts:3,pause:async()=>{}});
 assert.equal(count,3);assert.equal(result,expected);
});
test('timeout is unconfirmed and cancellation discards late target response',async()=>{
 assert.equal(await waitForPluginStatus(async()=>({status:'inactive'}),'active',new AbortController().signal,{attempts:2,pause:async()=>{}}),null);
 const controller=new AbortController();assert.equal(await waitForPluginStatus(async()=>{controller.abort();return {status:'active'};},'active',controller.signal),null);
});
