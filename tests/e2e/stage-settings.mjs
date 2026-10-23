import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

// 舞台设置, 舞台素材 and 配音 against a real host. Run only against an owned, hidden, muted fresh profile.
// Nothing here makes a sound: the fullscreen stage is opened only while 配音 is off, and no 试听 / 朗读 button is pressed.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })

function png(r, g, b) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))])
}

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
const openTab = title => page.locator('[data-dockkit-tab-title="true"]').filter({ hasText: new RegExp('^' + title + '$') }).first().click()
// The stage panels are listed on the right sidebar's start page, under 「其他」.
async function openFromStart(title) {
  await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
  const others = page.locator('.dsh-tavern-start section[aria-label="其他"]').filter({ visible: true })
  await others.waitFor()
  const labels = await others.locator('.dsh-tavern-start-label').allInnerTexts()
  const stage = labels.filter(label => ['舞台设置', '舞台素材', '配音'].includes(label))
  assert.deepEqual(stage, ['舞台设置', '舞台素材', '配音'], 'three separate stage panels under 其他, in order: ' + labels.join('、'))
  await others.locator('.dsh-tavern-start-card').filter({ hasText: new RegExp('^' + title + '$') }).first().click()
}
const rowNames = async panel => (await panel.locator('.dsh-tavern-switch-name').allInnerTexts()).map(name => name.replace(/\s+/g, ''))
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  const name = 'Nora ' + Date.now() % 100000
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'settings-nora.charx', fileB64: cardZip.toString('base64') } })).card
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name, is_user: false, mes: 'First line.\nSecond line.' }].map(JSON.stringify).join('\n')
  const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text: history, fileName: 'stage-settings.jsonl' })
  const title = 'Stage settings verification'
  await call('renameConversation', { sessionId, title })
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  const header = page.getByRole('button', { name: '舞台', exact: true })
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  assert.equal(await header.count(), 0, 'an ordinary card shows no stage entry')

  // 酒馆状态 has no stage settings any more, and no entry while the stage is off.
  await openTab('酒馆状态')
  await page.locator('.dsh-tavern-status-dashboard').filter({ visible: true }).waitFor()
  const status = page.locator('section[aria-label="舞台"]')
  assert.equal(await status.count(), 0)
  assert.equal(await page.getByRole('button', { name: '舞台设置', exact: true }).filter({ visible: true }).count(), 0)

  // 舞台设置 › 基础设置: 对话气泡, 配音 ›, 舞台模式. 配音 needs something that marks speakers.
  await openFromStart('舞台设置')
  await page.screenshot({ path: join(output, 'start-menu.png') })
  const settings = page.locator('aside[aria-label="舞台设置"]')
  const stageSwitch = settings.getByRole('switch', { name: '舞台模式', exact: true })
  const voiceSwitch = settings.getByRole('switch', { name: '配音', exact: true })
  const bubbleSwitch = settings.getByRole('switch', { name: '对话气泡', exact: true })
  await stageSwitch.waitFor()
  assert.deepEqual(await rowNames(settings), ['对话气泡', '配音?', '舞台模式'])
  assert.equal(await settings.getByRole('heading', { name: '基础设置' }).count(), 1)
  assert.deepEqual([await bubbleSwitch.isChecked(), await voiceSwitch.isChecked(), await stageSwitch.isChecked()], [false, false, false])
  assert.equal(await voiceSwitch.isDisabled(), true, '配音 waits for 对话气泡 or 舞台模式')
  await page.screenshot({ path: join(output, 'settings-off.png') })

  // 舞台模式 is this card's stage switch.
  await stageSwitch.click()
  await header.waitFor()
  await settings.getByText('已保存', { exact: true }).waitFor()
  assert.equal(await stageSwitch.isChecked(), true)
  assert.equal((await call('cardStage', { path: card.path })).enabled, true, 'the switch writes the card')
  assert.equal(await voiceSwitch.isDisabled(), false, 'the stage marks speakers, so 配音 can be turned on')
  result.stageModeOn = true

  // 配音 is the voicing service's one switch; 「›」 opens the 配音 panel with a way back.
  await voiceSwitch.click()
  await page.waitForFunction(() => document.querySelector('aside[aria-label="舞台设置"] input[aria-label="配音"]')?.checked === true)
  assert.equal((await call('getSpeechSettings')).enabled, true)
  await settings.getByRole('button', { name: '声音设置', exact: true }).click()
  const voicePanel = page.locator('aside[aria-label="配音"]')
  await voicePanel.waitFor()
  assert.equal(await voicePanel.getByRole('switch', { name: '开启配音', exact: true }).isChecked(), true, 'the same switch')
  await page.screenshot({ path: join(output, 'voice-panel.png') })
  await voicePanel.getByRole('button', { name: '返回舞台设置', exact: true }).click()
  await stageSwitch.waitFor()
  await voiceSwitch.click()
  await page.waitForFunction(() => document.querySelector('aside[aria-label="舞台设置"] input[aria-label="配音"]')?.checked === false)
  assert.equal((await call('getSpeechSettings')).enabled, false)
  result.voiceSwitch = true

  // 对话气泡 is the global castPresentation setting.
  await bubbleSwitch.click()
  await page.waitForFunction(() => document.querySelector('aside[aria-label="舞台设置"] input[aria-label="对话气泡"]')?.checked === true)
  assert.equal((await call('getTavernSettings')).settings.castPresentation, true)
  await bubbleSwitch.click()
  await page.waitForFunction(() => document.querySelector('aside[aria-label="舞台设置"] input[aria-label="对话气泡"]')?.checked === false)
  assert.equal((await call('getTavernSettings')).settings.castPresentation, false)
  assert.equal(await settings.getByRole('combobox', { name: '舞台样式' }).count(), 0, 'no plugin view, no 舞台样式 row')
  await page.screenshot({ path: join(output, 'settings-on.png') })
  result.dialogueSwitch = true

  // 舞台素材 is the card's cast material.
  await openFromStart('舞台素材')
  const materials = page.locator('aside[aria-label="舞台素材"]')
  const chooser = page.waitForEvent('filechooser')
  await materials.getByRole('button', { name: '导入 ST 立绘包', exact: true }).click()
  await (await chooser).setFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: writeZipEntries([{ path: 'joy.png', content: png(210, 90, 40) }]) })
  await materials.getByText(/^导入 1 张立绘/).waitFor()
  await materials.locator('.dsh-tavern-cast-manager-row').filter({ hasText: name }).getByText('1 张立绘', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'materials.png') })
  result.materials = true

  // 酒馆状态 keeps only the entry.
  await openTab('酒馆状态')
  await status.getByRole('button', { name: '全屏舞台', exact: true }).waitFor()
  assert.deepEqual(await status.getByRole('button').allInnerTexts(), ['全屏舞台'])
  assert.equal(await page.getByText('角色素材', { exact: true }).filter({ visible: true }).count(), 0, 'no cast material parked in 酒馆状态')

  // The fullscreen stage has no 设置 or 朗读; ♪ (when music plays) and 退出舞台 stay on its bar.
  await header.click()
  const stage = page.locator('.dsh-tavern-stage-overlay')
  await stage.locator('.dsh-tavern-stage-progress').filter({ hasText: '1 / 2' }).waitFor()
  const bar = await stage.locator('.dsh-tavern-stage-controls button').allInnerTexts()
  assert.ok(!bar.includes('设置') && !bar.includes('朗读'), 'control bar: ' + bar.join(' '))
  assert.ok(bar.includes('退出舞台'))
  await page.keyboard.press('ArrowRight')
  await stage.locator('.dsh-tavern-stage-progress').filter({ hasText: '2 / 2' }).waitFor()
  await page.keyboard.press('Escape')
  await stage.waitFor({ state: 'detached' })
  result.stageEntry = true

  // Turning 舞台模式 off removes the entries; the choice is the card's and survives a reload.
  await openTab('舞台设置')
  await stageSwitch.click()
  await header.waitFor({ state: 'detached' })
  assert.equal(await voiceSwitch.isDisabled(), true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'settings-mobile.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await openTab('酒馆状态')
  await page.locator('.dsh-tavern-status-dashboard').filter({ visible: true }).waitFor()
  assert.equal(await status.count(), 0, 'the stage entry goes with the switch')
  assert.equal((await call('cardStage', { path: card.path })).enabled, false)
  await page.reload()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  await page.waitForTimeout(1500)
  assert.equal(await header.count(), 0)
  result.stageModeOff = true
  await writeFile(join(output, 'stage-settings.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') })
  throw error
} finally { await browser.close() }
