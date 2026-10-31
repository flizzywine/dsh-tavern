/**
 * Tavern 官方插件接口适配层（接口版本 2）
 * ============================================================
 *
 * 为什么有这一层：
 *   以前"把图插进正文"是靠给 Tavern 打 5~8 处客户端补丁（造一个
 *   tavernAssistantTextRenderer 服务）+ 自建 /jobs?image=1 图片服务。
 *   Tavern 一更新、补丁被冲掉，插件就瞎了（正文不显示图、按钮消失）。
 *
 *   现在 Tavern 开放了官方接口，这条链路整个可以走正门：
 *     tavern.promptSection     自动生图规则进入**游玩时**的正文提示词
 *                              （DSH 自带的 systemPrompt.section 游玩时不生效，
 *                                以前那套注入其实一直是空的）
 *     tavern.onTurnSettled     每轮结算完成或失败后通知；当前 API 没有正文生成中的提前事件
 *     tavern.getTurn           手动按钮配图时，用来取这一轮的 textVersion 与正文
 *     tavern.attach / update   图片按 anchor 挂进正文；与 textVersion 绑定，
 *                              回退或切版本时 Tavern 自己隐藏，切回来又出现
 *     attachments.saveImage    图片交给 DSH 附件服务，不再自建取图路由
 *
 * 这一层只做"和 Tavern 交互"；规划与 ComfyUI 出图仍用插件自己的实现。
 */

/** 自动生图规则：让前台模型在正文里写 image###...### 标记（手动机不用它） */
function markerRule(count) {
  const n = Math.max(1, Math.min(8, Number(count) || 3))
  return [
    '【插图标记】',
    '在正文里选出 ' + n + ' 个最值得配图的瞬间，在**那个句子所在段落之后**另起一行写上：',
    '',
    'image###<英文提示词>###',
    '',
    '- 提示词用英文逗号分隔的 Danbooru 风格 tag：人物外观、表情、服装状态、动作、镜头、光线、场景。',
    '- 一行一个标记，标记独占一行，前后各留一个空行。',
    '- 不要解释这些标记，也不要把它写进括号或代码块。',
  ].join('\n')
}

/**
 * 安装官方桥。
 * @returns {{ dispose: Function, attachTurn: Function, available: boolean }}
 */
const PLUGIN_IMAGE_KINDS = ['dsh-tavern-image/image', 'dsh-tavern-comfy/image']

/**
 * 设置页删一张图时，撤下它挂在对话里的那个版本：当前图（由上一版顶上）或某个早期版本。
 * 第 5 版之前的 Tavern 不能只删一个版本，那时只在整项只有这一张时删。
 */
export async function removeMountedPicture(tavern, job) {
  if (!job?.gameId || typeof tavern?.list !== 'function' || typeof tavern?.remove !== 'function') return
  const versioned = Number(tavern.apiVersion) >= 5
  for (const item of await tavern.list({ gameId: job.gameId })) {
    if (!PLUGIN_IMAGE_KINDS.includes(item.kind)) continue
    const history = item.history || []
    if (String(item.data?.jobId ?? '') === job.id) {
      if (versioned) await tavern.remove(item.id, { version: 'current' })
      else if (!history.length) await tavern.remove(item.id)
      continue
    }
    const index = versioned ? history.findIndex(entry => String(entry.data?.jobId ?? '') === job.id) : -1
    if (index >= 0) await tavern.remove(item.id, { version: index })
  }
}

