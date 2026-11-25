#!/usr/bin/env node
// 应用内依赖更新的设备验收：新源码的依赖有变化时，在手机上用 APK 自带的 pnpm 补装，存档与设置保留；
// 依赖装不上时自动回退到原来的版本，服务照常可用。
//   node android/native/apk-deps-update-smoke.mjs [--apk <apk>] [--skip-install]
// 更新源是本机临时 HTTP 服务（adb reverse 到设备），内容由 make-test-release.sh 生成：
//   release-deps-ok ：tavern-plugin 新增一个依赖（is-odd@3.0.1）+ 一处代码改动 → 应在手机上补装后启动新版
//   release-deps-bad：新增一个不存在的依赖 → 补装失败 → 自动回退
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const PKG = 'io.github.flizzywine.dshtavern.bionic'
const APK = arg('--apk', join(repo, 'output/native-proto/apk/dsh-tavern-bionic-debug.apk'))
const OUT = arg('--out', join(repo, 'output/native-proto/apk-deps-update'))
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
    const line = `✓ ${name} ${Date.now() - start}ms ${v ? JSON.stringify(v).slice(0, 400) : ''}`
    console.log(line); appendFileSync(logFile, line + '\n')
  } catch (e) {
    report.steps.push({ name, ok: false, ms: Date.now() - start, error: String(e.stack || e) })
    appendFileSync(logFile, `✗ ${name}\n${e.stack || e}\n`)
    throw e
  }
}

// ---- UI 自动化（uiautomator，与 apk-launcher-smoke.mjs 相同）----
function screen() {
  let xml = ''
  try { xml = adb('shell', 'rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml 2>/dev/null') } catch { return [] }
  return [...xml.matchAll(/<node [^>]*>/g)].map(m => {
    const attr = k => (m[0].match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || ''
    const b = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    return { text: attr('text'), desc: attr('content-desc'), pkg: attr('package'), enabled: attr('enabled') === 'true',
      x: b ? (Number(b[1]) + Number(b[3])) / 2 : 0, y: b ? (Number(b[2]) + Number(b[4])) / 2 : 0 }
  })
}
async function waitFor(pattern, timeoutMs = 60000, { enabled = false } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = []
  while (Date.now() < deadline) {
    try {
      last = screen()
      const hit = last.find(n => (pattern.test(n.text) || pattern.test(n.desc)) && (!enabled || n.enabled))
      if (hit) return hit
    } catch {}
    await sleep(1500)
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
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
  await sleep(1500)
  for (let i = 0; i < 4 && !screen().some(n => /^进入酒馆$/.test(n.text)); i++) { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1200) }
  await waitFor(/^进入酒馆$/, 20000)
}
const mainPid = () => { try { return Number(adb('shell', 'pgrep', '-f', 'dsh/lib/bi[n].js').trim().split(/\s+/)[0]) || 0 } catch { return 0 } }
const nodeLog = () => { try { return runAs('cat files/logs/node.log') } catch { return '' } }
const urlPattern = new RegExp('dsh web: (http://127\\.0\\.0\\.1:\\d+/\\?' + 'tok' + 'en=\\S+)')
async function waitServer(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pid = mainPid()
    if (pid && urlPattern.test(nodeLog())) return pid
    await sleep(1000)
  }
  throw new Error('服务没有就绪\n' + nodeLog().slice(-2000))
}
const source = () => JSON.parse(runAs(`cat ${T}/src/.native-source.json`))
const exists = p => runAs(`[ -e ${p} ] && echo yes || echo no`).trim() === 'yes'
const sizeMb = p => Number(runAs(`du -sm ${p} 2>/dev/null | cut -f1`).trim() || 0)
/** 服务端能否加载新依赖：用服务自己的 node 在插件目录下解析。 */
function resolvesFromPlugin(name) {
  const dump = adb('shell', 'pm', 'dump', PKG)
  const lib = dump.match(/legacyNativeLibraryDir=(\S+)/)[1] + '/' + dump.match(/primaryCpuAbi=(\S+)/)[1].replace('arm64-v8a', 'arm64')
  const out = runAs(`cd ${T}/src/tavern-plugin && ${lib}/libnode.so -e "try{console.log(require.resolve(process.argv[1]))}catch(e){console.log(\\"MISSING\\")}" ${name}`)
  return out.trim()
}

