import assert from 'node:assert/strict'
import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { currentSessionLogs } from './session-files.mjs'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'

export async function setupRealGameplay({ root, profile, data, runtimeHome }) {
  const settings = await readFile(join(runtimeHome, 'settings.yaml'), 'utf8').then(parse, () => ({}))
  const patch = await readFile(join(runtimeHome, 'profiles/tavern/cordis.patch.yml'), 'utf8').then(parse, () => [])
  const selection = settings['agent-default-model'] || patch.find(row => row.id === 'agent-default-model')?.config
  assert.ok(selection?.provider && selection?.model, '需要配置真实模型')
  assert.ok(process.env.TAVERN_E2E_PLAY_CARD, '需要 TAVERN_E2E_PLAY_CARD')
  await writeFile(join(root, 'settings.yaml'), stringify({ 'agent-default-model': selection, ...(settings['llm-pi-ai'] ? { 'llm-pi-ai': settings['llm-pi-ai'] } : {}) }), { mode: 0o600 })
  await copyFile(join(runtimeHome, '.credentials.yaml'), join(root, '.credentials.yaml'))
  await writeFile(join(profile, 'cordis.patch.yml'), stringify([{ id: 'agent-default-model', config: selection }]))
  await writeFile(join(data, 'tavern-settings.json'), JSON.stringify({ defaultForegroundModel: selection, defaultBackgroundModel: selection, backgroundModel: selection, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false } }))
  const raw = JSON.parse(await readFile(process.env.TAVERN_E2E_PLAY_CARD, 'utf8'))
  const card = raw.raw || raw
  await writeFile(join(data, 'resources/cards/e2e.json'), JSON.stringify(card))
  return { model: selection, card: (card.data || card).name }
}

export async function realGameplayChecks({ page, step, savedChat, output, report, restartServer, root }) {
  const story = chat => chat.messages.map(({ role, text, sourceText, turn, greeting }) => ({ role, text, sourceText, turn, greeting }))
  const composer = () => page.getByRole('textbox', { name: /下一步行动|Next action|发消息|Message/ })
  async function poll(label, check) {
    const deadline = Date.now() + 240000
    let tick = Date.now()
    while (Date.now() < deadline) {
      const chat = await savedChat()
      if (chat.foregroundError) throw Error(JSON.stringify(chat.foregroundError))
      if (await check(chat)) return chat
      if (Date.now() - tick > 30000) { console.log('等待真实模型：' + label); tick = Date.now() }
      await page.waitForTimeout(500)
    }
    throw Error(label + '超时')
  }
  async function send(input) {
    const before = await savedChat()
    if (input) await composer().fill(input)
    await composer().press('Enter')
    return poll('正文完成', chat => chat.messages.length > before.messages.length && chat.messages.at(-1).role === 'assistant' && chat.settleStatus === 'done')
  }
  async function capture(name) {
    await page.screenshot({ path: join(output, name + '.png'), fullPage: true })
    await writeFile(join(output, name + '.json'), JSON.stringify(story(await savedChat()), null, 2))
  }
  let third, regenerated
  await step('真实卡开场并与真实模型完成第一轮', async () => {
    assert.ok((await savedChat()).messages.some(row => row.greeting))
    await send('我接过温水，向老板道谢，点一杯热茶，询问镇上有什么值得散步的地方。请简短回应。')
    await capture('real-round-1')
  })
  await step('真实模型生成候选行动，选择并发送第二轮', async () => {
    const before = story(await savedChat())
    await page.getByRole('button', { name: '生成候选项', exact: true }).click()
    const panel = page.locator('.dsh-tavern-candidate-question')
    await panel.getByText(/^[1-9]\d* 个$/).waitFor({ timeout: 240000 })
    const expand = panel.getByTitle('展开行动列表', { exact: true })
    if (await expand.isVisible()) await expand.click()
    const choices = panel.locator('button.dsh-tavern-question-option')
    await choices.first().waitFor({ timeout: 240000 })
    assert.deepEqual(story(await savedChat()), before)
    const choice = choices.first()
    await choice.click()
    assert.ok((await composer().innerText()).trim(), '选择候选应填写输入框')
    await send()
    await capture('real-round-2')
  })
  await step('真实模型第三轮，并刷新验证正文持久化', async () => {
    third = await send('我记下路线，询问老板路上有没有适合买一份小礼物的店铺。请简短回应。')
    await page.reload({ waitUntil: 'domcontentloaded' }); await composer().waitFor()
    assert.deepEqual(story(await savedChat()), story(third))
    await capture('real-round-3')
  })
  await step('带指导意见重生成，替换最新正文且保留前文', async () => {
    await page.getByRole('button', { name: '重新生成正文', exact: true }).click()
    await page.getByPlaceholder('指导意见（可选）').fill('请换一种回答：老板推荐一家木雕小店，并提到店门口挂着蓝色风铃。保持简短。')
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
    regenerated = await poll('重生成', chat => chat.messages.length === third.messages.length && chat.messages.at(-1).text !== third.messages.at(-1).text && chat.settleStatus === 'done')
    assert.deepEqual(story(regenerated).slice(0, -1), story(third).slice(0, -1))
    assert.match(regenerated.messages.at(-1).text, /蓝色|风铃|木雕/)
    await capture('real-regenerated')
  })
  await step('回退最新轮次，重启后保持回退结果并能继续游玩', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).click()
    const rolled = await poll('回退', chat => chat.messages.length === regenerated.messages.length - 2)
    assert.deepEqual(story(rolled), story(regenerated).slice(0, -2))
    await restartServer(); await composer().waitFor()
    assert.deepEqual(story(await savedChat()), story(rolled))
    await send('我先留在客栈喝茶，请老板介绍一下这间客栈的来历。请简短回应。')
    await capture('real-after-rollback')
  })
  const usage = []
  for (const file of await currentSessionLogs(join(root, 'profile-data/tavern/sessions'))) {
    for (const event of parseSessionLog(await readFile(file.path)).events) {
      if (event.type !== 'assistant/message') continue
      const value = event.data.usage || event.data.stream?.filter(item => item.type === 'chunk' && item.chunk?.type === 'usage').at(-1)?.chunk.usage
      if (value) usage.push(value)
    }
  }
  assert.ok(usage.length >= 5, '原生会话应记录真实模型调用用量')
  report.usage = { calls: usage.length, inputTokens: usage.reduce((sum, row) => sum + (row.inputTokens || 0), 0), outputTokens: usage.reduce((sum, row) => sum + (row.outputTokens || 0), 0), cacheReadTokens: usage.reduce((sum, row) => sum + (row.cacheReadTokens || 0), 0) }
  report.realGameplay = { realModel: true, generatedReplies: 5, candidateSelection: true, regeneration: true, rollback: true, restartAndContinue: true }
}
