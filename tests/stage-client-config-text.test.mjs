import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageConfigText}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/config-text.cjs')
test('text-size changes preserve other skins and stop writing after disposal',()=>{
  const writes=[]
  const view=createStageConfigText({React:{},fields:{},reading:{get:()=>({textScale:{other:90}}),set:patch=>writes.push(patch)}})
  view.setScale('classic',110)
  assert.deepEqual(writes,[{textScale:{other:90,classic:110}}])
  view.dispose();view.setScale('classic',100)
  assert.equal(writes.length,1)
})
for(const stop of ['unmount','dispose'])test(`preview loop cannot update after ${stop}`,()=>{
  const effects=[],writes=[],timers=new Map()
  let stateIndex=0
  const view=createStageConfigText({fields:{},React:{useState:value=>[stateIndex++===1?true:value,next=>writes.push(next)],useEffect:fn=>effects.push(fn),createElement:()=>null},
    clock:{setTimeout:fn=>{timers.set(1,fn);return 1},clearTimeout:id=>timers.delete(id)},autoDelay:()=>1000,
  })
  view.Preview({reading:{textSpeed:20,autoWait:700,autoSpeed:1.3}})
  const releases=effects.map(fn=>fn()),late=timers.get(1)
  if(stop==='unmount')releases.forEach(fn=>fn?.());else view.dispose()
  const count=writes.length
  late()
  assert.equal(writes.length,count);assert.equal(timers.size,0)
  releases.forEach(fn=>fn?.());view.dispose()
})
