import test from 'node:test'
import assert from 'node:assert/strict'
import { readErrorSummary, shouldShowMissingEnv } from '../console-ui/src/utils/read-error.mjs'
test('HTTP and RPC permission errors identify missing authority rather than connection problems',()=>{
 for(const error of ['HTTP 403','Demo RPC forbidden: env:list']) assert.match(readErrorSummary(error,'配置'),/当前身份无权读取配置/)
 assert.doesNotMatch(readErrorSummary('EISDIR','配置'),/无权/)
})
test('unknown and failed env reads never claim missing file or automatic creation',()=>{
 for(const state of [{loaded:false,exists:false,dirty:false,readFailed:true},{loaded:true,exists:undefined,dirty:false,readFailed:false},{loaded:true,exists:false,dirty:false,readFailed:true}]) assert.equal(shouldShowMissingEnv(state),false)
 assert.equal(shouldShowMissingEnv({loaded:true,exists:false,dirty:false,readFailed:false}),true)
})
