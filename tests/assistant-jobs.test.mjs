import test from 'node:test'
import assert from 'node:assert/strict'
import {validateAssistantJobs,filterAssistantJobs} from '../console-ui/src/pages/assistant-jobs-model.mjs'
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
