/** Keep host-owned attachment references; only text participates in Tavern transforms. */
export function inputAttachments(content) {
  return structuredClone((Array.isArray(content) ? content : []).filter(block => block && block.type !== 'text'))
}

export function projectPlayerContent(content, text, { fallback = true } = {}) {
  const blocks = Array.isArray(content) ? content : []
  const projected = String(text ?? '')
  const result = []
  let inserted = false
  for (const block of blocks) {
    if (block?.type === 'text') {
      if (!inserted && projected.trim()) result.push({ type: 'text', text: projected })
      inserted = true
    } else if (block) result.push(structuredClone(block))
  }
  if (!inserted && projected.trim()) result.unshift({ type: 'text', text: projected })
  if (!result.length && fallback) result.push({ type: 'text', text: '（玩家已更新酒馆运行状态）' })
  return result
}
