import assert from 'node:assert/strict'
import { join } from 'node:path'

// On phone-width layouts, opening a game must not pop the right column over the story (#213).
export async function mobileSidebarChecks({ page, step, output, report }) {
  await step('手机宽度下进入游戏不自动打开右侧栏，可手动打开', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('你获得了十枚金币。', { exact: false }).filter({ visible: true }).first().waitFor()
    await page.waitForTimeout(1500)
    const status = page.getByText('后台结算已完成', { exact: true }).filter({ visible: true })
    await page.screenshot({ path: join(output, 'mobile-open.png') })
    assert.equal(await status.count(), 0, '右侧栏不应自动展开')
    // The composer's + and attachment buttons keep the host's 28px round backdrop whatever the
    // UI language or WebView; a transparent ::after grows only the touch target (#215).
    // Measured before the right column opens, since it covers the composer at this width.
    const adds = await page.evaluate(() => [...document.querySelectorAll('[data-composer-card] button')]
      .filter(button => /(^|\s)\S+_add(\s|$)/.test(button.className))
      .map(button => {
        const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2
        // Just outside the visible circle, above and below: the neighbours sit left and right.
        const hits = [y - box.height / 2 - 4, y + box.height / 2 + 4].map(edge => document.elementFromPoint(x, edge))
        return { width: Math.round(box.width), height: Math.round(box.height), edge: hits.every(hit => hit === button || button.contains(hit)) }
      }))
    assert.equal(adds.length, 2, '输入框应有 + 和附件两个按钮')
    assert.deepEqual(adds, [{ width: 28, height: 28, edge: true }, { width: 28, height: 28, edge: true }], '+ 和附件按钮保持宿主尺寸，命中区向外扩出')
    await page.getByRole('button', { name: '酒馆状态', exact: true }).filter({ visible: true }).first().click()
    await status.first().waitFor()
    await page.screenshot({ path: join(output, 'mobile-status.png') })
    // Touch targets grow without growing the visuals (#215): the tab's × stays level with its title.
    const layout = await page.evaluate(() => {
      const close = document.querySelector('[data-dockkit-tab-close]')
      const tab = close?.closest('[data-dockkit-tab]')
      const box = el => el.getBoundingClientRect()
      const title = tab?.querySelector('[data-dockkit-tab-title]')
      return close && title ? { close: box(close), title: box(title) } : null
    })
    assert.ok(layout, '侧栏标签应有关闭按钮')
    const middle = rect => rect.top + rect.height / 2
    assert.ok(Math.abs(middle(layout.close) - middle(layout.title)) <= 2, '关闭按钮应与标签标题对齐')
    report.mobileSidebar = true
  })
  // The right column used to close the left drawer as a side effect; with it staying shut,
  // starting a game from the drawer must close the drawer itself.
  await step('手机宽度下从左侧栏开局后，左侧栏自动收起', async () => {
    const picker = page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).filter({ visible: true })
    await page.locator('[data-dockkit-tab-close]').filter({ visible: true }).first().click()
    await page.waitForTimeout(500)
    await page.locator('[data-mobile-nav="toggle"]').filter({ visible: true }).first().click()
    await picker.first().waitFor()
    await page.screenshot({ path: join(output, 'mobile-drawer.png') })
    await picker.first().click()
    await page.locator('.dsh-tavern-card-pick').filter({ hasText: 'E2E 奖励验收' }).first().click()
    await page.getByRole('button', { name: '开始新游戏', exact: true }).click()
    await page.getByRole('textbox', { name: /发消息|Message/ }).filter({ visible: true }).first().waitFor()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(output, 'mobile-started.png') })
    assert.equal(await picker.count(), 0, '开局后左侧栏应收起')
  })
}
