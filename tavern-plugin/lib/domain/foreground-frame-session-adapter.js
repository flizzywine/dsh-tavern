import { foregroundFrameText } from './agent-input-frame.js'
import { worldbookSnapshot } from './worldbook-snapshot.js'
import { cardSystemPromptSnapshot, cardSystemPromptSource } from './card-system-prompt.js'
import { dialogueFormatUpdate } from './dialogue-format.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function frameIdOf(message) {
  const source = message && message.source
  return str(source && source.trace && source.trace.frameId)
}

/** Adapt one ForegroundFrame to the current DSH agent/pre-step message seam. */
export function createForegroundFrameSessionAdapter(options = {}) {
  const makeId = typeof options.id === 'function' ? options.id : function () { return crypto.randomUUID() }

  function append(input = {}) {
    const messages = Array.isArray(input.messages) ? input.messages : []
    const frame = input.frame
    if (!frame || frame.kind !== 'foreground') throw new Error('Session Adapter 只接受 ForegroundFrame')
    if (Number(input.step) !== 1) return { messages, receipt: { appended: false, reason: 'not-first-step', frameId: frame.frameId } }
    if (messages.some(function (message) { return frameIdOf(message) === frame.frameId })) {
      return { messages, receipt: { appended: false, reason: 'duplicate', frameId: frame.frameId } }
    }
    const snapshot = worldbookSnapshot(input.session, frame.contributions
      .filter(item => item.slot === 'activeWorldbook').map(item => item.text).join('\n\n'), input.historyMessages || messages)
    const contributions = frame.contributions.filter(item => item.slot !== 'activeWorldbook')
    const snapshots = snapshot ? [{
      id: makeId() + ':worldbook', role: 'user',
      content: [{ type: 'text', text: snapshot.rendered }],
      source: { kind: 'plugin:dsh-tavern', form: 'worldbook-snapshot',
        worldbookSnapshot: snapshot, trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId } }
    }] : []
    if (typeof frame.source?.card?.systemPromptText === 'string') {
      const update = cardSystemPromptSnapshot(input.session, frame.source.card.systemPromptText, input.historyMessages || messages, input.openingText)
      if (update) snapshots.push({
        id: makeId() + ':card-system-prompt', role: 'user',
        content: [{ type: 'text', text: update.rendered }],
        source: { kind: 'plugin:dsh-tavern', form: 'card-system-prompt-update',
          trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId, ...cardSystemPromptSource(update) } }
      })
    }
    if (typeof frame.source?.dialogueFormatText === 'string') {
      const update = dialogueFormatUpdate(input.session, frame.source.dialogueFormatText, input.historyMessages || messages)
      if (update) snapshots.push({
        id: makeId() + ':dialogue-format', role: 'user',
        content: [{ type: 'text', text: update.rendered }],
        source: { kind: 'plugin:dsh-tavern', form: 'dialogue-format-update',
          trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId, dialogueFormatSnapshot: update } }
      })
    }
    const text = foregroundFrameText({ contributions })
    if (text === '') return { messages: messages.concat(snapshots), receipt: { appended: snapshots.length > 0, reason: snapshots.length ? 'appended' : 'empty', frameId: frame.frameId } }
    const sections = contributions.map(function (item, index) {
      return {
        name: 'tavern:foreground:' + str(item.slot) + ':' + (index + 1),
        text: str(item.text),
        source: item.source
      }
    })
    return {
      messages: messages.concat(snapshots, [{
        id: makeId(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin:dsh-tavern',
          form: 'foreground-frame',
          sections,
          trace: {
            frameId: frame.frameId,
            chatId: frame.chatId,
            branchId: frame.branchId,
            basedOnRevision: frame.basedOnRevision,
            operationId: frame.operationId,
            turn: frame.turn
          }
        }
      }]),
      receipt: { appended: true, reason: 'appended', frameId: frame.frameId }
    }
  }

  return Object.freeze({ append })
}
