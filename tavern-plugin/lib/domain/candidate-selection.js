export function formatCandidateInput(choice) {
  if (!choice || typeof choice !== 'object') return ''
  const text = typeof choice.text === 'string' ? choice.text.trim() : ''
  if (!text) return ''
  if (choice.type === 'scene') return '【场景变化】' + text
  if (choice.type === 'event') return '【突发事件】' + text
  const actor = typeof choice.actor === 'string' ? choice.actor.trim() : ''
  if (actor && actor !== '我' && !text.includes(actor)) return actor + '：' + text
  return text
}

export function selectCandidate(saved, source, previousRequestId) {
  if (!previousRequestId || saved?.requestId !== previousRequestId) throw new Error('上一轮候选不存在或已变化，停止动态输入')
  const type = source.type || 'action'
  const actor = typeof source.actor === 'string' ? source.actor.trim() : ''
  const choices = (saved.choices || []).map((choice, index) => ({ ...choice, index })).filter(choice =>
    choice.type === type && (!actor || choice.actor === actor)
  )
  const choice = choices[source.candidate - 1]
  if (!choice || typeof choice.text !== 'string' || !choice.text.trim()) throw new Error('指定候选不存在或内容为空')
  return { requestId: saved.requestId, messageId: saved.messageId, type, ...(choice.actor ? { actor: choice.actor } : {}), candidate: source.candidate, index: choice.index, text: choice.text,
    input: formatCandidateInput({ ...choice, type }) }
}
