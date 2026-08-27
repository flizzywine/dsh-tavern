function object(value) {
  return value !== null && typeof value === 'object' ? value : null
}

function eventAt(events, seq) {
  const direct = events[seq]
  if (direct && Number(direct.seq) === Number(seq)) return direct
  return events.find(event => event && Number(event.seq) === Number(seq)) || null
}

function modelSourceOf(event) {
  const data = object(event && event.data)
  const message = object(data && data.message)
  const source = object(message && message.source)
  return source && source.kind === 'model' ? source : null
}

export function locateRollbackSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  let userIndex = -1
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const event = eventAt(events, nodes[index])
    if (event && event.type === 'user/message') {
      userIndex = index
      break
    }
  }
  if (userIndex < 0) return null

  let assistantIndex = -1
  let assistantEvent = null
  let source = null
  for (let index = nodes.length - 1; index > userIndex; index -= 1) {
    const event = eventAt(events, nodes[index])
    const candidateSource = event && event.type === 'assistant/message' ? modelSourceOf(event) : null
    if (candidateSource !== null) {
      assistantIndex = index
      assistantEvent = event
      source = candidateSource
      break
    }
  }
  if (assistantIndex < 0 || assistantEvent === null || source === null) return null

  const shadowedSeqs = nodes.slice(userIndex)
  return Object.freeze({
    userSeq: Number(nodes[userIndex]),
    assistantSeq: Number(nodes[assistantIndex]),
    endSeq: Number(shadowedSeqs[shadowedSeqs.length - 1]),
    turn: Math.max(0, Number(assistantEvent.data && assistantEvent.data.turn) || 0),
    step: Math.max(1, Number(assistantEvent.data && assistantEvent.data.step) || 1),
    source,
    shadowedSeqs: Object.freeze(shadowedSeqs.slice())
  })
}

export function planRegenerationSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const oldAssistantSeq = Number(input && input.oldAssistantSeq)
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const oldAssistantIndex = nodes.indexOf(oldAssistantSeq)
  if (oldAssistantIndex < 0) throw new Error('旧正文已经不在当前模型消息面中')

  let finalAssistantIndex = -1
  for (let index = nodes.length - 1; index > oldAssistantIndex; index -= 1) {
    const seq = Number(nodes[index])
    if (seq < eventStart) continue
    const event = eventAt(events, seq)
    if (event && event.type === 'assistant/message' && modelSourceOf(event) !== null) {
      finalAssistantIndex = index
      break
    }
  }
  if (finalAssistantIndex < 0) throw new Error('重新生成流程未在当前模型消息面中产生正文')

  const shadowedSeqs = nodes.slice(oldAssistantIndex, finalAssistantIndex).map(Number)
  if (shadowedSeqs.length === 0) throw new Error('重新生成流程没有需要替换的旧消息')
  return Object.freeze({
    start: shadowedSeqs[0],
    end: shadowedSeqs[shadowedSeqs.length - 1],
    finalAssistantSeq: Number(nodes[finalAssistantIndex]),
    shadowedSeqs: Object.freeze(shadowedSeqs)
  })
}

export function hasRollbackMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = object(list[index])
    if (!message || message.role !== 'assistant' || message.greeting === true) continue
    const user = object(list[index - 1])
    return user !== null && user.role === 'user'
  }
  return false
}
