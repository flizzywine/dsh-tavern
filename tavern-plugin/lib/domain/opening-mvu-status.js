// Only the official runtime owns this marker. Older saves have no reliable marker.
export function openingMvuStatus(chat) {
  if (chat?.mvu?.enabled !== true || chat.mvu.owner !== 'official') return 'not-required'
  const status = chat.mvu.openingInitialization?.status
  return status === 'pending' || status === 'complete' ? status : 'unknown'
}

export function assertOpeningMvuWritable(chat) {
  if (openingMvuStatus(chat) === 'pending') {
    throw Object.assign(new Error('正在准备旅程，请稍后再修改变量。'), { code: 'TAVERN_MVU_OPENING_PENDING' })
  }
}
