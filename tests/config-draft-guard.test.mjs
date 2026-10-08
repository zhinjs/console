import test from 'node:test'
import assert from 'node:assert/strict'
import { createConfigDraftGuard } from '../console-ui/src/components/PluginConfigForm/draft-guard.mjs'
test('dirty plugin draft survives background refresh and failed save until successful retry',()=>{
 const draft=createConfigDraftGuard()
 let visible={threshold:3}
 if(draft.receive('repeater',visible)) visible={threshold:3}
 draft.edited();visible={threshold:4}
 for(const read of [{threshold:3},{threshold:5}]) if(draft.receive('repeater',read)) visible=read
 assert.deepEqual(visible,{threshold:4})
 // A rejected save has no success commit, so a reconnect read cannot erase it.
 assert.equal(draft.receive('repeater',{threshold:3}),false)
 draft.saved()
 assert.equal(draft.receive('repeater',{threshold:4}),true)
 draft.edited()
 assert.equal(draft.receive('other',{enabled:true}),true)
})
