import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageSpeech}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/speech.cjs')
function fixture(){
 const calls=[];let owner='other:chat'
 const speech=createStageSpeech({available:()=>true,speechInput:d=>({text:d.text,mood:d.mood}),character:()=>({alias:'Alice',voiceKey:'voice-a'}),language:()=> 'zh',open:(...args)=>calls.push(['open',...args]),
 player:{get:()=>({owner}),stopPlayback:()=>calls.push(['stop']),prefetch:(resource,request)=>{resource();calls.push(['prefetch',request])},play:(resource,request)=>{resource();calls.push(['play',request])},cancelPrefetch:handles=>calls.push(['retain',handles])}})
 return {speech,calls,setOwner:value=>owner=value}
}
test('lookahead prioritizes current unread pages, deduplicates clips and only visits next indexed turn',()=>{
 const {speech}=fixture(),make=n=>speech.handle('s',{alias:'a',text:String(n)}, {},n)
 const first=make(1),second=make(2),pages=[{voice:first},{voice:second},{voice:second}]
 const index=new Map([[1,{}],[3,{text:{pages:[{voice:{alias:'a',text:'3'},anchor:{paragraphId:3}}]}}],[5,{text:{pages:[]}}]])
 assert.deepEqual(speech.window('s',index,1,pages,1,{},2),[second,first])
 assert.equal(speech.window('s',index,1,pages,1,{}).length,3)
})
