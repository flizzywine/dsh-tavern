import candidateTabs from '../../packages/dsh-presentation-protocol/src/candidate-tabs.cjs'

export function formatCandidateInput(choice) {
  return candidateTabs.formatCandidateChoiceText(choice)
}

export function selectCandidate(saved, source, previousRequestId) {
  if (!previousRequestId || saved?.requestId !== previousRequestId) throw new Error('上一轮候选不存在或已变化，停止动态输入')
  const type = source.type || 'action'
  const actor = typeof source.actor === 'string' ? source.actor.trim() : ''
  const choices = (saved.choices || []).map((choice, index) => ({ ...choice, index })).filter(choice =>
    choice.type === type && (!actor || choice.actor === actor || (Array.isArray(choice.actors) && choice.actors.includes(actor)))
  )
  const choice = choices[source.candidate - 1]
  if (!choice || typeof choice.text !== 'string' || !choice.text.trim()) throw new Error('指定候选不存在或内容为空')
  return { requestId: saved.requestId, messageId: saved.messageId, type, ...(choice.actor ? { actor: choice.actor } : {}),
    ...(Array.isArray(choice.actors) && choice.actors.length > 0 ? { actors: choice.actors } : {}),
    candidate: source.candidate, index: choice.index, text: choice.text,
    input: formatCandidateInput({ ...choice, type }) }
}
