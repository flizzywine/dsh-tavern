#!/usr/bin/env node
// APK 验收：安装 → 首次启动（解压 + 起服务）→ 注入固定输出模型 → 冷启动 →
// 通过 WebView 远程调试（CDP）直接操作 APK 里的 WebView：开局、发一轮、刷新、强停重开后存档仍在。
//   node android/native/apk-smoke.mjs [--apk path] [--no-install] [--serial emulator-5554]
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _android as android } from 'playwright'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const PKG = 'io.github.flizzywine.dshtavern.bionic'
const APK = arg('--apk', join(repo, 'output/native-proto/apk/dsh-tavern-bionic-debug.apk'))
const SERIAL = arg('--serial', process.env.ANDROID_SERIAL || '')
const OUT = arg('--out', join(repo, 'output/native-proto/apk-smoke'))
const T = `/data/user/0/${PKG}/files/t`
const H = `${T}/home/.dsh-tavern`
const DATA = `${H}/profile-data/tavern/data`
mkdirSync(OUT, { recursive: true })
const pre = SERIAL ? ['-s', SERIAL] : []
const adb = (...a) => execFileSync('adb', [...pre, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 })
const runAs = cmd => adb('shell', `run-as ${PKG} sh -c '${cmd.replace(/'/g, `'\\''`)}'`)
const pushAs = (local, remote) => {
  const r = spawnSync('adb', [...pre, 'exec-in', 'run-as', PKG, 'sh', '-c', `mkdir -p '${dirname(remote)}' && cat > '${remote}'`], { input: readFileSync(local) })
  if (r.status !== 0) throw new Error(`写入 ${remote} 失败：${r.stderr}`)
}
const report = { apk: APK, steps: [] }
const t0 = Date.now()
async function step(name, fn) {
  const start = Date.now()
  try { const v = await fn(); report.steps.push({ name, ok: true, ms: Date.now() - start, ...(v && typeof v === 'object' ? v : {}) }); console.log('✓', name, `${Date.now() - start}ms`) }
  catch (e) { report.steps.push({ name, ok: false, ms: Date.now() - start, error: String(e.stack || e) }); throw e }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function launchAndWait(timeoutMs) {
  adb('shell', 'am', 'force-stop', PKG)
  try { runAs('rm -f files/logs/node.log') } catch {}
  const begin = Date.now()
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`)
  while (Date.now() - begin < timeoutMs) {
    let log = ''
    try { log = runAs('cat files/logs/node.log 2>/dev/null') } catch {}
    const url = log.match(new RegExp('dsh web: (http://127\\.0\\.0\\.1:\\d+/\\?' + 'tok' + 'en=\\S+)'))?.[1]
    if (url) return { url, ms: Date.now() - begin }
    await sleep(500)
  }
  let log = ''; try { log = runAs('cat files/logs/node.log') } catch {}
  throw new Error('服务启动超时\n' + log.slice(-4000))
}

async function connectWebView() {
  // Playwright 的 Android 通道：直接附到 APK 进程的 WebView（webview_devtools_remote_<pid>），不需要浏览器级接口。
  const devices = await android.devices()
  const device = SERIAL ? devices.find(d => d.serial() === SERIAL) : devices[0]
  if (!device) throw new Error('没有 adb 设备')
  const pid = Number(adb('shell', 'pidof', PKG).trim().split(/\s+/)[0])
  // 按 pid 取：Playwright 用 `ps -A | grep <pid>` 反查包名，会误取到父进程号相同的 libnode.so 子进程。
  let webview
  for (let i = 0; i < 60 && !webview; i++) { webview = device.webViews().find(w => w.pid() === pid); if (!webview) await sleep(500) }
  if (!webview) throw new Error('找不到 APK 的 WebView 调试接口')
  const page = await webview.page()
  for (let i = 0; i < 60 && !page.url().includes('127.0.0.1:'); i++) await sleep(500)
  return { browser: device, page }
}

