import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readZipEntries, writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'

import { crc32, deflateSync } from 'node:zlib'

// A real PNG (the host checks image bytes, not names): a figure-shaped block in one colour.
function figurePng([r, g, b], width = 120, height = 200) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length); return out }
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x++) {
      const head = Math.hypot(x - width / 2, y - height * .18) < width * .2, body = y > height * .32 && Math.abs(x - width / 2) < width * (.18 + .3 * (y / height))
      row.set(head || body ? [r, g, b, 255] : [0, 0, 0, 0], 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

// Stage panels open from the right sidebar's start page (其他); the full-screen reader can send the next input.
export async function openStagePanel(page, title) {
  await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
  await page.locator('.dsh-tavern-start section[aria-label="其他"] .dsh-tavern-start-card').filter({ hasText: new RegExp('^' + title + '$') }).filter({ visible: true }).first().click()
}
export async function castStageChecks({ page, step, output, report }) {
  await step('舞台：舞台素材里导入角色立绘包', async () => {
    const pack = writeZipEntries([{ path: '店主/joy.png', content: figurePng([214, 140, 92]) }, { path: '店主/neutral.png', content: figurePng([150, 150, 170]) }, { path: 'notes.txt', content: 'x' }])
    const chooser = page.waitForEvent('filechooser')
    await openStagePanel(page, '舞台素材')
    await page.getByRole('button', { name: '导入 ST 立绘包', exact: true }).click()
    await (await chooser).setFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: pack })
    await page.getByText('导入 2 张立绘（店主），跳过 1 个文件').waitFor()
    await page.locator('.dsh-tavern-cast-manager-row').filter({ hasText: '店主' }).getByText('2 张立绘', { exact: true }).waitFor()
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(output, 'cast-stage-materials.png') })
    report.castStageMaterials = true
  })
  await step('舞台全屏：逐句翻页，Esc 退出', async () => {
    await page.getByRole('button', { name: '全屏舞台', exact: true }).click()
    const overlay = page.locator('.dsh-tavern-stage-overlay')
    await overlay.locator('.dsh-tavern-stage-progress').filter({ hasText: /^1 \/ \d+$/ }).waitFor()
    const total = Number((await overlay.locator('.dsh-tavern-stage-progress').textContent()).split('/')[1])
    for (let index = 1; index < total; index++) await page.keyboard.press('ArrowRight')
    await overlay.locator('.dsh-tavern-stage-progress').filter({ hasText: total + ' / ' + total }).waitFor()
    await overlay.getByRole('textbox', { name: '舞台输入' }).waitFor()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(output, 'cast-stage-fullscreen.png') })
    for (let index = 1; index < total; index++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await overlay.waitFor({ state: 'detached' })
    report.castStageFullscreen = true
  })
}

// Voicing through an OpenAI-compatible channel: a local stand-in service records what it is asked to say.
export async function castSpeechChecks({ page, step, output, report }) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(body || '{}') })
      res.writeHead(200, { 'content-type': 'audio/mpeg' })
      res.end(Buffer.from('ID3' + 'e2e-audio'.repeat(8)))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await step('配音：设置 OpenAI 兼容渠道，台词行朗读用默认声音，角色素材里换声音后按人物的声音读', async () => {
      const chatUrl = page.url()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByText('配音', { exact: true }).first().click()
      await page.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('openai')
      await page.getByRole('textbox', { name: 'API 根地址', exact: true }).fill('http://127.0.0.1:' + server.address().port + '/v1')
      await page.getByRole('textbox', { name: '模型', exact: true }).fill('tts-1')
      await page.getByLabel('API Key', { exact: true }).fill('sk-e2e')
      await page.getByLabel('默认声音', { exact: true }).fill('alloy')
      await page.getByRole('switch', { name: '开启配音', exact: true }).click()
      await page.getByText('已保存，使用「OpenAI 兼容接口」配音').waitFor()
      assert.equal(await page.getByRole('switch', { name: '开启配音', exact: true }).isChecked(), true)
      await page.screenshot({ path: join(output, 'speech-settings.png') })
      await page.goto(chatUrl)
      const row = page.locator('.dsh-tavern-cast-line').filter({ visible: true }).filter({ hasText: '店主' }).first()
      await row.getByRole('button', { name: '朗读这句', exact: true }).click()
      await expectRequest(requests, request => request.body.voice === 'alloy')
      assert.deepEqual(requests[0].body, { model: 'tts-1', input: '欢迎回来，这是你的奖励。', voice: 'alloy', response_format: 'mp3' })
      assert.equal(requests[0].authorization, 'Bearer sk-e2e')

      await openStagePanel(page, '舞台素材')
      const voice = page.getByLabel('店主 的声音', { exact: true })
      await voice.fill('onyx')
      await voice.press('Enter')
      await page.getByText('已保存 店主 的声音').waitFor()
      const served = page.waitForResponse(response => response.url().includes('/api/dsh-tavern/speech-audio?id='))
      await row.getByRole('button', { name: '朗读这句', exact: true }).click()
      await expectRequest(requests, request => request.body.voice === 'onyx')
      const audio = await served
      assert.equal(audio.status(), 200)
      assert.equal(audio.headers()['content-type'], 'audio/mpeg')
      assert.equal((await page.request.get(new URL('/api/dsh-tavern/speech-audio?id=' + '0'.repeat(64) + '.mp3', page.url()).href)).status(), 404)
      report.castSpeech = true
    })
  } finally { server.close() }
}

