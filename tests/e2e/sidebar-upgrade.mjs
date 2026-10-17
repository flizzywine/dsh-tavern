import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function sidebarUpgrade({ page, step, savedChat, output, report }) {
  const before = await savedChat()
  const status = page.getByRole('button', { name: '酒馆状态', exact: true })
  await step('原生侧栏重复打开酒馆状态不会增加标签', async () => {
    await status.click()
    // The host tab now holds its close button, so its accessible name is the title plus "Close".
    const tabs = page.locator('[data-dockkit-tab]').filter({ has: page.locator('[data-dockkit-tab-title]', { hasText: /^酒馆状态$/ }) }).filter({ visible: true })
    await tabs.first().waitFor()
    const count = await tabs.count()
    await status.click(); await status.click()
    assert.equal(await tabs.count(), count)
  })
  await step('卡片调试恢复完整对话，预填指令和游玩引用', async () => {
    await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
    // The debug entry sits in the collapsed 「遇到显示或生成问题？」 section.
    await page.getByText('遇到显示或生成问题？', { exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: '交给卡片 Agent 调试', exact: true }).click()
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.filter({ hasText: '/debug-card' }).waitFor()
    const draft = await composer.innerText()
    assert.match(draft, /\/debug-card/)
    assert.match(draft, /cards\/e2e\.json/)
    assert.ok(draft.includes('play-chat:' + before.id))
    await page.getByText('人物卡库', { exact: true }).filter({ visible: true }).first().click()
    await page.getByText('E2E 奖励验收', { exact: true }).filter({ visible: true }).first().waitFor()
    await page.screenshot({ path: join(output, 'sidebar-card-debug.png'), fullPage: true })
  })
  await step('从卡片工作台返回游玩，当前存档保持不变', async () => {
    await page.getByRole('button', { name: '游玩', exact: true }).click()
    await page.locator('.dsh-tavern-side-row-name').first().click()
    await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
    assert.equal((await savedChat()).sessionId, before.sessionId)
    assert.deepEqual((await savedChat()).messages, before.messages)
    await page.reload()
    await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
    await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: new RegExp('^金币：' + before.messages.at(-1).variables[before.messages.at(-1).swipeId || 0].stat_data.gold + '$') }).waitFor()
    await page.screenshot({ path: join(output, 'sidebar-return-to-play.png'), fullPage: true })
    report.sidebar = { repeatedOpen: true, debugPrompt: true, returnToPlay: true, reload: true }
  })
}
