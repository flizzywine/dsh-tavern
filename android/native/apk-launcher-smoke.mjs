#!/usr/bin/env node
// 启动页 / 后台保活 / 图片处理 / 两档更新 的设备验收（在 apk-smoke 已装好并玩过一局的基础上）。
//   node android/native/apk-launcher-smoke.mjs --next-apk <versionCode 更大的 APK> [--skip-install]
// 更新源是本机临时起的 HTTP 服务（adb reverse 到设备），内容由 make-test-release.sh 生成：
//   release-src：只改了插件代码 → 应走「更新源码」
//   release-deps：锁文件变了 + 发布了新安装包 → 应走「下载安装包 → 安装」，覆盖安装后热更新过的源码与存档都保留
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const PKG = 'io.github.flizzywine.dshtavern.bionic'
const APK = arg('--apk', join(repo, 'output/native-proto/apk/dsh-tavern-bionic-debug.apk'))
const NEXT_APK = arg('--next-apk', '')
const NEXT_CODE = arg('--next-code', '4')
const OUT = arg('--out', join(repo, 'output/native-proto/apk-launcher'))
const PORT = 8731
const T = `/data/user/0/${PKG}/files/t`
const H = `${T}/home/.dsh-tavern`
const DATA = `${H}/profile-data/tavern/data`
mkdirSync(OUT, { recursive: true })
const adb = (...a) => execFileSync('adb', a, { windowsHide: true, encoding: 'utf8', maxBuffer: 64 << 20 })
const runAs = cmd => adb('shell', `run-as ${PKG} sh -c '${cmd.replace(/'/g, `'\\''`)}'`)
const pushAs = (local, remote) => {
  const r = spawnSync('adb', ['exec-in', 'run-as', PKG, 'sh', '-c', `mkdir -p '${dirname(remote)}' && cat > '${remote}'`], { windowsHide: true, input: readFileSync(local) })
  if (r.status !== 0) throw new Error(`写入 ${remote} 失败：${r.stderr}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const report = { steps: [] }
const logFile = join(OUT, 'steps.log')
writeFileSync(logFile, '')
async function step(name, fn) {
  const start = Date.now()
  try {
    const v = await fn()
    report.steps.push({ name, ok: true, ms: Date.now() - start, ...(v && typeof v === 'object' ? v : {}) })
    const line = `✓ ${name} ${Date.now() - start}ms ${v ? JSON.stringify(v).slice(0, 300) : ''}`
    console.log(line); appendFileSync(logFile, line + '\n')
  } catch (e) {
    report.steps.push({ name, ok: false, ms: Date.now() - start, error: String(e.stack || e) })
    appendFileSync(logFile, `✗ ${name}\n${e.stack || e}\n`)
    throw e
  }
}

// ---- UI 自动化（uiautomator）----
function screen() {
  // 先删旧文件：界面一直在动时 uiautomator 会报 could not get idle state，留下的旧文件会误导判断。
  let xml = ''
  try { xml = adb('shell', 'rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml 2>/dev/null') } catch { return [] }
  return [...xml.matchAll(/<node [^>]*>/g)].map(m => {
    const attr = k => (m[0].match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || ''
    const b = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    return { text: attr('text'), desc: attr('content-desc'), pkg: attr('package'), enabled: attr('enabled') === 'true',
      checked: attr('checked') === 'true', x: b ? (Number(b[1]) + Number(b[3])) / 2 : 0, y: b ? (Number(b[2]) + Number(b[4])) / 2 : 0 }
  })
}
async function waitFor(pattern, timeoutMs = 60000, { enabled = false, foreign = false } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = []
  while (Date.now() < deadline) {
    try {
      last = screen()
      const hit = last.find(n => (pattern.test(n.text) || pattern.test(n.desc)) && (!enabled || n.enabled) && (!foreign || n.pkg !== PKG))
      if (hit) return hit
    } catch {}
    await sleep(800)
  }
  throw new Error(`界面上没等到 ${pattern}；当前文字：${last.map(n => n.text).filter(Boolean).join(' | ').slice(0, 1500)}`)
}
async function tap(pattern, timeoutMs) {
  const node = await waitFor(pattern, timeoutMs, { enabled: true })
  adb('shell', 'input', 'tap', String(Math.round(node.x)), String(Math.round(node.y)))
  await sleep(600)
}
async function scrollTo(pattern) {
  for (let i = 0; i < 6; i++) {
    if (screen().some(n => pattern.test(n.text))) return
    adb('shell', 'input', 'swipe', '540', '1800', '540', '700', '300')
    await sleep(500)
  }
}
async function openLauncher() {
  // 像点桌面图标一样打开（任务退到后台后，不带 LAUNCHER 的 am start 不会把它带回前台）。
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
  await sleep(1500)
  // 启动页顶部是「进入酒馆」；酒馆页面自己的返回历史可能要多按几次。
  for (let i = 0; i < 4 && !screen().some(n => /^进入酒馆$/.test(n.text)); i++) { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1200) }
  await waitFor(/^进入酒馆$/, 20000)
}
const nodePids = () => adb('shell', 'pgrep', '-f', 'libnode.so').trim().split(/\s+/).filter(Boolean).map(Number)
const mainPid = () => { try { return Number(adb('shell', 'pgrep', '-f', 'dsh/lib/bi[n].js').trim().split(/\s+/)[0]) || 0 } catch { return 0 } }
const nodeLog = () => { try { return runAs('cat files/logs/node.log') } catch { return '' } }
const urlPattern = new RegExp('dsh web: (http://127\\.0\\.0\\.1:\\d+/\\?' + 'tok' + 'en=\\S+)')
async function waitServer(timeoutMs = 180000, notPid = 0) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pid = mainPid()
    if (pid && pid !== notPid && urlPattern.test(nodeLog())) return pid
    await sleep(1000)
  }
  throw new Error('服务没有就绪\n' + nodeLog().slice(-2000))
}

