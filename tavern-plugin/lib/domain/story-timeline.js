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

function participantRole(role) {
  return role === 'candidate' || role === 'settlement' ? 'background' : role
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
      runtimeInputs: chat.runtimeInputs === undefined ? null : chat.runtimeInputs,
      posture: str(chat.posture),
      scriptState: chat.scriptState === undefined ? null : chat.scriptState,
      candidates: chat.candidates === undefined ? null : chat.candidates,
      settleStatus: str(chat.settleStatus) || 'idle',
      settleError: chat.settleError === undefined ? null : chat.settleError,
      lastSettle: chat.lastSettle === undefined ? null : chat.lastSettle,
      preparedWorldBookContext: str(chat.preparedWorldBookContext),
      preparedWorldBook: chat.preparedWorldBook === undefined ? null : chat.preparedWorldBook,
      worldBookReads: chat.worldBookReads === undefined ? null : chat.worldBookReads,
      participants: object(chat.timeline).participants
    })
  }

  function restore(chat, state) {
    const source = object(state)
    chat.messages = clone(Array.isArray(source.messages) ? source.messages : [])
    chat.presentation = clone(source.presentation === undefined ? null : source.presentation)
    chat.presentationWarnings = clone(Array.isArray(source.presentationWarnings) ? source.presentationWarnings : [])
    if (Object.hasOwn(source, 'macroState')) chat.macroState = clone(source.macroState)
    if (Object.hasOwn(source, 'runtimeInputs')) chat.runtimeInputs = clone(source.runtimeInputs)
    chat.posture = str(source.posture)
    chat.scriptState = clone(source.scriptState === undefined ? null : source.scriptState)
    chat.candidates = clone(source.candidates === undefined ? null : source.candidates)
    chat.settleStatus = str(source.settleStatus) || 'idle'
    chat.settleError = clone(source.settleError === undefined ? null : source.settleError)
    chat.lastSettle = clone(source.lastSettle === undefined ? null : source.lastSettle)
    chat.preparedWorldBookContext = str(source.preparedWorldBookContext)
    chat.preparedWorldBook = clone(source.preparedWorldBook === undefined ? null : source.preparedWorldBook)
    chat.worldBookReads = clone(source.worldBookReads === undefined ? null : source.worldBookReads)
  }

  function trimOperations(timeline) {
    const entries = Object.values(timeline.operations).sort(function (left, right) { return (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0) })
    for (const operation of entries.slice(80)) delete timeline.operations[operation.id]
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
      if (operation.kind !== 'body' || operation.status !== 'completed') return false
      if (str(object(operation.background).phase) === '') return false
      return str(operation.committedBranchId || operation.basedOn && operation.basedOn.branchId) === chat.timeline.branchId
    }).sort(function (left, right) {
      return (Number(right.completedAt) || 0) - (Number(left.completedAt) || 0)
    })[0]
  }

  function updateBackground(chat, phase, role) {
    const operation = backgroundBody(chat)
    if (operation === undefined) return null
    operation.background = { phase, role, updatedAt: now() }
    return operation
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
    if (current.status === 'current' && current.branchId === chat.timeline.branchId && str(current.sessionId) !== '') {
      return { role: participantKey, sessionId: current.sessionId, rewindTo: null, lifetime: participantLifetime(current.lifetime), syncedRevision: current.syncedRevision }
    }
    const rewindTo = Number.isSafeInteger(current.rewindTo) ? current.rewindTo : (Number.isSafeInteger(current.boundary) ? current.boundary : null)
    return {
      role: participantKey,
      sessionId: str(current.sessionId),
      rewindTo,
      lifetime: participantKey === 'background' ? participantLifetime(current.lifetime) : (current.lifetime || 'one-shot'),
      syncedRevision: current.syncedRevision === undefined ? null : current.syncedRevision
    }
  }

  function participantCheckpointSource(value) {
    const participant = object(value)
    if (str(participant.sessionId) !== '' && Number.isSafeInteger(participant.boundary)) {
      return { sessionId: participant.sessionId, boundary: participant.boundary }
    }
    const pending = object(participant.forkFrom)
    if (str(pending.sessionId) !== '' && Number.isSafeInteger(pending.boundary)) {
      return { sessionId: pending.sessionId, boundary: pending.boundary }
    }
    return null
  }

  function sourceSurvivesCompaction(participant, source) {
    if (source === null || participant.requiresNewSessionOnRewind !== true) return source
    return str(participant.sessionId) === source.sessionId ? null : source
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
    chat.timeline.operations[operation.id] = operation
    if (role === 'settlement') updateBackground(chat, 'running', role)
    trimOperations(chat.timeline)
    return Object.assign(operationValue(operation, participantRequest(chat, role)), { created: true })
  }

  function recoverBackground(chat) {
    let interruptedRole = ''
    let changed = false
    for (const operation of Object.values(chat.timeline.operations)) {
      if (operation.kind !== 'agent' || operation.status !== 'running') continue
      operation.status = 'interrupted'
      operation.completedAt = now()
      changed = true
      if (operation.role === 'settlement') interruptedRole = operation.role
    }
    const background = backgroundBody(chat)
    if (background !== undefined && interruptedRole !== '') {
      background.background = { phase: 'pending', role: interruptedRole, updatedAt: now() }
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
      if (operation.status === 'running') operation.status = 'cancelled'
    }
    let restoredState
    if (checkpoint.before !== undefined) {
      restoredState = checkpoint.before
    } else {
      const beforeChat = object(intent.beforeChat)
      const expectedRevision = Math.max(0, Number(checkpoint.beforeRevision) || 0)
      if (str(beforeChat.id) !== str(chat.id) || storageRevision(beforeChat) !== expectedRevision) {
        const error = new Error('剧情 checkpoint 需要 storage revision ' + expectedRevision + ' 的历史 Chat')
        error.code = 'CHECKPOINT_HISTORY_REQUIRED'
        error.beforeRevision = expectedRevision
        throw error
      }
      restoredState = snapshot(beforeChat)
    }
    restore(chat, restoredState)
    const branchId = makeId('branch')
    const restoredParticipants = object(checkpoint.participants || restoredState && restoredState.participants)
    const nextParticipants = {}
    for (const role of Object.keys(restoredParticipants)) {
      const participant = object(restoredParticipants[role])
      if (!persistentParticipant(participant.lifetime)) continue
      let source = participantCheckpointSource(participant) || earlierParticipantSource(checkpoints, role)
      source = sourceSurvivesCompaction(participant, source)
      source = sourceSurvivesCompaction(object(currentParticipants[role]), source)
      nextParticipants[role] = {
        role,
        lifetime: 'chat',
        sessionId: source === null ? '' : source.sessionId,
        branchId,
        syncedRevision: null,
        boundary: source === null ? null : source.boundary,
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
    else if (intent.kind === 'body.begin') value = beginBody(chat, intent)
    else if (intent.kind === 'agent.begin') value = beginAgent(chat, intent)
    else if (intent.kind === 'background.recover') value = recoverBackground(chat)
    else if (intent.kind === 'turn.rollback') value = rollback(chat, intent)
    else if (intent.kind === 'replacement.abort') {
      const currentRevision = chat.timeline.revision
      chat = ensure(intent.restoreChat)
      const branchId = makeId('branch')
      const participants = {}
      for (const role of Object.keys(chat.timeline.participants)) {
        const participant = object(chat.timeline.participants[role])
        if (!persistentParticipant(participant.lifetime)) continue
        const source = sourceSurvivesCompaction(participant, participantCheckpointSource(participant))
        participants[role] = {
          role, lifetime: 'chat', sessionId: source === null ? '' : source.sessionId, branchId, syncedRevision: null,
          boundary: source === null ? null : source.boundary,
          status: source === null ? 'needs-session' : 'needs-rewind', rewindTo: source === null ? null : source.boundary,
          updatedAt: now()
        }
      }
      chat.timeline.branchId = branchId
      chat.timeline.revision = Math.max(currentRevision, chat.timeline.revision) + 1
      chat.timeline.participants = participants
      for (const operation of Object.values(chat.timeline.operations)) {
        if (operation.status === 'running') operation.status = 'cancelled'
      }
      chat.candidateAgent = null
      value = { status: 'restored', branchId, revision: chat.timeline.revision }
    }
    else throw new Error('未知剧情时间线 intent: ' + str(intent.kind))
    chat.timeline.updatedAt = now()
    return { chat, value }
  }

  function complete(input) {
    const chat = ensure(input && input.chat)
    const operation = chat.timeline.operations[str(input && input.operationId)]
    if (operation === undefined || operation.status !== 'running' || !sameBasedOn(operation.basedOn, input && input.basedOn) || !sameBasedOn(operation.basedOn, basedOn(chat))) {
      if (operation !== undefined && operation.status === 'running') operation.status = 'stale'
      return { chat, value: { status: 'stale', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
    }
    const outcome = object(input && input.outcome)
    if (outcome.status !== 'success') {
      operation.status = 'failed'
      operation.completedAt = now()
      if (operation.kind === 'agent' && operation.role === 'settlement') {
        updateBackground(chat, 'failed', operation.role)
      }
      return { chat, value: { status: 'failed', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
    }
    if (typeof input.apply === 'function') input.apply(chat)
    if (operation.kind === 'body') {
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
      operation.committedBranchId = chat.timeline.branchId
      operation.background = { phase: 'pending', role: 'settlement', updatedAt: now() }
    } else if (outcome.stateChanged === true) {
      chat.timeline.revision++
    }
    const participant = object(outcome.participant)
    if (operation.kind === 'agent' && str(participant.sessionId) !== '') {
      const lifetime = participantLifetime(participant.lifetime)
      const participantKey = participantRole(operation.role)
      const previousParticipant = object(chat.timeline.participants[participantKey])
      const nextParticipant = {
        role: participantKey,
        lifetime,
        sessionId: str(participant.sessionId),
        branchId: chat.timeline.branchId,
        syncedRevision: chat.timeline.revision,
        boundary: Number.isSafeInteger(participant.boundary) ? participant.boundary : null,
        status: 'current',
        rewindTo: null,
        updatedAt: now()
      }
      if (str(previousParticipant.sessionId) === str(participant.sessionId) && previousParticipant.requiresNewSessionOnRewind === true) {
        nextParticipant.requiresNewSessionOnRewind = true
        nextParticipant.compactedAt = Number(previousParticipant.compactedAt) || now()
      }
      chat.timeline.participants[participantKey] = nextParticipant
      if (operation.role === 'candidate') {
        chat.candidateAgent = {
          sessionId: str(participant.sessionId), mode: lifetime === 'chat' ? 'continuable' : 'one-shot',
          branchId: chat.timeline.branchId, syncedRevision: chat.timeline.revision,
          boundary: Number.isSafeInteger(participant.boundary) ? participant.boundary : null,
          updatedAt: now()
        }
      }
    }
    operation.status = 'completed'
    operation.completedAt = now()
    operation.committedRevision = chat.timeline.revision
    if (operation.kind === 'agent' && operation.role === 'settlement') updateBackground(chat, 'completed', 'settlement')
    chat.timeline.updatedAt = now()
    return { chat, value: { status: 'committed', branchId: chat.timeline.branchId, revision: chat.timeline.revision } }
  }

  function inspect(input) {
    const chat = ensure(input && input.chat)
    return clone({
      branchId: chat.timeline.branchId,
      revision: chat.timeline.revision,
      checkpointCount: chat.timeline.checkpoints.length,
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
