import { compactionFailureMessage } from './compaction-failure.js'
import { RETAINED_STORY_ROUNDS } from './story-compaction.js'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { TIMELINE_MEMBERS, memberName } from './background-members.js'

const CAPACITY_WARNING = '无法取得当前模型上下文容量，自动压缩暂停；请配置模型窗口或改用轮数模式。'

export function compactionPolicy(value = {}) {
  const mode = value.mode ?? 'manual'
  const rounds = value.rounds ?? 20, percent = value.percent ?? 80
  // Story rounds kept verbatim after the summary (no settings UI; 0 restores DSH's behavior).
  const retainRounds = value.retainRounds ?? RETAINED_STORY_ROUNDS
  if (!['manual', 'rounds', 'percent'].includes(mode)) throw new Error('请选择有效的上下文压缩模式')
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 1000) throw new Error('自动压缩轮数须为 1–1000 的整数')
  if (!Number.isInteger(percent) || percent < 10 || percent > 95) throw new Error('自动压缩比例须为 10–95 的整数')
  if (!Number.isInteger(retainRounds) || retainRounds < 0 || retainRounds > 100) throw new Error('压缩保留轮数须为 0–100 的整数')
  return { mode, rounds, percent, retainRounds, revision: value.revision || 0 }
}
export function storyRoundKeys(chat) {
  return [...new Set((chat.messages || []).filter(m => m.role === 'assistant' && !m.greeting && Number.isSafeInteger(m.turn)).map(m => String(m.turn)))]
}

