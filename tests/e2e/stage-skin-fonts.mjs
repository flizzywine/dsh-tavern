import assert from 'node:assert/strict'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { computeSceneTarget } from '../../tavern-plugin/lib/domain/scene-illustration.js'
import { CAST_DATA_OWNER } from '../../tavern-plugin/lib/domain/cast-annotation.js'

// The stage's fonts against a real host: 经典 draws in the font library's 霞鹜新晰黑; a skin folder ships one WOFF2 face
// (font.faces) whose fallback is a library family, the stage draws its text and controls in the face (the glyphs it lacks in
// the fallback) and its name in the library family the skin names; back on 经典 the stage draws as before. Run only against
// an owned, hidden, muted fresh profile: nothing here calls a model.
const endpoint = process.env.TAVERN_STAGE_TEST_CDP
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !endpoint || new URL(endpoint).port === '9333' || !process.argv.includes('--artifacts')) throw Error('Requires an owned fresh-profile CDP, --isolated and --artifacts DIR; never use a live browser')
await mkdir(output, { recursive: true })

// The fixture face is the OFL Font Awesome Free solid face the client already vendors: it has glyphs for A-Z, a-z and 0-9
// (drawn as icons, unmistakable on the stage) and none for Chinese, which then falls back.
const folder = join(output, 'type-skin')
await mkdir(join(folder, 'fonts'), { recursive: true })
await copyFile(fileURLToPath(new URL('../../tavern-plugin/lib/vendor/runtime-assets/fontawesome/webfonts/fa-solid-900.woff2', import.meta.url)), join(folder, 'fonts', 'sample-icons.woff2'))
await writeFile(join(folder, 'skin.json'), JSON.stringify({ schema: 'dsh.skin/1', id: 'type', label: '字体', textFx: { reveal: 'type' },
  // body: the skin's own face, then its fallback from the library; name: a library family; ui follows body.
  font: { body: 'sample-icons', name: 'resource-han-rounded', faces: { 'sample-icons': { file: 'fonts/sample-icons.woff2', weight: 900, fallback: 'noto-sans-sc' } } },
  textbox: { paint: { bg: '#101418', fg: '#f2f2f2', fgMuted: '#c0c4c8', accent: '#7fd0ff', onAccent: '#000000', border: '#c0c4c8' }, shape: { radius: 8 } },
  nameplate: { shape: 'plain', paint: { bg: '#101418', fg: '#f2f2f2' } } }, null, 2))
await writeFile(join(folder, 'notes.txt'), 'not declared: never uploaded')