async function expectRequest(requests, match) {
  for (let index = 0; index < 100; index++) {
    if (requests.some(match)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('配音服务没有收到预期的请求：' + JSON.stringify(requests.map(request => request.body)))
}

// A CHARX card brings its expressions and background; exporting writes them back.
export async function castCardFileChecks({ page, step, report, savedChat }) {
  await step('CHARX：导入带立绘和背景的卡，素材进角色素材；导出 CHARX 写回', async () => {
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'CHARX 验收', description: '带素材的卡', first_mes: '你好。', group_only_greetings: [], assets: [
      { type: 'icon', uri: 'embeded://assets/icon/images/main.png', name: 'main', ext: 'png' },
      { type: 'emotion', uri: 'embeded://assets/emotion/images/smile.png', name: 'smile', ext: 'png' },
      { type: 'emotion', uri: 'embeded://assets/emotion/images/think.png', name: 'thinking', ext: 'png' },
      { type: 'background', uri: 'embeded://assets/background/images/room.png', name: 'main', ext: 'png' }] } }
    const file = writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'assets/icon/images/main.png', content: figurePng([90, 120, 200]) },
      { path: 'assets/emotion/images/smile.png', content: figurePng([230, 160, 90]) }, { path: 'assets/emotion/images/think.png', content: figurePng([120, 200, 120]) },
      { path: 'assets/background/images/room.png', content: figurePng([40, 40, 60], 160, 90) }])
    const call = (method, args) => page.evaluate(async ([method, args]) => (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json(), [method, args])
    const imported = await call('importCard', { payload: { kind: 'charx', name: 'CHARX 验收.charx', fileB64: file.toString('base64') } })
    assert.equal(imported.ok, true, JSON.stringify(imported))
    assert.deepEqual(imported.card.assets, { sprites: 1, backgrounds: 1, avatars: 0, kept: 1, unmatched: ['thinking'], skipped: 0 })
    const listed = (await call('listCards', {})).cards.find(item => item.path === imported.card.path)
    assert.equal(listed.hasImage, true, 'PNG 卡面当作人物卡封面')
    const exported = await page.request.get(new URL('/api/dsh-tavern/card-export?path=' + encodeURIComponent(imported.card.path), page.url()).href)
    assert.equal(exported.status(), 200)
    const entries = readZipEntries(await exported.body())
    const written = JSON.parse(entries.get('card.json').toString('utf8'))
    assert.equal(written.data.name, 'CHARX 验收')
    assert.equal(written.data.first_mes, '你好。')
    assert.deepEqual(written.data.assets.map(asset => [asset.type, asset.name]), [['icon', 'main'], ['emotion', 'joy'], ['background', 'main'], ['emotion', 'thinking']])
    for (const asset of written.data.assets) assert.ok(entries.has(asset.uri.replace('embeded://', '')), asset.uri)
    report.castCardFile = true
  })
  await step('DSH 人物卡：大文件上传后导入，素材包按内容存储，包内文件按类型提供', async () => {
    const pack = { 'assets/fishpack/manifest.json': JSON.stringify({ id: 'e2e-fish-pack', format: 'dsh-asset-pack', name: '鱼包' }), 'assets/fishpack/media/joy.png': figurePng([240, 180, 80]),
      'assets/fishpack/media/calm.png': figurePng([120, 140, 200]), 'assets/fishpack/page.html': '<script>alert(1)</script>', 'assets/fishpack/credits/CREDITS.md': '作者自制' }
    const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'DSH 卡验收', description: '带素材包', first_mes: '你好。', group_only_greetings: [], assets: [
      { type: 'emotion', uri: 'embeded://assets/fishpack/media/joy.png', name: 'joy', ext: 'png' }, { type: 'emotion', uri: 'embeded://assets/fishpack/media/calm.png', name: 'calm', ext: 'png' }] } }
    const dsh = { format: 'dshcard', formatVersion: 1, card: { version: '1.0.0', title: 'DSH 卡验收', author: 'e2e' }, requires: { tavernApi: 2 }, plugins: [],
      packs: [{ id: 'e2e-fish-pack', title: '鱼包', format: 'dsh-asset-pack', path: 'assets/fishpack/', credits: ['assets/fishpack/credits/CREDITS.md'] }] }
    const file = writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'dsh.json', content: JSON.stringify(dsh) }, ...Object.entries(pack).map(([path, content]) => ({ path, content }))])
    const imported = await importArchive(page, 'DSH 卡验收.dshcard', file)
    assert.equal(imported.format, 'dshcard')
    assert.deepEqual(imported.assets.sprites, 2)
    assert.deepEqual(imported.packs.map(item => [item.id, item.title, item.files, item.reused]), [['e2e-fish-pack', '鱼包', 5, false]])
    const again = await importArchive(page, 'DSH 卡验收.dshcard', file)
    assert.equal(again.packs[0].reused, true, '没有写摘要的包按内容重算，同样内容不重复存')
    assert.notEqual(again.path, imported.path, '再导入一次是另一张卡')
    const fileUrl = path => new URL('/api/dsh-tavern/pack-file?' + new URLSearchParams({ pack: 'e2e-fish-pack', v: imported.packs[0].contentHash, path }), page.url()).href
    const image = await page.request.get(fileUrl('media/joy.png'))
    assert.deepEqual([image.status(), image.headers()['content-type'], image.headers()['content-disposition']], [200, 'image/png', undefined])
    const partial = await page.request.get(fileUrl('media/joy.png'), { headers: { range: 'bytes=0-7' } })
    assert.deepEqual([partial.status(), (await partial.body()).length], [206, 8])
    const html = await page.request.get(fileUrl('page.html'))
    assert.deepEqual([html.headers()['content-type'], html.headers()['content-disposition']], ['application/octet-stream', 'attachment'], '包里的网页只能下载，不在酒馆页面里运行')
    assert.equal((await page.request.get(fileUrl('../card.json'))).status(), 404)
    report.dshCard = { imported: true }

    // A card that carries a plugin: on with the card, confined to it, off from the card library.
    const pluginCard = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ ...card, data: { ...card.data, name: '插件卡验收' } }) },
      { path: 'dsh.json', content: JSON.stringify({ ...dsh, card: { ...dsh.card, title: '插件卡验收' }, packs: [], plugins: [{ name: 'e2e-card-plugin', path: 'plugins/ping/', purpose: '验收' }] }) },
      { path: 'plugins/ping/package.json', content: JSON.stringify({ name: 'dsh-e2e-card-ping', private: true, type: 'module', exports: { '.': './index.mjs' } }) },
      { path: 'plugins/ping/index.mjs', content: "export const name = 'dsh-e2e-card-ping'\nexport const inject = ['tavern']\nexport function apply(ctx) { ctx.tavern.handle('e2e-card/ping', async ({ gameId }) => ({ pong: true, gameId: gameId || '' })) }\n" }])
    const withPlugin = await importArchive(page, '插件卡验收.dshcard', pluginCard)
    assert.deepEqual(withPlugin.plugins.map(item => [item.name, item.enabled]), [['dsh-e2e-card-ping', true]], '导入即启用')
    const repeated = await importArchive(page, '插件卡验收.dshcard', pluginCard)
    assert.deepEqual([repeated.duplicate, repeated.path], [true, withPlugin.path], '同一个文件再导入一次，打开原来那张，不再多出一份')
    const call = (method, args) => page.evaluate(async ([method, args]) => (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json(), [method, args])
    let pong = null
    for (let attempt = 0; attempt < 60 && !pong?.ok; attempt++) { await page.waitForTimeout(500); pong = await call('callPluginHandler', { name: 'e2e-card/ping', args: {} }) }
    assert.deepEqual(pong.result, { pong: true, gameId: '' }, '导入后宿主侧几秒内加载')
    const scopes = await call('cardPluginScopes', {})
    assert.deepEqual(scopes.scopes['dsh-e2e-card-ping'], [withPlugin.path])
    const sessionId = (await savedChat()).sessionId
    const other = await call('callPluginHandler', { name: 'e2e-card/ping', args: { gameId: sessionId } })
    assert.equal(other.ok, false, '别的卡的局调用被拒：' + JSON.stringify(other))
    await call('setCardPlugins', { path: withPlugin.path, enabled: false })
    for (let attempt = 0; attempt < 60 && pong?.ok; attempt++) { await page.waitForTimeout(500); pong = await call('callPluginHandler', { name: 'e2e-card/ping', args: {} }) }
    assert.equal(pong.ok, false, '停用后卸载')
    report.dshCard.plugin = true
  })
}

