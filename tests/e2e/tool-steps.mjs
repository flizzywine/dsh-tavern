import assert from 'node:assert/strict'
import { join } from 'node:path'

// A reply with tool round trips has several DSH steps; its story shows once, not once per step (#222).
export async function toolStepsChecks({ page, step, savedChat, output, report }) {
  await step('带工具调用的一轮，正文只显示一次', async () => {
    const composer = page.getByRole('textbox', { name: /发消息|Message/ }).filter({ visible: true }).first()
    const replies = async () => (await savedChat()).messages.filter(message => message.role === 'assistant').length
    const before = await replies()
    await composer.fill('E2E_TOOL_STEPS 领取任务奖励'); await composer.press('Enter')
    for (let i = 0; i < 120 && await replies() === before; i++) await page.waitForTimeout(500)
    assert.equal(await replies(), before + 1, '应写出一轮正文')
    await page.getByText('后台结算已完成').last().waitFor({ timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1000)
    // Open the collapsed tool steps, as a player reading the round would.
    for (const toggle of await page.locator('[data-conversation-scroll] button[aria-expanded="false"]').filter({ hasText: /tool call/i }).all()) await toggle.click().catch(() => {})
    await page.waitForTimeout(800)
    const story = (await savedChat()).messages.filter(message => message.role === 'assistant').at(-1)
    const line = String(story.sourceText ?? story.text ?? '').replace(/<[^>]+>/g, '').trim().split('\n').filter(Boolean).at(-1)
    // Assistant nodes carrying the story, collapsed tool groups included.
    const shown = await page.evaluate(text => [...document.querySelectorAll('[data-conversation-scroll] .dsh-tavern-assistant')].filter(node => node.textContent.includes(text)).length, line)
    await page.screenshot({ path: join(output, 'tool-steps.png'), fullPage: true })
    report.toolSteps = { line, shown }
    assert.equal(shown, 1, '正文应只出现一次')
  })
}