/** Server-owned operation; persisted side receipts prevent repeating a successful side. */
export function createAutoCompaction(deps) {
  const jobs = new Map(), reserved = new Set()
  const blocked = chat => reserved.has(chat.id) || chat.contextCompaction?.operation?.status === 'running'
  async function save(id, mutate) { return deps.updateChat(id, chat => { chat.contextCompaction = mutate(chat.contextCompaction || {}); return chat }, { source: 'compaction.server' }) }
  async function run(sessionId, options = {}) {
    // Idle manual-policy checks do not need round history. Active operations
    // and enabled policies retain the complete eligibility/recovery path below.
    if (deps.readMetadata && !options.manual) {
      const metadata = await deps.readMetadata(sessionId)
      if (!metadata || !['story', 'script'].includes(metadata.mode)) return null
      if (!jobs.has(metadata.id) && metadata.contextCompaction?.operation?.status !== 'running') {
        let policy
        try { policy = compactionPolicy(await deps.policy()) }
        catch { /* The normal job path persists policy/configuration errors. */ }
        if (policy?.mode === 'manual') return null
      }
    }
    // Eligibility uses only rounds, timeline and compaction metadata. Load full
    // history only after deciding to perform compression under the exclusive lock.
    const chat = await (deps.readState || deps.readChat)(sessionId)
    if (!chat || !['story', 'script'].includes(chat.mode)) return null
    if (jobs.has(chat.id)) {
      const active = jobs.get(chat.id)
      let result
      try { result = await active.promise } catch (error) {
        if (!options.manual || active.manual || active.performed) throw error
      }
      const needsManual = options.manual && !active.manual && !active.performed
      const retryDeferred = result?.status === 'deferred' && (options.openTurnCompact || options.manual)
      if (!needsManual && !retryDeferred) return result
      if (jobs.get(chat.id) === active) jobs.delete(chat.id)
      options.signal?.throwIfAborted()
      return run(sessionId, options)
    }
    const job = { manual: Boolean(options.manual), performed: false }
    job.promise = execute(chat, options, job)
    jobs.set(chat.id, job)
    try { return await job.promise } catch (error) {
      await save(chat.id, old => ({ ...old, warning: compactionFailureMessage(error) }))
      throw error
    } finally {
      if (jobs.get(chat.id) === job) { jobs.delete(chat.id); reserved.delete(chat.id) }
    }
  }
  async function execute(initial, options, job) {
    const signal = options.signal || new AbortController().signal
    let chat = initial, state = chat.contextCompaction || {}, policy = compactionPolicy(await deps.policy())
    // An idle manual policy has no work or baseline to maintain. In particular,
    // do not invalidate rollback's undo point with a bookkeeping-only write.
    if (!options.manual && state.operation?.status !== 'running' && policy.mode === 'manual') return null
    let rounds = storyRoundKeys(chat)
    const branch = chat.timeline?.branchId || ''
    const policyKey = JSON.stringify(policy)
    if (state.operation?.status !== 'running' && (state.policyKey !== policyKey || state.sessionId !== chat.sessionId || state.branch !== branch)) {
      chat = await save(chat.id, old => ({ ...old, sessionId: chat.sessionId, branch, policyKey, baseline: rounds, operation: null, warning: '' }))
      state = chat.contextCompaction
    }
    let operation = state.operation
    const recover = operation?.status === 'running'
    if (!options.manual && !recover) {
      // Suppress repeated failures for the same history, not all future rounds.
      if (['partial', 'failed'].includes(operation?.status)) {
        const added = rounds.filter(key => !(operation.rounds || state.baseline || []).includes(key))
        if (added.length < (policy.mode === 'rounds' ? policy.rounds : 1)) return operation
      }
      const fresh = rounds.filter(key => !(state.baseline || []).includes(key))
      if (policy.mode === 'rounds' && fresh.length < policy.rounds) return null
      if (policy.mode === 'percent') {
        const pressure = await deps.pressure(options.agent, signal, options.pendingMessages, initial.sessionId)
        if (!pressure || !Number.isFinite(pressure.percent)) {
          if (state.warning !== CAPACITY_WARNING) await save(chat.id, old => ({ ...old, warning: CAPACITY_WARNING }))
          return null
        }
        // A valid measurement restores automatic checks even below the threshold.
        // Do not erase unrelated operation failures or rewrite healthy state each tick.
        if (state.warning === CAPACITY_WARNING) {
          chat = await save(chat.id, old => ({ ...old, warning: old.warning === CAPACITY_WARNING ? '' : old.warning }))
          state = chat.contextCompaction
        }
        if (pressure.percent < policy.percent) return null
        // No useful progress since the last successful compression: do not compress in a loop.
        if (!fresh.length && operation?.status === 'completed' && pressure.percent <= (operation.afterPercent ?? pressure.percent)) return null
      }
    }
    if (!recover) {
      // Wait for preceding settlement. No reservation yet: it must be allowed to finish.
      while (true) {
        signal.throwIfAborted()
        chat = await (deps.readState || deps.readChat)(initial.sessionId)
        if (!chat) return null
        const activity = deps.activity(chat)
        if (activity.role === 'settlement' && ['pending', 'running'].includes(activity.phase) && deps.settle) {
          await deps.settle(await deps.readChat(initial.sessionId))
          await delay(50, undefined, { signal })
          continue
        }
        if (!activity.busy && !['pending', 'running'].includes(activity.phase)) break
        await delay(50, undefined, { signal })
      }
    }
    await deps.exclusive(chat.id, async () => {
      chat = await deps.readChat(initial.sessionId)
      const activity = deps.activity(chat)
      if (activity.busy || (!recover && activity.phase === 'pending')) throw new Error('后台任务刚开始，请稍后重试压缩')
      reserved.add(chat.id)
      job.performed = true
      if (!recover) {
        rounds = storyRoundKeys(chat)
        const previous = ((options.manual && ['partial', 'failed'].includes(state.operation?.status)) || state.operation?.status === 'deferred')
          && state.operation.branch === (chat.timeline?.branchId || '')
          && state.operation.revision === chat.timeline?.revision
          && JSON.stringify(state.operation.rounds) === JSON.stringify(rounds) ? state.operation : null
        async function receipt(side, target) {
          const old = previous?.[side]
          if (old?.status === 'succeeded' && previous[side + 'SessionId'] === target
            && old.after !== undefined) {
            // An unavailable side must not prevent the other side from running.
            try { if (old.after === await deps.checkpoint(target)) return old } catch {}
          }
          return { status: target ? 'pending' : 'skipped' }
        }
        operation = { id: randomUUID(), status: 'running', reason: options.manual ? 'manual' : policy.mode, startedAt: Date.now(),
          foregroundSessionId: chat.sessionId, rounds, branch: chat.timeline?.branchId || '', revision: chat.timeline?.revision,
          foreground: await receipt('foreground', chat.sessionId) }
        // Every member whose Session the save binds is compacted beside the foreground.
        for (const member of TIMELINE_MEMBERS) {
          const target = chat.timeline?.participants?.[member]?.sessionId || ''
          operation[member + 'SessionId'] = target
          operation[member] = await receipt(member, target)
        }
        await save(chat.id, old => ({ ...old, operation, warning: '' }))
      }
    })
    try {
      let deferred = false
      const saveSide = side => {
        const receipt = structuredClone(operation[side])
        return save(chat.id, old => ({ ...old, operation: { ...old.operation, [side]: receipt } }))
      }
      // An operation saved before a member existed has no side for it.
      const sides = ['foreground', ...TIMELINE_MEMBERS].filter(side => operation[side])
      // independent Sessions compact in parallel; merge receipts and drain all before releasing the reservation.
      const settled = await Promise.allSettled(sides.map(async side => {
        const target = operation[side + 'SessionId']
        if (!target || ['succeeded', 'skipped'].includes(operation[side].status)) return
        try {
          signal.throwIfAborted()
          if (operation[side].status === 'dispatching') {
            const evidence = await deps.recover(target, operation[side].before)
            if (evidence === 'succeeded') operation[side] = { status: 'succeeded', after: await deps.checkpoint(target), message: '已从原生压缩记录恢复' }
            else throw new Error('上次压缩结果未确认，请检查会话后手动重试')
          } else {
            const before = await deps.checkpoint(target)
            operation[side] = { status: 'dispatching', before }
            await saveSide(side)
            if (side !== 'foreground') await deps.markBackground(chat.id, target, side)
            const result = await deps.compact(target, side, options, signal)
            operation[side] = { status: 'succeeded', after: await deps.checkpoint(target), message: result?.message || (result ? '压缩完成' : '没有可压缩的历史') }
          }
        } catch (error) {
          // A queued player message can win the idle-maintenance race. Retry at its pre-step.
          if (side === 'foreground' && !options.manual && !options.openTurnCompact && error.code === 'busy') {
            operation.foreground = { status: 'pending' }
            deferred = true
          } else {
            operation[side] = { status: 'failed', message: compactionFailureMessage(error) }
          }
        }
        await saveSide(side)
      }))
      const rejected = settled.find(result => result.status === 'rejected')
      if (rejected) throw rejected.reason
      if (deferred) {
        operation.status = 'deferred'
        await save(chat.id, old => ({ ...old, operation: { ...old.operation, status: 'deferred' }, warning: '' }))
        return operation
      }
      const success = side => ['succeeded', 'skipped'].includes(operation[side].status)
      operation.status = sides.every(success) ? 'completed' : sides.some(side => operation[side].status === 'succeeded') ? 'partial' : 'failed'
      operation.completedAt = Date.now()
      let measurementWarning = ''
      if (policy.mode === 'percent') {
        try {
          const after = await deps.pressure(options.agent, signal, options.pendingMessages, initial.sessionId)
          if (Number.isFinite(after?.percent)) operation.afterPercent = after.percent
        } catch {
          // Measurement is advisory; even cancellation here cannot undo the
          // already committed per-side receipts or leave maintenance running.
          measurementWarning = '压缩后上下文占用测量失败，压缩结果已保存。'
        }
      }
      const failures = sides.filter(side => operation[side].status === 'failed')
        .map(side => `${side === 'foreground' ? '前台' : side === 'background' ? '后台' : '后台' + memberName(side)}：${operation[side].message}`).join('；')
      chat = await deps.readChat(initial.sessionId)
      const resultWarning = operation.status === 'completed'
        ? (operation.afterPercent >= policy.percent ? '压缩后上下文仍较高，请检查固定背景长度或选择更大窗口的模型。' : '')
        : `上下文压缩未全部完成。${failures} 请根据具体原因处理。`
      await save(chat.id, old => ({ ...old, operation: structuredClone(operation),
        ...(operation.foreground.status === 'succeeded' && operation.rounds ? { baseline: operation.rounds } : {}),
        warning: [resultWarning, measurementWarning].filter(Boolean).join(' ') }))
      return operation
    } finally { reserved.delete(chat.id) }
  }
  async function recordForeground(sessionId) {
    const chat = await (deps.readState || deps.readChat)(sessionId)
    if (!chat) return
    const policyKey = JSON.stringify(compactionPolicy(await deps.policy()))
    await save(chat.id, old => ({ ...old, sessionId, branch: chat.timeline?.branchId || '', policyKey, baseline: storyRoundKeys(chat),
      ...(old.operation?.status === 'completed' ? { operation: null, warning: '' } : {}) }))
  }
  return { run, blocked, recordForeground }
}

