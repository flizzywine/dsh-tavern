import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageTextcardPlayers}=createRequire(import.meta.url)('../tavern-plugin/mods/textcard/client/player.cjs')
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
