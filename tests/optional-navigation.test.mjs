import test from 'node:test'
import assert from 'node:assert/strict'
import { createOptionalNavigation } from '../console-ui/src/bootstrap/optional-navigation.mjs'

test('availability updates the current route once without replacing its element', () => {
 const calls=[], nav=createOptionalNavigation(), element={}
 nav.bind({active:()=>true,addRoute:r=>calls.push(r)}, {path:'/jobs',element,meta:{group:'tools'}}, false)
 const report=nav.capture();report(true);report(true);report(false)
 assert.deepEqual(calls.map(r=>r.meta.hideInMenu),[true,false,true])
 assert.ok(calls.every(r=>r.element===element && r.meta.group==='tools'))
})
test('stale availability cannot change a new Host route or a reset registration', () => {
 const calls=[],nav=createOptionalNavigation();let active=true
 nav.bind({active:()=>active,addRoute:r=>calls.push(r)}, {path:'/jobs'}, false)
 const old=nav.capture();active=false;old(true);assert.equal(calls.length,1)
 nav.bind({active:()=>true,addRoute:r=>calls.push(r)}, {path:'/jobs'}, false)
 old(true);assert.equal(calls.length,2)
 const current=nav.capture();nav.reset();current(true);assert.equal(calls.length,2)
})
