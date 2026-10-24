import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { computeSceneTarget } from '../../tavern-plugin/lib/domain/scene-illustration.js'
import { CAST_DATA_OWNER } from '../../tavern-plugin/lib/domain/cast-annotation.js'

// Skins as asset entries against a real host: 添加文件 › 皮肤 (a skin folder), 包默认, 舞台设置 › 默认皮肤 / 本卡皮肤 and the
// fullscreen stage drawn in the skin the order picks. Run only against an owned, hidden, muted fresh profile: nothing here
// calls a model, and the stage opens only while 配音 is off.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })

// An RGBA PNG drawn by paint(x, y) -> [r, g, b, a].
function png(width, height, paint) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 6], 8)
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(paint(x, y), y * (width * 4 + 1) + 1 + x * 4)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
// An original skin folder: dark ink on paper. Its art layer draws the box from a framed paper image, the name on a plate
// image that grows with the name (slice) and the page cue as a four-cell sheet (frames); the speaker's face in a round ring
// frame with the name along its lower arc (a phone keeps a smaller ring over the box's corner, the lines below it); and the
// control row in the box's top-right corner, drawn as icons on a button body (a phone centres it on the box's top edge).
const folder = join(output, 'paper-skin')
await mkdir(join(folder, 'art'), { recursive: true })
await writeFile(join(folder, 'skin.json'), JSON.stringify({ schema: 'dsh.skin/1', id: 'paper', label: '纸', font: {}, textFx: { reveal: 'type' },
  textbox: { paint: { bg: '#f4efe6', fg: '#1d1a22', fgMuted: '#4a4550', accent: '#2a2440', onAccent: '#ffffff', border: '#4a4550' }, shape: { radius: 4 } },
  nameplate: { shape: 'plain', paint: { bg: '#2a2440', fg: '#ffffff' } },
  quickMenu: { bg: '#f4efe6', fg: '#2a2440', place: 'box-top-right', narrow: 'edge', icons: { back: { image: 'art/back.png' }, auto: { image: 'art/auto.png', on: 'art/auto-on.png' }, skip: { image: 'art/skip.png' } },
    button: { normal: 'art/button.png', hover: 'art/button-hover.png', on: 'art/button-on.png', disabled: 'art/button-off.png', glyph: [.2, .3, .6, .45] } },
  art: { screen: 1080, screenWidth: 1920, textbox: { images: { plain: 'art/box.png' }, body: [0, 40, 1800, 260], bottom: 24, text: [380, 1400, 175], font: 36, lines: 3,
    cue: [1750, 240, 40], next: { image: 'art/next.png', frames: { columns: 4, rows: 1, fps: 8 } }, controls: { x: 1770, y: 56, size: 64, w: 48, gap: 8 } },
    nameplate: { x: 60, y: 6, h: 64, font: 30, image: 'art/plate.png', slice: [8, 24, 8, 24], grow: 400 },
    portrait: { left: 40, bottom: 60, size: 260, frame: { image: 'art/frame.png', left: 10, bottom: 30, window: [40, 60, 260, 260], round: true, front: true, fill: ['#f4efe6', '#d8cfc0'],
      name: { arc: [170, 190, 136], span: 70, font: 28, min: 14, ink: ['#2a2440', '#4a4550'], stroke: { color: '#f4efe6', width: 2 } } },
      narrow: { width: 96, x: 8, y: -48, name: 'arc', nameMin: 10, flow: 'below', left: 14 } } } }, null, 2))
