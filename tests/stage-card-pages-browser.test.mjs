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

async function openStage(t, {pages = [TITLE, MAP, STATUS], fresh = false, skipTitlePage = false, viewport = {width: 1280, height: 720}, characters = [], figures = []} = {}) {
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
  const body = roundBody([{kind: 'markdown', text: '夜色里，旅馆的灯还亮着。'}], {chatId: 'card-pages', turn: 1})
  const config = {characters, voice: {enabled: false}, stage: {director: false, face: 'off', music: false, theme: 'classic'}}
  const snapshot = {sessionId: SESSION, chatId: 'card-pages', cardPath: 'cards/card-pages.json', from: {turn: 1, para: 1}, config,
    turns: [{turn: 1, body}], paragraphs: [{turn: 1, para: 1, durationMs: 1000, text: '夜色里，旅馆的灯还亮着。'}]}
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
    case 'getSession': return {view: {sessionId: SESSION, mode: 'story', cardPath: snapshot.cardPath, tavernRuntimePolicy: {trustedCardMode: true}, tavernHelper: {version: 1, lifecycleRevision: 1, stateRevision: 1, messages: [], scriptVariables: {}, chatVariables: {}}}}
    case 'readCardPages': return {pages: pages.map(declared), fresh}
    case 'readCardPage': {
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
  await page.addScriptTag({content: stageClientModuleAsScript(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client.js', import.meta.url), 'utf8')) + '\nwindow.clipStage=stageClientPlugin;'})
  await page.evaluate(async ({snapshot, skipTitlePage}) => {
    // The DSH host the core's slash executor writes to: the conversation input of the session.
    window.sent = []
    const actx = {sessionId: 'card-pages-session'}
    const input = {state: {getSnapshot: () => ({draft: window.draft || ''})}, setDraft(text) { window.draft = text; window.sent.push({draft: text}) },
      submit(mode) { window.sent.push({submit: mode, draft: window.draft}); return Promise.resolve({ok: true}) }}
    const idle = {getSnapshot: () => ({byId: {}}), subscribe: () => () => {}}
    window.clipClient.apply({inject() { return {dispose() {}} }, provide() {}, plugin() {}, effect() {},
      get: name => name === 'conversation' ? {input: {for: scope => scope === actx ? input : null}} : undefined,
      sessions: {scope: id => id === 'card-pages-session' ? actx : null, binding: () => null, subagentAddress() {}, list: idle},
      betterSidebar: {registerTab() {}}, tavernSessionSignals: {subscribe() { return () => {} }},
      slots: {inject() {}, register() {}}})
    const core = window.clipClient.clipReplayCore()
    if (skipTitlePage) core.stageReading.set({skipTitlePage: true})
    window.cardPagesCore = core
    window.clipReplay = await window.clipStage.mountClipReplay(core, snapshot, window.cardPagesTransport)
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
  await page.waitForFunction(() => window.sent.some(row => row.submit))
  assert.deepEqual(await page.evaluate(() => window.sent), [{draft: '你好'}, {submit: 'queue', draft: '你好'}])
  await page.keyboard.press('Escape')
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
  await shown.page.keyboard.press('Escape')
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