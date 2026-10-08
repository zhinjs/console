import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostRegistration } from '../console-ui/src/bootstrap/host-registration.mjs'

function fixture() {
  let routes = [{path:'/dashboard',name:'Builtin'}]
  const tools = new Map()
  const registry = createHostRegistration({
    readRoutes:()=>routes,
    addRoute:r=>{routes=[...routes.filter(x=>x.path!==r.path),r]},
    removeRoute:p=>{routes=routes.filter(x=>x.path!==p)},
    addTool:t=>{tools.set(t.id,t);return t.id},
    removeTool:id=>tools.delete(id),
  })
  return {registry,routes:()=>routes,tools}
}
test('Host reset removes dynamic entries and restores replaced builtin routes',()=>{
 const f=fixture(), session=f.registry.capture()
 session.addRoute({path:'/fixture',name:'Host'})
 session.addRoute({path:'/dashboard',name:'Replacement'})
 session.addTool({id:'fixture',name:'Host tool'})
 f.registry.reset()
 assert.deepEqual(f.routes(),[{path:'/dashboard',name:'Builtin'}])
 assert.equal(f.tools.size,0)
})
test('pending old Host cannot register after reset or overwrite new Host',async()=>{
 const f=fixture(), old=f.registry.capture()
 let release
 const waiting=new Promise(r=>release=r).then(()=>{
   old.addRoute({path:'/new',name:'Old'})
   assert.throws(()=>old.addTool({id:'stale'}),/stale tool/)
 })
 f.registry.reset()
 const current=f.registry.capture()
 current.addRoute({path:'/new',name:'Current'})
 release();await waiting
 assert.equal(f.routes().find(r=>r.path==='/new').name,'Current')
 assert.equal(f.tools.size,0)
})
