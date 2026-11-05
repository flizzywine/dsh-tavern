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
