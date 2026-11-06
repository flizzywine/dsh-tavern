import { projectDisplayRuntimeState } from './chat-session-state.js'
import { displayRuntimeReceipt } from './display-runtime-store.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function cleanRuntimeUrl(value) {
  return str(value).split(/[?#]/)[0].replace(/\/\/[^/@\s]+@/, '//').slice(0, 1000)
}

function sanitizeFrameLayout(value) {
  if (!value || typeof value !== 'object') return null
  const number = n => typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1000000, n))) : null
  return {
    mode: ['legacy', 'content', 'viewport', 'fixed'].includes(value.mode) ? value.mode : 'legacy',
    source: ['template', 'panel', 'card'].includes(value.source) ? value.source : 'legacy',
    reason: value.reason === 'container' ? 'container' : 'content',
    phase: ['loading', 'interactive', 'complete'].includes(value.phase) ? value.phase : null,
    width: number(value.width), height: number(value.height), availableHeight: number(value.availableHeight),
    minHeight: number(value.minHeight), maxHeight: number(value.maxHeight),
    roots: (Array.isArray(value.roots) ? value.roots : []).slice(0, 3).map(node => ({
      tag: str(node?.tag).slice(0, 16), id: str(node?.id).slice(0, 80),
      width: number(node?.width), height: number(node?.height), clientHeight: number(node?.clientHeight), scrollHeight: number(node?.scrollHeight),
      position: str(node?.position).slice(0, 24), overflowY: str(node?.overflowY).slice(0, 24),
      cssHeight: str(node?.cssHeight).slice(0, 32), minHeight: str(node?.minHeight).slice(0, 32)
    }))
  }
}

function sanitizeDisplayRuntime(value) {
  const input = value && typeof value === 'object' ? value : {}
  function scalar(item, limit = 4000) {
    if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'number') return item
    if (typeof item === 'string') return item.slice(0, limit)
    try { return JSON.parse(JSON.stringify(item).slice(0, limit)) } catch { return str(item).slice(0, limit) }
  }
  return {
    capturedAt: Math.max(0, Number(input.capturedAt) || Date.now()),
    mvuViewUsed: input.mvuViewUsed === true,
    panelId: str(input.panelId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
    placement: input.placement === "sidebar" ? "sidebar" : "message",
    dom: str(input.dom).slice(0, 100000),
    layout: sanitizeFrameLayout(input.layout),
    console: (Array.isArray(input.console) ? input.console : []).slice(-100).map(function (item) {
      return { at: Math.max(0, Number(item && item.at) || 0), level: ['log', 'info', 'warn', 'error'].includes(item && item.level) ? item.level : 'log', args: scalar(item && item.args, 12000) }
    }),
    network: (Array.isArray(input.network) ? input.network : []).slice(-100).map(function (item) {
      return { at: Math.max(0, Number(item && item.at) || 0), kind: item && item.kind === 'xhr' ? 'xhr' : 'fetch', method: str(item && item.method).slice(0, 16), url: cleanRuntimeUrl(item && item.url), status: Math.max(0, Number(item && item.status) || 0), durationMs: Math.max(0, Number(item && item.durationMs) || 0), failed: item && item.failed === true, error: str(item && item.error).slice(0, 1000) }
    }),
    errors: (Array.isArray(input.errors) ? input.errors : []).slice(-100).map(function (item) {
      return { at: Math.max(0, Number(item && item.at) || 0), kind: str(item && item.kind).slice(0, 32), message: str(item && item.message).slice(0, 4000), tag: str(item && item.tag).slice(0, 32), url: cleanRuntimeUrl(item && item.url || item && item.source), line: Math.max(0, Number(item && item.line) || 0), column: Math.max(0, Number(item && item.column) || 0) }
    })
  }
}

function comparableDisplayRuntime(value) {
  const runtime = value && typeof value === 'object' ? value : {}
  return {
    mvuViewUsed: runtime.mvuViewUsed === true,
    panelId: str(runtime.panelId),
    placement: runtime.placement,
    dom: str(runtime.dom),
    layout: runtime.layout || null,
    console: (Array.isArray(runtime.console) ? runtime.console : []).map(function (item) {
      return { level: item && item.level, args: item && item.args }
    }),
    network: (Array.isArray(runtime.network) ? runtime.network : []).map(function (item) {
      return { kind: item && item.kind, method: item && item.method, url: item && item.url, status: item && item.status, failed: item && item.failed, error: item && item.error }
    }),
    errors: (Array.isArray(runtime.errors) ? runtime.errors : []).map(function (item) {
      return { kind: item && item.kind, message: item && item.message, tag: item && item.tag, url: item && item.url, line: item && item.line, column: item && item.column }
    })
  }
}