export function installTavernBridge({ tavern, attachments, engine, getConfig, logger, readFileAsBytes, onTurn, onTimeline }) {
  const disposes = []
  const log = msg => { try { logger?.info?.(`dsh-tavern-image[官方桥]: ${msg}`) } catch {} }
  const warn = msg => { try { logger?.warn?.(`dsh-tavern-image[官方桥]: ${msg}`) } catch {} }
  const running = new Map()   // [gameId, turn, textVersion] → { promise, controller }
  const completed = new Map()
  const manuallyHandledTurns = new Map()
  const manualTurnLimit = 200
  const historyTails = new Map()
  let manualRequestId = 0
  let disposed = false

  const versionKey = turn => JSON.stringify([
    turn.gameId, turn.turn, turn.textVersion, turn.manual ? 'manual' : 'auto', Number(turn.count) || 0,
    turn.settings?.smartImageSelection !== false, turn.settings?.plannerEnabled !== false,
    turn.settings?.characterAutoUpdate !== false, turn.settings?.plannerSignature ?? '',
  ])
  const manualTurnKey = turn => JSON.stringify([
    String(turn.gameId ?? ''), Number(turn.turn), String(turn.textVersion ?? ''),
  ])
  function rememberManualTurn(turn) {
    const key = manualTurnKey(turn)
    manuallyHandledTurns.delete(key)
    manuallyHandledTurns.set(key, true)
    while (manuallyHandledTurns.size > manualTurnLimit) {
      manuallyHandledTurns.delete(manuallyHandledTurns.keys().next().value)
    }
  }
  function forgetManualTurnsForGame(gameId) {
    const target = String(gameId ?? '')
    for (const key of manuallyHandledTurns.keys()) {
      if (JSON.parse(key)[0] === target) manuallyHandledTurns.delete(key)
    }
  }
  function abortTask(task, reason) {
    if (task.controller.signal.aborted) return
    task.controller.abort(new Error(reason))
    for (const id of task.jobIds ?? []) {
      const job = engine.getJob?.(id)
      if (job && ['pending', 'running'].includes(job.state)) {
        try { engine.cancelJob?.(id) } catch {}
      }
    }
  }
  async function withHistoryLock(gameId, operation) {
    const id = String(gameId ?? '')
    const previous = historyTails.get(id) ?? Promise.resolve()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const tail = previous.catch(() => {}).then(() => gate)
    historyTails.set(id, tail)
    await previous.catch(() => {})
    try { return await operation() }
    finally {
      release()
      if (historyTails.get(id) === tail) historyTails.delete(id)
    }
  }
  async function assertCurrent(task) {
    task.controller.signal.throwIfAborted()
    if (disposed) throw new Error('插件已卸载')
    // 同一批画面的并行检查共用一次官方读取。
    const check = task.checking ||= tavern.getTurn({ gameId: task.gameId, turn: task.turn })
    let current
    try { current = await check } finally { if (task.checking === check) task.checking = null }
    task.controller.signal.throwIfAborted()
    if (!current || current.textVersion !== task.textVersion) {
      abortTask(task, '正文已删除或改写，停止旧版配图')
      task.controller.signal.throwIfAborted()
    }
  }
  function pause(ms, signal) {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }

  async function waitJob(jobId, task, timeoutMs = 8 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await assertCurrent(task)
      const job = engine.getJob(jobId)
      if (!job) return null
      if (job.state === 'done' && job.file) return job
      if (job.state === 'failed' || job.state === 'cancelled' || job.state === 'uncertain') return job
      await pause(500, task.controller.signal)
    }
    return null
  }

  /**
   * 给某一轮配图：规划 → 每张挂 pending 占位 → 出图 → update 成真图。
   * 自动（onTurnSettled）和手动（/attach-turn 路由）共用这一份实现。
   */
  function attachTurn({ gameId, turn, textVersion, text, messageId, manual = false, count, instruction = '' }) {
    const body = String(text ?? '').trim()
    if (!body) return Promise.reject(new Error('这一轮没有正文'))
    if (!textVersion) return Promise.reject(new Error('拿不到这一轮的版本号（textVersion）'))
    if (disposed) return Promise.reject(new Error('插件已卸载'))
    if (typeof instruction !== 'string') return Promise.reject(new Error('instruction 必须是字符串'))
    instruction = instruction.trim()
    if (instruction.length > 2000) return Promise.reject(new Error('instruction 不能超过 2000 个字符'))
    const instructed = instruction.length > 0
    manual = Boolean(manual || instructed)
    const config = getConfig() ?? {}
    const settings = {
      smartImageSelection: config.smartImageSelection !== false,
      plannerEnabled: config.plannerEnabled !== false,
      characterAutoUpdate: config.characterAutoUpdate !== false && Number(tavern.apiVersion) >= 2,
      plannerSignature: JSON.stringify([
        config.plannerCount, config.plannerProvider, config.plannerModel, config.plannerTemperature, config.plannerEffort,
        config.plannerExtra, config.plannerEntries, config.promptMode, config.generationMode,
      ]),
    }
    const key = versionKey({ gameId, turn, textVersion, manual, count, settings })
    // A manual request must not cancel and replace another in-flight request:
    // the caller needs an explicit busy result so its one-off instruction is retained.
    for (const task of running.values()) {
      if (task.gameId === gameId && task.turn === turn && task.textVersion === textVersion
        && (instructed || task.instruction)) {
        const error = new Error('这一轮的生图任务正在进行，请稍后重试')
        error.statusCode = 409
        return Promise.reject(error)
      }
    }
    if (manual) {
      // Keep this marker even after failure: a late host event must not silently
      // submit a second billable plan after the user already requested this version.
      rememberManualTurn({ gameId, turn, textVersion })
    }
    if (!manual && running.has(key)) return running.get(key).promise
    if (manual) {
      for (const cachedKey of completed.keys()) {
        const parts = JSON.parse(cachedKey)
        if (parts[0] === gameId && parts[1] === turn && parts[2] === textVersion && parts[3] === 'auto') completed.delete(cachedKey)
      }
    }
    for (const task of running.values()) {
      if (task.gameId === gameId && task.turn === turn && task.textVersion !== textVersion) abortTask(task, '正文版本已变更')
      else if (manual && task.gameId === gameId && task.turn === turn && task.textVersion === textVersion) {
        abortTask(task, task.manual ? '已有更新的手动生图请求' : '用户选择手动强制配图')
      }
    }
    const runKey = manual ? key + '|manual|' + (++manualRequestId) : key
    const task = { gameId, turn, textVersion, controller: new AbortController(), mounted: new Set(), jobIds: new Set(), manual, count, settings, instruction }
    // 先登记，再开始异步规划；同类自动请求复用任务，手动请求保留强制重画语义。
    task.promise = Promise.resolve().then(() => runTurn(task, body, messageId)).finally(() => {
      if (running.get(runKey) === task) running.delete(runKey)
    })
    running.set(runKey, task)
    return task.promise
  }

  async function runTurn(task, body, messageId) {
    const { gameId, turn, textVersion } = task
    const pending = new Map()
    let existing = []
    let plan
    try {
      await assertCurrent(task)
      if (typeof tavern.list === 'function') existing = (await tavern.list({ gameId, turn }) || []).map(media => structuredClone(media))
      const cached = task.manual ? null : completed.get(versionKey(task))
      if (cached && cached.jobIds.every(jobId => existing.some(media => media.textVersion === textVersion && media.data?.jobId === jobId && media.status === 'ready' && media.attachment))) {
        plan = { plans: [] }
        return cached.result
      }
      const beginImage = item => {
        const jobId = String(item?.jobId ?? '')
        if (jobId) task.jobIds.add(jobId)
        if (task.controller.signal.aborted) {
          const job = engine.getJob?.(jobId)
          if (job && ['pending', 'running'].includes(job.state)) { try { engine.cancelJob?.(jobId) } catch {} }
          return
        }
        if (pending.has(jobId)) return
        // 每张图独立等待：后面的作业先完成，也能马上显示；不改变 GPU 队列。
        pending.set(jobId, mountImage(task, item, existing).catch(error => {
          if (!task.controller.signal.aborted) warn('挂图失败：' + (error?.message ?? error))
          return 0
        }))
      }
      const config = getConfig() ?? {}
      const api2 = Number(tavern.apiVersion) >= 2
      const historyEnabled = api2 && config.characterAutoUpdate !== false
      const saveHistory = historyEnabled && !task.instruction
      const shouldGenerate = config.imageEnabled !== false && (task.manual || config.plannerEnabled !== false)
      const planAndSave = async () => {
        let historySnapshot = null
        if (api2 && typeof tavern.readTurnData === 'function') {
          try {
            const saved = await tavern.readTurnData({ gameId, turn })
            if (saved?.data && typeof saved.data === 'object') historySnapshot = saved.data
          } catch (error) { warn('读取角色历史失败：' + (error?.message ?? error)) }
        }
        const value = await engine.planMessage({
          text: body,
          messageId: (messageId || ('turn-' + gameId + '-' + turn)) + '|' + textVersion,
          turn, textVersion, sessionId: gameId, manual: task.manual, force: task.manual, count: task.count,
          smartSelection: !task.manual && config.smartImageSelection !== false,
          imageGeneration: shouldGenerate, characterUpdates: historyEnabled && !task.instruction, historySnapshot,
          reusePlan: shouldGenerate && !task.manual && config.smartImageSelection === false,
          instruction: task.instruction,
          signal: task.controller.signal, onPlan: beginImage,
        })
        if (saveHistory && value?.characterSnapshot && typeof tavern.saveTurnData === 'function') {
          try {
            await assertCurrent(task)
            await tavern.saveTurnData({ gameId, turn, textVersion, data: value.characterSnapshot })
          } catch (error) {
            if (task.controller.signal.aborted) throw error
            warn('保存角色历史失败：' + (error?.message ?? error))
          }
        }
        return value
      }
      plan = historyEnabled ? await withHistoryLock(gameId, planAndSave) : await planAndSave()
      if (plan?.historyWarning) warn('角色历史容量限制：' + plan.historyWarning)
      const plans = Array.isArray(plan?.plans) ? plan.plans : []
      for (const item of plans) beginImage(item)
      const results = await Promise.all(pending.values())
      await assertCurrent(task)
      const result = { attached: results.reduce((sum, value) => sum + value, 0), total: plans.length }
      if (Array.isArray(plan?.characterWarnings) && plan.characterWarnings.length) result.warnings = plan.characterWarnings.map(text => String(text).slice(0, 200))
      if (plan?.error) result.error = String(plan.error).slice(0, 500)
      else if (plan?.skipped) { result.skipped = true; result.reason = String(plan.reason ?? '').slice(0, 500) }
      else if (!plans.length && shouldGenerate) result.error = '规划没有产出画面'
      if (task.manual && result.total > 0 && result.attached === result.total && !plan?.error) {
        // A complete redraw replaces the whole prior batch, including items
        // with changed anchors. Only remove media from the initial scoped list.
        for (const old of existing) {
          if (!isPluginImage(old) || old.textVersion !== textVersion) continue
          await removeSnapshotMedia(task, old)
        }
      }
      const successfulEmpty = result.total === 0 && !result.error && (result.skipped || !shouldGenerate)
      if (!task.manual && (successfulEmpty || (result.total > 0 && result.attached === result.total)) && !result.error) {
        completed.set(versionKey(task), { result, jobIds: plans.map(item => String(item.jobId ?? '')) })
        if (completed.size > 200) completed.delete(completed.keys().next().value)
      }
      return result
    } finally {
      // 规划失败/卸载时也收束已经启动的等待，取消旧占位但保留已完成的可用图片。
      if (!plan) abortTask(task, '规划任务已停止')
      await Promise.all(pending.values())
      if (task.controller.signal.aborted || disposed) {
        await Promise.all([...task.mounted].map(id => tavern.remove?.(id)?.catch(() => {})))
      }
    }
  }

  async function mountImage(task, item, existing) {
      const { gameId, turn, textVersion } = task
      const jobId = String(item?.jobId ?? '')
      const anchor = String(item?.mount ?? '').slice(0, 500)
      const caption = String(item?.title ?? '').slice(0, 500)

      let attached = existing.find(media => ['dsh-tavern-image/image', 'dsh-tavern-comfy/image'].includes(media.kind) && media.textVersion === textVersion && media.data?.jobId === jobId)
      if (attached?.status === 'ready' && attached.attachment) return 1
      try {
        await assertCurrent(task)
        if (!attached && !task.manual && typeof tavern.remove === 'function') {
          // 重试新作业时清理同一画面上一次留下的失败占位。
          await Promise.all(existing.filter(media => isPluginImage(media) && media.textVersion === textVersion && media.anchor === anchor && media.status === 'failed').map(media => tavern.remove(media.id).catch(() => {})))
          await assertCurrent(task)
        }
        attached ||= await tavern.attach({
          gameId, turn, textVersion,
          item: { kind: 'dsh-tavern-image/image', status: 'pending', anchor, caption, data: { jobId } },
        })
        if (attached?.id) task.mounted.add(attached.id)
        await assertCurrent(task)
      } catch (error) {
        warn('挂占位失败：' + (error?.message ?? error))
        return 0
      }
      if (!attached?.id) return 0

      if (!jobId) { await tavern.update(attached.id, { status: 'failed', error: '没有拿到作业号' }).catch(() => {}); return 0 }

      try {
        const job = await waitJob(jobId, task)
        if (!job) { await tavern.update(attached.id, { status: 'failed', error: '等待出图超时' }); return 0 }
        if (job.state !== 'done' || !job.file) {
          await tavern.update(attached.id, { status: 'failed', error: String(job.error || '出图失败').slice(0, 200), actions: [{ id: 'retry', label: '重试' }] })
          return 0
        }
        const bytes = await readFileAsBytes(job.file)
        await assertCurrent(task)
        const mediaType = String(job.mediaType || 'image/png').split(';')[0].toLowerCase()
        const extension = ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/png': 'png' })[mediaType] || 'png'
        const attachment = await attachments.saveImage({
          data: bytes,
          mediaType,
          name: 'tavern-comfy-' + jobId.slice(0, 8) + '.' + extension,
        })
        await assertCurrent(task)
        // prompt：Tavern 插图卡「改提示词」的初始内容。
        await tavern.update(attached.id, { status: 'ready', attachment, progress: 1, prompt: String(job.params?.rawTag || job.params?.tag || job.positive || '').slice(0, 12000) })
        await assertCurrent(task)
        // The new image is now a completed media item. If a later manual click
        // supersedes this task while old items are being removed, keep this image.
        task.mounted.delete(attached.id)
        if (task.manual && typeof tavern.remove === 'function') {
          // Replace same-anchor plugin images only after this new image is visible.
          // Keep every failed/unfinished replacement's prior image in place.
          const oldImages = existing.filter(media => media.id !== attached.id
            && isPluginImage(media)
            && media.textVersion === textVersion && media.status === 'ready' && media.attachment
            && media.anchor === anchor)
          for (const old of oldImages) {
            await removeSnapshotMedia(task, old)
          }
        }
        // 已成功显示的图归宿主管理版本隐藏/恢复，卸载或后续失效只清理未完成占位。
        log(`第 ${turn} 轮挂上一张图（${jobId.slice(0, 8)}）`)
        return 1
      } catch (error) {
        if (!task.controller.signal.aborted && !disposed) {
          await tavern.update(attached.id, { status: 'failed', error: String(error?.message ?? error).slice(0, 200) }).catch(() => {})
        }
        return 0
      }
  }

  function isPluginImage(media) {
    return PLUGIN_IMAGE_KINDS.includes(media?.kind)
  }

  async function removeSnapshotMedia(task, media) {
    if (!media?.id || !isPluginImage(media) || media.textVersion !== task.textVersion || typeof tavern.remove !== 'function') return false
    task.removedOld ||= new Set()
    task.removingOld ||= new Map()
    if (task.removedOld.has(media.id)) return true
    if (task.removingOld.has(media.id)) return task.removingOld.get(media.id)
    const removal = (async () => {
      await assertCurrent(task)
      await tavern.remove(media.id)
      task.removedOld.add(media.id)
      return true
    })()
    task.removingOld.set(media.id, removal)
    try { return await removal }
    catch (error) {
      if (!task.controller.signal.aborted) warn('替换旧图失败：' + (error?.message ?? error))
      return false
    } finally {
      if (task.removingOld.get(media.id) === removal) task.removingOld.delete(media.id)
    }
  }

  // ── ① 自动生图规则：进游玩正文提示词 ────────────────────────────
  try {
    const off = tavern.promptSection({
      name: 'auto-image-gen',
      text: () => (getConfig()?.autoImageGen && getConfig()?.smartImageSelection === false ? markerRule(getConfig()?.imageGenCount) : ''),
    })
    if (typeof off === 'function') disposes.push(off)
    log('已注册提示词段落 auto-image-gen')
  } catch (error) {
    warn('注册提示词段落失败：' + (error?.message ?? error))
  }

  // ── ② 每轮结算 → 自动配图 ───────────────────────────────────────
  try {
    const off = tavern.onTurnSettled(turn => {
      if (disposed) return
      // 每轮都先记下「这是哪张卡、第几轮」—— 按卡过滤角色、读卡上下文都要用它。
      // 必须放在开关判断之前：规划关着的时候也要记，否则关着开关玩一局再打开，
      // 「当前卡」还是空的（以前是去翻会话目录才拿到，那属于读 Tavern 的数据文件）。
      try { onTurn?.(turn) } catch {}
      if (manuallyHandledTurns.has(manualTurnKey(turn))) {
        log('这一版正文已由手动请求处理，跳过迟到的结算事件')
        return
      }
      const config = getConfig() ?? {}
      const canUpdate = Number(tavern.apiVersion) >= 2 && config.characterAutoUpdate !== false
      if ((config.imageEnabled === false || config.plannerEnabled === false) && !canUpdate) return
      // 不返回配图 Promise，宿主结算通知无需等待模型和 GPU。
      void attachTurn({
        gameId: turn.gameId, turn: turn.turn, textVersion: turn.textVersion, text: turn.text,
      })
        .catch(error => warn('自动配图出错：' + (error?.message ?? error)))
    })
    if (typeof off === 'function') disposes.push(off)
    log('已注册 onTurnSettled')
  } catch (error) {
    warn('注册轮次监听失败：' + (error?.message ?? error))
  }

  if (typeof tavern.onGameRemoved === 'function') {
    try {
      const off = tavern.onGameRemoved(({ gameId }) => {
        for (const task of running.values()) if (task.gameId === gameId) abortTask(task, '这一局已删除')
        for (const key of completed.keys()) if (JSON.parse(key)[0] === gameId) completed.delete(key)
        forgetManualTurnsForGame(gameId)
      })
      if (typeof off === 'function') disposes.push(off)
    } catch (error) { warn('注册删除监听失败：' + (error?.message ?? error)) }
  }

  // 玩家在对话或画廊里删了图：插件这边的作业记录和缓存一起删，设置页画廊不再留着（第 5 版）。
  if (typeof tavern.onMediaRemoved === 'function') {
    try {
      const off = tavern.onMediaRemoved(event => {
        if (!isPluginImage(event)) return
        const ids = new Set()
        for (const picture of event.pictures ?? []) {
          if (picture?.data?.jobId) ids.add(String(picture.data.jobId))
          // 整项没了：还在重画的那张也不要了
          if (event.itemRemoved && picture?.data?.replacement?.jobId) ids.add(String(picture.data.replacement.jobId))
        }
        return Promise.all([...ids].map(id => engine.deleteJob?.(id)))
      })
      if (typeof off === 'function') disposes.push(off)
    } catch (error) { warn('注册删图监听失败：' + (error?.message ?? error)) }
  }

  if (Number(tavern.apiVersion) >= 2 && typeof tavern.onTimelineChanged === 'function') {
    try {
      const off = tavern.onTimelineChanged(event => {
        const gameId = String(event?.gameId ?? '')
        if (gameId) {
          for (const [key, task] of running) if (task.gameId === gameId) {
            abortTask(task, '剧情线已变化，停止旧任务')
            running.delete(key)
          }
          for (const key of completed.keys()) if (JSON.parse(key)[0] === gameId) completed.delete(key)
          forgetManualTurnsForGame(gameId)
        }
        try { onTimeline?.(event) } catch {}
      })
      if (typeof off === 'function') disposes.push(off)
    } catch (error) { warn('注册剧情线监听失败：' + (error?.message ?? error)) }
  }

  return {
    available: true,
    attachTurn,
    withHistoryLock,
    dispose: () => {
      disposed = true
      for (const task of running.values()) abortTask(task, '插件已卸载')
      completed.clear()
      manuallyHandledTurns.clear()
      for (const dispose of disposes) { try { dispose() } catch {} }
    },
  }
}
