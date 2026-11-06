const IMAGE_KINDS = new Set(['dsh-tavern-image/image', 'dsh-tavern-comfy/image'])
const TERMINAL = new Set(['done', 'failed', 'cancelled'])
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000

function keyOf(input) {
  return JSON.stringify([String(input.gameId), Number(input.turn), String(input.textVersion), String(input.mediaId)])
}

function safeError(error) {
  return String(error?.message || error || '生图失败').slice(0, 500)
}

function pause(ms, signal) {
  return new Promise(resolve => {
    let timer
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

// Tavern 5's illustration card reads standard fields, not this plugin's data: mirror the
// replacement task into them (what is under way, which buttons apply).
// The picture's own 重画 covers a plain retry; only a request the platform may still be running needs
// more: look it up, or redraw anyway once the player accepts a possible second charge.
const UNSETTLED_ACTIONS = [{ id: 'recover', label: '查询结果' }, { id: 'force-redraw', label: '仍然重画', confirm: '上一次请求可能仍在生图平台上处理，现在重画可能重复扣费。确定重画？' }]
export function withTaskFields(changes) {
  const replacement = changes?.data?.replacement
  const state = replacement?.state
  if (state === 'pending') return { ...changes, activity: { label: '重画中', progress: null, cancellable: true }, actions: [] }
  const unsettled = state === 'uncertain' || (state === 'cancelled' && (replacement.cancelMayHaveContinued === true || replacement.requestStarted === true))
  if (unsettled) return { ...changes, activity: null, actions: UNSETTLED_ACTIONS }
  if (['failed', 'cancelled', 'ready'].includes(state)) return { ...changes, activity: null, actions: changes.status === 'failed' ? [{ id: 'retry', label: '重试' }] : [] }
  return changes
}

/**
 * Per-media redraw/retry actions. This service only mutates plugin-owned media
 * through Tavern's public API; the source image stays visible until replacement
 * bytes have been saved and update() succeeds.
 */
export function createMediaActions({
  tavern, attachments, getJob, refreshJob, startReplacement, revisePrompt, cancelJob, readFileAsBytes,
  logger, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = 700,
} = {}) {
  const tasks = new Map()
  const recovering = new Map()
  const host = tavern
  tavern = host && { ...host, getTurn: host.getTurn?.bind(host), list: host.list?.bind(host), update: host.update && ((id, changes) => host.update(id, withTaskFields(changes))) }
  const log = (message, error) => { try { logger?.warn?.('dsh-tavern-image[单图操作]: ' + message + (error ? '：' + safeError(error) : '')) } catch {} }
  let disposed = false

  function assertAvailable() {
    if (disposed) throw new Error('插件已卸载')
    if (!tavern?.getTurn || !tavern?.list || !tavern?.update) throw new Error('当前 Tavern 缺少单图操作所需的公开媒体接口')
    if (typeof startReplacement !== 'function' || typeof getJob !== 'function' || typeof readFileAsBytes !== 'function' || typeof attachments?.saveImage !== 'function') {
      throw new Error('单图重绘服务尚未就绪')
    }
  }

  async function readJob(jobId) {
    try { return await getJob(jobId) } catch { return null }
  }

  async function locate(input) {
    const { gameId, turn, textVersion, mediaId } = input
    if (typeof gameId !== 'string' || !gameId || !Number.isSafeInteger(Number(turn)) || Number(turn) < 1
      || typeof textVersion !== 'string' || !textVersion || typeof mediaId !== 'string' || !mediaId) {
      throw new Error('缺少有效的 gameId、turn、textVersion 或 mediaId')
    }
    const snapshot = await tavern.getTurn({ gameId, turn: Number(turn) })
    if (!snapshot || snapshot.textVersion !== textVersion) throw Object.assign(new Error('正文版本已变化，不能操作旧图片'), { code: 'STALE_VERSION' })
    const items = await tavern.list({ gameId, turn: Number(turn) }) || []
    const item = items.find(value => value.id === mediaId)
    if (!item || !IMAGE_KINDS.has(item.kind) || Number(item.turn) !== Number(turn) || item.textVersion !== textVersion) {
      throw Object.assign(new Error('图片不存在、不属于本插件，或不属于当前正文版本'), { code: 'MEDIA_NOT_FOUND' })
    }
    return { snapshot, item }
  }

  async function assertLive(task) {
    task.controller.signal.throwIfAborted()
    if (disposed) throw new Error('插件已卸载')
    const { gameId, turn, textVersion } = task.input
    const snapshot = await tavern.getTurn({ gameId, turn: Number(turn) })
    task.controller.signal.throwIfAborted()
    if (!snapshot || snapshot.textVersion !== textVersion) {
      task.controller.abort(new Error('正文版本已变化，停止旧图发布'))
      task.controller.signal.throwIfAborted()
    }
    const items = await tavern.list({ gameId, turn: Number(turn) }) || []
    const current = items.find(value => value.id === task.input.mediaId)
    if (!current || !IMAGE_KINDS.has(current.kind) || current.textVersion !== textVersion) {
      task.controller.abort(new Error('图片已删除或版本已变化，停止旧图发布'))
      task.controller.signal.throwIfAborted()
    }
    if (current.data?.replacement?.jobId !== task.jobId) {
      task.controller.abort(new Error('单图操作已被更新的请求替代'))
      task.controller.signal.throwIfAborted()
    }
    return current
  }

  async function writeState(task, state, patch = {}) {
    const item = await assertLive(task)
    const data = { ...(item.data || {}), replacement: { ...(item.data?.replacement || {}), jobId: task.jobId, state, ...patch } }
    await tavern.update(item.id, { data, ...(patch.error ? { error: String(patch.error).slice(0, 500) } : {}) })
  }

  async function finishFailure(task, state, error) {
    const message = safeError(error)
    try {
      const item = await assertLive(task)
      const data = { ...(item.data || {}), replacement: { ...(item.data?.replacement || {}), jobId: task.jobId, state, error: message } }
      await tavern.update(item.id, { data, error: message, ...(item.attachment ? { status: 'ready' } : { status: 'failed' }) })
    } catch (updateError) {
      if (!task.controller.signal.aborted) log('无法写入单图任务结果', updateError)
    }
  }

  async function finishStopped(task) {
    if (task.cancelOutcomeUncertain) return
    const reason = safeError(task.controller.signal.reason || '任务已停止')
    try {
      const items = await tavern.list({ gameId: task.input.gameId, turn: Number(task.input.turn) }) || []
      if (task.cancelOutcomeUncertain) return
      const item = items.find(value => value.id === task.input.mediaId)
      if (!item || item.data?.replacement?.jobId !== task.jobId) return
      if (item.data?.replacement?.state === 'uncertain') return
      await tavern.update(item.id, {
        ...(item.attachment ? { status: 'ready' } : { status: 'failed' }),
        data: { ...(item.data || {}), replacement: { ...item.data.replacement, state: 'cancelled', error: reason } },
      })
    } catch (error) { log('无法记录已停止的单图任务', error) }
  }

  async function waitForJob(task) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await assertLive(task)
      let job
      try { job = await getJob(task.jobId) } catch (error) { throw Object.assign(new Error(safeError(error)), { uncertain: true }) }
      if (!job) throw Object.assign(new Error('查不到新作业状态；请先到生图平台确认，不能自动重发'), { uncertain: true })
      if (job.state === 'uncertain' || job.requestMayHaveSucceeded === true) {
        throw Object.assign(new Error(job.error || '作业提交结果未知；请先到生图平台确认，不能自动重发'), { uncertain: true })
      }
      if (TERMINAL.has(job.state)) return job
      if (!['pending', 'running', 'queued', 'processing'].includes(job.state)) {
        throw Object.assign(new Error('作业返回未知状态；请先到生图平台确认，不能自动重发'), { uncertain: true })
      }
      await pause(pollMs, task.controller.signal)
    }
    throw Object.assign(new Error('等待作业超时；请先到生图平台确认，不能自动重发'), { uncertain: true })
  }

  async function run(task) {
    try {
      await writeState(task, 'pending', { startedAt: Date.now(), error: '' })
      const job = await waitForJob(task)
      if (job.state !== 'done' || !job.file) {
        await finishFailure(task, job.state === 'cancelled' ? 'cancelled' : 'failed', job.error || '生图失败')
        return
      }
      const bytes = await readFileAsBytes(job.file)
      await assertLive(task)
      const mediaType = String(job.mediaType || 'image/png').split(';')[0].toLowerCase()
      const ext = ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/png': 'png' })[mediaType] || 'png'
      const attachment = await attachments.saveImage({ data: bytes, mediaType, name: 'tavern-comfy-' + task.jobId.slice(0, 8) + '.' + ext })
      const current = await assertLive(task)
      const data = {
        ...(current.data || {}), jobId: task.jobId,
        ...(job.channelId || task.input.channelId ? { channelId: job.channelId || task.input.channelId } : {}),
        replacement: { ...(current.data?.replacement || {}), jobId: task.jobId, state: 'ready', error: '', finishedAt: Date.now() },
      }
      await tavern.update(current.id, { status: 'ready', attachment, progress: 1, error: '', data, prompt: String(job.params?.rawTag || job.params?.tag || job.positive || task.input.prompt || '').slice(0, 12000) })
    } catch (error) {
      if (!task.controller.signal.aborted) await finishFailure(task, error?.uncertain ? 'uncertain' : 'failed', error)
      else await finishStopped(task)
    } finally {
      if (tasks.get(task.key) === task) tasks.delete(task.key)
    }
  }

  async function start(input, item) {
    const data = item.data || {}
    const existing = data.replacement
    if (input.operation === 'retry' && existing) {
      input = { ...input, generationMode: input.generationMode ?? existing.generationMode, refreshReferences: input.refreshReferences ?? (existing.jobId ? false : existing.refreshReferences),
        prompt: input.prompt ?? existing.prompt, characters: input.characters ?? existing.characters, negative: input.negative ?? existing.negative, channelId: input.channelId ?? existing.channelId }
    }
    // 玩家点了「仍然重画」：接受可能重复扣费，不再被上一次未确认的请求卡住。
    const accepted = input.operation === 'redraw' && input.confirmUncertain === true
    if (existing?.state === 'pending' || (existing?.state === 'uncertain' && !accepted)) {
      if (existing.state === 'uncertain') throw Object.assign(new Error('该图片上一次请求结果未知，请先确认生图平台；为避免重复扣费，暂不自动重试'), { code: 'UNCERTAIN' })
      if (existing.operation && (existing.operation !== input.operation || (existing.prompt || '') !== (input.prompt || '')
        || (existing.negative || '') !== (input.negative || '') || (existing.channelId || '') !== (input.channelId || '')
        || (existing.generationMode ?? '') !== (input.generationMode ?? '') || Boolean(existing.refreshReferences) !== Boolean(input.refreshReferences))) {
        throw Object.assign(new Error('这张图片已有不同的重绘任务正在运行'), { code: 'ACTION_BUSY' })
      }
      const job = await readJob(existing.jobId)
      if (!job || job.state === 'uncertain' || job.requestMayHaveSucceeded === true) {
        await tavern.update(item.id, { data: { ...data, replacement: { ...existing, state: 'uncertain', error: '查不到作业状态；请先到生图平台确认，不能自动重发' } } })
        throw Object.assign(new Error('查不到作业状态；请先到生图平台确认，不能自动重发'), { code: 'UNCERTAIN' })
      }
      const key = keyOf(input)
      let task = tasks.get(key)
      if (!task) {
        task = { key, input, jobId: existing.jobId, controller: new AbortController() }
        tasks.set(key, task)
        task.promise = run(task)
      }
      return { ok: true, jobId: existing.jobId, mediaId: item.id, state: 'pending' }
    }
    const sourceJobId = String(data.jobId || input.jobId || '')
    if (!sourceJobId) throw new Error('找不到原始作业号，不能重绘或重试')
    const sourceJob = await readJob(sourceJobId)
    const latestJob = existing?.jobId && existing.jobId !== sourceJobId ? await readJob(existing.jobId) : sourceJob
    // Refusing marks the picture unsettled, so its card offers 查询结果 / 仍然重画 instead of a dead end.
    const refuseUnsettled = async message => {
      try { await tavern.update(item.id, { data: { ...data, replacement: { ...(existing || {}), state: 'uncertain', error: message } } }) } catch {}
      throw Object.assign(new Error(message), { code: 'UNCERTAIN' })
    }
    if (!accepted && [sourceJob, latestJob].some(job => job?.state === 'cancelled' && (job.requestStarted === true || job.cancelMayHaveContinued === true))) {
      await refuseUnsettled('取消时平台请求可能仍在处理；可以先查询结果，或确认后仍然重画')
    }
    if (!accepted && (sourceJob?.state === 'uncertain' || sourceJob?.requestMayHaveSucceeded === true)) {
      await refuseUnsettled('原作业提交结果未知；可以先查询结果，或确认后仍然重画')
    }
    if (input.operation === 'retry' && !['failed', 'cancelled'].includes(existing?.state) && item.status !== 'failed') {
      throw new Error('只有已确认失败或已取消的单图任务可以重试')
    }
    const localRejected = existing?.submissionNotStarted === true && !existing?.jobId
    if (input.operation === 'retry' && !localRejected) {
      if (data.cancelMayHaveContinued === true) {
        throw Object.assign(new Error('取消时请求可能已提交到生图平台；请先确认平台结果，不能安全地重试'), { code: 'UNCERTAIN' })
      }
      const retryJobId = existing?.jobId || sourceJobId
      try { await refreshJob?.(retryJobId) } catch (error) { log('刷新旧作业状态失败，继续按本地已知状态判断', error) }
      const retryJob = await readJob(retryJobId)
      if (!retryJob || retryJob.state === 'uncertain' || retryJob.requestMayHaveSucceeded === true
        || (retryJob.state === 'cancelled' && retryJob.requestStarted === true)
        || !['failed', 'cancelled'].includes(retryJob.state)) {
        throw Object.assign(new Error('找不到可确认失败的作业；为避免重复扣费，暂不能重试'), { code: 'UNCERTAIN' })
      }
    }
    if (input.operation === 'retry' && (input.jobId !== sourceJobId && input.jobId !== existing?.jobId)) {
      throw Object.assign(new Error('作业号与这张图片当前记录不匹配'), { code: 'JOB_MISMATCH' })
    }
    const key = keyOf(input)
    const dedupe = JSON.stringify([key, input.operation, sourceJobId, input.prompt || '', input.negative || '', input.characters || [], input.channelId || '', input.generationMode ?? '', input.refreshReferences === true])
    let task = tasks.get(key)
    if (task) {
      if (task.dedupe !== dedupe) throw Object.assign(new Error('这张图片已有不同的重绘任务正在运行'), { code: 'ACTION_BUSY' })
      if (task.startPromise) await task.startPromise
      return { ok: true, jobId: task.jobId, mediaId: item.id, state: 'pending' }
    }
    const controller = new AbortController()
    const taskInput = { ...input, turn: Number(input.turn) }
    const taskBase = { key, input: taskInput, sourceJobId, controller, dedupe, jobId: '', startPromise: null }
    tasks.set(key, taskBase)
    taskBase.startPromise = (async () => {
      // Start has a timeout boundary: a lost reply is not evidence that no request was paid.
      let startTimer
      let started
      try {
        started = await Promise.race([
          Promise.resolve().then(() => startReplacement({
            sourceJobId: input.operation === 'retry' && existing?.jobId ? existing.jobId : sourceJobId,
            prompt: input.prompt, characters: input.characters, negative: input.negative, channelId: input.channelId,
            sessionId: input.gameId, turn: Number(input.turn), textVersion: input.textVersion, acceptUncertain: accepted,
            generationMode: input.generationMode, refreshReferences: input.refreshReferences === true,
          })),
          new Promise((_resolve, reject) => { startTimer = setTimeout(() => reject(Object.assign(new Error('提交作业超时；请到生图平台确认，不能安全地自动重发'), { uncertain: true })), 60000) }),
        ])
      } catch (error) {
      if (error?.submissionNotStarted === true) {
          try { await tavern.update(item.id, { data: { ...data, replacement: { jobId: '', state: 'failed', submissionNotStarted: true, error: safeError(error), prompt: input.prompt || '', characters: input.characters || [], negative: input.negative || '', channelId: input.channelId || '', generationMode: input.generationMode, refreshReferences: input.refreshReferences === true } } }) } catch {}
          error.code ||= 'REJECTED'
          throw error
        }
        const unknownId = 'unknown-' + Date.now().toString(36)
        taskBase.jobId = unknownId
        try { await tavern.update(item.id, { data: { ...data, replacement: { jobId: unknownId, state: 'uncertain', error: safeError(error), prompt: input.prompt || '', characters: input.characters || [], negative: input.negative || '', channelId: input.channelId || '', generationMode: input.generationMode, refreshReferences: input.refreshReferences === true } } }) } catch {}
        throw Object.assign(new Error(safeError(error)), { code: 'UNCERTAIN' })
      } finally { clearTimeout(startTimer) }
      const jobId = String(started?.jobId || started?.id || '')
      if (!jobId) {
        const unknownId = 'unknown-' + Date.now().toString(36)
        taskBase.jobId = unknownId
        await tavern.update(item.id, { data: { ...data, replacement: { jobId: unknownId, state: 'uncertain', error: '提交结果未知；请到生图平台确认，不能自动重发' } } })
        throw Object.assign(new Error('提交结果未知；请到生图平台确认，不能自动重发'), { code: 'UNCERTAIN' })
      }
      const { item: latest } = await locate(taskInput)
      if (latest.id !== item.id || latest.data?.jobId !== data.jobId) {
        try { await cancelJob?.(jobId) } catch {}
        throw Object.assign(new Error('图片记录已变化，拒绝发布旧请求结果'), { code: 'STALE_MEDIA' })
      }
      taskBase.jobId = jobId
      await tavern.update(item.id, { data: { ...data, replacement: { jobId, state: 'pending', operation: input.operation, sourceJobId, prompt: input.prompt || '', characters: input.characters || [], negative: input.negative || '', channelId: input.channelId || '', generationMode: input.generationMode, refreshReferences: input.refreshReferences === true, startedAt: Date.now() } } })
      return jobId
    })()
    let jobId
    try { jobId = await taskBase.startPromise }
    catch (error) {
      if (tasks.get(key) === taskBase) tasks.delete(key)
      throw error
    }
    taskBase.startPromise = null
    taskBase.promise = run(taskBase)
    return { ok: true, jobId, mediaId: item.id, state: 'pending' }
  }

  async function recover(input, item) {
    const previous = item.data?.replacement
    const jobId = String(previous?.jobId || item.data?.jobId || '')
    if (!jobId || jobId.startsWith('unknown-')) throw Object.assign(new Error('没有可只读查询的作业号，请到生图平台手动检查'), { code: 'UNCERTAIN' })
    if (input.jobId && input.jobId !== jobId) throw Object.assign(new Error('作业号与这张图片当前记录不匹配'), { code: 'JOB_MISMATCH' })
    const key = keyOf(input)
    const existingTask = tasks.get(key)
    if (existingTask) return { ok: true, jobId, mediaId: item.id, state: 'pending' }
    let job = await readJob(jobId)
    if (!job) throw Object.assign(new Error('查不到此作业的本地状态；请到生图平台手动检查'), { code: 'UNCERTAIN' })
    if (['uncertain', 'pending', 'running', 'queued', 'processing'].includes(job.state) || (job.state === 'cancelled' && (job.requestStarted || job.cancelMayHaveContinued))) {
      try { await refreshJob?.(jobId, { recoverCancelled: true }) }
      catch (error) {
        log('只读刷新作业状态失败', error)
        if (job.state === 'cancelled') throw error
      }
      job = await readJob(jobId) || job
    }
    assertAvailable()
    const current = (await locate(input)).item
    if (String(current.data?.replacement?.jobId || current.data?.jobId || '') !== jobId) {
      throw Object.assign(new Error('查询期间图片任务已变化，请重新打开这张图'), { code: 'JOB_MISMATCH' })
    }
    item = current
    if (tasks.has(key)) return { ok: true, jobId, mediaId: item.id, state: 'pending' }
    if (['failed', 'cancelled'].includes(job.state)) {
      const message = String(job.error || (job.state === 'cancelled' ? '已取消' : '生图失败'))
      await tavern.update(item.id, {
        ...(item.attachment ? { status: 'ready' } : { status: 'failed', error: message }),
        data: { ...item.data, ...(job.state === 'failed' ? { cancelled: false, cancelMayHaveContinued: false } : {}), replacement: { ...(previous || {}), jobId, state: job.state === 'cancelled' ? 'cancelled' : 'failed', operation: 'recover', requestStarted: job.requestStarted === true, cancelMayHaveContinued: job.state === 'cancelled' && (job.requestStarted === true || job.cancelMayHaveContinued === true), error: message } },
      })
      return { ok: true, jobId, mediaId: item.id, state: job.state === 'cancelled' ? 'cancelled' : 'failed', requestStarted: job.requestStarted === true, cancelMayHaveContinued: job.state === 'cancelled' && (job.requestStarted === true || job.cancelMayHaveContinued === true) }
    }
    const task = { key, input, jobId, controller: new AbortController() }
    tasks.set(key, task)
    await tavern.update(item.id, {
      data: { ...item.data, replacement: { ...(previous || {}), jobId, operation: 'recover', state: 'pending', error: '' } },
    })
    task.promise = run(task)
    return { ok: true, jobId, mediaId: item.id, state: 'pending' }
  }

  async function cancel(input, item) {
    const replacement = item.data?.replacement
    const replacementPending = ['pending', 'running', 'uncertain'].includes(replacement?.state)
    const initialCandidate = !replacement && Boolean(item.data?.jobId)
    const jobId = String(replacementPending ? replacement?.jobId || '' : initialCandidate ? item.data?.jobId || '' : '')
    if (!jobId || (input.jobId && input.jobId !== jobId)) {
      return { ok: true, mediaId: item.id, jobId: jobId || null, state: replacement?.state || item.status }
    }
    let job = await readJob(jobId)
    if (!job) {
      if (replacementPending) await tavern.update(item.id, { data: { ...item.data, replacement: { ...replacement, state: 'uncertain', error: '查不到作业状态；请检查生图平台' } } })
      return { ok: true, mediaId: item.id, jobId, state: 'uncertain' }
    }
    if (job.state === 'done') return { ok: true, mediaId: item.id, jobId, state: 'done' }
    if (job.state === 'uncertain' || job.requestMayHaveSucceeded === true) {
      const message = job.error || '请求结果未知；请检查生图平台，不能确认已停止'
      if (replacementPending) await tavern.update(item.id, { data: { ...item.data, replacement: { ...replacement, state: 'uncertain', error: message } } })
      else await tavern.update(item.id, { error: message, data: { ...item.data, error: message } })
      return { ok: true, mediaId: item.id, jobId, state: 'uncertain' }
    }
    if (!['pending', 'running', 'queued', 'processing'].includes(job.state)) {
      return { ok: true, mediaId: item.id, jobId, state: job.state }
    }
    const key = keyOf(input)
    const task = tasks.get(key)
    await locate(input)
    const requestStarted = job.requestStarted === true
    let result
    try { result = await cancelJob?.(jobId) } catch (error) {
      const message = '取消结果未知：' + safeError(error) + '；请检查生图平台，不能确认已停止'
      if (task) {
        task.cancelOutcomeUncertain = true
        task.controller.abort(new Error(message))
      }
      if (replacementPending) await tavern.update(item.id, { data: { ...item.data, replacement: { ...replacement, state: 'uncertain', requestStarted, cancelMayHaveContinued: requestStarted, error: message } } })
      else await tavern.update(item.id, { error: message, data: { ...item.data, error: message, requestStarted, cancelMayHaveContinued: requestStarted } })
      return { ok: true, mediaId: item.id, jobId, state: 'uncertain' }
    }
    job = await readJob(jobId)
    if (job?.state === 'uncertain' || job?.requestMayHaveSucceeded === true) {
      const message = job.error || '取消结果未知；请检查生图平台'
      if (task) {
        task.cancelOutcomeUncertain = true
        task.controller.abort(new Error(message))
      }
      if (replacementPending) await tavern.update(item.id, { data: { ...item.data, replacement: { ...replacement, state: 'uncertain', requestStarted, cancelMayHaveContinued: requestStarted, error: message } } })
      else await tavern.update(item.id, { error: message, data: { ...item.data, error: message, requestStarted, cancelMayHaveContinued: requestStarted } })
      return { ok: true, mediaId: item.id, jobId, state: 'uncertain' }
    }
    const explicitlyCancelled = job?.state === 'cancelled' || result?.state === 'cancelled' || result?.cancelled === true
    const explicitlyFailed = job?.state === 'failed' || result?.state === 'failed'
    if (!explicitlyCancelled && !explicitlyFailed) {
      const message = '取消结果尚未确认；请检查生图平台'
      if (task) {
        task.cancelOutcomeUncertain = true
        task.controller.abort(new Error(message))
      }
      if (replacementPending) await tavern.update(item.id, { data: { ...item.data, replacement: { ...replacement, state: 'uncertain', requestStarted, cancelMayHaveContinued: requestStarted, error: message } } })
      else await tavern.update(item.id, { error: message, data: { ...item.data, error: message, requestStarted, cancelMayHaveContinued: requestStarted } })
      return { ok: true, mediaId: item.id, jobId, state: 'uncertain' }
    }
    const state = explicitlyCancelled ? 'cancelled' : 'failed'
    const mayContinue = requestStarted || job?.requestStarted === true
    task?.controller.abort(new Error(explicitlyCancelled ? '已取消' : '生图失败'))
    const message = explicitlyCancelled
      ? mayContinue ? '本地已停止等待；请求可能已提交到生图平台，平台仍可能继续生成并产生费用' : '已取消'
      : String(job?.error || result?.error || '生图失败')
    if (replacementPending) {
      await tavern.update(item.id, {
        ...(item.attachment ? { status: 'ready' } : { status: 'failed', error: message }),
        data: { ...item.data, replacement: { ...replacement, state, requestStarted: requestStarted || job?.requestStarted === true, cancelMayHaveContinued: explicitlyCancelled && mayContinue, error: message } },
      })
    } else {
      await tavern.update(item.id, {
        ...(item.attachment ? { status: 'ready' } : { status: 'failed', error: message }),
        data: { ...item.data, cancelled: explicitlyCancelled, cancelMayHaveContinued: explicitlyCancelled && mayContinue, error: message },
        ...(item.attachment ? { error: message } : {}),
      })
    }
    return { ok: true, mediaId: item.id, jobId, state, requestStarted: mayContinue, cancelMayHaveContinued: explicitlyCancelled && mayContinue }
  }

  async function handle(input = {}) {
    assertAvailable()
    if (!['redraw', 'revise', 'retry', 'cancel', 'recover'].includes(input.operation)) throw new Error('operation 必须是 redraw、revise、retry、cancel 或 recover')
    const normalized = { ...input, turn: Number(input.turn) }
    const { item } = await locate(normalized)
    // 重新整理提示词：先按意见改写这张图的提示词，再像改提示词一样重画。
    if (input.operation === 'revise') {
      if (typeof revisePrompt !== 'function') throw new Error('当前插件不支持重新整理提示词')
      const sourceJob = await readJob(String(item.data?.replacement?.jobId || item.data?.jobId || ''))
      const prompt = String(item.prompt || sourceJob?.promptText || sourceJob?.params?.rawTag || sourceJob?.params?.tag || sourceJob?.positive || '')
      const characters = Array.isArray(sourceJob?.params?.characters) ? sourceJob.params.characters : []
      await tavern.update(item.id, { activity: { label: '整理提示词', progress: null, cancellable: false } })
      let revised
      try { revised = await revisePrompt({ prompt, characters, instruction: input.instruction, sessionId: normalized.gameId, turn: normalized.turn }) }
      finally { await tavern.update(item.id, { activity: null }).catch(() => {}) }
      return start({ ...normalized, operation: 'redraw', prompt: revised, characters }, (await locate(normalized)).item)
    }
    if (input.jobId && input.jobId !== item.data?.jobId && input.jobId !== item.data?.replacement?.jobId) {
      throw Object.assign(new Error('作业号与所选图片不匹配'), { code: 'JOB_MISMATCH' })
    }
    if (input.operation === 'cancel') return cancel(normalized, item)
    if (input.operation === 'recover') {
      const key = keyOf(normalized)
      if (recovering.has(key)) return recovering.get(key)
      const recovery = recover(normalized, item)
      recovering.set(key, recovery)
      try { return await recovery }
      finally { if (recovering.get(key) === recovery) recovering.delete(key) }
    }
    return start(normalized, item)
  }

  function invalidate(predicate, reason) {
    for (const task of tasks.values()) if (predicate(task)) {
      task.controller.abort(new Error(reason))
      try { Promise.resolve(cancelJob?.(task.jobId)).catch(() => {}) } catch {}
    }
  }

  return {
    handle,
    gameRemoved({ gameId } = {}) { invalidate(task => task.input.gameId === gameId, '这一局已删除') },
    timelineChanged({ gameId, turn } = {}) { invalidate(task => task.input.gameId === gameId && (!turn || Number(task.input.turn) >= Number(turn)), '剧情线已变化') },
    dispose() {
      disposed = true
      invalidate(() => true, '插件已卸载')
      tasks.clear()
    },
  }
}
