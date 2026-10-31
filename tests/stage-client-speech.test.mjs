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
test('speech preserves transcript cache identity and stage ownership for dialogue and narration',()=>{
 const {speech,calls}=fixture(),config={narrator:{voiceKey:'n'}},line={alias:'authored-name',text:'hello',mood:'smile',lineIdentity:['round',3]}
 const handle=speech.handle('s',line,config,3)
 handle.prefetch();handle.click({automatic:true,handoff:true})
 assert.equal(handle.owner,'s:stage');assert.equal(handle.selectionKey,JSON.stringify(['s','round',3]))
 assert.deepEqual(JSON.parse(JSON.parse(handle.cacheKey)[0]),['s','Alice','voice-a','zh','hello','smile'])
 assert.deepEqual(calls[0],['open','s',{alias:'Alice'}]);assert.equal(calls[3][1].automatic,true);assert.equal(calls[3][1].handoff,true)
 const narrator=speech.handle('s',{narration:true,text:'narration',lineIdentity:['round',4]},config,4)
 narrator.click({id:'backlog-row'});assert.equal(calls.at(-1)[1].id,'backlog-row');assert.deepEqual(calls.at(-2),['open','s',{narrator:true}])
 assert.equal(speech.handle('s',line,{voice:{enabled:false}},3),null)
})
test('lookahead prioritizes current unread pages, deduplicates clips and only visits next indexed turn',()=>{
 const {speech}=fixture(),make=n=>speech.handle('s',{alias:'a',text:String(n)}, {},n)
 const first=make(1),second=make(2),pages=[{voice:first},{voice:second},{voice:second}]
 const index=new Map([[1,{}],[3,{text:{pages:[{voice:{alias:'a',text:'3'},anchor:{paragraphId:3}}]}}],[5,{text:{pages:[]}}]])
 assert.deepEqual(speech.window('s',index,1,pages,1,{},2),[second,first])
 assert.equal(speech.window('s',index,1,pages,1,{}).length,3)
})
test('stale handles cannot enqueue new playback after disposal and stop only affects the owning stage',async()=>{
 const f=fixture(),handle=f.speech.handle('s',{alias:'a',text:'hello'}, {},1)
 f.speech.stop('s');assert.equal(f.calls.length,0)
 f.setOwner('s:stage');f.speech.stopPlayback('s');assert.deepEqual(f.calls,[['stop']])
 f.speech.dispose();await handle.prefetch();await handle.click();f.speech.retain([]);f.speech.stop('s')
 assert.equal(f.calls.length,1);assert.equal(f.speech.available(),false);assert.equal(f.speech.handle('s',{}, {},2),null)
 assert.deepEqual(f.speech.window('s',new Map(),1,[],0,{}),[])
})

test('queued synthesis cannot open a new resource after plugin disposal',async()=>{
 let resource,opened=0
 const speech=createStageSpeech({available:()=>true,speechInput:d=>d,character:()=>({alias:'a'}),language:()=> 'zh',open:()=>opened++,player:{prefetch:read=>{resource=read}}})
 speech.handle('s',{text:'hello'}, {},1).prefetch();speech.dispose()
 await assert.rejects(resource(),{name:'AbortError'});assert.equal(opened,0)
})