// Ephemeron storage lets a policy and its closures die with their engine even
// while plugin teardown still retains the returned disposer.
const installedPolicies = new WeakMap()
const installedPolicy = Symbol('tavern-compaction-policy')
function policyDisposer(reference, token) {
  return () => {
    const engine = reference.deref()
    const policies = engine && installedPolicies.get(engine)
    const policy = policies?.get(token)
    if (!policy) return
    if (engine.compactIfNeeded === policy.routed) engine.compactIfNeeded = policy.original
    if (policy.region && engine.compactRegion === policy.region) engine.compactRegion = policy.originalRegion
    if (policy.manual && engine.compactNow === policy.manual) engine.compactNow = policy.originalNow
    policies.delete(token)
    if (!policies.size) installedPolicies.delete(engine)
  }
}

/** Scope native automatic policy to bound Tavern sessions; other agents keep their host policy. */
export function installCompactionPolicy(engine, handler, { beforeRegion, selectRegion, compactNow } = {}) {
  if (!engine || typeof engine.compactIfNeeded !== 'function') throw new Error('当前 DSH 缺少自动压缩策略接口，请检查宿主版本')
  const original = engine.compactIfNeeded, originalRegion = engine.compactRegion, originalNow = engine.compactNow
  // Cordis can return different proxies for one service; the installed function is shared.
  if (original[installedPolicy]) return
  const manual = compactNow && function (agent, signal, sourceCommandId) {
    return compactNow(originalNow, agent, signal, sourceCommandId)
  }
  if (manual) engine.compactNow = manual
  if ((beforeRegion || selectRegion) && typeof originalRegion !== 'function') throw new Error('当前 DSH 缺少压缩区间保护接口')
  const region = (beforeRegion || selectRegion) && async function (start, end, agent, signal) {
    const selected = selectRegion ? await selectRegion(agent, { start, end }, signal) : { start, end }
    if (!selected) return null
    await beforeRegion?.(agent, signal)
    signal?.throwIfAborted()
    return originalRegion.call(this, selected.start, selected.end, agent, signal)
  }
  if (region) engine.compactRegion = region
  async function routed(agent, trigger, signal) {
    return handler(agent, trigger, signal, () => original.call(this, agent, trigger, signal), () => original.call(this, agent, 'context-overflow', signal))
  }
  routed[installedPolicy] = true
  engine.compactIfNeeded = routed
  let policies = installedPolicies.get(engine)
  if (!policies) installedPolicies.set(engine, policies = new Map())
  const token = Symbol('compaction-policy')
  policies.set(token, { original, routed, originalRegion, region, originalNow, manual })
  return policyDisposer(new WeakRef(engine), token)
}
