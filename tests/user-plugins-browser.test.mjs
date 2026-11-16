import assert from 'node:assert/strict'
import test from 'node:test'

import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

for (const installed of [false, true]) {
  test(`插件获取渠道在${installed ? '已安装插件' : '空列表'}时可见，Discord 在新页面打开`, async t => {
    const plugins = installed
      ? [{ folder: 'panel', name: 'dsh-tavern-worldbook-panel', version: '0.1.0', source: { kind: 'folder' }, enabled: true, state: 'loaded', reason: '' }]
      : []
    const { page } = await openTavernSettings(t, {
      section: 'dsh-tavern: plugins settings section',
      respond: method => method === 'listUserPlugins' ? { plugins, dir: '/tmp/tavern/plugins' } : undefined,
    })
    await page.setViewportSize({ width: installed ? 1280 : 390, height: 844 })
    const link = page.getByRole('link', { name: 'Discord 交流群', exact: true })
    await link.waitFor({ state: 'visible' })
    assert.equal(await link.getAttribute('href'), 'https://discord.gg/hYAEjKnpra')
    assert.equal(await link.getAttribute('target'), '_blank')
    assert.deepEqual(new Set((await link.getAttribute('rel')).split(' ')), new Set(['noopener', 'noreferrer']))
    assert.match(await link.locator('..').innerText(), /插件获取：前往 .*的插件分享，查找社区作者发布的插件及使用说明。/)
    await page.getByText('给酒馆加功能：粘贴插件作者的 GitHub 地址，或上传 ZIP 安装包。不支持 SillyTavern 插件。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '上传 ZIP', exact: true }).waitFor()

    // Keep this test offline while checking that leaving for the community does
    // not replace settings, even after closing the new tab and opening it again.
    await page.context().route('https://discord.gg/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Community</p>' }))
    for (let attempt = 0; attempt < 2; attempt++) {
      const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()])
      await popup.waitForLoadState()
      assert.equal(popup.url(), 'https://discord.gg/hYAEjKnpra')
      assert.equal(await popup.evaluate(() => window.opener), null)
      await popup.close()
      assert.equal(page.url(), 'http://tavern.test/')
      assert.equal(await page.getByRole('button', { name: '安装', exact: true }).isVisible(), true)
    }
  })
}

// 随酒馆发行的内置插件（剧情罗盘）没有 plugins/ 目录可停用，列表里是只读行：
// 说明它已经在跑，但不给停用/删除按钮，也不混进第三方插件的操作区。
test('内置插件在插件页列成只读行，紧跟第三方插件之后', async t => {
  const plugins = [
    { folder: 'dsh-tavern-plot-compass', name: 'dsh-tavern-plot-compass', version: '1.0.0', description: '剧情罗盘插件：多路线分支推演', source: { kind: 'bundle', tavernApiVersion: 8 }, enabled: true, state: 'loaded', reason: '', readOnly: true },
    { folder: 'hub', name: 'dsh-runninghub', version: '1.1.4', source: { kind: 'github', repo: 'bigmalove/dsh-runninghub', resolved: 'Release v1.1.4' }, enabled: true, state: 'loaded', reason: '' },
  ]
  const { page } = await openTavernSettings(t, {
    section: 'dsh-tavern: plugins settings section',
    respond: method => method === 'listUserPlugins' ? { plugins, dir: '/tmp/tavern/plugins' } : undefined,
  })
  const row = page.locator('li.dsh-tavern-user-plugin', { hasText: 'dsh-tavern-plot-compass' })
  await row.waitFor({ state: 'visible' })
  assert.match(await row.innerText(), /dsh-tavern-plot-compass/)
  assert.match(await row.innerText(), /1\.0\.0/)
  assert.match(await row.innerText(), /剧情罗盘插件/)
  assert.match(await row.innerText(), /内置插件 · 随酒馆提供，随酒馆一起更新/)
  assert.equal(await row.getByRole('button', { name: '停用', exact: true }).count(), 0)
  assert.equal(await row.getByRole('button', { name: '启用', exact: true }).count(), 0)
  assert.equal(await row.getByRole('button', { name: '删除', exact: true }).count(), 0)
  // 第三方插件照旧保留自己的操作按钮。
  const third = page.locator('li.dsh-tavern-user-plugin', { hasText: 'dsh-runninghub' })
  assert.equal(await third.getByRole('button', { name: '停用', exact: true }).count(), 1)
})