let server
try {
  if (!process.argv.includes('--skip-install')) await step('安装 APK，首次启动', async () => {
    try { adb('uninstall', PKG) } catch {}
    adb('install', '-r', APK)
    adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
    return { pid: await waitServer(300000) }
  })
  else await step('打开应用，服务就绪', async () => {
    adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
    return { pid: await waitServer(300000) }
  })

  const before = source()
  await step('写入用户数据标记（更新后应保留）', () => {
    runAs(`mkdir -p ${DATA}/cards && echo keep-me > ${DATA}/cards/deps-update-marker.txt`)
    return { source: `${before.revision.slice(0, 7)} seq ${before.sequence}`, profileModules: sizeMb(`${H}/profiles/tavern/node_modules`) + ' MB' }
  })

  // ---- 更新源 ----
  const fixtures = join(OUT, 'releases')
  rmSync(fixtures, { recursive: true, force: true })
  const stageSrc = join(repo, 'output/native-proto/apk/payload/stage/src')
  await step('准备本地更新源（依赖新增 / 依赖装不上）', () => {
    const make = (tree, seq, dir) => execFileSync('bash', [join(repo, 'android/native/make-test-release.sh'), tree, String(seq), join(fixtures, dir)], { windowsHide: true, encoding: 'utf8' })
    for (const [dir, seq, dep] of [['release-deps-ok', before.sequence + 10, ['is-odd', '3.0.1']], ['release-deps-bad', before.sequence + 20, ['dsh-tavern-no-such-package-e2e', '9.9.9']]]) {
      const tree = join(OUT, dir)
      rmSync(tree, { recursive: true, force: true })
      cpSync(stageSrc, tree, { recursive: true, verbatimSymlinks: true })
      const manifest = join(tree, 'tavern-plugin/package.json')
      const doc = JSON.parse(readFileSync(manifest, 'utf8'))
      doc.dependencies = { ...doc.dependencies, [dep[0]]: dep[1] }
      writeFileSync(manifest, JSON.stringify(doc, null, 2) + '\n')
      appendFileSync(join(tree, 'tavern-plugin/lib/index.js'), `\n// ${dir}-marker\n`)
      make(tree, seq, dir)
    }
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { windowsHide: true, cwd: fixtures, stdio: 'ignore' })
    adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`)
  })
  const useRelease = name => {
    const base = `http://127.0.0.1:${PORT}/${name}`
    const keep = (() => { try { return runAs(`cat ${T}/extra-env`).split('\n').filter(l => l.startsWith('TAVERN_E2E')).join('\n') } catch { return '' } })()
    writeFileSync(join(OUT, 'extra-env'), [keep, `DSH_TAVERN_CDN_METADATA_URL=${base}/repo@runtime-archive-main/dsh-tavern-runtime.json`,
      `DSH_TAVERN_CDN_ROOT_URL=${base}/repo`, `DSH_NATIVE_APK_FEED=${base}/native/dsh-tavern-native.json`].filter(Boolean).join('\n') + '\n')
    pushAs(join(OUT, 'extra-env'), `${T}/extra-env`)
  }
  async function runUpdate(release, expectDone) {
    useRelease(release)
    await openLauncher()
    await scrollTo(/检查更新/)
    await tap(/^检查更新$/)
    const offer = await waitFor(/依赖(可能)?有变化，更新时会在手机上补装/, 90000)
    await tap(/^更新源码$/)
    await tap(/^更新$/)
    const started = Date.now()
    // 进度文字随 pnpm 输出变化，顺带记下来。
    const seen = new Set()
    const deadline = Date.now() + 20 * 60000
    let done
    while (Date.now() < deadline && !done) {
      for (const n of screen()) {
        if (/补装|根依赖|安装器|切换|备份|启动新版本|已解析/.test(n.text)) seen.add(n.text.slice(0, 80))
        if (expectDone.test(n.text)) done = n.text
      }
      if (!done) await sleep(2000)
    }
    if (!done) throw new Error('更新没有结束：' + [...seen].slice(-5).join(' | '))
    return { offer: offer.text.slice(0, 80), result: done.slice(0, 160), seconds: Math.round((Date.now() - started) / 1000), progress: [...seen].slice(0, 6) }
  }

  await step('依赖新增：检查 → 更新源码 → 手机上补装 → 启动新版', async () => {
    const r = await runUpdate('release-deps-ok', /已更新到.*依赖已在手机上补装/)
    const s = source()
    if (s.sequence !== before.sequence + 10 || !s.depsUpdated) throw new Error('源码没换：' + JSON.stringify(s))
    const resolved = resolvesFromPlugin('is-odd')
    if (resolved === 'MISSING') throw new Error('新依赖 is-odd 没装上')
    await waitServer(60000)
    for (const leftover of ['pnpm-store', 'update-backup', 'src.prev', 'src.next']) if (exists(`${T}/${leftover}`)) throw new Error('临时目录没清理：' + leftover)
    if (runAs(`cat ${DATA}/cards/deps-update-marker.txt`).trim() !== 'keep-me') throw new Error('用户数据丢失')
    if (!exists(`${H}/profiles/tavern/node_modules/dsh-web-mobile`)) throw new Error('手机布局 dsh-web-mobile 丢失')
    const updateLog = runAs('cat files/logs/update.log')
    writeFileSync(join(OUT, 'update-ok.log'), updateLog)
    const downloads = [...updateLog.matchAll(/downloaded (\d+), added (\d+), done/g)].map(m => `${m[1]}/${m[2]}`)
    return { ...r, resolved, downloadedAdded: downloads, cacheMb: sizeMb(`${T}/pnpm-cache`) }
  })

  const good = source()
  await step('依赖装不上：自动回退到原来的版本，服务照常运行', async () => {
    const r = await runUpdate('release-deps-bad', /更新失败，已回退/)
    const s = source()
    if (s.sequence !== good.sequence) throw new Error('没有回退：' + JSON.stringify(s))
    await waitServer(120000)
    if (resolvesFromPlugin('is-odd') === 'MISSING') throw new Error('回退后原有依赖丢失')
    for (const leftover of ['pnpm-store', 'update-backup']) if (exists(`${T}/${leftover}`)) throw new Error('临时目录没清理：' + leftover)
    if (runAs(`cat ${DATA}/cards/deps-update-marker.txt`).trim() !== 'keep-me') throw new Error('用户数据丢失')
    writeFileSync(join(OUT, 'update-bad.log'), runAs('cat files/logs/update.log'))
    return r
  })

  await step('占用', () => ({ t: sizeMb(T) + ' MB', profileModules: sizeMb(`${H}/profiles/tavern/node_modules`) + ' MB',
    srcModules: sizeMb(`${T}/src/node_modules`) + ' MB', pluginModules: sizeMb(`${T}/src/tavern-plugin/node_modules`) + ' MB' }))
  report.ok = true
} catch (e) {
  report.ok = false
  report.error = String(e.stack || e)
  console.error(e.stack || e)
  process.exitCode = 1
} finally {
  server?.kill()
  try { adb('reverse', '--remove', `tcp:${PORT}`) } catch {}
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}
