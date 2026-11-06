export function selectCandidate(saved, source, previousRequestId) {
  if (!previousRequestId || saved?.requestId !== previousRequestId) throw new Error('上一轮候选不存在或已变化，停止动态输入')
  const type = source.type || 'action'
  const choices = (saved.choices || []).map((choice, index) => ({ ...choice, index })).filter(choice => choice.type === type)
  const choice = choices[source.candidate - 1]
  if (!choice || typeof choice.text !== 'string' || !choice.text.trim()) throw new Error('指定候选不存在或内容为空')
  return { requestId: saved.requestId, messageId: saved.messageId, type, candidate: source.candidate, index: choice.index, text: choice.text,
    input: type === 'scene' ? '【场景变化】' + choice.text : choice.text }
}
