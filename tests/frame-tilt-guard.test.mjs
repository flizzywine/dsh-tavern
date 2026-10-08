import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { assembleTavernClient } from '../bin/build-tavern-client.mjs'

let descriptor
vm.runInNewContext(await assembleTavernClient(), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
const client = descriptor.factory(() => ({}))
const html = client.buildTavernFrameDocument({ token: 'tilt', content: '', runtimeReporting: false })
const guard = html.match(/<script data-dsh-tavern-tilt-guard>([\s\S]*?)<\/script>/)?.[1]

test('鼠标移动时的小角度 3D 倾斜在绘制前还原，其他 transform 照常生效', async t => {
  assert.ok(guard, 'frame document installs the tilt guard')
  const dom = new JSDOM('<!doctype html><html><body><div id="card"></div></body></html>', { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  dom.window.eval(guard)
  const card = dom.window.document.getElementById('card')
  const move = () => dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove'))
  const write = async value => { card.style.transform = value; await Promise.resolve(); return card.style.transform }

  assert.equal(await write('rotateY(10deg)'), 'rotateY(10deg)', 'no pointer movement: kept')

  move()
  assert.equal(await write('perspective(1000px) rotateX(-4.2deg) rotateY(7deg)'), 'rotateY(10deg)', 'tilt reverted to the previous transform')
  card.style.transform = 'translateX(4px)'
  card.style.transform = 'rotateY(3deg)'
  card.style.transform = 'rotateY(5deg)'
  await Promise.resolve()
  assert.equal(card.style.transform, 'translateX(4px)', 'batched tilts revert to the last non-tilt value')

  assert.equal(await write('rotateY(180deg)'), 'rotateY(180deg)', 'flip kept')
  assert.match(await write('perspective(1000px) rotateX(0deg) rotateY(0deg)'), /rotateX\(0deg\)/, 'reset kept')
})