const browser = await chromium.connectOverCDP(endpoint)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
const page = pages[0]
page.setDefaultTimeout(20000)
const cdp = await page.context().newCDPSession(page)
await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
// The faces Chromium actually drew a node's text with (its own text and its descendants'), by family and glyph count.
async function drawn(selector) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  const faces = {}
  const walk = async id => {
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id })
    for (const font of fonts) faces[font.familyName] = (faces[font.familyName] || 0) + font.glyphCount
    const { node } = await cdp.send('DOM.describeNode', { nodeId: id, depth: 1 })
    for (const child of node.children || []) if (child.nodeType === 1) {
      const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [child.backendNodeId] })
      await walk(nodeIds[0])
    }
  }
  await walk(nodeId)
  return faces
}
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
  // 苏, 晓, 鸢, 这, 边, 说, 话, 写 are Simplified Chinese only (not in a Japanese face's JIS set).
  const name = '苏晓鸢'
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'fonts-' + Date.now() + '.charx', fileB64: cardZip.toString('base64') } })).card
  const quote = 'Type 42：这边说话，边写边看。'
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.\n\n「' + quote + '」\n\nThe lamps dim.' }].map(JSON.stringify).join('\n')
  const imported = await call('importChatHistoryText', { cardPath: card.path, text: history, fileName: 'fonts-' + Date.now() + '.jsonl' })
  const save = readGameSave(Buffer.from((await call('exportGameSave', { sessionId: imported.sessionId, images: false })).base64, 'base64'))
  const turn = Math.max(...save.chat.messages.filter(m => m.role === 'assistant').map(m => m.turn || 1))
  const annotation = { version: 1, lines: [{ n: 1, quote, speaker: name, emotion: 'joy' }] }
  save.plugins = { data: { version: 1, owners: { [CAST_DATA_OWNER]: { game: null, turns: [{ turn, key: computeSceneTarget(save.chat, turn).key, data: annotation, bytes: JSON.stringify(annotation).length, updatedAt: 1 }] } } }, media: null, attachments: [] }
  const { sessionId } = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  const title = 'Skin fonts ' + Date.now() % 100000
  await call('renameConversation', { sessionId, title })
  await call('updateTavernSettings', { patch: { castPresentation: true } })
  await call('updateSpeechSettings', { enabled: false })
  const packName = '字体皮肤 ' + Date.now() % 100000
  const { pack } = await call('createAssetPack', { name: packName })
  await call('setAssetPackState', { path: card.path, packId: pack.manifest.id, state: 'card' })
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: name }).and(page.locator(`[title="${card.path}"]`))
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  const header = page.getByRole('button', { name: '舞台', exact: true })
  const stage = page.locator('.dsh-tavern-stage-overlay')
  const close = async () => { await page.keyboard.press('Escape'); await stage.waitFor({ state: 'detached' }) }
  // The named line, typed out (a click finishes the typewriter).
  async function openLine() {
    await header.click(); await stage.waitFor()
    // The stage reopens on the page it was left at: back to the first, then on to the named line.
    for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150) }
    for (let i = 0; i < 4 && !await stage.locator('.dsh-tavern-stage-name').count(); i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250) }
    await stage.locator('.dsh-tavern-stage-name').waitFor()
    await stage.locator('.dsh-tavern-stage-text').click()
    await page.waitForTimeout(600)
  }
  const look = () => stage.evaluate(node => {
    const family = selector => node.querySelector(selector) ? getComputedStyle(node.querySelector(selector)).fontFamily : null
    const loaded = prefix => [...document.fonts].map(face => [face.family.replace(/"/g, ''), face.weight, face.status]).filter(([family, , status]) => family.startsWith(prefix) && status === 'loaded')
    return { text: family('.dsh-tavern-stage-text'), name: family('.dsh-tavern-stage-name'), control: family('.dsh-tavern-stage-controls button'), root: getComputedStyle(node).fontFamily,
      faces: [...document.fonts].map(face => [face.family.replace(/"/g, ''), face.weight, face.status]).filter(([family]) => family.startsWith('DSH Skin')), library: loaded('Tavern ').map(([family]) => family).sort() }
  })
  const stack = '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
  const settle = async prefix => { await page.waitForFunction(prefix => [...document.fonts].some(face => face.family.replace(/"/g, '').startsWith(prefix) && face.status === 'loaded'), prefix, { timeout: 15000 }); await page.waitForTimeout(300) }

  // 经典: the library's 霞鹜新晰黑 for every role, ahead of the stage's stack; the browser fetched it and drew the line with it.
  await openLine()
  await settle('Tavern neo-xihei-screen')
  const before = await look()
  for (const role of ['text', 'name', 'control', 'root']) assert.equal(before[role], '"Tavern neo-xihei-screen", ' + stack, role)
  assert.deepEqual(before.faces, [])
  assert.deepEqual(before.library, ['Tavern neo-xihei-screen'])
  result.classic = { ...before, drawn: await drawn('.dsh-tavern-stage-text'), nameDrawn: await drawn('.dsh-tavern-stage-name') }
  assert.ok(Object.keys(result.classic.drawn).some(family => /XiHei/i.test(family)), 'the line is drawn in 霞鹜新晰黑: ' + JSON.stringify(result.classic.drawn))
  assert.ok(Object.keys(result.classic.nameDrawn).some(family => /XiHei/i.test(family)), 'so is the name: ' + JSON.stringify(result.classic.nameDrawn))
  await page.screenshot({ path: join(output, 'classic-1920.png') })
  await close()

  // 添加文件 › 皮肤: the face ships with the skin entry (declared in font.faces); 本卡皮肤 draws the stage in it.
  await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
  await page.locator('.dsh-tavern-start section[aria-label="其他"]').filter({ visible: true }).locator('.dsh-tavern-start-card').filter({ hasText: /^舞台素材$/ }).first().click()
  await page.locator('aside[aria-label="舞台素材"]').filter({ visible: true }).locator('.dsh-tavern-pack-row').filter({ hasText: packName }).first().click()
  const win = page.locator('section.dsh-tavern-pack-window[role="dialog"]')
  await win.getByRole('button', { name: '添加文件' }).first().click()
  await page.locator('input[aria-label="添加皮肤"]').setInputFiles(folder)
  await win.getByText('已添加皮肤「字体」').waitFor()
  const stored = (await call('getAssetPack', { packId: pack.manifest.id })).pack
  assert.deepEqual(stored.manifest.files.map(file => file.path).sort(), ['bundles/skin-type/fonts/sample-icons.woff2', 'bundles/skin-type/skin.json'], 'the face is the skin\'s declared file')
  await win.getByRole('button', { name: '关闭', exact: true }).click()
  await call('setCardStageSkin', { path: card.path, skin: { packId: pack.manifest.id, kind: 'skins', assetId: 'type' } })
  await openLine()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-overlay')?.getAttribute('data-fk-skin') === 'type')
  await settle('DSH Skin sample-icons'); await settle('Tavern noto-sans-sc'); await settle('Tavern resource-han-rounded')
  const skinned = await look()
  await page.screenshot({ path: join(output, 'skin-look-1920.png') })
  assert.deepEqual(skinned.faces, [['DSH Skin sample-icons', '900', 'loaded']], 'the face at its declared weight')
  const body = '"DSH Skin sample-icons", "Tavern noto-sans-sc", ' + stack
  assert.deepEqual([skinned.text, skinned.control, skinned.root, skinned.name], [body, body, body, '"Tavern resource-han-rounded", ' + stack])
  result.skin = { ...skinned, drawn: await drawn('.dsh-tavern-stage-text'), nameDrawn: await drawn('.dsh-tavern-stage-name') }
  assert.ok(result.skin.drawn['Font Awesome 6 Free Solid'] >= 6, 'the Latin glyphs come from the skin\'s face: ' + JSON.stringify(result.skin.drawn))
  assert.ok(Object.keys(result.skin.drawn).some(family => /Noto Sans SC/i.test(family)), 'the glyphs the face lacks come from its fallback: ' + JSON.stringify(result.skin.drawn))
  assert.ok(Object.keys(result.skin.nameDrawn).some(family => /Resource Han Rounded/i.test(family)), 'the name is in the library family it names: ' + JSON.stringify(result.skin.nameDrawn))
  await page.screenshot({ path: join(output, 'skin-1920.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(500)
  assert.equal((await look()).text, body)
  await page.screenshot({ path: join(output, 'skin-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  // The last page's menu (a ui role) draws in the face too.
  while (!await stage.locator('.dsh-tavern-stage-choices').count()) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250) }
  result.choices = await stage.locator('.dsh-tavern-stage-choices button').first().evaluate(node => getComputedStyle(node).fontFamily)
  assert.equal(result.choices, body)
  await page.screenshot({ path: join(output, 'skin-end-1920.png') })
  await close()
  assert.deepEqual(await page.evaluate(() => [...document.fonts].filter(face => face.family.includes('DSH Skin')).length), 0, 'the face leaves with the stage')

  // Back to 经典: exactly the type it had before the skin.
  await call('setCardStageSkin', { path: card.path, skin: 'classic' })
  await openLine()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-stage-overlay')?.getAttribute('data-fk-skin') === 'classic')
  const after = await look()
  assert.deepEqual({ ...after, library: undefined }, { ...before, library: undefined }, '经典 draws as before')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(output, 'classic-375.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await close()
  result.restored = true
} finally {
  await writeFile(join(output, 'stage-skin-fonts.json'), JSON.stringify(result, null, 2) + '\n')
  await browser.close().catch(() => {})
}
console.log(JSON.stringify(result))
