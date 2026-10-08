import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {conversationAvatarStyle,conversationInitials} from '../console-ui/src/pages/endpoint-detail/conversation-avatar.ts'
const root=new URL('../',import.meta.url)
test('conversation avatars preserve initials and use theme paired gray values for all identities',()=>{
 for(const type of ['private','group','channel']) for(const seed of ['alice','bob','123456']) assert.deepEqual(conversationAvatarStyle(seed,type),{background:'hsl(var(--im-row-active))',color:'hsl(var(--im-row-active-fg))'})
 assert.equal(conversationInitials('Alice'),'AL')
 assert.equal(conversationInitials('凉菜'),'凉')
 assert.equal(conversationInitials('123456'),'56')
})
test('Agent private styles inherit paired neutral controls and keep readable caption size',()=>{
 const css=readFileSync(new URL('console-ui/src/agent-playground.css',root),'utf8')
 assert.match(css,/--playground-accent: var\(--primary\)/)
 assert.match(css,/--playground-accent-foreground: var\(--primary-foreground\)/)
 assert.doesNotMatch(css,/color: white;|gradient\(/)
 for(const match of css.matchAll(/font-size:\s*([\d.]+)rem/g)) assert.ok(Number(match[1])>=.75,`caption ${match[1]}rem is too small`)
 for(const path of ['client/style.css','console-ui/src/style.css']) assert.doesNotMatch(readFileSync(new URL(path,root),'utf8'),/hsl\((184|186) 42% 32%\)/)
})