let server
try {
  if (!process.argv.includes('--skip-install')) await step('安装并玩一局（apk-smoke）', () => {
    const r = spawnSync('node', [join(repo, 'android/native/apk-smoke.mjs'), '--apk', APK, '--out', join(OUT, 'smoke')], { windowsHide: true, encoding: 'utf8', timeout: 900000 })
    if (r.status !== 0) throw new Error('apk-smoke 失败\n' + (r.stdout + r.stderr).slice(-3000))
  })

  await step('打开应用，服务就绪', async () => {
    adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
    return { pid: await waitServer(300000) }
  })

  await step('图片处理：sharp（wasm）在应用里可用', () => {
    writeFileSync(join(OUT, 'sharp-check.cjs'), `
const sharp = require(${JSON.stringify(`${H}/runtime/lib/node_modules/sharp`)})
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#c33"/><circle cx="800" cy="600" r="400" fill="#3c3"/></svg>')
;(async () => { const t = Date.now(); const png = await sharp(svg).png().toBuffer(); const out = await sharp(png).resize(400).webp().toBuffer(); const m = await sharp(out).metadata()
  console.log(JSON.stringify({ ok: true, ms: Date.now() - t, out: m.width + 'x' + m.height + ' ' + m.format, vips: sharp.versions.vips, wasm: !!sharp.versions.emscripten })) })()
  .catch(e => console.log(JSON.stringify({ ok: false, error: e.message })))`)
    pushAs(join(OUT, 'sharp-check.cjs'), `${T}/tmp/sharp-check.cjs`)
    const dump = adb('shell', 'pm', 'dump', PKG)
    const lib = dump.match(/legacyNativeLibraryDir=(\S+)/)[1] + '/' + dump.match(/primaryCpuAbi=(\S+)/)[1].replace('arm64-v8a', 'arm64')
    const out = JSON.parse(runAs(`${lib}/libnode.so ${T}/tmp/sharp-check.cjs`).trim().split('\n').pop())
    if (!out.ok || !out.wasm) throw new Error(JSON.stringify(out))
    return out
  })

  await step('保活：服务运行时持有唤醒锁', () => {
    const held = adb('shell', 'dumpsys', 'power').split('\n').filter(l => l.includes('dshtavern:server'))
    if (!held.length) throw new Error('没有 dshtavern:server 唤醒锁')
    return { wakeLock: held[0].trim().slice(0, 120) }
  })

  await step('启动页：从酒馆按返回回到启动页，能看到状态与按钮', async () => {
    await openLauncher()
    const s = screen()
    const texts = s.map(n => n.text).filter(Boolean)
    for (const want of [/运行中/, /进入酒馆/, /重启/]) if (!texts.some(t => want.test(t))) throw new Error('缺少 ' + want + '：' + texts.join(' | '))
    await scrollTo(/检查更新/)
    await waitFor(/^检查更新$/, 5000)
    return { status: texts.find(t => /运行中/.test(t)) }
  })

  // ---- 更新源 ----
  const fixtures = join(OUT, 'releases')
  rmSync(fixtures, { recursive: true, force: true })
  const stageSrc = join(repo, 'output/native-proto/apk/payload/stage/src')
  await step('准备本地更新源（源码更新 / 依赖变化 + 新安装包）', () => {
    const tree1 = join(OUT, 'tree-src'), tree2 = join(OUT, 'tree-deps')
    for (const t of [tree1, tree2]) { rmSync(t, { recursive: true, force: true }); cpSync(stageSrc, t, { recursive: true, verbatimSymlinks: true }) }
    appendFileSync(join(tree1, 'tavern-plugin/lib/index.js'), '\n// hot-update-marker\n')
    appendFileSync(join(tree2, 'tavern-plugin/lib/index.js'), '\n// hot-update-marker\n')
    // 更换 DSH 运行时（config/cli-runtime）才需要新安装包；其余依赖变化在手机上补装（见 apk-deps-update-smoke.mjs）。
    const runtimeManifest = join(tree2, 'config/cli-runtime/package.json')
    writeFileSync(runtimeManifest, JSON.stringify({ ...JSON.parse(readFileSync(runtimeManifest, 'utf8')), description: 'runtime-changed' }, null, 2) + '\n')
    const make = (tree, seq, dir, extra = []) => execFileSync('bash', [join(repo, 'android/native/make-test-release.sh'), tree, String(seq), join(fixtures, dir), ...extra], { windowsHide: true, encoding: 'utf8' })
    make(tree1, 3001, 'release-src')
    make(tree2, 3002, 'release-deps', NEXT_APK ? [NEXT_APK, NEXT_CODE, 'next-test'] : [])
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { windowsHide: true, cwd: fixtures, stdio: 'ignore' })
    adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`)
  })
  const useRelease = async name => {
    const base = `http://127.0.0.1:${PORT}/${name}`
    const keep = (() => { try { return runAs(`cat ${T}/extra-env`).split('\n').filter(l => l.startsWith('TAVERN_E2E')).join('\n') } catch { return '' } })()
    writeFileSync(join(OUT, 'extra-env'), [keep, `DSH_TAVERN_CDN_METADATA_URL=${base}/repo@runtime-archive-main/dsh-tavern-runtime.json`,
      `DSH_TAVERN_CDN_ROOT_URL=${base}/repo`, `DSH_NATIVE_APK_FEED=${base}/native/dsh-tavern-native.json`].filter(Boolean).join('\n') + '\n')
    pushAs(join(OUT, 'extra-env'), `${T}/extra-env`)
  }

  await step('源码热更新：检查 → 更新源码 → 自动重启到新源码', async () => {
    await useRelease('release-src')
    await openLauncher()
    await scrollTo(/检查更新/)
    await tap(/^检查更新$/)
    await waitFor(/依赖没变，可以直接更新源码/, 90000)
    await tap(/^更新源码$/)
    await tap(/^更新$/)
    await waitFor(/已更新到/, 300000)
    const marker = runAs(`tail -c 40 ${T}/src/tavern-plugin/lib/index.js`)
    const source = JSON.parse(runAs(`cat ${T}/src/.native-source.json`))
    if (!marker.includes('hot-update-marker') || source.from !== 'hot-update' || source.sequence !== 3001) throw new Error('源码没换：' + JSON.stringify(source))
    const kept = runAs(`ls ${T}/src/tavern-plugin/node_modules | wc -l; cat ${T}/src/.dsh-tavern-local.json`)
    await waitServer(60000)
    return { sequence: source.sequence, kept: kept.trim().split('\n')[0] + ' node_modules 条目' }
  })

  await step('更换 DSH 运行时：检查 → 提示新安装包', async () => {
    await useRelease('release-deps')
    await openLauncher()
    await scrollTo(/检查更新/)
    await tap(/^检查更新$/)
    const hit = await waitFor(NEXT_APK ? /有新版安装包/ : /更换了 DSH 运行时/, 90000)
    return { message: hit.text }
  })

  if (NEXT_APK) await step('整包更新：下载 → 校验 → 安装 → 重新启动，热更新的源码和存档都保留', async () => {
    const chats = runAs(`ls ${DATA}/chats`).trim()
    adb('shell', 'appops', 'set', PKG, 'REQUEST_INSTALL_PACKAGES', 'allow')
    await tap(/^下载安装包$/)
    await waitFor(/已下载并校验/, 600000)
    await tap(/^安装$/)
    // 系统确认框（不同系统版本的按钮文字不同）
    const confirm = await waitFor(/^(Update|UPDATE|更新|Install|INSTALL|安装)$/, 60000, { enabled: true, foreign: true })
    adb('shell', 'input', 'tap', String(Math.round(confirm.x)), String(Math.round(confirm.y)))
    const deadline = Date.now() + 180000
    let code = ''
    while (Date.now() < deadline) {
      code = (adb('shell', 'dumpsys', 'package', PKG).match(/versionCode=(\d+)/) || [])[1]
      if (code === NEXT_CODE) break
      await sleep(2000)
    }
    if (code !== NEXT_CODE) throw new Error('版本没变：' + code)
    // MY_PACKAGE_REPLACED 会拉起服务；保险起见也打开界面。
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`)
    await waitServer(300000)
    const source = JSON.parse(runAs(`cat ${T}/src/.native-source.json`))
    const after = runAs(`ls ${DATA}/chats`).trim()
    if (source.from !== 'hot-update' || source.sequence !== 3001) throw new Error('热更新过的源码被 APK 旧源码覆盖：' + JSON.stringify(source))
    if (after !== chats) throw new Error(`存档变化：${chats} → ${after}`)
    return { versionCode: code, source: source.sequence, chats: after }
  })
  // 放在最后：强制 Doze 之后模拟器的无障碍窗口列表会失效，uiautomator 看不到应用界面。
  await step('保活：Node 被强杀后自动重启', async () => {
    const before = mainPid()
    if (!before) throw new Error('找不到 DSH 主进程')
    runAs(`kill -9 ${before}`)
    const after = await waitServer(60000, before)
    if (!/自动重启/.test(nodeLog() + runAs('cat files/logs/node.prev.log 2>/dev/null || true')) && after === before) throw new Error('没有重启')
    return { before, after }
  })

  await step('保活：退到后台 + 强制进入 Doze 30 秒，服务仍在', async () => {
    const pid = mainPid()
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    adb('shell', 'dumpsys', 'battery', 'unplug')
    adb('shell', 'dumpsys', 'deviceidle', 'force-idle')
    await sleep(30000)
    const still = mainPid()
    const probe = runAs(`${'toybox'} nc -z 127.0.0.1 3081 && echo open || echo closed`).trim()
    adb('shell', 'dumpsys', 'deviceidle', 'unforce')
    adb('shell', 'dumpsys', 'battery', 'reset')
    if (still !== pid || probe !== 'open') throw new Error(`后台被停：pid ${pid} → ${still}，端口 ${probe}`)
    return { pid, port: probe }
  })

  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.nodeLog = nodeLog().slice(-4000)
  console.error(error)
  process.exitCode = 1
} finally {
  server?.kill()
  try { adb('reverse', '--remove', `tcp:${PORT}`) } catch {}
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log('报告：' + join(OUT, 'report.json'))
}
