import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageSfx} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/sfx.cjs')
function setup() {
  const nodes = [], timers = new Map(), subscribers = new Set()
  let serial = 0
  class Audio {
    constructor(url) { this.src=url; this.currentTime=0; this.events=new Map(); nodes.push(this) }
    play() { return Promise.resolve() }
    pause() { this.paused=true }
    removeAttribute() { this.src='' }
    addEventListener(name,fn) { this.events.set(name,fn) }
    removeEventListener(name) { this.events.delete(name) }
  }
  const player = createStageSfx({Audio,
    audio:{bind(){},level(){},release(node){node.released=true; if(node.fail) throw new Error('release failed')},subscribe(fn){subscribers.add(fn);return ()=>subscribers.delete(fn)}},
    foreground:{isAudible:()=>true,now:()=>10000,setTimeout:fn=>{timers.set(++serial,fn);return serial},clearTimeout:id=>timers.delete(id)},
    matches:(ref,scope)=>ref===scope,
  })
  return {player,nodes,timers,subscribers}
}
test('sound disposal settles every shot and removes delayed thunder and subscriptions despite release failure', async () => {
  const {player,nodes,timers,subscribers} = setup()
  let notifications=0
  const off=player.subscribe(()=>notifications++)
  const lateNotify=[...subscribers][0]
  const completions=[player.play('a'),player.play('b')]
  player.setThunder('thunder');player.thunder(1)
  const late=[...timers.values()]
  nodes[0].fail=true
  assert.throws(()=>player.dispose(),/Stage sound cleanup failed/)
  await Promise.all(completions)
  assert.equal(timers.size,0)
  assert.equal(subscribers.size,0)
  for(const node of nodes) {assert.equal(node.paused,true);assert.equal(node.src,'');assert.equal(node.events.size,0)}
  late.forEach(fn=>fn());lateNotify();off();player.dispose()
  await player.play('late')
  assert.equal(nodes.length,2)
  assert.equal(notifications,0)
})
test('token cancellation releases only its sound and concurrency remains capped at six', async () => {
  const {player,nodes} = setup()
  const first=player.play('first',null,null,'first')
  const second=player.play('second',null,null,'second')
  player.stopToken('first');await first
  assert.equal(nodes[0].released,true)
  assert.equal(nodes[1].released,undefined)
  const pending=Array.from({length:7},()=>player.play('next'))
  assert.equal(nodes.length,7)
  player.dispose()
  await Promise.all([second,...pending])
})
