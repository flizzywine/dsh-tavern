// Desktop profile switching and Tavern installation management.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/packages/dsh-profile-bridge/client.js', import.meta.url), 'utf8')

async function mount(status, calls = [], options = {}) {
  const inTavern = options.inTavern ?? (status.activeIsLink === true && status.linkTargetName === 'tavern')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  // The Tavern client sets this flag on pages where it loaded.
  if (inTavern) dom.window.__dshTavernLoaded = true
  if (options.next) dom.window.desktopNext = { state: async () => ({}) }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const rpc = async (_channel, endpoint, payload) => {
    calls.push([endpoint, payload])
    if (options.rpc) return options.rpc(endpoint, payload)
    if (endpoint === 'shortcut') return { ok: true, value: { path: '/Users/me/Desktop/DSH 酒馆.app', existed: false } }
    return endpoint === 'status' ? { ok: true, value: status } : { ok: true, value: { closesApp: true } }
  }
  let module
  dom.window.__ModuleLoader__ = { load: ({ factory }) => { module = factory(name => name === 'react' ? React : undefined) } }
  new Function('window', source)(dom.window)
  let registered, page
  const dictionaries = {}
  const ctx = {
    locale: { bind: () => key => dictionaries.zh[key] ?? key, register: (_ns, value) => Object.assign(dictionaries, value) },
    connection: { rpc: { call: rpc } },
    effect: run => run(),
    slots: { inject: (_name, run) => run(), register: (meta, component) => { registered = meta; page = component; return () => {} } }
  }
  await act(async () => { module.apply(ctx) })
  if (!registered) return { registered: false, calls, dispose: () => dom.window.close() }
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => { root.render(React.createElement(page, registered.inject())) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { dom, act, label: () => registered.label(), text: () => dom.window.document.body.textContent, button: () => dom.window.document.querySelector('.pb-bar .pb-btn'), calls, dispose: () => act(() => root.unmount()) }
}

const tavernProfile = { name: 'tavern', bundles: ['dsh-tavern-plugin', 'dsh-profile-bridge'], hasNodeModules: true }

test('NEXT 使用原生 Profile 设置，不注册旧切换页', async () => {
  const page = await mount({}, [], { next: true })
  try {
    assert.equal(page.registered, false)
    assert.deepEqual(page.calls, [])
  } finally {
    page.dispose()
  }
})

test('快捷方式打开的独立酒馆窗口：不给切换按钮，只说明原版 DSH 直接打开', async () => {
  // 桌面版此时是原版（没有链接），这一页却是酒馆：以页面为准，不能给出「切到 DSH 酒馆」。
  const status = { appKind: 'desktop', desktopApp: false, activeIsLink: false, backups: [], profiles: [tavernProfile] }
  const page = await mount(status, [], { inTavern: true })
  assert.equal(page.label(), 'dsh-tavern')
  assert.doesNotMatch(page.text(), /切到 DSH 酒馆/)
  assert.match(page.text(), /独立窗口/)
  const open = [...page.dom.window.document.querySelectorAll('button')].find(item => item.textContent === '打开原版 DSH')
  assert.ok(open, '给一个直接打开原版 DSH 的按钮')
  await page.act(async () => { open.click() })
  assert.deepEqual(page.calls.at(-1), ['openOriginal', {}])
  page.dispose()
})


test('重开页面后切换失败显示在折叠日志之外；文本不会解析成 HTML', async () => {
  const page = await mount({ appKind: 'desktop', profiles: [tavernProfile], lastResult: {
    status: 'failed', message: '<img src=x onerror=alert(1)> EBUSY desktop', logPath: 'C:\\dsh\\profile-bridge\\last-run.log',
  } })
  const alert = page.dom.window.document.querySelector('[role="alert"]')
  assert.ok(alert)
  assert.equal(alert.closest('details'), null)
  assert.match(alert.textContent, /上次切换失败.*EBUSY desktop/)
  assert.match(alert.textContent, /last-run.log/)
  assert.equal(alert.querySelector('img'), null)
  await page.act(async () => { page.button().click() })
  assert.equal(page.dom.window.document.querySelector('[role="alert"]'), null, 'accepted retry replaces previous failure with pending')
  page.dispose()
})

test('等待退出时禁用重复切换，超时结果不需要重新打开页面即可看到', async () => {
  let status = { appKind: 'desktop', profiles: [tavernProfile], lastResult: { status: 'pending', stamp: '1' } }
  const page = await mount(status, [], { rpc: async () => ({ ok: true, value: status }) })
  assert.equal(page.button().disabled, true)
  status = { ...status, lastResult: { status: 'failed', stamp: '1', message: '等待桌面退出超时' } }
  await page.act(async () => { await new Promise(resolve => setTimeout(resolve, 1600)) })
  assert.match(page.dom.window.document.querySelector('[role="alert"]').textContent, /等待桌面退出超时/)
  assert.equal(page.button().disabled, false)
  page.dispose()
})

const managedStatus = {
  platform: 'win32', appKind: 'desktop', desktopApp: true, profiles: [tavernProfile],
  installation: { available: true, appDir: 'C:\\DSH\\apps\\dsh-tavern', profileDir: 'C:\\DSH\\profiles\\tavern', dataDir: 'C:\\DSH\\profile-data\\tavern', sharedHome: 'C:\\DSH' },
}
const namedButton = (page, text) => [...page.dom.window.document.querySelectorAll('button')].find(button => button.textContent === text)

test('官方酒馆启动器按提交检查同版本更新，并跟踪安装到完成', async () => {
  const tavern = { ...managedStatus, activeIsLink: true, linkTargetName: 'tavern', backups: ['desktop.fresh-test'] }
  const build = { canUpdate: true, currentVersion: '3.2.8', currentCommit: '12345678'.padEnd(40, '0') }
  const latest = { ...build, latestVersion: '3.2.8', latestCommit: 'abcdef12'.padEnd(40, '0') }
  let update = { ...build, phase: 'idle' }
  let checkResult = { ...latest, latestCommit: build.currentCommit, phase: 'up-to-date' }
  const page = await mount(tavern, [], { rpc: async endpoint => {
    if (endpoint === 'status') return { ok: true, value: tavern }
    if (endpoint === 'check-update') update = checkResult
    if (endpoint === 'start-update') update = { ...latest, phase: 'running', stage: '正在下载新版' }
    return { ok: true, value: update }
  } })
  try {
    assert.match(page.text(), /当前安装v3\.2\.8 · 12345678/)
    await page.act(async () => namedButton(page, '检查更新').click())
    assert.match(page.text(), /已是最新版本/)
    assert.equal(namedButton(page, '更新酒馆'), undefined)

    checkResult = { ...latest, phase: 'update-available' }
    await page.act(async () => namedButton(page, '检查更新').click())
    assert.match(page.text(), /最新发布v3\.2\.8 · abcdef12发现新版本/)
    assert.equal([...page.dom.window.document.querySelectorAll('.pb-builds a')].at(-1).href, `https://github.com/flizzywine/dsh-tavern/commit/${latest.latestCommit}`)

    await page.act(async () => {
      namedButton(page, '更新酒馆').click()
      namedButton(page, '更新酒馆').click()
    })
    assert.equal(page.calls.filter(([endpoint]) => endpoint === 'start-update').length, 1)
    assert.match(page.text(), /正在下载新版/)
    assert.equal(namedButton(page, '重启并切换到原版 DSH').disabled, true)
    update = { ...latest, phase: 'completed', requiresRestart: true }
    await page.act(async () => { await new Promise(resolve => setTimeout(resolve, 1550)) })
    assert.match(page.text(), /更新已安装。请退出并重新打开/)
    assert.equal(namedButton(page, '检查更新'), undefined)
  } finally {
    await page.dispose()
  }
})

test('原版桌面首次安装需要确认，排队后隐藏安装按钮', async () => {
  const page = await mount({ appKind: 'desktop', desktopApp: true, installAvailable: true, profiles: [] })
  try {
    await page.act(async () => namedButton(page, '安装酒馆').click())
    assert.deepEqual(page.calls, [['status', {}]])
    await page.act(async () => namedButton(page, '确认安装').click())
    assert.deepEqual(page.calls.at(-1), ['install', { confirmed: true }])
    assert.equal(namedButton(page, '安装酒馆'), undefined)
  } finally {
    await page.dispose()
  }
})

test('安装完成后可手动添加快捷方式，并重启切换到酒馆 Profile', async () => {
  const page = await mount({
    appKind: 'desktop', desktopApp: true, installAvailable: false,
    profiles: [tavernProfile], lastResult: { status: 'succeeded', mode: 'install', stamp: 'installed' },
  })
  try {
    assert.deepEqual(page.calls, [['status', {}]])
    await page.act(async () => namedButton(page, '添加桌面快捷方式').click())
    assert.deepEqual(page.calls.at(-1), ['shortcut', {}])
    await page.act(async () => namedButton(page, '重启并切换到 DSH 酒馆').click())
    assert.deepEqual(page.calls.at(-1), ['link', { target: 'tavern' }])
  } finally {
    await page.dispose()
  }
})

test('酒馆启动器只提供切换到原版和酒馆的入口', async () => {
  const readerProfile = { name: 'reader', bundles: ['dsh-reader', 'dsh-profile-bridge'], hasNodeModules: true }
  const original = '重启并切换到原版 DSH'
  const tavern = '重启并切换到 DSH 酒馆'
  for (const [current, label, available, action, request] of [
    ['desktop', '原版 DSH', [tavern], tavern, ['link', { target: 'tavern' }]],
    ['reader', 'DSH 阅读器', [original, tavern], tavern, ['link', { target: 'tavern' }]],
    ['tavern', 'DSH 酒馆', [original], original, ['unlink', {}]],
  ]) {
    const linked = current !== 'desktop'
    const page = await mount({
      appKind: 'desktop', desktopApp: true, activeIsLink: linked, linkTargetName: linked ? current : undefined,
      backups: linked ? ['desktop.fresh-test'] : [], profiles: [tavernProfile, readerProfile],
    })
    assert.match(page.text(), new RegExp(`当前配置 · ${label}`))
    assert.deepEqual([...page.dom.window.document.querySelectorAll('.pb-bar button')].map(button => button.textContent), available)
    await page.act(async () => namedButton(page, action).click())
    assert.deepEqual(page.calls.at(-1), request)
    await page.dispose()
  }
})

async function enterDestination(page, value) {
  const input = page.dom.window.document.querySelector('#pb-destination')
  await page.act(async () => {
    Object.getOwnPropertyDescriptor(page.dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }))
  })
}

