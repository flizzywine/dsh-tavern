// Run explicitly: node tests/browser/tavern-illustrator-manual-direction-browser-smoke.mjs
// Mounts the real host action with React in Chrome, plus the real illustrator request wrapper.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'acorn'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const hostSource = await readFile(new URL('../../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
const extensionsSource = await readFile(new URL('../../tavern-plugin/src/client/features/plugin-extensions.js', import.meta.url), 'utf8')
const imageClientSource = await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/client.js', import.meta.url), 'utf8')

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
const browser = await chromium.launch({ headless: true, executablePath: chromePath })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setContent('<!doctype html><meta charset="utf-8"><main id="app"></main>')
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
  await button.click()
  await page.waitForFunction(() => window.__calls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.__calls[0]), { gameId: 'game-A', turn: 7 }, 'ordinary click keeps the original context')

  await page.evaluate(() => window.__render('game-A', 8))
  const longPressButton = page.getByRole('button', { name: '为这一轮配图' })
  await longPressButton.hover()
  await page.mouse.down()
  await page.waitForTimeout(620)
  assert.equal(await page.getByRole('dialog').count(), 1, 'long press opens the instruction dialog')
  await page.mouse.up()
  await page.waitForTimeout(40)
  assert.equal(await page.evaluate(() => window.__calls.length), 1, 'release click after long press does not draw')
  await page.getByRole('button', { name: '取消' }).click()
  assert.equal(await page.evaluate(() => window.__calls.length), 1, 'cancel does not submit a request')

  await page.evaluate(() => window.__render('game-A', 9))
  const contextButton = page.getByRole('button', { name: '为这一轮配图' })
  await contextButton.click({ button: 'right' })
  assert.equal(await page.getByRole('dialog').count(), 1, 'right click opens the same dialog')
  const contextTextarea = page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' })
  await contextTextarea.fill('右键草稿保留')
  await contextButton.dispatchEvent('contextmenu')
  assert.equal(await contextTextarea.inputValue(), '右键草稿保留', 'repeated contextmenu does not reset an open draft')
  await contextButton.dispatchEvent('click')
  assert.equal(await page.evaluate(() => window.__calls.length), 1, 'contextmenu followed by click does not submit a normal draw')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '为这一轮配图' }).focus()
  await page.keyboard.press('Shift+F10')
  assert.equal(await page.getByRole('dialog').count(), 1, 'Shift+F10 opens the dialog')
  await page.getByRole('button', { name: '取消' }).click()

  await page.evaluate(() => window.__render('game-A', 10))
  const moveButton = page.getByRole('button', { name: '为这一轮配图' })
  await moveButton.hover()
  await page.mouse.down()
  await page.mouse.move((await moveButton.boundingBox()).x + 30, (await moveButton.boundingBox()).y + 12, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(40)
  assert.equal(await page.evaluate(() => window.__calls.length), 1, 'movement cancels the pending gesture without drawing')
  assert.equal(await page.getByRole('dialog').count(), 0)

  const cancelButton = page.getByRole('button', { name: '为这一轮配图' })
  await cancelButton.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })
  await cancelButton.dispatchEvent('pointercancel', { pointerId: 12, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })
  await cancelButton.dispatchEvent('click')
  await page.waitForTimeout(600)
  assert.equal(await page.evaluate(() => window.__calls.length), 1, 'pointercancel clears the hold and suppresses its synthetic click')
  assert.equal(await page.getByRole('dialog').count(), 0)

  await page.evaluate(() => { window.__render('game-A', 11); window.__fail() })
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  const textarea = page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' })
  await textarea.fill('镜头从窗外向内，角色正推开窗户')
  await page.getByRole('button', { name: '按要求配图' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1, 'failed submit leaves the dialog open')
  assert.equal(await textarea.inputValue(), '镜头从窗外向内，角色正推开窗户', 'failed submit preserves the draft')
  await page.evaluate(() => window.__delay())
  await page.getByRole('button', { name: '按要求配图' }).click()
  await page.getByRole('button', { name: '正在提交…' }).waitFor()
  await page.evaluate(() => document.querySelector('dialog form').requestSubmit())
  assert.equal(await page.evaluate(() => window.__calls.length), 3, 'a second submit while busy is ignored')
  await page.evaluate(() => window.__finish())
  await page.waitForFunction(() => window.__calls.length === 3)
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), {
    gameId: 'game-A', turn: 11, instruction: '镜头从窗外向内，角色正推开窗户'
  }, 'instruction is passed exactly once with the captured game and turn')
  assert.equal(await page.getByRole('dialog').count(), 0, 'successful submit closes the dialog')

  await page.evaluate(() => window.__render('game-A', 12))
  await page.evaluate(() => window.__fail())
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  await page.getByRole('button', { name: '按要求配图' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1, 'a failed blank manual request also stays open')
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), { gameId: 'game-A', turn: 12 }, 'blank manual instruction keeps the ordinary two-field request')
  await page.getByRole('button', { name: '取消' }).click()

  await page.evaluate(() => window.__render('game-A', 13))
  await page.getByRole('button', { name: '为这一轮配图' }).click({ button: 'right' })
  await page.getByRole('textbox', { name: '本次配图要求（最多 2000 字）' }).fill('不要把这条草稿发到新轮次')
  await page.evaluate(() => window.__render('game-B', 1))
  assert.equal(await page.getByRole('dialog').count(), 0, 'changing session/turn discards the old draft dialog')
  await page.getByRole('button', { name: '为这一轮配图' }).click()
  await page.waitForFunction(() => window.__calls.length === 5)
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), { gameId: 'game-B', turn: 1 }, 'old draft is not sent to the new turn')
  assert.deepEqual(pageErrors, [], 'browser runtime reports no uncaught errors')
  console.log('PASS Chrome illustration manual direction: click, long press, cancel, context menu, keyboard, movement, retry and turn isolation')
} finally {
  await browser.close()
}
