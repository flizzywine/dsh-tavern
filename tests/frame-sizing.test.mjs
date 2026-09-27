import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { chromium } from 'playwright'

const moduleSource = await readFile(new URL('../tavern-plugin/src/client/modules/frame-sizing.js', import.meta.url), 'utf8')
const domainSource = (await readFile(new URL('../tavern-plugin/lib/domain/frame-sizing.js', import.meta.url), 'utf8')).replace(/export \{[^}]+\}/, '')
const sizing = vm.runInNewContext(domainSource + moduleSource + ';({parse:tavernFrameSizing,height:tavernFrameSizingHeight})')
test('explicit sizing validates numeric declarations and leaves absent/invalid cards on the legacy path', () => {
  for (const value of ['', '<meta name="dsh-tavern-frame" content="other">', '<meta name="dsh-tavern-frame" content="fixed">', '<meta name="dsh-tavern-frame" content="fixed" data-height="calc(100vh)">', '<meta name="dsh-tavern-frame" content="viewport" data-min-height="900" data-max-height="100">', '<script>const example=\'<meta name="dsh-tavern-frame" content="viewport">\'</script>']) assert.equal(sizing.parse(value), null)
  const fixed = sizing.parse('<META name="dsh-tavern-frame" content="fixed" data-aspect-ratio="2" data-max-height="900">')
  assert.equal(sizing.height(fixed, 800, 700), 400)
  assert.equal(sizing.height(fixed, 800, 250), 250)
  assert.equal(sizing.height({ mode: 'viewport', minHeight: 500, maxHeight: 900 }, 800, 250), 250, 'available area wins over requested minimum')
})

test('real iframe sizing: constrained viewport, percentage roots, capped content, resizing and retained input', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } })
    await page.route('**/*', route => route.abort())
    await page.setContent('<style>body{margin:0}#host{height:calc(100dvh - 100px);margin-top:50px;width:600px;overflow:auto}#other{height:350px;width:300px;overflow:auto}iframe{border:0;display:block;width:100%}</style><main id="host"></main><aside id="other"></aside>')
    const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
    await page.evaluate(source => {
      window.__ModuleLoader__ = { load(d) { window.client = d.factory(() => ({})) } }; window.eval(source)
      window.mount = function (content, frameSizing) {
        window.stop?.(); window.descriptor?.ref(null); document.querySelectorAll('iframe').forEach(x => x.remove())
        window.reports = []; window.captures = []
        window.life = client.createTavernMessageFrameLifecycle({ content, frameSizing, sessionId: 'test', turn: 1, partIndex: 0 }, { rpc: async (name, data) => { captures.push(data); return {} } })
        window.descriptor = life.snapshot().visibleDocument
        window.frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts'); frame.style.height = '48px'
        window.stop = life.start(state => { reports.push(state.height); frame.style.height = state.height + 'px' })
        frame.srcdoc = descriptor.html; document.querySelector('#host').append(frame); descriptor.ref(frame)
      }
    }, source)
    await page.evaluate(() => mount('<meta name="dsh-tavern-frame" content="viewport"><style>#app{height:100%;overflow:auto}</style><div id="app"><input value="start"><div style="height:1800px">long app</div></div>'))
    await page.waitForFunction(() => frame.clientHeight === 700)
    await page.evaluate(() => { frame.style.height = '49px' })
    await page.waitForFunction(() => frame.clientHeight === 700)
    let child = page.frames()[1]
    await child.locator('input').fill('keep me')
    assert.equal(await child.locator('#app').evaluate(x => x.clientHeight), 700)
    await child.locator('#app').evaluate(x => { x.scrollTop = 500 })
    assert.equal(await child.locator('#app').evaluate(x => x.scrollTop), 500)
    await page.setViewportSize({ width: 400, height: 550 })
    await page.waitForFunction(() => frame.clientHeight === 450)
    assert.equal(await child.locator('input').inputValue(), 'keep me')
    // Parent moves the existing DOM with the production moveBefore mechanism.
    await page.evaluate(() => { document.querySelector('#other').style.marginTop = '-350px'; document.querySelector('#other').moveBefore(frame, null) })
    await page.waitForFunction(() => frame.clientHeight === 350)
    assert.equal(await child.locator('input').inputValue(), 'keep me')
    // Spoofed and authenticated legacy height reports cannot override explicit sizing.
    await page.evaluate(() => window.postMessage({ type: 'dsh-tavern-frame-height', token: descriptor.token, height: 2000 }, '*'))
    await child.evaluate(() => parent.postMessage({ type: 'dsh-tavern-frame-height', token: 'wrong', height: 2000 }, '*'))
    await page.waitForTimeout(300)
    assert.equal(await page.locator('iframe').evaluate(x => x.clientHeight), 350)
    await page.waitForFunction(() => captures.some(x => x.runtime?.layout?.mode === 'viewport'))
    const layout = await page.evaluate(() => captures.at(-1).runtime.layout)
    assert.equal(layout.source, 'template'); assert.equal(layout.roots.length, 3)
    await page.evaluate(() => { document.querySelector('#other').style.marginTop = ''; mount('<meta name="dsh-tavern-frame" content="fixed" data-aspect-ratio="2"><input value="ratio">') })
    await page.waitForFunction(() => frame.clientHeight === 300)
    await page.evaluate(() => { document.querySelector('#host').style.width = '320px' })
    await page.waitForFunction(() => frame.clientHeight === 160)
    await page.evaluate(() => mount('<div id="long" style="height:2500px">long document</div>', { default: { mode: 'content' } }))
    await page.waitForFunction(() => frame.clientHeight === 2500)
    child = page.frames()[1]
    assert.equal(await child.evaluate(() => document.documentElement.hasAttribute('data-dsh-tavern-sizing-scroll')), false)
    await child.locator('#long').evaluate(x => { x.style.height = '4000px' })
    await page.waitForFunction(() => frame.clientHeight === 4000)
    assert.equal(await page.evaluate(() => {
      const token = descriptor.token
      life.update({ content: descriptor.content, sessionId: 'test', turn: 1, partIndex: 0,
        frameSizing: { default: { mode: 'content' }, panels: { unrelated: { mode: 'viewport' } } } })
      return life.snapshot().visibleDocument.token === token && life.snapshot().pendingDocument === null
    }), true, 'unrelated panel settings do not reload a running frame')
    await page.evaluate(() => mount('<meta name="dsh-tavern-frame" content="content" data-max-height="240"><div id="long" style="height:1500px">long document</div>'))
    await page.waitForFunction(() => frame.clientHeight === 240)
    child = page.frames()[1]
    await child.waitForFunction(() => document.documentElement.hasAttribute('data-dsh-tavern-sizing-scroll'))
    await child.evaluate(() => scrollTo(0, 800))
    assert.ok(await child.evaluate(() => scrollY) > 0)
    await child.locator('#long').evaluate(x => { x.style.height = '100px' })
    await page.waitForFunction(() => frame.clientHeight === 100)
    await child.waitForFunction(() => !document.documentElement.hasAttribute('data-dsh-tavern-sizing-scroll'))
    const count = await page.evaluate(() => reports.length)
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => reports.length), count, 'height settles without feedback')
    await page.evaluate(() => { stop(); descriptor.ref(null) })
  } finally { await browser.close() }
})

