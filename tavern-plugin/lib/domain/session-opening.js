import { createHash } from 'node:crypto'
import { cardOpeningChoices, cardOpeningSwipes } from './card-openings.js'
import { nativeOpeningMessageId } from './native-opening.js'
import { sessionEvents } from './session-events.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { isNewTurnInput } from './session-turn-input.js'
import { projectOpeningCommit } from './runtime-content-projection.js'
import { projectReplyLayers } from './reply-presentation.js'
import { replyProse, writeReplyProse } from './reply-prose.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'

/** Only an untouched greeting may switch openings. */
export function sessionOpeningDescriptor(chat, card) {
  const messages = chat?.messages || []
  if (!['story', 'script'].includes(chat?.mode) || messages.length !== 1 || messages[0]?.greeting !== true) return null
  if (chat.regenInProgress || Object.values(chat.timeline?.operations || {}).some(op => op.status === 'running')) return null
  const { swipes, openingIds } = cardOpeningSwipes(card)
  const text = messages[0].sourceText ?? messages[0].text
  const selectedIndex = messages[0].openingChoiceId
    ? openingIds.indexOf(messages[0].openingChoiceId) : swipes.indexOf(text)
  if (selectedIndex < 0 || !openingIds[selectedIndex] || openingIds.filter(Boolean).length < 2) return null
  // Card/Helper reloads can change the script lifecycle while the opening stays intact.
  const version = createHash('sha256').update(JSON.stringify([
    chat.id, messages[0].openingSelectionRevision, text, selectedIndex, openingIds, swipes
  ])).digest('hex')
  return { swipes, selectedIndex, characterName: card.name, openingIds, version }
}

export function selectSessionOpening({ chat, card, swipeId, message, expectedOpeningVersion }) {
  const descriptor = sessionOpeningDescriptor(chat, card)
  if (!descriptor) throw new Error('已有剧情的对话不能切换开场，请新开游戏')
  if (expectedOpeningVersion !== undefined && expectedOpeningVersion !== descriptor.version) {
    throw new Error('开场白已变化，请重新选择')
  }
  if (!Number.isInteger(swipeId) || !descriptor.openingIds[swipeId] ||
      (message !== undefined && descriptor.swipes[swipeId] !== message)) throw new Error('只能选择人物卡已有开场')
  return { id: descriptor.openingIds[swipeId], text: descriptor.swipes[swipeId], current: descriptor.selectedIndex === swipeId }
}

export function assertOpeningIdle({ session, agent }) {
  if (agent?.phase?.kind === 'running' || sessionEvents(session).some(event =>
    isNewTurnInput(event) ||
    (event.type === 'user/message' && event.data?.source?.kind === 'human' && event.surfaceOp === 'append') ||
    (event.type === 'assistant/message' && event.data?.turn > 1 && event.surfaceOp === 'append'))) {
    throw new Error('首轮已开始，请新开游戏切换开场')
  }
}

function textOf(message) {
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('')
}

// Select the current surface event, including the most recent replacement.
// Old saves used a UUID for the original turn-one greeting.
export function findSessionOpening(session, chat) {
  const nodes = new Set(session.surface?.nodes)
  const id = nativeOpeningMessageId(chat.id)
  const events = sessionEvents(session).filter(event => nodes.has(event.seq) && event.type === 'assistant/message')
  return events.find(event => event.data.message.id === id) || events.find(event => {
    const message = event.data.message
    if (chat.nativeOpeningSwitch) return message.id === chat.nativeOpeningSwitch.messageId
    return event.data.turn === 1 && event.data.step === 1 &&
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(message.id) && textOf(message) === (chat.openingText ?? chat.messages?.[0]?.text)
  })
}

