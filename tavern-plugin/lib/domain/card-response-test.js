import { settledTurn } from './gameplay-settled-turn.js'
import { selectCandidate } from './candidate-selection.js'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { classifyResponse, requestChecks } from './response-refusal.js'
import { nativeResult } from './native-turn-result.js'

// Owns only test lifetime/evidence. All gameplay goes through the production API.
export function createCardResponseTest({ api, store, chatForSession, timeoutMs = 300000, pollMs = 1000 }) {
  const active = new Map(), starting = new Set()
  const key = id => 'automation/response-' + id + '.json'
  async function save(record) { await store.writeJson(key(record.sessionId), record); return record }
  async function run(record, controller) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
    const call = (method, args = {}) => new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve().then(() => api.call(method, { sessionId: record.sessionId, ...args }))
        .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
    try {
      for (const [index, step] of record.scenario.steps.entries()) {
        const before = (await call('state')).chat
        const selection = step.inputFrom ? selectCandidate(before.candidates, step.inputFrom, record.rounds.at(-1)?.candidates?.requestId) : null
        const input = selection?.input ?? step.input
        const events = (await call('native')).events
        const afterSeq = events.reduce((seq, event) => Math.max(seq, Number(event.seq) || 0), 0)
        const previous = new Set((await call('requests')).requests.map(request => request.id))
        const round = { round: index + 1, input, selection, status: 'running', refused: null }
        record.rounds.push(round)
        await save(record)
        await call('send', step.inputFrom ? { inputFrom: step.inputFrom, previousRequestId: selection.requestId } : { input })
        while (true) {
          const result = nativeResult((await call('native')).events, afterSeq)
          if (result.ready) {
            const requests = (await call('requests')).requests.filter(request => !previous.has(request.id))
            const checks = requestChecks(requests, 'story')
            const current = await call('state')
            const settled = settledTurn(current.chat, before.messages.length, input)
            const error = current.chat.foregroundError || settled.error || result.error || (result.reason?.kind !== 'completed' ? JSON.stringify(result.reason || '未完成') : '')
            const response = classifyResponse({ text: result.text, error, completed: !error })
            const refused = [response, ...checks].find(check => check.refused === true)
            if (error || refused || (settled.ready && !current.activity?.busy)) {
              const failed = error || checks.some(check => check.refused === null) || !result.text.trim()
              Object.assign(round, {
                status: refused ? 'refused' : failed ? 'error' : 'completed',
                refused: refused ? true : failed ? null : false,
                text: result.text, checks,
                evidence: refused?.evidence || error || (!result.text.trim() ? '模型没有返回正文' : '')
              })
              await save(record)
              break
            }
          }
          await delay(pollMs, undefined, { signal })
        }
        if (round.status === 'completed' && step.candidates) {
          round.candidates = { status: 'running' }
          const oldId = (await call('state')).chat.candidates?.requestId
          await call('candidates')
          while (true) {
            const requests = (await call('requests')).requests.filter(request => !previous.has(request.id) && request.task === 'candidate')
            const checks = requestChecks(requests, 'story')
            const refused = checks.find(check => check.refused === true)
            const failed = requests.some(request => ['failed', 'cancelled'].includes(request.status))
            if (refused || failed) {
              Object.assign(round, { status: refused ? 'refused' : 'error', refused: refused ? true : null, evidence: refused?.evidence || '候选项生成失败', checks: [...round.checks, ...checks] })
              round.candidates = { status: round.status }
              break
            }
            const candidates = (await call('state')).chat.candidates
            if (candidates?.requestId && candidates.requestId !== oldId && candidates.choices?.length && requests.length && requests.every(request => request.status === 'completed')) {
              round.candidates = { ...candidates, status: 'completed' }
              round.checks.push(...checks)
              break
            }
            await delay(pollMs, undefined, { signal })
          }
          await save(record)
        }
        if (round.status !== 'completed') {
          Object.assign(record, { status: round.status, refused: round.refused, evidence: round.evidence })
          break
        }
      }
      if (record.status === 'running') Object.assign(record, { status: 'completed', refused: false })

    } catch (error) {
      Object.assign(record, { status: controller.signal.aborted ? 'cancelled' : 'error', refused: null, evidence: signal.aborted && !controller.signal.aborted ? '测试超时' : String(error.message || error) })
    } finally {
      try { await api.call('cancel', { sessionId: record.sessionId }) }
      catch (error) { record.cleanupError = String(error.message || error); record.status = 'error'; record.refused = null }
      const pending = record.rounds.find(round => round.status === 'running' || round.candidates?.status === 'running')
      if (pending) Object.assign(pending, { status: record.status, refused: record.refused, evidence: record.evidence })
      record.skippedRounds = record.scenario.steps.length - record.rounds.length
      record.finishedAt = Date.now()
      try { await save(record) } finally { active.delete(record.sessionId) }
    }
    return record
  }
  async function execute(ownerSessionId, args) {
    const chat = await chatForSession(ownerSessionId)
    if (!chat || chat.mode !== 'card') throw new Error('回复校验只能在卡片工作台中使用')
    if (args.action === 'configure') {
      if (!args.sourceCard || !args.provider || !args.model || !args.name?.trim()) throw new Error('案例需要 name、sourceCard、provider 和 model')
      if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 10) throw new Error('案例须配置 1 至 10 轮')
      let hasCandidates = false
      for (const step of args.steps) {
        if (!step || typeof step !== 'object') throw new Error('每轮须为输入配置')
        if (step.inputFrom !== undefined) {
          const from = step.inputFrom
          if (!hasCandidates || step.input !== undefined || !from || !Number.isSafeInteger(from.candidate) || from.candidate < 1 || !['action', 'scene'].includes(from.type || 'action')) throw new Error('候选输入需要上一轮生成候选，指定类型和从 1 开始的序号，不能同时提供 input')
        } else if (typeof step.input !== 'string' || !step.input.trim() || step.input.length > 4000) throw new Error('每轮输入须为 1 至 4000 字')
        if (step.candidates !== undefined && typeof step.candidates !== 'boolean') throw new Error('candidates 必须为布尔值')
        hasCandidates = step.candidates === true
      }
      if (!/^[^./\\][^/\\]*$/.test(args.sourceCard)) throw new Error('sourceCard 必须是文件名')
      const caseId = randomUUID()
      const scenario = { caseId, ownerSessionId, name: args.name.trim(), sourceCard: args.sourceCard, model: { provider: args.provider, model: args.model, ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}) }, steps: structuredClone(args.steps), timeoutMs }
      await store.writeJson('automation/cases/' + caseId + '.json', scenario)
      return { status: 'configured', scenario, note: '案例已保存，start 时才调用模型。' }
    }
    if (args.action === 'start') {
      if (starting.has(ownerSessionId) || [...active.values()].some(item => item.owner === ownerSessionId)) throw new Error('当前工作台已有测试，请先查询或停止')
      if (!/^[a-f0-9-]{36}$/.test(args.caseId || '')) throw new Error('需要 configure 返回的 caseId')
      const scenario = await store.readJson('automation/cases/' + args.caseId + '.json')
      if (!scenario || scenario.ownerSessionId !== ownerSessionId) throw new Error('该案例不属于当前工作台')
      starting.add(ownerSessionId)
      let created
      try {
        created = await api.call('create', { sourceCard: scenario.sourceCard, mode: 'story', model: scenario.model })
        const record = { sessionId: created.sessionId, chatId: created.chat?.id, ownerSessionId, scenario, model: created.model, rounds: [], startedAt: Date.now(), status: created.error ? 'error' : created.requiresBrowser ? 'unsupported' : 'running', refused: null, evidence: created.error || (created.requiresBrowser ? '此卡需要浏览器脚本运行时，未发送测试输入' : ''), note: '仅检测实际回复中的拒绝信号，不代表内容合规。拒绝或异常时停止，后续轮次未执行。' }
        await save(record)
        if (record.status !== 'running') { await api.call('cancel', { sessionId: record.sessionId }); return record }
        const controller = new AbortController()
        const item = { owner: ownerSessionId, controller }
        active.set(record.sessionId, item)
        // Capture failures so no detached rejection can crash the host.
        item.promise = run(record, controller).catch(error => ({ ...record, status: 'error', refused: null, evidence: String(error.message || error) }))
        return { ...record }
      } catch (error) {
        if (created?.sessionId) await api.call('cancel', { sessionId: created.sessionId })
        throw error
      } finally { starting.delete(ownerSessionId) }
    }
    if (!['status', 'cancel'].includes(args.action)) throw new Error('action 须为 configure、start、status 或 cancel')
    if (!/^test-[a-f0-9-]{36}$/.test(args.sessionId || '')) throw new Error('需要工具返回的测试 sessionId')
    const record = await store.readJson(key(args.sessionId))
    if (!record || record.ownerSessionId !== ownerSessionId) throw new Error('该测试不属于当前工作台')
    const item = active.get(args.sessionId)
    if (item && args.action === 'cancel') { item.controller.abort(new Error('用户停止测试')); return await item.promise }
    if (item) {
      // A bounded wait avoids encouraging rapid status polling by the card Agent.
      const wait = new AbortController()
      try { return await Promise.race([item.promise, delay(10000, undefined, { signal: wait.signal }).then(() => store.readJson(key(args.sessionId)))]) }
      finally { wait.abort() }
    }
    if (record.status === 'running') {
      await api.call('cancel', { sessionId: record.sessionId })
      return await save({ ...record, status: 'error', refused: null, evidence: '服务重启或测试任务中断，未完成校验', finishedAt: Date.now() })
    }
    return record
  }
  return { execute, dispose() { for (const item of active.values()) item.controller.abort(new Error('服务停止')) } }
}
