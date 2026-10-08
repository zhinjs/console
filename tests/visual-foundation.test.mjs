import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const root=new URL('../',import.meta.url)
const css=readFileSync(new URL('console-ui/src/theme-tokens.css',root),'utf8')
const themes=[...css.matchAll(/(?:\:root|\.dark)\s*\{([^}]+)/g)].map(match=>Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)%\s+([\d.]+)%/g)].map(m=>[m[1],{h:Number(m[2]),s:Number(m[3]),l:Number(m[4])}])) )
const linear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4
const luminance=({h,s,l})=>{
 const saturation=s/100,lightness=l/100,chroma=(1-Math.abs(2*lightness-1))*saturation
 const hue=h/60,x=chroma*(1-Math.abs(hue%2-1)),m=lightness-chroma/2
 const channels=hue<1?[chroma,x,0]:hue<2?[x,chroma,0]:hue<3?[0,chroma,x]:hue<4?[0,x,chroma]:hue<5?[x,0,chroma]:[chroma,0,x]
 return channels.map(channel=>linear(channel+m)).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0)
}
const ratio=(a,b)=>{const la=luminance(a),lb=luminance(b);return(Math.max(la,lb)+.05)/(Math.min(la,lb)+.05)}
test('both neutral themes preserve readable type and visible control boundaries',()=>{
 assert.equal(themes.length,2)
 for(const tokens of themes){
  for(const [name,value] of Object.entries(tokens)) if(!/^(primary|success|info|warning|destructive)(-|$)/.test(name)) assert.equal(value.s,0,`${name} is neutral`)
  for(const [foreground,background] of [['foreground','background'],['card-foreground','card'],['muted-foreground','background'],['muted-foreground','card'],['primary-foreground','primary'],['im-bubble-out-fg','im-bubble-out'],['im-row-active-fg','im-row-active'],['destructive-foreground','destructive'],['success-foreground','success'],['info-foreground','info'],['warning-foreground','warning']]) assert.ok(ratio(tokens[foreground],tokens[background])>=4.5,`${foreground}/${background} text contrast`)
  for(const [foreground,background] of [['input','card'],['input','background'],['ring','background'],['destructive','background'],['success','background'],['info','background'],['warning','background']]) assert.ok(ratio(tokens[foreground],tokens[background])>=3,`${foreground}/${background} control contrast`)
 }
})
test('real and secondary Console entries share one palette without remote font requests',()=>{
 const design=readFileSync(new URL('console-ui/src/design-system.css',root),'utf8')
 assert.match(design,/@import "\.\/theme-tokens\.css"/)
 for(const path of ['client/style.css','console-ui/src/style.css']){
  const entry=readFileSync(new URL(path,root),'utf8')
  assert.match(entry,/@import .*design-system\.css/)
  assert.doesNotMatch(entry,/--background:\s|fonts\.googleapis\.com/)
 }
})
