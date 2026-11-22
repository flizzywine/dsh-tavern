import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'

// The save is the truth (Wiki「设计：native-session-repair」). Damage the model
// context's agreement with the save while the server is down, then play on: the
// game must heal itself, every history action must work, and what the model reads
// must be what the save says.
export async function nativeRepairChecks({ page, step, savedChat, output, report, data, restartServer }) {
  const composer = () => page.getByRole('textbox', { name: /下一步行动|Next action|发消息|Message/ })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const settled = () => page.getByText('后台结算已完成').last().waitFor({ timeout: 60000 }).catch(() => {})
  const storyRounds = chat => chat.messages.filter(row => row.role === 'assistant' && !row.greeting).length
  const rpcErrors = []
  page.on('response', async response => {
    if (!response.url().includes('/api/dsh-tavern/')) return
    try { const body = await response.json(); if (body && body.ok === false) rpcErrors.push(new URL(response.url()).pathname.split('/').pop() + ': ' + String(body.error || '').slice(0, 200)) } catch {}
  })
  async function send(text) {
    const before = storyRounds(await savedChat())
    await composer().fill(text); await composer().press('Enter')
    for (let i = 0; i < 120 && storyRounds(await savedChat()) <= before; i++) await pause(500)
    await settled()
  }
  async function lastRequest() {
    const lines = (await readFile(join(output, 'context-requests.jsonl'), 'utf8')).trim().split('\n')
    return JSON.parse(lines.at(-1)).messages.map(message => message.text).join('\n')
  }
  async function alignment() {
    const chat = await savedChat()
    return (await page.evaluate(async sessionId => (await fetch('/api/dsh-tavern/storyAlignment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })).json(), chat.sessionId)).alignment
  }
  report.nativeRepair = {}

  await step('玩两轮', async () => {
    await send('领取任务奖励')
    await send('再次领取奖励')
    assert.equal(storyRounds(await savedChat()), 2)
  })
  const oldText = (await savedChat()).messages.at(-1).text
  await step('停服时只改存档：最后一轮正文变了，模型上下文还是旧的', async () => {
    await restartServer(async () => {
      const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: data }) })
      const chat = await savedChat()
      await persistence.update(chat.id, current => {
        const last = current.messages.findLast(row => row.role === 'assistant')
        for (const field of ['text', 'sourceText', 'projectionText', 'displayText']) last[field] = 'E2E_REPAIR_EDITED 存档里改过的正文。'
        if (Array.isArray(last.swipes)) last.swipes[Number(last.swipeId) || 0] = last.text
        delete last.bodyEdit
        return current
      })
    })
  })
  await step('打开即修复：存档与模型上下文一致', async () => {
    let result
    for (let i = 0; i < 20 && !(result = await alignment())?.aligned; i++) await pause(500)
    report.nativeRepair.afterOpen = result
    assert.ok(result?.aligned, '打开后应已修复：' + JSON.stringify(result))
  })
  await step('继续游玩：模型读到的是存档里的正文，不是旧正文', async () => {
    await send('第三次领取奖励')
    const request = await lastRequest()
    report.nativeRepair.sawEdited = request.includes('E2E_REPAIR_EDITED')
    report.nativeRepair.sawOld = request.includes(oldText)
    assert.ok(report.nativeRepair.sawEdited, '下一轮请求应包含存档里的正文')
    assert.ok(!report.nativeRepair.sawOld, '下一轮请求不应再包含旧正文')
    assert.equal(storyRounds(await savedChat()), 3)
  })
  await step('回退、重新生成、编辑正文都正常', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).click()
    for (let i = 0; i < 40 && storyRounds(await savedChat()) !== 2; i++) await pause(500)
    assert.equal(storyRounds(await savedChat()), 2)
    await page.getByRole('button', { name: '重新生成正文', exact: true }).filter({ visible: true }).last().click()
    await page.getByPlaceholder('指导意见（可选）').fill('雨夜重写')
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
    for (let i = 0; i < 120 && !/雨夜里|领取/.test((await savedChat()).messages.at(-1).text) ; i++) await pause(500)
    for (let i = 0; i < 60 && (await savedChat()).regenInProgress; i++) await pause(500)
    await settled()
    assert.equal(storyRounds(await savedChat()), 2)
    assert.doesNotMatch((await savedChat()).messages.at(-1).text, /E2E_REPAIR_EDITED/)
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑正文', exact: true }).click()
    const box = page.getByRole('textbox', { name: /正文文本 1/ })
    await box.fill('E2E_REPAIR_SECOND_EDIT 手改的正文。')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    for (let i = 0; i < 40 && !/E2E_REPAIR_SECOND_EDIT/.test((await savedChat()).messages.at(-1).text); i++) await pause(500)
    await send('第四次领取奖励')
    assert.ok((await lastRequest()).includes('E2E_REPAIR_SECOND_EDIT'), '编辑后的正文应进入下一轮请求')
    report.nativeRepair.errors = rpcErrors.splice(0)
    assert.deepEqual(report.nativeRepair.errors, [])
    const result = await alignment()
    report.nativeRepair.final = result
    assert.ok(result?.aligned, '最后存档与模型上下文一致：' + JSON.stringify(result))
  })
}