// 设置 → 插件：已是最新时不显示更新按钮，有新版时按钮写明版本，停用/启用原地切换。
// 手动「检查更新」跳过自动检查的缓存，按钮旁边写明结果，徽标和更新按钮随之刷新。
test('插件列表可以手动检查更新', async t => {
  const plugins = [
    { folder: 'hub', name: 'dsh-runninghub', version: '1.1.4', description: 'RunningHub', source: { kind: 'github', repo: 'bigmalove/dsh-runninghub', resolved: 'Release v1.1.4' }, enabled: true, state: 'loaded', reason: '' },
    { folder: 'panel', name: 'dsh-tavern-worldbook-panel', version: '0.1.0', source: { kind: 'folder' }, enabled: true, state: 'loaded', reason: '' },
  ]
  let updates = [{ folder: 'hub', current: '1.1.4', latest: 'v1.1.4', status: 'latest' }]
  const calls = []
  function respond(method, args) {
    calls.push({ method, args })
    if (method === 'getStageRuntimeStatus') return {enabled:true,installed:true,status:'ready'}
    if (method === 'listUserPlugins') return { plugins, dir: '/tmp/tavern/plugins' }
    if (method === 'checkUserPluginUpdates') return { plugins: updates }
  }
  // The plugin list is the 「插件」 group of the global settings page (modules/global-settings.js).
  const { page } = await openTavernSettings(t, { respond, section: 'dsh-tavern: plugins settings section' })
  const hub = page.locator('.dsh-tavern-user-plugin').filter({ hasText: 'dsh-runninghub' })
  await hub.getByText('已是最新', { exact: true }).waitFor()

  const checks = () => calls.filter(call => call.method === 'checkUserPluginUpdates')
  assert.equal(checks().length, 1, '打开页面自动检查一次')
  assert.notEqual(checks()[0].args?.fresh, true, '自动检查走缓存')

  updates = [{ folder: 'hub', current: '1.1.4', latest: 'v1.1.5', status: 'available' }]
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await page.getByText('检查完成：有 1 个插件可以更新。', { exact: true }).waitFor()
  await hub.getByRole('button', { name: '更新到 1.1.5', exact: true }).waitFor()
  assert.equal(checks().length, 2)
  assert.equal(checks()[1].args?.fresh, true, '手动检查绕过缓存')

  updates = [{ folder: 'hub', current: '1.1.5', latest: 'v1.1.5', status: 'latest' }]
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await page.getByText('检查完成：没有发现新版本。', { exact: true }).waitFor()
  await hub.getByText('已是最新', { exact: true }).waitFor()
  assert.equal(await hub.getByRole('button', { name: /更新/ }).count(), 0)

  updates = [{ folder: 'hub', current: '1.1.5', status: 'error', reason: '连不上 GitHub' }]
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await page.getByRole('alert').getByText('检查完成：1 个插件检查失败。', { exact: true }).waitFor()
  assert.equal(checks().length, 4)
  assert.equal(checks()[3].args?.fresh, true)
})

// 手机宽度下卡片内宽只剩两百多像素，「启用 / 更新 / 删除」三个按钮自己就要一百五十多像素：
// 正文的 flex-basis 是 0，会被压成几十像素宽的文字列，插件名和说明逐字换行成一根竖条，
// 卡片被撑到几百像素高。正文独占一行，动作按钮换到下一行。
test('手机宽度下插件卡片的正文不被按钮挤成逐字换行', async t => {
  const plugins = [{
    folder: 'pet', name: 'dsh-tavern-desktop-pet', version: '0.5.0',
    description: '把 Live2D 桌宠搬到 Tavern 里，跟着剧情吐槽、换表情、念台词；在卡片工作台里当建卡引导员。',
    source: { kind: 'github', repo: 'bigmalove/dsh-tavern-desktop-pet', resolved: 'main' },
    enabled: false, state: 'disabled', reason: '',
  }]
  const { page } = await openTavernSettings(t, {
    respond: method => method === 'listUserPlugins' ? { plugins, dir: '/tmp/tavern/plugins' } : undefined,
    section: 'dsh-tavern: plugins settings section',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const card = page.locator('.dsh-tavern-user-plugin')
  await card.getByRole('button', { name: '启用', exact: true }).waitFor()
  const layout = await card.evaluate(element => {
    const copy = element.querySelector('.dsh-tavern-user-plugin-copy')
    const actions = element.querySelector('.dsh-tavern-user-plugin-actions')
    const rect = node => node.getBoundingClientRect()
    return {
      card: rect(element).width, copyWidth: rect(copy).width, copyHeight: rect(copy).height,
      copyBottom: rect(copy).bottom, actionsTop: rect(actions).top,
      pageWidth: document.documentElement.scrollWidth,
    }
  })
  assert.ok(layout.copyWidth > layout.card * 0.75, `正文应占满卡片整宽，实际 ${layout.copyWidth}/${layout.card}`)
  assert.ok(layout.copyHeight < 200, `正文应只占几行，实际 ${layout.copyHeight}px 高`)
  assert.ok(layout.actionsTop >= layout.copyBottom - 1, '动作按钮应换到正文下一行')
  assert.ok(layout.pageWidth <= 390, '不应把页面撑出横向滚动')
})
