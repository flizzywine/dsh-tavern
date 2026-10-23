import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

// 舞台素材 (the asset library's editor) against a real host. Run only against an owned, hidden, muted fresh profile.
// Nothing here makes a sound: 舞台模式 stays off (no BGM), no 试听 button is pressed, and every media element is muted.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })

// An original synthetic picture: a two-colour gradient with a horizon line.
function png(width, height, [r1, g1, b1], [r2, g2, b2]) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 2], 8)
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1), line = Math.abs(y - Math.round(height * .62)) < 2
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3
      rows[at] = line ? 250 : Math.round(r1 + (r2 - r1) * t); rows[at + 1] = line ? 240 : Math.round(g1 + (g2 - g1) * t); rows[at + 2] = line ? 220 : Math.round(b1 + (b2 - b1) * t)
    }
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
// A quiet sine tone as 16-bit mono WAV (8 kHz); it is never played here.
function tone(hz, seconds = 2) {
  const samples = 8000 * seconds, bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / 8000) * 3000), 44 + i * 2)
  return bytes
}

const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
const page = pages[0]
page.setDefaultTimeout(20000)
await page.addInitScript(() => {
  const play = HTMLMediaElement.prototype.play
  window.stageTestPlays = 0
  HTMLMediaElement.prototype.play = function (...args) { this.muted = true; window.stageTestPlays++; return play.apply(this, args) }
})
const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
const result = {}
const shot = async (name, width, height) => {
  if (width) await page.setViewportSize({ width, height })
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(output, name + '.png') })
}
async function openFromStart(title) {
  await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
  const others = page.locator('.dsh-tavern-start section[aria-label="其他"]').filter({ visible: true })
  await others.waitFor()
  await others.locator('.dsh-tavern-start-card').filter({ hasText: new RegExp('^' + title + '$') }).first().click()
}
const openTab = title => page.locator('[data-dockkit-tab-title="true"]').filter({ hasText: new RegExp('^' + title + '$'), visible: true }).first().click()
const windowOf = name => page.locator('section.dsh-tavern-pack-window[role="dialog"]').filter({ has: page.getByRole('heading', { name, exact: true }) })
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  await page.setViewportSize({ width: 1920, height: 1080 })
  const name = 'Nora ' + Date.now() % 100000
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'assets-nora.charx', fileB64: cardZip.toString('base64') } })).card
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name, is_user: false, mes: 'First line.' }].map(JSON.stringify).join('\n')
  const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text: history, fileName: 'stage-assets.jsonl' })
  const title = 'Stage assets verification'
  await call('renameConversation', { sessionId, title })
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()

  // 舞台素材 starts with the library: no packs yet, one empty state; the card's cast material stays below.
  await openFromStart('舞台素材')
  const materials = page.locator('aside[aria-label="舞台素材"]')
  const library = materials.locator('section.dsh-tavern-asset-library')
  await library.getByText('还没有素材包', { exact: true }).waitFor()
  assert.equal(await materials.locator('.dsh-tavern-stage-materials-cast').count(), 1, 'cast material below the library')
  await shot('library-empty-1920')
  result.emptyLibrary = true

  // ＋ makes a pack in place (Enter creates); the new pack opens in its window, empty but for 添加文件.
  await library.getByRole('button', { name: '新建素材包', exact: true }).click()
  await library.getByRole('textbox', { name: '新素材包名称' }).fill('校园')
  await page.keyboard.press('Enter')
  const campus = windowOf('校园')
  await campus.getByText('还没有内容', { exact: true }).waitFor()
  await shot('pack-empty-1920')

  // 添加文件 › 背景 / 音乐: one entry per file, named after it, 蓝灯; a file that is no picture is reported.
  await campus.getByRole('button', { name: '添加文件' }).click()
  await page.locator('input[aria-label="添加背景"]').setInputFiles([
    { name: '教室.png', mimeType: 'image/png', buffer: png(640, 360, [120, 170, 230], [250, 220, 180]) },
    { name: '走廊.png', mimeType: 'image/png', buffer: png(640, 360, [60, 80, 120], [200, 150, 120]) },
    { name: '坏文件.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') }])
  await campus.getByText(/^已添加 2 项；没能添加：坏文件$/).waitFor()
  await campus.getByRole('button', { name: '添加文件' }).click()
  await page.locator('input[aria-label="添加音乐"]').setInputFiles([{ name: '放学后.wav', mimeType: 'audio/wav', buffer: tone(330) }])
  await campus.getByRole('tab', { name: '音乐' }).waitFor()
  const packId = (await call('listAssetPacks')).packs.find(pack => pack.manifest?.name === '校园').manifest.id
  let pack = (await call('getAssetPack', { packId })).pack
  assert.deepEqual(pack.manifest.assets.map(asset => [asset.kind, asset.name, asset.recall.mode]), [['backgrounds', '教室', 'constant'], ['backgrounds', '走廊', 'constant'], ['music', '放学后', 'constant']])
  result.upload = true

  // The background entry: lamp, trigger words (linted by the host when written), director note.
  await campus.getByRole('tab', { name: '背景' }).click()
  await campus.getByRole('listbox', { name: '背景' }).getByRole('button', { name: '教室', exact: true }).click()
  const detail = campus.locator('.dsh-tavern-pack-right')
  await detail.getByRole('button', { name: '触发策略：蓝灯' }).click()
  await page.getByRole('menuitemradio', { name: '绿灯' }).click()
  await detail.getByRole('button', { name: '触发策略：绿灯' }).waitFor()
  await detail.getByRole('button', { name: '添加触发词', exact: true }).click()
  const word = detail.getByRole('textbox', { name: '添加触发词' })
  await word.fill('教室'); await page.keyboard.press('Enter')
  await detail.getByRole('alert').filter({ hasText: '「教室」：须有 3–6 个触发词' }).waitFor()
  pack = (await call('getAssetPack', { packId })).pack
  assert.deepEqual(pack.manifest.assets[0].recall.keywords, [], 'a refused word is not stored')
  await shot('trigger-lint-1920')
  await word.fill('黑板'); await page.keyboard.press('Enter')
  await word.fill('讲台'); await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.dsh-tavern-pack-right .dsh-tavern-asset-chips [role="alert"]'))
  await detail.getByRole('button', { name: '添加导演说明', exact: true }).click()
  await detail.getByRole('textbox', { name: '导演说明' }).fill('上课、自习、放学前的教室场景')
  await page.keyboard.press('Enter')
  await page.waitForFunction(async packId => {
    const reply = await (await fetch('/api/dsh-tavern/getAssetPack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packId }) })).json()
    return reply.pack.manifest.assets[0].directorNote === '上课、自习、放学前的教室场景'
  }, packId)
  pack = (await call('getAssetPack', { packId })).pack
  assert.deepEqual([pack.manifest.assets[0].recall.mode, pack.manifest.assets[0].recall.keywords], ['keyword', ['教室', '黑板', '讲台']])
  result.entryEdit = { lamp: 'keyword', words: 3, note: true }
  await shot('entry-background-1920')

  // The music entry: the player and 音量 (keyboard: ← steps 5%, saved on the step). Nothing is played.
  await campus.getByRole('tab', { name: '背景' }).focus()
  await page.keyboard.press('ArrowRight')
  await campus.getByRole('tab', { name: '音乐', selected: true }).waitFor()
  await detail.getByRole('slider', { name: '音量' }).focus()
  await page.keyboard.press('ArrowLeft')
  await detail.getByText('95%', { exact: true }).waitFor()
  await page.keyboard.press('ArrowLeft')
  await detail.getByText('90%', { exact: true }).waitFor()
  assert.equal((await call('getAssetPack', { packId })).pack.manifest.assets[2].volume, 0.9)
  await shot('entry-music-1920')
  result.volume = 0.9

  // Esc closes the window; focus goes back to where it was opened from.
  await page.keyboard.press('Escape')
  await campus.waitFor({ state: 'detached' })

  // 本卡: the card binds the pack, at once and without a question; the director's catalog follows.
  await library.getByRole('button', { name: '校园：关闭，更改' }).click()
  await page.getByRole('menuitemradio', { name: '本卡' }).click()
  await library.getByRole('button', { name: '校园：本卡，更改' }).waitFor()
  assert.deepEqual((await call('getCardAssetPacks', { path: card.path })).boundPackIds, [packId])
  result.cardBinding = true

  // A second pack, on for every card (全局).
  await library.getByRole('button', { name: '新建素材包', exact: true }).click()
  await library.getByRole('textbox', { name: '新素材包名称' }).fill('共享曲集')
  await page.keyboard.press('Enter')
  const shared = windowOf('共享曲集')
  await shared.getByRole('button', { name: '添加文件' }).click()
  await page.locator('input[aria-label="添加音乐"]').setInputFiles([{ name: '黄昏.wav', mimeType: 'audio/wav', buffer: tone(262) }])
  await shared.getByRole('listbox', { name: '音乐' }).waitFor()
  await shared.getByRole('button', { name: '关闭', exact: true }).click()
  await library.getByRole('button', { name: '共享曲集：关闭，更改' }).click()
  await page.getByRole('menuitemradio', { name: '全局' }).click()
  await library.getByRole('button', { name: '共享曲集：全局，更改' }).waitFor()
  const sharedId = (await call('listAssetPacks')).packs.find(row => row.manifest?.name === '共享曲集').manifest.id
  assert.deepEqual((await call('getTavernSettings')).settings.globalEnabledPackIds, [sharedId])
  await shot('library-1920')
  result.globalPack = true

  // 舞台设置 › 素材包 lists this card's packs (全局 first); BGM › offers the two packs with music and opens one at 音乐,
  // with ‹ back to 舞台设置.
  await openFromStart('舞台设置')
  const settings = page.locator('aside[aria-label="舞台设置"]')
  const current = settings.getByRole('list', { name: '当前素材包' })
  await current.waitFor()
  assert.deepEqual(await current.locator('.dsh-tavern-pack-name').allInnerTexts(), ['共享曲集', '校园'])
  await shot('settings-packs-1920')
  await settings.getByRole('button', { name: '在舞台素材查看BGM' }).click()
  await page.getByRole('menuitem', { name: '校园' }).click()
  const jumped = windowOf('校园')
  await jumped.getByRole('tab', { name: '音乐', selected: true }).waitFor()
  await shot('bgm-jump-1920')
  await jumped.getByRole('button', { name: '返回舞台设置', exact: true }).click()
  await settings.getByRole('list', { name: '当前素材包' }).waitFor()
  result.bgmJump = true

  // 375: the library, the window as one column, the entry as its own page with ‹ back to the list.
  await openTab('舞台素材')
  await library.getByRole('button', { name: '打开 校园' }).waitFor()
  await shot('library-375', 375, 812)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await library.getByRole('button', { name: '打开 校园' }).click()
  const narrow = windowOf('校园')
  await narrow.getByRole('listbox', { name: '背景' }).waitFor()
  await shot('pack-list-375', 375, 812)
  await narrow.locator('.dsh-tavern-pack-right').waitFor({ state: 'hidden' })
  await narrow.getByRole('listbox', { name: '背景' }).getByRole('button', { name: '教室', exact: true }).click()
  await narrow.getByRole('button', { name: '返回背景' }).waitFor()
  assert.equal(await narrow.locator('.dsh-tavern-pack-left').isVisible(), false, 'one column: the entry replaces the list')
  await shot('entry-375')
  await narrow.getByRole('button', { name: '返回背景' }).click()
  await narrow.getByRole('listbox', { name: '背景' }).waitFor()
  result.narrow = true

  // Deleting an entry asks first; deleting the pack also takes it out of the card (no card keeps a dangling id).
  await page.setViewportSize({ width: 1920, height: 1080 })
  await narrow.getByRole('listbox', { name: '背景' }).getByRole('button', { name: '走廊', exact: true }).click()
  await narrow.getByRole('button', { name: '更多操作 走廊' }).click()
  await page.getByRole('menuitem', { name: '删除…' }).click()
  const confirmEntry = page.getByRole('dialog', { name: '删除背景「走廊」？' })
  await shot('delete-entry-1920')
  await confirmEntry.getByRole('button', { name: '删除', exact: true }).click()
  await narrow.getByText('已删除', { exact: true }).waitFor()
  assert.deepEqual((await call('getAssetPack', { packId })).pack.manifest.assets.map(asset => asset.name), ['教室', '放学后'])
  await narrow.getByRole('button', { name: '更多操作 校园' }).click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.getByRole('dialog', { name: '删除「校园」？' }).getByRole('button', { name: '确认删除' }).click()
  await narrow.waitFor({ state: 'detached' })
  assert.deepEqual((await call('getCardAssetPacks', { path: card.path })).boundPackIds, [], 'the card no longer binds the deleted pack')
  assert.equal(await library.getByRole('button', { name: '打开 校园' }).count(), 0)
  result.deletion = true

  result.mediaPlays = await page.evaluate(() => window.stageTestPlays)
  assert.equal(result.mediaPlays, 0, 'nothing played')
  await writeFile(join(output, 'stage-assets.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') })
  throw error
} finally { await browser.close() }