// 大肥鱼.dshcard (examples/dafeiyu-card): import it with its plugin,
// play a turn, and see the card plugin's stage. Runs last: it opens a game of another card.
const DEMO_CARD = fileURLToPath(new URL('../../examples/dafeiyu-card/大肥鱼.dshcard', import.meta.url))

export async function dshCardPlayChecks({ page, step, output, report }) {
  const cardFile = process.env.TAVERN_E2E_DSHCARD || (existsSync(DEMO_CARD) ? DEMO_CARD : '')
  if (!cardFile) return
  await step('大肥鱼 DSH 人物卡：导入即带上卡内插件，开局后舞台由卡内插件导演', async () => {
    const started = Date.now()
    const card = await importArchive(page, '大肥鱼.dshcard', await readFile(cardFile))
    report.dafeiyu = { importMs: Date.now() - started, sprites: card.assets?.sprites, packs: card.packs.map(item => item.title + ' ' + item.files), plugins: card.plugins.map(item => item.name) }
    const call = (method, args) => page.evaluate(async ([method, args]) => (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json(), [method, args])
    assert.deepEqual(card.plugins.map(item => item.enabled), [true])
    let reply = null
    for (let attempt = 0; attempt < 60; attempt++) {
      reply = await call('callPluginHandler', { name: 'dsh-card-dafeiyu-galgame/scene', args: {} })
      if (!/没有名为/.test(reply.error || '')) break
      await page.waitForTimeout(500)
    }
    assert.doesNotMatch(reply.error || '', /没有名为/, '卡内插件启用后加载')
    // 舞台模式 is global and needs 对话气泡; the card's plugin directs once both are on.
    await call('updateTavernSettings', { patch: { castPresentation: true, stageToggles: { stage: true } } })
    await page.reload()
    await page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).click()
    await page.getByText('大肥鱼', { exact: true }).first().click()
    await page.getByRole('button', { name: '开始新游戏', exact: true }).click()
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.waitFor()
    // A new game opens its settings and status tabs first; open the stage after that.
    await page.getByText(/人物设计档案/).filter({ visible: true }).first().waitFor()
    // The stage look is a row of 舞台设置 › 基础设置 once a plugin offers a stage view.
    await openStagePanel(page, '舞台设置')
    const choice = page.getByRole('combobox', { name: '舞台样式' })
    await choice.locator('option', { hasText: '大肥鱼舞台' }).waitFor({ state: 'attached' })
    await choice.selectOption({ label: '大肥鱼舞台（dsh-card-dafeiyu-galgame）' })
    await page.getByRole('button', { name: '舞台', exact: true }).click()
    const tab = page.locator('.dsh-tavern-stage-overlay')
    // The opening scene comes from the card: living room at night, its music, the maid outfit.
    await tab.getByText(/^现代客厅 · ♪ /).waitFor()
    const portrait = tab.locator('img[alt="大肥鱼"]')
    await portrait.waitFor()
    const opening = await portrait.getAttribute('src')
    report.dafeiyu.opening = await tab.getByText(/^现代客厅 · ♪ /).textContent()
    await page.screenshot({ path: join(output, 'dafeiyu-opening.png') })
    await page.keyboard.press('Escape')
    await composer.fill('一起去地铁站吧')
    await composer.press('Enter')
    // The settlement directs the next scene (the fixed model picks the Claude outfit): the portrait changes.
    await page.getByText('一起去地铁站吧', { exact: true }).filter({ visible: true }).first().waitFor()
    await page.locator('[data-chat-flow-kind="turn-tail"]').last().waitFor({ timeout: 120000 })
    // What the card plugin directed for this turn (the fixed model picks the Claude outfit, night, the first track).
    const game = ((await call('listSessions', {})).sessions || []).find(item => item.cardPath === card.path)
    assert.ok(game, '找到大肥鱼的这一局')
    // Settlement finishes after the reply; poll until it has directed this turn.
    let directed = null
    for (let attempt = 0; attempt < 120; attempt++) {
      directed = await call('callPluginHandler', { name: 'dsh-card-dafeiyu-galgame/scene', args: { gameId: game.sessionId, turn: 2 } })
      if (directed.ok && directed.result.figure.outfit !== '女仆装') break
      await page.waitForTimeout(500)
    }
    assert.equal(directed.ok, true, JSON.stringify(directed))
    assert.equal(directed.result.figure.outfit, 'Claude')
    assert.equal(directed.result.time, 'night')
    report.dafeiyu.directed = { background: directed.result.background.name, outfit: directed.result.figure.outfit, music: directed.result.music.name }
    await page.getByRole('button', { name: '舞台', exact: true }).click()
    // Reopening uses the updated scene.
    await page.waitForFunction(([selector, before]) => { const image = document.querySelector(selector); return image && image.offsetParent && image.getAttribute('src') !== before }, ['.dsh-tavern-stage-overlay img[alt="大肥鱼"]', opening], { timeout: 30000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(output, 'dafeiyu-stage.png') })
    await page.keyboard.press('Escape')
  })
}

