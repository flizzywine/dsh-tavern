import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { mountWorldBookDetail } from './fixtures/worldbook-detail-vm.mjs'

const baseEntries = () => ([
  { ref: 'a', comment: '固定设定', title: '固定设定', content: '甲设定', enabled: true, constant: true, channel: 'auto', channelInherited: true, primaryKeys: [], secondaryKeys: [] },
  { ref: 'b', comment: '会切换', title: '会切换', content: '乙设定', enabled: true, constant: false, channel: 'tail', channelInherited: false, primaryKeys: [], secondaryKeys: [] },
  { ref: 'c', comment: '[mvu_update] 变量更新', title: '[mvu_update] 变量更新', content: '规则', enabled: true, constant: true, channel: 'auto', channelInherited: true, primaryKeys: [], secondaryKeys: [] }
])

function channelGroup(page) {
  return page.nodes().find(node => node.tag === 'div' && node.props['aria-label'] === '整本注入通道')
}

function channelButton(page, label) {
  const group = channelGroup(page)
  assert.ok(group, '设置区缺少整本注入通道分组')
  return group.children.find(node => node.tag === 'button' && page.text(node) === label)
}

function entryChannelField(page, entryRef) {
  const editor = page.nodes().find(node => node.tag === page.components.WorldBookEntryEditor && node.props.entry.ref === entryRef)
  assert.ok(editor, '缺少条目编辑器：' + entryRef)
  const walk = node => !node || typeof node !== 'object' ? []
    : (node.tag === page.ui.InlineField && node.props.label === '注入通道' ? [node] : []).concat((node.children || []).flatMap(walk))
  return walk(editor)[0]
}

test('整本开关一次改掉全部条目通道并记成整本默认，再切回自动时统一清理', async () => {
  const page = mountWorldBookDetail({ displayName: '测试书', channel: 'auto', entries: baseEntries() })
  assert.equal(channelButton(page, '自动').props['aria-pressed'], true)
  assert.equal(channelButton(page, '稳定前缀').props['aria-pressed'], false)
  // 后台变量更新条目不展示注入通道下拉。
  assert.equal(entryChannelField(page, 'c'), undefined)

  await channelButton(page, '稳定前缀').props.onClick()
  assert.equal(channelButton(page, '稳定前缀').props['aria-pressed'], true)
  assert.equal(entryChannelField(page, 'a').props.value, 'prefix')
  assert.equal(entryChannelField(page, 'b').props.value, 'prefix')

  const [method1, args1] = page.calls.at(-1)
  assert.equal(method1, 'updateWorldBook')
  assert.equal(args1.lean, true)
  assert.equal(args1.update.channel, 'prefix')
  assert.deepEqual(args1.update.operations.map(op => op.ref), ['a', 'b', 'c'])
  assert.ok(args1.update.operations.every(op => op.patch.channel === 'prefix'))

  // 再切回自动，整本与全部条目一起恢复默认继承。
  await channelButton(page, '自动').props.onClick()
  assert.equal(channelButton(page, '自动').props['aria-pressed'], true)
  assert.equal(entryChannelField(page, 'a').props.value, '')
  assert.equal(entryChannelField(page, 'b').props.value, '')

  const [, args2] = page.calls.at(-1)
  assert.equal(args2.update.channel, 'auto')
  assert.ok(args2.update.operations.every(op => op.patch.channel === 'auto'))
})

test('条目下拉提供跟随整本与单条覆盖：清除覆盖传 null，整本非 auto 时也可显式设回 auto', async () => {
  const entries = [
    { ref: 'a', comment: '继承条目', title: '继承条目', content: '甲', enabled: true, constant: true, channel: 'prefix', channelInherited: true, primaryKeys: [], secondaryKeys: [] },
    { ref: 'b', comment: '覆盖条目', title: '覆盖条目', content: '乙', enabled: true, constant: false, channel: 'tail', channelInherited: false, primaryKeys: [], secondaryKeys: [] }
  ]
  const page = mountWorldBookDetail({ displayName: '测试书', channel: 'prefix', entries })

  const inherited = entryChannelField(page, 'a')
  assert.equal(inherited.props.value, '')
  assert.deepEqual(Array.from(inherited.props.options.map(option => option.label)), ['跟随整本（稳定前缀）', '自动', '稳定前缀', '每轮尾部'])

  const explicit = entryChannelField(page, 'b')
  assert.equal(explicit.props.value, 'tail')

  // 清除覆盖 -> 发送 channel: null，本地恢复跟随整本 prefix。
  await explicit.props.onCommit('')
  const [, clearArgs] = page.calls.at(-1)
  assert.equal(clearArgs.lean, true)
  assert.equal(clearArgs.update.channel, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(clearArgs.update.operations)), [{ op: 'update', ref: 'b', patch: { channel: null } }])
  assert.equal(entryChannelField(page, 'b').props.value, '')

  // 整本为 prefix 时，将第 a 条显式设为 auto -> 保留显式选择而非跟随整本。
  await entryChannelField(page, 'a').props.onCommit('auto')
  const [, autoArgs] = page.calls.at(-1)
  assert.deepEqual(JSON.parse(JSON.stringify(autoArgs.update.operations)), [{ op: 'update', ref: 'a', patch: { channel: 'auto' } }])
  assert.equal(entryChannelField(page, 'a').props.value, 'auto')

  // 单条被覆盖后，再次点击当前默认按钮「稳定前缀」仍能一键重新统一全书。
  await channelButton(page, '稳定前缀').props.onClick()
  assert.equal(entryChannelField(page, 'a').props.value, 'prefix')
  assert.equal(page.calls.at(-1)[1].update.channel, 'prefix')
})

test('真实浏览器中可切换整本注入通道与条目注入通道，并持久化回读', async t => {
  const host = spawn(process.execPath, ['tests/fixtures/worldbook-editor-ui.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  t.after(() => host.kill())
  const [chunk] = await once(host.stdout, 'data')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error))
  await page.goto(String(chunk).trim())

  const group = page.getByRole('group', { name: '整本注入通道' })
  await group.waitFor()
  await group.getByRole('button', { name: '稳定前缀', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="整本注入通道"] button[aria-pressed="true"]')?.textContent === '稳定前缀')

  await page.locator('button.dsh-wbd-entry-main[title="Alice"]').click()
  const entry = page.locator('.dsh-wbd-entry[data-open]').filter({ has: page.locator('button[title="Alice"]') })
  const trigger = entry.locator('button.fork-inline-trigger[aria-label^="注入通道："]')
  assert.equal(await trigger.locator('.fork-inline-text').innerText(), '稳定前缀')

  await trigger.click()
  await page.getByRole('menu', { name: '注入通道' }).getByRole('menuitemradio', { name: '每轮尾部' }).click()
  assert.equal(await trigger.locator('.fork-inline-text').innerText(), '每轮尾部')

  // 刷新页面重新读取真实服务端文档，验证整本默认与单条覆盖均已持久保存。
  await page.reload()
  await group.waitFor()
  assert.equal(await group.getByRole('button', { name: '稳定前缀', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.locator('button.dsh-wbd-entry-main[title="Alice"]').click()
  assert.equal(await trigger.locator('.fork-inline-text').innerText(), '每轮尾部')

  // 选回「跟随整本（稳定前缀）」清除条目覆盖。
  await trigger.click()
  await page.getByRole('menu', { name: '注入通道' }).getByRole('menuitemradio', { name: '跟随整本（稳定前缀）' }).click()
  assert.equal(await trigger.locator('.fork-inline-text').innerText(), '跟随整本（稳定前缀）')
  assert.deepEqual(pageErrors, [])
})
