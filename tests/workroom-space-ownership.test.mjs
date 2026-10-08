import test from 'node:test'
import assert from 'node:assert/strict'
import {validateWorkroomSpaceOwnership as validate} from '../console-ui/src/pages/workroom-catalog-model.mjs'
const binding={adapter:'test',endpoint:'bot',kind:'group',id:'space'}
const room=(extra={})=>({enabled:true,members:[],sponsors:['owner'],conversation:binding,...extra})
test('enabled primary spaces conflict, while disabled projects and different endpoints do not',()=>{
 const issues=validate([room(),room()]);assert.ok(issues[0].conversation);assert.ok(issues[1].conversation)
 assert.ok(!validate([room(),room({enabled:false})])[0].conversation)
 assert.ok(!validate([room(),room({conversation:{...binding,endpoint:'other'}})])[1].conversation)
 assert.ok(validate([room({conversation:{...binding,kind:'repository',id:'Owner/Repo'}}),room({conversation:{...binding,kind:'repository',id:'owner/repo'}})])[1].conversation)
})
test('Sponsor space sharing requires equal nonempty audiences and cannot overlap a primary space',()=>{
 assert.ok(validate([room({sponsorConversation:binding})])[0].sponsorConversation)
 const rooms=[room({conversation:{...binding,id:'a'},sponsorConversation:binding}),room({conversation:{...binding,id:'b'},sponsorConversation:binding})]
 assert.ok(!validate(rooms)[1].sponsorConversation)
 assert.ok(validate([rooms[0],{...rooms[1],sponsors:['different']}])[1].sponsorConversation)
 assert.ok(validate([rooms[0],{...rooms[1],sponsors:[]}])[0].sponsorConversation)
})
test('member message endpoints respect cross-project space ownership but may inherit their own space',()=>{
 assert.equal(validate([room({members:[{agent:'a',messageRoute:{adapter:'test',endpoint:'bot'}}]})])[0].members.length,0)
 const other=room({conversation:{...binding,endpoint:'other'},members:[{agent:'a',messageRoute:{adapter:'test',endpoint:'bot'}}]})
 assert.equal(validate([room(),other])[1].members.length,1)
})
