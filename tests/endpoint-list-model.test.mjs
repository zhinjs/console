import test from 'node:test'
import assert from 'node:assert/strict'
import { readEndpointList } from '../console-ui/src/pages/endpoint-list-model.mjs'
const endpoint = {name:'test-bot',adapter:'sandbox',connected:true,status:'online'}
test('only an explicit endpoint array establishes empty or populated channel results', () => {
  assert.deepEqual(readEndpointList({endpoints:[]}),[])
  assert.deepEqual(readEndpointList({endpoints:[endpoint]}),[endpoint])
  for (const payload of [undefined,null,{}, {endpoints:null},{endpoints:{}}]) assert.throws(()=>readEndpointList(payload),/渠道列表/)
})
test('invalid channel identities, states and counts cannot establish normal channel cards', () => {
  for (const patch of [{name:''},{adapter:null},{connected:'true'},{status:'unknown'},{pendingRequestCount:-1},{pendingNoticeCount:1.5}]) assert.throws(()=>readEndpointList({endpoints:[{...endpoint,...patch}]}))
  assert.throws(()=>readEndpointList({endpoints:[null]}))
  assert.equal(readEndpointList({endpoints:[{...endpoint,connected:false,status:'offline',pendingRequestCount:0}]}).length,1)
})
