import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

// Skins as asset entries against a real host: 添加文件 › 皮肤 (a skin folder), 包默认, 舞台设置 › 默认皮肤 / 本卡皮肤 and the
// fullscreen stage drawn in the skin the order picks. Run only against an owned, hidden, muted fresh profile: nothing here
// calls a model, and the stage opens only while 配音 is off.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })

function png(r, g, b) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))])
}
// An original skin folder: dark ink on paper, its box drawn from one image beside skin.json.
const folder = join(output, 'paper-skin')
await mkdir(join(folder, 'art'), { recursive: true })
await writeFile(join(folder, 'skin.json'), JSON.stringify({ schema: 'dsh.skin/1', id: 'paper', label: '纸', font: {}, textFx: { reveal: 'type' },
  textbox: { paint: { bg: '#f4efe6', fg: '#1d1a22', fgMuted: '#4a4550', accent: '#2a2440', onAccent: '#ffffff', border: '#4a4550' }, shape: { radius: 4 } },
  nameplate: { shape: 'plain', paint: { bg: '#2a2440', fg: '#ffffff' } },
  art: { screen: 900, textbox: { images: { plain: 'art/box.png' }, body: [0, 0, 1, 1], bottom: 20, text: [0, 1, 0], font: 28, lines: 3 } } }, null, 2))
await writeFile(join(folder, 'art', 'box.png'), png(244, 239, 230))
await writeFile(join(folder, 'notes.txt'), 'not declared: never uploaded')

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
  const name = 'Iris ' + Date.now() % 100000
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'skin-' + Date.now() + '.charx', fileB64: cardZip.toString('base64') } })).card
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }].map(JSON.stringify).join('\n')
  const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text: history, fileName: 'skin-' + Date.now() + '.jsonl' })
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
  assert.deepEqual(await page.locator('.dsh-tavern-asset-menu .dsh-tavern-asset-menu-text').allInnerTexts(), ['背景', '音乐', '皮肤'])
  await page.locator('input[aria-label="添加皮肤"]').setInputFiles(folder)
  await win.getByText('已添加皮肤「纸」').waitFor()
  const stored = (await call('getAssetPack', { packId: pack.manifest.id })).pack
  assert.deepEqual(stored.manifest.files.map(file => file.path).sort(), ['bundles/skin-paper/art/box.png', 'bundles/skin-paper/skin.json'], 'only the declared files')
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
  assert.deepEqual((await settings.locator('.dsh-tavern-switch-name').allInnerTexts()).map(label => label.replace(/\s+/g, '')), ['对话气泡', '配音', '舞台模式', '默认皮肤?', '本卡皮肤?', 'BGM'])
  await settings.getByRole('button', { name: '默认皮肤：经典' }).waitFor()
  await page.screenshot({ path: join(output, 'settings-1920.png') })
  const header = page.getByRole('button', { name: '舞台', exact: true })
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const drawn = async () => { await header.click(); await stage.waitFor(); const value = [await stage.getAttribute('data-fk-skin'), await stage.locator('.dsh-tavern-stage-textbox').first().evaluate(node => getComputedStyle(node).backgroundColor)]; return value }
  const close = async () => { await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' }) }
  assert.deepEqual(await drawn(), ['paper', 'rgb(244, 239, 230)'], 'the pack default draws the stage')
  await page.screenshot({ path: join(output, 'stage-paper-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
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
  assert.deepEqual(await drawn(), ['classic', 'rgb(12, 10, 20)'])
  await close()
  // Keyboard: the picker opens on Enter with the current choice focused; ↑ and Enter choose.
  await settings.getByRole('button', { name: '本卡皮肤：经典' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-checked') === 'true')
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
  await settings.getByRole('button', { name: '本卡皮肤：跟随默认' }).waitFor()
  assert.deepEqual(await drawn(), ['paper', 'rgb(244, 239, 230)'])
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
  assert.deepEqual(await drawn(), ['classic', 'rgb(12, 10, 20)'])
  await close()
  assert.equal((await call('getAssetPack', { packId: pack.manifest.id })).pack.manifest.stageSkin, 'paper')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: join(output, 'settings-375.png') })
  result.fallback = true
  await page.reload()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  assert.equal((await call('getStageSkins', { path: card.path })).global, 'classic')
  result.reload = true
} finally {
  await writeFile(join(output, 'stage-skins.json'), JSON.stringify(result, null, 2) + '\n')
  await browser.close().catch(() => {})
}
console.log(JSON.stringify(result))