const edge = (x, y, w, h, k) => x < k || y < k || x >= w - k || y >= h - k
await writeFile(join(folder, 'art', 'box.png'), png(1800, 300, (x, y) => y < 40 ? [0, 0, 0, 0] : edge(x, y - 40, 1800, 260, 6) ? [42, 36, 64, 255] : edge(x, y - 40, 1800, 260, 14) ? [244, 239, 230, 255] : edge(x, y - 40, 1800, 260, 16) ? [74, 69, 80, 255] : [244, 239, 230, 240]))
await writeFile(join(folder, 'art', 'plate.png'), png(160, 64, (x, y) => edge(x, y, 160, 64, 3) ? [244, 239, 230, 255] : [42, 36, 64, 255]))
await writeFile(join(folder, 'art', 'next.png'), png(160, 40, (x, y) => Math.abs(x % 40 - 20) + Math.abs(y - 20) < 6 + (x / 40 | 0) * 3 ? [42, 36, 64, 255] : [0, 0, 0, 0]))
// The ring frame (320 px, open in the middle) and the control art: a paper button body per state and three ink glyphs.
const ring = (x, y) => Math.hypot(x - 160, y - 160)
await writeFile(join(folder, 'art', 'frame.png'), png(320, 320, (x, y) => ring(x, y) > 156 ? [0, 0, 0, 0] : ring(x, y) > 146 ? [42, 36, 64, 255] : ring(x, y) > 132 ? [244, 239, 230, 255] : ring(x, y) > 128 ? [74, 69, 80, 255] : [0, 0, 0, 0]))
for (const [file, tone] of [['button', [244, 239, 230]], ['button-hover', [255, 250, 240]], ['button-on', [216, 206, 236]], ['button-off', [200, 196, 190]]]) {
  await writeFile(join(folder, 'art', file + '.png'), png(48, 64, (x, y) => edge(x, y, 48, 64, 3) ? [42, 36, 64, 255] : [...tone, 255]))
}
const glyph = shape => png(32, 32, (x, y) => shape(x - 16, y - 16) ? [42, 36, 64, 255] : [0, 0, 0, 0])
await writeFile(join(folder, 'art', 'back.png'), glyph((x, y) => Math.abs(y) < 10 && x > -Math.abs(y) * .9 - 6 && x < -Math.abs(y) * .9 + 2))
await writeFile(join(folder, 'art', 'auto.png'), glyph((x, y) => x > -8 && x < 10 && Math.abs(y) < (10 - x) * .6))
await writeFile(join(folder, 'art', 'auto-on.png'), glyph((x, y) => Math.hypot(x, y) < 11))
await writeFile(join(folder, 'art', 'skip.png'), glyph((x, y) => (x > -12 && x < 0 || x > 0 && x < 12) && Math.abs(y) < (12 - Math.abs(x % 12 || 0)) * .7))
await writeFile(join(folder, 'notes.txt'), 'not declared: never uploaded')
// The speaker's own avatar (the card's cover): a head and shoulders on a soft ground.
const avatar = png(256, 256, (x, y) => Math.hypot(x - 128, y - 100) < 54 ? [236, 206, 186, 255] : y > 160 && Math.abs(x - 128) < 30 + (y - 160) * 1.1 ? [90, 110, 150, 255] : [170, 190, 210, 255])

