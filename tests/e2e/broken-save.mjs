import assert from 'node:assert/strict'
import { readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'

// A save damaged the #196 way, by the released plugin that had the bug, then
// opened with the current plugin: it must heal and regenerate normally.
// Run with TAVERN_E2E_PLUGIN_SOURCE pointing at the old plugin build.
export async function brokenSaveChecks({ page, step, savedChat, output, report, root, data, profile, source, restartServer }) {
  // Either make the damaged save with the old plugin (TAVERN_E2E_PLUGIN_SOURCE), or
  // open a snapshot of one (TAVERN_E2E_RESTORE_DATA) and go straight to healing it.
  const restored = Boolean(process.env.TAVERN_E2E_RESTORE_DATA)
  assert.ok(restored || process.env.TAVERN_E2E_PLUGIN_SOURCE, '需要 TAVERN_E2E_PLUGIN_SOURCE 指向有缺陷的旧版插件，或 TAVERN_E2E_RESTORE_DATA 指向坏档快照')
  const composer = () => page.getByRole('textbox', { name: /发消息|Message/ })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const settled = () => page.getByText('后台结算已完成').last().waitFor({ timeout: 60000 }).catch(() => {})
  const rpcErrors = []
  page.on('response', async response => {
    if (!response.url().includes('/api/dsh-tavern/')) return
    try { const body = await response.json(); if (body && body.ok === false) rpcErrors.push(new URL(response.url()).pathname.split('/').pop() + ': ' + String(body.error || '').slice(0, 200)) } catch {}
  })
  async function nativeTurns(sessionId) {
    const dir = join(root, 'profile-data/tavern/sessions')
    for (const file of await readdir(dir, { recursive: true })) if (file.endsWith('session.v3.jsonl.zstd')) {
      const parsed = parseSessionLog(await readFile(join(dir, file)))
      if (parsed.header.id === sessionId) return parsed.events.filter(event => event.type === 'turn/end' && event.data?.reason?.kind !== 'error').map(event => event.data.turn)
    }
    return []
  }
  const storyRounds = chat => chat.messages.filter(row => row.role === 'assistant' && !row.greeting).length
  async function send(text) {
    const before = (await savedChat()).messages.length
    await composer().fill(text); await composer().press('Enter')
    for (let i = 0; i < 120 && (await savedChat()).messages.length <= before; i++) await pause(500)
    await settled()
  }
  report.brokenSave = {}
  if (!restored) {
  await step('旧版：玩一轮', async () => { await send('领取任务奖励') })
  await step('旧版：模板改写了上一轮输入后再玩一轮（#196 触发条件）', async () => {
    // What a prompt template does to a saved input: the save now differs from the native copy.
    await restartServer(async () => {
      const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: data }) })
      const chat = await savedChat()
      await persistence.update(chat.id, current => {
        const user = current.messages.findLast(row => row.role === 'user')
        user.templateInputSource = user.text
        user.text = user.text + '（模板改写）'
        return current
      })
    })
    await send('再次领取奖励')
    await pause(3000)
    const chat = await savedChat()
    report.brokenSave.oldVersion = { storyRounds: storyRounds(chat), nativeTurns: await nativeTurns(chat.sessionId) }
    assert.equal(storyRounds(chat), 1, '旧版应漏记第二轮（复现 #196）')
  })
  await step('旧版：重新生成如用户所见地失败', async () => {
    await page.getByRole('button', { name: '重新生成正文', exact: true }).filter({ visible: true }).last().click()
    await page.getByPlaceholder('指导意见（可选）').fill('雨夜重写')
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
    for (let i = 0; i < 60 && !rpcErrors.length; i++) await pause(500)
    report.brokenSave.oldRegenErrors = rpcErrors.splice(0)
    assert.ok(report.brokenSave.oldRegenErrors.length, '旧版重新生成应报错')
    await page.screenshot({ path: join(output, 'broken-old.png'), fullPage: true })
  })
  // Snapshot mode: stop with the damaged save on disk (kept with TAVERN_E2E_KEEP=1).
  if (process.env.TAVERN_E2E_BROKEN_STOP === '1') return
  }
  await step('当前版本：对账器发现漏记的一轮', async () => {
    if (!restored) await restartServer(async () => {
      const link = join(profile, 'node_modules', 'dsh-tavern-plugin')
      await rm(link, { force: true })
      await symlink(join(source, 'tavern-plugin'), link)
    })
    const chat = await savedChat()
    const result = await page.evaluate(async sessionId => (await fetch('/api/dsh-tavern/storyAlignment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })).json(), chat.sessionId)
    report.brokenSave.detected = result.alignment
    assert.ok(result.alignment, '当前版本应能核对')
    // Opening the game may already have healed it; otherwise the missing round is reported.
    const story = storyRounds(await savedChat())
    assert.ok(result.alignment.adopt.length === 1 || (result.alignment.aligned && story === 2), '应发现或已补记漏掉的一轮：' + JSON.stringify(result.alignment) + ' 存档轮数 ' + story)
  })
  if (['send', 'send-now'].includes(process.env.TAVERN_E2E_BROKEN_HEAL)) {
    await step('当前版本：直接发送新消息，先补记漏掉的一轮，剧情顺序不乱', async () => {
      rpcErrors.splice(0)
      // Opening the game heals it in the background; the story must not change under the send.
      // 'send-now' sends while the opening reconcile may still run; the turn must wait for it.
      if (process.env.TAVERN_E2E_BROKEN_HEAL === 'send') for (let i = 0; i < 40 && storyRounds(await savedChat()) < 2; i++) await pause(500)
      await composer().fill('继续往前走'); await composer().press('Enter')
      for (let i = 0; i < 120 && storyRounds(await savedChat()) < 3; i++) await pause(500)
      await settled()
      const chat = await savedChat()
      const turns = chat.messages.filter(row => row.role === 'assistant' && !row.greeting).map(row => Number(row.turn))
      report.brokenSave.healedBySend = { turns, errors: rpcErrors.splice(0) }
      assert.deepEqual(report.brokenSave.healedBySend.errors, [])
      assert.equal(turns.length, 3, '补记的一轮加新的一轮')
      assert.deepEqual(turns, [...turns].sort((a, b) => a - b), '补记的一轮排在新一轮之前')
    })
    return
  }
  await step('当前版本：重新生成先补记漏掉的一轮，再正常完成', async () => {
    rpcErrors.splice(0)
    await page.getByRole('button', { name: '重新生成正文', exact: true }).filter({ visible: true }).last().click()
    await page.getByPlaceholder('指导意见（可选）').fill('雨夜重写')
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
    await page.getByText('雨夜里，你重新领取了奖励。', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60000 })
    for (let i = 0; i < 60 && (await savedChat()).regenInProgress; i++) await pause(500)
    await settled()
    const chat = await savedChat()
    report.brokenSave.healed = { storyRounds: storyRounds(chat), errors: rpcErrors.splice(0), last: chat.messages.at(-1).text }
    assert.deepEqual(report.brokenSave.healed.errors, [])
    assert.equal(storyRounds(chat), 2, '补记后存档应有两轮')
    assert.match(chat.messages.at(-1).text, /雨夜里/)
    await page.screenshot({ path: join(output, 'broken-healed.png'), fullPage: true })
  })
  await step('当前版本：回退、再发送都正常', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).click()
    for (let i = 0; i < 40 && storyRounds(await savedChat()) !== 1; i++) await pause(500)
    assert.equal(storyRounds(await savedChat()), 1)
    await send('再次领取奖励')
    assert.equal(storyRounds(await savedChat()), 2)
    assert.deepEqual(rpcErrors.splice(0), [])
  })
}
