import {
  lastTavernHelperVariables,
  projectTavernHelperContext,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from './tavern-helper-context.js'
import {
  projectTavernHelperWorldbook,
  replaceTavernHelperWorldbookOperations
} from './tavern-helper-worldbook.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isOfficialMvuData(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.stat_data !== undefined && value.schema !== undefined
}

/**
 * Translate the Tavern-shaped host API exposed to card scripts into mutations
 * of dsh-tavern's authoritative chat and worldbook state.
 */
export function createTavernScriptHostAdapter(options = {}) {
  const mutationTails = new Map()

  function assertDependencies() {
    for (const name of ['resolveChat', 'writeChat', 'readCard', 'worldBooks', 'eventGate']) {
      if (!options[name]) throw new Error('Tavern Script Host Adapter 缺少依赖: ' + name)
    }
  }
  assertDependencies()

  function assertMvuEnabled(chat) {
    if (!chat || !chat.mvu || chat.mvu.enabled !== true) throw new Error('当前人物卡未启用 MVU 兼容运行时')
  }

  function mutationIsCurrent(chat, expectedLifecycleRevision) {
    if (expectedLifecycleRevision === undefined || expectedLifecycleRevision === null) return true
    return Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0) === Math.max(0, Number(expectedLifecycleRevision) || 0)
  }

  function staleMutation(chat) {
    return { updated: false, stale: true, context: projectTavernHelperContext(chat) }
  }

  async function resolveChat(sessionId) {
    const chat = await options.resolveChat(str(sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    return chat
  }

  async function updateVariables(sessionId, option, variables, expectedLifecycleRevision) {
    const chat = await resolveChat(sessionId)
    assertMvuEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const updated = replaceTavernHelperVariables(chat, { option, variables })
    try { await options.writeChat(chat, { source: 'tavern-helper.variables' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, target: updated, context: projectTavernHelperContext(chat) }
  }

  async function updateMessages(sessionId, messages, expectedLifecycleRevision) {
    const chat = await resolveChat(sessionId)
    assertMvuEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const updated = replaceTavernHelperMessages(chat, messages)
    if (chat.mvu && chat.mvu.owner === 'official') {
      const opening = Array.isArray(chat.messages) ? chat.messages[0] : null
      const snapshots = opening && Array.isArray(opening.variables) ? opening.variables : []
      if (snapshots.length > 0 && snapshots.every(isOfficialMvuData)) {
        chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: Date.now() }
      }
    }
    try { await options.writeChat(chat, { source: 'tavern-helper.messages' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, targets: updated, context: projectTavernHelperContext(chat) }
  }

  async function worldbookRecord(sessionId, requestedName) {
    const chat = await resolveChat(sessionId)
    assertMvuEnabled(chat)
    const card = await options.readCard(chat)
    const record = await options.worldBooks.bound(chat.cardPath, card)
    if (record === null) throw new Error('当前人物卡没有绑定世界书')
    const name = str(requestedName).trim()
    if (name !== '' && name !== 'current' && name !== str(record.view.displayName)) {
      throw new Error('当前兼容层只能访问人物卡绑定的世界书: ' + name)
    }
    return { chat, record }
  }

  async function serializeWorldbook(cardPath, work) {
    const key = str(cardPath)
    const previous = mutationTails.get(key) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    mutationTails.set(key, current)
    try { return await current }
    finally { if (mutationTails.get(key) === current) mutationTails.delete(key) }
  }

  async function getWorldbook(sessionId, name) {
    const resolved = await worldbookRecord(sessionId, name)
    return { worldbook: projectTavernHelperWorldbook(resolved.record.view) }
  }

  async function replaceWorldbook(sessionId, name, entries) {
    const chat = await resolveChat(sessionId)
    return await serializeWorldbook(chat.cardPath, async function () {
      const resolved = await worldbookRecord(sessionId, name)
      const operations = replaceTavernHelperWorldbookOperations(resolved.record.view, entries)
      const updated = operations.length === 0
        ? resolved.record
        : await options.worldBooks.update(resolved.record.source, { operations })
      return { updated: operations.length > 0, worldbook: projectTavernHelperWorldbook(updated.view) }
    })
  }

  async function context(sessionId, chatValue, transientUserText = '') {
    const chat = chatValue || await resolveChat(sessionId)
    const draft = structuredClone(chat)
    const userText = str(transientUserText).trim()
    if (userText !== '') {
      const previousVariables = lastTavernHelperVariables(draft.messages)
      const message = { role: 'user', text: userText, swipeId: 0, swipes: [userText], variables: [] }
      if (previousVariables !== undefined) message.variables = [structuredClone(previousVariables)]
      draft.messages.push(message)
    }
    const projected = projectTavernHelperContext(draft)
    try {
      const resolved = await worldbookRecord(sessionId, 'current')
      projected.worldbook = projectTavernHelperWorldbook(resolved.record.view)
    } catch {}
    return projected
  }

  async function dispatchEvent(input = {}) {
    const eventContext = input.context || await context(input.sessionId, input.chat, input.transientUserText)
    return await options.eventGate.dispatch(input.sessionId, input.name, input.args, eventContext)
  }

  async function switchSwipe(sessionId, messageId, swipeId) {
    const chat = await resolveChat(sessionId)
    if (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat)) throw new Error('当前会话没有绑定游玩对话')
    const updated = replaceTavernHelperMessages(chat, [{ message_id: messageId, swipe_id: swipeId }])
    chat.tavernHelperLifecycleRevision = Math.max(0, Number(chat.tavernHelperLifecycleRevision) || 0) + 1
    chat.updatedAt = Date.now()
    await options.writeChat(chat, { source: 'tavern.swipe' })
    await dispatchEvent({ sessionId: chat.sessionId, chat, name: 'MESSAGE_SWIPED', args: [Number(messageId)] })
    return { updated: true, target: updated[0] || null }
  }

  return Object.freeze({
    context,
    dispatchEvent,
    updateVariables,
    updateMessages,
    switchSwipe,
    getWorldbook,
    replaceWorldbook,
    pollEvent: function (sessionId, runtimeId, ready) { return options.eventGate.poll(sessionId, runtimeId, ready) },
    completeEvent: function (sessionId, eventId, args, runtimeId) { return options.eventGate.complete(sessionId, eventId, args, runtimeId) },
    releaseRuntime: function (sessionId, runtimeId) { return options.eventGate.dispose(sessionId, runtimeId) }
  })
}
