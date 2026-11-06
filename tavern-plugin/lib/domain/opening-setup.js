// An explicit opening choice overrides alignment only for a new conversation.
export function parseOpeningScriptStart(value) {
  if (value === undefined) return undefined
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1) {
    if (value.mode === 'story') return { mode: 'story' }
    if (Number.isSafeInteger(value.chunk) && value.chunk >= 1) return { chunk: value.chunk }
  }
  throw new Error('剧本起点须为 { chunk: 从 1 开始的整数 } 或 { mode: "story" }')
}
