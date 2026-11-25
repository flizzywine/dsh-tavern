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

test('酒馆插件列表隐藏卡内插件，保留酒馆内置插件和第三方舞台模组', async t => {
  const plugins = [
    { folder: 'werewolf', name: 'dsh-card-werewolf', source: { kind: 'card' }, enabled: true, state: 'loaded' },
    { folder: 'massage', name: 'dsh-tavern-massage', source: { kind: 'card' }, enabled: false, state: 'disabled' },
    { folder: 'audiobook', name: 'dsh-tavern-audiobook', source: { kind: 'builtin' }, enabled: true, state: 'loaded' },
    { folder: 'stage-builtin', name: 'stage-builtin-mod', source: { kind: 'managed', builtin: true }, enabled: true, state: 'loaded' },
    { folder: 'stage-custom', name: 'stage-custom-mod', source: { kind: 'managed', builtin: false }, enabled: true, state: 'loaded' },
  ]
  const { page } = await openTavernSettings(t, {
    section: 'dsh-tavern: plugins settings section',
    respond: method => method === 'listUserPlugins' ? { plugins, dir: '/tmp/tavern/plugins' } : undefined,
  })
  const rows = page.locator('.dsh-tavern-user-plugin')
  await rows.filter({ hasText: 'dsh-tavern-audiobook' }).getByRole('button', { name: '停用', exact: true }).waitFor()
  await rows.filter({ hasText: 'stage-custom-mod' }).getByRole('button', { name: '管理模组', exact: true }).waitFor()
  assert.equal(await rows.count(), 2)
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

test('有独立 Release 的内置插件显示检查入口，只能安装兼容且已检查的版本', async t => {
  const folder = 'dsh-tavern-fate-dice'
  const target = 'v1.5.0:sha256:checked'
  const dice = { folder, name: folder, version: '1.4.2', source: { kind: 'builtin', releaseRepo: 'bigmalove/' + folder }, enabled: true, state: 'loaded' }
  const image = { folder: 'dsh-tavern-image', name: 'dsh-tavern-image', source: { kind: 'builtin' }, enabled: true, state: 'loaded' }
  let update = { folder, status: 'blocked', reason: '新版需要 Tavern 插件 API v9，请先更新酒馆' }
  const { page, calls } = await openTavernSettings(t, {
    section: 'dsh-tavern: plugins settings section',
    respond(method) {
      if (method === 'listUserPlugins') return { plugins: [dice, image], dir: '/tmp/tavern/plugins' }
      if (method === 'checkUserPluginUpdates') return { plugins: [update] }
      if (method === 'updateUserPlugin') {
        Object.assign(dice, { version: '1.5.0', state: 'restart' })
        update = { folder, status: 'latest' }
        return { plugin: { name: folder, version: dice.version, replaced: true } }
      }
    },
  })
  const diceRow = page.locator('.dsh-tavern-user-plugin').filter({ hasText: folder })
  const imageRow = page.locator('.dsh-tavern-user-plugin').filter({ hasText: image.name })
  await diceRow.getByText(update.reason, { exact: true }).waitFor()
  assert.equal(await diceRow.getByRole('button', { name: /更新/ }).count(), 0)
  assert.equal(await imageRow.getByRole('button', { name: /更新/ }).count(), 0)

  update = { folder, status: 'available', latest: 'v1.5.0', target }
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await diceRow.getByRole('button', { name: '更新到 1.5.0', exact: true }).click()
  await diceRow.getByText('重启 DSH 后生效', { exact: true }).waitFor()
  const { args } = calls.find(call => call.method === 'updateUserPlugin')
  assert.equal(args.folder, folder)
  assert.equal(args.target, target)
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

// 移动端触控壳（body.dsh-tavern-shell-active + 16px 输入字号）与较长插件目录路径下：
// InlineField 镜像占位文案和底部目录路径都不能把 .dsh-tavern-user-plugins 网格撑出卡片；
// 安装输入框单独占满首行，「安装 / 上传 ZIP」「检查更新」和插件操作按钮都在卡片内可见。
test('手机窄屏与长路径下酒馆插件页不横向溢出且安装栏自动换行', async t => {
  const plugins = [
    {
      folder: 'hub', name: 'dsh-runninghub', version: '0.1.44',
      description: 'RunningHub 本地网关工作室：在 DSH Tavern 里异步提交图片任务并自动回填',
      source: { kind: 'github', repo: 'bigmalove/dsh-runninghub', resolved: 'Release v0.1.44' },
      enabled: true, state: 'restart', reason: '',
    },
    {
      folder: 'st', name: 'dsh-tavern-STcontext', version: '0.8.2',
      description: '导入 SillyTavern 预设，使用完整可见历史生成或重生成正文',
      source: { kind: 'builtin', releaseRepo: 'bigmalove/dsh-tavern-STcontext' },
      enabled: false, state: 'disabled', reason: '',
    },
  ]
  const { page } = await openTavernSettings(t, {
    section: 'dsh-tavern: plugins settings section',
    contextOptions: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true },
    beforeRender: () => {
      const meta = document.createElement('meta')
      meta.name = 'viewport'
      meta.content = 'width=device-width,initial-scale=1'
      document.head.appendChild(meta)
      document.body.classList.add('dsh-tavern-shell-active')
    },
    respond(method) {
      if (method === 'listUserPlugins') return { plugins, dir: '/home/administrator/.dsh-tavern/profiles/default/user-plugins/very-long-directory-path' }
      if (method === 'checkUserPluginUpdates') return { plugins: plugins.map(p => ({ folder: p.folder, status: 'latest' })) }
    },
  })
  const input = page.locator('.dsh-tavern-user-plugins-install input.fork-inline-input')
  await page.locator('.dsh-tavern-user-plugin').first().waitFor()
  await input.fill('https://github.com/some-very-long-organization-name/some-very-long-dsh-tavern-plugin-repository')
  const metrics = await page.evaluate(() => {
    const card = document.querySelector('.dsh-tavern-gs-card').getBoundingClientRect()
    const field = document.querySelector('.dsh-tavern-user-plugins-install > .fork-inline-field').getBoundingClientRect()
    const installBtn = document.querySelector('.dsh-tavern-user-plugins-install .dsh-tavern-btn.primary').getBoundingClientRect()
    const zipBtn = document.querySelectorAll('.dsh-tavern-user-plugins-install .dsh-tavern-btn')[1].getBoundingClientRect()
    const checkBtn = document.querySelector('.dsh-tavern-user-plugins-head .dsh-tavern-btn').getBoundingClientRect()
    const actionBtn = document.querySelector('.dsh-tavern-user-plugin-actions .dsh-tavern-btn').getBoundingClientRect()
    const folderBtn = document.querySelector('.dsh-tavern-user-plugins-folder .dsh-tavern-btn').getBoundingClientRect()
    const overflow = [...document.querySelectorAll('.dsh-tavern-user-plugins *')]
      .filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.right > card.right + 1
      })
      .map(el => `${el.className || el.tagName}:${Math.round(el.getBoundingClientRect().right)}>${Math.round(card.right)}`)
    return {
      vw: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
      cardRight: card.right,
      fieldWidth: field.width,
      fieldBottom: field.bottom,
      fieldHeight: field.height,
      installTop: installBtn.top,
      installRight: installBtn.right,
      installHeight: installBtn.height,
      zipTop: zipBtn.top,
      zipRight: zipBtn.right,
      checkRight: checkBtn.right,
      actionRight: actionBtn.right,
      folderRight: folderBtn.right,
      overflow,
    }
  })
  assert.deepEqual(metrics.overflow, [], `卡片内不应有子元素向右溢出：${metrics.overflow.join(', ')}`)
  assert.ok(metrics.docScrollW <= metrics.vw, `页面不应出现横向滚动：${metrics.docScrollW} > ${metrics.vw}`)
  assert.ok(metrics.installTop >= metrics.fieldBottom - 1, '安装按钮应换到输入框下一行')
  assert.ok(Math.abs(metrics.zipTop - metrics.installTop) <= 2, '安装与上传 ZIP 按钮应在同一行')
  assert.ok(metrics.zipRight <= metrics.cardRight + 1, '上传 ZIP 按钮应在卡片内')
  assert.ok(metrics.checkRight <= metrics.cardRight + 1, '检查更新按钮应在卡片内')
  assert.ok(metrics.actionRight <= metrics.cardRight + 1, '插件操作按钮应在卡片内')
  assert.ok(metrics.folderRight <= metrics.cardRight + 1, '打开插件文件夹按钮应在卡片内')
  assert.ok(Math.abs(metrics.fieldHeight - metrics.installHeight) <= 1, `输入框与按钮高度应对齐：${metrics.fieldHeight} vs ${metrics.installHeight}`)
})
