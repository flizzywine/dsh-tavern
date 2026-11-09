// 卡片页面 in the real stage: the production core client and the built stage client, mounted on the isolated export page
// (clip-render.cjs mountClipReplay, the stage's one headless host) over a fixture card whose pages are title (showOn, full),
// map (M, menu) and status (S, menu). Only the RPC transport and the DSH conversation input are fixtures; the page's
// triggerSlash goes through the core's message-frame lifecycle and its real slash executor into that input.
// DSH_CARD_PAGES_SHOTS=<dir> saves the screenshots a reviewer looks at (title 1920 / 390, map, CONFIG).
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {roundBody} from '../tavern-plugin/lib/domain/round-body.js'
import {readTavernClientAsset} from '../tavern-plugin/lib/domain/tavern-client-assets.js'
import {resolveTavernRuntimeAsset} from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
import {stageClientModuleAsScript} from '../tavern-plugin/packages/dsh-tavern-stage/lib/client-assets.js'
import surfaces from '../tavern-plugin/src/client/surfaces.cjs'
import {CLIP_ORIGIN} from '../tavern-plugin/packages/dsh-tavern-stage/lib/clip/clip-export-browser.js'

const shots = process.env.DSH_CARD_PAGES_SHOTS || ''
const SESSION = 'card-pages-session'
const sheet = (body, color) => `<style>html,body{margin:0;height:100%}main{box-sizing:border-box;display:grid;place-items:center;min-height:100vh;text-align:center;font:20px/1.6 sans-serif;color:#f4efe6;background:${color}}h1{font-size:44px;margin:0 0 12px}button{font:inherit;padding:8px 28px}</style><main>${body}</main>`
const TITLE = {id: 'title', label: '标题', size: 'full', showOn: {event: 'stage-enter'},
  html: sheet('<div><h1 id="title-name">夜色旅馆</h1><p>一卡一页的标题画面</p><button id="start" type="button">开始</button></div>', 'linear-gradient(160deg,#2a1f3d,#0d0a14)')
    + '<script>document.getElementById("start").onclick=function(){window.__slash=triggerSlash("/send 你好|/trigger").then(function(v){return "ok"},function(e){return "error:"+e.message});}</script>'}
const MAP = {id: 'map', label: '地图', shortcut: 'm', menu: true,
  html: sheet('<div><h1>地图</h1><p id="map-body">旅馆一层 · 大堂 · 后院</p></div>', '#16302b')}
const STATUS = {id: 'status', label: '状态', shortcut: 's', menu: true,
  html: sheet('<div><h1>状态</h1><p id="hp">体力 —</p></div>', '#2b2030') + '<script>function show(d){document.getElementById("hp").textContent="体力 "+d.ledger.hp}show(DshCardPage.data());DshCardPage.onData(show)</script>'}
const declared = page => { const {html, ...rest} = page; return rest }

// A 64 px face the fixture's lease route serves for every figure avatar.
const FACE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAoElEQVR4nO2SQQkAQRDDKu2kVGqkrYh7hIFCBSSh4evpRSdgAtUrsgv17qITMIHqFdmFenfRCZhA9YrsQr276ARMoHpFdqHeXXQCJlC9IrtQ7y46AROoXpFdqHcXnYAJVK/ILtS7i07ABKpXZBfq3UUnYALVK7IL9e6iEzCB6hXZhXp30QmYQPWK7EK9u+gETKB6RXah3l10AiZQveKfCz1LqwFLZoqQNgAAAABJRU5ErkJggg==', 'base64')

// Every animation frame from the stage's first one to 600 ms after: what the player sees of the entry (sample: true).
function startFrameSampler() {
  window.entryFrames = []
  let first = null
  const opacity = node => node ? Number(getComputedStyle(node).opacity) : null
  const tick = () => {
    const now = performance.now(), stage = document.querySelector('.fork-gal-stage')
    if (stage) {
      first ??= now
      const status = stage.querySelector(':scope > .fork-gal-status')
      const scene = [...stage.querySelectorAll(':scope > :not(.fork-gal-status, .fork-gal-entry-overlay, .fork-gal-entrance)')]
      window.entryFrames.push({t: Math.round(now - first), entry: stage.dataset.entry || null,
        scene: Math.max(0, ...scene.map(opacity)), page: status?.dataset.page || null,
        opacity: status ? Math.min(opacity(status), opacity(status.querySelector('.fork-gal-status-sheet'))) : null,
        note: !!stage.querySelector('.fork-gal-status-note')})
    }
    if (first === null || now - first < 600) requestAnimationFrame(tick)
    else window.entryFramesDone = true
  }
  requestAnimationFrame(tick)
}
const entryFrames = async page => { await page.waitForFunction(() => window.entryFramesDone === true); return page.evaluate(() => window.entryFrames) }

