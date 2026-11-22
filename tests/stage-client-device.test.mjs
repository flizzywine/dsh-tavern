import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageDevice} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/device.cjs')
test('device disposal removes all listeners despite errors and ignores queued events', () => {
  let changes=0
  const lists=[]
  const device=createStageDevice({matchMedia:()=>{
    const row={addEventListener(_,fn){this.fn=fn},removeEventListener(){this.removed=true;if(lists[0]===this)throw new Error('remove failed')}}
    lists.push(row);return row
  }})
  const off=device.subscribe(()=>changes++)
  lists[0].fn()
  assert.equal(changes,1)
  assert.throws(()=>device.dispose(),/Stage device cleanup failed/)
  assert.ok(lists.every(row=>row.removed))
  lists.forEach(row=>row.fn())
  off();device.dispose();device.subscribe(()=>changes++)
  assert.equal(changes,1)
  // one media query list per profile query (mobile-landscape, mobile-portrait, tablet), none re-subscribed after disposal
  assert.equal(lists.length,3)
})

// 画质 auto: a desktop is high; a phone or tablet medium, saver when it reports little power or speed.
test('quality recommendation follows the device signals', () => {
  const {recommend} = createStageDevice({matchMedia: () => ({matches: false})})
  assert.deepEqual(recommend({portable: false, cores: 2, battery: {charging: false, level: 0.05}}), {tier: 'high', reason: 'desktop'})
  assert.deepEqual(recommend({portable: true, cores: 6, memory: 0}), {tier: 'medium', reason: 'portable'})
  assert.equal(recommend({portable: true, cores: 2}).reason, 'cores')
  assert.equal(recommend({portable: true, cores: 4}).tier, 'medium')
  assert.equal(recommend({portable: true, memory: 2}).reason, 'memory')
  assert.equal(recommend({portable: true, battery: {charging: false, level: 0.15}}).reason, 'battery')
  assert.equal(recommend({portable: true, battery: {charging: true, level: 0.15}}).tier, 'medium')
  assert.equal(recommend({portable: true, saveData: true}).reason, 'save-data')
  // iOS Low Power Mode holds animation frames at 30 Hz.
  assert.equal(recommend({portable: true, frameMs: 33.3}).reason, 'frames')
  assert.equal(recommend({portable: true, frameMs: 16.7}).tier, 'medium')
})

test('quality resolves auto on the device, a chosen tier wins, and the frame probe can lower it', async () => {
  const media = coarse => query => ({matches: coarse && query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {}})
  const store = value => { const fns = new Set(); return {get: () => value, set: v => { value = v; fns.forEach(fn => fn()) }, subscribe: fn => { fns.add(fn); return () => fns.delete(fn) }} }
  let frames = [], timer = null, clock = 0
  const host = nav => ({navigator: nav, performance: {now: () => clock}, setTimeout: fn => { timer = fn; return 1 }, clearTimeout() {}, requestAnimationFrame: fn => frames.push(fn)})
  // A desktop stays high, a laptop's touch screen too (fine primary pointer).
  assert.equal(createStageDevice({matchMedia: media(false), window: host({maxTouchPoints: 10, userAgent: 'Windows'})}).quality(store('auto')).get(), 'high')
  // iPadOS Safari: a Mac user agent with touch points.
  assert.equal(createStageDevice({matchMedia: media(false), window: host({maxTouchPoints: 5, userAgent: 'Macintosh'})}).quality(store('auto')).get(), 'medium')
  const setting = store('auto'), device = createStageDevice({matchMedia: media(true), window: host({hardwareConcurrency: 6})}), quality = device.quality(setting)
  let notified = 0
  quality.subscribe(() => notified++)
  assert.equal(quality.get(), 'medium')
  assert.equal(quality.setting(), 'auto')
  // The probe: 3 s of frames at 30 Hz (a Low Power Mode phone) lower auto to saver and notify.
  timer()
  while (frames.length) { const step = frames.shift(); clock += 33.4; step(clock) }
  assert.equal(quality.get(), 'saver')
  assert.equal(quality.recommendation().reason, 'frames')
  assert.ok(notified >= 1)
  // A chosen tier wins over the recommendation.
  setting.set('high')
  assert.equal(quality.get(), 'high')
  device.dispose()
})