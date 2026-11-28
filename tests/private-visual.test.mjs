import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {conversationAvatarStyle,conversationInitials} from '../console-ui/src/pages/endpoint-detail/conversation-avatar.ts'
const root=new URL('../',import.meta.url)
test('conversation avatars preserve initials and use theme paired gray values for all identities',()=>{
 for(const type of ['private','group','channel']) for(const seed of ['alice','bob','123456']) assert.deepEqual(conversationAvatarStyle(seed,type),{background:'hsl(var(--im-row-active))',color:'hsl(var(--im-row-active-fg))'})
 assert.equal(conversationInitials('Alice'),'AL')
 assert.equal(conversationInitials('凉菜'),'凉')
 assert.equal(conversationInitials('123456'),'56')
})
test('Agent private styles are gone with the Sandbox playground copy; the Console stylesheet keeps no fixed teal',()=>{
 // adapter-sandbox >= 1.2.0 styles its own playground; the Console no longer carries agent-playground.css.
 assert.equal(existsSync(new URL('console-ui/src/agent-playground.css',root)),false)
 for(const path of ['client/style.css']) assert.doesNotMatch(readFileSync(new URL(path,root),'utf8'),/hsl\((184|186) 42% 32%\)|agent-playground/)
})
