import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {installClipClock} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-clock.js'
import {installClipTime} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-time.js'

test('isolated mixer captures authored gain, fades and buffer endings on virtual rather than wall time',async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage();await page.route('https://clip-export.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}))
  await page.goto('https://clip-export.invalid');await page.evaluate(installClipTime,{epoch:100000});await page.evaluate(installClipClock)
  await page.evaluate(()=>{
    const context=new AudioContext(),source=context.createBufferSource(),gain=context.createGain(),fade=context.createGain()
    source.buffer=context.createBuffer(1,48000,48000);source.connect(gain);gain.connect(fade);fade.connect(context.destination)
    gain.clipMusic={url:'cached-music'};gain.gain.value=0.5
    fade.gain.setValueAtTime(0,context.currentTime);fade.gain.linearRampToValueAtTime(1,context.currentTime+1)
    source.start();window.source=source
  })
  await page.evaluate(()=>clipAdvance(500))
  assert.ok(Math.abs(await page.evaluate(()=>clipGraphGain(source))-0.25)<0.001)
  await page.evaluate(()=>{clipFrame=15;clipTickMedia()})
  assert.equal(await page.evaluate(()=>clipAudioEvents.filter(row=>row.kind==='stop').length),0)
  await page.evaluate(()=>clipAdvance(501));await page.evaluate(()=>{clipFrame=30;clipTickMedia()})
  assert.equal(await page.evaluate(()=>clipAudioEvents.filter(row=>row.kind==='stop').length),1)
})

test('export clock dispatches every timer, interval, animation frame and async commit without wall-clock waits',async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage();await page.evaluate(installClipTime,{epoch:100000,fps:30})
  const result=await page.evaluate(async()=>{
    const events=[]
    const interval=setInterval(()=>events.push(['interval',performance.now()]),10)
    setTimeout(async()=>{events.push(['timeout',performance.now()]);await Promise.resolve();setTimeout(()=>events.push(['nested',performance.now()]),1)},5)
    requestAnimationFrame(()=>events.push(['raf',performance.now()]))
    await clipAdvance(35);clearInterval(interval)
    return {events,date:Date.now(),construct:+new Date(),now:performance.now()}
  })
  assert.deepEqual(result,{events:[['timeout',1005],['nested',1006],['interval',1010],['interval',1020],['interval',1030],['raf',1033]],date:101035,construct:101035,now:1035})
})

test('animation cadence matches every rounded output frame without skipping independent timers',async t=>{
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  for(const fps of [12,30,60]){
    const page=await browser.newPage();await page.evaluate(installClipTime,{epoch:100000,fps})
    const result=await page.evaluate(async fps=>{
      let frames=0,timers=0
      const animate=()=>{frames++;requestAnimationFrame(animate)}
      requestAnimationFrame(animate);setInterval(()=>timers++,10)
      const counts=[]
      for(let i=1;i<=fps;i++){await clipAdvance(Math.round(i*1000/fps)-(performance.now()-1000));counts.push(frames)}
      return {counts,timers}
    },fps)
    assert.deepEqual(result,{counts:Array.from({length:fps},(_,i)=>i+1),timers:100})
    await page.close()
  }
})