import {setupRealVariables,realVariableLookupChecks} from './real-variable-lookup.mjs'
import { incrementalMvuChecks } from './mvu-incremental.mjs'
import {openingUpdateChecks} from './opening-update.mjs'
import { backgroundLifecycleChecks } from './background-lifecycle.mjs'
import { cardMemoryChecks } from './card-memory.mjs'
import {displayRegressionRules, displayRegressionChecks} from './display-regression.mjs'
import { surfaceRecoveryChecks } from './surface-recovery.mjs'
import { cardVariableUpdateChecks } from './card-variable-update.mjs'
import { cardUpdateChecks } from './card-update.mjs'
import { sidebarUpgrade } from './sidebar-upgrade.mjs'
import { compactedEditedLegacySession } from '../fixtures/compacted-legacy-session.mjs'
import { encodeMigratedSessionLog, parseSessionLog } from '../../tavern-plugin/lib/domain/legacy-session-migration.js'
import { compactionChecks } from './compaction.mjs'
import assert from 'node:assert/strict'
import { presetSwitch } from './preset-switch.mjs'
import { playControls } from './play-controls.mjs'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, readdir, cp, access } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'

const displayScenario = process.argv.includes('--display-regression')
const recoveryScenario = process.argv.includes('--surface-recovery')
const compactionScenario = process.argv.find(arg => arg.startsWith('--compaction='))?.split('=')[1]
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtime = resolve(process.env.TAVERN_E2E_RUNTIME || join(homedir(), '.dsh-tavern/runtime'))
const modules = join(runtime, 'lib/node_modules')
const cli = join(modules, '@deepseek-ai/dsh/lib/bin.js')
const outputBase = resolve(process.env.TAVERN_E2E_OUTPUT || join(source, 'output/e2e-gameplay'))
await mkdir(outputBase, { recursive: true })
const output = await mkdtemp(join(outputBase, 'run-'))
const root = await mkdtemp(join(tmpdir(), 'tavern-e2e-'))
const profile = join(root, 'profiles/tavern'), data = join(root, 'profile-data/tavern/data')
const timeout = Number(process.env.TAVERN_E2E_TIMEOUT_MS) || 30000
const report = { status: 'running', scope: 'real isolated DSH + Tavern + Chromium; fixed model only', steps: [] }
const started = Date.now(), errors = []
let log = '', browser, context, child, page, restartServer
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function step(name, action) {
  const start = Date.now()
  report.currentStep = name
  await action()
  report.steps.push({ name, ms: Date.now() - start })
  console.log('✓ ' + name)
}
async function savedChat() {
  const ids = await readdir(join(data, 'chats'))
  const store = createChatJournalStore({ dataRoot: data })
  const chats = await Promise.all(ids.map(id => store.read(id)))
  const games = chats.filter(chat => chat.mode !== 'card')
  assert.equal(games.length, 1, '本次只应创建一局游戏')
  return games[0]
}
function inspectSaved(chat) {
  const replies = chat.messages.filter(message => message.role === 'assistant' && !message.greeting)
  assert.equal(chat.messages.filter(message => message.role === 'user').length, 1)
  assert.equal(replies.length, 1, '刷新不能重复生成正文')
  const reply = replies[0]
  const variables = Array.isArray(reply.variables) ? reply.variables[reply.swipeId || 0] : reply.variables
  assert.equal(variables.stat_data.gold, 10, '落盘金币必须为 10')
  assert.equal(reply.mvu.receipt.status, 'updated')
  assert.equal(chat.posture, '站在柜台前，收下奖励。')
  return { chatId: chat.id, sessionId: chat.sessionId, userMessages: 1, replies: 1,
    gold: variables.stat_data.gold, receipt: reply.mvu.receipt.status, posture: chat.posture }
}
async function inspectRound(name, gold, text, rounds = 2) {
  const chat = await savedChat()
  const replies = chat.messages.filter(message => message.role === 'assistant' && !message.greeting)
  assert.equal(chat.messages.filter(message => message.role === 'user').length, rounds)
  assert.equal(replies.length, rounds, '替换或编辑不能新增轮次')
  const last = replies.at(-1)
  assert.ok((last.sourceText ?? last.text).includes(text), '存档正文必须与界面一致')
  assert.equal(last.variables[last.swipeId || 0].stat_data.gold, gold)
  report[name] = { chatId: chat.id, rounds, gold, text }
  await page.screenshot({ path: join(output, name + '.png'), fullPage: true })
}
async function openStatus() {
  await page.getByText('酒馆状态', { exact: true }).filter({ visible: true }).first().click()
}
async function inspectScreen() {
  await page.locator('.dsh-tavern-user-bubble').filter({ hasText: '领取任务奖励' }).first().waitFor({ state: 'visible' })
  await page.getByText('你获得了十枚金币。', { exact: false }).filter({ visible: true }).first().waitFor()
  await page.getByText(/变量已更新/).filter({ visible: true }).first().waitFor()
  await openStatus()
  await page.frameLocator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame')
    .locator('#e2e-gold').filter({ hasText: /^金币：10$/ }).waitFor()
  await page.getByText('站在柜台前，收下奖励。', { exact: true }).filter({ visible: true }).waitFor()
}
try {
  await step('准备独立运行环境', async () => {
    if (compactionScenario) {
      await mkdir(data, { recursive: true })
      await writeFile(join(data, 'tavern-settings.json'), JSON.stringify({ contextCompaction: { mode: compactionScenario === 'rounds' ? 'rounds' : ['manual', 'overflow', 'legacy'].includes(compactionScenario) ? 'manual' : 'percent', rounds: 2, percent: 50 } }))
      await writeFile(join(output, 'model-control.json'), JSON.stringify({ foregroundPadding: compactionScenario === 'overflow' ? 4000 : 650, backgroundPadding: 0, window: compactionScenario === 'overflow' ? 262144 : 32768 }))
    }
    if (displayScenario) {
      await mkdir(data,{recursive:true})
      await writeFile(join(data,'tavern-extension-settings.json'),JSON.stringify({EjsTemplate:{enabled:true,render_enabled:true,raw_message_evaluation_enabled:false,preload_worldinfo_enabled:false,code_blocks_enabled:true}}))
    }
    await access(cli).catch(() => { throw Error('找不到 DSH runtime；先安装酒馆，或设置 TAVERN_E2E_RUNTIME。') })
    report.runtimeVersion = JSON.parse(await readFile(join(modules, '@deepseek-ai/dsh/package.json'), 'utf8')).version
    await mkdir(join(profile, 'node_modules'), { recursive: true })
    for (const [name, target] of Object.entries({
      'dsh-tavern-plugin': join(source, 'tavern-plugin'),
      'dsh-tavern-remote': join(source, 'tavern-plugin/packages/dsh-tavern-remote'),
      'dsh-web-mobile': join(source, 'node_modules/dsh-web-mobile')
    })) await symlink(target, join(profile, 'node_modules', name))
    // This package resolves DSH imports relative to its directory, so give it
    // the isolated profile's runtime scope rather than the development scope.
    const sidebar = process.env.TAVERN_E2E_SIDEBAR || join(source, 'node_modules/dsh-better-sidebar')
    const sidebarVersion = JSON.parse(await readFile(join(sidebar, 'package.json'), 'utf8')).version
    const expectedSidebar = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).devDependencies['dsh-better-sidebar']
    if (!process.env.TAVERN_E2E_SIDEBAR) assert.equal(sidebarVersion, expectedSidebar, '侧栏依赖与仓库锁定版本不一致；安装锁定依赖或用 TAVERN_E2E_SIDEBAR 指向独立测试包')
    report.sidebarVersion = sidebarVersion
    await cp(sidebar, join(profile, 'node_modules/dsh-better-sidebar'), { recursive: true, dereference: true })
    await symlink(join(modules, '@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'))
    for (const name of await readdir(join(source, 'node_modules'))) {
      if (name.startsWith('.') || ['@deepseek-ai', 'dsh-tavern-plugin', 'dsh-tavern-remote', 'dsh-web-mobile', 'dsh-better-sidebar'].includes(name)) continue
      await symlink(join(source, 'node_modules', name), join(profile, 'node_modules', name))
    }
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'tavern-e2e', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-web-mobile', 'dsh-better-sidebar', 'dsh-tavern-plugin', 'dsh-tavern-remote'] } } }))
    await writeFile(join(profile, 'cordis.patch.yml'), `- id: agent-default-model\n  config:\n    provider: tavern-e2e\n    model: fixed\n- insert:\n    - id: tavern-e2e-model\n      name: ${JSON.stringify(join(source, 'tests/e2e/model.mjs'))}\n`)
    await mkdir(join(data, 'resources/presets'), { recursive: true })
    for (const key of ['A', 'B']) await writeFile(join(data, `resources/presets/E2E-${key}.json`), JSON.stringify({
      prompts: [{ identifier: 'main', name: `E2E ${key}`, role: 'system', content: `E2E_PRESET_${key}_ACTIVE`, enabled: true }],
      prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }]
    }))
    await mkdir(join(data, 'resources/cards'), { recursive: true })
    // Deliberate continuous DOM updates: a real status card must receive new
    // variables even when it never reaches the frame's DOM-idle threshold.
    const status = '<div id="e2e-gold">金币：加载中</div><script>function refresh(){const v=getAllVariables();document.getElementById("e2e-gold").textContent="金币："+(v.stat_data?.gold??"未初始化")}refresh();setInterval(refresh,200)</script>'
    await writeFile(join(data, 'resources/cards/e2e.json'), JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: {
      name: 'E2E 奖励验收', description: '固定验收角色', first_mes: (process.argv.includes('--text-colors') ? '她说：“欢迎光临。” *窗外下着雨。*' : '欢迎领取奖励。') + (process.argv.includes('--opening-update') ? '\n<initvar>{"gold":0,"old":1}</initvar>' : '') + '\n\n<StatusPlaceHolderImpl/>',
      mes_example: '', scenario: '', personality: '',
      character_book: { name: '验收初始变量', entries: [{ id: 1, keys: [], comment: '[initvar]初始值', content: 'gold: 0', enabled: true, constant: true, insertion_order: 1 }] },
      extensions: { mvu: {}, regex_scripts: [{ id: 'e2e-status', scriptName: '金币状态', findRegex: '<StatusPlaceHolderImpl/>',
        replaceString: '```html\n' + status + '\n```', placement: [2], markdownOnly: true, disabled: false }, ...(displayScenario ? displayRegressionRules() : [])] }
    } }))
  })
  if(process.argv.includes('--real-variables')) {report.scope='real isolated DSH + Chromium + configured live model';report.model=await setupRealVariables({root,profile,data,runtimeHome:join(homedir(),'.dsh-tavern')})}
  await step('启动真实 DSH 与酒馆', async () => {
    async function launchServer() {
      const logOffset = log.length
      // Do not inherit provider credentials or a production profile configuration.
      const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
      child = spawn(process.execPath, [cli, '--profile', 'tavern', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
        cwd: source, env: { ...env, DSH_HOME: root, DSH_CWD: root,
          TAVERN_E2E_COMPACTION_DIR: compactionScenario ? output : '',
          TAVERN_E2E_RECOVERY_DIR: recoveryScenario ? output : '',
          TAVERN_E2E_BACKGROUND_DIR: process.argv.includes('--background-lifecycle') ? output : '',
          TAVERN_E2E_REQUEST_AUDIT: join(output, 'preset-requests.jsonl'),
          TAVERN_E2E_MEMORY_AUDIT: process.argv.includes('--card-memory') ? join(output, 'memory-requests.jsonl') : '',
          TAVERN_E2E_LLM_MODULE: join(modules, '@deepseek-ai/dsh-llm/lib/index.js'),
          TAVERN_E2E_WRONG_GOLD: process.env.TAVERN_E2E_WRONG_GOLD || '' }, stdio: ['ignore', 'pipe', 'pipe']
      })
      let spawnError
      child.on('error', error => { spawnError = error })
      child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
      const deadline = Date.now() + 60000
      let url
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError
        url = log.slice(logOffset).match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s\u001b]*/)?.[0]
        if (url) break
        if (child.exitCode !== null) throw Error('DSH exited ' + child.exitCode)
        await pause(100)
      }
      assert.ok(url, 'DSH startup timeout')
      return url
    }
    const url = await launchServer()
    restartServer = async (whileStopped) => {
      const current = new URL(page.url())
      child.kill('SIGTERM')
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)])
      assert.notEqual(child.exitCode, null, '旧服务必须退出后再重启')
      await whileStopped?.()
      const next = new URL(await launchServer())
      current.host = next.host
      current.searchParams.set('token', next.searchParams.get('token'))
      await page.goto(current.toString(), { waitUntil: 'domcontentloaded' })
      const history = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: 'E2E 奖励验收' })
      const sidebarToggle = page.getByRole('button', { name: /^(Open|Expand) sidebar$/ })
      await history.filter({visible:true}).or(sidebarToggle.filter({visible:true})).first().waitFor()
      if (!await history.isVisible()) await sidebarToggle.click()
      await history.click()
      await page.locator('.dsh-tavern-side-row-name').first().click()
      await openStatus()
    }
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(recoveryScenario ? { hasTouch: true } : {}) })
    context.setDefaultTimeout(timeout)
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    // Slot error boundaries catch React failures, so pageerror alone misses them.
    page.on('console', message => {
      if (message.type() === 'error' && /slot entry crashed|Minified React error/.test(message.text())) errors.push(message.text())
    })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  })
  await step('通过界面选择角色卡并新开一局', async () => {
    await page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).click()
    await page.getByText('E2E 奖励验收', { exact: true }).first().click()
    await page.getByRole('button', { name: '开始新游戏', exact: true }).click()
    await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
    await openStatus()
    await page.frameLocator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame')
      .locator('#e2e-gold').filter({ hasText: /^金币：0$/ }).waitFor()
  })
  if (process.argv.includes('--text-colors')) {
    await step('实际正文挂载主题对白高亮', async () => {
      await page.locator('.dsh-tavern-colored-markdown').waitFor()
      const state=await page.evaluate(()=>({api:typeof Highlight,css:typeof CSS.highlights,styles:document.querySelectorAll('style[data-dsh-tavern-text-colors]').length,ranges:[...CSS.highlights.values()].reduce((n,h)=>n+h.size,0)}))
      report.textColors=state
      assert.ok(state.styles>0,'正文必须挂载高亮样式')
      assert.ok(state.ranges>0,'对白必须生成高亮范围')
      const original=(await savedChat()).messages
      for (const [name,accent] of [['terracotta','#cc785c'],['blue','#2196f3']]) {
        await page.evaluate(accent=>document.body.style.setProperty('--dsw-alias-brand-primary',accent),accent)
        const colors=await page.evaluate(()=>[...CSS.highlights].filter(([k,h])=>h.size).map(([key,h])=>{
          const node=[...h][0].startContainer.parentElement
          return {color:getComputedStyle(node,'::highlight('+key+')').color,plain:getComputedStyle(node).color}
        }))
        const expected=name==='terracotta'?'rgb(204, 120, 92)':'rgb(33, 150, 243)'
        assert.ok(colors.length>=2,'对白及斜体均有高亮')
        for(const color of colors){assert.equal(color.color,expected);assert.notEqual(color.plain,expected)}
        report[name]=colors
        await page.screenshot({path:join(output,'text-colors-'+name+'.png'),fullPage:true})
      }
      assert.deepEqual((await savedChat()).messages,original,'换强调色只改变展示，不改写存档')
    })
  } else if (process.argv.includes('--real-variables')) {
    await realVariableLookupChecks({page,step,savedChat,root,output,report})
  } else if (process.argv.includes('--opening-update')) {
    await openingUpdateChecks({page,step,savedChat,data,output,report,root})
  } else if (recoveryScenario) {
    await surfaceRecoveryChecks({ page, step, savedChat, output, report, root, restartServer })
  } else {
  await step('玩一轮，确认正文、金币与人物姿势', async () => {
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('领取任务奖励')
    await composer.press('Enter')
    await inspectScreen()
    report.beforeReload = inspectSaved(await savedChat())
    await page.screenshot({ path: join(output, 'before-reload.png'), fullPage: true })
  })
  await step('刷新后确认同一局、正文和状态均保留', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await inspectScreen()
    report.afterReload = inspectSaved(await savedChat())
    assert.deepEqual(report.afterReload, report.beforeReload)
    assert.deepEqual(errors, [], '浏览器不得出现未捕获异常')
    await page.screenshot({ path: join(output, 'after-reload.png'), fullPage: true })
  })
  if (process.argv.includes('--mvu-incremental')) {
    await incrementalMvuChecks({page,step,savedChat,output,report,restartServer})
  } else if (process.argv.includes('--background-lifecycle')) {
    await backgroundLifecycleChecks({page,step,savedChat,data,output,report,restartServer})
  } else if (displayScenario) {
    await displayRegressionChecks({page,step,savedChat,data,output,report,restartServer})
  } else if (compactionScenario) {
    const installLegacyFixture = async () => {
      const chat = await savedChat()
      let directory, storedHeader
      await restartServer(async () => {
        const sessions = join(root, 'profile-data/tavern/sessions')
        const files = (await readdir(sessions, { recursive: true })).filter(file => file.endsWith('session.v3.jsonl.zstd'))
        for (const relative of files) {
          const full = join(sessions, relative)
          const saved = parseSessionLog(await readFile(full))
          if (saved.header.id === chat.sessionId) { directory = dirname(full); storedHeader = saved.header; break }
        }
        assert.ok(directory, '找到本次临时游玩的原生会话')
        const fixture = compactedEditedLegacySession()
        fixture.header.id = chat.sessionId
        fixture.header.cwd = storedHeader.cwd
        // This is a versioned on-disk input fixture, not a mocked migration or
        // compaction result. Production startup must migrate it itself.
        let serialized = JSON.stringify(fixture.events).replaceAll('SUMMARY_TO_KEEP', 'E2E_MEMORY_ROUND_1 当前金币 10，人物站在柜台前。')
          .replaceAll('"provider":"fixture"', '"provider":"tavern-e2e"').replaceAll('"model":"fixture"', '"model":"fixed"')
        fixture.events = JSON.parse(serialized)
        // Tavern's greeting already occupies turn 1. Keep the old Session's
        // turn coordinates aligned with its paired Chat, so this fixture tests
        // migration rather than an unrelated mismatched-archive restoration.
        const opening = [
          { type: 'turn/start', data: { turn: 1 } },
          { type: 'step/start', data: { turn: 1, step: 1 } },
          { type: 'step/end', data: { turn: 1, step: 1 } },
          { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        ].map((row, seq) => ({ ...row, seq, time: 1 }))
        for (const event of fixture.events) {
          event.seq += opening.length
          if (event.data.turn === 1) event.data.turn = 2
          if (event.surfaceOp?.op === 'replace') { event.surfaceOp.start += opening.length; event.surfaceOp.end += opening.length }
          if (event.sourceEventSeqs) event.sourceEventSeqs = event.sourceEventSeqs.map(seq => seq + opening.length)
          if (event.data.shadowedRange) { event.data.shadowedRange.start += opening.length; event.data.shadowedRange.end += opening.length }
          if (event.data.shadowedSeqs) event.data.shadowedSeqs = event.data.shadowedSeqs.map(seq => seq + opening.length)
        }
        fixture.events.unshift(...opening)
        const bytes = encodeMigratedSessionLog(JSON.stringify(fixture.header), fixture.events)
        await writeFile(join(output, 'legacy-input.jsonl.zstd'), bytes)
        await writeFile(join(directory, 'session.jsonl.zstd'), bytes)
        await rm(join(directory, 'session.v3.jsonl.zstd'))
      })
      const migrated = await readFile(join(directory, 'session.v3.jsonl.zstd'))
      await writeFile(join(output, 'legacy-migrated.jsonl.zstd'), migrated)
      const rows = parseSessionLog(migrated).events
      assert.ok(rows.some(row => row.type === 'compaction/summary'), '启动迁移保留压缩事件')
      assert.ok(JSON.stringify(rows).includes('OLD_STORY_SHOULD_STAY_ARCHIVED'), '旧原文仍保存在历史中')
      assert.deepEqual(await readFile(join(directory, 'session.jsonl.zstd.bak-tavern-premigrate')), await readFile(join(output, 'legacy-input.jsonl.zstd')))
    }
    await compactionChecks({ page, step, savedChat, output, report, restartServer, installLegacyFixture, scenario: compactionScenario })
  } else if (!process.argv.includes('--card-memory') && !process.argv.includes('--message-rendering-only') && !process.argv.includes('--sidebar-only') && !process.argv.includes('--card-update') && !process.argv.includes('--card-variables')) {
    await step('生成候选项并选择行动，再玩一轮', async () => {
      await page.getByRole('button', { name: '生成候选项', exact: true }).click()
      await page.getByText('5 个候选项', { exact: true }).waitFor()
      assert.deepEqual(inspectSaved(await savedChat()), report.afterReload, '生成候选不能修改正文或金币')
      const candidates = page.locator('.dsh-tavern-candidate-question')
      if (await candidates.getByTitle('展开', { exact: true }).isVisible()) await candidates.getByTitle('展开', { exact: true }).click()
      await page.getByRole('button', { name: /再次领取奖励/ }).click()
      assert.equal(await candidates.locator('.dsh-tavern-question-option').count(), 5)
      await page.getByRole('button', { name: '追加到输入框', exact: true }).click()
      const composer = page.getByRole('textbox', { name: /发消息|Message/ })
      assert.equal(await composer.innerText(), '再次领取奖励')
      await composer.press('Enter')
      await page.getByText('你再次领取了奖励，金币累计二十枚。', { exact: true }).waitFor()
      await page.frameLocator('.dsh-tavern-status-runtime iframe').locator('#e2e-gold').filter({ hasText: /^金币：20$/ }).waitFor()
      await inspectRound('second-turn', 20, '你再次领取了奖励，金币累计二十枚。')
    })
    await step('重新生成最新正文', async () => {
      await page.getByRole('button', { name: '重新生成正文', exact: true }).click()
      await page.getByPlaceholder('指导意见（可选）：例如“写得更长，侧重心理描写”').fill('雨夜重写')
      await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
      await page.getByText('雨夜里，你重新领取了奖励。', { exact: true }).filter({ visible: true }).first().waitFor()
      await page.frameLocator('.dsh-tavern-status-runtime iframe').locator('#e2e-gold').filter({ hasText: /^金币：30$/ }).waitFor()
      assert.equal(await page.getByText('雨夜里，你重新领取了奖励。', { exact: true }).filter({ visible: true }).count(), 1)
      await inspectRound('regenerated', 30, '雨夜里，你重新领取了奖励。')
      assert.equal(await page.getByText('你再次领取了奖励，金币累计二十枚。', { exact: true }).filter({ visible: true }).count(), 0)
    })
    await step('编辑正文并刷新', async () => {
      const beforeEdit = (await savedChat()).messages.at(-1)
      await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
      await page.getByRole('menuitem', { name: '编辑正文', exact: true }).click()
      const editor = page.getByRole('region', { name: '编辑正文' })
      await editor.getByRole('textbox', { name: '正文文本 1' }).fill('手工编辑：你把奖励放进了背包。')
      await editor.getByRole('button', { name: '保存', exact: true }).click()
      await editor.waitFor({state:'hidden'})
      await page.getByText('手工编辑：你把奖励放进了背包。', { exact: true }).filter({ visible: true }).first().waitFor()
      await inspectRound('edited', 30, '手工编辑：你把奖励放进了背包。')
      await page.reload()
      await page.getByText('手工编辑：你把奖励放进了背包。', { exact: true }).filter({ visible: true }).first().waitFor()
      await page.frameLocator('.dsh-tavern-status-runtime iframe').locator('#e2e-gold').filter({ hasText: /^金币：30$/ }).waitFor()
      const afterEdit = (await savedChat()).messages.at(-1)
      assert.deepEqual(afterEdit.variables, beforeEdit.variables, '编辑正文不能重新结算或修改变量')
      assert.deepEqual(afterEdit.mvu.receipt, beforeEdit.mvu.receipt)
      await inspectRound('edited-after-reload', 30, '手工编辑：你把奖励放进了背包。')
    })
    await step('回退最新一轮，恢复上一轮金币', async () => {
      await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
      await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).click()
      await page.frameLocator('.dsh-tavern-status-runtime iframe').locator('#e2e-gold').filter({ hasText: /^金币：10$/ }).waitFor()
      inspectSaved(await savedChat())
      await page.reload()
      await inspectScreen()
      inspectSaved(await savedChat())
      assert.equal(await page.getByText('手工编辑：你把奖励放进了背包。', { exact: true }).count(), 0)
      await inspectRound('after-rollback', 10, '你获得了十枚金币。', 1)
    })
    await playControls({ page, step, savedChat, inspectRound, output, report })
    await presetSwitch({ page, step, savedChat, inspectRound, output, report })
  }
  if (process.argv.includes('--card-memory')) await cardMemoryChecks({ page, step, data, output, report, savedChat })
  if (process.argv.includes('--card-variables')) await cardVariableUpdateChecks({page,step,savedChat,data,output,report})
  if (process.argv.includes('--card-update')) await cardUpdateChecks({page,step,savedChat,data,output,report})
  if (process.argv.includes('--sidebar') || process.argv.includes('--sidebar-only')) await sidebarUpgrade({ page, step, savedChat, output, report })
  }
  assert.deepEqual(errors, [], '整个验收不得出现未捕获浏览器异常')
  assert.doesNotMatch(log, /服务端模板进程异常|Unsupported or expired template RPC/, '验收期间模板子进程不得异常退出')
  report.status = 'passed'
  delete report.currentStep
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText()).catch(() => {})
  }
} finally {
  // Read-only evidence, independent of the status iframe and its UI assertions.
  const chat = await savedChat().catch(error => { report.savedStateError = String(error.message || error); return null })
  if (chat) await writeFile(join(output, 'saved-state.json'), JSON.stringify({ id: chat.id, posture: chat.posture, contextCompaction: chat.contextCompaction, timeline: chat.timeline,
    messages: chat.messages.map(message => ({ role: message.role, text: message.sourceText ?? message.text, turn: message.turn, variables: message.variables, mvu: message.mvu, ...(displayScenario ? {tavernPluginData:message.tavernPluginData} : {}) })) }, null, 2))
  await context?.tracing.stop({ path: join(output, 'trace.zip') }).catch(() => {})
  await browser?.close()
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(1000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  report.ms = Date.now() - started; report.errors = errors
  await writeFile(join(output, 'server.log'), log.replace(/token=[^\s&]+/g, 'token=REDACTED'))
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  if (process.env.TAVERN_E2E_KEEP === '1') console.log('Temporary home:', root)
  else await rm(root, { recursive: true, force: true })
  console.log(`${report.status}: ${report.ms} ms\nArtifacts: ${output}`)
  if (report.error) console.error(report.error)
}