export function replaceSessionOpening(session, chat) {
  const opening = findSessionOpening(session, chat)
  if (!opening) throw new Error('找不到本局开场白的原生消息')
  const { message } = opening.data
  if (textOf(message) === chat.openingText) return
  replaceSessionSurface(session, 'assistant/message', {
    turn: opening.data.turn,
    step: opening.data.step,
    message: { ...message, id: nativeOpeningMessageId(chat.id), content: [{ type: 'text', text: chat.openingText }] }
  }, { start: opening.seq, end: opening.seq, sourceEventSeqs: [opening.seq] })
}

/** Rename authored player slots in the frozen opening, leaving other macro output alone. */
export function renameOpeningPlayerSlots(row, { previousName, playerName, charName }) {
  if (!row?.greeting || typeof row.sourceText !== 'string' || typeof row.projectionText !== 'string') return null
  const segments = [['']]
  const tokens = row.sourceText.split(/(\{\{[^{}]*\}\}|<(?:user|char)>)/gi)
  for (let index = 0; index < tokens.length; index++) {
    const text = tokens[index], parts = segments.at(-1)
    if (index % 2 === 0) {
      if (/\{\{|\}\}/.test(text)) return null
      parts[parts.length - 1] += text
    } else if (/^(?:\{\{\s*user\s*\}\}|<user>)$/i.test(text)) parts.push('')
    else if (/^(?:\{\{\s*char\s*\}\}|<char>)$/i.test(text)) parts[parts.length - 1] += charName
    else segments.push([''])
  }
  if (!segments.some(parts => parts.length > 1)) return null
  const value = row.projectionText
  if (segments.length === 1) {
    // Infer the name actually rendered, including saves renamed by older versions.
    const parts = segments[0]
    const length = (value.length - parts.join('').length) / (parts.length - 1)
    if (!Number.isInteger(length) || length < 1) return null
    const renderedName = value.slice(parts[0].length, parts[0].length + length)
    return parts.join(renderedName) === value ? parts.join(playerName) : null
  }
  // Stateful and random macros separate literal runs. Only rewrite a run when
  // its earliest and latest possible positions agree in the saved projection.
  const chunks = segments.map(parts => parts.join(previousName))
  const end = value.length - chunks.at(-1).length
  if (!value.startsWith(chunks[0]) || !value.endsWith(chunks.at(-1))) return null
  const positions = [0]
  let cursor = chunks[0].length
  for (const chunk of chunks.slice(1, -1)) {
    const at = value.indexOf(chunk, cursor)
    if (at < 0 || at + chunk.length > end) return null
    positions.push(at)
    cursor = at + chunk.length
  }
  if (cursor > end) return null
  positions.push(end)
  cursor = end
  for (let index = chunks.length - 2; index > 0; index--) {
    cursor = value.lastIndexOf(chunks[index], cursor - chunks[index].length)
    if (cursor < positions[index] || (segments[index].length > 1 && cursor !== positions[index])) return null
  }
  let renamed = ''
  cursor = 0
  for (const [index, parts] of segments.entries()) {
    if (parts.length === 1) continue
    renamed += value.slice(cursor, positions[index]) + parts.join(playerName)
    cursor = positions[index] + chunks[index].length
  }
  return renamed + value.slice(cursor)
}

// The host captures pre-step input before Tavern's hook can finish a pending
// switch. Keep the captured request aligned with the live opening replacement.
export function projectSessionOpening(session, chat, decision) {
  if (!chat || !['story', 'script'].includes(chat.mode)) return decision
  const id = nativeOpeningMessageId(chat.id)
  const index = decision.messages?.findIndex(message => message.id === id ||
    (message.source?.provider === 'dsh-tavern' && message.source?.model === 'character-card'))
  if (!(index >= 0)) return decision
  const nodes = session.surface?.nodes
  if (!nodes?.length) return decision
  const read = typeof session.eventAt === 'function' ? seq => session.eventAt(seq) : (() => {
    const events = new Map(sessionEvents(session).map(event => [event.seq, event]))
    return seq => events.get(seq)
  })()
  let opening
  for (const seq of nodes) {
    const event = read(seq)
    if (event?.type !== 'assistant/message' || event.data?.message?.id !== id) continue
    opening = event
    break
  }
  if (opening?.surfaceOp?.op !== 'replace' || opening.data.message.source?.model !== 'character-card') return decision
  const messages = decision.messages.slice()
  messages[index] = opening.data.message
  return { ...decision, messages }
}

