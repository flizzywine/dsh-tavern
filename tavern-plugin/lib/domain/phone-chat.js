import { randomUUID } from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function compact(value, maximum) {
  return str(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function contactId(name) {
  return encodeURIComponent(str(name).trim().toLocaleLowerCase())
}

function contactsOf(card, chat) {
  const contacts = []
  const seen = new Set()
  function add(name, profile, main = false) {
    const normalized = str(name).trim()
    const id = contactId(normalized)
    if (normalized === '' || seen.has(id)) return
    seen.add(id)
    contacts.push({ id, name: normalized, profile: compact(profile, 1200), main })
  }
  add(card && card.name || chat && chat.cardName, [card && card.description, card && card.personality].filter(Boolean).join('\n'), true)
  const document = object(chat && chat.characterDesignDocument)
  for (const character of Array.isArray(document.characters) ? document.characters : []) {
    const design = object(character && character.design)
    add(character && character.name, [
      design.identity,
      design.narrativeRole,
      design.personality,
      design.relationships,
      design.speechStyle
    ].filter(Boolean).join('\n'))
  }
  return contacts
}

function phoneDocument(chat) {
  const source = object(chat && chat.phoneChat)
  return {
    version: 1,
    threads: Array.isArray(source.threads) ? source.threads.filter(function (thread) {
      return thread && typeof thread === 'object' && str(thread.contactId) !== ''
    }).map(function (thread) {
      return {
        contactId: str(thread.contactId),
        messages: (Array.isArray(thread.messages) ? thread.messages : []).filter(function (message) {
          return message && (message.role === 'user' || message.role === 'assistant') && str(message.text).trim() !== ''
        }).slice(-200).map(function (message) {
          return {
            id: str(message.id),
            requestId: str(message.requestId),
            role: message.role,
            text: str(message.text),
            createdAt: Math.max(0, Number(message.createdAt) || 0),
            status: message.status === 'pending' || message.status === 'failed' ? message.status : 'sent',
            error: compact(message.error, 300)
          }
        })
      }
    }) : []
  }
}

function threadOf(document, id) {
  let thread = document.threads.find(function (item) { return item.contactId === id })
  if (thread === undefined) {
    thread = { contactId: id, messages: [] }
    document.threads.push(thread)
  }
  return thread
}

function projectedThread(document, contact) {
  const source = document.threads.find(function (thread) { return thread.contactId === contact.id })
  const messages = source ? source.messages : []
  const last = messages[messages.length - 1]
  return {
    contactId: contact.id,
    messages,
    preview: last ? compact(last.text, 60) : '',
    updatedAt: last ? last.createdAt : 0,
    pending: messages.some(function (message) { return message.status === 'pending' })
  }
}

export function projectPhoneChat(chat, card) {
  const contacts = contactsOf(card, chat)
  const document = phoneDocument(chat)
  return {
    contacts,
    threads: contacts.map(function (contact) { return projectedThread(document, contact) })
  }
}

function modelMessages(messages, now) {
  return messages.slice(-24).map(function (message, index) {
    return {
      id: 'phone-' + index + '-' + now.toString(36),
      role: message.role,
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'plugin', plugin: 'dsh-tavern-phone' }
    }
  })
}

function recentStory(chat) {
  return (Array.isArray(chat && chat.messages) ? chat.messages : []).filter(function (message) {
    return message && message.role === 'assistant' && str(message.text).trim() !== ''
  }).slice(-3).map(function (message) { return compact(message.text, 900) }).join('\n\n')
}

export function createPhoneChat(options) {
  const store = options.store
  const runAgent = options.runAgent
  const selection = options.selection
  const now = typeof options.now === 'function' ? options.now : Date.now
  const id = typeof options.id === 'function' ? options.id : randomUUID
  const queues = new Map()
  const activeRequests = new Set()

  function requestKey(chatId, contactIdValue, requestId) {
    return [str(chatId), str(contactIdValue), str(requestId)].join('\u0000')
  }

  function project(chat, card) {
    const result = projectPhoneChat(chat, card)
    for (const thread of result.threads) {
      thread.messages = thread.messages.map(function (message) {
        if (message.status !== 'pending' || activeRequests.has(requestKey(chat.id, thread.contactId, message.requestId))) return message
        return Object.assign({}, message, { status: 'failed', error: '回复因服务重启或中断而停止，请重新发送。' })
      })
      thread.pending = thread.messages.some(function (message) { return message.status === 'pending' })
    }
    return result
  }

  async function saveMessage(chatId, contact, requestId, text) {
    return await store.updateChat(chatId, function (chat) {
      const document = phoneDocument(chat)
      const thread = threadOf(document, contact.id)
      const duplicate = thread.messages.find(function (message) { return message.requestId === requestId && message.role === 'user' })
      if (duplicate === undefined) {
        thread.messages.push({ id: id(), requestId, role: 'user', text, createdAt: now(), status: 'pending', error: '' })
      }
      chat.phoneChat = document
      return chat
    }, { source: 'phone-chat.send', requestId })
  }

  async function finish(chatId, contactIdValue, requestId, reply) {
    return await store.updateChat(chatId, function (chat) {
      const document = phoneDocument(chat)
      const thread = threadOf(document, contactIdValue)
      const pending = thread.messages.find(function (message) { return message.requestId === requestId && message.role === 'user' })
      if (pending === undefined) return chat
      pending.status = 'sent'
      pending.error = ''
      if (!thread.messages.some(function (message) { return message.requestId === requestId && message.role === 'assistant' })) {
        thread.messages.push({ id: id(), requestId, role: 'assistant', text: reply, createdAt: now(), status: 'sent', error: '' })
      }
      chat.phoneChat = document
      return chat
    }, { source: 'phone-chat.reply', requestId })
  }

  async function fail(chatId, contactIdValue, requestId, error) {
    await store.updateChat(chatId, function (chat) {
      const document = phoneDocument(chat)
      const thread = threadOf(document, contactIdValue)
      const pending = thread.messages.find(function (message) { return message.requestId === requestId && message.role === 'user' })
      if (pending !== undefined) {
        pending.status = 'failed'
        pending.error = compact(error && error.message || error, 300) || '回复生成失败'
      }
      chat.phoneChat = document
      return chat
    }, { source: 'phone-chat.fail', requestId })
  }

  async function execute(input) {
    const sessionId = str(input.sessionId)
    const requestId = str(input.requestId).trim()
    const text = str(input.text).trim().slice(0, 1200)
    if (sessionId === '' || requestId === '' || text === '') throw new Error('手机聊天缺少会话、请求或消息内容')
    let chat = await store.chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前 Session 没有对应的 Tavern Chat')
    const card = await store.readCard(chat.cardPath)
    if (card === undefined) throw new Error('当前人物卡不存在')
    const contacts = contactsOf(card, chat)
    const contact = contacts.find(function (item) { return item.id === str(input.contactId) })
    if (contact === undefined) throw new Error('聊天联系人不存在或已经变化')
    const existingThread = phoneDocument(chat).threads.find(function (thread) { return thread.contactId === contact.id })
    if (existingThread && existingThread.messages.some(function (message) { return message.requestId === requestId })) {
      return project(chat, card)
    }
    chat = await saveMessage(chat.id, contact, requestId, text)
    const document = phoneDocument(chat)
    const thread = threadOf(document, contact.id)
    const selected = selection(chat)
    if (selected === null || selected === undefined) {
      const error = new Error('当前没有可用的后台模型')
      await fail(chat.id, contact.id, requestId, error)
      throw error
    }
    const context = [
      '联系人：' + contact.name,
      contact.profile ? '人物设定：\n' + contact.profile : '',
      chat.posture ? '当前场景状态：\n' + compact(chat.posture, 1200) : '',
      recentStory(chat) ? '最近剧情：\n' + recentStory(chat) : ''
    ].filter(Boolean).join('\n\n')
    const activeKey = requestKey(chat.id, contact.id, requestId)
    activeRequests.add(activeKey)
    try {
      const result = await runAgent({
        sessionId,
        task: 'phone',
        selection: selected,
        temperature: 0.9,
        system: '你正在通过手机聊天 App 扮演联系人“' + contact.name + '”。只输出对方发来的聊天内容，不写旁白、动作描写、引号、角色名前缀、分析或格式说明。保持人物口吻和已发生剧情一致；不知道的信息不要编造为已发生事实。通常回复一到三条短消息。',
        turnContext: context,
        messages: modelMessages(thread.messages, now()),
        tools: [],
        persistent: false,
        webSearchEnabled: false,
        onToolCall: async function () { return JSON.stringify({ ok: false, error: '手机私聊任务不提供工具' }) }
      })
      const reply = str(result && result.text).trim()
      if (reply === '') throw new Error('联系人没有返回聊天内容')
      chat = await finish(chat.id, contact.id, requestId, reply.slice(0, 4000))
      return project(chat, card)
    } catch (error) {
      await fail(chat.id, contact.id, requestId, error).catch(function () {})
      throw error
    } finally {
      activeRequests.delete(activeKey)
    }
  }

  function send(input) {
    const key = str(input && input.sessionId)
    const previous = queues.get(key) || Promise.resolve()
    const current = previous.catch(function () {}).then(function () { return execute(input || {}) })
    queues.set(key, current)
    return current.finally(function () { if (queues.get(key) === current) queues.delete(key) })
  }

  return Object.freeze({ project, send })
}
