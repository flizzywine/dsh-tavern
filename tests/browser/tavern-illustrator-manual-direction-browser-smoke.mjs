// Run explicitly: node tests/browser/tavern-illustrator-manual-direction-browser-smoke.mjs
// Mounts the real host action with React in Chrome, plus the real illustrator request wrapper.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'acorn'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const hostSource = await readFile(new URL('../../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
const extensionsSource = await readFile(new URL('../../tavern-plugin/src/client/features/plugin-extensions.js', import.meta.url), 'utf8')
const imageClientSource = await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')
const revealSource = await readFile(new URL('../../tavern-plugin/src/client/modules/reply-reveal.js', import.meta.url), 'utf8')
const tavernCss = await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

function declaration(source, name) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  let found
  function visit(node) {
    if (!node || found) return
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) { found = node; return }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
    }
  }
  visit(ast)
  if (!found) throw new Error(`Missing source function ${name}`)
  return source.slice(found.start, found.end)
}

const action = declaration(hostSource, 'TavernPluginIllustrateAction')
const icon = declaration(hostSource, 'TavernIllustrateIcon')
const run = declaration(extensionsSource, 'watchTavernIllustrationStart') + '\n' + declaration(extensionsSource, 'runTavernIllustrator')
// the gestures and tooltip the chat button shares with the stage's 场景生图 entry
const press = declaration(extensionsSource, 'useTavernIllustratePress')
const title = extensionsSource.match(/const TAVERN_ILLUSTRATE_TITLE = [^\n]*/)[0]
const drawRunner = declaration(imageClientSource, 'createMessageDrawRunner')
const scroller = declaration(revealSource, 'tavernReplyRevealScroller')
const chromeCandidates = [process.env.CHROME_PATH]
if (process.platform === 'win32') chromeCandidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
const chromePath = chromeCandidates.find(candidate => candidate && existsSync(candidate)) || chromium.executablePath()
if (!existsSync(chromePath)) throw new Error('Chrome/Chromium not found; install Playwright Chromium or set CHROME_PATH')
const browser = await chromium.launch({ headless: true, executablePath: chromePath })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  async function assertInlineState(expected, message) {
    const textbox = page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' })
    await textbox.waitFor({ state: expected ? 'visible' : 'hidden' })
    assert.equal(await textbox.count(), expected ? 1 : 0, message)
  }
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><style>' + tavernCss + '</style><style>' + [
    'html,body{height:100%;margin:0;font:14px sans-serif;overflow:hidden}',
    'main{height:100%;width:min(760px,calc(100vw - 24px));margin:0 auto;display:flex;flex-direction:column}',
    '#scrollport{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}',
    '[data-turn-tail]{position:relative;display:block;padding:16px}',
    '.xD_KDq_actions{height:28px;align-items:center;gap:8px;display:flex;overflow:visible}',
    '[data-slot="conversation.chat.assistant-actions"]{display:flex;gap:8px;min-height:28px}',
    '.dsh-tavern-message-fork{width:32px;height:32px}',
    '[data-slot="conversation.chat.assistant-actions"]{width:100%;box-sizing:border-box}',
    '.xD_KDq_actions{width:100%;box-sizing:border-box}',
    '#host-composer{flex:none;height:64px;position:sticky;bottom:0;display:flex;align-items:center;background:#ddd;padding:8px;box-sizing:border-box}',
    '.dsh-tavern-illustration-instructions textarea{min-height:76px}'
  ].join('\n') + '</style><body class="dsh-tavern-shell-active"><main><div id="scrollport"><article data-turn-tail="6"><div style="height:1600px">较早轮次</div></article><article data-turn-tail="7"><div class="dsh-tavern-assistant">最新一轮正文。末轮正文在独立 assistant-step flowItem 内。</div><div class="xD_KDq_actions"><div data-slot="conversation.chat.assistant-actions" id="app"></div><button type="button" aria-label="复制正文">复制</button></div></article></div><div id="host-composer">固定输入栏</div></main></body>')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: [
    'const React=modules.react; const h=React.createElement;',
    'const DshUi={Tooltip:({children})=>children};',
    'const drafts=new Map(); const tavernIllustrationDrafts={set:(g,t,v)=>{const k=g+":"+t;if(v)drafts.set(k,v);else drafts.delete(k);},get:(g,t)=>drafts.get(g+":"+t)||null};',
    'const TAVERN_ILLUSTRATION_NOTICE_MS=8000;',
    // the turn never gains a picture here, so a request form closes only when draw settles
    'const rpc=async()=>({items:[]}); const tavernPluginMediaIndex={subscribe:()=>()=>{},has:()=>false};',
    drawRunner,
    'const calls=[]; let failNext=false, delayNext=false, finishDelayed=null;',
    'const illustrator={draw:async context=>{calls.push({...context});if(failNext){failNext=false;throw new Error("network unavailable")}if(delayNext){delayNext=false;return new Promise(resolve=>{finishDelayed=()=>resolve({})})}return {};}};',
    'window.__calls=calls;window.__fail=()=>{failNext=true};window.__delay=()=>{delayNext=true};window.__finish=()=>finishDelayed?.();',
    'window.__run=(...args)=>runTavernIllustrator(illustrator,...args);',
    run, title, press, icon, action, scroller,
    'const root=modules["react-dom/client"].createRoot(document.querySelector("#app"));',
    'window.__render=(gameId="game-A",turn=7,status="settled")=>{document.querySelector("[data-turn-tail=\\\"7\\\"]").dataset.streaming=String(status==="streaming");root.render(h(TavernPluginIllustrateAction,{key:gameId+":"+turn,sessionId:gameId,turn,illustrator,status}));};',
    'window.__unmount=()=>root.unmount();',
    'window.__render();'
  ].join('\n') })

  await assert.rejects(page.evaluate(() => window.__run('game-A', 6, 'x'.repeat(2001))), /不能超过 2000 字/)
  await assert.rejects(page.evaluate(() => window.__run('game-A', 6, {})), /必须是文本/)
  assert.equal(await page.evaluate(() => window.__calls.length), 0, 'invalid requirements fail before any draw request')
  const dedupe = await page.evaluate(async () => {
    const contexts = [], releases = []
    const draw = createMessageDrawRunner(context => { contexts.push({ ...context }); return new Promise(resolve => releases.push(resolve)) })
    const first = draw({ gameId: 'game-D', turn: 3, instruction: '近景' })
    const duplicate = draw({ gameId: 'game-D', turn: 3, instruction: '近景' })
    const distinct = draw({ gameId: 'game-D', turn: 3, instruction: '俯拍' })
    await Promise.resolve()
    releases.forEach(resolve => resolve({ ok: true }))
    await Promise.all([first, duplicate, distinct])
    return contexts
  })
  assert.deepEqual(dedupe, [
    { gameId: 'game-D', turn: 3, instruction: '近景' },
    { gameId: 'game-D', turn: 3, instruction: '俯拍' }
  ], 'same instruction dedupes while a different instruction stays a distinct request')

  const button = page.getByRole('button', { name: '为这一轮配图' })
  assert.equal(await button.evaluate(el => el.parentElement?.matches('[data-slot="conversation.chat.assistant-actions"]')), true, 'action button remains a direct slot child')
  assert.equal(await button.isVisible(), true, 'real host CSS keeps the fork action visible')
  await button.click()
  await page.waitForFunction(() => window.__calls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.__calls[0]), { gameId: 'game-A', turn: 7 }, 'ordinary click keeps the original context')

  await page.evaluate(() => window.__render('game-A', 8, 'streaming'))
  await page.evaluate(() => { const scrollport = document.querySelector('#scrollport'); scrollport.scrollTop = scrollport.scrollHeight })
  const startAtLatest = await page.evaluate(() => {
    const scrollport = document.querySelector('#scrollport'), latest = document.querySelector('[data-turn-tail="7"]')
    const tail = latest.getBoundingClientRect(), viewport = scrollport.getBoundingClientRect()
    return { articles: document.querySelectorAll('[data-turn-tail]').length, actionsHeight: latest.querySelector('.xD_KDq_actions').getBoundingClientRect().height,
      atBottom: scrollport.scrollTop + scrollport.clientHeight >= scrollport.scrollHeight - 1,
      tailBottom: tail.bottom, scrollBottom: viewport.bottom }
  })
  assert.equal(startAtLatest.articles, 2, 'fixture keeps a constant message count')
  assert.equal(startAtLatest.actionsHeight, 28, 'native action row starts at its fixed 28px host height')
  assert.equal(startAtLatest.atBottom, true, 'the latest turn starts at the end of the chat scrollport')
  assert.ok(Math.abs(startAtLatest.tailBottom - startAtLatest.scrollBottom) < 2, 'latest tail starts against the composer edge')
  const articleCountBeforeOpen = startAtLatest.articles
  const longPressButton = page.getByRole('button', { name: '为这一轮配图' })
  await longPressButton.hover()
  await page.mouse.down()
  await page.waitForTimeout(620)
  const instruction = page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' })
  await instruction.waitFor({ state: 'visible' })
  await page.evaluate(() => window.__render('game-A', 8, 'settled'))
  await assertInlineState(true, 'same-turn streaming-to-settled rerender keeps the open inline form')
  await page.waitForFunction(() => {
    const section = document.querySelector('.dsh-tavern-illustration-instructions')
    if (!section) return false
    const actions = section.parentElement.parentElement
    const scrollport = document.querySelector('#scrollport')
    const buttons = [...section.querySelectorAll('button')]
    return actions.getBoundingClientRect().height >= section.getBoundingClientRect().height
      && buttons.length === 2
      && buttons.every(button => { const rect = button.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button })
      && scrollport.scrollTop > 0
  })
  const inlineEvidence = await page.locator('.dsh-tavern-illustration-instructions').evaluate(section => {
    const rect = section.getBoundingClientRect(), slot = section.parentElement, actions = slot.parentElement
    const button = slot.querySelector('.dsh-tavern-message-illustrate'), buttonRect = button.getBoundingClientRect()
    const input = section.querySelector('textarea'), inputRect = input.getBoundingClientRect()
    const submit = section.querySelector('button[type="submit"]'), cancel = section.querySelector('button[type="button"]')
    const scrollport = document.querySelector('#scrollport'), composer = document.querySelector('#host-composer')
    return { directSlotChild: slot.matches('[data-slot="conversation.chat.assistant-actions"]'),
      display: getComputedStyle(section).display, actionHeight: actions.getBoundingClientRect().height, alignItems: getComputedStyle(actions).alignItems,
      actionCssHeight: getComputedStyle(actions).height, actionScrollHeight: actions.scrollHeight,
      sectionHeight: rect.height, scrollHeight: scrollport.scrollHeight, clientHeight: scrollport.clientHeight,
      scrollTop: scrollport.scrollTop, pageScrollY: scrollY, composerTop: composer.getBoundingClientRect().top,
      rect: rect.toJSON(), buttonRect: buttonRect.toJSON(), inputRect: inputRect.toJSON(),
      submitRect: submit.getBoundingClientRect().toJSON(), cancelRect: cancel.getBoundingClientRect().toJSON(),
      topLayerHit: document.elementFromPoint(inputRect.x + inputRect.width / 2, inputRect.y + inputRect.height / 2)?.tagName,
      submitHit: document.elementFromPoint(submit.getBoundingClientRect().x + submit.getBoundingClientRect().width / 2, submit.getBoundingClientRect().y + submit.getBoundingClientRect().height / 2) === submit,
      cancelHit: document.elementFromPoint(cancel.getBoundingClientRect().x + cancel.getBoundingClientRect().width / 2, cancel.getBoundingClientRect().y + cancel.getBoundingClientRect().height / 2) === cancel,
      articleCount: document.querySelectorAll('[data-turn-tail]').length }
  })
  assert.equal(inlineEvidence.directSlotChild, true, 'inline form remains in the assistant action slot')
  assert.equal(inlineEvidence.display, 'block', 'inline form is exempted from the real host hide rule')
  assert.ok(inlineEvidence.rect.width > 0 && inlineEvidence.rect.height > 0, 'inline form has a visible bounding box')
  assert.ok(inlineEvidence.rect.y >= inlineEvidence.buttonRect.bottom, 'inline form sits below the action button')
  assert.ok(inlineEvidence.inputRect.width > 0 && inlineEvidence.inputRect.height > 0, 'textarea has a visible bounding box')
  assert.ok(inlineEvidence.actionHeight >= inlineEvidence.sectionHeight, 'host fixed 28px action row expands to include the inline form')
  assert.equal(inlineEvidence.alignItems, 'center', 'expansion preserves the native action row alignment')
  assert.ok(inlineEvidence.actionScrollHeight <= inlineEvidence.actionHeight + 1, 'form is laid out in the action row instead of overflowing its fixed-height box')
  assert.ok(inlineEvidence.scrollHeight > inlineEvidence.clientHeight && inlineEvidence.scrollTop > 0, 'the scrollport remains the active scrolling surface')
  assert.equal(inlineEvidence.pageScrollY, 0, 'opening the form does not scroll the page behind the chat')
  assert.ok(inlineEvidence.rect.bottom <= inlineEvidence.composerTop + 1, 'the expanded form is above the fixed composer after scrolling')
  assert.ok(inlineEvidence.submitRect.height > 0 && inlineEvidence.cancelRect.height > 0, 'submit and cancel controls both have layout boxes')
  assert.equal(inlineEvidence.submitHit && inlineEvidence.cancelHit, true, 'submit and cancel points are not covered by the fixed composer')
  assert.equal(inlineEvidence.articleCount, articleCountBeforeOpen, 'opening the form does not append a message')
  assert.equal(inlineEvidence.topLayerHit, 'TEXTAREA', 'textarea is the hit target at its visible point')
  console.log(`LATEST TURN GEOMETRY ${JSON.stringify({ before: startAtLatest, after: { articles: inlineEvidence.articleCount, actionsHeight: inlineEvidence.actionHeight, actionScrollHeight: inlineEvidence.actionScrollHeight, sectionHeight: inlineEvidence.sectionHeight, scrollHeight: inlineEvidence.scrollHeight, clientHeight: inlineEvidence.clientHeight, scrollTop: inlineEvidence.scrollTop, composerTop: inlineEvidence.composerTop, formBottom: inlineEvidence.rect.bottom, textareaHit: inlineEvidence.topLayerHit, submitHit: inlineEvidence.submitHit, cancelHit: inlineEvidence.cancelHit } })}`)
  await page.mouse.up()
  await page.waitForTimeout(40)
  assert.equal(await page.evaluate(() => window.__calls.length), 1, 'release click after long press does not draw')
  await instruction.fill('示例：从门外侧拍摄，镜头略低；角色正在推开窗户。')
  await page.mouse.move(2, 2)
  await instruction.waitFor({ state: 'visible' })
  const screenshotPath = join(process.env.TEMP || tmpdir(), 'dsh-tavern-manual-direction-inline.png')
  await page.screenshot({ path: screenshotPath })
  console.log(`SCREENSHOT ${screenshotPath}`)
  await page.getByRole('button', { name: '取消' }).click()
  await assertInlineState(false, 'cancel removes the inline form')
  assert.equal(await button.evaluate(el => !el.inert && el.isConnected && document.activeElement === el && !document.querySelector('dialog')), true, 'cancel leaves the focused host action available with no modal inertness')
  assert.equal(await page.evaluate(() => window.__calls.length), 1, 'cancel does not submit a request')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__calls.length === 2)
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), { gameId: 'game-A', turn: 8 }, 'Enter after cancel triggers one ordinary draw')
  await page.evaluate(() => window.__render('game-A', 8))

  await page.evaluate(() => window.__render('game-A', 9))
  const contextButton = page.getByRole('button', { name: '为这一轮配图' })
  await contextButton.click({ button: 'right' })
  const contextTextarea = page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' })
  await contextTextarea.waitFor({ state: 'visible' })
  await contextTextarea.fill('右键草稿保留')
  await contextButton.dispatchEvent('contextmenu')
  assert.equal(await contextTextarea.inputValue(), '右键草稿保留', 'repeated contextmenu does not reset an open draft')
  await contextButton.dispatchEvent('click')
  assert.equal(await page.evaluate(() => window.__calls.length), 2, 'contextmenu followed by click does not submit a normal draw')
  await page.keyboard.press('Escape')
  await assertInlineState(false, 'Escape closes the inline input')
  await page.getByRole('button', { name: '为这一轮配图' }).focus()
  await page.keyboard.press('Shift+F10')
  await assertInlineState(true, 'Shift+F10 opens the inline input')
  await page.getByRole('button', { name: '取消' }).click()
  await assertInlineState(false, 'cancel after Shift+F10 closes the inline input')

  await page.evaluate(() => window.__render('game-A', 10))
  const moveButton = page.getByRole('button', { name: '为这一轮配图' })
  await moveButton.hover()
  await page.mouse.down()
  await page.mouse.move((await moveButton.boundingBox()).x + 30, (await moveButton.boundingBox()).y + 12, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(40)
  assert.equal(await page.evaluate(() => window.__calls.length), 2, 'movement cancels the pending gesture without drawing')
  await assertInlineState(false, 'movement cancels without opening the inline input')

  const cancelButton = page.getByRole('button', { name: '为这一轮配图' })
  await cancelButton.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })
  await cancelButton.dispatchEvent('pointercancel', { pointerId: 12, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })
  await cancelButton.dispatchEvent('click')
  await page.waitForTimeout(600)
  assert.equal(await page.evaluate(() => window.__calls.length), 2, 'pointercancel clears the hold and suppresses its synthetic click')
  await assertInlineState(false, 'pointercancel does not open the inline input')

  await page.evaluate(() => { window.__render('game-A', 11); window.__fail() })
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  const textarea = page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' })
  await textarea.fill('镜头从窗外向内，角色正推开窗户')
  await page.getByRole('button', { name: '按要求配图' }).click()
  await page.getByRole('alert').waitFor()
  await assertInlineState(true, 'failed submit leaves the inline input open')
  assert.equal(await textarea.inputValue(), '镜头从窗外向内，角色正推开窗户', 'failed submit preserves the draft')
  await page.evaluate(() => window.__delay())
  await page.getByRole('button', { name: '按要求配图' }).click()
  await page.getByRole('button', { name: '正在提交…' }).waitFor()
  await page.evaluate(() => document.querySelector('.dsh-tavern-illustration-instructions form').requestSubmit())
  assert.equal(await page.evaluate(() => window.__calls.length), 4, 'a second submit while busy is ignored')
  await page.evaluate(() => window.__finish())
  await page.waitForFunction(() => window.__calls.length === 4)
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), {
    gameId: 'game-A', turn: 11, instruction: '镜头从窗外向内，角色正推开窗户'
  }, 'instruction is passed exactly once with the captured game and turn')
  await assertInlineState(false, 'successful submit closes the inline input')

  await page.evaluate(() => window.__render('game-A', 12))
  await page.evaluate(() => window.__fail())
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  await page.getByRole('button', { name: '按要求配图' }).click()
  await page.getByRole('alert').waitFor()
  await assertInlineState(true, 'a failed blank manual request also stays open')
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), { gameId: 'game-A', turn: 12 }, 'blank manual instruction keeps the ordinary two-field request')
  await page.getByRole('button', { name: '取消' }).click()
  await assertInlineState(false, 'cancel closes the blank manual request input')

  await page.evaluate(() => window.__render('game-A', 13))
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  await page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' }).fill('不要把这条草稿发到新轮次')
  await page.evaluate(() => window.__render('game-B', 1))
  await assertInlineState(false, 'changing session/turn discards the old inline input')
  await page.getByRole('button', { name: '为这一轮配图' }).click()
  await page.waitForFunction(() => window.__calls.length === 6)
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), { gameId: 'game-B', turn: 1 }, 'old draft is not sent to the new turn')

  await page.evaluate(() => window.__render('game-A', 14))
  await page.setViewportSize({ width: 360, height: 260 })
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  await assertInlineState(true, 'small viewport opens the inline input')
  const mobileForm = page.locator('.dsh-tavern-illustration-instructions')
  const mobileBox = await mobileForm.boundingBox()
  const mobileLayout = await mobileForm.evaluate(el => ({
    below: el.getBoundingClientRect().top >= el.parentElement.querySelector('.dsh-tavern-message-illustrate').getBoundingClientRect().bottom,
    actionHeight: el.parentElement.parentElement.getBoundingClientRect().height,
    sectionHeight: el.getBoundingClientRect().height,
    scrollHeight: document.querySelector('#scrollport').scrollHeight,
    clientHeight: document.querySelector('#scrollport').clientHeight,
    viewportWidth: innerWidth,
  }))
  assert.ok(mobileBox && mobileBox.width <= 360 && mobileLayout.below, 'small viewport keeps the inline form below the action button and within the viewport')
  assert.ok(mobileLayout.actionHeight >= mobileLayout.sectionHeight, 'mobile host action row grows beyond its native fixed 28px height')
  assert.ok(mobileLayout.scrollHeight > mobileLayout.clientHeight, 'mobile content scrolls inside the chat scrollport')
  console.log(`MOBILE SHORT VIEWPORT ${JSON.stringify(mobileLayout)}`)
  assert.equal(await page.locator('dialog').count(), 0, 'inline input creates no native dialog or backdrop')
  assert.equal(await page.evaluate(() => scrollY), 0, 'mobile chat scrolling does not move the page behind it')
  const mobileScreenshotPath = join(process.env.TEMP || tmpdir(), 'dsh-tavern-manual-direction-inline-mobile.png')
  await page.screenshot({ path: mobileScreenshotPath, fullPage: true })
  console.log(`SCREENSHOT ${mobileScreenshotPath}`)
  const mobileTextarea = mobileForm.locator('textarea')
  await mobileTextarea.scrollIntoViewIfNeeded()
  const textareaHit = await mobileTextarea.evaluate(el => document.elementFromPoint(el.getBoundingClientRect().x + 4, el.getBoundingClientRect().y + 4)?.tagName)
  assert.equal(textareaHit, 'TEXTAREA', 'mobile textarea remains the actual hit target after scrolling within chat')
  const mobileSubmit = page.getByRole('button', { name: '按要求配图' })
  await mobileSubmit.scrollIntoViewIfNeeded()
  const mobileSubmitHit = await mobileSubmit.evaluate(el => document.elementFromPoint(el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2, el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2) === el)
  assert.equal(mobileSubmitHit, true, 'mobile submit point is reachable above the fixed composer')
  const mobileCancel = page.getByRole('button', { name: '取消' })
  await mobileCancel.scrollIntoViewIfNeeded()
  assert.equal(await mobileCancel.isVisible(), true, 'mobile cancel remains reachable after scrolling the page')
  const mobileCancelHit = await mobileCancel.evaluate(el => document.elementFromPoint(el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2, el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2) === el)
  assert.equal(mobileCancelHit, true, 'mobile cancel point is reachable above the fixed composer')
  await mobileCancel.click()
  await assertInlineState(false, 'mobile cancel removes the inline form')

  await page.evaluate(() => window.__render('game-A', 15))
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  await assertInlineState(true, 'unmount case starts with an open inline form')
  await page.evaluate(() => window.__unmount())
  assert.equal(await page.locator('dialog').count(), 0, 'the inline interaction never creates a native dialog')
  await assertInlineState(false, 'unmount removes the inline input')
  assert.deepEqual(pageErrors, [], 'browser runtime reports no uncaught errors')
  console.log('PASS Chrome illustration manual direction: click, long press, cancel, context menu, keyboard, movement, retry and turn isolation')
} finally {
  await browser.close()
}
