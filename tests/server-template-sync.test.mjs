import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {createServerTemplateSync} from '../tavern-plugin/lib/domain/server-template-sync.js'

test('deferred settlement work retries, disposal cancels pending timers',async()=>{
 let runs=0
 const sync=createServerTemplateSync({delayMs:1,run:async()=>({deferred:++runs===1})})
 sync.schedule('s',1);await delay(20);assert.equal(runs,2)
 sync.schedule('s',2);sync.dispose();await delay(10);assert.equal(runs,2)
})

test('entering settlement cancels a pending retry and blocks a running callback from rearming', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runs = 0, release
  const sync = createServerTemplateSync({ run: () => { runs++; return new Promise(resolve => { release = resolve }) } })
  t.after(() => sync.dispose())
  sync.schedule('s', 1)
  t.mock.timers.tick(250)
  sync.schedule('s', 2, { blocked: true })
  release({ deferred: true }); await Promise.resolve()
  for (let i = 0; i < 40; i++) { t.mock.timers.tick(250); await Promise.resolve() }
  assert.equal(runs, 1)
  sync.schedule('s', 3)
  t.mock.timers.tick(250)
  release({ deferred: true }); await Promise.resolve()
  sync.schedule('s', 4, { blocked: true })
  t.mock.timers.tick(5000); await Promise.resolve()
  assert.equal(runs, 2)
  sync.schedule('s', 4, { blocked: false })
  t.mock.timers.tick(250)
  assert.equal(runs, 3, 'unblocking the same revision still wakes work')
  release({}); await Promise.resolve()
})
