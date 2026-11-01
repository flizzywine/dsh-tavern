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
const run = declaration(extensionsSource, 'runTavernIllustrator')
const drawRunner = declaration(imageClientSource, 'createMessageDrawRunner')
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
    'html,body{min-height:100%;margin:0;font:14px sans-serif}',
    '[data-turn-tail]{position:relative;display:block;min-height:160px;padding:40px}',
    '[data-slot="conversation.chat.assistant-actions"]{display:flex;gap:8px;min-height:40px}',
    '.dsh-tavern-message-fork{width:32px;height:32px}',
    'main{width:min(760px,calc(100vw - 24px));margin:0 auto}',
    '[data-slot="conversation.chat.assistant-actions"]{width:100%;box-sizing:border-box}',
    '.actions-row{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;width:100%}',
    '.fixture-contents [data-slot="conversation.chat.assistant-actions"]{display:contents}',
    '.dsh-tavern-illustration-instructions textarea{min-height:76px}'
  ].join('\n') + '</style><body class="dsh-tavern-shell-active"><main><article data-turn-tail="7"><div class="actions-row"><div data-slot="conversation.chat.assistant-actions" id="app"></div><button type="button" aria-label="复制正文">复制</button></div></article></main></body>')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: [
    'const React=modules.react; const h=React.createElement;',
    'const DshUi={Tooltip:({children})=>children};',
    'const drafts=new Map(); const tavernIllustrationDrafts={set:(g,t,v)=>{const k=g+":"+t;if(v)drafts.set(k,v);else drafts.delete(k);},get:(g,t)=>drafts.get(g+":"+t)||null};',
    'const TAVERN_ILLUSTRATION_NOTICE_MS=8000;',
    drawRunner,
    'const calls=[]; let failNext=false, delayNext=false, finishDelayed=null;',
    'const illustrator={draw:async context=>{calls.push({...context});if(failNext){failNext=false;throw new Error("network unavailable")}if(delayNext){delayNext=false;return new Promise(resolve=>{finishDelayed=()=>resolve({})})}return {};}};',
    'window.__calls=calls;window.__fail=()=>{failNext=true};window.__delay=()=>{delayNext=true};window.__finish=()=>finishDelayed?.();',
    'window.__run=(...args)=>runTavernIllustrator(illustrator,...args);',
    run, icon, action,
    'const root=modules["react-dom/client"].createRoot(document.querySelector("#app"));',
    'window.__render=(gameId="game-A",turn=7)=>root.render(h(TavernPluginIllustrateAction,{key:gameId+":"+turn,sessionId:gameId,turn,illustrator}));',
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

  await page.evaluate(() => window.__render('game-A', 8))
  const longPressButton = page.getByRole('button', { name: '为这一轮配图' })
  await longPressButton.hover()
  await page.mouse.down()
  await page.waitForTimeout(620)
  const instruction = page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' })
  await instruction.waitFor({ state: 'visible' })
  const inlineEvidence = await page.locator('.dsh-tavern-illustration-instructions').evaluate(section => {
    const rect = section.getBoundingClientRect(), slot = section.parentElement
    const button = slot.querySelector('.dsh-tavern-message-illustrate'), buttonRect = button.getBoundingClientRect()
    const input = section.querySelector('textarea'), inputRect = input.getBoundingClientRect()
    return { directSlotChild: slot.matches('[data-slot="conversation.chat.assistant-actions"]'),
      display: getComputedStyle(section).display, flexWrap: getComputedStyle(slot).flexWrap,
      outerFlexWrap: getComputedStyle(slot.parentElement).flexWrap,
      rect: rect.toJSON(), buttonRect: buttonRect.toJSON(), inputRect: inputRect.toJSON(),
      topLayerHit: document.elementFromPoint(inputRect.x + inputRect.width / 2, inputRect.y + inputRect.height / 2)?.tagName }
  })
  assert.equal(inlineEvidence.directSlotChild, true, 'inline form stays inside the real host action slot')
  assert.equal(inlineEvidence.display, 'block', 'inline form is exempted from the real host hide rule')
  assert.equal(inlineEvidence.flexWrap, 'wrap', 'host action row wraps the form beneath the button')
  assert.equal(inlineEvidence.outerFlexWrap, 'wrap', 'outer host action row wraps even when it contains sibling actions')
  assert.ok(inlineEvidence.rect.width > 0 && inlineEvidence.rect.height > 0, 'inline form has a visible bounding box')
  assert.ok(inlineEvidence.rect.y >= inlineEvidence.buttonRect.bottom, 'inline form sits below the action button')
  assert.ok(inlineEvidence.inputRect.width > 0 && inlineEvidence.inputRect.height > 0, 'textarea has a visible bounding box')
  assert.equal(inlineEvidence.topLayerHit, 'TEXTAREA', 'textarea is the hit target at its visible point')
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
  await page.evaluate(() => document.querySelector('.actions-row').classList.add('fixture-contents'))
  assert.equal(await page.locator('[data-slot="conversation.chat.assistant-actions"]').evaluate(el => getComputedStyle(el).display), 'contents', 'mobile fixture starts with the real slot modeled as display:contents')
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  await assertInlineState(true, 'small viewport opens the inline input')
  const mobileForm = page.locator('.dsh-tavern-illustration-instructions')
  const mobileBox = await mobileForm.boundingBox()
  const mobileLayout = await mobileForm.evaluate(el => ({
    below: el.getBoundingClientRect().top >= el.parentElement.querySelector('.dsh-tavern-message-illustrate').getBoundingClientRect().bottom,
    slotDisplay: getComputedStyle(el.parentElement).display,
    rowWrap: getComputedStyle(el.parentElement.parentElement).flexWrap,
    viewportWidth: innerWidth,
    target: document.elementFromPoint(el.querySelector('textarea').getBoundingClientRect().x + 4, el.querySelector('textarea').getBoundingClientRect().y + 4)?.tagName
  }))
  assert.ok(mobileBox && mobileBox.width <= 360 && mobileLayout.below, 'small viewport keeps the inline form below the action button and within the viewport')
  assert.equal(mobileLayout.slotDisplay, 'flex', 'expanded display:contents slot becomes a wrapping flex container')
  assert.equal(mobileLayout.rowWrap, 'wrap', 'outer nowrap host row is overridden only while the form is open')
  assert.equal(mobileLayout.target, 'TEXTAREA', 'mobile textarea remains the actual hit target')
  assert.equal(await page.locator('dialog').count(), 0, 'inline input creates no native dialog or backdrop')
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), true, 'mobile inline controls remain reachable in the document flow')
  const mobileScreenshotPath = join(process.env.TEMP || tmpdir(), 'dsh-tavern-manual-direction-inline-mobile.png')
  await page.screenshot({ path: mobileScreenshotPath, fullPage: true })
  console.log(`SCREENSHOT ${mobileScreenshotPath}`)
  const mobileCancel = page.getByRole('button', { name: '取消' })
  await mobileCancel.scrollIntoViewIfNeeded()
  assert.equal(await mobileCancel.isVisible(), true, 'mobile cancel remains reachable after scrolling the page')
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
