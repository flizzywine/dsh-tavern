import { worldbookContextDelta } from './worldbook-context-delta.js'
import { foregroundFrameText } from './agent-input-frame.js'
import { worldbookSnapshot } from './worldbook-snapshot.js'
import { promptSection, promptSectionBody } from './prompt-section.js'
import { liveContextUpdate, cardSystemPromptSnapshot, cardSystemPromptSource } from './card-system-prompt.js'
import playFeatures from '../../shared/play-features.cjs'

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
    const virtual = frame.source?.worldBook?.virtualWorldbook
    // Native virtual projection already deduplicates by entry identity+hash;
    // two distinct entries with identical text still need their own receipt.
    const entries = frame.contributions.filter(item => item.slot === 'activeWorldbook').flatMap((item, index) =>
      item.entries || [{ ref: JSON.stringify(['section', item.source?.stage, item.source?.plugin, item.source?.name, index]), text: promptSectionBody('lorebook_activated', promptSectionBody('lorebook_constant', item.text)) }])
    const snapshot = worldbookSnapshot(virtual ? null : input.session, entries, virtual ? [] : input.historyMessages || messages)
    const delta = snapshot && virtual ? worldbookContextDelta(input.session, virtual, snapshot.rendered, input.historyMessages || messages) : null
    if (delta) snapshot.rendered = delta.text
    const isFixedRule = item => item.source?.stage === 'mvu-background-owner' ||
      (item.source?.stage === 'context-plan' && item.source?.sectionKind === 'base')
    const fixedRules = frame.contributions.filter(isFixedRule).map(item => item.text).join('\n\n')
    const previousRules = liveContextUpdate(input.session, 'writingRulesSnapshot', input.historyMessages || messages)
    const rulesChanged = fixedRules !== (previousRules?.text || '')
    const contributions = frame.contributions.filter(item => item.slot !== 'activeWorldbook' && !isFixedRule(item)
      && (playFeatures.storyLedger || item.source?.stage !== 'ledger')
      && (playFeatures.postureSummary || item.source?.stage !== 'context-plan' || item.source?.sectionKind !== 'posture'))
    const snapshots = snapshot ? [{
      id: makeId() + ':worldbook', role: 'user',
      content: [{ type: 'text', text: snapshot.rendered }],
      source: { kind: 'plugin:dsh-tavern', form: 'worldbook-snapshot',
        worldbookSnapshot: snapshot, ...(delta ? { worldbookEntrySnapshots: delta.records } : {}), ...(frame.source?.worldBook?.virtualWorldbook ? { virtualWorldbook: frame.source.worldBook.virtualWorldbook } : {}), trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId } }
    }] : []
    if (rulesChanged) {
      const rendered = '【正文固定规则】\n以下规则持续有效，替代此前同名规则；直到另行更新。\n' + (fixedRules || '此前正文固定规则已撤回。')
      snapshots.push({ id: makeId() + ':writing-rules', role: 'user', content: [{ type: 'text', text: rendered }],
        source: { kind: 'plugin:dsh-tavern', form: 'writing-rules', trace: { frameId: frame.frameId,
          writingRulesSnapshot: { schemaVersion: 1, text: fixedRules, rendered } } } })
    }
    if (typeof frame.source?.card?.systemPromptText === 'string') {
      const update = cardSystemPromptSnapshot(input.session, frame.source.card.systemPromptText, input.historyMessages || messages, input.openingText)
      if (update) snapshots.push({
        id: makeId() + ':card-system-prompt', role: 'user',
        content: [{ type: 'text', text: update.rendered }],
        source: { kind: 'plugin:dsh-tavern', form: 'card-system-prompt-update',
          trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId, ...cardSystemPromptSource(update) } }
      })
    }
    // What changed in the foreground capabilities since the live context told the model (foreground-capabilities.js):
    // its own message, whose trace record the next turns read back to send only newer changes.
    const capabilityUpdate = frame.source?.foregroundCapabilityUpdate
    if (capabilityUpdate?.rendered) snapshots.push({
      id: makeId() + ':foreground-capability-update', role: 'user',
      content: [{ type: 'text', text: capabilityUpdate.rendered }],
      source: { kind: 'plugin:dsh-tavern', form: 'foreground-capability-update',
        trace: { frameId: frame.frameId, turn: frame.turn, operationId: frame.operationId, foregroundCapabilityUpdate: capabilityUpdate } }
    })
    const playerName = frame.source?.playerName
    if (playerName && playerName !== liveContextUpdate(input.session, 'playerIdentity', input.historyMessages || messages)?.name) {
      const rendered = promptSection('player_identity', 'The current player is ' + JSON.stringify(playerName) + '. Use this name for the player’s actions and dialogue from this turn onward. This updates all earlier statements of the player’s name.')
      snapshots.push({
        id: makeId() + ':player-identity', role: 'user', content: [{ type: 'text', text: rendered }],
        source: { kind: 'plugin:dsh-tavern', form: 'player-identity', trace: { frameId: frame.frameId,
          playerIdentity: { schemaVersion: 1, name: playerName, rendered } } }
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
