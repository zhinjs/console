import test from 'node:test'
import assert from 'node:assert/strict'
import {readPendingRequests,pendingRequestKey} from '../console-ui/src/pages/endpoint-detail/pending-request-model.mjs'
const row={platformRequestId:'one',type:'friend',actor:{id:'user',name:'申请人'},channel:{id:'user',type:'private'},timestamp:1}
test('formal live requests use actor and platform identity without inventing database ids',()=>{
 const rows=readPendingRequests({source:'endpoint',inboxEnabled:false,requests:[row,{...row,platformRequestId:'two'}]})
 assert.equal(rows[0].sender.name,'申请人');assert.equal(rows[0].id,undefined);assert.equal(rows[0].canAct,false)
 assert.equal(new Map(rows.map(r=>[pendingRequestKey(r),r])).size,2)
 assert.deepEqual(readPendingRequests({source:'endpoint',inboxEnabled:false,requests:[]}),[])
})
test('incomplete request projections are errors and persisted requests retain row identity',()=>{
 assert.throws(()=>readPendingRequests({source:'endpoint',inboxEnabled:false,requests:[{...row,actor:undefined}]}))
 assert.throws(()=>readPendingRequests({source:'inbox',inboxEnabled:true,requests:[row]}))
 assert.equal(readPendingRequests({source:'inbox',inboxEnabled:true,requests:[{...row,id:7}]})[0].id,7)
})
