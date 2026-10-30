import { createScopedMessages } from './scoped-messages.js'
import { participantOf } from './background-members.js'
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function storageRevision(chat) {
  return Math.max(0, Number(chat && chat._storageRevision) || 0)
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function sameBasedOn(left, right) {
  return str(left && left.branchId) === str(right && right.branchId) && Number(left && left.revision) === Number(right && right.revision)
}

// The participant (resident Session) a role binds: its background member (background-members.js).
function participantRole(role) {
  return participantOf(role)
}

function participantLifetime(value) {
  return value === 'one-shot' ? 'one-shot' : 'chat'
}

function persistentParticipant(value) {
  return value === 'chat' || value === 'branch'
}

export function createStoryTimeline(options = {}) {
  const makeId = typeof options.id === 'function' ? options.id : function (prefix) { return prefix + '-' + Math.random().toString(36).slice(2) }
  const now = typeof options.now === 'function' ? options.now : Date.now

  function ensure(source) {
    const chat = clone(source || {})
    const incoming = object(chat.timeline)
    if (Number(incoming.schemaVersion) !== 1) {
      const branchId = makeId('branch')
      const participants = {}
      const legacy = object(chat.candidateAgent)
      if (str(legacy.sessionId) !== '') {
        participants.background = {
          role: 'background', lifetime: 'chat', sessionId: str(legacy.sessionId),
          branchId, syncedRevision: 0, boundary: Number.isSafeInteger(legacy.boundary) ? legacy.boundary : null,
          status: 'current', rewindTo: null, updatedAt: Number(legacy.updatedAt) || now()
        }
      }
      chat.timeline = {
        schemaVersion: 1,
        branchId,
        revision: 0,
        checkpoints: [],
        participants,
        operations: {},
        updatedAt: now()
      }
      return chat
    }
    incoming.branchId = str(incoming.branchId) || makeId('branch')
    incoming.revision = Math.max(0, Number(incoming.revision) || 0)
    incoming.checkpoints = Array.isArray(incoming.checkpoints) ? incoming.checkpoints : []
    incoming.participants = object(incoming.participants)
    if (incoming.participants.background === undefined) {
      const legacyParticipant = incoming.participants.candidate || incoming.participants.settlement
      if (legacyParticipant !== undefined) incoming.participants.background = Object.assign({}, legacyParticipant, { role: 'background' })
    }
    delete incoming.participants.candidate
    delete incoming.participants.settlement
    for (const role of Object.keys(incoming.participants)) {
      const participant = object(incoming.participants[role])
      participant.lifetime = participantLifetime(participant.lifetime)
      const legacyFork = object(participant.forkFrom)
      if (participant.status === 'needs-branch' && str(participant.sessionId) === '' && str(legacyFork.sessionId) !== '' && Number.isSafeInteger(legacyFork.boundary)) {
        participant.sessionId = legacyFork.sessionId
        participant.boundary = legacyFork.boundary
        participant.status = 'needs-rewind'
        participant.rewindTo = legacyFork.boundary
      }
      delete participant.forkFrom
      incoming.participants[role] = participant
    }
    incoming.operations = object(incoming.operations)
    incoming.updatedAt = Number(incoming.updatedAt) || now()
    chat.timeline = incoming
    // v1 原子 Round 存档把正文停在 foreground-completed，等待结算后才建 checkpoint。
    // 新语义下正文本身就是提交边界；惰性迁移可让既有失败轮次立即继续游玩。
    const legacyForeground = Object.values(incoming.operations).filter(function (operation) {
      return operation && operation.kind === 'body' && operation.status === 'foreground-completed' &&
        str(operation.basedOn && operation.basedOn.branchId) === incoming.branchId
    }).sort(function (left, right) {
      return (Number(left.foregroundCompletedAt) || Number(left.createdAt) || 0) - (Number(right.foregroundCompletedAt) || Number(right.createdAt) || 0)
    })
    for (const operation of legacyForeground) commitBody(chat, operation)
    return chat
  }

  function basedOn(chat) {
    return { branchId: chat.timeline.branchId, revision: chat.timeline.revision }
  }

  function snapshot(chat) {
    return clone({
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      presentation: chat.presentation === undefined ? null : chat.presentation,
      presentationWarnings: Array.isArray(chat.presentationWarnings) ? chat.presentationWarnings : [],
      macroState: chat.macroState === undefined ? null : chat.macroState,
      variables: chat.variables,
      tavernPluginMetadata: chat.tavernPluginMetadata,
      tavernHelperScriptVariables: chat.tavernHelperScriptVariables,
      tavernScriptPrompts: chat.tavernScriptPrompts || [],
      runtimeInputs: chat.runtimeInputs === undefined ? null : chat.runtimeInputs,
      posture: str(chat.posture),
      ledger: chat.ledger || null,
      scriptState: chat.scriptState === undefined ? null : chat.scriptState,
      candidates: chat.candidates === undefined ? null : chat.candidates,
      settleStatus: str(chat.settleStatus) || 'idle',
      settleError: chat.settleError === undefined ? null : chat.settleError,
      lastSettle: chat.lastSettle === undefined ? null : chat.lastSettle,
      preparedWorldBookContext: str(chat.preparedWorldBookContext),
      preparedWorldBook: chat.preparedWorldBook === undefined ? null : chat.preparedWorldBook,
      worldBookReads: chat.worldBookReads === undefined ? null : chat.worldBookReads,
      worldBookVirtualState: chat.worldBookVirtualState,
      participants: object(chat.timeline).participants
    })
  }

  function restore(chat, state) {
    const source = object(state)
    chat.messages = clone(Array.isArray(source.messages) ? source.messages : [])
    chat.presentation = clone(source.presentation === undefined ? null : source.presentation)
    chat.presentationWarnings = clone(Array.isArray(source.presentationWarnings) ? source.presentationWarnings : [])
    if (Object.hasOwn(source, 'macroState')) chat.macroState = clone(source.macroState)
    // These chat-local values belong to the story, unlike model/UI settings.
    // Absence in the historical state must also remove values created later.
    for (const key of ['variables', 'tavernPluginMetadata', 'tavernHelperScriptVariables']) {
      if (Object.hasOwn(source, key)) chat[key] = clone(source[key])
      else delete chat[key]
    }
    if (Object.hasOwn(source, 'runtimeInputs')) chat.runtimeInputs = clone(source.runtimeInputs)
    chat.tavernScriptPrompts = clone(source.tavernScriptPrompts || [])
    chat.posture = str(source.posture)
    chat.ledger = clone(source.ledger || null)
    chat.scriptState = clone(source.scriptState === undefined ? null : source.scriptState)
    chat.candidates = clone(source.candidates === undefined ? null : source.candidates)
    chat.settleStatus = str(source.settleStatus) || 'idle'
    chat.settleError = clone(source.settleError === undefined ? null : source.settleError)
    chat.lastSettle = clone(source.lastSettle === undefined ? null : source.lastSettle)
    chat.preparedWorldBookContext = str(source.preparedWorldBookContext)
    chat.preparedWorldBook = clone(source.preparedWorldBook === undefined ? null : source.preparedWorldBook)
    chat.worldBookReads = clone(source.worldBookReads === undefined ? null : source.worldBookReads)
    if (Object.hasOwn(source, 'worldBookVirtualState')) chat.worldBookVirtualState = clone(source.worldBookVirtualState)
    else delete chat.worldBookVirtualState
  }

  function trimOperations(timeline) {
    const entries = Object.values(timeline.operations).sort(function (left, right) { return (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0) })
    // Only finished history is trimmed: an old running or deferred operation (and the
    // round it belongs to) must still be found when it completes or resumes.
    const retained = new Set(entries.filter(operation => ['running', 'deferred'].includes(operation.status))
      .flatMap(operation => [operation.id, operation.roundOperationId].filter(Boolean)))
    for (const operation of entries.slice(80)) if (!retained.has(operation.id)) delete timeline.operations[operation.id]
  }

  function operationValue(operation, participant) {
    return {
      status: 'pending',
      operationId: operation.id,
      role: operation.role,
      basedOn: clone(operation.basedOn),
      participant: participant === undefined ? null : clone(participant)
    }
  }

  function backgroundBody(chat) {
    return Object.values(chat.timeline.operations).filter(function (operation) {
      if (operation.kind !== 'body' || (operation.status !== 'foreground-completed' && operation.status !== 'completed')) return false
      if (str(object(operation.background).phase) === '') return false
      return str(operation.committedBranchId || operation.basedOn && operation.basedOn.branchId) === chat.timeline.branchId
    }).sort(function (left, right) {
      return (Number(right.completedAt) || 0) - (Number(left.completedAt) || 0)
    })[0]
  }

  function pendingSettlementBody(chat) {
    const latest = Object.values(chat.timeline.operations).filter(function (operation) {
      return operation.kind === 'body' && operation.status === 'completed' && str(operation.committedBranchId) === chat.timeline.branchId
    }).sort(function (left, right) {
      return (Number(right.committedRevision) || 0) - (Number(left.committedRevision) || 0)
    })[0]
    // A round is settled against the state it committed. Once a later variable
    // retry has advanced the revision, new settlement work no longer belongs to
    // that round; linking it would make every commit stale.
    return latest !== undefined && ['pending', 'running', 'failed'].includes(str(object(latest.background).phase))
      && Number(latest.committedRevision) === Number(chat.timeline.revision) ? latest : undefined
  }

  function commitBody(chat, operation) {
    chat.timeline.checkpoints.push({
      id: makeId('checkpoint'),
      turn: operation.turn,
      userText: operation.userText,
      beforeRevision: Math.max(0, Number(operation.beforeRevision) || 0),
      participants: clone(operation.beforeParticipants),
      committedAt: now()
    })
    chat.timeline.checkpoints = chat.timeline.checkpoints.slice(-40)
    chat.candidates = null
    chat.timeline.revision++
    operation.status = 'completed'
    operation.completedAt = now()
    operation.committedBranchId = chat.timeline.branchId
    operation.committedRevision = chat.timeline.revision
    operation.background = { phase: 'pending', role: 'settlement', updatedAt: now() }
  }

  function updateBackground(chat, phase, role) {
    const operation = backgroundBody(chat)
    if (operation === undefined) return null
    operation.background = { phase, role, updatedAt: now() }
    return operation
  }

  function updateSettlementBackground(chat, operation, phase) {
    const round = chat.timeline.operations[str(operation && operation.roundOperationId)]
    if (round && round.kind === 'body' && round.status === 'completed') {
      round.background = { phase, role: 'settlement', updatedAt: now() }
      return round
    }
    return updateBackground(chat, phase, 'settlement')
  }

  function beginBody(chat, intent) {
    const turn = Math.max(0, Number(intent.turn) || 0)
    const userText = str(intent.userText).trim()
    const existing = Object.values(chat.timeline.operations).find(function (operation) {
      return operation.kind === 'body' && operation.status === 'running' && Number(operation.turn) === turn
    })
    if (existing !== undefined) {
      if (str(existing.userText) !== userText) {
        const error = new Error('同一正文 operation 对应了不同输入')
        error.code = 'IDEMPOTENCY_CONFLICT'
        throw error
      }
      return operationValue(existing)
    }
    const operation = {
      id: makeId('operation'), kind: 'body', role: 'body', status: 'running', turn, userText,
      basedOn: basedOn(chat), beforeRevision: storageRevision(chat), beforeParticipants: clone(chat.timeline.participants), createdAt: now()
    }
    chat.timeline.operations[operation.id] = operation
    trimOperations(chat.timeline)
    return operationValue(operation)
  }

  function participantRequest(chat, role) {
    const participantKey = participantRole(role)
    const current = object(chat.timeline.participants[participantKey])
    const bound = Object.values(chat.timeline.operations).filter(operation => operation.kind === 'agent'
      && participantRole(operation.role) === participantKey && operation.startedSessionId
      && operation.basedOn.branchId === chat.timeline.branchId
      && operation.basedOn.revision === chat.timeline.revision).at(-1)
    if (current.status === 'current' && current.branchId === chat.timeline.branchId && str(current.sessionId) !== '') {
      return { role: participantKey, sessionId: current.sessionId, rewindTo: null, lifetime: participantLifetime(current.lifetime), syncedRevision: current.syncedRevision }
    }
    if (current.status !== 'needs-rewind' && bound && ['running', 'interrupted', 'failed', 'deferred'].includes(bound.status)) return { role: participantKey, sessionId: bound.startedSessionId, rewindTo: null, lifetime: 'chat', syncedRevision: null }
    const rewindTo = Number.isSafeInteger(current.rewindTo) ? current.rewindTo : (Number.isSafeInteger(current.boundary) ? current.boundary : null)
    return {
      role: participantKey,
      sessionId: str(current.sessionId),
      rewindTo,
      ...(current.formatVersion ? { formatVersion: current.formatVersion } : {}),
      lifetime: participantKey === 'background' ? participantLifetime(current.lifetime) : (current.lifetime || 'one-shot'),
      syncedRevision: current.syncedRevision === undefined ? null : current.syncedRevision
    }
  }

  function commitParticipant(chat, operation, value, preserveRewind = false) {
    let participant = object(value)
    // The identity durably bound before execution outranks a caller's stale
    // pre-replacement receipt. Never transfer a boundary between sessions.
    if (operation.startedSessionId && operation.startedSessionId !== str(participant.sessionId)) {
      participant = { sessionId: operation.startedSessionId, lifetime: 'chat', boundary: null, identityOnly: true }
    }
    if (operation.kind !== 'agent' || str(participant.sessionId) === '') return
    const lifetime = participantLifetime(participant.lifetime)
    const participantKey = participantRole(operation.role)
    const previousParticipant = object(chat.timeline.participants[participantKey])
    // Failure is not evidence that the requested rewind reached durable storage.
    // Keep the original boundary so every retry still has to perform it.
    if (preserveRewind && previousParticipant.status === 'needs-rewind'
      && previousParticipant.sessionId === participant.sessionId) return
    const nextParticipant = {
      role: participantKey,
      lifetime,
      sessionId: str(participant.sessionId),
      branchId: chat.timeline.branchId,
      syncedRevision: participant.identityOnly ? null : chat.timeline.revision,
      boundary: Number.isSafeInteger(participant.boundary) ? participant.boundary : null,
      ...(participant.formatVersion ? { formatVersion: participant.formatVersion } : {}),
      status: 'current',
      rewindTo: null,
      updatedAt: now()
    }
    // A full in-place reset (rewindTo -1) removed the compacted history with the rest.
    const cleared = previousParticipant.status === 'needs-rewind' && previousParticipant.rewindTo === -1
    if (str(previousParticipant.sessionId) === str(participant.sessionId) && previousParticipant.requiresNewSessionOnRewind === true && !cleared) {
      nextParticipant.requiresNewSessionOnRewind = true
      nextParticipant.compactedAt = Number(previousParticipant.compactedAt) || now()
    }
    chat.timeline.participants[participantKey] = nextParticipant
    if (operation.role === 'candidate') {
      chat.candidateAgent = {
        sessionId: str(participant.sessionId), mode: lifetime === 'chat' ? 'continuable' : 'one-shot',
        branchId: chat.timeline.branchId, syncedRevision: chat.timeline.revision,
        boundary: Number.isSafeInteger(participant.boundary) ? participant.boundary : null,
        ...(participant.formatVersion ? { formatVersion: participant.formatVersion } : {}),
        updatedAt: now()
      }
    }
  }

  function participantCheckpointSource(value) {
    const participant = object(value)
    if (str(participant.sessionId) !== '' && Number.isSafeInteger(participant.boundary)) {
      return { sessionId: participant.sessionId, boundary: participant.boundary, ...(participant.formatVersion ? { formatVersion: participant.formatVersion } : {}) }
    }
    const pending = object(participant.forkFrom)
    if (str(pending.sessionId) !== '' && Number.isSafeInteger(pending.boundary)) {
      return { sessionId: pending.sessionId, boundary: pending.boundary, ...(pending.formatVersion ? { formatVersion: pending.formatVersion } : {}) }
    }
    return null
  }

  // A compacted worker cannot rewind to a boundary inside its summary. Keep the
  // same session and clear its task history instead (boundary -1, in place).
  function sourceSurvivesCompaction(participant, source) {
    if (source === null || participant.requiresNewSessionOnRewind !== true) return source
    return str(participant.sessionId) === source.sessionId ? { sessionId: source.sessionId, boundary: -1 } : source
  }

  function earlierParticipantSource(checkpoints, role) {
    for (let index = checkpoints.length - 2; index >= 0; index--) {
      const checkpoint = object(checkpoints[index])
      const participants = object(checkpoint.participants || checkpoint.before && checkpoint.before.participants)
      const source = participantCheckpointSource(participants[role])
      if (source !== null) return source
    }
    return null
  }

  function beginAgent(chat, intent) {
    const role = str(intent.role).trim()
    const requestId = str(intent.requestId).trim().slice(0, 160)
    if (role === '') throw new Error('Agent role 不能为空')
    if (requestId !== '') {
      const existing = Object.values(chat.timeline.operations).find(function (operation) {
        return operation.kind === 'agent' && str(operation.requestId) === requestId
      })
      if (existing !== undefined) {
        if (existing.role !== role) {
          const error = new Error('同一后台请求标识对应了不同 Agent role')
          error.code = 'IDEMPOTENCY_CONFLICT'
          throw error
        }
        return Object.assign(operationValue(existing), { created: false })
      }
    }
    for (const operation of Object.values(chat.timeline.operations)) {
      if (operation.kind === 'agent' && operation.role === role && operation.status === 'running') operation.status = 'cancelled'
    }
    const operation = {
      id: makeId('operation'), kind: 'agent', role, status: 'running',
      requestId, basedOn: basedOn(chat), createdAt: now()
    }
    const round = role === 'settlement' ? pendingSettlementBody(chat) : undefined
    if (round !== undefined) operation.roundOperationId = round.id
    chat.timeline.operations[operation.id] = operation
    if (role === 'settlement') updateSettlementBackground(chat, operation, 'running')
    trimOperations(chat.timeline)
    return Object.assign(operationValue(operation, participantRequest(chat, role)), { created: true })
  }

  function recoverBackground(chat, intent = {}) {
    // startedBefore (startup recovery): only work an earlier process left running is orphaned. History recovery runs
    // after the service is ready, so a turn played meanwhile already has live work of this process.
    const orphan = operation => !(Number(intent.startedBefore) > 0) || Number(operation.createdAt) < Number(intent.startedBefore)
    let interruptedRole = ''
    let changed = false
    for (const operation of Object.values(chat.timeline.operations)) {
      if (operation.kind !== 'agent' || (operation.status !== 'running'
        && !(intent.cancelDelivery === true && operation.role === 'settlement' && operation.status === 'deferred'))) continue
      if (!orphan(operation)) continue
      const target = (chat.messages || []).findLast(message => message.role === 'assistant')
      const delivery = target?.mvu?.pending ? target.mvu.delivery : null
      const recoverable = intent.cancelDelivery !== true && operation.role === 'settlement' && delivery?.version === 1
        && delivery.branchId === operation.basedOn?.branchId && delivery.revision === operation.basedOn?.revision
        && delivery.swipeId === Number(target.swipeId || 0) && delivery.branchId === chat.timeline.branchId
        && delivery.revision === chat.timeline.revision
        && delivery.lifecycleRevision === Number(chat.tavernHelperLifecycleRevision || 0)
      operation.status = recoverable ? 'deferred' : 'interrupted'
      if (recoverable) updateSettlementBackground(chat, operation, 'pending')
      operation.completedAt = now()
      changed = true
      if (operation.role === 'settlement' && !recoverable) interruptedRole = operation.role
    }
    const background = backgroundBody(chat)
    if (background !== undefined) {
      const latest = Object.values(chat.timeline.operations).filter(function (operation) {
        return operation.kind === 'agent' && operation.role === 'settlement' &&
          operation.roundOperationId === background.id
      }).sort(function (left, right) { return Number(right.createdAt) - Number(left.createdAt) })[0]
      // Deferred work has either an uncommitted isolated draft or a persisted
      // effect. Both can resume without applying the same variable change twice.
      // Also repair chats already converted to pending by older recovery code.
      const orphaned = background.status === 'completed' &&
        ['pending', 'running'].includes(background.background.phase) && latest?.status !== 'deferred' && (!latest || orphan(latest))
      if (interruptedRole !== '' || orphaned) {
        background.background = { phase: 'failed', role: 'settlement', reason: 'interrupted', updatedAt: now() }
        changed = true
      }
    }
    return { status: changed ? 'recovered' : 'unchanged', role: interruptedRole }
  }

  function rollback(chat, intent) {
    const checkpoints = chat.timeline.checkpoints
    if (checkpoints.length === 0 && object(intent).legacyBefore !== undefined) {
      const legacyBefore = clone(intent.legacyBefore)
      legacyBefore.participants = {}
      checkpoints.push({ id: makeId('checkpoint'), turn: Number(intent.turn) || 0, before: legacyBefore, committedAt: now(), migrated: true })
    }
    const checkpoint = checkpoints[checkpoints.length - 1]
    if (checkpoint === undefined) {
      const error = new Error('没有可回退的剧情 checkpoint')
      error.code = 'NOTHING_TO_ROLLBACK'
      throw error
    }
    const oldRevision = chat.timeline.revision
    const currentParticipants = object(chat.timeline.participants)
    const operations = chat.timeline.operations
    for (const operation of Object.values(operations)) {
      if (operation.status === 'running' || (operation.kind === 'body' && operation.status === 'foreground-completed')) operation.status = 'cancelled'
      if (['pending', 'running'].includes(operation.background?.phase)) operation.background = { ...operation.background, phase: 'cancelled' }
    }
    let restoredState
    if (checkpoint.before !== undefined) {
      restoredState = checkpoint.before
    } else {
      const beforeChat = object(intent.beforeChat)
      const expectedRevision = Math.max(0, Number(checkpoint.beforeRevision) || 0)
      if (intent.allowMissingHistory === true) {
        restoredState = snapshot(object(intent.legacyBefore))
      } else {
        if (str(beforeChat.id) !== str(chat.id) || storageRevision(beforeChat) !== expectedRevision) {
          const error = new Error('剧情 checkpoint 需要 storage revision ' + expectedRevision + ' 的历史 Chat')
          error.code = 'CHECKPOINT_HISTORY_REQUIRED'
          error.beforeRevision = expectedRevision
          throw error
        }
        restoredState = snapshot(beforeChat)
      }
    }
    restore(chat, restoredState)
    const branchId = makeId('branch')
    const restoredParticipants = object(checkpoint.participants || restoredState && restoredState.participants)
    const nextParticipants = {}
    for (const role of new Set([...Object.keys(restoredParticipants), ...Object.keys(currentParticipants)])) {
      const currentParticipant = object(currentParticipants[role])
      const participant = object(restoredParticipants[role])
      if (!persistentParticipant(participant.lifetime) && !persistentParticipant(currentParticipant.lifetime)) continue
      let source = participantCheckpointSource(participant) || earlierParticipantSource(checkpoints, role)
      source = sourceSurvivesCompaction(participant, source)
      source = sourceSurvivesCompaction(object(currentParticipants[role]), source)
      // A checkpoint owns story state, not the identity of the resident worker.
      // Imported history may precede its first task: reset task context in place.
      if (source === null && str(currentParticipant.sessionId) !== '') {
        source = { sessionId: currentParticipant.sessionId, boundary: -1 }
      }
      nextParticipants[role] = {
        role,
        lifetime: 'chat',
        sessionId: source === null ? '' : source.sessionId,
        branchId,
        syncedRevision: null,
        boundary: source === null ? null : source.boundary,
        ...(source?.formatVersion ? { formatVersion: source.formatVersion } : {}),
        status: source === null ? 'needs-session' : 'needs-rewind',
        rewindTo: source === null ? null : source.boundary,
        updatedAt: now()
      }
    }
    chat.timeline.branchId = branchId
    chat.timeline.revision = oldRevision + 1
    chat.timeline.checkpoints = checkpoints.slice(0, -1)
    chat.timeline.participants = nextParticipants
    chat.timeline.operations = operations
    chat.timeline.updatedAt = now()
    chat.candidateAgent = null
    return {
      status: 'applied',
      branchId,
      revision: chat.timeline.revision,
      checkpointId: checkpoint.id
    }
  }

  function apply(input) {
    let chat = ensure(input && input.chat)
    const intent = object(input && input.intent)
    let value
    if (intent.kind === 'ensure') value = { status: 'applied', branchId: chat.timeline.branchId, revision: chat.timeline.revision }
    else if (intent.kind === 'ledger.edit') {
      chat.ledger = clone(intent.ledger)
      chat.timeline.revision++
      chat.timeline.updatedAt = now()
      value = { status: 'edited', revision: chat.timeline.revision }
    }
    else if (intent.kind === 'body.edit') {
      const index = chat.messages.findLastIndex(message => message?.role === 'assistant')
      if (index !== chat.messages.length - 1 || chat.messages[index]?.greeting || Number(chat.messages[index]?.turn) !== Number(intent.turn)) throw new Error('只能编辑最后一轮正文')
      Object.assign(chat.messages[index], intent.patch)
      delete chat.messages[index].displayRuntime
      delete chat.messages[index].sessionText // retired copy of text (reply-prose.js)
      // An edit is a new scene; only 自动精修 keeps the original one (body.polish).
      delete chat.messages[index].polishedFrom
      // A plain edit is no longer the 精修's text; a manual 精修 (also a body.edit) sets it again.
      if (intent.patch?.polished !== true) delete chat.messages[index].polished
      chat.timeline.revision++
      // Editing keeps the same committed round, but its next settlement must
      // bind to the edited revision. Old in-flight work still fails basedOn.
      const editedRound = backgroundBody(chat)
      if (editedRound && Number(editedRound.turn) === Number(intent.turn)) {
        editedRound.committedRevision = chat.timeline.revision
      }
      chat.timeline.updatedAt = now()
      chat.candidates = null
      // Prose is authoritative. The previous settlement must not overrule the
      // edited scene in foreground requests or in the resident background Agent.
      chat.posture = ''
      chat.lastSettle = null
      chat.settleStatus = 'idle'
      chat.settleError = null
      const checkpoint = chat.timeline.checkpoints.at(-1)
      for (const [role, participant] of Object.entries(chat.timeline.participants)) {
        if (!persistentParticipant(participant.lifetime)) continue
        const previous = object(checkpoint?.participants?.[role])
        const source = participantCheckpointSource(previous)
        const needsSession = !str(participant.sessionId)
        const boundary = participant.requiresNewSessionOnRewind !== true && source?.sessionId === participant.sessionId ? source.boundary : -1
        chat.timeline.participants[role] = {
          ...participant, status: needsSession ? 'needs-session' : 'needs-rewind',
          sessionId: needsSession ? '' : participant.sessionId,
          formatVersion: source?.formatVersion || 3,
          boundary: needsSession ? null : boundary, rewindTo: needsSession ? null : boundary,
          syncedRevision: null, updatedAt: now()
        }
      }
      chat.candidateAgent = null
      value = { status: 'edited', revision: chat.timeline.revision }
    }
    else if (intent.kind === 'body.polish') {
      // 自动精修: the same reply in better words. Its settlement, choices, stage and the background
      // Agents' histories stay valid, so unlike body.edit nothing else moves, not even the revision.
      const index = chat.messages.findLastIndex(message => message?.role === 'assistant')
      if (index !== chat.messages.length - 1 || chat.messages[index]?.greeting || Number(chat.messages[index]?.turn) !== Number(intent.turn)) throw new Error('只能精修最后一轮正文')
      Object.assign(chat.messages[index], intent.patch)
      delete chat.messages[index].displayRuntime
      delete chat.messages[index].sessionText
      chat.timeline.updatedAt = now()
      value = { status: 'polished', revision: chat.timeline.revision }
    }
    else if (intent.kind === 'body.begin') value = beginBody(chat, intent)
    else if (intent.kind === 'agent.begin') value = beginAgent(chat, intent)
    else if (intent.kind === 'agent.bind') {
      const operation = chat.timeline.operations[intent.operationId]
      if (!operation || operation.kind !== 'agent' || operation.status !== 'running'
        || operation.basedOn.branchId !== chat.timeline.branchId || operation.basedOn.revision !== chat.timeline.revision) throw new Error('后台任务已过期，不能绑定代理')
      if (!str(intent.sessionId)) throw new Error('后台代理编号为空')
      operation.startedSessionId = str(intent.sessionId)
      const key = participantRole(operation.role)
      const previous = object(chat.timeline.participants[key])
      if (str(previous.sessionId) !== operation.startedSessionId) {
        // Session ownership is durable before the model runs; task success and
        // synchronization are separate facts. Old checkpoints remain untouched.
        chat.timeline.participants[key] = {
          role: key, lifetime: 'chat', sessionId: operation.startedSessionId,
          branchId: chat.timeline.branchId, status: 'bound', syncedRevision: null,
          boundary: null, rewindTo: null, updatedAt: now()
        }
      }
      value = { status: 'bound' }
    }
    else if (intent.kind === 'background.recover') value = recoverBackground(chat, intent)
    else if (intent.kind === 'turn.rollback') value = rollback(chat, intent)
    else if (intent.kind === 'replacement.abort') {
      const currentRevision = chat.timeline.revision
      const original = ensure(intent.restoreChat)
      // Roll back story-owned fields, not settings saved while the model ran.
      restore(chat, snapshot(original))
      chat.timeline = clone(original.timeline)
      for (const key of ['nativeCommits', 'suppressedDshTurns', 'regeneratedDshTurns', 'replacingDshTurns']) {
        if (Object.hasOwn(original, key)) chat[key] = clone(original[key])
        else delete chat[key]
      }
      const branchId = makeId('branch')
      const participants = {}
      for (const role of Object.keys(chat.timeline.participants)) {
        const participant = object(chat.timeline.participants[role])
        if (!persistentParticipant(participant.lifetime)) continue
        let source = sourceSurvivesCompaction(participant, participantCheckpointSource(participant))
        // No surviving boundary: reset the same worker's task history in place, as a rollback does.
        if (source === null && str(participant.sessionId) !== '') {
          source = { sessionId: participant.sessionId, boundary: -1 }
        }
        participants[role] = {
          role, lifetime: 'chat', sessionId: source === null ? '' : source.sessionId, branchId, syncedRevision: null,
          boundary: source === null ? null : source.boundary,
          ...(source?.formatVersion ? { formatVersion: source.formatVersion } : {}),
          status: source === null ? 'needs-session' : 'needs-rewind', rewindTo: source === null ? null : source.boundary,
          updatedAt: now()
        }
      }
      chat.timeline.branchId = branchId
      chat.timeline.revision = Math.max(currentRevision, chat.timeline.revision) + 1
      chat.timeline.participants = participants
      for (const operation of Object.values(chat.timeline.operations)) {
        if (operation.status === 'running' || (operation.kind === 'body' && operation.status === 'foreground-completed')) operation.status = 'cancelled'
      if (['pending', 'running'].includes(operation.background?.phase)) operation.background = { ...operation.background, phase: 'cancelled' }
      }
      chat.candidateAgent = null
      value = { status: 'restored', branchId, revision: chat.timeline.revision }
    }
    else throw new Error('未知剧情时间线 intent: ' + str(intent.kind))
    chat.timeline.updatedAt = now()
    return { chat, value }
  }

  function complete(input) {
    // Scoped callers supply detached selected rows, indexed by original floor.
    // Normalize metadata without serializing an N-element sparse array.
    const scoped = Array.isArray(input?.messageIndices)
    const chat = ensure(scoped ? {...input.chat, messages: []} : input && input.chat)
    if (scoped) {
      chat.messages = createScopedMessages(input.chat.messages.length,
        input.messageIndices.map(id => [id, clone(input.chat.messages[id])]))
    }
    const operation = chat.timeline.operations[str(input && input.operationId)]
    if (operation === undefined || operation.status !== 'running' || !sameBasedOn(operation.basedOn, input && input.basedOn) || !sameBasedOn(operation.basedOn, basedOn(chat))) {
      if (operation !== undefined && operation.status === 'running') operation.status = 'stale'
      return { chat, value: { status: 'stale', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
    }
    const outcome = object(input && input.outcome)
    if (outcome.status === 'deferred') {
      if (typeof input.apply === 'function') input.apply(chat)
      commitParticipant(chat, operation, outcome.participant)
      operation.status = 'deferred'
      operation.completedAt = now()
      operation.committedRevision = chat.timeline.revision
      if (operation.kind === 'agent' && operation.role === 'settlement') updateSettlementBackground(chat, operation, 'pending')
      chat.timeline.updatedAt = now()
      return { chat, value: { status: 'deferred', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
    }
    if (outcome.status !== 'success') {
      commitParticipant(chat, operation, outcome.participant, true)
      operation.status = 'failed'
      operation.completedAt = now()
      if (operation.kind === 'agent' && operation.role === 'settlement') updateSettlementBackground(chat, operation, 'failed')
      return { chat, value: { status: 'failed', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
    }
    let settlementRound = null
    if (operation.kind === 'agent' && operation.role === 'settlement' && str(operation.roundOperationId) !== '') {
      settlementRound = chat.timeline.operations[operation.roundOperationId]
      if (!settlementRound || settlementRound.kind !== 'body' || settlementRound.status !== 'completed'
        || str(settlementRound.committedBranchId) !== str(operation.basedOn.branchId)
        || Number(settlementRound.committedRevision) !== Number(operation.basedOn.revision)) {
        operation.status = 'stale'
        return { chat, value: { status: 'stale', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
      }
    }
    if (typeof input.apply === 'function') input.apply(chat)
    if (operation.kind === 'body') {
      operation.foregroundCompletedAt = now()
      commitBody(chat, operation)
    } else if (settlementRound !== null) {
      settlementRound.background = { phase: 'completed', role: 'settlement', updatedAt: now() }
    } else if (outcome.stateChanged === true) {
      chat.timeline.revision++
    }
    commitParticipant(chat, operation, outcome.participant)
    if (operation.kind !== 'body') operation.status = 'completed'
    operation.completedAt = now()
    operation.committedRevision = chat.timeline.revision
    if (operation.kind === 'agent' && operation.role === 'settlement') updateSettlementBackground(chat, operation, 'completed')
    chat.timeline.updatedAt = now()
    return { chat, value: { status: 'committed', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
  }

  function inspect(input) {
    const source = input && input.chat
    // Legacy foreground migration commits a body and may need story data.
    // Ordinary inspection only normalizes detached timeline metadata.
    const legacyBody = Object.values(object(source?.timeline?.operations)).some(operation =>
      operation && operation.kind === 'body' && operation.status === 'foreground-completed')
    // Inspection needs only the count. Old checkpoint.before values can hold
    // whole histories; normalization must not serialize those unused payloads.
    const checkpoints = source?.timeline?.checkpoints
    const checkpointCount = Number(source?.timeline?.schemaVersion) === 1 && Array.isArray(checkpoints) ? checkpoints.length : 0
    const chat = ensure(legacyBody ? source : {
      timeline: source?.timeline ? {...source.timeline,checkpoints:[]} : source?.timeline,
      candidateAgent: source?.candidateAgent
    })
    return clone({
      branchId: chat.timeline.branchId,
      revision: chat.timeline.revision,
      checkpointCount: legacyBody ? chat.timeline.checkpoints.length : checkpointCount,
      participants: chat.timeline.participants,
      operations: chat.timeline.operations
    })
  }

  function rollbackTarget(input) {
    const chat = ensure(input && input.chat)
    const checkpoint = chat.timeline.checkpoints[chat.timeline.checkpoints.length - 1]
    if (checkpoint === undefined || checkpoint.before !== undefined) return null
    return {
      checkpointId: str(checkpoint.id),
      beforeRevision: Math.max(0, Number(checkpoint.beforeRevision) || 0)
    }
  }

  return Object.freeze({ apply, complete, inspect, rollbackTarget })
}