// Every animation frame from the page's mount until its document has been on screen for 10 frames: the sheet's chrome.
function startShellSampler() {
  window.shellFrames = []
  let after = 0
  const tick = () => {
    const status = document.querySelector('.fork-gal-stage > .fork-gal-status')
    if (status) {
      const frame = status.querySelector('iframe.fork-gal-status-frame:not([aria-hidden])')
      const close = status.querySelector('.fork-gal-status-close')
      const seen = node => !!node && getComputedStyle(node).visibility === 'visible' && node.getBoundingClientRect().width > 0
      const shown = !!frame?.contentDocument?.getElementById('title-name')
      window.shellFrames.push({size: status.dataset.size, title: status.querySelector('.fork-gal-status-title')?.textContent ?? null,
        close: seen(close), note: !!status.querySelector('.fork-gal-status-note'), shown})
      if (shown) after++
    }
    if (after < 10) requestAnimationFrame(tick)
    else window.shellFramesDone = true
  }
  requestAnimationFrame(tick)
}

async function openStage(t, {pages = [TITLE, MAP, STATUS], fresh = false, skipTitlePage = false, viewport = {width: 1280, height: 720}, line = '夜色里，旅馆的灯还亮着。', sample = false, sampleShell = false, readDelay = 0, characters = [], figures = []} = {}) {
  const browser = await chromium.launch({headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']})
  t.after(() => browser.close())
  const page = await browser.newPage({viewport, deviceScaleFactor: 1})
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  t.after(() => assert.deepEqual(errors, []))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== CLIP_ORIGIN) return route.abort('failed')
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>'})
    if (url.pathname === '/api/dsh-tavern/recordAudioTrace') return route.fulfill({status: 204, body: ''})
    if (url.pathname.startsWith('/lease/')) return route.fulfill({contentType: 'image/png', body: FACE_PNG})
    const client = await readTavernClientAsset(url.pathname)
    if (client) return route.fulfill({contentType: client.mediaType, body: Buffer.from(client.body)})
    const asset = await resolveTavernRuntimeAsset(url.pathname)
    if (asset) return route.fulfill({contentType: asset.mediaType, body: await readFile(asset.file)})
    return route.fulfill({status: 404, body: ''})
  })
  const body = roundBody([{kind: 'markdown', text: line}], {chatId: 'card-pages', turn: 1})
  const config = {characters, voice: {enabled: false}, stage: {director: false, face: 'off', music: false, theme: 'classic'}}
  const snapshot = {sessionId: SESSION, chatId: 'card-pages', cardPath: 'cards/card-pages.json', from: {turn: 1, para: 1}, config,
    turns: [{turn: 1, body}], paragraphs: [{turn: 1, para: 1, durationMs: 1000, text: line}]}
  const byId = new Map(pages.map(row => [row.id, row]))
  await page.exposeFunction('cardPagesTransport', async (method, args) => {
    switch (method) {
    case 'getRoundBody': return body
    case 'getStageDirection': return {phase: 'off', revision: 0, generation: 0, token: null}
    case 'getStageModHistory': return {turns: []}
    case 'getModStageViews': return {views: []}
    case 'getStageMusicTracks': return {tracks: []}
    case 'listFonts': return {fonts: []}
    case 'getDialogueBubbles': return {config}
    case 'leaseMedia': return {ticket: 'face:' + args.hash, revision: 'pack-1', url: '/lease/' + args.hash, expiresAt: Date.now() + 60000}
    case 'getStagePerformanceKinds': return {kinds: []}
    case 'getStageBackgrounds': return {backgrounds: []}
    case 'pluginMediaTurns': return {turns: []}
    case 'phoneCallThreads': return {threads: []}
    case 'listMods': return {mods: []}
    case 'getCgGallery': return {items: [], cursor: null}
    case 'getSession': return {view: {sessionId: SESSION, mode: 'story', cardPath: snapshot.cardPath, tavernRuntimePolicy: {trustedCardMode: true}, tavernHelper: {version: 1, lifecycleRevision: 1, stateRevision: 1, messages: [], scriptVariables: {}, chatVariables: {}}}}
    case 'readCardPages': return {pages: pages.map(declared), fresh}
    case 'readCardPage': {
      if (args.withHtml && readDelay) await new Promise(resolve => setTimeout(resolve, readDelay))
      const row = byId.get(args.page)
      return row ? {page: {...row, ...(args.withHtml ? {} : {html: undefined}), figures, preload: [], data: {ledger: {hp: 7}}, card: {name: '夜色旅馆'}}} : {page: null}
    }
    // the stage's other reads (timers, mods, media): an empty answer
    default: return {}
    }
  })
  await page.goto(CLIP_ORIGIN)
  // The isolated host does not mount tavern-presentation, which installs the production palettes.
  await page.addStyleTag({content: surfaces.css()})
  await page.addInitScript('window.__name=fn=>fn;')
  await page.evaluate(() => { window.__name = fn => fn; window.clipOriginalVoices = new Map() })
  await page.addScriptTag({content: await browserReactScript() + `Object.assign(modules['react-dom'],modules['react-dom/client']);window.__ModuleLoader__={load(d){window.clipClient=d.factory(name=>modules[name]||{});}};`})
  await page.addScriptTag({content: await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')})
  if (sample) await page.evaluate(startFrameSampler)
  if (sampleShell) await page.evaluate(startShellSampler)
  await page.addScriptTag({content: stageClientModuleAsScript(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client.js', import.meta.url), 'utf8')) + '\nwindow.clipStage=stageClientPlugin;'})
  await page.evaluate(async ({snapshot, skipTitlePage}) => {
    // The DSH host the core's slash executor writes to: the conversation input of the session.
    window.sent = []
    const actx = {sessionId: 'card-pages-session'}
    const input = {state: {getSnapshot: () => ({draft: window.draft || ''})}, setDraft(text) { window.draft = text }}
    const summary = {running: false}, listeners = new Set()
    const list = {getSnapshot: () => ({byId: {[actx.sessionId]: summary}}), subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }}
    const session = {async prompt(content, mode, _options, requestId) {
      window.sent.push({submit: mode, text: content[0].text, requestId})
      summary.running = true; listeners.forEach(fn => fn())
      setTimeout(() => {summary.running = false; listeners.forEach(fn => fn())}, 0)
      return {ok: true}
    }}
    window.clipClient.apply({inject() { return {dispose() {}} }, provide() {}, plugin() {}, effect() {},
      get: name => name === 'conversation' ? {input: {for: scope => scope === actx ? input : null}} : undefined,
      sessions: {scope: id => id === 'card-pages-session' ? actx : null, binding: id => id === actx.sessionId ? {session} : null, subagentAddress() {}, list},
      betterSidebar: {registerTab() {}}, tavernSessionSignals: {subscribe() { return () => {} }},
      slots: {inject() {}, register() {}}})
    const core = window.clipClient.clipReplayCore()
    if (skipTitlePage) core.stageReading.set({skipTitlePage: true})
    window.cardPagesCore = core
    window.clipReplay = await window.clipStage.mountClipReplay(core, snapshot, (method, args) => {
      if (method === 'appendPlayerInput') {
        window.sent.push({save: args.text, requestId: args.requestId})
        return {ok: true, saved: true}
      }
      return window.cardPagesTransport(method, args)
    })
    // the export page hides the stage's chrome; a player's stage shows it.
    for (const style of document.head.querySelectorAll('style')) if (style.textContent.startsWith('html,body{margin:0;overflow:hidden}')) style.remove()
  }, {snapshot, skipTitlePage})
  await page.locator('.fork-gal-stage').waitFor()
  return {page}
}

const openPage = page => page.evaluate(() => document.querySelector('.fork-gal-status')?.dataset.page || null)
const frameOf = (page, id) => page.frameLocator(`.fork-gal-status[data-page="${id}"] iframe.fork-gal-status-frame:not([aria-hidden])`)
async function shot(page, name) {
  if (!shots) return
  await mkdir(shots, {recursive: true})
  await page.screenshot({path: join(shots, name)})
}

const waitPage = (page, id) => page.waitForFunction(id => (document.querySelector('.fork-gal-status')?.dataset.page || null) === id, id)
const menu = page => page.locator('.fork-gal-menu-panel[role="menu"]')
async function openMenu(page) {
  await page.keyboard.press('Escape')
  await menu(page).waitFor()
}

test('entering the stage opens title; triggerSlash reaches the slash executor; M / S toggle, Esc closes; menu rows; CONFIG 跳过标题页', {timeout: 90000}, async t => {
  const {page} = await openStage(t, {viewport: {width: 1920, height: 1080}})
  // (a) the entry opens title, a full sheet over the stage, drawn in its own frame
  await waitPage(page, 'title')
  assert.equal(await page.locator('.fork-gal-status[data-page="title"]').getAttribute('data-size'), 'full')
  assert.equal(await page.locator('.fork-gal-status[data-page="title"] iframe.fork-gal-status-frame').count(), 1, 'title has its iframe')
  await frameOf(page, 'title').locator('#title-name').waitFor()
  await page.waitForTimeout(500)
  await shot(page, 'title-1920.png')

  // (d) the page's script: triggerSlash('/send 你好|/trigger') through the core's slash executor into the conversation input
  await frameOf(page, 'title').locator('#start').click()
  assert.equal(await frameOf(page, 'title').locator('body').evaluate(() => window.__slash), 'ok')
  const sent = await page.evaluate(() => window.sent)
  assert.ok(sent[0].requestId)
  assert.deepEqual(sent, [{save: '你好', requestId: sent[0].requestId}, {submit: 'queue', text: '你好', requestId: sent[0].requestId}])
  // the title page is the entry: closing it would leave, continueGame() enters
  await frameOf(page, 'title').locator('body').evaluate(() => { setTimeout(() => DshCardPage.continueGame()) })
  await waitPage(page, null)

  // (b) M opens map, M again closes it; S toggles status; Esc closes
  await page.keyboard.press('m')
  await waitPage(page, 'map')
  await frameOf(page, 'map').locator('#map-body').waitFor()
  assert.equal(await page.locator('.fork-gal-status[data-page="map"]').getAttribute('data-size'), 'window')
  await page.waitForTimeout(400)
  const widths = await page.locator('.fork-gal-status-sheet').evaluate(el => [...el.querySelectorAll('header, .fork-gal-status-body, iframe')].map(e => e.getBoundingClientRect().width))
  assert.ok(Math.max(...widths) - Math.min(...widths) < 0.5, 'page frame and title bar align: ' + widths)
  await shot(page, 'map-1920.png')
  await page.keyboard.press('m')
  await waitPage(page, null)
  await page.keyboard.press('s')
  await waitPage(page, 'status')
  await frameOf(page, 'status').getByText('体力 7').waitFor()
  await page.keyboard.press('s')
  await waitPage(page, null)
  await page.keyboard.press('s')
  await waitPage(page, 'status')
  await page.keyboard.press('Escape')
  await waitPage(page, null)
  // the key also works with the focus inside the page's frame (its prelude closes it)
  await page.keyboard.press('m')
  await waitPage(page, 'map')
  await frameOf(page, 'map').locator('#map-body').click()
  await page.keyboard.press('m')
  await waitPage(page, null)

  // (c) the menu has 地图 and 状态 rows; a row opens its page
  await page.waitForTimeout(500)
  await openMenu(page)
  assert.equal(await menu(page).getByRole('menuitem', {name: '地图', exact: true}).count(), 1)
  assert.equal(await menu(page).getByRole('menuitem', {name: '状态', exact: true}).count(), 1)
  await menu(page).getByRole('menuitem', {name: '地图', exact: true}).click()
  await waitPage(page, 'map')
  await page.keyboard.press('Escape')
  await waitPage(page, null)
  await page.waitForTimeout(500)
  await openMenu(page)
  await menu(page).getByRole('menuitem', {name: '状态', exact: true}).click()
  await waitPage(page, 'status')
  await page.keyboard.press('Escape')
  await waitPage(page, null)

  // (f) CONFIG › 文字 shows the 跳过标题页 switch
  await page.waitForTimeout(500)
  await openMenu(page)
  await menu(page).getByRole('menuitem', {name: '设置', exact: true}).click()
  await page.getByRole('tab', {name: '文字', exact: true}).click()
  const skip = page.getByRole('switch', {name: '跳过标题页', exact: true})
  await skip.waitFor()
  await skip.scrollIntoViewIfNeeded()
  assert.equal(await skip.getAttribute('aria-checked'), 'false')
  await page.waitForTimeout(400)
  const track = await skip.locator('.fork-gal-config-switch-track').evaluate(el => ({background: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow, width: el.getBoundingClientRect().width}))
  assert.notEqual(track.background, 'rgba(0, 0, 0, 0)', 'classic skin draws the off track')
  assert.notEqual(track.shadow, 'none', 'classic skin draws the track outline')
  assert.equal(track.width, 52)
  await shot(page, 'config-1920.png')

  // (e) with the switch on, a second entry into this (non-fresh) chat opens no page
  await skip.click()
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="跳过标题页"]')?.getAttribute('aria-checked') === 'true')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('[role="switch"][aria-label="跳过标题页"]'))
  await page.evaluate(id => window.cardPagesCore.galEnter(id, {turn: 1, para: 1}), SESSION)
  await page.waitForTimeout(1200)
  assert.equal(await openPage(page), null, 'skipTitlePage: no page on a later entry')
})

test('phone width: the title page fills the stage at 390 px', {timeout: 60000}, async t => {
  const {page} = await openStage(t, {viewport: {width: 390, height: 844}})
  await waitPage(page, 'title')
  await frameOf(page, 'title').locator('#title-name').waitFor()
  const box = await page.locator('.fork-gal-status[data-page="title"] iframe.fork-gal-status-frame').boundingBox()
  assert.ok(box.width >= 380, 'the full sheet spans the phone width: ' + box.width)
  await page.waitForTimeout(500)
  await shot(page, 'title-390.png')
})

test('跳过标题页 still opens the initial page of a fresh chat, and no page on entering a chat with messages', {timeout: 60000}, async t => {
  const initial = {...TITLE, initial: true}
  const fresh = await openStage(t, {pages: [initial, MAP, STATUS], fresh: true, skipTitlePage: true})
  await waitPage(fresh.page, 'title')
  const later = await openStage(t, {pages: [TITLE, MAP, STATUS], fresh: false, skipTitlePage: true})
  await later.page.waitForTimeout(1200)
  assert.equal(await openPage(later.page), null)
  await later.page.evaluate(id => window.cardPagesCore.galEnter(id, {turn: 1, para: 1}), SESSION)
  await later.page.waitForTimeout(1200)
  assert.equal(await openPage(later.page), null, 'nor on a second entry')
  // the same second entry with the switch off opens title again
  const shown = await openStage(t, {pages: [TITLE, MAP, STATUS], fresh: false})
  await waitPage(shown.page, 'title')
  await frameOf(shown.page, 'title').locator('body').evaluate(() => { setTimeout(() => DshCardPage.continueGame()) })
  await waitPage(shown.page, null)
  await shown.page.evaluate(id => window.cardPagesCore.galEnter(id, {turn: 1, para: 1}), SESSION)
  await waitPage(shown.page, 'title')
})

test('a card page gets its declared figures\' faces as data: URLs from the stage face cache', {timeout: 60000}, async t => {
  const face = {resource: true, kind: 'media', ref: {packId: 'pack-moon', figureId: 'fig-moon'}, alias: 'fig-moon', revision: 'pack-1',
    hash: 'a'.repeat(64), outfitKey: 'k01', stateId: 'calm', crop: null, identity: 'pack-moon:figures:fig-moon:' + 'a'.repeat(64)}
  const characters = [{alias: 'fig-moon', name: '月见', aliases: ['小月'], ref: {packId: 'pack-moon', figureId: 'fig-moon'}, avatarMedia: {default: face, moods: {}}}]
  const faces = {...STATUS, html: sheet('<div><h1>状态</h1><p id="face-state">无</p><img id="face" alt=""></div>', '#2b2030')
    + '<script>function show(d){var f=(d.figures||[]).find(function(x){return x.name==="月见"});var img=document.getElementById("face");if(f&&f.avatar){img.src=f.avatar;document.getElementById("face-state").textContent="有"}}show(DshCardPage.data());DshCardPage.onData(show)</script>'}
  const {page} = await openStage(t, {pages: [MAP, faces], characters, figures: [{name: '月见'}]})
  await page.waitForTimeout(800)
  await page.keyboard.press('s')
  await waitPage(page, 'status')
  await frameOf(page, 'status').getByText('有').waitFor()
  const src = await frameOf(page, 'status').locator('#face').evaluate(img => img.getAttribute('src') || '')
  assert.match(src, /^data:image\//, 'the page holds the face as a data: URL')
  await frameOf(page, 'status').locator('#face').evaluate(img => img.decode())
  await shot(page, 'status-face-1920.png')
  // reopening the page (faces already prepared and converted) shows the face again
  await page.keyboard.press('s')
  await waitPage(page, null)
  await page.keyboard.press('s')
  await waitPage(page, 'status')
  await frameOf(page, 'status').getByText('有').waitFor()
})

// A title menu built on the DshCardPage actions: every button is disabled while its action runs and enabled again once
// the action's Promise settles (继续 only while the chat is saved).
const MENU_SCRIPT = '<script>var page=DshCardPage,buttons=[].slice.call(document.querySelectorAll("nav button"));function enable(){buttons.forEach(function(b){b.disabled=b.id==="continue"&&!page.data().saved;});}enable();'
  + 'function go(action){buttons.forEach(function(b){b.disabled=true;});action().then(function(v){window.lastResult=JSON.stringify(v);},function(e){window.lastResult="error:"+e.message;}).finally(enable);}'
  + '[["new","newGame"],["continue","continueGame"],["gallery","openGallery"],["settings","openSettings"],["exit","exit"]].forEach(function(row){document.getElementById(row[0]).onclick=function(){go(page[row[1]]);};});</script>'
const MENU_BUTTONS = '<nav><button data-dsh-sound id="new" type="button">新游戏</button><button data-dsh-sound id="continue" type="button">继续</button><button data-dsh-sound id="gallery" type="button">回想</button><button data-dsh-sound id="settings" type="button">设置</button><button data-dsh-sound id="exit" type="button">退出</button></nav>'
const ACTION_TITLE = {id: 'title', label: '标题', size: 'full', showOn: {event: 'stage-enter'},
  html: sheet('<div><h1 id="title-name">夜色旅馆</h1>' + MENU_BUTTONS + '</div>', 'linear-gradient(160deg,#2a1f3d,#0d0a14)').replace('</style>', 'nav{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}</style>') + MENU_SCRIPT}
const ACTION_OPENING = {...ACTION_TITLE, id: 'opening', label: '开场', initial: true}
const enabled = (page, id) => frameOf(page, id).locator('nav button:not([disabled])').evaluateAll(nodes => nodes.map(node => node.id))
const typedGlyphs = page => page.evaluate(() => [...document.querySelectorAll('.fork-gal-stage .fork-gal-type-shown, .fork-gal-stage .fork-gal-glyph')].map(node => node.textContent).join('').length)
async function waitEnabled(page, id, expected) {
  for (let i = 0; i < 40 && (await enabled(page, id)).join() !== expected.join(); i++) await page.waitForTimeout(100)
  assert.deepEqual(await enabled(page, id), expected)
}

test('title actions: the line waits behind the page, 回想 stands over it, 新游戏 asks first, no button stays disabled', {timeout: 90000}, async t => {
  const {page} = await openStage(t, {pages: [ACTION_TITLE, MAP], viewport: {width: 1920, height: 1080}})
  await page.evaluate(() => { window.newGames = []; window.addEventListener('dsh-tavern-new-game', event => window.newGames.push(event.detail.sessionId)) })
  await waitPage(page, 'title')
  await frameOf(page, 'title').locator('#title-name').waitFor()
  assert.deepEqual(await enabled(page, 'title'), ['new', 'continue', 'gallery', 'settings', 'exit'], 'a saved chat can continue')
  // entering mid-chat: the current line (its typing, voice and AUTO) holds while the title page is up
  await page.waitForTimeout(1500)
  assert.equal(await typedGlyphs(page), 0, 'no glyph of the line typed behind the title page')
  await shot(page, 'title-actions-1920.png')

  // 回想 opens over the page; Esc closes it and the page is still there, its buttons enabled again
  await frameOf(page, 'title').locator('#gallery').click()
  await page.locator('.fork-cg-gallery').waitFor()
  assert.equal(await openPage(page), 'title')
  await page.keyboard.press('Escape')
  await page.locator('.fork-cg-gallery').waitFor({state: 'detached'})
  assert.equal(await openPage(page), 'title')
  await waitEnabled(page, 'title', ['new', 'continue', 'gallery', 'settings', 'exit'])

  // 新游戏 on a saved chat asks with the core confirm; 取消 keeps the page and enables its buttons again
  await frameOf(page, 'title').locator('#new').click()
  const prompt = page.locator('dialog.dsh-tavern-prompt')
  await prompt.waitFor()
  assert.match(await prompt.textContent(), /开始新游戏？/)
  await prompt.getByRole('button', {name: '取消'}).click()
  await waitEnabled(page, 'title', ['new', 'continue', 'gallery', 'settings', 'exit'])
  assert.equal(await frameOf(page, 'title').locator('body').evaluate(() => window.lastResult), '{"started":false}')
  assert.deepEqual(await page.evaluate(() => window.newGames), [])
  await frameOf(page, 'title').locator('#new').click()
  await prompt.getByRole('button', {name: '开始新游戏'}).click()
  await page.waitForFunction(() => window.newGames.length === 1)
  assert.deepEqual(await page.evaluate(() => window.newGames), [SESSION])

  // 继续 closes the page and the line starts from where the reader is
  await frameOf(page, 'title').locator('#continue').click()
  await waitPage(page, null)
  await page.waitForFunction(() => document.querySelectorAll('.fork-gal-stage .fork-gal-type-shown, .fork-gal-stage .fork-gal-glyph').length > 0)
})

// closeControl 'page': a full page that closes itself; Esc / its shortcut go back inside it first (onCloseRequest).
const OWNED = {id: 'atlas', label: '地图册', shortcut: 'm', menu: true, size: 'full', closeControl: 'page',
  html: sheet('<div><h1>地图册</h1><p id="detail" hidden>港口详情</p><button id="open-detail" type="button">港口</button><button id="gallery" type="button">回想</button><button id="own-close" type="button">关闭</button></div>', '#16302b')
    + '<script>var page=DshCardPage,detail=document.getElementById("detail");window.requests=0;'
    + 'document.getElementById("open-detail").onclick=function(){detail.hidden=false;};document.getElementById("gallery").onclick=function(){page.openGallery();};'
    + 'document.getElementById("own-close").onclick=function(){page.close();};'
    + 'page.onCloseRequest(function(){window.requests++;if(!detail.hidden)detail.hidden=true;else page.close();});</script>'}

test('closeControl page: no stage ×; Esc and the shortcut ask the page, which goes back to its map before it closes', {timeout: 60000}, async t => {
  const {page} = await openStage(t, {pages: [OWNED, STATUS], viewport: {width: 1280, height: 720}})
  const atlas = () => frameOf(page, 'atlas')
  const detailShown = () => atlas().locator('#detail').evaluate(node => !node.hidden)
  await page.keyboard.press('m')
  await waitPage(page, 'atlas')
  await atlas().locator('#own-close').waitFor()
  await page.waitForSelector('.fork-gal-status[data-close-control="page"]')
  assert.equal(await page.locator('.fork-gal-status[data-page="atlas"] .fork-gal-status-close').count(), 0, 'the page draws its own ×')
  // Esc inside the page's frame: the detail closes, the page stays
  await atlas().locator('#open-detail').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  assert.equal(await detailShown(), false)
  assert.equal(await openPage(page), 'atlas')
  // Esc with the focus on the sheet (outside the frame) asks the page the same way
  await atlas().locator('#open-detail').click()
  await page.locator('.fork-gal-status-sheet').focus()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  assert.equal(await detailShown(), false)
  assert.equal(await openPage(page), 'atlas')
  // 回想 over the page: Esc closes 回想 first, the page is not asked
  const asked = await atlas().locator('body').evaluate(() => window.requests)
  await atlas().locator('#gallery').click()
  await page.locator('.fork-cg-gallery').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.fork-cg-gallery').waitFor({state: 'detached'})
  assert.equal(await openPage(page), 'atlas')
  assert.equal(await atlas().locator('body').evaluate(() => window.requests), asked)
  // on the map the shortcut closes the page (the page calls close())
  await atlas().locator('h1').click()
  await page.keyboard.press('m')
  await waitPage(page, null)
  // the page's own × closes it; an undeclared page keeps the stage ×
  await page.waitForTimeout(400)
  await page.keyboard.press('m')
  await waitPage(page, 'atlas')
  await atlas().locator('#own-close').click()
  await waitPage(page, null)
  await page.waitForTimeout(400)
  await page.keyboard.press('s')
  await waitPage(page, 'status')
  assert.equal(await page.locator('.fork-gal-status[data-page="status"] .fork-gal-status-close').count(), 1)
})

test('a fresh chat: the opening page holds the first line too and 继续 is off', {timeout: 60000}, async t => {
  const {page} = await openStage(t, {pages: [ACTION_OPENING, MAP], fresh: true, viewport: {width: 375, height: 812}})
  await waitPage(page, 'opening')
  await frameOf(page, 'opening').locator('#title-name').waitFor()
  assert.deepEqual(await enabled(page, 'opening'), ['new', 'gallery', 'settings', 'exit'])
  await page.waitForTimeout(1500)
  assert.equal(await typedGlyphs(page), 0, 'no glyph of the first line typed behind the opening page')
  await shot(page, 'title-actions-375.png')
  // an unsaved chat starts a new game without asking
  await page.evaluate(() => { window.newGames = []; window.addEventListener('dsh-tavern-new-game', event => window.newGames.push(event.detail.sessionId)) })
  await frameOf(page, 'opening').locator('#new').click()
  await page.waitForFunction(() => window.newGames.length === 1)
  assert.equal(await page.locator('dialog.dsh-tavern-prompt').count(), 0)
  await frameOf(page, 'opening').locator('body').evaluate(() => { setTimeout(() => DshCardPage.continueGame()) })
  await waitPage(page, null)
  await page.waitForFunction(() => document.querySelectorAll('.fork-gal-stage .fork-gal-type-shown, .fork-gal-stage .fork-gal-glyph').length > 0)
})
test('every stage entry, frame by frame: a title page covers the stage from its first frame; a card without one never mounts a page', {timeout: 90000}, async t => {
  const titled = await openStage(t, {pages: [ACTION_TITLE, MAP], sample: true})
  const frames = await entryFrames(titled.page)
  assert.ok(frames.length >= 20, 'sampled the first 600 ms: ' + frames.length + ' frames')
  assert.deepEqual(frames.filter(frame => frame.note), [], 'no 正在读取 frame')
  assert.deepEqual(frames.filter(frame => frame.scene > 0 && frame.page !== 'title'), [], 'the scene never shows without the title over it')
  assert.deepEqual(frames.filter(frame => frame.page !== null && frame.opacity !== 1), [], 'the title page does not fade in over the stage')
  assert.equal(frames.at(-1).page, 'title', 'the title is up within 600 ms')
  const plain = await openStage(t, {pages: [MAP, STATUS], sample: true})
  const plainFrames = await entryFrames(plain.page)
  assert.deepEqual(plainFrames.filter(frame => frame.page !== null || frame.note), [], 'no page is ever mounted')
  await plain.page.waitForFunction(() => document.querySelector('.fork-gal-stage')?.dataset.entry === 'ready')
})

test('a full entry page whose read is slow keeps its size and draws no chrome until its document is on screen', {timeout: 60000}, async t => {
  const {page} = await openStage(t, {pages: [TITLE, MAP], viewport: {width: 1920, height: 1080}, sampleShell: true, readDelay: 400})
  await page.waitForFunction(() => window.shellFramesDone === true)
  const frames = await page.evaluate(() => window.shellFrames)
  const before = frames.filter(frame => !frame.shown), after = frames.filter(frame => frame.shown)
  assert.ok(before.length >= 10, 'sampled the page while its read was out: ' + before.length + ' frames')
  assert.deepEqual(before.filter(frame => frame.size !== 'full'), [], 'the declared full size, never the window sheet')
  assert.deepEqual(before.filter(frame => frame.title !== null), [], 'no title bar (never 「页面」)')
  assert.deepEqual(before.filter(frame => frame.close || frame.note), [], 'no × and no note before the page')
  assert.deepEqual(after.filter(frame => frame.size !== 'full'), [], 'still full once the page is up')
  assert.ok(after.slice(-3).every(frame => frame.close), 'the × comes with the page')
  await shot(page, 'title-slow-read-1920.png')
})

test('the × of a full entry page is the stage top bar × and leaves instead of entering', {timeout: 60000}, async t => {
  const {page} = await openStage(t, {pages: [ACTION_TITLE, MAP], viewport: {width: 1920, height: 1080}})
  await waitPage(page, 'title')
  await frameOf(page, 'title').locator('#title-name').waitFor()
  const close = page.locator('.fork-gal-status[data-page="title"] .fork-gal-status-close')
  assert.equal(await close.getAttribute('aria-label'), '返回主页面')
  const look = selector => page.locator(selector).evaluate(node => { const s = getComputedStyle(node); return {background: s.backgroundColor, radius: s.borderRadius, width: s.width, height: s.height, color: s.color, filter: s.filter, border: s.borderStyle} })
  assert.deepEqual(await look('.fork-gal-status[data-page="title"] .fork-gal-status-close'), await look('.fork-gal-topbar .fork-gal-quit'), 'the same overlay button as 返回主页面')
  assert.equal((await look('.fork-gal-status[data-page="title"] .fork-gal-status-close')).background, 'rgba(0, 0, 0, 0)', 'no solid plate')
  await page.mouse.move(1000, 500)
  await shot(page, 'title-close-1920.png')
  // the export host's onExit is a no-op: the page stays and the stage is not entered
  await close.click()
  await page.waitForTimeout(800)
  assert.equal(await openPage(page), 'title')
  assert.equal(await typedGlyphs(page), 0, 'the × did not enter the stage')
})

test('phone width: the × of a full entry page is the 44 px top bar ×', {timeout: 60000}, async t => {
  const {page} = await openStage(t, {pages: [ACTION_TITLE, MAP], viewport: {width: 375, height: 812}})
  await waitPage(page, 'title')
  await frameOf(page, 'title').locator('#title-name').waitFor()
  const box = await page.locator('.fork-gal-status[data-page="title"] .fork-gal-status-close').boundingBox()
  assert.deepEqual([box.width, box.height], [44, 44])
  assert.ok(box.x + box.width <= 375 && box.y >= 0, 'inside the stage: ' + JSON.stringify(box))
  await page.waitForTimeout(300)
  await shot(page, 'title-close-375.png')
})

test('a window page opened while a line types does not hold it', {timeout: 60000}, async t => {
  const line = '夜色里，旅馆的灯还亮着。'.repeat(12)
  const {page} = await openStage(t, {pages: [MAP, STATUS], line})
  await page.waitForFunction(() => document.querySelectorAll('.fork-gal-stage .fork-gal-type-shown, .fork-gal-stage .fork-gal-glyph').length > 0)
  await page.keyboard.press('m')
  await waitPage(page, 'map')
  const before = await typedGlyphs(page)
  await page.waitForTimeout(700)
  const after = await typedGlyphs(page)
  assert.equal(await openPage(page), 'map')
  assert.ok(before < line.length && after > before, `the line goes on typing behind the map: ${before} → ${after}`)
})

// A mobile shell (e.g. the dsh-pocket plugin) may cap every modal dialog at `calc(100vw - 32px)` below 1024 px. The stage's
// full-viewport surfaces (a full card page, 履历, CONFIG) keep the whole width; an ordinary centred dialog keeps the cap.
const SHELL_CAP_SELECTOR = '[aria-modal="true"]:not(:has(> :first-child > :last-child > button))'
const SHELL_DIALOG_CAP = `@media (max-width: 1023px) { ${SHELL_CAP_SELECTOR} { max-width: calc(100vw - 32px) !important; } }`
for (const width of [390, 900]) {
  test(`a shell's modal-dialog width cap leaves the stage's full-viewport surfaces at the viewport width (${width} px)`, {timeout: 60000}, async t => {
    const {page} = await openStage(t, {viewport: {width, height: 844}})
    await page.addStyleTag({content: SHELL_DIALOG_CAP})
    const surface = async (selector, name) => {
      const box = await page.locator(selector).first().evaluate((el, cap) => ({width: el.getBoundingClientRect().width, capped: el.matches(cap)}), SHELL_CAP_SELECTOR)
      assert.ok(box.capped, name + ' is a dialog the shell caps')
      assert.equal(box.width, width, name + ' spans the viewport')
    }
    await waitPage(page, 'title')
    await frameOf(page, 'title').locator('#title-name').waitFor()
    await page.waitForTimeout(500)
    await shot(page, `title-shell-cap-${width}.png`)
    await surface('.fork-gal-status[data-page="title"] > .fork-gal-status-sheet', 'the title page')
    assert.equal(await page.locator('.fork-gal-status[data-page="title"] iframe.fork-gal-status-frame').evaluate(el => el.getBoundingClientRect().width), width, 'the title page frame')
    await frameOf(page, 'title').locator('body').evaluate(() => { setTimeout(() => DshCardPage.continueGame()) })
    await waitPage(page, null)
    for (const [row, selector] of [['履历', '.fork-gal-backlog'], ['设置', '.fork-gal-config']]) {
      await page.waitForTimeout(500)
      await openMenu(page)
      await menu(page).getByRole('menuitem', {name: row, exact: true}).click()
      await page.locator(selector).waitFor()
      await surface(selector, row)
      await page.keyboard.press('Escape')
      await page.locator(selector).waitFor({state: 'detached'})
    }
    // an ordinary centred dialog on the stage keeps the shell's cap
    const capped = await page.evaluate(() => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.className = 'fork-gal-confirm'
      dialog.style.cssText = 'position:absolute;left:0;top:0;box-sizing:border-box;width:100vw;height:80px;padding:0;border:0'
      document.querySelector('.fork-gal-stage').append(dialog)
      const box = dialog.getBoundingClientRect().width; dialog.remove(); return box
    })
    assert.equal(capped, width - 32, 'an ordinary dialog keeps the cap')
  })
}
