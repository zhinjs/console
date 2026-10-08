import { test } from 'node:test';import assert from 'node:assert/strict';
import { createReadState,pendingRead,successfulRead,failedRead } from '../console-ui/src/hooks/console-read-state.mjs';
import { readErrorSummary } from '../console-ui/src/utils/read-error.mjs';
test('unread or forbidden resources stay distinct from a successful empty read',()=>{
 const unread=createReadState([]);const denied=failedRead(pendingRead(unread),'Token scope does not allow this route');
 assert.equal(unread.loaded,false);assert.equal(denied.loaded,false);assert.match(readErrorSummary(denied.error,'文件列表'),/当前身份无权/);
 const empty=successfulRead([]);assert.equal(empty.loaded,true);assert.equal(empty.error,null);assert.deepEqual(empty.data,[]);
});
test('read failure preserves cached data, and successful retry clears errors',()=>{
 const prior=successfulRead([{name:'fixture'}]);const failed=failedRead(pendingRead(prior),'forbidden');assert.equal(failed.data,prior.data);assert.equal(failed.loaded,true);
 const restored=successfulRead([{name:'restored'}]);assert.equal(restored.error,null);assert.equal(restored.data[0].name,'restored');
});
