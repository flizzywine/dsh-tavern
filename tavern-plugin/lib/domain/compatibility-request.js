function freezeTree(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeTree))
  if (value === null || typeof value !== 'object') return value
  const copy = {}
  for (const [key, item] of Object.entries(value)) copy[key] = freezeTree(item)
  return Object.freeze(copy)
}

export function createEphemeralCompatibilityRequest(options, messages) {
  if (options === null || typeof options !== 'object') throw new TypeError('模型请求必须是对象')
  if (!Array.isArray(messages)) throw new TypeError('兼容请求消息必须是数组')
  return Object.freeze(Object.assign({}, options, {
    stream: false,
    messages: freezeTree(messages)
  }))
}

export function isCompatibilityConversationRequest(options, staged, coordinates) {
  return options !== null && typeof options === 'object' && options.purpose === undefined &&
    staged !== null && typeof staged === 'object' &&
    Number(staged.turn) === Number(coordinates && coordinates.turn) &&
    Number(staged.step) === Number(coordinates && coordinates.step)
}
