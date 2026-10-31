import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageTextcardPlayers}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/textcard-player.cjs')
test('textcard unload settles queued font waits and removes clocks',async()=>{
 const frames=new Map(),timers=new Map(),intervals=new Map();let id=0,ready
 const clock=map=>fn=>{map.set(++id,fn);return id}
 const players=createStageTextcardPlayers({document:{},performance:{now:()=>0},requestAnimationFrame:clock(frames),cancelAnimationFrame:id=>frames.delete(id),setInterval:clock(intervals),clearInterval:id=>intervals.delete(id),setTimeout:clock(timers),clearTimeout:id=>timers.delete(id),createGate:()=>({slot:t=>t,mark(){}}),peak:()=>0})
 const player=players.create({fontsReady:()=>new Promise(resolve=>ready=resolve)})
 const plan={style:'card',frames:[{ms:100}]}
 const first=player.play(plan),second=player.play(plan)
 await Promise.resolve();const late=[...frames.values()][0]
 assert.equal(timers.size,2);assert.equal(intervals.size,1)
 players.dispose();ready();late()
 assert.deepEqual(await Promise.all([first,second]),[true,true])
 assert.equal(timers.size,0);assert.equal(frames.size,0);assert.equal(intervals.size,0)
 assert.equal(await player.play(plan),false)
})
test('ready cards paint and skip through the existing colour gate',async()=>{
 const frames=new Map(),intervals=new Map();let id=0,node=null
 const players=createStageTextcardPlayers({document:{},performance:{now:()=>0},requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:id=>frames.delete(id),setInterval:fn=>{intervals.set(++id,fn);return id},clearInterval:id=>intervals.delete(id),setTimeout,clearTimeout,createGate:()=>({slot:t=>t,mark(){}}),peak:()=>0,layout:{textcardNode:()=>({card:{},key:'paper'}),textcardReadable(){},textcardFit(){},textcardPaints:()=>({key:'paper'})},center:{center(){}}})
 const player=players.create({fontsLoaded:()=>true})
 player.attach({replaceChildren(value){node=value}})
 const done=player.play({style:'card',sr:'text',frames:[{ms:100,state:{}}]})
 assert.ok(node);assert.equal(player.snapshot().phase,'up')
 assert.equal(player.skip(),true);assert.equal(await done,true)
 assert.equal(node,undefined);assert.equal(player.snapshot().phase,'idle')
 players.dispose();assert.equal(frames.size,0);assert.equal(intervals.size,0)
})
