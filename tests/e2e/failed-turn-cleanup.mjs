import assert from 'node:assert/strict'
import { join } from 'node:path'

// A failed or stopped latest round can be cleared back to before it began: the story,
// variables and earlier rounds stay, the input returns to the box, and play goes on.
// Learned from huajiao1998/dsh-tavern-sqlite-v2's failed-round cleanup.
export async function failedTurnCleanupChecks({ page, step, savedChat, output, report }) {
  const composer = () => page.getByRole('textbox', { name: /发消息|Message/ }).filter({ visible: true }).first()
  const withdraw = () => page.locator('.dsh-tavern-withdraw-failed').filter({ visible: true }).last()
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const story = async () => {
    const chat = await savedChat()
    const assistants = chat.messages.filter(message => message.role === 'assistant')
    const last = assistants.at(-1)
    const variables = Array.isArray(last.variables) ? last.variables[last.swipeId || 0] : last.variables
    return { replies: assistants.length, last: String(last.sourceText ?? last.text ?? ''), gold: variables?.stat_data?.gold }
  }
  async function clearAndCheck(name, input, start) {
    const before = await story()
    await composer().fill(input); await composer().press('Enter')
    await start()
    await withdraw().waitFor({ timeout: 30000 })
    await page.screenshot({ path: join(output, name + '-failed.png') })
    await withdraw().click()
    await page.waitForFunction(text => [...document.querySelectorAll('textarea, [contenteditable="true"]')].some(box => (box.value ?? box.textContent) === text), input, { timeout: 15000 })
    await page.waitForFunction(text => ![...document.querySelectorAll('.dsh-tavern-user-bubble')].some(bubble => bubble.textContent === text), input, { timeout: 15000 })
    const clearedChat = await savedChat()
    assert.equal(clearedChat.messages.filter(message => message.role === 'user' && String(message.sourceText ?? message.text ?? '') === input).length, 0,
      '撤回后持久故事行也消失，刷新和重发不会复制旧气泡')
    await pause(1000)
    await page.screenshot({ path: join(output, name + '-cleared.png') })
    assert.deepEqual(await story(), before, '清除后正文、变量与此前回合保持原样')
    assert.equal(await withdraw().count(), 0, '清除后不再有待处理的失败轮')
    await composer().fill('')
  }
  await step('普通接口失败的一轮可以清除并撤回输入', async () => {
    await clearAndCheck('provider-error', 'E2E_PROVIDER_ERROR 推门', async () => {})
  })
  await step('撤回后重发并刷新，旧输入与新输入都不重复', async () => {
    const before = await story(), input = 'E2E 撤回后重发'
    await composer().fill(input); await composer().press('Enter')
    for (let i = 0; i < 120 && (await story()).replies === before.replies; i++) await pause(500)
    assert.equal((await story()).replies, before.replies + 1, '撤回后可以正常重发')
    const sent = await savedChat()
    assert.equal(sent.messages.filter(message => message.role === 'user' && message.text === 'E2E_PROVIDER_ERROR 推门').length, 0, '失败旧输入没有混入新轮次')
    assert.equal(sent.messages.filter(message => message.role === 'user' && message.text === input).length, 1, '新输入只有一条持久故事行')
    for (let i = 0; i < 120 && (await story()).gold !== 10; i++) await pause(500)
    assert.equal((await story()).gold, 10, '重发后的后台结算完成，后续回退有稳定基线')
    await page.reload()
    const bubbles = page.locator('.dsh-tavern-user-bubble').filter({ hasText: input })
    await bubbles.first().waitFor({ timeout: 15000 })
    assert.equal(await bubbles.count(), 1, '刷新后仍然只有一条新输入气泡')
    report.failedTurnRetryRefresh = true
  })
  await step('手动停止的一轮可以清除并撤回输入', async () => {
    await clearAndCheck('stopped', 'E2E_SLOW 继续', async () => {
      await page.getByText('雨一直下', { exact: false }).first().waitFor({ timeout: 15000 })
      await page.locator('button[aria-label*="Stop" i], button[aria-label*="停止"], button[aria-label*="Interrupt" i], button[aria-label*="中断"]').filter({ visible: true }).last().click()
    })
  })
  await step('清除后照常继续游玩', async () => {
    const before = await story()
    await composer().fill('领取任务奖励'); await composer().press('Enter')
    for (let i = 0; i < 120 && (await story()).replies === before.replies; i++) await pause(500)
    assert.equal((await story()).replies, before.replies + 1, '清除后可以正常写出下一轮')
    report.failedTurnCleanup = true
  })
}
