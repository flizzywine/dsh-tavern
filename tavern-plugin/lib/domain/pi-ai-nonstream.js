// DSH 0.2.1's pi-ai adapter always calls pi-ai's streamSimple(). The OpenAI-compatible
// protocol it uses for the Replit route can answer a settled JSON completion instead.
// Keep pi-ai's parser by projecting that completion into one synthetic chunk, and pass
// the caller's stream flag through the adapter and streamSimple boundary.
export const PI_AI_NONSTREAM_MARKER = '/* dsh-tavern:pi-ai-nonstream */'
export const PI_AI_ADAPTER_MARKER = '/* dsh-tavern:pi-ai-stream-option */'
export const PI_AI_TOOL_CHOICE_MARKER = '/* dsh-tavern:pi-ai-tool-choice */'

export function openAICompletionChunks(completion, modelId = '') {
  const response = completion && typeof completion === 'object' ? completion : {}
  const choice = Array.isArray(response.choices) ? response.choices[0] : undefined
  if (!choice || typeof choice !== 'object') return []
  const message = choice.message && typeof choice.message === 'object' ? choice.message : {}
  const delta = { role: typeof message.role === 'string' ? message.role : 'assistant' }
  if (typeof message.content === 'string' && message.content.length > 0) delta.content = message.content
  for (const field of ['reasoning_content', 'reasoning', 'reasoning_text']) {
    if (typeof message[field] === 'string' && message[field].length > 0) {
      delta[field] = message[field]
      break
    }
  }
  if (Array.isArray(message.reasoning_details)) delta.reasoning_details = message.reasoning_details
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  if (toolCalls.length > 0) {
    delta.tool_calls = toolCalls.map((toolCall, index) => {
      const call = toolCall && typeof toolCall === 'object' ? toolCall : {}
      const fn = call.function && typeof call.function === 'object' ? call.function : {}
      const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
      return {
        index,
        ...(call.id ? { id: call.id } : {}),
        ...(call.type ? { type: call.type } : {}),
        function: { ...(fn.name ? { name: fn.name } : {}), arguments: args },
        ...(call.custom ? { custom: call.custom } : {}),
      }
    })
  }
  const finishReason = typeof choice.finish_reason === 'string' && choice.finish_reason !== ''
    ? choice.finish_reason
    : toolCalls.length > 0 ? 'tool_calls' : 'stop'
  return [{
    id: response.id,
    model: typeof response.model === 'string' && response.model !== '' ? response.model : modelId,
    choices: [{ index: Number.isSafeInteger(choice.index) ? choice.index : 0, delta, finish_reason: finishReason, ...(choice.usage ? { usage: choice.usage } : {}) }],
    ...(response.usage ? { usage: response.usage } : {}),
  }]
}

function replaceOnce(text, from, to) {
  const first = text.indexOf(from)
  if (first < 0 || text.indexOf(from, first + from.length) >= 0) return null
  return text.slice(0, first) + to + text.slice(first + from.length)
}

/** Patch pi-ai's OpenAI-compatible stream parser so `stream:false` is a real JSON request. */
export function patchPiAiOpenAICompletionsSource(source) {
  const text = String(source)
  if (text.includes(PI_AI_NONSTREAM_MARKER)) return { status: 'patched', text }
  let patched = text
  const replacements = [
    ['        stream: true,\n        prompt_cache_key:', '        stream: options?.stream !== false,\n        prompt_cache_key:'],
    ['    if (compat.supportsUsageInStreaming !== false) {', '    if (params.stream && compat.supportsUsageInStreaming !== false) {'],
    ['        reasoningEffort,\n        thinkingBudgets: options?.thinkingBudgets,\n    });',
      '        reasoningEffort,\n        thinkingBudgets: options?.thinkingBudgets,\n        ...(options?.stream === false ? { stream: false } : {}),\n    });'],
    ['            for await (const chunk of openaiStream) {',
      '            const openaiChunks = options?.stream === false ? openAICompletionChunks(openaiStream, model.id) : openaiStream;\n            for await (const chunk of openaiChunks) {'],
  ]
  for (const [from, to] of replacements) {
    patched = replaceOnce(patched, from, to)
    if (patched === null) return { status: 'unmatched', text }
  }
  const anchor = 'export const stream = (model, context, options) => {'
  if (!patched.includes(anchor) || patched.indexOf(anchor) !== patched.lastIndexOf(anchor)) return { status: 'unmatched', text }
  patched = patched.replace(anchor, `${PI_AI_NONSTREAM_MARKER}\n${openAICompletionChunks.toString()}\n\n${anchor}`)
  return { status: 'applied', text: patched }
}

/** Pass the caller's stream flag and toolChoice through the host adapter into pi-ai. */
export function patchPiAiAdapterSource(source) {
  let text = String(source)
  let changed = false
  if (!text.includes(PI_AI_ADAPTER_MARKER)) {
    const from = '\t\t\t\t\t...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },\n\t\t\t\t\tsignal: watchdog.signal,'
    const to = `\t\t\t\t\t...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },\n\t\t\t\t\t${PI_AI_ADAPTER_MARKER}\n\t\t\t\t\t...typeof options.stream === "boolean" ? { stream: options.stream } : {},\n\t\t\t\t\t${PI_AI_TOOL_CHOICE_MARKER}\n\t\t\t\t\t...options.toolChoice === void 0 ? {} : { toolChoice: options.toolChoice },\n\t\t\t\t\tsignal: watchdog.signal,`
    const patched = replaceOnce(text, from, to)
    if (patched === null) return { status: 'unmatched', text: String(source) }
    text = patched
    changed = true
  } else if (!text.includes(PI_AI_TOOL_CHOICE_MARKER)) {
    const from = `${PI_AI_ADAPTER_MARKER}\n\t\t\t\t\t...typeof options.stream === "boolean" ? { stream: options.stream } : {},`
    const to = `${from}\n\t\t\t\t\t${PI_AI_TOOL_CHOICE_MARKER}\n\t\t\t\t\t...options.toolChoice === void 0 ? {} : { toolChoice: options.toolChoice },`
    const patched = replaceOnce(text, from, to)
    if (patched !== null) {
      text = patched
      changed = true
    }
  }
  return { status: changed ? 'applied' : 'patched', text }
}
