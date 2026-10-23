import { mutateScriptPrompts } from './tavern-script-prompts.js'

// This compiler operates on an uncommitted opening, never an existing timeline.
export function parseOpeningCommand(line) {
  const parts = String(line || '').trim().split(/(?<!\\)\|(?=\s*\/)/).map(part => part.trim())
  if (parts.length === 1 && parts[0] === '/trigger') return { input: '继续。' }
  if (parts.pop() !== '/trigger') throw new Error('开局命令需要以 /trigger 结束')
  const head = /^\/(sys|send)\s+([\s\S]+)$/.exec(parts.shift() || '')
  if (!head || !head[2].trim()) throw new Error('开局命令只支持 /sys 或 /send 文本后接 /trigger')
  const removeGreeting = parts.length === 1 && parts[0] === '/cut 0'
  if (parts.length && (!removeGreeting || head[1] !== 'sys')) {
    throw new Error('准备页只支持 /sys … | /cut 0 | /trigger；不能删除其他楼层或执行其他管道')
  }
  const text = head[2].trim().replace(/\\\|/g, '|')
  return head[1] === 'send' ? { input: text } : { input: '继续。', systemText: text, removeGreeting }
}

// A wizard usually sends its input ("/send text") or its narration ("/sys text")
// and only starts the game on a following "/trigger". Answering the first call by
// starting the turn unmounted the page before the wizard could save its own data,
// so a lone /send or /sys is remembered and applied when the /trigger arrives.
export function parsePendingOpeningCommand(line) {
  const text = String(line || '').trim()
  if (!text || /(?<!\\)\|(?=\s*\/)/.test(text)) return null
  const head = /^\/(send|sys)\s+([\s\S]+)$/.exec(text)
  if (!head || !head[2].trim()) return null
  const body = head[2].trim().replace(/\\\|/g, '|')
  return head[1] === 'send' ? { sendText: body } : { systemText: body }
}

// Only a bare /trigger consumes what the wizard prepared; an explicit pipe says
// what it wants and takes over.
export function applyPendingOpeningCommand(command, pending, line) {
  if (!pending || String(line || '').trim() !== '/trigger') return command
  const merged = { ...command }
  if (pending.sendText) merged.input = pending.sendText
  if (pending.systemText) { merged.systemText = pending.systemText; merged.removeGreeting = false }
  return merged
}

export function applyOpeningCommand(chat, command, variables, now) {
  if (!command?.systemText) return
  if (command.removeGreeting) {
    chat.messages = chat.messages.filter(message => !message.greeting)
    chat.openingText = ''
  }
  // A system floor is preparation state, not an assistant-authored story round.
  // Keep its MVU baseline after removing the wizard that originally owned it.
  const text = command.systemText
  chat.messages.push({ role: 'system', text, sourceText: text, ts: now(),
    swipeId: 0, swipes: [text], variables: [structuredClone(variables || {})] })
  mutateScriptPrompts(chat, { kind: 'inject', once: true, prompts: [{
    id: 'dsh-opening-system', content: text, role: 'system', position: 'in_chat', depth: 0
  }] })
  if (command.removeGreeting && chat.mvu?.enabled && variables?.stat_data !== undefined && variables?.schema !== undefined) {
    chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: now() }
  }
}
