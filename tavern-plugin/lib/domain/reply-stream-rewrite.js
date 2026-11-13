// 正文流式改写：模型写正文的同一路 token 流里，按「安全段落」切段，
// 交给插件注册的改写器（例如 revnovel 润色）逐段改写后再吐给前端。
//
// 约束：
// - 只处理纯文本正文流（tool-call 提交的正文不在这一层，见 hooks/model-stream.js 的启用条件）。
// - 一段在改写时不启动下一段：正文必须按原顺序出现，宁可让缓冲等一等。
// - 改写失败的段退回原文，取消/中断时把缓冲原文照原样放出，绝不吞正文。

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function createReplyStreamRewriters({ warn = () => {} } = {}) {
  const entries = new Map()
  let disposed = false

  function register(owner, rewriter) {
    if (disposed) throw new Error('正文流式改写宿主已释放')
    if (!owner) throw new Error('正文流式改写需要插件名')
    if (entries.has(owner)) throw new Error('插件 ' + owner + ' 已经注册过正文流式改写器')
    if (typeof rewriter?.plan !== 'function' || typeof rewriter?.rewrite !== 'function') {
      throw new TypeError('正文流式改写器需要 plan(buffer, {eof}) 与 rewrite(text, context)')
    }
    const entry = { owner, rewriter }
    entries.set(owner, entry)
    return () => { if (entries.get(owner) === entry) entries.delete(owner) }
  }

  return Object.freeze({
    register,
    get active() { return entries.size > 0 },
    // 同一时刻只让一个改写器工作：多个插件同时改写同一路正文只会互相打架。
    pick() {
      for (const entry of entries.values()) return entry
      return null
    },
    open({ sessionId = '', turn = 0, chatId = '', mode = '', signal } = {}) {
      const entry = this.pick()
      if (!entry) return null
      return createReplyRewriteStream({
        rewriter: entry.rewriter,
        context: { sessionId: str(sessionId), chatId: str(chatId), turn: Number(turn) || 0, mode: str(mode) },
        signal,
        warn: error => warn({ owner: entry.owner, error })
      })
    },
    dispose() {
      disposed = true
      entries.clear()
    }
  })
}

/** 一路正文的改写管道：push(delta) 返回此刻能立刻写给前端的文本，drain() 收尾。 */
export function createReplyRewriteStream({ rewriter, context = {}, signal, warn = () => {} }) {
  let buffer = ''
  let pending = null // { source, work }
  let closed = false
  let broken = false
  let discarded = false
  let plannedAt = 0
  const ready = []

  function report(error) {
    if (broken) return
    broken = true
    try { warn(error) } catch { /* 观察者不能影响正文 */ }
  }

  function begin(segment) {
    const item = { source: segment }
    pending = item
    item.work = (async () => {
      let output = segment
      try {
        if (!signal?.aborted) {
          const value = str(await rewriter.rewrite(segment, { ...context, signal }))
          if (value.trim()) output = value
        }
      } catch (error) {
        report(error)
      }
      if (pending === item) pending = null
      if (discarded) return
      ready.push(output)
    })()
  }

  function safeCut(eof) {
    let cut
    try {
      cut = rewriter.plan(buffer, { eof })
    } catch (error) {
      report(error)
      return null
    }
    if (cut === null || cut === undefined) return null
    const value = Math.floor(Number(cut))
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.min(value, buffer.length)
  }

  function startNext() {
    if (pending !== null || broken || discarded) return
    // 每个 token 都全量扫描缓冲不划算：至少长 32 个字符再问一次切点。
    if (buffer.length - plannedAt < 32) return
    plannedAt = buffer.length
    const cut = safeCut(false)
    if (cut === null || cut <= 0) return
    const segment = buffer.slice(0, cut)
    buffer = buffer.slice(cut)
    if (segment) begin(segment)
  }

  function takeReady() {
    if (!ready.length) return ''
    return ready.splice(0, ready.length).join('')
  }

  // 放弃改写：把还没吐出的原文（含正在改写的那段的原文）一次交出去。
  function flushAll() {
    discarded = true
    let rest = takeReady()
    if (pending) {
      rest += pending.source
      pending = null
    }
    rest += buffer
    buffer = ''
    return rest
  }

  return {
    get busy() { return pending !== null },
    push(delta) {
      const text = str(delta)
      if (closed) return text
      if (broken || signal?.aborted) return takeReady() + flushAll() + text
      buffer += text
      let output = takeReady()
      startNext()
      if (broken) return output + flushAll()
      return output + takeReady()
    },
    async drain() {
      if (closed) return ''
      closed = true
      let output = takeReady()
      while (pending !== null) {
        const item = pending
        try { await item.work } catch { /* begin 内部已兜住 */ }
        output += takeReady()
      }
      if (broken || signal?.aborted) return output + flushAll()
      while (buffer) {
        const cut = safeCut(true)
        const segment = cut === null ? buffer : buffer.slice(0, cut)
        buffer = cut === null ? '' : buffer.slice(cut)
        if (!segment) break
        let text = segment
        try {
          const value = str(await rewriter.rewrite(segment, { ...context, signal }))
          if (value.trim()) text = value
        } catch (error) {
          report(error)
        }
        output += text
      }
      return output
    },
    abort() {
      if (closed) return ''
      closed = true
      return takeReady() + flushAll()
    }
  }
}
