// Tavern Helper injection state belongs to one chat and follows its checkpoints.
// DSH applies in_chat prompts to the next native Frame, never to old messages.
export function mutateScriptPrompts(chat, operation = {}) {
  if (operation.kind === 'batch') {
    if (!Array.isArray(operation.operations) || operation.operations.length > 64 || operation.operations.some(item => !item || !['inject', 'remove'].includes(item.kind))) throw new TypeError('无效的提示词批次')
    const draft = { tavernScriptPrompts: chat.tavernScriptPrompts || [] }
    for (const item of operation.operations) mutateScriptPrompts(draft, item)
    const changed = JSON.stringify(draft.tavernScriptPrompts) !== JSON.stringify(chat.tavernScriptPrompts || [])
    if (changed) chat.tavernScriptPrompts = draft.tavernScriptPrompts
    return changed
  }
  const current = new Map((chat.tavernScriptPrompts || []).map(prompt => [prompt.id, prompt]))
  if (operation.kind === 'remove') {
    if (!Array.isArray(operation.ids) || operation.ids.some(id => typeof id !== 'string')) throw new TypeError('提示词 ID 必须是字符串数组')
    for (const id of operation.ids) current.delete(id)
  } else if (operation.kind === 'inject') {
    if (!Array.isArray(operation.prompts)) throw new TypeError('提示词必须是数组')
    const normalized = operation.prompts.map(prompt => {
      if (!prompt || typeof prompt.id !== 'string' || !prompt.id || typeof prompt.content !== 'string') throw new TypeError('提示词需要 id 和 content')
      if (!['in_chat', 'none'].includes(prompt.position)) throw new TypeError('不支持的提示词位置')
      if (!['system', 'user', 'assistant'].includes(prompt.role)) throw new TypeError('无效的提示词角色')
      const depth = prompt.position === 'none' && prompt.depth === undefined ? 0 : prompt.depth
      if (!Number.isSafeInteger(depth) || depth < 0) throw new TypeError('提示词 depth 必须是非负整数')
      if (prompt.filter !== undefined) throw new Error('DSH 暂不支持提示词 filter 回调')
      return { id: prompt.id, content: prompt.content, position: prompt.position, role: prompt.role,
        depth, should_scan: prompt.should_scan !== false, once: operation.once === true }
    })
    for (const prompt of normalized) current.set(prompt.id, prompt)
  } else throw new TypeError('未知提示词操作')
  const next = Array.from(current.values())
  const previous = chat.tavernScriptPrompts || []
  const fields = ['id', 'content', 'position', 'role', 'depth', 'should_scan', 'once']
  const changed = previous.length !== next.length || next.some((prompt, index) =>
    fields.some(field => prompt[field] !== previous[index][field]))
  if (changed) chat.tavernScriptPrompts = next
  return changed
}

export function scriptPromptScanText(chat) {
  return (chat?.tavernScriptPrompts || []).filter(prompt => prompt.should_scan !== false).map(prompt => prompt.content).join('\n')
}

export function scriptPromptFrameInputs(chat) {
  return (chat?.tavernScriptPrompts || []).filter(prompt => prompt.position === 'in_chat').map(prompt => ({
    kind: 'foreground.guide', text: prompt.content, required: true,
    source: { stage: 'tavern-script-prompt', id: prompt.id, role: prompt.role, depth: prompt.depth }
  }))
}

export function consumeScriptPrompts(chat) {
  if (Array.isArray(chat.tavernScriptPrompts)) chat.tavernScriptPrompts = chat.tavernScriptPrompts.filter(prompt => !prompt.once)
}
