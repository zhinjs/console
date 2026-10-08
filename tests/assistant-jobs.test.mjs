import test from 'node:test'
import assert from 'node:assert/strict'
import {validateAssistantJobs,filterAssistantJobs,probeAssistantJobs} from '../console-ui/src/pages/assistant-jobs-model.mjs'
const jobs=[{id:'a',label:'例行检查',enabled:true,state:{lastStatus:'ok'}},{id:'b',label:'失败任务',enabled:true,state:{lastStatus:'error'}},{id:'c',label:'暂停任务',enabled:false,state:{}}]
test('formal schedule jobs preserve labels, enablement and nested execution status',()=>{
 assert.deepEqual(validateAssistantJobs({success:true,data:{jobs,eventsActive:true}}).jobs,jobs)
 assert.deepEqual(filterAssistantJobs(jobs,' 失败 ','all').map(j=>j.id),['b'])
 assert.deepEqual(filterAssistantJobs(jobs,'','paused').map(j=>j.id),['c'])
 assert.deepEqual(filterAssistantJobs(jobs,'','error').map(j=>j.id),['b'])
})
test('malformed assistant reads cannot become an empty task list',()=>{
 for(const body of [{success:true,data:{}},{success:true,data:{jobs:{},eventsActive:true}},{success:false},{success:true,data:{jobs:[{id:'a',enabled:true,label:{},state:{}}],eventsActive:true}},{success:true,data:{jobs:[{id:'a'}],eventsActive:true}}])assert.throws(()=>validateAssistantJobs(body))
 assert.deepEqual(validateAssistantJobs({success:true,data:{jobs:[],eventsActive:false}}).jobs,[])
})

test('assistant navigation requires an authorized, valid response instead of treating errors as availability', async () => {
 for (const status of [401,403,404,500,503]) {
  assert.equal(await probeAssistantJobs(async()=>({ok:false,status,json:async()=>{throw new Error('must not read denied body')}})),false)
 }
 for (const body of [{success:true,data:{}},{success:false},{success:true,data:{jobs:[{id:'a'}],eventsActive:true}}]) {
  assert.equal(await probeAssistantJobs(async()=>({ok:true,json:async()=>body})),false)
 }
 assert.equal(await probeAssistantJobs(async()=>({ok:true,json:async()=>({success:true,data:{jobs:[],eventsActive:false}})})),true)
 assert.equal(await probeAssistantJobs(async()=>{throw new Error('offline')}),false)
})
