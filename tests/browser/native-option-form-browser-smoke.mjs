import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const source = await readFile('tavern-plugin/lib/client.js', 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route(/^https?:/, route => route.abort())
  await page.setContent('<div id="draft"></div><div id="mount"></div><script>window.__ModuleLoader__={load(value){window.client=value.factory(()=>({}))}}</script>')
  await page.addScriptTag({ content: source })
  await page.evaluate(() => {
    window.calls = []
    window.submitEvents = 0
    window.submitDefaultPrevented = false
    const content = '<div id="top">顶部渲染</div><form id="options"><button id="choose">尾部选项</button></form>'
    const life = client.createTavernMessageFrameLifecycle({
      sessionId: 'story', content, turn: 2, trustedCardMode: true, runtimeReporting: false,
      executeSlash(line, sessionId) {
        calls.push({ line, sessionId })
        document.querySelector('#draft').textContent = line
        return Promise.resolve({ drafted: true })
      }
    }, { window, rpc: async () => ({}) })
    window.stop = life.start(() => {})
    const doc = life.snapshot().visibleDocument
    const frame = document.createElement('iframe')
    frame.id = 'tail'
    frame.srcdoc = doc.html
    document.querySelector('#mount').append(frame)
    doc.ref(frame)
    window.frame = frame
  })
  const frame = page.frames().find(item => item !== page.mainFrame())
  await frame.waitForSelector('#choose')
  await page.evaluate(() => { window.initialDocument = frame.contentDocument })
  await frame.evaluate(() => {
    document.addEventListener('submit', event => {
      parent.submitEvents++
      parent.submitDefaultPrevented = event.defaultPrevented
    })
    document.querySelector('#choose').addEventListener('click', () => {
      const area = parent.document.querySelector('#send_textarea')
      area.focus()
      area.value = '尾部选项文字'
      area.dispatchEvent(new parent.Event('input', { bubbles: true }))
      area.dispatchEvent(new parent.Event('change', { bubbles: true }))
    })
  })
  await frame.click('#choose')
  await page.waitForTimeout(400)
  const result = await page.evaluate(() => ({
    calls,
    submitEvents,
    submitDefaultPrevented,
    sameDocument: initialDocument === frame.contentDocument,
    choiceCount: frame.contentDocument.querySelectorAll('#choose').length,
    frameUrl: frame.contentWindow.location.href
  }))
  assert.deepEqual(result.calls, [{ line: '/setinput 尾部选项文字', sessionId: 'story' }])
  assert.equal(result.submitEvents, 1, '卡片的 submit 监听器仍应收到事件')
  assert.equal(result.submitDefaultPrevented, true, '本地 srcdoc 表单不得执行默认导航')
  assert.equal(result.sameDocument, true, '选项点击不得替换尾部 contentDocument')
  assert.equal(result.frameUrl, 'about:srcdoc', '不得导航到 about:srcdoc?')
  assert.equal(result.choiceCount, 1, '尾部选项点击后仍应保留')
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
