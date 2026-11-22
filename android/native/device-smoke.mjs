#!/usr/bin/env node
// 设备冒烟：在 adb 设备上用 Termux bionic Node 跑酒馆 DSH，主机 Chromium 隔着 adb forward 操作。
//   node android/native/device-smoke.mjs [--root /data/local/tmp/np] [--serial emulator-5554]
// 前提：stage-payload.sh 的产物已解包到 --root。模型是 tests/e2e/model.mjs 的固定输出，不联网。
// 验收：开局 → 发一轮 → 正文出现 → 刷新仍在 → 杀进程重启后仍在（会话落盘，含 flock 替身路径）。
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const ROOT = arg('--root', '/data/local/tmp/np')
const SERIAL = arg('--serial', process.env.ANDROID_SERIAL || '')
const OUT = arg('--out', join(repo, 'output/native-proto/smoke'))
const HOST_PORT = Number(arg('--host-port', 3291))
const H = `${ROOT}/home/.dsh-tavern`
const DATA = `${H}/profile-data/tavern/data`
mkdirSync(OUT, { recursive: true })
const adbArgs = a => (SERIAL ? ['-s', SERIAL] : []).concat(a)
const adb = (...a) => execFileSync('adb', adbArgs(a), { encoding: 'utf8', maxBuffer: 64 << 20 })
const sh = cmd => adb('shell', cmd)
const kill = (signal = '') => { try { adb('shell', `pkill ${signal} -f "dsh/lib/bi[n].js"`) } catch {} }
const report = { root: ROOT, steps: [] }
const t0 = Date.now()
async function step(name, fn) {
  const start = Date.now()
  try { const value = await fn(); report.steps.push({ name, ok: true, ms: Date.now() - start, ...(value && typeof value === 'object' ? value : {}) }); console.log('✓', name, `${Date.now() - start}ms`) }
  catch (error) { report.steps.push({ name, ok: false, ms: Date.now() - start, error: String(error.stack || error) }); throw error }
}

// ---------- 设备侧准备 ----------
await step('推送固定输出模型与验收卡', () => {
  // 默认清空存档：上一轮留下的同一句正文会让「看到正文」的判定失去意义。
  if (!process.argv.includes('--keep-data')) sh(`rm -rf ${H}/profile-data/tavern/sessions ${DATA}/chats`)
  for (const f of ['model.mjs', 'recovery-model.mjs', 'compaction-model.mjs']) adb('push', join(repo, 'tests/e2e', f), `${ROOT}/src/tests/e2e/${f}`)
  const card = { spec: 'chara_card_v2', spec_version: '2.0', data: {
    name: 'E2E 奖励验收', description: '固定验收角色', first_mes: '欢迎领取奖励。\n\n<StatusPlaceHolderImpl/>', mes_example: '', scenario: '', personality: '',
    character_book: { name: '验收初始变量', entries: [{ id: 1, keys: [], comment: '[initvar]初始值', content: 'gold: 0', enabled: true, constant: true, insertion_order: 1 }] },
    extensions: { mvu: {} } } }
  const tmp = join(OUT, 'e2e.json'); writeFileSync(tmp, JSON.stringify(card))
  sh(`mkdir -p ${DATA}/resources/cards`); adb('push', tmp, `${DATA}/resources/cards/e2e.json`)
  const patch = sh(`cat ${H}/profiles/tavern/cordis.patch.yml`)
  if (!patch.includes('tavern-e2e-model')) {
    const extra = `- id: agent-default-model\n  config:\n    provider: tavern-e2e\n    model: fixed\n- insert:\n    - id: tavern-e2e-model\n      name: ${ROOT}/src/tests/e2e/model.mjs\n`
    const file = join(OUT, 'cordis.patch.yml'); writeFileSync(file, patch.replace(/\r/g, '') + extra)
    adb('push', file, `${H}/profiles/tavern/cordis.patch.yml`)
  }
})

