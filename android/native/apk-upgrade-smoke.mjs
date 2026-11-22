#!/usr/bin/env node
// 覆盖安装验收：装旧 APK 玩一局并留下用户改动 → 覆盖安装新 APK → 程序文件已换新、存档与设置原样保留、能继续玩；
// 另查新版的两项修复：日志里没有 Invalid namespace，「开始更新」被拦下并提示覆盖安装。
//   node android/native/apk-upgrade-smoke.mjs --from v1.apk [--to new.apk]
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _android as android } from 'playwright'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const PKG = 'io.github.flizzywine.dshtavern.bionic'
const FROM = arg('--from', join(repo, 'output/native-proto/apk/v1.apk'))
const TO = arg('--to', join(repo, 'output/native-proto/apk/dsh-tavern-bionic-debug.apk'))
const OUT = arg('--out', join(repo, 'output/native-proto/apk-upgrade'))
const T = `/data/user/0/${PKG}/files/t`
const H = `${T}/home/.dsh-tavern`
const DATA = `${H}/profile-data/tavern/data`
const MARK = '# upgrade-marker-' + Date.now()
mkdirSync(OUT, { recursive: true })
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', maxBuffer: 64 << 20 })
const runAs = cmd => adb('shell', `run-as ${PKG} sh -c '${cmd.replace(/'/g, `'\\''`)}'`)
const pushAs = (local, remote) => {
  const r = spawnSync('adb', ['exec-in', 'run-as', PKG, 'sh', '-c', `mkdir -p '${dirname(remote)}' && cat > '${remote}'`], { input: readFileSync(local) })
  if (r.status !== 0) throw new Error(`写入 ${remote} 失败：${r.stderr}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const report = { from: FROM, to: TO, steps: [] }
async function step(name, fn) {
  const start = Date.now()
  try { const v = await fn(); report.steps.push({ name, ok: true, ms: Date.now() - start, ...(v && typeof v === 'object' ? v : {}) }); console.log('✓', name, `${Date.now() - start}ms`) }
  catch (e) { report.steps.push({ name, ok: false, ms: Date.now() - start, error: String(e.stack || e) }); throw e }
}
const urlPattern = new RegExp('dsh web: (http://127\\.0\\.0\\.1:\\d+/\\?' + 'tok' + 'en=\\S+)')
async function launch(timeoutMs = 600000) {
  adb('shell', 'am', 'force-stop', PKG)
  try { runAs('rm -f files/logs/node.log') } catch {}
  const begin = Date.now()
  adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`)
  while (Date.now() - begin < timeoutMs) {
    let log = ''
    try { log = runAs('cat files/logs/node.log 2>/dev/null') } catch {}
    if (urlPattern.test(log)) return { ms: Date.now() - begin, log }
    await sleep(500)
  }
  throw new Error('服务启动超时')
}
function pushTestModel() {
  for (const f of ['model.mjs', 'recovery-model.mjs', 'compaction-model.mjs']) pushAs(join(repo, 'tests/e2e', f), `${T}/src/tests/e2e/${f}`)
}
let device, page
async function connect() {
  const devices = await android.devices()
  device = devices[0]
  const pid = Number(adb('shell', 'pidof', PKG).trim().split(/\s+/)[0])
  let webview
  for (let i = 0; i < 60 && !webview; i++) { webview = device.webViews().find(w => w.pid() === pid); if (!webview) await sleep(500) }
  if (!webview) throw new Error('找不到 WebView')
  page = await webview.page()
  page.setDefaultTimeout(60000)
  for (let i = 0; i < 60 && !page.url().includes('127.0.0.1:'); i++) await sleep(500)
}
async function storyVisible(text) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) if (await frame.getByText(text).first().isVisible().catch(() => false)) return
    await page.waitForTimeout(250)
  }
  throw new Error('正文未出现：' + text)
}
async function dismissNotice() {
  const cont = page.getByRole('button', { name: /^(Continue|继续)$/ })
  await page.waitForTimeout(300)
  if (await cont.isVisible().catch(() => false)) { await cont.click(); await cont.waitFor({ state: 'hidden' }).catch(() => {}) }
}
async function openDrawer() {
  const picker = page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).filter({ visible: true })
  if (await picker.count()) return
  await page.locator('[data-mobile-nav="fab"], [data-mobile-nav="toggle"]').filter({ visible: true }).first().click()
  await picker.first().waitFor()
}
const rpc = (method, args = {}) => page.evaluate(async ({ method, args }) => {
  const r = await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })
  return { status: r.status, body: await r.text() }
}, { method, args })

try {
  await step('旧版：安装并玩一局（apk-smoke）', () => {
    const r = spawnSync('node', [join(repo, 'android/native/apk-smoke.mjs'), '--apk', FROM, '--out', join(OUT, 'v1')], { encoding: 'utf8', timeout: 600000 })
    if (r.status !== 0) throw new Error('旧版验收失败\n' + (r.stdout + r.stderr).slice(-3000))
  })
  const before = {}
  await step('旧版：留下用户改动（凭据、模型设置、自定义文件）', () => {
    runAs(`echo "${MARK}" >> ${H}/.credentials.yaml`)
    runAs(`echo "${MARK}" >> ${H}/profiles/tavern/cordis.patch.yml`)
    runAs(`echo "${MARK}" > ${DATA}/user-note.txt`)
    before.chats = runAs(`ls ${DATA}/chats`).trim().split(/\s+/).filter(Boolean)
    before.sessions = runAs(`find ${H}/profile-data/tavern/sessions -type f | wc -l`).trim()
    before.indexSize = runAs(`wc -c < ${DATA}/index.json`).trim()
    // 旧版程序里放一个新版不该保留的文件，用来确认程序目录确实整体替换了。
    runAs(`echo stale > ${T}/src/stale-from-v1.txt`)
    if (!before.chats.length) throw new Error('旧版没有留下对局')
    return before
  })
  await step('覆盖安装新版', () => {
    adb('shell', 'am', 'force-stop', PKG)
    adb('install', '-r', TO)
    const v = adb('shell', 'dumpsys', 'package', PKG).match(/versionName=(\S+)/)?.[1]
    return { versionName: v }
  })
  let first
  await step('新版首次启动：替换程序文件', async () => {
    first = await launch()
    const extract = first.log.split('\n').find(l => l.includes('程序文件')) || ''
    return { ms: first.ms }
  })
  await step('用户改动全部保留，旧程序文件已清除', () => {
    const checks = {
      credentials: runAs(`grep -c -- "${MARK}" ${H}/.credentials.yaml`).trim(),
      modelSettings: runAs(`grep -c -- "${MARK}" ${H}/profiles/tavern/cordis.patch.yml`).trim(),
      userFile: runAs(`cat ${DATA}/user-note.txt`).trim() === MARK,
      chats: runAs(`ls ${DATA}/chats`).trim().split(/\s+/).filter(Boolean),
      sessions: runAs(`find ${H}/profile-data/tavern/sessions -type f | wc -l`).trim(),
      indexSize: runAs(`wc -c < ${DATA}/index.json`).trim(),
      staleGone: runAs(`[ -e ${T}/src/stale-from-v1.txt ] && echo present || echo gone`).trim() === 'gone',
      fixedSource: runAs(`grep -c "'get', 'global', key" ${T}/src/tavern-plugin/packages/dsh-tavern/lib/proxy-environment.mjs`).trim(),
    }
    const bad = []
    if (checks.credentials !== '1') bad.push('凭据被覆盖')
    if (checks.modelSettings !== '1') bad.push('模型设置被覆盖')
    if (!checks.userFile) bad.push('自定义文件丢失')
    if (JSON.stringify(checks.chats) !== JSON.stringify(before.chats)) bad.push('对局目录变化')
    if (Number(checks.sessions) < Number(before.sessions)) bad.push('会话文件变少')
    if (!checks.staleGone) bad.push('旧程序文件残留')
    if (checks.fixedSource !== '1') bad.push('源码不是新版')
    if (bad.length) throw new Error(bad.join('；') + '\n' + JSON.stringify(checks))
    return checks
  })
  await step('新版日志：没有 Invalid namespace', () => {
    const log = runAs('cat files/logs/node.log')
    if (/Invalid namespace/.test(log)) throw new Error('仍有 Invalid namespace')
    return { upgradeLine: (runAs('ls files') && log.split('\n').find(l => l.startsWith('dsh web')) ? 'started' : '') }
  })
  await step('放回固定输出模型后重启（测试模型文件在 src 里，随程序替换被清掉）', async () => {
    pushTestModel()
    const r = await launch(120000)
    await connect()
    return { bootMs: r.ms }
  })
  await step('旧对局还在，可以接着玩', async () => {
    await dismissNotice()
    await openDrawer()
    const toggle = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: 'E2E 奖励验收' }).first()
    if (await toggle.isVisible().catch(() => false) && !await page.locator('.dsh-tavern-side-row-name').filter({ visible: true }).count()) await toggle.click()
    await page.locator('.dsh-tavern-side-row-name').filter({ visible: true }).first().click()
    await storyVisible('你获得了十枚金币。')
    const floors = async () => (await page.locator('body').innerText()).match(/第 \d+ 楼/g)?.length || 0
    const before = await floors()
    const composer = page.getByRole('textbox', { name: /发消息|Message/ }).filter({ visible: true }).first()
    await composer.fill('领取任务奖励'); await composer.press('Enter')
    // 固定输出模型的正文随变量状态变化，这里只认「多出一层且有正文」。
    const deadline = Date.now() + 60000
    while (await floors() < before + 1 && Date.now() < deadline) await page.waitForTimeout(300)
    if (await floors() < before + 1) throw new Error('没有生成新的一轮')
    return { floorsBefore: before, floorsAfter: await floors() }
  })
  await step('开始更新被拦下，提示覆盖安装；检查更新仍可用', async () => {
    const start = await rpc('startUpdate')
    if (!/覆盖安装/.test(start.body)) throw new Error('startUpdate 未被拦下：' + start.status + ' ' + start.body.slice(0, 300))
    const status = await rpc('getUpdateStatus')
    return { startUpdate: start.body.slice(0, 200), statusPhase: (status.body.match(/"phase":"([^"]+)"/) || [])[1] }
  })
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  try { report.nodeLog = runAs('cat files/logs/node.log').slice(-5000) } catch {}
  if (page) report.pageText = await page.locator('body').innerText().then(t => t.slice(0, 2000)).catch(() => '')
  console.error(error)
  process.exitCode = 1
} finally {
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  await device?.close().catch(() => {})
  console.log('报告：' + join(OUT, 'report.json'))
}
