import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import {pathToFileURL} from 'node:url'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { encodeMigratedSessionLog, encodeCurrentGeneration, parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'

// Avoid Playwright's iframe element preview: a srcdoc containing a complete
// compatibility context can be hundreds of MB and preview formatting dominates
// the very performance this probe measures. Still inspect the real status DOM.
async function statusFrame(page) {
  // The right panel no longer opens by itself when a game opens (#213): open 酒馆状态 when it is not shown.
  if (!await page.evaluate(() => Boolean(document.querySelector('.dsh-tavern-status-runtime')))) {
    await page.getByRole('button', { name: '酒馆状态', exact: true }).filter({ visible: true }).first().click()
  }
  const handle = await page.waitForFunction(() => document.querySelector('.dsh-tavern-status-runtime iframe.dsh-tavern-message-frame:not([aria-hidden="true"])'), null, {timeout:120000})
  const frame = await handle.asElement().contentFrame(); await handle.dispose()
  assert.ok(frame, 'the mounted status frame must exist')
  return frame
}

export function settlementPerformanceInitialVariables() {
  const state = { gold: 0 }
  for (let i = 0; i < Number(process.env.TAVERN_PERF_FIELDS || 20); i++) state['perfField' + i] = { value: i, label: '合成长档状态'.repeat(6), enabled: true }
  return state
}

export async function settlementPerformanceChecks({ page, step, savedChat, output, report, restartServer, root, data, readLog, runtime }) {
  const rounds = Number(process.env.TAVERN_PERF_ROUNDS || 1000)
  const fields = Number(process.env.TAVERN_PERF_FIELDS || 20)
  const runs = Number(process.env.TAVERN_PERF_RUNS || 5)
  const append = process.env.TAVERN_PERF_APPEND === '1'
  const requireCompact = process.env.TAVERN_PERF_REQUIRE_COMPACT !== '0'
  const bodyRepeats = Number(process.env.TAVERN_PERF_BODY_REPEATS || 60)
  assert.ok(Number.isInteger(bodyRepeats) && bodyRepeats >= 1 && bodyRepeats <= 1000)
  assert.ok(Number.isInteger(rounds) && rounds >= 2 && rounds <= 10000)
  assert.ok(Number.isInteger(fields) && fields >= 0 && fields <= 2000)
  assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 100)
  const historyReady = process.env.TAVERN_PERF_HISTORY_READY === '1'
  let fixture = await savedChat()
  if (historyReady) {
    // Use flags produced by the real template engine for these exact bodies.
    // A copied flag for a different synthetic body creates a repair backlog.
    const deadline=Date.now()+60000
    while (!fixture.messages.every(row=>row.tavernPluginData?.template_rendered)) {
      assert.ok(Date.now()<deadline,'initial historical template displays must finish before cloning')
      await page.waitForTimeout(250)
      fixture=await savedChat()
    }
  }
  const chatId = fixture.id
  let size
  report.settlementPerformance = { scope: 'isolated full DSH + native Session + official MVU + active storage + React; synthetic history, fixed model; tracing disabled', requireCompact, size: { rounds, fields }, samples: [] }
  let firstWindow, historyAccess
  let automaticFullReads=0, historyReads=0
  page.on('request',request=>{
    if(request.url().endsWith('/api/dsh-tavern/getSession')) {try{if(request.postDataJSON()?.fullView)automaticFullReads++}catch{}}
    if(request.url().includes('/api/dsh-tavern/helper-history?'))historyReads++
  })
  const observeWindow=async response=>{
    if(firstWindow||!response.url().endsWith('/api/dsh-tavern/getSession'))return
    const body=await response.text().catch(()=>null)
    if(!body)return
    let payload;try{payload=JSON.parse(body)}catch{return}
    if(!payload.view?.historyWindow)return
    historyAccess=payload.view.tavernHelper?.historyAccess
    firstWindow={...payload.view.historyWindow,responseAt:Date.now(),bytes:Buffer.byteLength(body)}
    report.settlementPerformance.firstWindow=firstWindow
    await page.waitForFunction(()=>document.body?.innerText.includes('这是性能测试的合成剧情'),null,{timeout:15000}).then(()=>{firstWindow.bodyVisibleAt=Date.now()},()=>{})
  }
  page.on('response',observeWindow)
  await step(`构造 ${rounds} 轮隔离长档并重新打开`, async () => {
    const reopening = await restartServer(async () => {
      const next = structuredClone(fixture), greeting = next.messages[0], user = next.messages.find(m => m.role === 'user'), assistant = next.messages.at(-1)
      const state = structuredClone(assistant.variables[0])
      assert.equal(Object.keys(state.stat_data).length, fields + 1, 'large variable schema must come from real card initialization')
      if(historyReady)assert.ok(assistant.text.includes('这是性能测试的合成剧情，不对应真实存档。'.repeat(bodyRepeats)),'ready fixture must use actual long model output, not a short body mislabeled with bodyRepeats')
      const body = historyReady ? assistant.text : '这是性能测试的合成剧情，不对应真实存档。'.repeat(bodyRepeats) + '\n\n<StatusPlaceHolderImpl/>'
      const userBody = turn => historyReady ? user.text : '性能测试输入 ' + turn
      next.messages = [{ ...greeting, variables: [structuredClone(state)] }]
      const rows = []
      const event = (type, d, surfaceOp) => rows.push({ seq: rows.length, time: 1, type, data: d, ...(surfaceOp ? { surfaceOp } : {}) })
      for (let turn = 1; turn <= rounds; turn++) {
        event('turn/start', { turn }); event('step/start', { turn, step: 1 })
        if (turn > 1) {
          next.messages.push({ ...structuredClone(user), turn, text: userBody(turn), sourceText: userBody(turn) })
          event('user/message', { id: 'perf-u-' + turn, role: 'user', content: [{ type: 'text', text: userBody(turn) }], source: { kind: 'user' } }, 'append')
          // Each round anchors its own native input and reply, as a played save does.
          const message = { ...structuredClone(assistant), turn, text: body, sourceText: body, swipes: [body], variables: [structuredClone(state)], nativeAnchor: { turn, input: rows.length - 1, reply: rows.length } }
          message.mvuBaseline = { swipeId: 0, variables: structuredClone(state) }
          next.messages.push(message)
        }
        event('assistant/message', { turn, step: 1, message: { id: 'perf-a-' + turn, role: 'assistant', content: [{ type: 'text', text: turn === 1 ? greeting.text : body }], source: { kind: 'model', provider: 'tavern-e2e', model: 'fixed' } } }, 'append')
        event('step/end', { turn, step: 1 }); event('turn/end', { turn, reason: { kind: 'completed' } })
      }
      // Tavern records the native turn of every committed round (the latest 40); without them the
      // reconciler would take the synthetic rounds for rounds the save missed and append them again.
      next.nativeCommits = Object.fromEntries(Array.from({ length: Math.min(40, rounds - 1) }, (_, index) => rounds - index).map(turn => [String(turn), { turn, committedAt: 1 }]))
      size = { rounds, bodyRepeats, historyReady, messages: next.messages.length, variableFields: fields + 1, bytes: Buffer.byteLength(JSON.stringify(next)), snapshotBytes: Buffer.byteLength(JSON.stringify(state)) }
      report.settlementPerformance.size = size
      const estimate = value => {
        if (typeof value === 'string') return 24 + value.length * 2
        if (!value || typeof value !== 'object') return 8
        return 64 + Object.keys(value).reduce((sum, key) => sum + 24 + key.length * 2 + estimate(value[key]), 0)
      }
      size.approximateChatBytes = estimate(next)
      console.log('Long archive fixture: ' + JSON.stringify(size))
      const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: data }) })
      await persistence.write(next)
      const sessions = join(root, 'profile-data/tavern/sessions')
      let found = false
      for (const file of (await readdir(sessions, { recursive: true })).filter(x => x.endsWith('session.v3.jsonl.zstd'))) {
        const path = join(sessions, file), saved = parseSessionLog(await readFile(path))
        if (saved.header.id !== fixture.sessionId) continue
        const header = { type: 'session', delegationDepth: 0, version: 0, id: fixture.sessionId, createdAt: saved.header.createdAt, cwd: saved.header.cwd }
        if(process.argv.includes('--native-format')){
          const {sessionFormatCatalog:catalog}=await import(pathToFileURL(join(runtime,'lib/node_modules/@deepseek-ai/dsh-session-format-catalog/lib/index.js')).href)
          const restore=catalog.createRestore(header,{recovery:'recoverable',validation:'current'})
          for(const row of rows)restore.decodeRow(row)
          const artifact=restore.finish()
          assert.equal(artifact.header.version,3)
          await writeFile(path,encodeCurrentGeneration(artifact,catalog))
          await rm(join(dirname(path),'session.jsonl.zstd'),{force:true})
          size.sessionFormat=3
        }else{
          await writeFile(join(dirname(path), 'session.jsonl.zstd'), encodeMigratedSessionLog(JSON.stringify(header), rows))
          await rm(path)
          size.sessionFormat=0
        }
        found = true; break
      }
      assert.ok(found, 'synthetic Chat and native Session must have matching turn coordinates')
    })
    const statusDeadline=Date.now()+120000
    while(true) {
      const frame=await statusFrame(page)
      try {
        await frame.locator('#e2e-gold').filter({hasText:/^金币：10$/}).waitFor({timeout:Math.max(1,statusDeadline-Date.now())})
        break
      } catch(error) {
        // The runtime replaces its loading iframe during initialization.
        if(!frame.isDetached() || Date.now()>=statusDeadline)throw error
      }
    }
    if (reopening) {
      size.runtimeBootMs = reopening.bootMs
      if(firstWindow)firstWindow.sessionClickToBodyMs=firstWindow.bodyVisibleAt-reopening.openSessionStarted
      size.coldOpenToStatusMs = Date.now() - reopening.openStarted
      if(firstWindow){firstWindow.responseMs=firstWindow.responseAt-reopening.openStarted;firstWindow.bodyVisibleMs=firstWindow.bodyVisibleAt-reopening.openStarted}
    }
    if(reopening){
      const openingEvents=[...readLog().matchAll(/\[settlement-perf\](\{[^\n]+\})/g)].map(match=>JSON.parse(match[1])).filter(event=>event.at>=reopening.openStarted)
      const reads=openingEvents.filter(event=>event.stage==='scene-point-read')
      size.summaryHistoryReads=openingEvents.filter(event=>event.stage==='summary-history-read').length
      if(process.env.TAVERN_PERF_REQUIRE_BOUNDED_STATE==='1')assert.equal(size.summaryHistoryReads,0,'opening metadata checks must not scan every history summary')
      size.sceneStatusPointReads=reads.length
      size.sceneStatusFullReads=openingEvents.filter(event=>event.stage==='scene-full-read').length
      if(process.env.TAVERN_PERF_REQUIRE_SCENE_INDEX==='1'){
        assert.equal(size.sceneStatusFullReads,0,'opening image status must not scan complete history')
        assert.ok(reads.length>0&&reads.every(event=>event.count<=2),'exercise bounded image status reads')
      }
    }
    if(process.argv.includes('--history-demand')) {
      assert.equal(automaticFullReads,0,'opening must not request complete compatibility history')
      const priorReads=historyReads
      const expected=await createChatJournalStore({dataRoot:data}).readHelperContext(chatId,{from:0,to:0,revision:firstWindow.revision})
      let tested=false
      for(const frame of page.frames()) {
        if(!await frame.evaluate(()=>typeof window.getChatMessages==='function' && Boolean(window.SillyTavern?.chat)).catch(()=>false))continue
        const actual=await frame.evaluate(()=>({helper:window.getChatMessages(0)[0],variables:window.getVariables({type:'message',message_id:0}),native:window.SillyTavern.chat[0].mes}))
        assert.equal(actual.helper.message,expected.context.messages[0].message)
        assert.deepEqual(actual.variables,expected.context.messages[0].variables)
        assert.equal(actual.native,expected.context.messages[0].message)
        if(process.argv.includes('--history-demand-write')) {
          await frame.evaluate(async()=>{window.SillyTavern.chat[0].historyProbe={value:42};await window.SillyTavern.saveChat()})
          const written=await createChatJournalStore({dataRoot:data}).readSlice(chatId,[0])
          assert.deepEqual(written.chat.messages[0].tavernPluginData.historyProbe,{value:42})
          await frame.evaluate(async()=>{delete window.SillyTavern.chat[0].historyProbe;await window.SillyTavern.saveChat()})
        }
        tested=true;break
      }
      assert.ok(tested,'must exercise the real shared script iframe')
      const handle=await page.evaluateHandle(()=>{
        const node=document.createElement('iframe');node.sandbox='allow-scripts';node.srcdoc='<!doctype html><body>history probe</body>';document.body.appendChild(node);return node
      })
      const sandbox=await handle.asElement().contentFrame()
      await sandbox.waitForFunction(()=>document.body?.textContent==='history probe')
      const probe=await sandbox.evaluate(cap=>{
        function read(token){const url=new URL('/api/dsh-tavern/helper-history',document.baseURI);url.searchParams.set('cap',token);url.searchParams.set('from','0');url.searchParams.set('to','0');const xhr=new XMLHttpRequest();xhr.open('GET',url.href,false);xhr.send();return {status:xhr.status,body:JSON.parse(xhr.responseText)}}
        return {origin:window.origin,denied:read('invalid').status,allowed:read(cap)}
      },historyAccess.token)
      assert.equal(probe.origin,'null')
      assert.equal(probe.denied,403)
      assert.equal(probe.allowed.status,200)
      assert.deepEqual(probe.allowed.body.messages[0],expected.context.messages[0])
      await handle.evaluate(node=>node.remove());await handle.dispose()

      report.historyDemand={automaticFullReads,initialHistoryReads:priorReads,explicitHistoryReads:historyReads-priorReads}
    }
    if(process.argv.includes('--history-scroll')) {
      // Scrolling into old floors pages the history window back; it never asks for a complete view.
      const sessionRequests=[]
      const record=request=>{if(request.url().endsWith('/api/dsh-tavern/getSession'))try{sessionRequests.push(request.postDataJSON())}catch{}}
      page.on('request',record)
      for(let step=0;step<8;step++){
        await page.evaluate(()=>{const scroller=[...document.querySelectorAll('*')].filter(node=>node.scrollHeight>node.clientHeight+200).sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];scroller.scrollTop=0})
        await page.waitForTimeout(1500)
      }
      page.off('request',record)
      const froms=sessionRequests.map(request=>request.historyFrom).filter(Number.isSafeInteger)
      assert.ok(froms.length>0,'scrolling must request an older history page')
      assert.ok(Math.min(...froms)<firstWindow.from,'the window must move back')
      assert.equal(sessionRequests.filter(request=>request.fullView).length,0,'scrolling must not request a complete view')
      const waiting=await page.getByText('正在读取历史内容…').filter({visible:true}).count()
      report.historyScroll={requests:sessionRequests.length,oldest:Math.min(...froms),waiting}
      console.log('HISTORY-SCROLL '+JSON.stringify(report.historyScroll))
    }
    // Exclude cold initialization and allow snapshot maintenance to settle.
    await page.waitForTimeout(3000)
    if(process.env.TAVERN_PERF_REQUIRE_BOUNDED_STATE==='1') {
      const coldLog=readLog().split('dsh web:').at(-1)
      assert.doesNotMatch(coldLog, /"stage":"summary-history-read"/, 'opening and idle display diagnostics must not scan complete summary history')
    }
    if(process.argv.includes('--opening-only')) {
      const coldLog=readLog().split('dsh web:').at(-1)
      assert.doesNotMatch(coldLog, /"stage":"full-read-miss"/, 'native initialization must not materialize the complete Chat')
      assert.doesNotMatch(coldLog, /"stage":"helper-context-read"[^\n]*"full":true/, 'Helper recovery must remain bounded')
    }
  })
  const samples = []
  report.settlementPerformance = { scope: 'isolated full DSH + native Session + official MVU + active storage + React; synthetic history, fixed model; tracing disabled', requireCompact, size, samples, firstWindow }
  if(process.argv.includes('--opening-only')) {report.settlementPerformance.scope+='; opening only: settlement and second restart not exercised';return}
  for (let run = 0; run < runs; run++) await step(`长档结算采样 ${run + 1}/${runs}`, async () => {
    const gold = 100 + run
    await writeFile(join(output, 'performance-control.json'), JSON.stringify({ id: run, gold }))
    const offset = readLog().length
    const clickedAt = Date.now()
    report.settlementPerformance.activeSample = {run, clickedAt, requireCompact}
    await page.evaluate(() => {
      window.__perfSettlementObserver?.disconnect()
      window.__perfSettlement = { events: [] }
      window.__perfSettlementObserver = new MutationObserver(() => {
        const receipt = [...document.querySelectorAll('.dsh-tavern-mvu-receipt')].filter(node => node.getClientRects().length).at(-1)
        if (!receipt) return
        if (receipt.dataset.status !== 'updated') window.__perfSettlement.pendingSeen = true
        if (receipt.dataset.status === 'updated' && window.__perfSettlement.pendingSeen && !window.__perfSettlement.receiptAt) window.__perfSettlement.receiptAt = performance.timeOrigin + performance.now()
      })
      window.__perfSettlementObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-status'] })
      if (!window.__perfSettlementListening) {
        window.__perfSettlementListening = true
        addEventListener('message', event => { if (event.data?.type === 'dsh-tavern-helper-event-complete' && String(event.data.eventId).startsWith('mvu-work:')) window.__perfSettlement.events.push({ stage: 'browser-event-complete', eventId: event.data.eventId, at: performance.timeOrigin + performance.now() }) })
      }
    })
    if (append) {
      const composer = page.getByRole('textbox', {name:/发消息|Message/})
      await composer.fill('性能测试继续游玩 ' + run)
      await composer.press('Enter')
    } else {
    const receipt = page.locator('.dsh-tavern-mvu-receipt').filter({ visible: true }).last()
    if (await receipt.getAttribute('open') === null) await receipt.locator('summary').click()
    await receipt.getByRole('button', { name: '重新结算变量', exact: true }).click()
    await page.getByPlaceholder('例如：这轮还没有交付物品，不要扣除库存。').fill('性能测试：本次金币更新为 ' + gold)
    await page.getByRole('button', { name: '重新结算', exact: true }).click()
    }
    const frame = await statusFrame(page)
    const visiblePromise = frame.evaluate(gold => new Promise(resolve => {
      const node = document.querySelector('#e2e-gold')
      const check = () => { if (node.textContent === '金币：' + gold) { observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now()))) } }
      const observer = new MutationObserver(check); observer.observe(node, { subtree: true, characterData: true, childList: true }); check()
    }), gold).then(value => ({ value }), error => ({ error }))
    await frame.locator('#e2e-gold').filter({ hasText: new RegExp('^金币：' + gold + '$') }).waitFor({ timeout: 120000 })
    const observation = await visiblePromise
    if (observation.error) throw observation.error
    const visibleAt = observation.value
    await page.locator('.dsh-tavern-mvu-receipt[data-status="updated"]').filter({ visible: true }).last().waitFor()
    const receiptAt = await page.evaluate(() => window.__perfSettlement.receiptAt || null)
    // Fresh store, independent of the running server's hot cache. Read only target.
    const readStart = performance.now()
    const disk = await createChatJournalStore({ dataRoot: data }).readSlice(chatId, [size.messages - 1 + (append ? 2 * (run + 1) : 0)], 'settlement')
    assert.equal(disk.messageCount, size.messages + (append ? 2 * (run + 1) : 0), 'append must add exactly one user/assistant pair')
    const saved = disk.chat.messages[0]
    assert.equal(saved.variables[0].stat_data.gold, gold)
    assert.equal(Object.keys(saved.variables[0].stat_data).length, fields + 1)
    for (let i = 0; i < fields; i++) assert.deepEqual(saved.variables[0].stat_data['perfField' + i], { value: i, label: '合成长档状态'.repeat(6), enabled: true })
    assert.equal(saved.mvu.receipt.status, 'updated')
    assert.equal(saved.mvu.pending, false)
    const diskReadMs = performance.now() - readStart
    const events = [...readLog().slice(offset).matchAll(/\[settlement-perf\](\{[^\n]+\})/g)].map(match => JSON.parse(match[1]))
    const at = stage => events.find(x => x.stage === stage)?.at
    const submitted = at('submitted'), runtime = at('runtime-return')
    const commitStart = events.find(x=>x.stage==='commit-start' && x.at>=runtime)?.at
    const commitAt = events.find(x=>x.stage==='commit-return' && x.at>=commitStart)?.at
    assert.ok(submitted && runtime && commitStart && commitAt, 'all real settlement boundaries must be measured')
    const persisted = events.filter(x => ['journal-appended','native-head-published'].includes(x.stage) && x.source === 'background.settlement.commit' && x.at >= commitStart && x.at <= commitAt).at(-1)
    assert.ok(persisted, 'final commit must publish native head or append legacy journal')
    const persistedAt=persisted.at
    const browserEvents = await page.evaluate(() => window.__perfSettlement.events)
    const eventId = events.find(x => x.stage === 'dispatch-start')?.eventId
    const browserCompleteAt = browserEvents.find(x => x.eventId === eventId)?.at
    assert.ok(browserCompleteAt, 'observe completion of the exact MVU browser event')
    const round = n => Math.round(n * 10) / 10
    const sample = { run, append, gold, clickedAt, submittedAt: submitted, runtimeReturnedAt: runtime, commitStartedAt: commitStart, persistenceCompletedAt:persistedAt, persistenceKind:persisted.stage, ...(persisted.stage==='journal-appended'?{journalAppendedAt:persistedAt}:{}), commitAt, visibleAt, receiptAt, browserCompleteAt,
      browserToPersistenceMs: round(persistedAt - browserCompleteAt), ...(persisted.stage==='journal-appended'?{browserToJournalMs:round(persistedAt-browserCompleteAt)}:{}), browserToCommitMs: round(commitAt - browserCompleteAt), browserToVisibleMs: round(visibleAt - browserCompleteAt),
      inputToSubmitMs: round(submitted - clickedAt), inputToVisibleMs: round(visibleAt - clickedAt),
      submitToCommitMs: round(commitAt - submitted), submitToVisibleMs: round(visibleAt - submitted), runtimeToCommitMs: round(commitAt - runtime),
      runtimeToVisibleMs: round(visibleAt - runtime), commitMs: round(commitAt - commitStart), commitToVisibleMs: round(visibleAt - commitAt),
      diskReadMs: round(diskReadMs), events, browserEvents }
    samples.push(sample)
    delete report.settlementPerformance.activeSample
    console.log('PERF ' + JSON.stringify({ ...size, ...Object.fromEntries(Object.entries(sample).filter(([key]) => key.endsWith('Ms'))) }))
    await writeFile(join(output, 'settlement-performance.json'), JSON.stringify(report.settlementPerformance, null, 2))
    if (process.env.TAVERN_PERF_REQUIRE_LAZY === '1') {
      assert.ok(!events.some(event => event.stage === 'full-read-miss'), 'settlement must not read the complete Chat')
      const loads = events.filter(event => event.stage === 'settlement-history-load')
      assert.ok(loads.length > 0, 'exercise native transaction reader')
      assert.ok(loads.every(event => !event.full && event.count <= 512), 'normal settlement must keep history reads bounded')
    }
    if (append && requireCompact) {
      const contexts = events.filter(event => event.stage === 'execution-context')
      assert.ok(contexts.length > 0 && contexts.every(event => event.compact && event.messages <= 5),
        'warm append settlement must keep a bounded context without full recovery')
    }
    await page.waitForTimeout(500)
  })
  await page.screenshot({ path: join(output, 'long-archive-settled.png') })
  if (process.argv.includes('--long-operations')) await longOperationChecks({ page, step, savedChat, readLog, report })
}