function sameDisplayRuntimeCapture(left, right) {
  return JSON.stringify(comparableDisplayRuntime(left)) === JSON.stringify(comparableDisplayRuntime(right))
}

// Status-panel diagnostics a play page reports for one reply: the full capture goes
// to the display runtime store, the save keeps a small receipt per panel.
export function createDisplayRuntimeCapture({ readSessionMap, chatPersistence, chatForSession, displayRuntimeStore, patchChat }) {
  async function captureDisplayRuntime(sessionId, requestedTurn, partIndex, runtime) {
    const turn = Math.max(1, Number(requestedTurn) || 0)
    for (let attempt = 0; attempt < 5; attempt++) {
      const chatId = (await readSessionMap())[str(sessionId)]
      let chat = chatId ? await chatPersistence.readDisplayRuntimeState(chatId, turn) : undefined
      // Preserve registry recovery, aliases and one-time legacy adoption.
      if (!chat || chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1) {
        const full = await chatForSession(str(sessionId))
        chat = full ? projectDisplayRuntimeState(full, turn) : undefined
      }
      if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('当前 Session 没有绑定游玩对话')
      if (chat.messageIndex < 0) throw new Error('游玩记录中不存在第 ' + turn + ' 轮回复')
      const index = Math.max(0, Math.min(100, Number(partIndex) || 0))
      let capture = sanitizeDisplayRuntime(runtime)
      // Full captures live outside the save; old saves still carry them inline.
      // The save keeps a receipt per panel, merged under its own CAS so
      // concurrent panels cannot drop each other. A reply without a receipt yet
      // (new, or rolled back and regenerated) starts its stored captures over.
      const receipt = chat.displayRuntime && typeof chat.displayRuntime === 'object' ? chat.displayRuntime : null
      const inline = receipt && receipt.version !== 2 ? receipt : null
      const stored = receipt ? (await displayRuntimeStore.read(chat.id, turn)) || inline : null
      const sourceActivityAt = Math.max(0, Number(stored && stored.sourceActivityAt) || Number(chat.updatedAt) || 0)
      const latestTurn = chat.latestTurn
      capture.captureKind = turn === latestTurn && Date.now() - sourceActivityAt < 300000 ? 'live' : 'replay'
      const samePanel = function (item) { return Number(item && item.partIndex) === index && str(item.panelId) === capture.panelId }
      const receiptFrames = receipt && Array.isArray(receipt.frames) ? receipt.frames : []
      const existingFrame = (stored && Array.isArray(stored.frames) ? stored.frames : []).find(samePanel)
      if (receiptFrames.find(samePanel)?.mvuViewUsed === true || (existingFrame && existingFrame.mvuViewUsed === true)) capture.mvuViewUsed = true
      if (existingFrame && capture.mvuViewUsed === true && capture.dom === '' && capture.console.length === 0 && capture.network.length === 0 && capture.errors.length === 0) {
        capture = Object.assign({}, existingFrame, {
          capturedAt: capture.capturedAt,
          captureKind: capture.captureKind,
          mvuViewUsed: true
        })
      }
      const frame = Object.assign({ partIndex: index }, capture)
      const nextReceipt = displayRuntimeReceipt(receiptFrames.filter(function (item) { return !samePanel(item) }).concat([frame]))
      const receiptChanged = JSON.stringify(receipt) !== JSON.stringify(nextReceipt)
      if (existingFrame && sameDisplayRuntimeCapture(existingFrame, capture) && !receiptChanged) return { captured: false, turn, partIndex: index, captureKind: capture.captureKind }
      await displayRuntimeStore.mergeFrame(chat.id, turn, frame, { reset: !receipt, sourceActivityAt, seed: inline && Array.isArray(inline.frames) ? inline.frames : [] })
      if (!receiptChanged) return { captured: true, turn, partIndex: index, captureKind: capture.captureKind }
      const changes = [{ op: 'set', path: ['messages', chat.messageIndex, 'displayRuntime'], value: nextReceipt }]
      // Diagnostic captures preserve a valid undo point, never revive a stale one.
      if (chat.rollbackUndo?.ready && chat.rollbackUndo.storageRevision === chat._storageRevision) {
        changes.push({ op: 'set', path: ['rollbackUndo', 'storageRevision'], value: chat._storageRevision + 1 })
      }
      const saved = await patchChat(chat.id, chat._storageRevision, changes, { source: 'display.capture', touchUpdatedAt: false })
      if (saved) return { captured: true, turn, partIndex: index, captureKind: capture.captureKind }
    }
    throw new Error('状态栏诊断保存时对话持续变化，请稍后重试')
  }
  return captureDisplayRuntime
}
