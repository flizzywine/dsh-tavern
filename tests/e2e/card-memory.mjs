import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'

export async function cardMemoryChecks({ page, step, data, output, report, savedChat }) {
  const story = await savedChat()
  async function rpc(method, args) {
    return page.evaluate(async ({ method, args }) => {
      const response = await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })
      return response.json()
    }, { method, args })
  }
  // The memory panel may view and edit card memory from any conversation (e7bb68f5);
  // what must hold is that a play conversation's model never sees memory tools or context.
  await step('游玩对话的实际模型请求不含记忆工具或上下文', async () => {
    const requests = (await readFile(join(output, 'memory-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.ok(requests.length)
    for (const request of requests) {
      assert.ok(!(request.tools || []).some(tool => tool.name.startsWith('tavern_memory_')))
      assert.ok(!JSON.stringify(request.messages).includes('【卡片模式记忆】'))
    }
  })
  let card
  await step('原生卡片 Agent 调用真实记忆工具保存偏好', async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-adjust-card-style', { detail: { card: { path: 'cards/e2e.json', name: 'E2E 奖励验收' } } })))
    await page.getByText('已创建：E2E 奖励验收', { exact: true }).filter({ visible: true }).first().waitFor()
    const store = createChatJournalStore({ dataRoot: data })
    const chats = await Promise.all((await readdir(join(data, 'chats'))).map(id => store.read(id)))
    card = chats.find(chat => chat.mode === 'card')
    assert.ok(card)
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('E2E_MEMORY_SAVE 以后改卡保留原卡结构，不重写开场白。')
    await composer.press('Enter')
    await page.getByText('改卡偏好已保存。', { exact: true }).filter({ visible: true }).first().waitFor()
    assert.deepEqual((await rpc('getCardMemory', { sessionId: card.sessionId })).preferences, ['保留原卡结构，不重写开场白'])
  })
  await step('刷新后检索偏好，真实请求保持历史前缀和工具不变', async () => {
    const prior = (await readFile(join(output, 'memory-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).at(-1)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('E2E_MEMORY_NEXT 按我的习惯继续改卡')
    await composer.press('Enter')
    await page.getByText('已读取改卡偏好。', { exact: true }).filter({ visible: true }).first().waitFor()
    const next = (await readFile(join(output, 'memory-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).at(-1)
    assert.deepEqual(next.tools, prior.tools)
    assert.equal(next.system, prior.system)
    assert.deepEqual(next.messages.slice(0, prior.messages.length), prior.messages)
    assert.match(JSON.stringify(next.messages.slice(prior.messages.length)), /保留原卡结构，不重写开场白/)
    report.memoryPrefixMessages = prior.messages.length
  })
  await step('桌面与窄屏改卡记忆管理入口可用', async () => {
    await page.getByRole('button', { name: /^(新建标签页|New tab)$/ }).filter({ visible: true }).first().click()
    await page.getByText('改卡记忆', { exact: true }).filter({ visible: true }).first().click()
    const panel = page.locator('.dsh-tavern-card-memory')
    await panel.getByText('保留原卡结构，不重写开场白', { exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'memory-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await panel.waitFor({ state: 'visible' })
    assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
    await page.screenshot({ path: join(output, 'memory-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
  })
}
