import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// UI mutations only; independent journal reads verify the durable result.
export async function playControls({ page, step, savedChat, inspectRound, output, report }) {
  const edited = '手工编辑：你把奖励放进了背包。'
  async function restoredBody() {
    const bodies = page.getByText(edited, { exact: true }).filter({ visible: true })
    await bodies.first().waitFor()
    // Native history and Tavern projections reconcile asynchronously. Require
    // exactly one visible copy after that transition, including after reload.
    await bodies.nth(1).waitFor({ state: 'hidden' })
    assert.equal(await bodies.count(), 1)
  }
  const gold = value => page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])')
    .locator('#e2e-gold').filter({ hasText: new RegExp('^金币：' + value + '$') }).waitFor()
  const prose = chat => chat.messages.map(message => ({ role: message.role, text: message.sourceText ?? message.text }))
  await step('撤销回退：恢复被编辑的正文与变量，刷新仍保留', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /撤销回退（恢复第/ }).click()
    await restoredBody()
    await gold(30)
    await inspectRound('undo-rollback', 30, edited)
    await page.reload()
    await restoredBody()
    await gold(30)
    await inspectRound('undo-after-reload', 30, edited)
  })
  await step('Guide：添加、刷新、删除，正文与变量保持不变', async () => {
    const before = await savedChat()
    const guide = 'E2E 指导：多写酒馆窗外的雨声。'
    // Locate by accessible name: the placeholder is example copy and changes with the UI.
    const input = page.getByRole('textbox', { name: '新 Guide 内容', exact: true })
    await input.fill(guide)
    await input.press('Enter')
    const item = page.locator('.fork-status-guides li').filter({ hasText: guide })
    await item.waitFor()
    assert.deepEqual((await savedChat()).guides.map(value => value.text), [guide])
    await page.reload()
    await item.waitFor()
    await page.screenshot({ path: join(output, 'guide-added.png'), fullPage: true })
    await item.getByRole('button', { name: '删除这条指引', exact: true }).click()
    await item.waitFor({ state: 'hidden' })
    assert.deepEqual((await savedChat()).guides, [])
    await page.reload()
    await page.getByRole('textbox', { name: '新 Guide 内容', exact: true }).waitFor()
    assert.equal(await page.locator('.fork-status-guides li').count(), 0)
    const after = await savedChat()
    assert.deepEqual(prose(after), prose(before))
    assert.deepEqual(after.messages.at(-1).variables, before.messages.at(-1).variables)
    report.guide = { added: true, removed: true, persisted: true }
  })
  await step('重新结算变量：修正金币，保持编辑过的正文', async () => {
    const before = await savedChat()
    const receipt = page.locator('.dsh-tavern-mvu-receipt[data-status="updated"]').filter({ visible: true }).last()
    await receipt.locator('summary').click()
    await receipt.getByRole('button', { name: '重新结算变量', exact: true }).click()
    await page.getByPlaceholder('例如：这轮还没有交付物品，不要扣除库存。').fill('E2E 修正金币为四十')
    await page.getByRole('button', { name: '重新结算', exact: true }).click()
    await gold(40)
    assert.deepEqual(prose(await savedChat()), prose(before), '重新结算不能改写正文或新增轮次')
    await page.reload()
    await gold(40)
    await inspectRound('resettled-after-reload', 40, edited)
  })
  await step('导出故事正文：下载内容与当前可见剧情一致', async () => {
    const before = await savedChat()
    await page.locator('[data-fork-more]').click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: '故事正文', exact: true }).click()
    const download = await downloading
    assert.equal(await download.failure(), null)
    const path = join(output, 'conversation.md')
    await download.saveAs(path)
    const text = await readFile(path, 'utf8')
    for (const expected of ['欢迎领取奖励。', '领取任务奖励', '你获得了十枚金币。', '再次领取奖励', edited]) assert.ok(text.includes(expected), '导出遗漏：' + expected)
    for (const obsolete of ['雨夜里，你重新领取了奖励。', '你再次领取了奖励，金币累计二十枚。', '<StatusPlaceHolderImpl/>', 'mvu_submit_update']) assert.ok(!text.includes(obsolete), '导出包含旧正文或内部内容：' + obsolete)
    assert.equal(text.split(edited).length - 1, 1, '编辑正文不得重复导出')
    assert.deepEqual(prose(await savedChat()), prose(before))
    report.export = { filename: download.suggestedFilename(), bytes: Buffer.byteLength(text) }
  })
}