// Edit, rollback and undo on the long save through the real UI. Each operation is
// timed and must not read the complete Chat; the stored result is checked directly.
async function longOperationChecks({ page, step, savedChat, readLog, report }) {
  const fullReads = offset => [...readLog().slice(offset).matchAll(/\[settlement-perf\](\{[^\n]+\})/g)].map(match => JSON.parse(match[1]))
    .filter(event => event.stage === 'full-read' || event.stage === 'full-read-miss')
  // Times the server call and the visible result; disk checks run afterwards,
  // since reading the 70MB save from the test process is not the user's wait.
  const timed = async (name, method, action, visible, verify) => {
    const offset = readLog().length, started = Date.now()
    const response = page.waitForResponse(item => item.url().endsWith('/api/dsh-tavern/' + method), { timeout: 180000 })
    await action()
    await response
    const rpcMs = Date.now() - started
    await visible()
    const ms = Date.now() - started
    await verify()
    const reads = fullReads(offset)
    report.longOperations = { ...report.longOperations, [name]: { rpcMs, ms, fullReads: reads.length } }
    console.log('LONG-OP ' + name + ' ' + JSON.stringify(report.longOperations[name]))
    // Baseline comparisons against older builds record the reads instead of failing.
    if (process.env.TAVERN_PERF_ALLOW_FULL_READS !== '1') assert.equal(reads.length, 0, name + ' must not read the complete Chat: ' + JSON.stringify(reads.map(event => event.caller?.slice(0, 4))))
  }
  const shown = text => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor()
  const gone = text => page.waitForFunction(value => ![...document.querySelectorAll('p')].some(node => node.textContent === value && node.getClientRects().length), text, { timeout: 120000 })
  const before = await savedChat()
  const edited = '长档手工编辑：最后一轮正文。'
  await step('长档编辑正文', () => timed('edit', 'saveBodyEdit', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑正文', exact: true }).click()
    const editor = page.getByRole('region', { name: '编辑正文' })
    await editor.getByRole('textbox', { name: '正文文本 1' }).fill(edited)
    await editor.getByRole('button', { name: '保存', exact: true }).click()
  }, () => shown(edited), async () => {
    const saved = await savedChat()
    assert.equal(saved.messages.length, before.messages.length)
    assert.equal(saved.messages.at(-1).sourceText, edited)
  }))
  await step('长档回退本轮', () => timed('rollback', 'rollbackTurn', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /回退第.*轮|回退本轮/ }).click()
  }, () => gone(edited), async () => {
    assert.equal((await savedChat()).messages.length, before.messages.length - 2)
  }))
  await step('长档撤销回退', () => timed('undo', 'undoRollbackTurn', async () => {
    await page.getByRole('button', { name: '更多 ▾', exact: true }).click()
    await page.getByRole('menuitem', { name: /撤销回退（恢复第/ }).click()
  }, () => shown(edited), async () => {
    const saved = await savedChat()
    assert.equal(saved.messages.length, before.messages.length)
    assert.equal(saved.messages.at(-1).sourceText, edited)
  }))
  await step('长档重新生成正文', () => timed('regenerate', 'regenBody', async () => {
    await page.getByRole('button', { name: '重新生成正文', exact: true }).click()
    await page.getByPlaceholder('指导意见（可选）').fill('长档重写')
    await page.getByRole('button', { name: '生成并替换正文', exact: true }).click()
  }, () => gone(edited), async () => {
    const saved = await savedChat()
    assert.equal(saved.messages.length, before.messages.length)
    assert.notEqual(saved.messages.at(-1).sourceText, edited)
    assert.equal(saved.regenInProgress, undefined)
    assert.deepEqual(saved.messages.slice(0, -1).map(row => row.text), before.messages.slice(0, -1).map(row => row.text))
  }))
}
