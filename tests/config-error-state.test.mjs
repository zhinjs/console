import test from 'node:test'
import assert from 'node:assert/strict'
import { configErrorReducer as reduce } from '../console-ui/src/hooks/config-error-state.mjs'
test('discarding invalid YAML removes only the failed save error',()=>{
 let state={readError:null,saveError:null}
 state=reduce(state,{type:'save-failed',error:'Failed to save config: bad YAML'})
 assert.equal(state.saveError,'Failed to save config: bad YAML')
 state=reduce(state,{type:'discard-save'})
 assert.deepEqual(state,{readError:null,saveError:null})
 state=reduce(state,{type:'read-failed',error:'network unavailable'})
 state=reduce(state,{type:'save-failed',error:'revision conflict'})
 state=reduce(state,{type:'discard-save'})
 assert.deepEqual(state,{readError:'network unavailable',saveError:null})
})
test('retry failure remains visible and successful retry clears save error',()=>{
 let state={readError:null,saveError:'old failure'}
 state=reduce(state,{type:'save-start'})
 state=reduce(state,{type:'save-failed',error:'still invalid'})
 assert.equal(state.saveError,'still invalid')
 state=reduce(state,{type:'save-succeeded'})
 assert.equal(state.saveError,null)
})
test('a read refused for lack of permission is remembered until the next read starts',()=>{
 let state={readError:null,saveError:null}
 state=reduce(state,{type:'read-failed',error:'缺少权限 ops.config.read',denied:true})
 assert.deepEqual(state,{readError:'缺少权限 ops.config.read',saveError:null,readDenied:true})
 state=reduce(state,{type:'read-start'})
 assert.deepEqual(state,{readError:null,saveError:null})
 state=reduce(state,{type:'read-failed',error:'denied',denied:true})
 state=reduce(state,{type:'read-failed',error:'network unavailable'})
 assert.deepEqual(state,{readError:'network unavailable',saveError:null})
})
