import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const source = await readFile('tavern-plugin/lib/client.js', 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route(/^https?:/, route => route.abort())
  await page.setContent('<div id="home"></div><script>window.__ModuleLoader__={load(value){window.client=value.factory(()=>({}))}}</script>')
  await page.addScriptTag({ content: source })
  await page.evaluate(() => {
    window.calls = []
    window.generated = 0
    window.SillyTavern = { getContext() { return { generate() { generated++ } } } }
    // The real Cat Oracle tail runs inline, fills the native composer, generates,
    // then calls removeOwnIframe(). Keep that exact ownership path, with only the
    // story text replaced by a small fixture.
    const content = `<div id="top">顶部渲染</div><div id="options"><button id="choose" type="button">尾部选项</button></div>
<script>(() => {
  function removeOwnIframe() {
    const frames = window.parent?.document?.querySelectorAll('iframe') || []
    for (const frame of frames) {
      if (frame.contentWindow === window) { frame.remove(); break }
    }
  }
  document.querySelector('#choose').addEventListener('click', () => {
    const parentDocument = window.parent.document
    const textarea = parentDocument.getElementById('send_textarea')
    const text = '尾部选项文字'
    const valueSetter = Object.getOwnPropertyDescriptor(window.parent.HTMLTextAreaElement.prototype, 'value')?.set
    if (valueSetter) valueSetter.call(textarea, text)
    else textarea.value = text
    textarea.dispatchEvent(new window.parent.Event('input', { bubbles: true }))
    textarea.dispatchEvent(new window.parent.Event('change', { bubbles: true }))
    textarea.focus()
    textarea.setSelectionRange(text.length, text.length)
    window.top.SillyTavern.getContext().generate()
    removeOwnIframe()
  })
})()</script>`
    const props = {
      sessionId: 'story', content, turn: 2, partIndex: 3, trustedCardMode: true,
      runtimeReporting: false,
      executeSlash(line, sessionId) {
        calls.push({ line, sessionId })
        return Promise.resolve({ drafted: true })
      }
    }
    const retention = {
      onLeave() {}, hold() { return () => {} }, mount() { return () => {} }, onSelect() { return () => {} }
    }
    const frames = client.createRetainedTavernFrames({
      window, retention,
      createLifecycle(input) {
        return client.createTavernMessageFrameLifecycle(input, { window, rpc: async () => ({}) })
      }
    })
    window.retained = frames
    window.lease = frames.mount(props, document.querySelector('#home'))
    window.frame = document.querySelector('#home iframe')
  })
  const frame = page.frames().find(item => item !== page.mainFrame())
  await frame.waitForSelector('#choose')
  await page.evaluate(() => { window.initialDocument = frame.contentDocument })
  await frame.click('#choose')
  await page.waitForTimeout(400)
  const result = await page.evaluate(() => ({
    calls,
    generated,
    connected: frame.isConnected,
    sameDocument: initialDocument === frame.contentDocument,
    choiceCount: frame.contentDocument?.querySelectorAll('#choose').length || 0
  }))
  assert.deepEqual(result.calls, [{ line: '/setinput 尾部选项文字', sessionId: 'story' }])
  assert.equal(result.generated, 1, '保留尾部渲染不得吞掉直接发送')
  assert.equal(result.connected, true, '卡片发送后的 removeOwnIframe 不得删除故事尾部')
  assert.equal(result.sameDocument, true, '保留渲染必须复用原 contentDocument，而非重新创建 iframe')
  assert.equal(result.choiceCount, 1, '尾部选项点击后仍应保留')
  const remainingAfterClear = await page.evaluate(() => {
    lease.detach()
    retained.clear()
    return document.querySelectorAll('iframe').length
  })
  assert.equal(remainingAfterClear, 0, 'Tavern 自己清理保留容器时仍应移除 iframe')
  console.log(JSON.stringify({ ...result, remainingAfterClear }))
} finally {
  await browser.close()
}