let browser, page
const errors = []
function watch(p) {
  p.on('pageerror', e => errors.push(e.message))
  p.setDefaultTimeout(60000)
}
async function dismissNotice() {
  // 全新数据目录的「预览版说明」弹窗出现得晚，而且盖住整个页面：最多等 5 秒。
  const cont = page.getByRole('button', { name: /^(Continue|继续)$/ })
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await cont.isVisible().catch(() => false)) { await cont.click(); await cont.waitFor({ state: 'hidden' }).catch(() => {}); return }
    if (!await page.locator('[role="presentation"] [aria-hidden="true"]').filter({ visible: true }).count().catch(() => 0)) return
    await page.waitForTimeout(300)
  }
}
// 手机布局（dsh-web-mobile）：酒馆面板在左侧抽屉里，由悬浮按钮（fab）打开。
async function openDrawer() {
  const picker = page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).filter({ visible: true })
  if (await picker.count()) return
  for (const selector of ['[data-mobile-nav="fab"]', '[data-mobile-nav="toggle"]']) {
    const button = page.locator(selector).filter({ visible: true }).first()
    if (await button.count()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await button.click({ timeout: 10000 }); break } catch (error) { if (attempt === 2) throw error; await dismissNotice() }
      }
      break
    }
  }
  await picker.first().waitFor()
}
async function storyVisible(text) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) if (await frame.getByText(text).first().isVisible().catch(() => false)) return
    await page.waitForTimeout(250)
  }
  throw new Error('正文未出现：' + text)
}
function memory() {
  const pid = adb('shell', 'pgrep', '-f', 'libnode.so').trim().split(/\s+/)
  return pid.filter(Boolean).map(p => {
    const status = adb('shell', 'cat', `/proc/${p}/status`)
    return { pid: Number(p), rssMB: Math.round(Number(status.match(/VmRSS:\s+(\d+)/)?.[1]) / 1024) }
  })
}

