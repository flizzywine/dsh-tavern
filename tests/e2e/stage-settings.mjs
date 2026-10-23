import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

// 舞台设置, 舞台素材 and 配音 against a real host. Run only against an owned, hidden, muted fresh profile.
// Nothing here makes a sound: the fullscreen stage is opened only while 配音 is off, and no 试听 / 朗读 button is pressed.
// The switches are global, as in the reference design: 舞台模式 (on by default) needs 对话气泡, and so does 配音.
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
  const settingsOf = async () => (await call('getTavernSettings')).settings
  const checked = (label, value) => page.waitForFunction(([label, value]) => document.querySelector('aside[aria-label="舞台设置"] input[aria-label="' + label + '"]')?.checked === value, [label, value])
  const run = Date.now() % 100000
  async function game(name, file, title) {
    const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }) }])
    const card = (await call('importCard', { payload: { kind: 'charx', name: file, fileB64: cardZip.toString('base64') } })).card
    const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name, is_user: false, mes: 'First line.\nSecond line.' }].map(JSON.stringify).join('\n')
    const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text: history, fileName: file + '.jsonl' })
    await call('renameConversation', { sessionId, title })
    return card
  }
  const name = 'Nora ' + run, other = 'Mira ' + run
  await game(name, 'settings-nora.charx', 'Stage settings verification')
  await game(other, 'settings-mira.charx', 'Stage settings other card')
  await page.reload()
  async function openGame(cardName, title) {
    const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: cardName })
    await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByText(title, { exact: true }).first().click()
    await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  }
  await openGame(name, 'Stage settings verification')
  const header = page.getByRole('button', { name: '舞台', exact: true })
  assert.deepEqual([(await settingsOf()).castPresentation, (await settingsOf()).stageToggles], [false, { stage: true, music: true }], 'fresh defaults: 舞台模式 on, 对话气泡 off')
  assert.equal(await header.count(), 0, 'no stage while 对话气泡 is off')

  // 酒馆状态 has no stage settings any more, and no entry while the stage is off.
  await openTab('酒馆状态')
  await page.locator('.dsh-tavern-status-dashboard').filter({ visible: true }).waitFor()
  const status = page.locator('section[aria-label="舞台"]')
  assert.equal(await status.count(), 0)
  assert.equal(await page.getByRole('button', { name: '舞台设置', exact: true }).filter({ visible: true }).count(), 0)

  // 舞台设置 › 基础设置: 对话气泡, 配音 ›, 舞台模式. 配音 and 舞台模式 wait for 对话气泡 (greyed, stored value kept).
  await openFromStart('舞台设置')
  await page.screenshot({ path: join(output, 'start-menu.png') })
  const settings = page.locator('aside[aria-label="舞台设置"]')
  const stageSwitch = settings.getByRole('switch', { name: '舞台模式', exact: true })
  const voiceSwitch = settings.getByRole('switch', { name: '配音', exact: true })
  const bubbleSwitch = settings.getByRole('switch', { name: '对话气泡', exact: true })
  const musicSwitch = settings.getByRole('switch', { name: 'BGM', exact: true })
  await checked('舞台模式', true)
  assert.deepEqual(await rowNames(settings), ['对话气泡', '配音?', '舞台模式?', 'BGM?'])
  assert.deepEqual([await musicSwitch.isChecked(), await musicSwitch.isDisabled()], [true, true], 'BGM is on by default and plays on the stage')
  assert.equal(await settings.getByRole('heading', { name: '基础设置' }).count(), 1)
  assert.deepEqual([await bubbleSwitch.isChecked(), await voiceSwitch.isChecked(), await stageSwitch.isChecked()], [false, false, true])
  assert.deepEqual([await voiceSwitch.isDisabled(), await stageSwitch.isDisabled()], [true, true], '配音 and 舞台模式 need 对话气泡')
  await page.screenshot({ path: join(output, 'settings-off.png') })

  // 对话气泡 on: the stage (舞台模式 already on) appears for this game and every other card's.
  await bubbleSwitch.click()
  await header.waitFor()
  await checked('对话气泡', true)
  assert.deepEqual([(await settingsOf()).castPresentation, (await settingsOf()).stageToggles], [true, { stage: true, music: true }])
  assert.deepEqual([await voiceSwitch.isDisabled(), await stageSwitch.isDisabled()], [false, false])
  await openGame(other, 'Stage settings other card')
  await header.waitFor()
  await openGame(name, 'Stage settings verification')
  await header.waitFor()
  result.dialogueSwitch = result.globalStage = true

  // BGM is one global switch (stageToggles.music).
  await openTab('舞台设置')
  assert.equal(await musicSwitch.isDisabled(), false)
  await musicSwitch.click()
  await page.waitForFunction(() => document.querySelector('aside[aria-label="舞台设置"] input[aria-label="BGM"]')?.checked === false)
  assert.deepEqual((await call('getTavernSettings')).settings.stageToggles, { stage: true, music: false })
  await musicSwitch.click()
  await page.waitForFunction(() => document.querySelector('aside[aria-label="舞台设置"] input[aria-label="BGM"]')?.checked === true)
  assert.deepEqual((await call('getTavernSettings')).settings.stageToggles, { stage: true, music: true })
  result.musicSwitch = true

  // 配音 is the voicing service's one switch; 「›」 opens the 配音 panel with a way back.
  await openTab('舞台设置')
  await voiceSwitch.click()
  await checked('配音', true)
  assert.equal((await call('getSpeechSettings')).enabled, true)
  await settings.getByRole('button', { name: '声音设置', exact: true }).click()
  const voicePanel = page.locator('aside[aria-label="配音"]')
  await voicePanel.waitFor()
  assert.equal(await voicePanel.getByRole('switch', { name: '开启配音', exact: true }).isChecked(), true, 'the same switch')
  await page.screenshot({ path: join(output, 'voice-panel.png') })
  await voicePanel.getByRole('button', { name: '返回舞台设置', exact: true }).click()
  await stageSwitch.waitFor()
  await voiceSwitch.click()
  await checked('配音', false)
  assert.equal((await call('getSpeechSettings')).enabled, false)
  assert.equal(await settings.getByRole('combobox', { name: '舞台样式' }).count(), 0, 'no plugin view, no 舞台样式 row')
  await page.screenshot({ path: join(output, 'settings-on.png') })
  result.voiceSwitch = true

  // 舞台素材 is the card's cast material, each figure's voice included.
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

  // The fullscreen stage has no 设置 or 朗读; the BGM chip and 退出舞台 stay on its bar.
  await header.click()
  const stage = page.locator('.dsh-tavern-stage-overlay')
  await stage.locator('.dsh-tavern-stage-progress').filter({ hasText: '1 / 2' }).waitFor()
  const bar = await stage.locator('.dsh-tavern-stage-controls button').allInnerTexts()
  assert.ok(!bar.includes('设置') && !bar.includes('朗读'), 'control bar: ' + bar.join(' '))
  assert.ok(bar.includes('退出舞台'))
  // The stage is drawn in its skin: 经典, read through the generic skin tokens, not colours of its own.
  assert.equal(await stage.getAttribute('data-fk-skin'), 'classic')
  const paint = selector => stage.locator(selector).first().evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.color, style.borderTopColor, style.borderTopLeftRadius] })
  assert.deepEqual(await paint('.dsh-tavern-stage-textbox'), ['rgb(12, 10, 20)', 'rgb(245, 242, 250)', 'rgb(188, 184, 198)', '10px'])
  assert.deepEqual((await paint('.dsh-tavern-stage-text')).slice(1, 2), ['rgb(245, 242, 250)'])
  await page.screenshot({ path: join(output, 'stage-classic.png') })
  assert.equal(await stage.getByRole('button', { name: 'BGM', exact: true }).count(), 1, 'the BGM chip (no track yet: only ♪)')
  await page.keyboard.press('ArrowRight')
  await stage.locator('.dsh-tavern-stage-progress').filter({ hasText: '2 / 2' }).waitFor()
  assert.deepEqual((await paint('.dsh-tavern-stage-input input')).slice(0, 3), ['rgb(12, 10, 20)', 'rgb(245, 242, 250)', 'rgb(188, 184, 198)'])
  assert.deepEqual((await paint('.dsh-tavern-stage-input button')).slice(0, 2), ['rgb(233, 228, 243)', 'rgb(12, 10, 20)'])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'stage-classic-mobile.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  result.stageSkin = true
  await page.keyboard.press('Escape')
  await stage.waitFor({ state: 'detached' })
  result.stageEntry = true

  // 舞台模式 off removes the entries for every card and survives a reload; 对话气泡 stays on.
  await openTab('舞台设置')
  await stageSwitch.click()
  await header.waitFor({ state: 'detached' })
  await checked('舞台模式', false)
  assert.deepEqual([(await settingsOf()).castPresentation, (await settingsOf()).stageToggles], [true, { stage: false, music: true }])
  assert.deepEqual([await musicSwitch.isChecked(), await musicSwitch.isDisabled()], [true, true], 'BGM keeps its value and waits for 舞台模式')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'settings-mobile.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await openTab('酒馆状态')
  await page.locator('.dsh-tavern-status-dashboard').filter({ visible: true }).waitFor()
  assert.equal(await status.count(), 0, 'the stage entry goes with the switch')
  await page.reload()
  await openGame(other, 'Stage settings other card')
  await page.waitForTimeout(1500)
  assert.equal(await header.count(), 0)
  result.stageModeOff = true

  // On again; then 对话气泡 off takes the stage with it while 舞台模式 keeps its stored value.
  await openFromStart('舞台设置')
  await stageSwitch.click()
  await header.waitFor()
  await bubbleSwitch.click()
  await header.waitFor({ state: 'detached' })
  await checked('对话气泡', false)
  assert.deepEqual([await stageSwitch.isChecked(), await stageSwitch.isDisabled()], [true, true])
  assert.deepEqual([(await settingsOf()).castPresentation, (await settingsOf()).stageToggles], [false, { stage: true, music: true }])
  result.stageNeedsDialogue = true
  await writeFile(join(output, 'stage-settings.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') })
  throw error
} finally { await browser.close() }