const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
const page = pages[0]
page.setDefaultTimeout(20000)
const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
const result = {}
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  await page.setViewportSize({ width: 1920, height: 1080 })
  const name = '林纸鸢'
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {},
    assets: [{ type: 'icon', uri: 'embeded://assets/icon/images/main.png', name: 'main', ext: 'png' }] } }) }, { path: 'assets/icon/images/main.png', content: avatar }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'skin-' + Date.now() + '.charx', fileB64: cardZip.toString('base64') } })).card
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens on a paper stage.\n\n「Welcome. Every page here is drawn by the skin.」\n\nThe lamps dim, and the next page waits.' }].map(JSON.stringify).join('\n')
  // The quote is annotated with its speaker (the settlement's record, through a native save), so page 2 is a named line.
  const imported = await call('importChatHistoryText', { cardPath: card.path, text: history, fileName: 'skin-' + Date.now() + '.jsonl' })
  const save = readGameSave(Buffer.from((await call('exportGameSave', { sessionId: imported.sessionId, images: false })).base64, 'base64'))
  const turn = Math.max(...save.chat.messages.filter(m => m.role === 'assistant').map(m => m.turn || 1))
  const annotation = { version: 1, lines: [{ n: 1, quote: 'Welcome. Every page here is drawn by the skin.', speaker: name, emotion: 'joy' }] }
  save.plugins = { data: { version: 1, owners: { [CAST_DATA_OWNER]: { game: null, turns: [{ turn, key: computeSceneTarget(save.chat, turn).key, data: annotation, bytes: JSON.stringify(annotation).length, updatedAt: 1 }] } } }, media: null, attachments: [] }
  const { sessionId } = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  const title = 'Stage skin ' + Date.now() % 100000
  await call('renameConversation', { sessionId, title })
  await call('updateTavernSettings', { patch: { castPresentation: true } })
  await call('updateSpeechSettings', { enabled: false })
  const packName = '纸皮肤 ' + Date.now() % 100000
  const { pack } = await call('createAssetPack', { name: packName })
  await call('setAssetPackState', { path: card.path, packId: pack.manifest.id, state: 'card' })
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  async function openFromStart(title) {
    await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
    const others = page.locator('.dsh-tavern-start section[aria-label="其他"]').filter({ visible: true })
    await others.locator('.dsh-tavern-start-card').filter({ hasText: new RegExp('^' + title + '$') }).first().click()
  }
  const openTab = title => page.locator('[data-dockkit-tab-title="true"]').filter({ hasText: new RegExp('^' + title + '$'), visible: true }).first().click()

  // 添加文件 › 皮肤: the folder's skin.json and the files it declares become one entry, no lamp; a pack default is marked.
  await openFromStart('舞台素材')
  const materials = page.locator('aside[aria-label="舞台素材"]')
  await materials.locator('.dsh-tavern-pack-row').filter({ hasText: packName }).first().click()
  const win = page.locator('section.dsh-tavern-pack-window[role="dialog"]')
  await win.getByRole('button', { name: '添加文件' }).first().click()
  assert.deepEqual(await page.locator('.dsh-tavern-asset-menu .dsh-tavern-asset-menu-text').allInnerTexts(), ['背景', '音乐', '音效', '环境音', '物品', '皮肤', '入场演出'])
  await page.locator('input[aria-label="添加皮肤"]').setInputFiles(folder)
  await win.getByText('已添加皮肤「纸」').waitFor()
  const stored = (await call('getAssetPack', { packId: pack.manifest.id })).pack
  assert.deepEqual(stored.manifest.files.map(file => file.path).sort(), ['auto', 'auto-on', 'back', 'box', 'button', 'button-hover', 'button-off', 'button-on', 'frame', 'next', 'plate', 'skip']
    .map(file => 'bundles/skin-paper/art/' + file + '.png').concat('bundles/skin-paper/skin.json').sort(), 'only the declared files')
  assert.equal(await win.locator('.dsh-tavern-entry-item .dsh-tavern-asset-lamp-button').count(), 0, 'a skin has no lamp')
  await win.locator('.dsh-tavern-skin-hero .dsh-tavern-skin-art-name').waitFor()
  assert.deepEqual(await win.locator('.dsh-tavern-skin-hero .dsh-tavern-skin-art-box').evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]), ['rgb(244, 239, 230)', 'rgb(29, 26, 34)'])
  await win.getByRole('switch', { name: '设为本包默认皮肤' }).click()
  await win.locator('.dsh-tavern-skin-default').filter({ hasText: '包默认' }).waitFor()
  assert.equal((await call('getAssetPack', { packId: pack.manifest.id })).pack.manifest.stageSkin, 'paper')
  await page.screenshot({ path: join(output, 'pack-skin-1920.png') })
  result.install = true
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: join(output, 'pack-skin-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  // A folder whose skin.json is not a skin is refused with a reason, and nothing is added.
  await win.getByRole('button', { name: '添加文件' }).first().click()
  await writeFile(join(output, 'broken-skin.json'), '{}')
  const broken = join(output, 'broken'); await mkdir(broken, { recursive: true }); await writeFile(join(broken, 'skin.json'), '{"schema":"dsh.skin/1"}')
  await page.locator('input[aria-label="添加皮肤"]').setInputFiles(broken)
  await win.getByText('不是有效的皮肤（skin.json）').waitFor()
  assert.equal((await call('getAssetPack', { packId: pack.manifest.id })).pack.manifest.assets.length, 1)
  result.refused = true
  await win.getByRole('button', { name: '关闭', exact: true }).click()
  await win.waitFor({ state: 'detached' })

  // 舞台设置 › 基础设置: 默认皮肤 then 本卡皮肤, after 舞台模式 and before BGM. 本卡皮肤 follows the default: the pack's 纸.
  await openFromStart('舞台设置')
  const settings = page.locator('aside[aria-label="舞台设置"]')
  await settings.getByRole('button', { name: '本卡皮肤：跟随默认' }).waitFor()
  assert.deepEqual((await settings.locator('.dsh-tavern-switch-name').allInnerTexts()).map(label => label.replace(/\s+/g, '')), ['对话气泡', '配音', '舞台模式', '默认皮肤?', '本卡皮肤?', 'BGM', '音效', '环境音', '物品', '入场演出'])
  await settings.getByRole('button', { name: '默认皮肤：经典' }).waitFor()
  await page.screenshot({ path: join(output, 'settings-1920.png') })
  const header = page.getByRole('button', { name: '舞台', exact: true })
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const drawn = async () => { await header.click(); await stage.waitFor(); await page.waitForTimeout(300); return [await stage.getAttribute('data-fk-skin'), await stage.getAttribute('data-fk-skin-art')] }
  const close = async () => { await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' }) }
  // One failed read of a skin file at stage open: the document draws without its art, the stage asks again and gains it.
  // (The page's own scheme is not routable, so the first read of the box image is failed in the page.)
  await page.evaluate(() => {
    const Native = window.Image, src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set
    window.__skinReads = 0; window.__nativeImage = Native
    window.Image = function () {
      const image = new Native()
      Object.defineProperty(image, 'src', { set(value) { if (/\/art\/box\.png$/.test(value) && window.__skinReads++ === 0) setTimeout(() => image.onerror(new Event('error'))); else src.call(image, value) } })
      return image
    }
  })
  await header.click(); await stage.waitFor()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-overlay')?.getAttribute('data-fk-skin') === 'paper')
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-overlay')?.getAttribute('data-fk-skin-art') === 'box', null, { timeout: 10000 })
  assert.ok(await page.evaluate(() => window.__skinReads) >= 2, 'the art arrived on a second read')
  await page.evaluate(() => { window.Image = window.__nativeImage })
  // A narration page shows no face and no empty frame.
  if (!await stage.locator('.dsh-tavern-stage-name').count()) assert.equal(await stage.locator('.dsh-tavern-stage-side.is-on').count(), 0, 'narration: no face')
  for (let i = 0; i < 4 && !await stage.locator('.dsh-tavern-stage-name').count(); i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250) }
  result.pages = await stage.locator('.dsh-tavern-stage-progress').innerText()
  await page.screenshot({ path: join(output, 'stage-paper-line-1920.png') })
  const art = await stage.evaluate(node => {
    const box = node.querySelector('.dsh-tavern-stage-textbox'), name = node.querySelector('.dsh-tavern-stage-name'), next = node.querySelector('.dsh-tavern-stage-next')
    return { image: getComputedStyle(box, '::before').backgroundImage, plate: name ? getComputedStyle(name).borderImageSource : '', next: next ? next.getAnimations().length : null, fs: parseFloat(getComputedStyle(node.querySelector('.dsh-tavern-stage-text')).fontSize) }
  })
  assert.match(art.image, /\/api\/dsh-asset-library\/v2\/lease\/[^/]+\/art\/box\.png/, 'the box is the skin\'s own image under its lease')
  assert.match(art.plate, /art\/plate\.png/, 'the name stands on the skin\'s 9-sliced plate')
  assert.equal(await stage.locator('.dsh-tavern-stage-name b').innerText(), name)
  assert.ok(Math.abs(art.fs - 36) < 1, 'the text keeps the design size at 1080 high')
  // The face window: the speaker's own avatar in the skin's round frame, the name along its arc; the plate steps aside.
  const portrait = () => stage.evaluate(node => {
    const side = node.querySelector('.dsh-tavern-stage-side'), img = side.querySelector('.dsh-tavern-stage-side-img'), svg = side.querySelector('svg.dsh-tavern-stage-side-name')
    const box = node.querySelector('.dsh-tavern-stage-textbox').getBoundingClientRect(), s = side.getBoundingClientRect(), text = node.querySelector('.dsh-tavern-stage-text').getBoundingClientRect()
    return { on: side.classList.contains('is-on'), src: img?.getAttribute('src') || '', frame: getComputedStyle(side, '::after').backgroundImage, clip: img ? getComputedStyle(img).clipPath : '',
      arc: svg?.querySelector('.dsh-tavern-stage-side-name-ink textPath')?.textContent || '', arcShown: svg ? getComputedStyle(svg).display : 'none',
      plate: node.querySelector('.dsh-tavern-stage-name').getBoundingClientRect().width, at: [s.left - box.left, s.top - box.top, s.width], below: text.top >= s.bottom - 0.5 }
  })
  const face = await portrait()
  assert.ok(face.on && face.src, 'the speaker has a face')
  assert.match(face.frame, /art\/frame\.png/, 'the skin\'s frame stands in front of the face')
  assert.match(face.clip, /^ellipse/, 'the face is cut to the round window')
  assert.deepEqual([face.arc, face.arcShown], [name, 'block'], 'the name runs along the frame')
  assert.ok(face.plate <= 1, 'the plate steps aside while the frame names the speaker')
  assert.ok(Math.abs(face.at[0] + 50) < 1.5 && Math.abs(face.at[2] - 320) < 1.5, 'the frame at its design place: ' + face.at)
  // The control row is the box's own: drawn at art.textbox.controls on the box image, the drawn controls on the skin's body.
  const row = () => stage.evaluate(node => {
    const box = node.querySelector('.dsh-tavern-stage-textbox').getBoundingClientRect(), row = node.querySelector('.dsh-tavern-stage-controls').getBoundingClientRect()
    const auto = node.querySelector('.dsh-tavern-stage-controls button[data-action="auto"]')
    return { box: [box.left, box.top, box.right, box.bottom], row: [row.left, row.top, row.right, row.bottom], drawn: [...node.querySelectorAll('.dsh-tavern-stage-controls button.has-icon')].map(button => button.dataset.action),
      auto: auto.getBoundingClientRect().toJSON(), label: auto.getAttribute('aria-label'), body: auto.querySelector('.dsh-tavern-stage-control-body')?.getAttribute('src') || '', icon: auto.querySelector('.dsh-tavern-stage-control-icon')?.getAttribute('src') || '' }
  })
  const wide = await row()
  assert.deepEqual(wide.drawn, ['back', 'auto', 'skip'])
  assert.equal(wide.label, '自动')
  assert.ok(wide.row[0] >= wide.box[0] && wide.row[2] <= wide.box[2] + 0.5 && wide.row[1] >= wide.box[1] && wide.row[3] <= wide.box[3] + 0.5, 'the controls stand on the box')
  assert.ok(Math.abs(wide.box[2] - wide.row[2] - 30) < 1.5 && Math.abs(wide.row[1] - wide.box[1] - 16) < 1.5, 'the row at its design place: ' + JSON.stringify(wide))
  assert.deepEqual([Math.round(wide.auto.width), Math.round(wide.auto.height)], [48, 64])
  assert.match(wide.body, /art\/button\.png$/)
  await stage.locator('.dsh-tavern-stage-controls button[data-action="auto"]').click()
  const running = await row()
  await stage.locator('.dsh-tavern-stage-controls button[data-action="auto"]').click()
  assert.match(running.body, /art\/button-on\.png$/, 'auto on: the body\'s on state')
  assert.match(running.icon, /art\/auto-on\.png$/, 'auto on: the icon\'s on image')
  for (let i = 0; i < 4 && !await stage.locator('.dsh-tavern-stage-name').count(); i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250) }
  result.art = { ...art, face: face.at, row: wide.row }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(400)
  // A phone: the ring stands over the box's top-left corner and the lines start under it; the row centres on the box's top edge.
  const phone = await portrait(), narrow = await row()
  assert.ok(phone.on && Math.abs(phone.at[0] - 8) < 1 && Math.abs(phone.at[1] + 48) < 1 && Math.abs(phone.at[2] - 96) < 1, 'the phone face place: ' + phone.at)
  assert.ok(phone.below, 'the lines start under the face')
  assert.ok(narrow.row[1] < narrow.box[1] && narrow.row[3] > narrow.box[1] && narrow.row[2] <= narrow.box[2], 'the row on the box\'s top edge: ' + JSON.stringify(narrow))
  assert.ok(narrow.row[0] >= narrow.box[0] + phone.at[0] + phone.at[2] - 0.5, 'the row stops short of the face')
  assert.deepEqual([Math.round(narrow.auto.width), Math.round(narrow.auto.height)], [44, 44], '44px targets')
  assert.ok(await stage.evaluate(node => parseFloat(getComputedStyle(node.querySelector('.dsh-tavern-stage-text')).fontSize)) >= 17, 'phone reading size')
  await page.screenshot({ path: join(output, 'stage-paper-line-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await close()
  assert.deepEqual(await drawn(), ['paper', 'box'], 'the pack default draws the stage, its art included')
  // The last page: the input docks above the box image, clear of it, at both widths.
  while (!await stage.locator('.dsh-tavern-stage-input').count()) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250) }
  const docked = () => stage.evaluate(node => {
    const box = node.querySelector('.dsh-tavern-stage-textbox'), image = box.getBoundingClientRect().top + parseFloat(getComputedStyle(box, '::before').top)
    const input = node.querySelector('.dsh-tavern-stage-textbox > .dsh-tavern-stage-input').getBoundingClientRect(), row = node.querySelector('.dsh-tavern-stage-controls').getBoundingClientRect()
    // clear of the face window's top and of a row on the box's edge too
    return input.bottom <= Math.min(image, node.querySelector('.dsh-tavern-stage-side').getBoundingClientRect().top + 0.5, row.top + 0.5)
  })
  assert.ok(await docked(), 'the input stands above the box image')
  await page.screenshot({ path: join(output, 'stage-paper-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(300)
  assert.ok(await docked(), 'the input stands above the box image on a phone')
  await page.screenshot({ path: join(output, 'stage-paper-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await close()
  result.packDefault = true

  // 本卡皮肤 › 经典 wins over the pack default for this card; 跟随默认 goes back.
  await settings.getByRole('button', { name: '本卡皮肤：跟随默认' }).click()
  const menu = page.locator('.dsh-tavern-asset-menu[aria-label="本卡皮肤"]')
  assert.deepEqual(await menu.locator('.dsh-tavern-asset-menu-text').allInnerTexts(), ['跟随默认', '经典', '纸'])
  await page.screenshot({ path: join(output, 'card-skin-menu-1920.png') })
  await menu.getByRole('menuitemradio', { name: '经典' }).click()
  await settings.getByRole('button', { name: '本卡皮肤：经典' }).waitFor()
  assert.equal((await call('getStageSkins', { path: card.path })).card.choice, 'classic')
  assert.deepEqual(await drawn(), ['classic', null])
  await close()
  // Keyboard: the picker opens on Enter with the current choice focused; ↑ and Enter choose.
  await settings.getByRole('button', { name: '本卡皮肤：经典' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-checked') === 'true')
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
  await settings.getByRole('button', { name: '本卡皮肤：跟随默认' }).waitFor()
  assert.deepEqual(await drawn(), ['paper', 'box'])
  await close()
  result.cardChoice = true

  // Deleting the skin: the stage passes down the order (pack default gone → 默认皮肤 经典); nothing stored is rewritten.
  await openTab('舞台素材')
  await materials.locator('.dsh-tavern-pack-row').filter({ hasText: packName }).first().click()
  await win.getByRole('button', { name: '更多操作 纸', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除…' }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await win.getByText('已删除').waitFor()
  await win.getByRole('button', { name: '关闭', exact: true }).click()
  await openTab('舞台设置')
  assert.deepEqual(await drawn(), ['classic', null])
  await close()
  assert.equal((await call('getAssetPack', { packId: pack.manifest.id })).pack.manifest.stageSkin, 'paper')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: join(output, 'settings-375.png') })
  result.fallback = true
  await page.reload()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  assert.equal((await call('getStageSkins', { path: card.path })).global, 'classic')
  result.reload = true
  // --real-skin DIR: the same steps with a real art skin folder, for the record shots only (never committed).
  const real = process.argv.includes('--real-skin') ? process.argv[process.argv.indexOf('--real-skin') + 1] : null
  if (real) {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openTab('舞台素材')
    await materials.locator('.dsh-tavern-pack-row').filter({ hasText: packName }).first().click()
    await win.getByRole('button', { name: '添加文件' }).first().click()
    await page.locator('input[aria-label="添加皮肤"]').setInputFiles(real)
    await win.getByText(/已添加皮肤/).waitFor()
    const id = JSON.parse(await (await import('node:fs/promises')).readFile(join(real, 'skin.json'), 'utf8')).id
    const realPack = (await call('getAssetPack', { packId: pack.manifest.id })).pack
    await call('setCardStageSkin', { path: card.path, skin: { packId: realPack.manifest.id, kind: 'skins', assetId: id } })
    await win.getByRole('button', { name: '关闭', exact: true }).click()
    await openTab('舞台设置')
    await header.click(); await stage.waitFor()
    await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-overlay')?.hasAttribute('data-fk-skin-art'), null, { timeout: 15000 })
    await page.waitForTimeout(800)
    for (const [shot, width, height] of [['1920', 1920, 1080], ['375', 375, 812]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(500)
      assert.equal(await stage.evaluate(node => node.getBoundingClientRect().width), width, 'the stage fills the screen')
      while (!await stage.locator('.dsh-tavern-stage-input').count()) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250) }
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(output, 'real-end-' + shot + '.png') })
      while (!await stage.locator('.dsh-tavern-stage-name').count()) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250) }
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(output, 'real-' + shot + '.png') })
    }
    result.real = await stage.getAttribute('data-fk-skin')
  }
} finally {
  await writeFile(join(output, 'stage-skins.json'), JSON.stringify(result, null, 2) + '\n')
  await browser.close().catch(() => {})
}
console.log(JSON.stringify(result))