try {
  if (!process.argv.includes('--no-install')) await step('安装 APK', () => {
    try { adb('uninstall', PKG) } catch {}
    adb('install', '-r', APK)
    const lib = adb('shell', 'pm', 'dump', PKG).match(/legacyNativeLibraryDir=\S+|nativeLibraryDir=\S+/)?.[0]
    return { nativeLibraryDir: lib }
  })
  await step('首次启动：解压载荷并起服务', async () => {
    const r = await launchAndWait(600000)
    const extract = runAs('cat files/logs/node.log >/dev/null; ls files').trim()
    return { firstLaunchMs: r.ms, files: extract }
  })
  report.diskMB = runAs('du -sm files/t').trim()
  await step('注入固定输出模型与验收卡', () => {
    for (const f of ['model.mjs', 'recovery-model.mjs', 'compaction-model.mjs']) pushAs(join(repo, 'tests/e2e', f), `${T}/src/tests/e2e/${f}`)
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: {
      name: 'E2E 奖励验收', description: '固定验收角色', first_mes: '欢迎领取奖励。\n\n<StatusPlaceHolderImpl/>', mes_example: '', scenario: '', personality: '',
      character_book: { name: '验收初始变量', entries: [{ id: 1, keys: [], comment: '[initvar]初始值', content: 'gold: 0', enabled: true, constant: true, insertion_order: 1 }] },
      extensions: { mvu: {} } } }
    writeFileSync(join(OUT, 'e2e.json'), JSON.stringify(card)); pushAs(join(OUT, 'e2e.json'), `${DATA}/resources/cards/e2e.json`)
    const patch = runAs(`cat ${H}/profiles/tavern/cordis.patch.yml`).replace(/\r/g, '')
    if (!patch.includes('tavern-e2e-model')) {
      writeFileSync(join(OUT, 'cordis.patch.yml'), patch + `- id: agent-default-model\n  config:\n    provider: tavern-e2e\n    model: fixed\n- insert:\n    - id: tavern-e2e-model\n      name: ${T}/src/tests/e2e/model.mjs\n`)
      pushAs(join(OUT, 'cordis.patch.yml'), `${H}/profiles/tavern/cordis.patch.yml`)
    }
    writeFileSync(join(OUT, 'extra-env'), `TAVERN_E2E_LLM_MODULE=${H}/runtime/lib/node_modules/@deepseek-ai/dsh-llm/lib/index.js\n`)
    pushAs(join(OUT, 'extra-env'), `${T}/extra-env`)
    runAs(`rm -rf ${H}/profile-data/tavern/sessions ${DATA}/chats`)
  })
  await step('冷启动（已解压）', async () => { const r = await launchAndWait(120000); return { bootMs: r.ms } })
  await step('连上 APK 内的 WebView', async () => {
    ({ browser, page } = await connectWebView()); watch(page)
    const ready = page.locator('[data-mobile-nav="fab"], [data-mobile-nav="toggle"]').or(page.getByRole('button', { name: /选择人物卡.*新开游玩/ }))
    const cont = page.getByRole('button', { name: /^(Continue|继续)$/ })
    await Promise.race([cont.waitFor(), ready.filter({ visible: true }).first().waitFor()])
    const ua = await page.evaluate(() => navigator.userAgent)
    const viewport = await page.evaluate(() => `${innerWidth}x${innerHeight}@${devicePixelRatio}`)
    return { userAgent: ua, viewport }
  })
  await step('选卡开局', async () => {
    await dismissNotice()
    await openDrawer()
    await page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).filter({ visible: true }).first().click()
    await dismissNotice()
    await page.getByRole('dialog', { name: '选择人物卡开始游玩' }).getByText('E2E 奖励验收', { exact: true }).first().click()
    await page.getByRole('textbox', { name: /下一步行动|Next action|发消息|Message/ }).filter({ visible: true }).first().waitFor()
    await storyVisible('欢迎领取奖励。')
  })
  await step('发送一轮并看到正文', async () => {
    const start = Date.now()
    const composer = page.getByRole('textbox', { name: /下一步行动|Next action|发消息|Message/ }).filter({ visible: true }).first()
    await composer.fill('领取任务奖励'); await composer.press('Enter')
    await storyVisible('你获得了十枚金币。')
    return { turnMs: Date.now() - start }
  })
  await step('刷新后对局仍在', async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await storyVisible('你获得了十枚金币。') })
  report.memory = memory()
  await step('强行停止应用后重开，存档仍在', async () => {
    await browser.close().catch(() => {})
    const r = await launchAndWait(120000)
    ;({ browser, page } = await connectWebView()); watch(page)
    await storyVisible('你获得了十枚金币。').catch(async () => {
      await dismissNotice()
      await openDrawer()
      const toggle = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: 'E2E 奖励验收' }).first()
      if (await toggle.isVisible().catch(() => false)) await toggle.click()
      await page.locator('.dsh-tavern-side-row-name').filter({ visible: true }).first().click()
      await storyVisible('你获得了十枚金币。')
    })
    return { bootMs: r.ms }
  })
  await step('HTTPS 证书校验（以应用身份请求模型 API）', () => {
    const dump = adb('shell', 'pm', 'dump', PKG)
    const dir = dump.match(/legacyNativeLibraryDir=(\S+)/)[1] + '/' + dump.match(/primaryCpuAbi=(\S+)/)[1].replace('arm64-v8a', 'arm64')
    const out = runAs(`${dir}/libnode.so --use-bundled-ca -e "fetch(\\"https://api.deepseek.com/\\").then(r=>console.log(\\"status\\",r.status)).catch(e=>console.log(\\"ERR\\",e.cause&&e.cause.code))"`).trim()
    if (!/^status \d+/.test(out)) throw new Error('HTTPS 失败：' + out)
    return { result: out }
  })
  report.pageErrors = errors
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.pageErrors = errors
  if (page) {
    report.pageText = await page.locator('body').innerText().then(t => t.slice(0, 3000)).catch(() => '')
    await page.screenshot({ path: join(OUT, 'failure.png') }).catch(() => {})
  }
  try { report.nodeLog = runAs('cat files/logs/node.log').slice(-6000) } catch {}
  console.error(error)
  process.exitCode = 1
} finally {
  report.totalMs = Date.now() - t0
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close().catch(() => {})
  console.log('报告：' + join(OUT, 'report.json'))
}