test('卸载需要独立确认，保留数据和原版 DSH；重复点击只提交一次', async () => {
  let finish
  const calls = []
  const page = await mount(managedStatus, calls, { rpc: async endpoint => endpoint === 'status'
    ? { ok: true, value: managedStatus } : endpoint === 'update-status'
      ? { ok: true, value: { phase: 'idle' } } : new Promise(resolve => { finish = resolve }) })
  await page.act(async () => namedButton(page, '删除 DSH 酒馆').click())
  assert.match(page.text(), /保留全部用户数据和备份，不卸载原版 DSH/)
  assert.deepEqual(calls.map(([endpoint]) => endpoint), ['status', 'update-status'])
  await page.act(async () => {
    namedButton(page, '确认删除并重启').click()
    namedButton(page, '确认删除并重启').click()
  })
  assert.deepEqual(calls.at(-1), ['uninstall', { confirmed: true }])
  assert.equal(calls.filter(([endpoint]) => endpoint === 'uninstall').length, 1)
  assert.equal(namedButton(page, '取消').disabled, true)
  await page.act(async () => finish({ ok: true, value: { closesApp: true } }))
  assert.match(page.text(), /操作已排队/)
  assert.equal(namedButton(page, '删除 DSH 酒馆').disabled, true)
  page.dispose()
})

test('迁移只接受绝对路径，显示失败后保留输入允许取消或重试', async () => {
  const page = await mount(managedStatus, [], { rpc: async endpoint => endpoint === 'status'
    ? { ok: true, value: managedStatus } : { ok: false, error: { message: '目标目录非空' } } })
  await page.act(async () => namedButton(page, '切换安装目录').click())
  await enterDestination(page, 'relative/path')
  assert.equal(namedButton(page, '确认迁移并重启').disabled, true)
  await enterDestination(page, 'D:\\DSH-Tavern')
  assert.equal(namedButton(page, '确认迁移并重启').disabled, false)
  await page.act(async () => namedButton(page, '确认迁移并重启').click())
  assert.deepEqual(page.calls.at(-1), ['relocate', { confirmed: true, destination: 'D:\\DSH-Tavern' }])
  assert.match(page.text(), /目标目录非空/)
  assert.equal(page.dom.window.document.querySelector('#pb-destination').value, 'D:\\DSH-Tavern')
  await page.act(async () => namedButton(page, '取消').click())
  assert.equal(page.dom.window.document.querySelector('#pb-destination'), null)
  page.dispose()
})
