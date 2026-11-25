#!/usr/bin/env node
import { connectGameplay } from './lib/api.mjs'
import { fileURLToPath } from 'node:url'
import { captureStep, backgroundChain, recordEvent, cleanError } from './lib/recording.mjs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { classifyResponse, requestChecks, refusalPatterns } from './lib/refusal.mjs'
import { loadScenario, assertions, settledTurn, selectCandidate } from './lib/scenario.mjs'
const sourceRoot = fileURLToPath(new URL('..', import.meta.url))
import { nativeResult, saveJson } from './lib/evidence.mjs'

const { values, positionals } = parseArgs({ options: { 'runtime-home': { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } }, allowPositionals: true })
if (values.help || positionals.length !== 1) {
  console.log('Usage: pnpm test:play SCENARIO.yaml [--runtime-home ~/.dsh-tavern] [--output DIRECTORY]\n真实模型请求会计费。结果保存在 testsets/results，直接调用正在运行的正式酒馆 API，仅创建独立测试会话。')
  process.exitCode = values.help ? 0 : 2
} else await main().catch(error => { console.error(String(error.message || error).replace(/https?:\/\/[^\s"']+/g, '[URL]')); process.exitCode = 1 })

async function main() {
  const parent = path.resolve(values.output || path.join(sourceRoot, 'testsets/results'))
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const runRoot = await mkdtemp(path.join(parent, 'run-'))
  let scenario
  try { scenario = await loadScenario(positionals[0]) }
  catch (error) {
    const failed = { status: 'failed', phase: 'scenario-validation', scenarioFile: path.resolve(positionals[0]), error: cleanError(error), steps: [] }
    await saveJson(path.join(runRoot, 'report.json'), failed)
    await recordEvent(path.join(runRoot, 'events.jsonl'), { type: 'run-error', ...failed })
    await writeFile(path.join(runRoot, 'report.md'), `场景配置失败：${failed.error}\n`, { mode: 0o600 })
    console.log('failed：' + path.join(runRoot, 'report.md'))
    process.exitCode = 1
    return
  }
  const patterns = refusalPatterns(scenario.refusalPatterns)
  const report = { name: scenario.name || path.basename(scenario.file), status: 'running', startedAt: new Date().toISOString(), model: scenario.model,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { windowsHide: true, cwd: sourceRoot, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { windowsHide: true, cwd: sourceRoot, encoding: 'utf8' }).trim()),
    agents: { foreground: 'not-covered', background: 'not-covered', image: 'not-covered', card: 'not-covered' }, steps: [] }
  const controller = new AbortController()
  const interrupt = () => controller.abort(new Error('测试已中断'))
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  let api, evidence, chat, active
  const log = message => console.log(message)
  const eventFile = path.join(runRoot, 'events.jsonl')
  let lastCapture = 0
  async function checkpoint(force = false) {
    if (!force && Date.now() - lastCapture < 2000) return
    lastCapture = Date.now()
    if (active?.chatId && evidence) {
      const snapshot = await captureStep({ evidence, chatId: active.chatId, sessionId: active.sessionId,
        prefix: path.join(runRoot, String(active.index).padStart(2, '0')),
        beforeRequestIds: active.beforeRequestIds, afterSeq: active.afterSeq, resources: active.role === 'card', image: active.action === 'image' })
      active.captureErrors = snapshot.errors
      if (snapshot.errors.length) await recordEvent(eventFile, { type: 'capture-errors', step: active.index, errors: snapshot.errors })
      if (active.action === 'say' && active.role === 'foreground') active.background = backgroundChain(snapshot.requests, active.backgroundRequired)
    }
    await saveJson(path.join(runRoot, 'report.json'), report)
  }
  async function poll(label, check) {
    const deadline = Date.now() + scenario.timeoutMs
    let nextUpdate = Date.now() + 30000
    while (Date.now() < deadline) {
      controller.signal.throwIfAborted()
      await checkpoint()
      const result = await check()
      if (result) return result
      if (Date.now() >= nextUpdate) { log('等待：' + label); nextUpdate = Date.now() + 30000 }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(label + '超时')
  }
  function cover(role, status) { if (report.agents[role] !== 'failed') report.agents[role] = status }
  try {
    await saveJson(path.join(runRoot, 'scenario.json'), scenario)
    await checkpoint(true)
    await recordEvent(eventFile, { type: 'run-start' })
    api = await connectGameplay({ runtimeHome: path.resolve(values['runtime-home'] || path.join(os.homedir(), '.dsh-tavern')) })
    evidence = api.evidence
    report.transport = 'production-api'
    report.settingsSource = '正式酒馆当前配置'
    if (scenario.tavernSettings) report.configurationNotes = ['案例 tavernSettings 不再覆盖正式配置；直接使用正式酒馆设置。']
    log('运行目录：' + runRoot)
    for (const [index, step] of scenario.steps.entries()) {
      controller.signal.throwIfAborted()
      active = { index: index + 1, action: step.action, input: step.input, inputFrom: step.inputFrom, status: 'running', phase: 'starting', startedAt: Date.now() }
      report.steps.push(active)
      await checkpoint(true)
      await recordEvent(eventFile, { type: 'step-start', step: active.index, action: step.action, input: step.input })
      const prefix = path.join(runRoot, String(index + 1).padStart(2, '0'))
      log(`步骤 ${index + 1}/${scenario.steps.length}：${step.action}`)
      let text = '', state = {}
      if (step.action === 'play' || step.action === 'card') {
        const result = await api.create(step, scenario.model)
        active.sessionId = result.sessionId
        chat = result.chat
        active.chatId = chat?.id
        active.modelControl = result.model
        active.requiresBrowser = result.requiresBrowser || false
        active.templateRuntime = result.templateRuntime || 'not-started'
        if (result.error) throw new Error(result.error)
        active.cardSelection = { path: chat.cardPath, imported: false, source: 'production' }
        active.card = { path: chat.cardPath, contextSha256: createHash('sha256').update(JSON.stringify(chat.cardContextSnapshot || null)).digest('hex') }
        state = chat
      } else if (step.action === 'say') {
        chat = await evidence.chat(chat.id)
        const role = chat.mode === 'card' ? 'card' : 'foreground'
        active.role = role; active.backgroundRequired = step.expect?.backgroundRequired ?? true
        active.round = report.steps.filter(s => s.action === 'say' && s.chatId === chat.id).length + 1
        active.agent = role; active.input = step.input; active.chatId = chat.id; active.sessionId = chat.sessionId
        if (step.inputFrom) {
          const previous = report.steps.slice(0, -1).findLast(s => s.action === 'say' && s.chatId === chat.id)
          active.selectedCandidate = selectCandidate(chat.candidates, step.inputFrom, previous?.candidates?.requestId)
          active.input = active.selectedCandidate.input
          await recordEvent(eventFile, { type: 'candidate-resolved', step: active.index, selection: active.selectedCandidate })
        }
        const events = await evidence.native(chat.sessionId)
        const afterSeq = events.reduce((seq, event) => Math.max(seq, Number(event.seq) || 0), 0)
        const beforeMessages = (chat.messages || []).length
        const previousRequests = new Set((await evidence.requests(chat.id)).map(r => r.id))
        active.beforeRequestIds = [...previousRequests]; active.afterSeq = afterSeq
        const beforeResources = role === 'card' ? await evidence.resources() : {}
        if (role === 'card') await saveJson(prefix + '-resources-before.json', beforeResources)
        active.phase = active.selectedCandidate ? 'candidate-selecting' : role + '-running'
        await checkpoint(true)
        const sent = await api.request('send', { sessionId: chat.sessionId, input: step.input,
          inputFrom: step.inputFrom, previousRequestId: active.selectedCandidate?.requestId })
        if (sent.input !== active.input) throw new Error('API 接受的输入与案例解析不一致')
        active.phase = role + '-running'
        await recordEvent(eventFile, { type: 'input-sent', step: active.index, round: active.round, chatId: chat.id })
        const result = await poll(role + '执行', async () => {
          const result = nativeResult(await evidence.native(chat.sessionId), afterSeq)
          if (!result.ready) return null
          if (result.error || result.reason?.kind !== 'completed') throw new Error(role + '未正常完成：' + (result.error || JSON.stringify(result.reason)))
          return result
        })
        cover(role, 'passed')
        await recordEvent(eventFile, { type: 'agent-completed', step: active.index, agent: role })
        await saveJson(prefix + '-native.json', result.events)
        if (role === 'foreground') {
          active.agent = 'background'; active.phase = 'background-settling'
          await checkpoint(true)
          const completed = await poll('后台结算落盘', async () => {
            const latest = await evidence.chat(chat.id)
            if (latest.foregroundError) throw new Error('正文执行失败')
            const progress = settledTurn(latest, beforeMessages, active.input)
            if (progress.error) throw new Error(String(progress.error))
            return progress.ready ? { chat: latest, reply: progress.reply } : null
          })
          chat = completed.chat; text = completed.reply.sourceText || completed.reply.text
          const backgroundRequests = (await evidence.requests(chat.id)).filter(r => !previousRequests.has(r.id) && r.scope === 'background')
          active.background = backgroundChain(backgroundRequests, active.backgroundRequired)
          cover('background', active.background.passed ? (backgroundRequests.length ? 'passed' : 'not-invoked') : 'failed')
          await recordEvent(eventFile, { type: 'background-settled', step: active.index, round: active.round, ...active.background })
          for (const id of new Set(backgroundRequests.map(r => r.sessionId).filter(Boolean))) {
            await saveJson(prefix + '-background-native-' + id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json', await evidence.native(id))
          }
          active.replyTurn = completed.reply.turn
          active.candidates = { status: step.candidates ? 'running' : 'not-covered' }
          if (step.candidates) {
            active.phase = 'candidate-generating'
            const previousCandidateId = chat.candidates?.requestId
            await checkpoint(true)
            await api.request('candidates', { sessionId: chat.sessionId })
            await recordEvent(eventFile, { type: 'candidate-start', step: active.index, round: active.round })
            const candidates = await poll('候选项生成与落盘', async () => {
              const latest = await evidence.chat(chat.id)
              const requests = (await evidence.requests(chat.id)).filter(r => !previousRequests.has(r.id) && r.task === 'candidate')
              if (requests.some(r => ['failed', 'cancelled'].includes(r.status))) throw new Error('候选项生成请求失败')
              const saved = latest.candidates
              if (!saved?.requestId || saved.requestId === previousCandidateId || !saved.choices?.length || !requests.length || requests.some(r => r.status !== 'completed')) return null
              return saved
            })
            chat = await evidence.chat(chat.id)
            active.candidates = { status: 'completed', count: candidates.choices.length, requestId: candidates.requestId, messageId: candidates.messageId }
            await saveJson(prefix + '-candidates.json', candidates)
            await recordEvent(eventFile, { type: 'candidate-completed', step: active.index, round: active.round, ...active.candidates })
          }
        } else {
          chat = await evidence.chat(chat.id); text = result.text
          const afterResources = await evidence.resources()
          active.changedResources = Object.keys(afterResources).filter(key => beforeResources[key]?.sha256 !== afterResources[key].sha256)
          active.deletedResources = Object.keys(beforeResources).filter(key => !afterResources[key])
          await saveJson(prefix + '-resources.json', { before: beforeResources, after: afterResources })
        }
        const requests = (await evidence.requests(chat.id)).filter(r => !previousRequests.has(r.id))
        if (role === 'foreground') active.background = backgroundChain(requests, active.backgroundRequired)
        await saveJson(prefix + '-requests.json', requests)
        active.responseChecks = requestChecks(requests, chat.mode, patterns)
        active.response = { agent: role, ...classifyResponse({ text }, patterns) }
        active.requests = requests.map(r => ({ scope: r.scope, task: r.task, status: r.status, durationMs: r.durationMs, model: r.request?.model, provider: r.request?.provider, reasoningEffort: r.request?.reasoningEffort, sessionId: r.sessionId }))
        active.agent = role
        if (!text.trim()) throw new Error('Agent 未产生正文回复')
        state = chat
        await writeFile(prefix + '-reply.md', text, { mode: 0o600 })
      } else if (step.action === 'image') {
        active.agent = 'image'; active.chatId = chat.id
        chat = await evidence.chat(chat.id)
        const previousRequests = new Set((await evidence.requests(chat.id)).map(r => r.id))
        active.beforeRequestIds = [...previousRequests]
        active.phase = 'image-running'
        await checkpoint(true)
        const before = await evidence.image(chat)
        if (before.record?.versions?.length) throw new Error('本轮已有图片；请在新的正文轮次生图')
        await api.request('image', { sessionId: chat.sessionId })
        const image = await poll('文生图 Agent 与图片保存', async () => {
          const { record } = await evidence.image(chat)
          if (record && ['failed', 'cancelled'].includes(record.status)) throw new Error(record.error || '生图失败')
          return record?.versions?.length ? record : null
        })
        await saveJson(prefix + '-image.json', image)
        const version = image.versions.at(-1)
        const { bytes, contentType } = await api.imageBytes({ sessionId: chat.sessionId, turn: String(before.target.turn), key: before.target.key, versionId: version.id })
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType.split(';')[0]] || 'image'
        active.imageFile = path.basename(prefix) + '-image.' + extension
        await writeFile(path.join(runRoot, active.imageFile), bytes, { mode: 0o600 })
        const requests = (await evidence.requests(chat.id)).filter(r => !previousRequests.has(r.id))
        await saveJson(prefix + '-requests.json', requests)
        active.requests = requests.map(r => ({ scope: r.scope, task: r.task, status: r.status, durationMs: r.durationMs, model: r.request?.model, provider: r.request?.provider, reasoningEffort: r.request?.reasoningEffort, sessionId: r.sessionId }))
        for (const id of new Set(requests.map(r => r.sessionId).filter(Boolean))) await saveJson(prefix + '-image-native-' + id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json', await evidence.native(id))
        active.imageBytes = bytes.length; active.imageModel = version.model; active.versionId = version.id
        active.responseChecks = requestChecks(requests, chat.mode, patterns)
        active.response = { agent: 'image', ...classifyResponse({ text: '' }, patterns) }
        text = image.prompt || version.prompt || ''; state = image
        cover('image', 'passed')
      }
      active.assertions = assertions(step.expect, { text, state, changedFiles: (active.changedResources || []).map(file => file.split(path.sep).join('/')) })
      if (active.background) active.assertions.push({ check: 'backgroundChain', ...active.background })
      if (active.response) active.assertions.push({ check: 'refused', expected: step.expect?.refused ?? false, actual: active.response.refused, passed: active.response.refused === (step.expect?.refused ?? false) })
      const backgroundRefusals = (active.responseChecks || []).filter(check => check.agent === 'background' && check.refused === true)
      if (backgroundRefusals.length) active.assertions.push({ check: 'backgroundRefused', passed: false, evidence: backgroundRefusals })
      const assertionFailure = active.assertions.some(item => !item.passed)
      if (assertionFailure && active.agent) cover(backgroundRefusals.length || active.background?.passed === false ? 'background' : active.agent, 'failed')
      if (chat) await saveJson(prefix + '-chat.json', await evidence.chat(chat.id))
      active.status = assertionFailure ? 'failed' : 'passed'; active.phase = 'finished'; active.durationMs = Date.now() - active.startedAt
      await checkpoint(true)
      await recordEvent(eventFile, { type: 'step-end', step: active.index, status: active.status })
      await saveJson(path.join(runRoot, 'report.json'), report)
      if (active.background?.passed === false) throw new Error('后台调用链路未完成，停止后续输入')
      if (assertionFailure && !scenario.continueOnFailure) throw new Error('场景断言失败（包括模型拒绝预期）')
    }
    report.status = report.steps.some(step => step.status === 'failed') ? 'failed' : 'passed'
    if (report.status === 'failed') process.exitCode = 1
  } catch (error) {
    report.status = controller.signal.aborted ? 'interrupted' : 'failed'
    // Auth URLs must not reach reports or terminal output.
    report.error = String(error.message || error).replace(/https?:\/\/[^\s"']+/g, '[URL]')
    await recordEvent(eventFile, { type: 'run-error', step: active?.index, phase: active?.phase, error: report.error }).catch(() => {})
    if (active) active.error = report.error
    if (active?.candidates?.status === 'running') active.candidates = { ...active.candidates, status: 'failed', error: report.error }
    if (active) { active.status = 'failed'; active.durationMs = Date.now() - active.startedAt; if (active.agent) cover(active.agent, 'failed') }
    await checkpoint(true).catch(error => { report.captureError = cleanError(error) })
    if (active?.sessionId && !active.chatId && evidence) await saveJson(path.join(runRoot, 'failure-native.json'), await evidence.native(active.sessionId)).catch(error => { report.captureError = cleanError(error) })
    if (chat && evidence) {
      await saveJson(path.join(runRoot, 'failure-chat.json'), await evidence.chat(chat.id)).catch(() => {})
      const failedRequests = await evidence.requests(chat.id).catch(() => [])
      if (active) {
        active.responseChecks = requestChecks(failedRequests.filter(r => !(active.beforeRequestIds || []).includes(r.id)), chat.mode, patterns)
        active.response ||= active.responseChecks.find(check => check.agent === active.agent && check.refused) || (active.agent ? { agent: active.agent, ...classifyResponse({ error: report.error, completed: false }, patterns) } : undefined)
      }
      await saveJson(path.join(runRoot, 'failure-requests.json'), failedRequests).catch(() => {})
      await saveJson(path.join(runRoot, 'failure-native.json'), await evidence.native(chat.sessionId)).catch(() => {})
      if (active?.action === 'image') await saveJson(path.join(runRoot, 'failure-image.json'), await evidence.image(chat)).catch(() => {})
    }
    process.exitCode = 1
  } finally {
    report.cleanupErrors = []
    if (report.status !== 'passed') {
      try { await api?.cancel() } catch (error) { report.cleanupErrors.push({ source: 'test-session', error: cleanError(error) }) }
    }
    try { await api?.close() } catch (error) { report.cleanupErrors.push({ source: 'template-browser', error: cleanError(error) }) }
    await checkpoint(true).catch(error => { report.captureError = cleanError(error) })
    if (report.cleanupErrors.length || report.captureError || report.steps.some(step => step.captureErrors?.length)) { report.status = 'failed'; process.exitCode = 1 }
    for (let index = report.steps.length; index < scenario.steps.length; index++) {
      report.steps.push({ index: index + 1, action: scenario.steps[index].action, input: scenario.steps[index].input, inputFrom: scenario.steps[index].inputFrom,
        status: 'not-run', reason: '前序步骤失败或测试中断，未发送输入' })
    }
    await recordEvent(eventFile, { type: 'run-end', status: report.status }).catch(error => { report.captureError = cleanError(error); report.status = 'failed'; process.exitCode = 1 })
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    report.finishedAt = new Date().toISOString()
    report.refusals = report.steps.flatMap(step => [...(step.response?.refused ? [{ step: step.index, ...step.response }] : []), ...(step.responseChecks || []).filter(check => check.refused).map(check => ({ step: step.index, ...check }))])
    await saveJson(path.join(runRoot, 'report.json'), report)
    const tableText = value => String(value || '').replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 100)
    const results = report.steps.flatMap(step => {
      const grouped = new Map()
      for (const check of [step.response, ...(step.responseChecks || [])].filter(Boolean)) {
        const old = grouped.get(check.agent)
        if (!old || check.refused || old.verdict === '通过' && check.verdict === '执行异常') grouped.set(check.agent, check)
      }
      if (!grouped.size) return [`| ${step.index} | ${step.role || step.agent || step.action} | ${tableText(step.input)} | ${tableText(step.error || step.reason || step.phase)} | ${step.status} |`]
      return [...grouped].map(([agent, check]) => `| ${step.index} | ${agent} | ${tableText(step.input)} | ${check.verdict} | ${step.status} |`)
    }).join('\n')
    const refusalText = report.refusals.map(check => `- 步骤 ${check.step} / ${check.agent}：${check.evidence.replaceAll('\n', ' ').slice(0, 500)}`).join('\n')
    const rows = Object.entries(report.agents).map(([agent, status]) => `| ${agent} | ${status} |`).join('\n')
    await writeFile(path.join(runRoot, 'report.md'), `# ${report.name}\n\n结果：${report.status}\n\n| Agent | 结果 |\n|---|---|\n${rows}\n\n| 步骤 | Agent | 输入 | 响应判定 | 测试结果 |\n|---|---|---|---|---|\n${results}\n\n拒绝证据（规则识别，需结合原文复核）：\n\n${refusalText || '无'}\n\n${report.error || ''}\n\n每步证据位于同目录，来源：正式酒馆 API；每次运行均新建独立测试对话。\n`, { mode: 0o600 })
    log(`${report.status}：${path.join(runRoot, 'report.md')}`)
    if (report.error) log(report.error)
  }
}