test('card defaults and stable panel overrides survive card export and preview projection', async () => {
  const { createCardPreparation } = await import('../tavern-plugin/lib/domain/card-preparation.js')
  const { projectCardOpeningPreviews } = await import('../tavern-plugin/lib/domain/card-opening-previews.js')
  const cards = createCardPreparation({ id: () => 'sizing', now: () => 1 })
  const data = { name: 'layout', first_mes: '<div>app</div>', extensions: { dsh_tavern: { keep: true,
    frameSizing: { default: { mode: 'viewport' }, panels: { status: { mode: 'content', maxHeight: 500 } } } } } }
  const imported = cards.create({ kind: 'import', payload: { kind: 'text', text: JSON.stringify({ spec: 'chara_card_v3', data }) } })
  const exported = cards.present({ card: imported, as: 'sillytavern-v3' })
  assert.deepEqual(exported.data.extensions, data.extensions)
  const extensions = cards.present({ card: imported, as: 'card-extensions' })
  assert.equal(sizing.parse('', extensions.frameSizing).mode, 'viewport')
  assert.equal(sizing.parse('<meta name="dsh-tavern-frame" data-panel-id="status">', extensions.frameSizing).mode, 'content')
  assert.equal(sizing.parse('', extensions.frameSizing, 'status').source, 'panel')
  assert.equal(sizing.parse('<meta name="dsh-tavern-frame" content="fixed" data-height="300">', extensions.frameSizing, 'status').height, 300)
  const preview = await projectCardOpeningPreviews({ card: exported.data, extensions })
  assert.deepEqual(preview.openings[0].frameSizing, extensions.frameSizing)
})
