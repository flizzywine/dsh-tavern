import {setupStageMedia} from './stage-media-fault.mjs'
import { setupRealGameplay, realGameplayChecks } from './real-gameplay.mjs'
import { refactorLifecycleChecks } from './refactor-lifecycle.mjs'
import { installV3SaveFixture } from './session-upgrade-fixture.mjs'
import { helperApiChecks, helperApiScript } from './helper-api.mjs'
import { backgroundFailureChecks } from './background-failure.mjs'
import { createConversationPageStore } from '../../tavern-plugin/lib/domain/conversation-page-store.js'
import { createConversationState } from '../../tavern-plugin/lib/domain/conversation-state.js'
import { settlementPerformanceChecks, settlementPerformanceInitialVariables } from './settlement-performance.mjs'
import {setupRealVariables,realVariableLookupChecks} from './real-variable-lookup.mjs'
import { setupRealCharacterDesign, realCharacterDesignChecks } from './real-character-design.mjs'
import { setupRealCardEdit, realCardEditChecks } from './real-card-edit.mjs'
import { regenAnomalyChecks, regenTemplateChecks } from './regen-anomalies.mjs'
import { failedTurnCleanupChecks } from './failed-turn-cleanup.mjs'
import { toolStepsChecks } from './tool-steps.mjs'
import { storageAuditChecks } from './storage-audit.mjs'
import { brokenSaveChecks } from './broken-save.mjs'
import { nativeRepairChecks } from './native-repair.mjs'
import { editCandidatesChecks } from './edit-candidates.mjs'
import { failureResilienceChecks } from './failure-resilience.mjs'
import { incrementalMvuChecks } from './mvu-incremental.mjs'
import {openingUpdateChecks} from './opening-update.mjs'
import { backgroundLifecycleChecks } from './background-lifecycle.mjs'
import { cardMemoryChecks } from './card-memory.mjs'
import {displayRegressionRules, displayRegressionChecks} from './display-regression.mjs'
import { surfaceRecoveryChecks } from './surface-recovery.mjs'
import { stringify as stringifyYaml } from 'yaml'
import { applySidebarDefaults } from '../../bin/launcher-settings.mjs'
import { castCardFileChecks, castSpeechChecks, castStageChecks, castStageInputChecks, dshCardPlayChecks } from './cast-stage.mjs'
import { cardVariableUpdateChecks } from './card-variable-update.mjs'
import { cardUpdateChecks } from './card-update.mjs'
import { sidebarUpgrade } from './sidebar-upgrade.mjs'
import { pinPanelChecks } from './pin-panel.mjs'
import { mobileSidebarChecks } from './mobile-sidebar.mjs'
import { presetHubChecks } from './preset-hub.mjs'
import { compactedEditedLegacySession } from '../fixtures/compacted-legacy-session.mjs'
import { encodeMigratedSessionLog, parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'
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
import { currentSessionLogs, dropOtherGenerations } from './session-files.mjs'

const pinScenario = process.argv.includes('--pin-panel')
const displayScenario = pinScenario || process.argv.includes('--display-regression')
const recoveryScenario = process.argv.includes('--surface-recovery')
const helperApiScenario = process.argv.includes('--helper-api')
// Story body submitted through the submit_story tool (global input/output switches, off by default).
const storyToolScenario = process.argv.includes('--story-tool')
// Dialogue avatars: settlement annotates speakers, quoted lines show as speaker rows.
const stageMediaFault = process.argv.includes('--stage-media-fault')
const stageUserSwitch = process.argv.includes('--stage-user-switch')
const stageRpcFault = process.argv.includes('--stage-rpc-fault')
const stageSwitchOnly = process.argv.includes('--stage-session-switch')
const stageRenderFault = stageSwitchOnly || process.argv.includes('--stage-render-fault')
const stageAutomaticLifecycle = process.argv.includes('--stage-auto-lifecycle')
const stageServerLifecycle = stageAutomaticLifecycle || process.argv.includes('--stage-server-lifecycle')
const stageLifecycle = stageServerLifecycle || process.argv.includes('--stage-lifecycle')
const stageIsolation = process.argv.find(arg=>arg.startsWith('--stage-isolation='))?.split('=')[1]
if(stageIsolation && !['absent','activation'].includes(stageIsolation)) throw Error('Unknown stage isolation scenario')
const stagePluginScenario = stageMediaFault || stageUserSwitch || stageRpcFault || stageRenderFault || stageLifecycle || !!stageIsolation || process.argv.includes('--stage-plugin')
const castScenario = stagePluginScenario || process.argv.includes('--cast')
const compactionScenario = process.argv.find(arg => arg.startsWith('--compaction='))?.split('=')[1]
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtime = resolve(process.env.TAVERN_E2E_RUNTIME || join(homedir(), '.dsh-tavern/runtime'))
const modules = join(runtime, 'lib/node_modules')
const cli = join(modules, '@deepseek-ai/dsh/lib/bin.js')
const outputBase = resolve(process.env.TAVERN_E2E_OUTPUT || join(source, 'output/e2e-gameplay'))
await mkdir(outputBase, { recursive: true })
const output = await mkdtemp(join(outputBase, 'run-'))
// A fixed home lets a saved profile-data snapshot (whose session paths embed the
// home) be restored as is: TAVERN_E2E_HOME + TAVERN_E2E_RESTORE_DATA (a .tar.gz).
const root = process.env.TAVERN_E2E_HOME
  ? (await rm(process.env.TAVERN_E2E_HOME, { recursive: true, force: true }), await mkdir(process.env.TAVERN_E2E_HOME, { recursive: true }), process.env.TAVERN_E2E_HOME)
  : await mkdtemp(join(tmpdir(), 'tavern-e2e-'))
const restoredSave = process.env.TAVERN_E2E_RESTORE_DATA || ''
const profile = join(root, 'profiles/tavern'), data = join(root, 'profile-data/tavern/data')
const timeout = Number(process.env.TAVERN_E2E_TIMEOUT_MS) || 30000
const report = { status: 'running', scope: 'real isolated DSH + Tavern + Chromium; fixed model only', steps: [] }
const started = Date.now(), errors = []
let log = '', browser, context, child, page, restartServer, cpuProfiler
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
  if(stageRenderFault && report.beforeReload) return games.find(chat=>chat.id===report.beforeReload.chatId)
  assert.equal(games.length, 1, '本次只应创建一局游戏')
  return games[0]
}
async function assertNativeStorage() {
  let chat=await savedChat()
  const pages=createConversationPageStore({root:join(data,'chats')})
  const domain=createConversationState({store:pages})
  const view=await domain.open(chat.id,{limit:2})
  // Display maintenance can commit between these reads. Compare both formats
  // at the immutable revision selected by the domain, not two different heads.
  if(chat._storageRevision!==view.state.chatRevision)chat=await createChatJournalStore({dataRoot:data}).readRevision(chat.id,view.state.chatRevision)
  assert.equal(view.metadata.format,'conversation-state-v2')
  assert.equal(view.metadata.settings.runtimeLayout,1)
  assert.equal(view.messageCount,chat.messages.length)
  assert.equal(view.state.chatRevision,chat._storageRevision)
  assert.ok(view.messages.every(row=>row.message.runtimeRef&&!Object.hasOwn(row.message,'variables')))
  const latest=[...chat.messages].reverse().find(row=>row.variables?.[row.swipeId||0])
  if(latest)assert.deepEqual(view.state.world.variables,latest.variables[latest.swipeId||0])
  const files=await readdir(join(data,'chats',chat.id))
  assert.ok(files.includes('head.json')&&files.includes('blocks'))
  if(!process.argv.includes('--upgrade-save'))assert.ok(!files.includes('snapshots')&&!files.includes('journals')&&!files.includes('storage-format.json'))
  report.nativeFormat={format:view.metadata.format,chatId:chat.id,messageCount:view.messageCount,revision:view.state.chatRevision,gold:view.state.world.variables.stat_data?.gold,files}
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
  await page.frameLocator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame:not([aria-hidden="true"])')
    .locator('#e2e-gold').filter({ hasText: /^金币：10$/ }).waitFor()
}
try {
  scenario: {
  await step('准备独立运行环境', async () => {
    if (compactionScenario) {
      await mkdir(data, { recursive: true })
      await writeFile(join(data, 'tavern-settings.json'), JSON.stringify({ contextCompaction: { mode: compactionScenario === 'rounds' ? 'rounds' : ['manual', 'overflow', 'provider-overflow', 'legacy'].includes(compactionScenario) ? 'manual' : 'percent', rounds: 2, percent: 50, retainRounds: 2 } }))
      await writeFile(join(output, 'model-control.json'), JSON.stringify({ foregroundPadding: ['overflow', 'provider-overflow'].includes(compactionScenario) ? 4000 : 650, backgroundPadding: 0, window: ['overflow', 'provider-overflow'].includes(compactionScenario) ? 262144 : 32768 }))
    }
    if (displayScenario) {
      await mkdir(data,{recursive:true})
      await writeFile(join(data,'tavern-extension-settings.json'),JSON.stringify({EjsTemplate:{enabled:true,render_enabled:true,raw_message_evaluation_enabled:false,preload_worldinfo_enabled:false,code_blocks_enabled:true}}))
    }
    if(stageMediaFault)report.stageMedia=await setupStageMedia(root)
    await access(cli).catch(() => { throw Error('找不到 DSH runtime；先安装酒馆，或设置 TAVERN_E2E_RUNTIME。') })
    report.runtimeVersion = JSON.parse(await readFile(join(modules, '@deepseek-ai/dsh/package.json'), 'utf8')).version
    await mkdir(join(profile, 'node_modules'), { recursive: true })
    for (const [name, target] of Object.entries({
      // An older plugin build can produce a save its bugs damaged; the scenario then switches to this one.
      'dsh-tavern-plugin': process.env.TAVERN_E2E_PLUGIN_SOURCE || join(source, 'tavern-plugin'),
      'dsh-tavern-stage': join(source, 'tavern-plugin/packages/dsh-tavern-stage'),
      'dsh-tavern-remote': join(source, 'tavern-plugin/packages/dsh-tavern-remote'),
      'dsh-web-mobile': join(source, 'node_modules/dsh-web-mobile')
    })) if (!(stageIsolation === 'absent' && name === 'dsh-tavern-stage')) await symlink(target, join(profile, 'node_modules', name))
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
      if (name.startsWith('.') || ['@deepseek-ai', 'dsh-tavern-plugin', 'dsh-tavern-stage', 'dsh-tavern-remote', 'dsh-web-mobile', 'dsh-better-sidebar'].includes(name)) continue
      await symlink(join(source, 'node_modules', name), join(profile, 'node_modules', name))
    }
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'tavern-e2e', private: true,
      dsh: { profile: { bundles: JSON.parse(await readFile(join(source,'package.json'),'utf8')).dsh.profile.bundles.filter(name=>stageIsolation !== 'absent' || name !== 'dsh-tavern-stage') } } }))
    // The stage scenario runs with the sidebar a real install gets (no Tasks tab), as players see it.
    if (castScenario) await writeFile(join(root, 'settings.yaml'), stringifyYaml(applySidebarDefaults({})))
    await writeFile(join(profile, 'cordis.patch.yml'), `- id: agent-default-model\n  config:\n    provider: tavern-e2e\n    model: fixed\n- insert:\n    - id: tavern-e2e-model\n      name: ${JSON.stringify(join(source, 'tests/e2e/model.mjs'))}\n`)
    if(stageServerLifecycle) {
      const patch=join(profile,'cordis.patch.yml')
      await writeFile(patch,(await readFile(patch,'utf8'))+`- insert:
    - id: stage-lifecycle-test
      name: ${JSON.stringify(join(source,'tests/e2e/stage-lifecycle-host.mjs'))}
`)
    }
    await mkdir(join(data, 'resources/presets'), { recursive: true })
    for (const key of ['A', 'B']) await writeFile(join(data, `resources/presets/E2E-${key}.json`), JSON.stringify({
      prompts: [{ identifier: 'main', name: `E2E ${key}`, role: 'system', content: `E2E_PRESET_${key}_ACTIVE`, enabled: true }],
      prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }]
    }))
    await mkdir(join(data, 'resources/cards'), { recursive: true })
    // Deliberate continuous DOM updates: a real status card must receive new
    // variables even when it never reaches the frame's DOM-idle threshold.
    const status = '<div id="e2e-gold">金币：加载中</div><script>function refresh(){const v=getAllVariables();document.getElementById("e2e-gold").textContent="金币："+(v.stat_data?.gold??"未初始化")}refresh();setInterval(refresh,200)</script>'
    // Storage audit: borrow a real large card's worldbook (its [initvar] entries give realistic MVU state).
    const auditBook = process.env.TAVERN_E2E_AUDIT_CARD ? (raw => (raw.data || raw).character_book)(JSON.parse(await readFile(process.env.TAVERN_E2E_AUDIT_CARD, 'utf8')).raw || JSON.parse(await readFile(process.env.TAVERN_E2E_AUDIT_CARD, 'utf8'))) : null
    await writeFile(join(data, 'resources/cards/e2e.json'), JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: {
      name: 'E2E 奖励验收', description: '固定验收角色', first_mes: (process.argv.includes('--text-colors') ? '她说：“欢迎光临。” *窗外下着雨。*' : '欢迎领取奖励。') + (process.argv.includes('--opening-update') ? '\n<initvar>{"gold":0,"old":1}</initvar>' : '') + '\n\n<StatusPlaceHolderImpl/>',
      mes_example: '', scenario: '', personality: '',
      character_book: { name: '验收初始变量', entries: [{ id: 1, keys: [], comment: '[initvar]初始值', content: process.argv.includes('--settlement-performance') || process.argv.includes('--storage-audit') ? JSON.stringify(settlementPerformanceInitialVariables()) : 'gold: 0', enabled: true, constant: true, insertion_order: 1 }, ...(auditBook ? auditBook.entries.filter(entry => !/initvar/i.test(String(entry.comment || '') + String(entry.content || '').slice(0, 200))).map((entry, index) => ({ ...entry, id: 1000 + index })) : []), ...(helperApiScenario ? [{ id: 2, keys: ['金币规则'], comment: '金币规则', content: '每次领取十枚金币。', enabled: true, insertion_order: 2 }] : [])] },
      extensions: { mvu: {}, ...(helperApiScenario ? { TavernHelper_scripts: [{ type: 'script', value: { id: 'e2e-helper-api', name: 'E2E 助手接口', enabled: true, content: helperApiScript } }] } : {}), regex_scripts: [{ id: 'e2e-status', scriptName: '金币状态', findRegex: '<StatusPlaceHolderImpl/>',
        replaceString: '```html\n' + status + '\n```', placement: [2], markdownOnly: true, disabled: false }, ...(displayScenario ? displayRegressionRules() : []),
        // A permanent player-input rule: the saved input differs from what was typed.
        ...(process.argv.includes('--regen-template') ? [{ id: 'e2e-input-rule', scriptName: '整理输入', findRegex: '/ZZ(\\d)/g', replaceString: '〔$1〕', placement: [1], disabled: false }] : [])] }
    } }))
  })
  if (process.argv.includes('--real-gameplay')) { const config = await setupRealGameplay({root,profile,data,runtimeHome:join(homedir(),'.dsh-tavern')}); report.scope='real isolated DSH + Chromium + configured live model'; report.model=config.model; report.card=config.card }
  if(process.argv.includes('--real-variables')) {report.scope='real isolated DSH + Chromium + configured live model';report.model=await setupRealVariables({root,profile,data,runtimeHome:join(homedir(),'.dsh-tavern')})}
  if(process.argv.includes('--real-card-edit')) {report.scope='real isolated DSH + Chromium + configured live model';report.model=await setupRealCardEdit({root,profile,data,runtimeHome:join(homedir(),'.dsh-tavern')})}
  if(process.argv.includes('--real-character-design')) {report.scope='real isolated DSH + Chromium + configured live model';report.model=await setupRealCharacterDesign({root,profile,data,runtimeHome:join(homedir(),'.dsh-tavern')})}
  if (restoredSave) await step('放入保存的存档快照', async () => {
    await rm(join(root, 'profile-data'), { recursive: true, force: true })
    const { execFileSync } = await import('node:child_process')
    execFileSync('tar', ['-xzf', restoredSave, '-C', root])
  })
  await step('启动真实 DSH 与酒馆', async () => {
    async function launchServer() {
      const logOffset = log.length
      // Do not inherit provider credentials or a production profile configuration.
      const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
      child = spawn(process.execPath, [...(process.argv.includes('--settlement-performance') ? ['--import', join(source, 'tests/e2e/settlement-perf-register.mjs')] : []), cli, '--profile', 'tavern', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
        cwd: source, env: { ...env, DSH_HOME: root, DSH_CWD: root,
          TAVERN_E2E_STAGE_CONTROL: stageServerLifecycle ? output : '',
          TAVERN_E2E_COMPACTION_DIR: compactionScenario ? output : '',
          TAVERN_E2E_RECOVERY_DIR: recoveryScenario ? output : '',
          TAVERN_E2E_PERFORMANCE_DIR: process.argv.includes('--settlement-performance') || process.argv.includes('--storage-audit') ? output : '',
          TAVERN_PERF_HISTORY_READY: process.env.TAVERN_PERF_HISTORY_READY || (process.argv.includes('--storage-audit') ? '1' : ''),
          TAVERN_PERF_BODY_REPEATS: process.env.TAVERN_PERF_BODY_REPEATS || '',
          TAVERN_E2E_BACKGROUND_DIR: (process.argv.includes('--background-lifecycle') || process.argv.includes('--background-failure')) ? output : '',
          TAVERN_E2E_REQUEST_AUDIT: join(output, 'preset-requests.jsonl'),
          TAVERN_E2E_STORY_TOOL_LOG: storyToolScenario ? join(output, 'story-tool.jsonl') : '',
          TAVERN_E2E_STORY_TOOL_LONG: storyToolScenario ? (process.env.TAVERN_E2E_STORY_TOOL_LONG || '60') : '',
          TAVERN_E2E_SETTLEMENT_DUMP: process.env.TAVERN_E2E_SETTLEMENT_DUMP || '',
          TAVERN_E2E_BACKGROUND_DUMP: process.argv.includes('--edit-candidates') ? join(output, 'background-requests.jsonl') : '',
          TAVERN_E2E_CAST: castScenario ? '1' : '',
          TAVERN_E2E_MEMORY_AUDIT: process.argv.includes('--card-memory') ? join(output, 'memory-requests.jsonl') : '',
          TAVERN_E2E_CONTEXT_AUDIT: process.argv.includes('--native-repair') || process.argv.includes('--failure-resilience') ? join(output, 'context-requests.jsonl') : '',
          TAVERN_E2E_LLM_MODULE: join(modules, '@deepseek-ai/dsh-llm/lib/index.js'),
          // Server card scripts are the default; ordinary scenarios keep exercising the page path.
          DSH_TAVERN_SERVER_SCRIPTS: process.argv.includes('--server-scripts') ? '1' : '0',
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
      // A cold restart closes the old page before shutting down its server;
      // otherwise background polling races shutdown and reports spurious fetch errors.
      await page.goto('about:blank')
      child.kill('SIGTERM')
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)])
      assert.notEqual(child.exitCode, null, '旧服务必须退出后再重启')
      await whileStopped?.()
      const bootStarted = Date.now()
      const next = new URL(await launchServer())
      const bootMs = Date.now() - bootStarted
      current.host = next.host
      current.searchParams.set('token', next.searchParams.get('token'))
      const openStarted = Date.now()
      await page.goto(current.toString(), { waitUntil: 'domcontentloaded' })
      const history = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: report.card || 'E2E 奖励验收' })
      const sidebarToggle = page.getByRole('button', { name: /^(Open|Expand) sidebar$/ })
      await history.filter({visible:true}).or(sidebarToggle.filter({visible:true})).first().waitFor()
      if (!await history.isVisible()) await sidebarToggle.click()
      await history.click()
      const openSessionStarted=Date.now()
      await page.locator('.dsh-tavern-side-row-name').first().click()
      await openStatus()
      return {bootMs,openStarted,openSessionStarted}
    }
    browser = await chromium.launch({ headless: true, ...(stagePluginScenario ? {args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader']} : {}) })
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: process.env.TAVERN_E2E_LOCALE || 'en-US', ...(recoveryScenario ? { hasTouch: true } : {}) })
    context.setDefaultTimeout(timeout)
    if (!process.argv.includes('--settlement-performance')) await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    page = await context.newPage()
    if(stageRenderFault || stageLifecycle || stageIsolation === 'activation') await page.route('**/plugins/**',async route=>{
      if(!route.request().url().includes('client.js')) return route.continue()
      const response=await route.fetch(),body=await response.text()
      if(stageLifecycle && body.includes("const host = ctx.get('tavernStageFrontend');")) {
        return route.fulfill({response,body:body.replace("return ({\n        name: 'dsh-tavern-stage'","return (window.__stageLifecyclePlugin={\n        name: 'dsh-tavern-stage'").replace("const host = ctx.get('tavernStageFrontend');",`window.__stageLifecycleTest={disable:()=>ctx.fiber.dispose(),enable:async()=>{const fiber=ctx.fiber.parent.plugin(window.__stageLifecyclePlugin);await fiber.await();}}; const host = ctx.get('tavernStageFrontend');`)})
      }
      if(stageRenderFault) {
        const marker='function GalStage(props) {'
        if(body.includes(marker))report.renderFaultInstalled=true
        return route.fulfill({response,body:body.replace(marker,marker+"if(window.__stageRenderFault)throw new Error('E2E stage render failure');")})
      }
      const marker='activeViews.sessions.start(host.sessionInputs());'
      if(body.includes(marker)) {
        report.injectedActivationFailure=true
        await route.fulfill({response,body:body.replace(marker,"throw new Error('E2E stage activation failure');")})
      } else await route.fulfill({response})
    })
    if(process.argv.includes('--history-demand')) {
      await page.addInitScript(()=>{
        const open=XMLHttpRequest.prototype.open;let captured=0;
        XMLHttpRequest.prototype.open=function(method,url,...args){
          if(String(url).includes('/helper-history?') && captured++<3)console.info('[history-read-stack] '+new Error().stack);
          return open.call(this,method,url,...args);
        };
      });
      page.on('console',message=>{if(message.text().startsWith('[history-read-stack]'))log+=message.text()+'\n'});
    }
    page.on('pageerror', error => { if(stageRenderFault && error.message==='E2E stage render failure'){report.renderFaultObserved=true;return} errors.push(error.message); if (process.env.E2E_ERROR_STACK) console.log('[pageerror]', error.stack) })
    // Slot error boundaries catch React failures, so pageerror alone misses them.
    page.on('console', message => {
      if(stageRenderFault && message.type()==='error' && message.text().includes('E2E stage render failure')){report.renderFaultObserved=true;return}
      if(stageIsolation === 'activation' && message.text().includes('[dsh-tavern-stage] activation failed') && message.text().includes('E2E stage activation failure')) {report.activationFailureObserved=true;return}
      if (message.type() === 'error' && /slot entry crashed|Minified React error|activation failed|ReferenceError:/.test(message.text())) errors.push(message.text())
    })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  })
  if (restoredSave) await step('打开存档中的这局游戏', async () => {
    const history = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: report.card || 'E2E 奖励验收' })
    await history.filter({ visible: true }).first().waitFor()
    if (!await page.locator('.dsh-tavern-side-row-name').first().isVisible().catch(() => false)) await history.first().click()
    await page.locator('.dsh-tavern-side-row-name').first().click()
    await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  })
  else await step('通过界面选择角色卡并新开一局', async () => {
    await page.getByRole('button', { name: /选择人物卡.*新开游玩/ }).click()
    await page.getByText(report.card || 'E2E 奖励验收', { exact: true }).first().click()
    await page.getByRole('button', { name: '开始新游戏', exact: true }).click()
    await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
    if (process.argv.includes('--real-gameplay')) return
    await openStatus()
    await page.frameLocator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame:not([aria-hidden="true"])')
      .locator('#e2e-gold').filter({ hasText: /^金币：0$/ }).waitFor()
  })
  if(process.argv.includes('--native-format'))await step('确认新局直接写入原生分页存档',assertNativeStorage)
  if (process.argv.includes('--text-colors')) {
    await step('实际正文挂载主题对白高亮', async () => {
      // A trusted card's script layer keeps a hidden copy of the body beside the shown one.
      await page.locator('.dsh-tavern-colored-markdown').filter({ visible: true }).first().waitFor()
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
  } else if (process.argv.includes('--truncation')) {
    const composer = () => page.getByRole('textbox', { name: /发消息|Message/ })
    const probe = async name => {
      await page.screenshot({ path: join(output, name + '.png'), fullPage: true })
      const chat = await savedChat()
      report[name] = { body: (await page.locator('body').innerText()).slice(-1500), messages: chat.messages.map(m => ({ role: m.role, text: (m.sourceText ?? m.text ?? '').slice(0, 80) })),
        foregroundError: chat.foregroundError, operations: Object.values(chat.timeline?.operations || {}).map(o => ({ kind: o.kind, status: o.status, turn: o.turn })) }
    }
    for (const marker of (process.env.E2E_TRUNCATE_MARKERS || 'E2E_TRUNCATE_TEXT').split(',')) {
      await step('正文截断：' + marker, async () => {
        await composer().fill(marker + ' 继续'); await composer().press('Enter')
        const sent = Date.now()
        await page.getByRole('button', { name: /重新生成/ }).filter({ visible: true }).last().waitFor({ timeout: 600000 }).catch(() => {})
        report['ms-' + marker] = Date.now() - sent
        await pause(3000)
        await probe('after-' + marker)
      })
      await step('截断后继续发消息：' + marker, async () => {
        await composer().fill('再次领取奖励'); await composer().press('Enter')
        const ok = await page.getByText('你再次领取了奖励', { exact: false }).filter({ visible: true }).nth(marker === 'E2E_TRUNCATE_TEXT' ? 0 : 1).waitFor({ timeout: 60000 }).then(() => true, () => false)
        await probe('next-' + marker)
        report['next-' + marker].replied = ok
      })
      if (marker === 'E2E_TRUNCATE_LOOP') await step('截断后重新生成正文', async () => {
        await page.getByRole('button', { name: '重新生成正文', exact: true }).filter({ visible: true }).last().click()
        await pause(15000)
        await probe('regen-' + marker)
      })
    }
  } else if (process.argv.includes('--filter-midstream')) {
    // Moderation stops repeat for the same request: the failed tail must offer a way out besides replaying.
    const composer = () => page.getByRole('textbox', { name: /发消息|Message/ })
    const tail = () => page.locator('.dsh-tavern-error-controls').filter({ visible: true }).last()
    const settled = () => page.getByText('后台结算已完成').last().waitFor({ timeout: 60000 }).catch(() => {})
    const replies = async () => (await savedChat()).messages.filter(m => m.role === 'assistant').length
    const nextReply = async before => { for (let i = 0; i < 120 && await replies() <= before; i++) await pause(500); assert.ok(await replies() > before, '应收到新回复') }
    await step('正常玩一轮', async () => {
      await composer().fill('领取任务奖励'); await composer().press('Enter')
      await page.getByText('你获得了十枚金币。').first().waitFor()
      await settled()
    })
    await step('正文输出到一半被内容审核掐断：撤回输入放回输入框，错误收起', async () => {
      await composer().fill('E2E_FILTER_MIDSTREAM 继续'); await composer().press('Enter')
      await tail().locator('.dsh-tavern-error-withdraw.is-primary').waitFor({ timeout: 60000 })
      assert.match(await tail().innerText(), /原样重新生成通常还会被拦截/)
      await page.screenshot({ path: join(output, 'filter-tail.png'), fullPage: true })
      await tail().locator('.dsh-tavern-error-withdraw').click()
      await page.waitForFunction(() => /E2E_FILTER_MIDSTREAM 继续/.test(document.querySelector('[data-composer-card] :is(textarea, [contenteditable="true"])')?.value ?? document.querySelector('[data-composer-card] [contenteditable="true"]')?.innerText ?? ''), null, { timeout: 15000 })
      await page.getByText('这一轮的失败已清除，错误已收起').first().waitFor({ timeout: 15000 })
      await page.getByRole('button', { name: '重新生成本轮', exact: true }).filter({ visible: true }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
      report.withdrawDockReplay = await page.locator('.dsh-tavern-choice-trigger').filter({ hasText: '重新生成本轮' }).count()
      assert.equal(report.withdrawDockReplay, 0, '撤回后不应再提供重放被撤回的输入')
    })
    await step('撤回后改写输入再发送，正常回复', async () => {
      await composer().fill('再次领取奖励'); await composer().press('Enter')
      await page.getByText('你再次领取了奖励', { exact: false }).first().waitFor({ timeout: 60000 })
      await settled()
    })
    await step('前面的剧情触发审核、之后连续被拦：主推回退上一轮，回退后恢复', async () => {
      const before = await replies()
      await composer().fill('E2E_POISON 继续'); await composer().press('Enter')
      await nextReply(before)
      await settled(); await pause(1000)
      await composer().fill('第三次领取'); await composer().press('Enter')
      await tail().locator('.dsh-tavern-error-replay').waitFor({ timeout: 60000 })
      await tail().locator('.dsh-tavern-error-replay').click()
      await tail().locator('.dsh-tavern-error-rewind.is-primary').waitFor({ timeout: 60000 })
      assert.match(await tail().innerText(), /已连续 2 次.*建议回退上一轮/s)
      await page.screenshot({ path: join(output, 'filter-repeated.png'), fullPage: true })
      await tail().locator('.dsh-tavern-error-rewind').click()
      await page.waitForFunction(() => !document.body.innerText.includes('E2E_POISON 继续'), null, { timeout: 30000 })
      assert.ok(!JSON.stringify((await savedChat()).messages).includes('E2E_POISON'), '回退上一轮应移除触发审核的那一轮')
      const kept = await replies()
      await composer().fill('回退后再领取'); await composer().press('Enter')
      await nextReply(kept)
      await page.screenshot({ path: join(output, 'filter-recovered.png'), fullPage: true })
    })
  } else if (process.argv.includes('--send-during-settlement')) {
    // A reload followed by an immediate send must not fail while the previous round still settles.
    await step('结算未完成时刷新并立即发送下一条消息', async () => {
      const composer = () => page.getByRole('textbox', { name: /发消息|Message/ })
      await composer().fill('领取任务奖励'); await composer().press('Enter')
      await page.getByText('你获得了十枚金币。').first().waitFor()
      await page.reload()
      await composer().fill('再次领取奖励'); await composer().press('Enter')
      const outcome = await Promise.race([
        page.getByText('你再次领取了奖励，金币累计二十枚。').first().waitFor({ timeout: 90000 }).then(() => 'replied'),
        page.locator('[data-chat-flow-kind="turn-error"]').first().waitFor({ timeout: 90000 }).then(async () => 'error: ' + await page.locator('[data-chat-flow-kind="turn-error"]').first().innerText()),
      ])
      report.sendDuringSettlement = outcome
      await page.screenshot({ path: join(output, 'send-during-settlement.png'), fullPage: true })
      assert.equal(outcome, 'replied', '结算期间发送的消息不能直接失败：' + outcome)
    })
  } else if (process.argv.includes('--refusal')) {
    await step('模型回复拒绝语时，正文下方说明不是酒馆故障', async () => {
      const composer = page.getByRole('textbox', { name: /发消息|Message/ })
      await composer.fill('E2E_REFUSE_TEXT 继续'); await composer.press('Enter')
      const notice = page.locator('.dsh-tavern-refusal-notice').filter({ hasText: '模型拒绝继续这段剧情' })
      await notice.waitFor()
      await page.reload(); await notice.waitFor()
      report.refusal = { textNotice: await notice.textContent() }
      // The reply projection lands after the chat revision; its fork target must not wait for a later rebuild.
      await page.locator('[data-chat-flow-kind="turn-tail"][data-chat-turn="2"] button[aria-label="从这一轮分叉"]').waitFor({ state: 'attached', timeout: 5000 })
      // Settlement of this round runs in the background; the next send must follow it.
      await page.locator('.dsh-tavern-mvu-receipt').filter({ visible: true }).last().waitFor()
      await page.getByText('后台结算已完成').first().waitFor({ timeout: 60000 }).catch(() => {})
    })
    await step('服务商内容审核拦截时，报错旁说明不是酒馆故障', async () => {
      const composer = page.getByRole('textbox', { name: /发消息|Message/ })
      await composer.fill('E2E_CONTENT_FILTER 继续'); await composer.press('Enter')
      const label = page.locator('.dsh-tavern-error-controls').filter({ hasText: '内容审核拦截了这一轮回复' })
      await label.waitFor()
      await page.reload(); await label.waitFor()
      report.refusal.providerNotice = await label.textContent()
      await page.screenshot({ path: join(output, 'refusal-notices.png'), fullPage: true })
    })
    await step('失败轮次之后，每条回复仍可分叉，且分叉能开出新对话', async () => {
      // Fork targets follow session events written after the chat revision (reply projection).
      const tails = page.locator('[data-chat-flow-kind="turn-tail"]')
      for (const turn of ['1', '2']) {
        const tail = page.locator(`[data-chat-flow-kind="turn-tail"][data-chat-turn="${turn}"]`)
        await tail.locator('button[aria-label="从这一轮分叉"]').waitFor({ state: 'attached' })
      }
      report.refusal.forkButtons = await tails.locator('button[aria-label="从这一轮分叉"]').count()
      const before = await page.locator('.dsh-tavern-side-row').count()
      await page.locator('[data-chat-flow-kind="turn-tail"][data-chat-turn="2"] button[aria-label="从这一轮分叉"]').click({ force: true })
      await page.waitForFunction(count => document.querySelectorAll('.dsh-tavern-side-row').length > count, before, { timeout: 60000 })
    })
  } else if (helperApiScenario) {
    await helperApiChecks({ page, step, savedChat, output, report })
  } else if (process.argv.includes('--failure-resilience')) {
    await failureResilienceChecks({ page, step, savedChat, output, report, root, restartServer })
  } else if (process.argv.includes('--edit-candidates')) {
    await editCandidatesChecks({ page, step, savedChat, output, report })
  } else if (process.argv.includes('--native-repair')) {
    await nativeRepairChecks({ page, step, savedChat, output, report, data, restartServer })
  } else if (process.argv.includes('--broken-save')) {
    await brokenSaveChecks({ page, step, savedChat, output, report, root, data, profile, source, restartServer })
  } else if (process.argv.includes('--regen-template')) {
    await regenTemplateChecks({ page, step, savedChat, output, report, root })
  } else if (process.argv.includes('--tool-steps')) {
    await toolStepsChecks({ page, step, savedChat, output, report })
  } else if (process.argv.includes('--failed-turn-cleanup')) {
    await failedTurnCleanupChecks({ page, step, savedChat, output, report })
  } else if (process.argv.includes('--regen-anomalies')) {
    await regenAnomalyChecks({ page, step, savedChat, output, report, serverLog: () => log })
  } else if (process.argv.includes('--real-gameplay')) {
    await realGameplayChecks({page,step,savedChat,output,report,restartServer,root})
  } else if (process.argv.includes('--real-card-edit')) {
    await realCardEditChecks({page,step,root,data,output,report})
  } else if (process.argv.includes('--real-character-design')) {
    await realCharacterDesignChecks({page,step,savedChat,root,data,output,report})
  } else if (process.argv.includes('--real-variables')) {
    await realVariableLookupChecks({page,step,savedChat,root,output,report})
  } else if (process.argv.includes('--storage-audit')) {
    await storageAuditChecks({ page, step, savedChat, data, root, output, report })
  } else if (process.argv.includes('--opening-update')) {
    await openingUpdateChecks({page,step,savedChat,data,output,report,root})
  } else if (process.argv.includes('--background-failure')) {
    await backgroundFailureChecks({page,step,savedChat,output,report})
  } else if (recoveryScenario) {
    await surfaceRecoveryChecks({ page, step, savedChat, output, report, root, restartServer })
  } else {
  // Host settings live behind shell chrome that differs per DSH release; the
  // acceptance only needs the switches, so write them through the same RPC the
  // settings page uses.
  const setTavernSettings = async patch => {
    const result = await page.evaluate(async patch => (await fetch('/api/dsh-tavern/updateTavernSettings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch }) })).json(), patch)
    for (const [name, value] of Object.entries(patch)) assert.equal(result.settings?.[name], value, JSON.stringify(result))
    return result
  }
  // 对话气泡 / 舞台模式 are the card's own (stage.dialogue / stage.stage): turn them on for the fixture card the way
  // 舞台设置 › 基础设置 does.
  const setCardStage = async stage => page.evaluate(async ({stage,packId}) => {
    const rpc = async (method, args) => (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    const card = await rpc('getCardAssetBindings', { path: 'cards/e2e.json' })
    const extension = card.extension || { assetBindings: { boundPackIds: [] } }
    const saved = await rpc('saveCardAssetBindings', { path: 'cards/e2e.json', expectedRevision: card.revision,
      patch: { assetBindings: packId ? {...extension.assetBindings,boundPackIds:[packId]} : extension.assetBindings, stage: { ...(extension.stage || {}), ...stage } } })
    if (saved.ok === false) throw new Error(saved.error)
  }, {stage,packId:report.stageMedia?.packId})
  if (storyToolScenario) await step('开启输入与输出走工具调用', async () => {
    const chatUrl = page.url()
    await setTavernSettings({ storyInputToolCall: true, storyOutputToolCall: true })
    await setCardStage({ dialogue: true, stage: true })
    await page.goto(chatUrl)
    await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  })
  if (castScenario && stageIsolation !== 'absent') await step('开启对话头像', async () => {
    const chatUrl = page.url()
    await setCardStage({ dialogue: true })
    await page.goto(chatUrl)
    await page.getByRole('textbox', { name: /发消息|Message/ }).waitFor()
  })
  await step('玩一轮，确认正文、金币与人物姿势', async () => {
    const composer = page.getByRole('textbox', { name: /发消息|Message/ })
    await composer.fill('领取任务奖励')
    await composer.press('Enter')
    await inspectScreen()
    report.beforeReload = inspectSaved(await savedChat())
    await page.screenshot({ path: join(output, 'before-reload.png'), fullPage: true })
  })
  if (stagePluginScenario) {
    await step(stageIsolation ? '舞台不可用时普通聊天仍可生成、保存和刷新' : '真实舞台进入、退出，再回到普通聊天', async () => {
      if(stageIsolation) {
        assert.equal(await page.getByRole('button',{name:'舞台',exact:true}).count(),0)
        assert.equal(await page.locator('[data-plugin-css^="dsh-tavern-stage/"], .fork-gal-mount').count(),0)
        if(stageIsolation === 'activation') assert.ok(report.injectedActivationFailure && report.activationFailureObserved,'必须触发真实插件激活失败')
      } else {
      await page.getByRole('button', { name: '舞台', exact: true }).click()
      await page.locator('.fork-gal-stage[data-entry="ready"]').waitFor({ state: 'visible' })
      if(stageMediaFault)await page.waitForFunction(()=>{const text=document.querySelector('[aria-label="舞台文本"]')?.textContent||'';return text.includes('店主笑着迎上来。')||text.includes('店主笑着说：“欢迎回来，这是你的奖励。”')})
      else await page.getByRole('region', { name: '舞台文本' }).getByText('店主笑着迎上来。', { exact: false }).waitFor()
      assert.equal(await page.getByText('画面载入失败', { exact: true }).count(), 0)
      if(stageRpcFault) {
        report.stageReadyBeforeRpcFault=true
        await page.route('**/api/dsh-tavern/getStageDirection',route=>{
          report.directionFailures=(report.directionFailures || 0)+1
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:false,error:'E2E stage direction unavailable'})})
        })
        for(let attempt=0;attempt<100 && !report.directionFailures;attempt++)await page.waitForTimeout(100)
        assert.ok(report.directionFailures,'必须在舞台正常显示后实际触发演出 RPC 失败')
      }
      if(stageMediaFault) {
        await page.keyboard.press('Escape')
        await page.getByRole('button',{name:/^背景(?:：.*)?$/}).filter({visible:true}).last().click()
        await page.getByRole('button',{name:'正常背景',exact:true}).click()
        await page.waitForFunction(()=>window.forkGalDebug?.stats().layers.some(layer=>!!layer.url))
        const healthyBackgroundUrl=await page.evaluate(()=>window.forkGalDebug.stats().layers.find(layer=>layer.url).url)
        report.healthyBackgroundShown=true
        await page.screenshot({path:join(output,'stage-healthy-background.png'),fullPage:true})
        await page.route('**/api/dsh-asset-library/v2/lease/*/media',route=>{
          report.mediaFailures=(report.mediaFailures||0)+1
          return route.fulfill({status:404,contentType:'text/plain',body:'E2E missing stage image'})
        })
        await page.getByRole('button',{name:'故障背景',exact:true}).click()
        for(let attempt=0;attempt<100&&!report.mediaFailures;attempt++)await page.waitForTimeout(100)
        assert.ok(report.mediaFailures,'必须实际触发绑定素材的文件加载失败')
        await page.getByRole('alert').filter({hasText:'载入失败'}).waitFor()
        assert.ok(await page.evaluate(url=>window.forkGalDebug.stats().layers.some(layer=>layer.url===url),healthyBackgroundUrl),'新背景失败后必须保留上一张已显示的背景')
        report.failedBackgroundReported=true
        await page.keyboard.press('Escape')
      }
      await page.screenshot({ path: join(output, 'stage-open.png'), fullPage: true })
      if(stageLifecycle) for(let cycle=0;cycle<2;cycle++) {
          async function command(action) {
            const id=cycle+'-'+action
            await writeFile(join(output,'stage-command.json'),JSON.stringify({id,action}))
            for(let attempt=0;attempt<150;attempt++) {
              const result=await readFile(join(output,'stage-result.json'),'utf8').then(JSON.parse).catch(()=>null)
              if(result?.id===id){assert.equal(result.error,undefined);assert.equal(result.status,action==='disable'?'disabled':'ready');return}
              await page.waitForTimeout(100)
            }
            throw Error('Stage server lifecycle did not settle: '+action)
          }
        if(stageAutomaticLifecycle) await command('disable')
        else await page.evaluate(()=>window.__stageLifecycleTest.disable())
        await page.locator('.fork-gal-stage').waitFor({state:'detached'})
        assert.equal(await page.locator('[data-plugin-css^="dsh-tavern-stage/"], .fork-gal-mount').count(),0)
        assert.equal(await page.getByRole('button',{name:'舞台',exact:true}).count(),0)
        const input=page.getByRole('textbox',{name:/发消息|Message/})
        await input.fill('热停用期间保留的草稿')
        if(stageServerLifecycle) {
          const readKinds=()=>page.evaluate(async()=> (await fetch('/api/dsh-tavern/getStagePerformanceKinds',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json())
          if(!stageAutomaticLifecycle) {assert.ok(Array.isArray((await readKinds()).kinds),'停用前 RPC 应可用');await command('disable')}
          const unavailable=await readKinds()
          assert.equal(unavailable.ok,false,'舞台服务停用后 RPC 应撤销')
          assert.match(unavailable.error || unavailable.message || '',/未知方法|未启用/)
          if(cycle===0) {
            const before=(await savedChat()).messages.filter(row=>row.role==='assistant'&&!row.greeting).length
            await input.fill('领取任务奖励')
            await input.press('Enter')
            let generated=false
            for(let attempt=0;attempt<100;attempt++) {
              generated=(await savedChat()).messages.filter(row=>row.role==='assistant'&&!row.greeting&&row.text?.includes('你获得了十枚金币')).length>before
              if(generated)break
              await page.waitForTimeout(200)
            }
            assert.ok(generated,'前后端均停用时普通聊天必须生成并保存')
            report.generatedWithStageDisabled=true
            await input.fill('热停用期间保留的草稿')
          }
          await command('enable')
          assert.ok(Array.isArray((await readKinds()).kinds),'重启后 RPC 应恢复')
        }

        if(!stageAutomaticLifecycle) await page.evaluate(()=>window.__stageLifecycleTest.enable())
        await page.getByRole('button',{name:'舞台',exact:true}).click()
        await page.locator('.fork-gal-stage[data-entry="ready"]').waitFor()
        assert.equal(await page.locator('.fork-gal-stage').count(),1)
        assert.equal(await input.evaluate(node=>node.isContentEditable ? node.textContent : node.value),'热停用期间保留的草稿')
      }

      if(stageRenderFault) {
        const preserved=(await savedChat()).messages.map(({role,text,turn,variables})=>({role,text,turn,variables}))
        if(!stageSwitchOnly) {
        assert.ok(report.renderFaultInstalled)
        await page.evaluate(()=>{window.__stageRenderFault=true})
        await page.keyboard.press('h')
        await page.locator('[data-stage-failure]').waitFor({state:'visible'})
        assert.ok(report.renderFaultObserved,'必须观测到注入的渲染故障')
        await page.screenshot({path:join(output,'stage-render-failure.png'),fullPage:true})
        await page.getByRole('button',{name:'返回普通聊天',exact:true}).click()
        } else {
          await page.keyboard.press('Escape')
          await page.getByRole('button',{name:/返回主页面/}).filter({visible:true}).last().click()
        }
        assert.equal(await page.locator('.fork-gal-mount').count(),0)
        assert.deepEqual((await savedChat()).messages.map(({role,text,turn,variables})=>({role,text,turn,variables})),preserved,'舞台故障不能修改剧情和变量')
        await page.getByRole('button',{name:/选择人物卡.*新开游玩/}).click()
        await page.locator('.dsh-tavern-picker-overlay').getByText('E2E 奖励验收',{exact:true}).click()
        await page.getByRole('button',{name:'开始新游戏',exact:true}).click()
        await page.getByRole('textbox',{name:/发消息|Message/}).waitFor()
        await page.waitForFunction(()=>document.querySelectorAll('.dsh-tavern-side-row').length===2)
        assert.equal(await page.locator('[data-stage-failure]').count(),0)
        await openStatus()
        await page.frameLocator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame:not([aria-hidden="true"])').locator('#e2e-gold').filter({hasText:/^金币：0$/}).waitFor()
        await page.locator('.dsh-tavern-side-row:not(.active) .dsh-tavern-side-row-main').click()
        await inspectScreen()
        assert.deepEqual((await savedChat()).messages.map(({role,text,turn,variables})=>({role,text,turn,variables})),preserved,'切换会话不能污染原存档')
        report.sessionSwitchAfterFault=true

      } else {
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /返回主页面/ }).filter({ visible: true }).last().click()
      }
      await page.locator('.fork-gal-stage').waitFor({ state: 'hidden' })
      }
      if(stageUserSwitch) {
        await page.getByRole('button',{name:'设置',exact:true}).click()
        await page.getByText('Settings',{exact:true}).click()
        await page.getByText('DSH Tavern',{exact:true}).click()
        await page.getByRole('button',{name:'停用舞台',exact:true}).click()
        await page.getByRole('button',{name:'启用舞台',exact:true}).waitFor()
        await page.waitForFunction(()=>!document.querySelector('[data-plugin-css^="dsh-tavern-stage/"], .fork-gal-mount'))
        await page.screenshot({path:join(output,'stage-disabled-settings.png'),fullPage:true})
        report.userDisabledStage=true
        await restartServer()
        assert.equal(await page.getByRole('button',{name:'舞台',exact:true}).count(),0)
        report.userDisableSurvivedRestart=true
      }
      const composer = page.getByRole('textbox', { name: /发消息|Message/ })
      const priorReplies=(await savedChat()).messages.filter(row=>row.role==='assistant'&&!row.greeting).length
      await composer.fill('领取任务奖励')
      await composer.press('Enter')
      await page.waitForFunction(() => [...document.querySelectorAll('.dsh-tavern-user-bubble')].filter(el => el.textContent.includes('领取任务奖励')).length >= 2)
      let replies = []
      for (let attempt = 0; attempt < 100; attempt++) {
        replies = (await savedChat()).messages.filter(row => row.role === 'assistant' && !row.greeting && row.text?.includes('你获得了十枚金币'))
        if (replies.length > priorReplies) break
        await page.waitForTimeout(200)
      }
      assert.ok(replies.length > priorReplies, '舞台操作后的新一轮正文必须真实生成并保存')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await composer.waitFor({ state: 'visible' })
      await page.getByText('你获得了十枚金币。', { exact: false }).filter({ visible: true }).first().waitFor()
      assert.deepEqual(errors, [], '舞台切换不得产生未捕获异常')
      await page.screenshot({ path: join(output, 'chat-after-stage.png'), fullPage: true })
      if(stageMediaFault || stageUserSwitch || stageRpcFault || stageRenderFault || stageIsolation === 'activation') {
        if(stageUserSwitch) {
          await page.getByRole('button',{name:'设置',exact:true}).click()
          await page.getByText('Settings',{exact:true}).click()
          await page.getByText('DSH Tavern',{exact:true}).click()
          await page.getByRole('button',{name:'启用舞台',exact:true}).click()
          await page.getByRole('button',{name:'停用舞台',exact:true}).waitFor()
          await restartServer()
        }
        await page.unroute('**/plugins/**')
        if(stageMediaFault)await page.unroute('**/api/dsh-asset-library/v2/lease/*/media')
        if(stageRpcFault)await page.unroute('**/api/dsh-tavern/getStageDirection')
        await page.reload({waitUntil:'domcontentloaded'})
        await page.getByRole('button',{name:'舞台',exact:true}).click()
        await page.locator('.fork-gal-stage[data-entry="ready"]').waitFor()
        if(stageMediaFault){
          await page.waitForFunction(()=>window.forkGalDebug?.stats().layers.some(layer=>!!layer.url))
          await page.keyboard.press('Escape')
          await page.getByRole('button',{name:/^背景(?:：.*)?$/}).filter({visible:true}).last().click()
          assert.equal(await page.getByRole('button',{name:'故障背景',exact:true}).getAttribute('aria-current'),'true')
          assert.equal(await page.getByRole('alert').filter({hasText:'载入失败'}).count(),0)
          await page.screenshot({path:join(output,'stage-background-recovered.png'),fullPage:true})
          await page.keyboard.press('Escape')
          report.backgroundRecovered=true
        }
        await page.keyboard.press('Escape')
        await page.getByRole('button',{name:/返回主页面/}).filter({visible:true}).last().click()
        await composer.waitFor({state:'visible'})
        assert.deepEqual(errors,[])
        report.stageRecovered=true
      }
    })
    report.status = 'passed'
    delete report.currentStep
    break scenario
  }
  // 工具提交的正文一次性落地，长正文必须从第一行开始读，而不是停在最后一行。
  if (storyToolScenario) await step('工具提交的长正文从开头显示', async () => {
    const reveal = await page.evaluate(() => {
      const scroller = document.querySelector('[data-conversation-scroll]')
      const rows = [...document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')].filter(row => row.getBoundingClientRect().height > 0 && !row.closest('[hidden]'))
      const row = rows.at(-1)
      const box = scroller.getBoundingClientRect()
      return { top: Math.round(row.getBoundingClientRect().top - box.top), height: Math.round(row.getBoundingClientRect().height),
        scrollTop: Math.round(scroller.scrollTop), floor: Math.round(scroller.scrollHeight - scroller.clientHeight) }
    })
    report.storyToolReveal = reveal
    assert.ok(reveal.height > 1500, '长正文没有渲染成整段：' + JSON.stringify(reveal))
    assert.ok(reveal.scrollTop < reveal.floor - 400, '生成完长正文后停在底部：' + JSON.stringify(reveal))
    assert.ok(reveal.top >= 0 && reveal.top <= 40, '正文开头没有对齐视口顶部：' + JSON.stringify(reveal))
  })
  if (castScenario) await step('台词显示成带头像的说话人行，刷新后仍在', async () => {
    const rows = page.locator('.dsh-tavern-cast-line').filter({ visible: true })
    for (const reload of [false, true]) {
      if (reload) await page.reload({ waitUntil: 'domcontentloaded' })
      await rows.first().waitFor({ timeout: 30000 })
      const shown = await rows.evaluateAll(items => items.map(item => ({
        name: item.querySelector('.dsh-tavern-cast-name')?.textContent, emotion: item.querySelector('.dsh-tavern-cast-emotion')?.textContent || '',
        avatar: item.querySelector('.dsh-tavern-cast-avatar')?.textContent || 'img', text: item.querySelector('.dsh-tavern-cast-body')?.textContent || '' })))
      assert.deepEqual(shown.map(row => [row.name, row.emotion, row.avatar]), [['店主', '开心', '店'], ['你', '感激', '你']])
      assert.ok(shown[0].text.includes('欢迎回来，这是你的奖励。'))
      await page.getByText('你获得了十枚金币。', { exact: false }).filter({ visible: true }).first().waitFor()
    }
    await page.screenshot({ path: join(output, 'cast-lines.png') })
    report.castLines = true
  })
  if (castScenario) await castStageChecks({ page, step, output, report })
  if (castScenario) await castSpeechChecks({ page, step, output, report })
  if (castScenario) await castCardFileChecks({ page, step, report, savedChat })
  await step('刷新后确认同一局、正文和状态均保留', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await inspectScreen()
    report.afterReload = inspectSaved(await savedChat())
    assert.deepEqual(report.afterReload, report.beforeReload)
    assert.deepEqual(errors, [], '浏览器不得出现未捕获异常')
    await page.screenshot({ path: join(output, 'after-reload.png'), fullPage: true })
  })
  if(process.argv.includes('--export-readiness'))await step('完整视图未返回时导出按钮仍可立即显示',async()=>{
    let release
    const ready=new Promise(resolve=>{release=resolve})
    const route=async request=>{await ready;await request.continue()}
    await page.route('**/api/dsh-tavern/getSession',route)
    try{
      await page.reload({waitUntil:'domcontentloaded'})
      const button=page.getByRole('button',{name:'导出',exact:true})
      await button.waitFor({timeout:5000})
      await button.click()
      await page.getByRole('menuitem',{name:'故事正文',exact:true}).waitFor({timeout:1000})
      await page.keyboard.press('Escape')
      report.exportReadiness={visibleBeforeSessionView:true}
    }finally{release();await page.unrouteAll({behavior:'wait'})}
    await inspectScreen()
  })
  if(process.argv.includes('--upgrade-save'))await step('统一升级旧会话日志与 journal 存档',async()=>{
    let history, original, legacySession
    await restartServer(async()=>{
      original=await savedChat();history=[]
      const old=createChatJournalStore({dataRoot:data})
      for(let revision=1;revision<=original._storageRevision;revision++)history.push(await old.readRevision(original.id,revision))
      assert.ok(history.every(Boolean),'夹具必须保留全部迁移前版本')
      legacySession = await installV3SaveFixture({ sessionsRoot: join(root, 'profile-data/tavern/sessions'), sessionId: original.sessionId, runtime })
      // Both sources belong only to this generated test profile.
      await rm(join(data,'chats',original.id),{recursive:true,force:true})
      const legacy=createChatJournalStore({dataRoot:data})
      for(const snapshot of history)await legacy.update(original.id,()=>snapshot)
      await legacy.flushMaintenance()
      assert.deepEqual(await legacy.read(original.id),original)
    })
    await inspectScreen()
    assert.deepEqual(await readFile(legacySession.oldFile), legacySession.bytes)
    assert.equal(parseSessionLog(await readFile(legacySession.newFile)).header.version, 4)
    const migration=page.getByRole('region',{name:'存档迁移',exact:true})
    const button=migration.getByRole('button',{name:'迁移存档',exact:true})
    await button.waitFor()
    await page.screenshot({path:join(output,'migration-before.png'),fullPage:true})
    await page.setViewportSize({width:390,height:844})
    await button.scrollIntoViewIfNeeded()
    const box=await button.boundingBox()
    assert.ok(box.x>=0&&box.x+box.width<=390,'迁移按钮在窄屏内可见')
    await page.screenshot({path:join(output,'migration-mobile.png'),fullPage:true})
    const started=Date.now()
    await button.click()
    await migration.waitFor({state:'hidden'})
    const migrated=createChatJournalStore({dataRoot:data})
    for(let i=0;i<history.length;i++)assert.deepEqual(await migrated.readRevision(original.id,i+1),history[i])
    // Live iframe diagnostics can change when the viewport changes; migration
    // history above remains byte-for-byte equivalent at each original revision.
    const story=messages=>messages.map(({displayRuntime,...message})=>message)
    assert.deepEqual(story((await migrated.read(original.id)).messages),story(original.messages))
    report.migration={status:'native',sessionVersion:4,oldSessionPreserved:true,via:'status-button',elapsedMs:Date.now()-started,retainedRevisions:history.length}
    await page.setViewportSize({width:1440,height:1000})
    await page.screenshot({path:join(output,'migration-complete.png'),fullPage:true})
    await page.reload({waitUntil:'domcontentloaded'})
    await inspectScreen()
    assert.equal(await page.getByRole('button',{name:'迁移存档',exact:true}).count(),0)
    await assertNativeStorage()
  })
  if (process.argv.includes('--settlement-performance')) {
    if(process.env.TAVERN_PERF_PROFILE==='1'){
      cpuProfiler=await context.newCDPSession(page)
      await cpuProfiler.send('Profiler.enable')
      await cpuProfiler.send('Profiler.setSamplingInterval',{interval:10000})
      await cpuProfiler.send('Profiler.start')
    }
    await settlementPerformanceChecks({page,step,savedChat,output,report,restartServer,root,data,runtime,readLog:()=>log})
  } else if (process.argv.includes('--refactor-lifecycle')) {
    await refactorLifecycleChecks({page,step,savedChat,data,output,report,restartServer})
  } else if (process.argv.includes('--mvu-incremental')) {
    await incrementalMvuChecks({page,step,savedChat,output,report,restartServer})
  } else if (process.argv.includes('--background-lifecycle')) {
    await backgroundLifecycleChecks({page,step,savedChat,data,output,report,restartServer})
  } else if (process.argv.includes('--mobile-sidebar')) {
    await mobileSidebarChecks({page,step,output,report})
  } else if (process.argv.includes('--preset-hub')) {
    await presetHubChecks({page,step,output,report})
  } else if (pinScenario) {
    await pinPanelChecks({page,step,output,report})
  } else if (displayScenario) {
    await displayRegressionChecks({page,step,savedChat,data,output,report,restartServer})
  } else if (compactionScenario) {
    const installLegacyFixture = async () => {
      const chat = await savedChat()
      let directory, storedHeader
      await restartServer(async () => {
        const sessions = join(root, 'profile-data/tavern/sessions')
        for (const { path: full } of await currentSessionLogs(sessions)) {
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
        await dropOtherGenerations(directory, 'session.jsonl.zstd')
      })
      // Startup migrates the unversioned input to the host's current format.
      const current = (await currentSessionLogs(directory)).find(log => log.directory === directory)
      assert.ok(current && current.generation > 0, '启动时把旧格式会话迁移到当前格式')
      const migrated = await readFile(current.path)
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
      await page.getByText('5 个', { exact: true }).waitFor()
      assert.deepEqual(inspectSaved(await savedChat()), report.afterReload, '生成候选不能修改正文或金币')
      const candidates = page.locator('.dsh-tavern-candidate-question')
      if (await candidates.getByTitle('展开行动列表', { exact: true }).isVisible()) await candidates.getByTitle('展开行动列表', { exact: true }).click()
      // Picking a candidate appends it to the input directly.
      await page.getByRole('button', { name: /再次领取奖励/ }).click()
      const composer = page.getByRole('textbox', { name: /发消息|Message/ })
      assert.equal(await composer.innerText(), '再次领取奖励')
      await composer.press('Enter')
      // A script reply briefly keeps a second, hidden copy of its body mounted.
      await page.getByText('你再次领取了奖励，金币累计二十枚。', { exact: true }).filter({ visible: true }).first().waitFor()
      await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: /^金币：20$/ }).waitFor()
      await inspectRound('second-turn', 20, '你再次领取了奖励，金币累计二十枚。')
    })
    await step('重新生成最新正文', async () => {
      await page.getByRole('button', { name: '重新生成正文', exact: true }).click()
      await page.getByPlaceholder('指导意见（可选）').fill('雨夜重写')
      await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
      await page.getByText('雨夜里，你重新领取了奖励。', { exact: true }).filter({ visible: true }).first().waitFor()
      await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: /^金币：30$/ }).waitFor()
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
      await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: /^金币：30$/ }).waitFor()
      const afterEdit = (await savedChat()).messages.at(-1)
      assert.deepEqual(afterEdit.variables, beforeEdit.variables, '编辑正文不能重新结算或修改变量')
      assert.deepEqual(afterEdit.mvu.receipt, beforeEdit.mvu.receipt)
      await inspectRound('edited-after-reload', 30, '手工编辑：你把奖励放进了背包。')
    })
    await step('回退最新一轮，恢复上一轮金币', async () => {
      await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
      await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).click()
      await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: /^金币：10$/ }).waitFor()
      inspectSaved(await savedChat())
      await page.reload()
      await inspectScreen()
      inspectSaved(await savedChat())
      assert.equal(await page.getByText('手工编辑：你把奖励放进了背包。', { exact: true }).count(), 0)
      await inspectRound('after-rollback', 10, '你获得了十枚金币。', 1)
    })
    if (process.argv.includes('--rollback-resettle')) {
      // Discussion #131: after a rollback, the restored latest round must be re-settleable.
      await step('回退后对新的最新一轮重新结算变量', async () => {
        const prose = chat => chat.messages.map(message => ({ role: message.role, text: message.sourceText ?? message.text }))
        const before = await savedChat()
        const receipt = page.locator('.dsh-tavern-mvu-receipt').filter({ visible: true }).last()
        report.rollbackResettle = { receiptStatus: await receipt.getAttribute('data-status') }
        await receipt.locator('summary').click()
        await receipt.getByRole('button', { name: '重新结算变量', exact: true }).click()
        await page.getByPlaceholder('例如：这轮还没有交付物品，不要扣除库存。').fill('E2E 修正金币为四十')
        await page.getByRole('button', { name: '重新结算', exact: true }).click()
        await page.frameLocator('.dsh-tavern-status-runtime iframe:not([aria-hidden="true"])').locator('#e2e-gold').filter({ hasText: /^金币：40$/ }).waitFor()
        assert.deepEqual(prose(await savedChat()), prose(before), '重新结算不能改写正文或新增轮次')
        await page.reload()
        await inspectRound('rollback-resettled', 40, '你获得了十枚金币。', 1)
      })
    } else {
    await playControls({ page, step, savedChat, inspectRound, output, report })
    await presetSwitch({ page, step, savedChat, inspectRound, output, report })
    }
  }
  if (process.argv.includes('--card-memory')) await cardMemoryChecks({ page, step, data, output, report, savedChat })
  if (process.argv.includes('--card-variables')) await cardVariableUpdateChecks({page,step,savedChat,data,output,report})
  if (process.argv.includes('--card-update')) await cardUpdateChecks({page,step,savedChat,data,output,report})
  if (process.argv.includes('--sidebar') || process.argv.includes('--sidebar-only')) await sidebarUpgrade({ page, step, savedChat, output, report })
  }
  if (process.argv.includes('--deferred-resettle')) await step('页面关闭时发起重新结算，重新打开页面后完成', async () => {
    const origin = new URL(page.url()).origin
    if (process.env.TAVERN_E2E_WARM_RETRY_FIRST === '1') {
      // A completed retry first advances the story revision, as in the server scenario.
      const before = await savedChat(), turn = before.messages.filter(message => message.role === 'assistant' && !message.greeting).at(-1)
      assert.ok((await (await context.request.post(origin + '/api/dsh-tavern/retryMvuSettlement', { data: { sessionId: before.sessionId, turn: turn.turn, guidance: 'E2E 修正金币为四十' } })).json()).ok)
      const warmStarted = Date.now()
      while (Date.now() - warmStarted < 30000) {
        const row = (await savedChat()).messages.filter(message => message.role === 'assistant' && !message.greeting).at(-1)
        if (!row.mvu?.pending && row.mvu?.receipt?.diagnosticId !== turn.mvu?.receipt?.diagnosticId) break
        await pause(250)
      }
    }
    const chat = await savedChat()
    const latest = chat.messages.filter(message => message.role === 'assistant' && !message.greeting).at(-1)
    await page.goto('about:blank')
    await pause(15000)
    const result = await (await context.request.post(origin + '/api/dsh-tavern/retryMvuSettlement', { data: { sessionId: chat.sessionId, turn: latest.turn, guidance: 'E2E 修正金币为四十' } })).json()
    assert.ok(result.ok, result.error)
    await pause(5000)
    const started = Date.now()
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
    const history = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: report.card || 'E2E 奖励验收' })
    await history.filter({ visible: true }).first().waitFor()
    if (!await page.locator('.dsh-tavern-side-row-name').first().isVisible().catch(() => false)) await history.first().click()
    await page.locator('.dsh-tavern-side-row-name').first().click()
    let settled
    while (Date.now() - started < 60000) {
      settled = (await savedChat()).messages.filter(message => message.role === 'assistant' && !message.greeting).at(-1)
      if (!settled.mvu?.pending && settled.mvu?.receipt?.diagnosticId !== latest.mvu?.receipt?.diagnosticId) break
      await pause(250)
    }
    report.deferredResettle = { ms: Date.now() - started, pending: settled.mvu?.pending === true, receipt: settled.mvu?.receipt?.status }
    assert.ok(!settled.mvu?.pending, '重新打开页面后等待中的结算应完成')
  })
  if (process.argv.includes('--server-scripts')) await step('页面在前台时由页面执行；切到后台或关页后由服务端完成结算', async () => {
    const claims = () => log.split('服务端卡脚本运行时领取事件').length - 1
    const starts = () => log.split('服务端卡脚本运行时已启动').length - 1
    assert.equal(claims(), 0, '页面在前台时不应由服务端执行')
    assert.equal(starts(), 0, '页面在前台时不应启动服务端运行时')
    const chat = await savedChat()
    const latest = chat.messages.filter(message => message.role === 'assistant' && !message.greeting).at(-1)
    const origin = new URL(page.url()).origin
    const resettle = async (before, label) => {
      const begun = Date.now(), claimedBefore = claims()
      const result = await (await context.request.post(origin + '/api/dsh-tavern/retryMvuSettlement', { data: { sessionId: chat.sessionId, turn: latest.turn, guidance: 'E2E 修正金币为四十' } })).json()
      assert.ok(result.ok, result.error)
      let row
      while (Date.now() - begun < 90000) {
        row = (await savedChat()).messages.filter(message => message.role === 'assistant' && !message.greeting).at(-1)
        if (claims() > claimedBefore && row.mvu?.receipt?.status === 'updated' && row.mvu?.receipt?.diagnosticId !== before?.receipt?.diagnosticId) break
        await pause(250)
      }
      assert.ok(claims() > claimedBefore, label + '：应由服务端领取结算事件')
      assert.equal(row.mvu.receipt.status, 'updated', label + '：应完成结算')
      return { row, ms: Date.now() - begun }
    }
    // A hidden tab hands its game to the server once its last visible report ages out.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const hiddenDeadline = Date.now() + 60000
    while (starts() === 0 && Date.now() < hiddenDeadline) await pause(500)
    assert.ok(starts() > 0, '页面切到后台后应启动服务端运行时')
    await pause(30000)
    const hidden = await resettle(latest.mvu, '页面在后台')
    await page.goto('about:blank')
    const closed = await resettle(hidden.row.mvu, '页面关闭')
    report.serverScripts = { hiddenSettleMs: hidden.ms, closedSettleMs: closed.ms }
    let settled = closed.row
    // Nobody plays this game now: its runtime stops, and a waiting settlement starts it again.
    const stopDeadline = Date.now() + 90000
    while (!log.includes('服务端卡脚本运行时已停止') && Date.now() < stopDeadline) await pause(500)
    assert.ok(log.includes('服务端卡脚本运行时已停止'), '无人游玩时服务端运行时应停止')
    const startsBefore = log.split('服务端卡脚本运行时已启动').length, coldStarted = Date.now(), coldBefore = claims(), mvuBefore = settled.mvu
    const cold = await (await context.request.post(origin + '/api/dsh-tavern/retryMvuSettlement', { data: { sessionId: chat.sessionId, turn: latest.turn, guidance: 'E2E 修正金币为四十' } })).json()
    assert.ok(cold.ok, cold.error)
    while (Date.now() - coldStarted < 60000) {
      settled = (await savedChat()).messages.filter(message => message.role === 'assistant' && !message.greeting).at(-1)
      if (claims() > coldBefore && settled.mvu?.receipt?.status === 'updated' && settled.mvu?.receipt?.diagnosticId !== mvuBefore?.receipt?.diagnosticId) break
      await pause(250)
    }
    assert.ok(log.split('服务端卡脚本运行时已启动').length > startsBefore, '等待中的结算应重新拉起服务端运行时')
    assert.ok(claims() > coldBefore, '冷启动后应由服务端执行结算')
    report.serverScripts.coldSettleMs = Date.now() - coldStarted
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  })
  if((process.argv.includes('--native-format')||process.argv.includes('--upgrade-save')) && !process.argv.includes('--opening-only'))await step('服务重启后打开同一原生存档并核对当前变量',async()=>{
    const before=await savedChat()
    await restartServer()
    const expected=[...before.messages].reverse().find(row=>row.variables?.[row.swipeId||0]).variables[0].stat_data.gold
    await page.frameLocator('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame:not([aria-hidden="true"])').locator('#e2e-gold').filter({hasText:new RegExp('^金币：'+expected+'$')}).waitFor()
    // The long-archive fixture deliberately starts with unfinished historical
    // display derivation. Restart may finish those four derived fields; story,
    // variables, receipts and every other extension field must remain identical.
    const persistentMessages=messages=>messages.map(message=>{
      const copy=structuredClone(message)
      if(process.argv.includes('--settlement-performance')&&copy.tavernPluginData){
        for(const field of ['variables_initialized','is_ejs_processed','template_display','template_rendered'])delete copy.tavernPluginData[field]
        if(!Object.keys(copy.tavernPluginData).length)delete copy.tavernPluginData
      }
      return copy
    })
    assert.deepEqual(persistentMessages((await savedChat()).messages),persistentMessages(before.messages))
    await assertNativeStorage()
    report.nativeFormat.restart=true
  })
  if (castScenario) await castStageInputChecks({ page, step, report })
  if (castScenario) await dshCardPlayChecks({ page, step, output, report })
  // Every scenario ends with the story save agreeing with what the model sees (#196).
  if (storyToolScenario) await step('正文均经 submit_story 提交', async () => {
    const submitted = (await readFile(join(output, 'story-tool.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).content)
    report.storyToolSubmissions = submitted.length
    for (const text of ['你获得了十枚金币。', '你再次领取了奖励，金币累计二十枚。', '雨夜里，你重新领取了奖励。']) assert.ok(submitted.some(content => content.startsWith(text)), text)
  })
  if (process.env.TAVERN_E2E_BROKEN_STOP !== '1' && !['--settlement-performance', '--display-regression', '--text-colors', '--opening-only'].some(flag => process.argv.includes(flag))) await step('存档与模型上下文一致', async () => {
    const chat = await savedChat().catch(() => null)
    if (!chat?.sessionId) return
    // The last round's native commit may still be landing; a real mismatch stays after the wait.
    let result
    for (let attempt = 0; attempt < 20; attempt++) {
      result = await page.evaluate(async sessionId => (await fetch('/api/dsh-tavern/storyAlignment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })).json(), chat.sessionId)
      if (result.ok === false || !result.alignment || result.alignment.aligned) break
      await page.waitForTimeout(500)
    }
    report.storyAlignment = result.alignment ?? result
    assert.ok(result.ok !== false, '核对接口失败：' + JSON.stringify(result))
    assert.ok(!result.alignment || result.alignment.aligned, '存档与模型上下文不一致：' + JSON.stringify(result.alignment))
    // Rounds played in this run record where they entered the native session.
    if (result.alignment) assert.ok(result.alignment.anchors.checked > 0 || !chat.messages.some(row => row.role === 'assistant' && !row.greeting), '新回合应记录原生锚点')
  })
  assert.deepEqual(errors, [], '整个验收不得出现未捕获浏览器异常')
  assert.doesNotMatch(log, /服务端模板进程异常|Unsupported or expired template RPC/, '验收期间模板子进程不得异常退出')
  report.status = 'passed'
  delete report.currentStep
  }
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1
  if (page) {
    if (process.argv.includes('--settlement-performance')) {
      report.failureRuntime = await Promise.race([
        Promise.all(page.frames().map(frame => frame.evaluate(() => ({
          name:window.name, mvu:typeof window.Mvu, helper:typeof window.getVariables,
          messages:window.SillyTavern?.chat?.length,
          resources:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/api/dsh-tavern/')).slice(-20).map(entry=>({method:entry.name.split('/').at(-1),durationMs:Math.round(entry.duration),bytes:entry.decodedBodySize}))
        })).catch(error=>({error:String(error.message).slice(0,150)})))),
        pause(5000).then(()=>({timeout:true}))
      ])
    }
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable')).catch(() => {})
  }
} finally {
  if(cpuProfiler){
    const captured=await Promise.race([cpuProfiler.send('Profiler.stop').catch(()=>null),pause(10000).then(()=>null)])
    if(captured?.profile)await writeFile(join(output,'browser.cpuprofile'),JSON.stringify(captured.profile))
  }
  // Read-only evidence, independent of the status iframe and its UI assertions.
  const chat = process.argv.includes('--settlement-performance') ? null : await savedChat().catch(error => { report.savedStateError = String(error.message || error); return null })
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