async function importArchive(page, name, bytes) {
  const base = new URL('/', page.url()).href
  const upload = await page.request.post(base + 'api/dsh-tavern/card-upload', { data: bytes, headers: { 'content-type': 'application/octet-stream' }, timeout: 600000 })
  const sent = await upload.json()
  assert.equal(sent.ok, true, JSON.stringify(sent))
  const reply = await (await page.request.post(base + 'api/dsh-tavern/importCardUpload', { data: { uploadId: sent.uploadId, name }, timeout: 600000 })).json()
  assert.equal(reply.ok, true, JSON.stringify(reply))
  return reply.card
}

// Run last: it plays one more turn from the full-screen stage.
export async function castStageInputChecks({ page, step, report }) {
  await step('舞台全屏：在最后一句后直接发送下一轮', async () => {
    await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).last().click()
    await page.getByRole('button', { name: '舞台', exact: true }).click()
    const overlay = page.locator('.dsh-tavern-stage-overlay')
    await overlay.waitFor()
    await page.keyboard.press('End')
    for (let index = 0; index < 40 && !(await overlay.getByRole('textbox', { name: '舞台输入' }).count()); index++) await page.keyboard.press('ArrowRight')
    await overlay.getByRole('textbox', { name: '舞台输入' }).fill('舞台里的行动')
    await overlay.getByRole('button', { name: '发送', exact: true }).click()
    await page.keyboard.press('Escape')
    await overlay.waitFor({ state: 'detached' })
    await page.getByText('舞台里的行动', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 })
    await page.locator('[data-chat-flow-kind="turn-tail"]').last().waitFor({ timeout: 60000 })
    report.castStageInput = true
  })
}
