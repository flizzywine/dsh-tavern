import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
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

// The stage: right panel, character material, full-screen reader that can send the next input.
export async function castStageChecks({ page, step, output, report }) {
  await step('插件舞台：导演插件定下的地点和时间画在舞台上，可选回内置舞台', async () => {
    await page.getByRole('button', { name: '舞台', exact: true }).filter({ visible: true }).first().click()
    const choice = page.getByRole('combobox', { name: '舞台样式' })
    assert.equal(await choice.inputValue(), 'tavern-plugin-director:scene', '装了插件舞台时默认用它')
    await page.locator('.dsh-tavern-stage-tab').getByText('酒馆大堂 · 夜晚', { exact: true }).waitFor()
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(output, 'cast-stage-plugin.png') })
    await choice.selectOption('dsh-tavern:builtin')
    report.castStagePlugin = true
  })
  await step('舞台：右侧小舞台按台词换人，导入立绘包后显示立绘', async () => {
    const scene = page.locator('.dsh-tavern-stage-tab .dsh-tavern-stage-scene')
    await scene.waitFor()
    // Opens at the turn's last annotated line.
    await page.locator('.dsh-tavern-stage-tab .dsh-tavern-stage-name').filter({ hasText: '你' }).waitFor()
    await page.getByRole('button', { name: '上一句', exact: true }).first().click()
    await page.locator('.dsh-tavern-stage-tab .dsh-tavern-stage-name').filter({ hasText: '店主' }).waitFor()
    assert.equal(await scene.locator('.dsh-tavern-stage-figure-letter').first().textContent(), '店')
    const pack = writeZipEntries([{ path: '店主/joy.png', content: figurePng([214, 140, 92]) }, { path: '店主/neutral.png', content: figurePng([150, 150, 170]) }, { path: 'notes.txt', content: 'x' }])
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入 ST 立绘包', exact: true }).click()
    await (await chooser).setFiles({ name: 'pack.zip', mimeType: 'application/zip', buffer: pack })
    await page.getByText('导入 2 张立绘（店主），跳过 1 个文件').waitFor()
    await scene.locator('.dsh-tavern-stage-figure img[alt="店主"]').waitFor()
    assert.match(await scene.locator('.dsh-tavern-stage-figure img[alt="店主"]').getAttribute('src'), /\/api\/dsh-tavern\/cast-asset\?card=[0-9a-f]{64}&file=[0-9a-f]{32}\.png/)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(output, 'cast-stage-panel.png') })
    report.castStagePanel = true
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
      await page.getByText('DSH Tavern', { exact: true }).first().click()
      await page.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('openai')
      await page.getByRole('textbox', { name: 'API 根地址', exact: true }).fill('http://127.0.0.1:' + server.address().port + '/v1')
      await page.getByRole('textbox', { name: '模型', exact: true }).fill('tts-1')
      await page.getByLabel('API Key', { exact: true }).fill('sk-e2e')
      await page.getByLabel('默认声音', { exact: true }).fill('alloy')
      await page.getByRole('switch', { name: '配音', exact: true }).click()
      await page.getByText('已保存，使用「OpenAI 兼容接口」配音').waitFor()
      assert.equal(await page.getByRole('switch', { name: '配音', exact: true }).isChecked(), true)
      await page.screenshot({ path: join(output, 'speech-settings.png') })
      await page.goto(chatUrl)
      const row = page.locator('.dsh-tavern-cast-line').filter({ visible: true }).filter({ hasText: '店主' }).first()
      await row.getByRole('button', { name: '朗读这句', exact: true }).click()
      await expectRequest(requests, request => request.body.voice === 'alloy')
      assert.deepEqual(requests[0].body, { model: 'tts-1', input: '欢迎回来，这是你的奖励。', voice: 'alloy', response_format: 'mp3' })
      assert.equal(requests[0].authorization, 'Bearer sk-e2e')

      await page.getByRole('button', { name: '舞台', exact: true }).filter({ visible: true }).first().click()
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
export async function castCardFileChecks({ page, step, report }) {
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
    const exported = await page.request.get(new URL('/api/dsh-tavern/card-charx?path=' + encodeURIComponent(imported.card.path), page.url()).href)
    assert.equal(exported.status(), 200)
    const entries = readZipEntries(await exported.body())
    const written = JSON.parse(entries.get('card.json').toString('utf8'))
    assert.equal(written.data.name, 'CHARX 验收')
    assert.equal(written.data.first_mes, '你好。')
    assert.deepEqual(written.data.assets.map(asset => [asset.type, asset.name]), [['icon', 'main'], ['emotion', 'joy'], ['background', 'main'], ['emotion', 'thinking']])
    for (const asset of written.data.assets) assert.ok(entries.has(asset.uri.replace('embeded://', '')), asset.uri)
    report.castCardFile = true
  })
}

// Run last: it plays one more turn from the full-screen stage.
export async function castStageInputChecks({ page, step, report }) {
  await step('舞台全屏：在最后一句后直接发送下一轮', async () => {
    await page.getByRole('button', { name: '舞台', exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: '全屏舞台', exact: true }).click()
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
