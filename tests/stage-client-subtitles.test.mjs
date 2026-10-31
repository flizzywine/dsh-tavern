import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageSubtitles}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/subtitles.cjs')
test('subtitle splitting preserves text offsets and keeps already displayed streaming cards',()=>{
 const subtitles=createStageSubtitles({})
 const text='第一句话。第二句话。第三句话。'
 const cards=subtitles.cards(text,value=>Array.from(value).length<=6)
 assert.ok(cards.length>1)
 assert.equal(cards.map(card=>card.text).join(''),text)
 assert.equal(cards.at(-1).end,Array.from(text).length)
 const extended=text+'第四句话。'
 const hold=subtitles.heldCards(cards,text,extended)
 const next=subtitles.cards(extended,value=>Array.from(value).length<=6,hold)
 assert.deepEqual(next.slice(0,hold.cards.length),hold.cards)
 assert.equal(next.map(card=>card.text).join(''),extended)
 assert.deepEqual(subtitles.step(0,0,1,[2,1]),{page:0,card:1})
 assert.deepEqual(subtitles.step(1,0,-1,[2,1]),{page:0,card:1})
 assert.equal(subtitles.voiceTime([{start:0,end:5},{start:5,end:10}],0,8),4)
})
test('subtitle measurement listeners and queued callbacks stop at unmount',()=>{
 let state=0,effects=[],frames=0,fontCallback,resizeCallback
 const events=new Map(),fontEvents=new Map()
 const clone={style:{},removeAttribute(){},setAttribute(){},remove(){}}
 const element={cloneNode:()=>clone,className:'text',clientWidth:0,getBoundingClientRect:()=>({width:0}),closest:()=>null}
 const React={useState:value=>[++state===1?element:value,()=>{}],useCallback:fn=>fn,useMemo:fn=>fn(),useRef:value=>({current:value}),useLayoutEffect:fn=>effects.push(fn)}
 const subtitles=createStageSubtitles({React,document:{createElement:()=>({style:{},append(){}}),fonts:{addEventListener:(k,fn)=>fontEvents.set(k,fn),removeEventListener:k=>fontEvents.delete(k)}},
 window:{addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k)},
 foreground:{requestAnimationFrame:()=>++frames,cancelAnimationFrame(){}},fonts:{subscribe:fn=>{fontCallback=fn;return ()=>{}}},
 ResizeObserver:class {constructor(fn){resizeCallback=fn}observe(){}disconnect(){}}})
 subtitles.useSubtitles(false,[{text:'文字'}],0,'s','classic',{})
 const stops=effects.map(fn=>fn())
 const lateFont=fontEvents.get('loadingdone')
 stops.forEach(fn=>fn?.())
 resizeCallback();lateFont();fontCallback()
 assert.equal(frames,0)
 assert.equal(events.size,0)
 assert.equal(fontEvents.size,0)
})
