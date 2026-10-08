import test from 'node:test'
import assert from 'node:assert/strict'
import { logReadState, logPayloadAvailability } from '../console-ui/src/pages/logs/read-state.mjs'
test('failed or unknown reads never show factual zero or permit log maintenance',()=>{
 const initial={readOnly:false,loaded:false,error:null,statsError:null,stats:null}
 assert.deepEqual(logReadState(initial),{logsKnown:false,total:'—',canManage:false})
 assert.equal(logReadState({...initial,loaded:true,error:'403',stats:{total:4}}).canManage,false)
 assert.equal(logReadState({...initial,loaded:true,statsError:'403'}).canManage,false)
 const recovered=logReadState({...initial,loaded:true,stats:{total:0}})
 assert.deepEqual(recovered,{logsKnown:true,total:0,canManage:true})
 assert.equal(logReadState({...initial,loaded:true,readOnly:true,stats:{total:0}}).canManage,false)
})

test('Host HTTP 200 unavailable notes do not become a factual empty log database',()=>{
 const note='SystemLog 模型不可用（Database 未启动或未注册 DatabaseLogTransport）'
 for(const payload of [{success:true,data:[],total:0,note},{success:true,data:{total:0,byLevel:{info:0,warn:0,error:0}},note}]) {
  const availability=logPayloadAvailability(payload)
  assert.equal(availability.available,false)
  assert.match(availability.message,/数据源暂不可用.*SystemLog/)
  assert.equal(logReadState({readOnly:false,loaded:false,error:availability.message,statsError:null,stats:null}).canManage,false)
 }
 assert.equal(logPayloadAvailability({success:true,data:[],total:0}).available,true)
})
