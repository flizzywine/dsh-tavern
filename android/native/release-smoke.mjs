#!/usr/bin/env node
// 正式版安装包的冒烟验收（不可调试，只能走界面）：全新安装 → 首次启动 → 服务就绪 → 进酒馆 → 回启动页 → 检查更新。
//   node android/native/release-smoke.mjs <apk> [--expect-update <正则>]
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const APK = process.argv[2]
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const EXPECT_UPDATE = new RegExp(arg('--expect-update', '已是最新|还没有发布原生版安装包|有新版'))
const PKG = 'io.github.flizzywine.dshtavern.bionic'
const OUT = join(repo, 'output/native-proto/release-smoke')
mkdirSync(OUT, { recursive: true })
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', maxBuffer: 64 << 20 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
function screen() {
  let xml = ''
  try { xml = adb('shell', 'rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml 2>/dev/null') } catch { return [] }
  return [...xml.matchAll(/<node [^>]*>/g)].map(m => {
    const attr = k => (m[0].match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || ''
    const b = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    return { text: attr('text'), pkg: attr('package'), enabled: attr('enabled') === 'true', x: b ? (+b[1] + +b[3]) / 2 : 0, y: b ? (+b[2] + +b[4]) / 2 : 0 }
  })
}
async function waitFor(pattern, ms) {
  const end = Date.now() + ms
  let last = []
  while (Date.now() < end) {
    last = screen()
    const hit = last.find(n => pattern.test(n.text) && n.enabled)
    if (hit) return hit
    await sleep(1500)
  }
  throw new Error(`没等到 ${pattern}：${last.map(n => n.text).filter(Boolean).join(' | ').slice(0, 800)}`)
}
async function tap(pattern, ms = 30000) {
  const n = await waitFor(pattern, ms)
  adb('shell', 'input', 'tap', String(Math.round(n.x)), String(Math.round(n.y)))
  await sleep(800)
}
async function scrollTo(pattern) {
  for (let i = 0; i < 6 && !screen().some(n => pattern.test(n.text)); i++) { adb('shell', 'input', 'swipe', '540', '1800', '540', '700', '300'); await sleep(600) }
}
const steps = []
const step = async (name, fn) => { const t = Date.now(); const v = await fn(); steps.push({ name, ms: Date.now() - t, ...(v || {}) }); console.log(`✓ ${name} ${Date.now() - t}ms ${v ? JSON.stringify(v) : ''}`) }

await step('全新安装', () => {
  try { adb('uninstall', PKG) } catch {}
  adb('install', APK)
  const dump = adb('shell', 'dumpsys', 'package', PKG)
  const flags = (dump.match(/pkgFlags=\[([^\]]*)\]/) || [])[1] || ''
  if (/DEBUGGABLE/.test(flags)) throw new Error('正式版不应可调试：' + flags)
  return { versionName: (dump.match(/versionName=(\S+)/) || [])[1], debuggable: false }
})
await step('首次启动：解压 → 服务就绪（关掉「直接进入酒馆」前先等启动页）', async () => {
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
  await sleep(4000)
  for (const n of screen()) if (/^(允许|Allow)$/.test(n.text)) adb('shell', 'input', 'tap', String(n.x), String(n.y))
  const t = Date.now()
  // 默认就绪后直接进酒馆：看到酒馆页面（不再是启动页的「进入酒馆」）就算就绪
  const end = Date.now() + 240000
  let seen = ''
  while (Date.now() < end) {
    const s = screen()
    const texts = s.map(n => n.text)
    // 首次进入会弹「预览说明」：关掉它
    const notice = s.find(n => /^(Continue|继续|我知道了)$/.test(n.text))
    if (notice) { adb('shell', 'input', 'tap', String(Math.round(notice.x)), String(Math.round(notice.y))); await sleep(1500); continue }
    if (texts.some(t => /^(设置|Settings|Session log|游玩|卡片)$/.test(t)) && !texts.includes('进入酒馆') && !texts.includes('酒馆 · Beta')) { seen = 'tavern'; break }
    await sleep(2000)
  }
  if (!seen) throw new Error('酒馆没有打开：' + screen().map(n => n.text).filter(Boolean).join(' | ').slice(0, 600))
  writeFileSync(join(OUT, 'tavern.png'), execFileSync('adb', ['exec-out', 'screencap', '-p']))
  return { readyAfterMs: Date.now() - t }
})
await step('返回键回到启动页，状态为运行中', async () => {
  for (let i = 0; i < 4 && !screen().some(n => n.text === '进入酒馆'); i++) { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1500) }
  const status = await waitFor(/运行中/, 20000)
  writeFileSync(join(OUT, 'launcher.png'), execFileSync('adb', ['exec-out', 'screencap', '-p']))
  return { status: status.text.slice(0, 60) }
})
await step('检查更新', async () => {
  await scrollTo(/^检查更新$/)
  await tap(/^检查更新$/)
  const r = await waitFor(EXPECT_UPDATE, 90000)
  return { message: r.text.slice(0, 120) }
})
await step('再进酒馆', async () => {
  adb('shell', 'input', 'swipe', '540', '700', '540', '1900', '300')
  await sleep(600)
  await tap(/^进入酒馆$/)
  await sleep(3000)
  if (screen().some(n => n.text === '进入酒馆')) throw new Error('没有进入酒馆')
})
writeFileSync(join(OUT, 'report.json'), JSON.stringify(steps, null, 2))