let server
function startServer() {
  kill()
  const env = `TAVERN_E2E_LLM_MODULE=${H}/runtime/lib/node_modules/@deepseek-ai/dsh-llm/lib/index.js DSH_TAVERN_SERVER_SCRIPTS=0`
  server = spawn('adb', adbArgs(['shell', `cd ${ROOT} && ${env} PORT=3081 sh run.sh`]), { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  server.stdout.on('data', c => { log += c }); server.stderr.on('data', c => { log += c })
  return new Promise((resolve, reject) => {
    const begin = Date.now()
    const timer = setInterval(() => {
      const url = log.match(/http:\/\/127\.0\.0\.1:3081\/\?token=[\w-]+/)?.[0]
      if (url) { clearInterval(timer); resolve({ url: url.replace(':3081', ':' + HOST_PORT), bootMs: Date.now() - begin, log: () => log }) }
      else if (Date.now() - begin > 120000) { clearInterval(timer); reject(new Error('DSH 启动超时\n' + log.slice(-4000))) }
    }, 200)
  })
}
function rss() {
  const pid = sh('pgrep -f "dsh/lib/bi[n].js" | head -1').trim()
  if (!pid) return null
  const status = sh(`cat /proc/${pid}/status`)
  const kb = Number(status.match(/VmRSS:\s+(\d+)/)?.[1])
  const children = sh(`ps -A -o PID,PPID,RSS,ARGS | grep node | grep -v grep ; true`).trim()
  return { pid: Number(pid), rssMB: Math.round(kb / 1024), processes: children.split('\n').length, ps: children }
}

adb('forward', `tcp:${HOST_PORT}`, 'tcp:3081')
let first
await step('冷启动 DSH（bionic Node，无 proot）', async () => { first = await startServer(); return { bootMs: first.bootMs } })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
context.setDefaultTimeout(60000)
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const apiFailures = []
page.on('console', m => { if (m.type() === 'error') apiFailures.push('console: ' + m.text().slice(0, 800)) })
page.on('response', async r => {
  if (r.status() < 400 || !r.url().includes('/api/')) return
  apiFailures.push(`HTTP ${r.status()} ${new URL(r.url()).pathname} ${(await r.text().catch(() => '')).slice(0, 1500)}`)
})
async function dismissNotice() {
  // 全新数据目录下「预览版说明」会晚于界面出现，盖住按钮。
  const cont = page.getByRole('button', { name: /^(Continue|继续)$/ })
  await page.waitForTimeout(300)
  if (await cont.isVisible().catch(() => false)) { await cont.click(); await cont.waitFor({ state: 'hidden' }).catch(() => {}) }
}
async function storyVisible(text) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) if (await frame.getByText(text).first().isVisible().catch(() => false)) return
    await page.waitForTimeout(250)
  }
  throw new Error('正文未出现：' + text)
}
try {
  await step('打开酒馆页面', async () => {
    const start = Date.now()
    await page.goto(first.url, { waitUntil: 'domcontentloaded' })
    const cont = page.getByRole('button', { name: /^(Continue|继续)$/ })
    const picker = page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).first()
    // 预览说明只在首次出现；谁先出现等谁，不白等超时。
    await Promise.race([cont.waitFor(), picker.waitFor()])
    if (await cont.isVisible()) await cont.click()
    await picker.waitFor()
    return { firstScreenMs: Date.now() - start }
  })
  await step('选卡开局', async () => {
    await dismissNotice()
    await page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).first().click()
    await dismissNotice()
    await page.getByRole('dialog', { name: '选择人物卡开始游玩' }).getByText('E2E 奖励验收', { exact: true }).first().click()
    await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
    await storyVisible('欢迎领取奖励。')
  })
  await step('发送一轮并看到正文', async () => {
    const start = Date.now()
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('领取任务奖励'); await composer.press('Enter')
    await storyVisible('你获得了十枚金币。')
    return { turnMs: Date.now() - start }
  })
  await page.screenshot({ path: join(OUT, 'after-turn.png') })
  await step('刷新后对局仍在', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await storyVisible('你获得了十枚金币。')
  })
  report.memory = rss()
  await step('杀掉进程冷重启，存档仍在', async () => {
    // 先离开页面：否则旧页面断线后的自动重载会和下面的 goto 互相打断。
    await page.goto('about:blank')
    kill('-9'); server.kill()
    const again = await startServer()
    await page.goto(again.url, { waitUntil: 'domcontentloaded' })
    const history = page.locator('.dsh-tavern-side-row-name').first()
    await storyVisible('你获得了十枚金币。').catch(async () => {
      const toggle = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: 'E2E 奖励验收' }).first()
      if (await toggle.isVisible().catch(() => false)) await toggle.click()
      await history.click(); await storyVisible('你获得了十枚金币。')
    })
    return { bootMs: again.bootMs }
  })
  await page.screenshot({ path: join(OUT, 'after-restart.png') })
  await step('磁盘上有会话文件', () => {
    const files = sh(`find ${H}/profile-data/tavern -newer ${ROOT}/run.sh -type f \\( -name '*.jsonl' -o -name '*.json' \\) | grep -E 'session|chat' | head -20`).trim().split('\n').filter(Boolean)
    if (!files.length) throw new Error('没找到会话文件')
    return { files }
  })
  report.pageErrors = errors
  report.apiFailures = apiFailures
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.pageErrors = errors
  report.apiFailures = apiFailures
  await page.screenshot({ path: join(OUT, 'failure.png') }).catch(() => {})
  report.pageText = await page.locator('body').innerText().then(t => t.slice(0, 3000)).catch(() => '')
  report.textboxes = await page.$$eval('textarea,[contenteditable=true],input', els => els.map(e => [e.tagName, e.getAttribute('aria-label'), e.getAttribute('placeholder')].join(':'))).catch(() => [])
  report.serverLogTail = (server && first) ? first.log().slice(-6000) : ''
  console.error(error)
  process.exitCode = 1
} finally {
  report.totalMs = Date.now() - t0
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  kill(); server?.kill()
  console.log('报告：' + join(OUT, 'report.json'))
}
