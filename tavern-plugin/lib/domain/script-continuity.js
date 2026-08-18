function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clampInt(value, min, max, fallback) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function scriptVersion(script) {
  return Number(script && script.importedAt) || 0
}

function chunksOf(script) {
  return script && Array.isArray(script.chunks) ? script.chunks : []
}

function normalizedMatchText(value) {
  return str(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function openingCursor(script, opening) {
  const chunks = chunksOf(script)
  const ending = normalizedMatchText(opening).slice(-180)
  if (chunks.length === 0 || ending.length < 3) return 0

  const weights = new Map()
  let totalWeight = 0
  for (let index = 0; index <= ending.length - 3; index++) {
    const gram = ending.slice(index, index + 3)
    const weight = Math.pow((index + 3) / ending.length, 2)
    const previous = weights.get(gram) || 0
    if (weight > previous) {
      weights.set(gram, weight)
      totalWeight += weight - previous
    }
  }

  let best = { cursor: 0, hits: 0, score: 0 }
  for (let cursor = 0; cursor < chunks.length; cursor++) {
    const text = normalizedMatchText(chunks[cursor].text)
    let hits = 0
    let matchedWeight = 0
    for (const [gram, weight] of weights) {
      if (!text.includes(gram)) continue
      hits++
      matchedWeight += weight
    }
    const score = totalWeight > 0 ? matchedWeight / totalWeight : 0
    if (score > best.score || (score === best.score && hits > best.hits)) best = { cursor, hits, score }
  }

  return best.hits >= 3 && best.score >= 0.08 ? best.cursor : 0
}

function normalizedState(script, source) {
  const chunks = chunksOf(script)
  const total = chunks.length
  const incoming = source !== null && typeof source === 'object' ? clone(source) : {}
  const initialCursor = Math.max(0, Math.min(Math.max(0, total - 1), Number(incoming.initialCursor) || 0))
  const version = scriptVersion(script)
  if ((Number(incoming.scriptVersion) || 0) !== version) {
    return {
      cursor: initialCursor,
      initialCursor,
      recalledChunkIds: [],
      prepared: null,
      lastReference: null,
      totalChunks: total,
      title: str(script && script.title),
      scriptVersion: version
    }
  }
  // cursor === total 是明确的“剧本已结束”位置；不能钳回最后一块，否则末块会被无限重复。
  incoming.cursor = Math.max(0, Math.min(total, Number(incoming.cursor) || 0))
  incoming.initialCursor = initialCursor
  incoming.recalledChunkIds = Array.isArray(incoming.recalledChunkIds) ? incoming.recalledChunkIds.filter(function (id) { return typeof id === 'string' }) : []
  incoming.prepared = incoming.prepared !== null && typeof incoming.prepared === 'object' ? incoming.prepared : null
  incoming.lastReference = incoming.lastReference !== null && typeof incoming.lastReference === 'object' ? incoming.lastReference : null
  incoming.totalChunks = total
  incoming.title = str(script && script.title) || str(incoming.title)
  incoming.scriptVersion = version
  return incoming
}

function infoOf(script) {
  if (script === undefined || script === null) return null
  return {
    title: str(script.title) || '未命名剧本',
    sourceChars: Number(script.sourceChars) || 0,
    chunkSize: Number(script.chunkSize) || 500,
    chunkCount: chunksOf(script).length,
    importedAt: Number(script.importedAt) || 0
  }
}

function readWindow(script, query, offset, limit) {
  const chunks = chunksOf(script)
  const total = chunks.length
  if (total === 0) return { title: str(script && script.title), total, from: 0, to: 0, chunks: [] }
  const maxLimit = clampInt(limit, 1, 6, 3)
  const keyword = str(query).trim()
  if (keyword !== '') {
    for (let i = 0; i < chunks.length; i++) {
      if (str(chunks[i].text).includes(keyword)) {
        const from = Math.max(0, i - Math.floor((maxLimit - 1) / 2))
        const to = Math.min(total - 1, from + maxLimit - 1)
        return { title: str(script.title), total, from: from + 1, to: to + 1, chunks: chunks.slice(from, to + 1), matchOrder: chunks[i].order }
      }
    }
    return { title: str(script.title), total, from: 0, to: 0, chunks: [], notFound: true }
  }
  const start = Math.max(0, clampInt(offset, 1, Math.max(1, total), 1) - 1)
  const end = Math.min(total, start + maxLimit)
  return { title: str(script.title), total, from: start + 1, to: end, chunks: chunks.slice(start, end) }
}

function playWindow(script, state, query, offset, limit) {
  const chunks = chunksOf(script)
  const total = chunks.length
  const cursor = Math.max(0, Math.min(Math.max(0, total - 1), Number(state.cursor) || 0))
  if (total === 0) return { title: str(script && script.title), total, from: 0, to: 0, chunks: [], cursor: 0 }
  const radius = 10
  const windowFrom = Math.max(0, cursor - radius)
  const windowTo = Math.min(total - 1, cursor + radius)
  const keyword = str(query).trim()
  if (keyword !== '') {
    for (let i = windowFrom; i <= windowTo; i++) {
      if (str(chunks[i].text).includes(keyword)) {
        const from = Math.max(windowFrom, i - 1)
        const to = Math.min(windowTo, i + 1)
        return {
          title: str(script.title), total, from: from + 1, to: to + 1,
          chunks: chunks.slice(from, to + 1), cursor: cursor + 1,
          matchOrder: chunks[i].order, windowFrom: windowFrom + 1, windowTo: windowTo + 1
        }
      }
    }
    return { title: str(script.title), total, from: 0, to: 0, chunks: [], cursor: cursor + 1, windowFrom: windowFrom + 1, windowTo: windowTo + 1, notFound: true }
  }
  const start = Math.max(0, Math.min(total - 1, offset === undefined || offset === null ? cursor : clampInt(offset, 1, total, 1) - 1))
  const maxLimit = clampInt(limit, 1, 21, 1)
  const end = Math.min(total - 1, start + maxLimit - 1)
  return {
    title: str(script.title), total, from: start + 1, to: end + 1,
    chunks: chunks.slice(start, end + 1), cursor: cursor + 1,
    windowFrom: windowFrom + 1, windowTo: windowTo + 1
  }
}

export function createScriptContinuity() {
  function start(script, initialCursor) {
    const chunks = chunksOf(script)
    const cursor = Math.max(0, Math.min(Math.max(0, chunks.length - 1), Number(initialCursor) || 0))
    return normalizedState(script, {
      cursor,
      initialCursor: cursor,
      recalledChunkIds: [],
      prepared: null,
      lastReference: null,
      scriptVersion: scriptVersion(script)
    })
  }

  function startAligned(script, opening, explicitCursor) {
    const hasExplicitCursor = explicitCursor !== undefined && explicitCursor !== null && str(explicitCursor).trim() !== '' && Number.isFinite(Number(explicitCursor))
    const cursor = hasExplicitCursor ? Number(explicitCursor) : openingCursor(script, opening)
    return start(script, cursor)
  }

  function transition(input) {
    const script = input && input.script
    const event = input && input.event
    if (event === null || typeof event !== 'object') throw new Error('缺少剧本状态转换事件')
    const state = normalizedState(script, input && input.state)
    const chunks = chunksOf(script)

    if (event.kind === 'prepare') {
      const userText = str(event.userText).trim()
      const nativeTurn = Number(event.nativeTurn) || 0
      if (state.prepared !== null) {
        if (Number(state.prepared.nativeTurn) === nativeTurn && str(state.prepared.userText) === userText) {
          return { state, reference: clone(state.prepared), changed: false }
        }
        throw new Error('本轮剧本准备不一致，请重新开始当前回合')
      }
      let reference
      if (state.cursor >= chunks.length) {
        reference = { userText, nativeTurn, ended: true, chunkId: '', order: state.cursor, text: '' }
      } else {
        const selected = chunks[state.cursor]
        reference = {
          userText,
          nativeTurn,
          ended: false,
          chunkId: selected.id,
          order: selected.order,
          text: selected.text,
          cursorBefore: state.cursor,
          preparedAt: Date.now()
        }
      }
      state.prepared = reference
      return { state, reference: clone(reference), changed: true }
    }

    if (event.kind === 'focus') {
      if (state.prepared !== null) throw new Error('当前剧本回合尚未提交，不能调整下一轮游标')
      if (chunks.length === 0) return { state, changed: false }
      const raw = Number(event.cursor)
      if (!Number.isFinite(raw) || raw < 1) return { state, changed: false }
      const next = Math.max(0, Math.min(chunks.length - 1, Math.round(raw) - 1))
      const changed = next !== state.cursor
      state.cursor = next
      return { state, changed }
    }

    if (event.kind === 'end') {
      if (state.prepared !== null) throw new Error('当前剧本回合尚未提交，不能结束剧本游标')
      const changed = state.cursor !== chunks.length
      state.cursor = chunks.length
      return { state, changed }
    }

    if (event.kind === 'commit') {
      const prepared = state.prepared
      if (prepared === null) throw new Error('本轮尚未准备剧本分块，请先读取上下文')
      if (str(prepared.userText).trim() !== str(event.userText).trim()) throw new Error('提交内容与本轮剧本准备不一致')
      if (Number(prepared.nativeTurn) !== Number(event.nativeTurn)) throw new Error('提交回合与本轮剧本准备不一致')
      const revision = clone(Object.assign({}, state, { prepared: null }))
      const reference = clone(prepared)
      if (prepared.ended !== true && str(prepared.chunkId) !== '') {
        if (!state.recalledChunkIds.includes(prepared.chunkId)) state.recalledChunkIds.push(prepared.chunkId)
        state.lastReference = {
          chunkId: prepared.chunkId,
          order: Number(prepared.order) || 0,
          text: prepared.text,
          userText: str(event.userText),
          recalledAt: Date.now()
        }
      }
      state.prepared = null
      return { state, reference, revision, changed: true }
    }

    if (event.kind === 'restore') {
      if (event.revision !== null && typeof event.revision === 'object') {
        const restored = normalizedState(script, event.revision)
        restored.prepared = null
        return { state: restored, changed: true }
      }
      const reference = event.reference
      state.prepared = null
      if (reference !== null && typeof reference === 'object' && reference.ended !== true && str(reference.chunkId) !== '') {
        state.cursor = Math.max(0, Number(reference.cursorBefore) || 0)
        state.recalledChunkIds = state.recalledChunkIds.filter(function (id) { return id !== reference.chunkId })
        state.lastReference = null
      }
      return { state, changed: true }
    }

    throw new Error('未知剧本状态转换: ' + str(event.kind))
  }

  function inspect(input) {
    const script = input && input.script
    const request = input && input.request
    if (request === null || typeof request !== 'object') throw new Error('缺少剧本读取请求')
    const state = normalizedState(script, input && input.state)
    const chunks = chunksOf(script)

    if (request.kind === 'info') return infoOf(script)
    if (request.kind === 'read') return readWindow(script, request.query, request.offset, request.limit)
    if (request.kind === 'play') return playWindow(script, state, request.query, request.offset, request.limit)
    if (request.kind === 'choice') {
      const cursor = Math.max(0, Number(state.cursor) || 0)
      const ended = cursor >= chunks.length
      return { cursor, total: chunks.length, ended, title: str(script && script.title), chunks: ended ? [] : chunks.slice(cursor, cursor + 1) }
    }
    if (request.kind === 'preview') {
      const cursor = Math.max(0, Math.min(chunks.length, Number(state.cursor) || 0))
      const previous = state.lastReference !== null && str(state.lastReference.text) !== ''
        ? { order: Number(state.lastReference.order) || 0, text: str(state.lastReference.text) }
        : null
      return {
        title: str(script && script.title), cursor, totalChunks: chunks.length, previous,
        upcoming: chunks.slice(cursor, cursor + 3).map(function (chunk) { return { order: Number(chunk.order) || 0, id: chunk.id, text: str(chunk.text) } })
      }
    }
    if (request.kind === 'progress') {
      return {
        cursor: Number(state.cursor) || 0,
        totalChunks: chunks.length,
        recalledCount: state.recalledChunkIds.length,
        title: str(script && script.title)
      }
    }
    throw new Error('未知剧本读取请求: ' + str(request.kind))
  }

  return Object.freeze({ start, startAligned, transition, inspect })
}