export function createSessionOpeningChanges({ chats, cards, native, scriptContinuity, serialize }) {
  // Chat is the durable selection. Reopen and first submission can finish an
  // interrupted write to the DSH history using this same operation.
  async function recover(chat, target) {
    if (!chat?.nativeOpeningSwitch) return chat
    target ||= await native.wait(chat.sessionId)
    replaceSessionOpening(target.session, chat)
    await native.flush(target.session)
    return await chats.update(chat.id, current => {
      if (current.nativeOpeningSwitch?.messageId !== chat.nativeOpeningSwitch.messageId) return
      delete current.nativeOpeningSwitch
      return current
    }, { source: 'opening.switch-synced', touchUpdatedAt: false }) || chat
  }

  async function persist(chat, target, source, mutate) {
    const saved = await chats.update(chat.id, current => {
      const greeting = mutate(current)
      if (greeting) current.nativeOpeningSwitch = { messageId: greeting.data.message.id }
      return current
    }, { source })
    await recover(saved, target)
    return saved
  }

  async function switchOpening(sessionId, input) {
    native.assertReplacementAllowed()
    const original = await chats.resolve(sessionId)
    if (!original) throw new Error('找不到游玩对话')
    const target = await native.wait(sessionId)
    assertOpeningIdle(target)
    const chat = await recover(original, target)
    const card = await cards.readChat(chat)
    const selection = selectSessionOpening({ ...input, chat, card })
    const lifecycle = Number(chat.tavernHelperLifecycleRevision) || 0
    if (input.expectedOpeningVersion === undefined && input.expectedLifecycleRevision !== lifecycle) throw new Error('开场白已变化，请重新选择')
    if (selection.current) return { selectedIndex: input.swipeId, lifecycleRevision: lifecycle, openingVersion: sessionOpeningDescriptor(chat, card).version }
    const [extensions, script] = await Promise.all([
      cards.extensions(chat.cardPath, chat),
      chat.mode === 'script' ? cards.script(chat.cardPath) : null
    ])
    if (extensions?.openingSetup) throw new Error('此卡的开局表单需要在开局时选择')
    const saved = await persist(chat, target, 'opening.switch', current => {
      assertOpeningIdle(target)
      if ((Number(current.tavernHelperLifecycleRevision) || 0) !== lifecycle) throw new Error('开局状态已变化，请重新选择')
      selectSessionOpening({ ...input, chat: current, card })
      const nativeGreeting = findSessionOpening(target.session, current)
      if (!nativeGreeting) throw new Error('找不到本局开场白的原生消息')
      const projection = projectOpeningCommit(selection.text, {
        charName: card.name,
        macroState: { userName: current.macroState.userName, local: {}, global: {} },
        regexScripts: composeTavernRegexScripts(extensions, current.runtimePresetSnapshot?.regexScripts, current.regexOverrides?.preset),
        regexPlacement: 2, isEdit: false, depth: 0
      })
      const choices = cardOpeningChoices(card)
      const row = current.messages[0]
      const greeting = {
        ...replyProse(selection.text, projection),
        role: 'assistant', greeting: true, turn: 1, ts: row.ts, stagePageVersion: row.stagePageVersion,
        openingChoiceId: selection.id, openingSelectionRevision: lifecycle + 1
      }
      if (row.messageUid) greeting.messageUid = row.messageUid
      if (current.mvu?.enabled) {
        greeting.swipes = choices.map(choice => choice.text)
        greeting.swipeId = choices.findIndex(choice => choice.id === selection.id)
        greeting.variables = choices.map(() => ({}))
        greeting.mvu = { modified: false, diagnostics: [], events: [] }
        current.mvu = { ...current.mvu, diagnostics: [], openingInitialization: { version: 2, status: 'pending' } }
      }
      current.messages = [greeting]
      current.openingText = projection.sessionText || '\u3000'
      current.macroState = projection.macroState
      current.presentationWarnings = projection.warnings
      current.variables = {}
      delete current.tavernPluginMetadata
      delete current.tavernScriptPrompts
      if (script) {
        const chunkSize = current.scriptState?.chunkSize
        current.scriptState = scriptContinuity.startAligned(script, projection.sessionText, card.script_start)
        if (chunkSize !== undefined) current.scriptState = scriptContinuity.transition({
          script, state: current.scriptState, event: { kind: 'set-chunk-size', chunkSize }
        }).state
      }
      current.tavernHelperLifecycleRevision = lifecycle + 1
      return nativeGreeting
    })
    return { selectedIndex: input.swipeId, lifecycleRevision: lifecycle + 1, openingVersion: sessionOpeningDescriptor(saved, card).version }
  }

  async function setPlayerName(sessionId, userName) {
    let chat = await chats.resolve(sessionId)
    if (!chat) throw new Error('当前会话没有绑定人物卡')
    if (chat.mode === 'card') throw new Error('卡片工作台不使用玩家称呼')
    chat = await recover(chat)
    const name = String(userName ?? '').trim().slice(0, 80) || '你'
    const opening = chat.messages[0]
    const previousName = String(chat.macroState?.userName ?? '') || '你'
    const projectionText = renameOpeningPlayerSlots(opening, { previousName, playerName: name, charName: String(chat.cardName ?? '') })
    const changed = projectionText !== null && projectionText !== opening.projectionText
    const extensions = changed ? await cards.extensions(chat.cardPath, chat) : null
    const target = changed && chat.nativeOpeningAppended ? await native.wait(sessionId) : null
    await persist(chat, target, 'player-name.set', current => {
      let replacedGreeting
      if (changed) {
        const row = current.messages[0]
        if (!row?.greeting || row.sourceText !== opening.sourceText || row.projectionText !== opening.projectionText) {
          throw new Error('开场白已变化，请重新保存玩家称呼')
        }
        if (target?.agent?.phase?.kind === 'running' || current.regenInProgress) throw new Error('请等当前生成结束后再修改玩家称呼')
        const projection = projectReplyLayers(row.sourceText, {
          projectionText, charName: current.cardName, macroState: { userName: name },
          regexScripts: composeTavernRegexScripts(extensions, current.runtimePresetSnapshot?.regexScripts, current.regexOverrides?.preset),
          placement: 2, isEdit: false, depth: 0
        })
        const nativeGreeting = target && findSessionOpening(target.session, current)
        if (nativeGreeting && projection.sessionText !== current.openingText) {
          native.assertReplacementAllowed()
          replacedGreeting = nativeGreeting
        }
        current.openingText = projection.sessionText
        writeReplyProse(row, row.sourceText, projection)
        delete row.displayRuntime
        if (row.tavernPluginData) {
          delete row.tavernPluginData.template_display
          delete row.tavernPluginData.template_rendered
        }
      }
      current.macroState = { local: {}, global: {}, ...current.macroState, userName: name }
      return replacedGreeting
    })
    return name
  }

  return Object.freeze({
    recover,
    switchOpening: (sessionId, input) => serialize(sessionId, () => switchOpening(sessionId, input)),
    setPlayerName: (sessionId, userName) => serialize(sessionId, () => setPlayerName(sessionId, userName)),
    request: Object.freeze({
      beforeFirstStep: sessionId => serialize(sessionId, async () => {
        await recover(await chats.openingSwitchState(sessionId))
      }),
      project: projectSessionOpening
    })
  })
}
