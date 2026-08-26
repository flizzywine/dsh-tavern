function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function phaseEntries(messages, phase) {
  const name = 'tavern:runtime-preset-' + phase
  return (Array.isArray(messages) ? messages : []).filter(function (message) {
    return Array.isArray(message && message.source && message.source.sections) && message.source.sections.some(function (section) { return section && section.name === name })
  })
}

function serializableRequest(options) {
  const result = {}
  for (const [key, value] of Object.entries(options || {})) {
    if (key === 'signal') continue
    result[key] = value
  }
  return JSON.parse(JSON.stringify(result))
}

export function createModelRequestLog(options = {}) {
  const readJson = options.readJson
  const writeJson = options.writeJson
  const updateJson = options.updateJson
  const now = typeof options.now === 'function' ? options.now : Date.now
  const id = typeof options.id === 'function' ? options.id : function () { return crypto.randomUUID() }
  if (typeof readJson !== 'function' || typeof writeJson !== 'function' || typeof updateJson !== 'function') throw new TypeError('模型请求日志缺少存储适配器')

  async function record(input) {
    const chat = input.chat
    const context = input.context
    const coordinates = input.coordinates
    const requestOptions = input.options
    const stamp = now()
    const requestId = stamp.toString(36) + '-' + id()
    const messages = Array.isArray(requestOptions && requestOptions.messages) ? requestOptions.messages : []
    const scope = context && context.scope === 'background' ? 'background' : 'foreground'
    const turn = scope === 'background' ? Math.max(0, Number(context.turn) || 0) : Math.max(0, Number(coordinates && coordinates.turn) || 0)
    const record = {
      version: 1,
      id: requestId,
      chatId: chat.id,
      scope,
      task: scope === 'background' ? str(context.task) : 'reply',
      sessionId: str(requestOptions && requestOptions.sessionId),
      turn,
      agentTurn: Math.max(0, Number(coordinates && coordinates.turn) || 0),
      step: Math.max(1, Number(coordinates && coordinates.step) || 1),
      createdAt: stamp,
      status: 'running',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      compatibility: chat.requestMode === 'sillytavern' && chat.compatibilityTraces && chat.compatibilityTraces[String(turn)]
        ? JSON.parse(JSON.stringify(chat.compatibilityTraces[String(turn)]))
        : null,
      preset: {
        path: str(chat.runtimePresetPath),
        digest: str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.digest)
      },
      phases: {
        front: phaseEntries(messages, 'front'),
        middle: phaseEntries(messages, 'middle'),
        back: phaseEntries(messages, 'back')
      },
      request: serializableRequest(requestOptions)
    }
    const base = 'model-requests/' + chat.id + '/'
    await writeJson(base + requestId + '.json', record)
    await updateJson(base + 'index.json', function (value) {
      const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const requests = Array.isArray(current.requests) ? current.requests : []
      return {
        version: 1,
        chatId: chat.id,
        requests: requests.concat([{
          id: requestId, scope, task: record.task, sessionId: record.sessionId,
          turn: record.turn, agentTurn: record.agentTurn, step: record.step,
          createdAt: record.createdAt, preset: record.preset
        }])
      }
    })
    return record
  }

  async function complete(input = {}) {
    const base = 'model-requests/' + str(input.chatId) + '/'
    const path = base + str(input.id) + '.json'
    const record = await readJson(path)
    if (!record) return null
    record.status = str(input.error) !== '' ? 'failed' : 'completed'
    record.completedAt = now()
    record.durationMs = Math.max(0, record.completedAt - Number(record.createdAt || record.completedAt))
    record.response = {
      text: str(input.text),
      finish: input.finish === undefined ? null : JSON.parse(JSON.stringify(input.finish)),
      error: str(input.error) || null
    }
    await writeJson(path, record)
    return record
  }

  async function evidence(chatId, turn) {
    const base = 'model-requests/' + chatId + '/'
    const index = await readJson(base + 'index.json')
    const entries = Array.isArray(index && index.requests) ? index.requests.filter(function (item) {
      return !Number.isSafeInteger(Number(turn)) || Number(turn) < 1 || Number(item.turn) === Number(turn)
    }) : []
    const requests = []
    for (const entry of entries) {
      const record = await readJson(base + entry.id + '.json')
      if (record) requests.push(record)
    }
    return { loaded: true, chatId, requests }
  }

  return Object.freeze({ record, complete, evidence })
}
