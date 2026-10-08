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
