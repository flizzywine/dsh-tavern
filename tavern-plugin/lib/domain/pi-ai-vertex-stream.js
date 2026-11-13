// Patch `@earendil-works/pi-ai`'s Vertex adapter to enable `streamFunctionCallArguments`,
// project Vertex `partialArgs` into append-only `toolcall_delta` JSON fragments, and keep
// the built-in `google-vertex` Gemini model catalog and Gemini 4 thinking-level detection current.
export const PI_AI_VERTEX_STREAM_MARKER = '/* dsh-tavern:pi-ai-vertex-stream */'
export const PI_AI_GOOGLE_SHARED_MODELS_MARKER = '/* dsh-tavern:pi-ai-google-shared-models */'

const IMAGE_LIMITS = {
  images: {
    resize: {
      maxWidth: 2000,
      maxHeight: 2000,
      maxBytes: 4718592,
      jpegQuality: 80,
    },
  },
}

const THINKING_LEVEL_ALL = {
  off: null,
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: null,
  max: null,
}

const THINKING_LEVEL_LOW_HIGH = {
  off: null,
  minimal: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: null,
  max: null,
}

const THINKING_LEVEL_IMAGE_LITE = {
  off: null,
  minimal: 'minimal',
  low: null,
  medium: null,
  high: 'high',
  xhigh: null,
  max: null,
}

function vertexModel(id, name, cost, options = {}) {
  return {
    id,
    name,
    api: 'google-vertex',
    provider: 'google-vertex',
    baseUrl: 'https://{location}-aiplatform.googleapis.com',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: cost.input, output: cost.output, cacheRead: cost.cacheRead, cacheWrite: 0 },
    contextWindow: options.contextWindow ?? 1048576,
    maxTokens: options.maxTokens ?? 65536,
    ...(options.thinkingLevelMap ? { thinkingLevelMap: options.thinkingLevelMap } : {}),
    inputLimits: IMAGE_LIMITS,
    type: 'chat',
  }
}

export const LATEST_GOOGLE_VERTEX_MODELS = Object.freeze({
  'chat:gemini-2.5-flash': vertexModel('gemini-2.5-flash', 'Gemini 2.5 Flash', { input: 0.3, output: 2.5, cacheRead: 0.03 }),
  'chat:gemini-2.5-flash-lite': vertexModel('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', { input: 0.1, output: 0.4, cacheRead: 0.01 }),
  'chat:gemini-2.5-pro': vertexModel('gemini-2.5-pro', 'Gemini 2.5 Pro', { input: 1.25, output: 10, cacheRead: 0.125 }),
  'chat:gemini-3-flash-preview': vertexModel('gemini-3-flash-preview', 'Gemini 3 Flash Preview', { input: 0.5, output: 3, cacheRead: 0.05 }, { thinkingLevelMap: THINKING_LEVEL_ALL }),
  'chat:gemini-3.1-flash-lite': vertexModel('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', { input: 0.25, output: 1.5, cacheRead: 0.025 }, { thinkingLevelMap: THINKING_LEVEL_ALL }),
  'chat:gemini-3.1-flash-lite-image': vertexModel('gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite', { input: 0.25, output: 30, cacheRead: 0.025 }, { contextWindow: 65536, maxTokens: 4096, thinkingLevelMap: THINKING_LEVEL_IMAGE_LITE }),
  'chat:gemini-3.1-pro-preview': vertexModel('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', { input: 2, output: 12, cacheRead: 0.2 }, { thinkingLevelMap: THINKING_LEVEL_LOW_HIGH }),
  'chat:gemini-3.1-pro-preview-customtools': vertexModel('gemini-3.1-pro-preview-customtools', 'Gemini 3.1 Pro Preview Custom Tools', { input: 2, output: 12, cacheRead: 0.2 }, { thinkingLevelMap: THINKING_LEVEL_LOW_HIGH }),
  'chat:gemini-3.5-flash': vertexModel('gemini-3.5-flash', 'Gemini 3.5 Flash', { input: 1.5, output: 9, cacheRead: 0.15 }, { thinkingLevelMap: THINKING_LEVEL_ALL }),
  'chat:gemini-3.5-flash-lite': vertexModel('gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', { input: 0.3, output: 2.5, cacheRead: 0.03 }, { thinkingLevelMap: THINKING_LEVEL_ALL }),
  'chat:gemini-3.6-flash': vertexModel('gemini-3.6-flash', 'Gemini 3.6 Flash', { input: 0.75, output: 3.75, cacheRead: 0.075 }, { thinkingLevelMap: THINKING_LEVEL_ALL }),
  'chat:gemini-3.7-flash': vertexModel('gemini-3.7-flash', 'Gemini 3.7 Flash', { input: 0.75, output: 3.75, cacheRead: 0.075 }, { thinkingLevelMap: THINKING_LEVEL_ALL }),
  'chat:gemini-3.8-flash': vertexModel('gemini-3.8-flash', 'Gemini 3.8 Flash', { input: 0.75, output: 3.75, cacheRead: 0.075 }, { thinkingLevelMap: THINKING_LEVEL_LOW_HIGH }),
  'chat:gemini-4-argon': vertexModel('gemini-4-argon', 'Gemini 4 Argon', { input: 2, output: 10, cacheRead: 0.1 }, { thinkingLevelMap: THINKING_LEVEL_LOW_HIGH }),
  'chat:gemini-4-carbon': vertexModel('gemini-4-carbon', 'Gemini 4 Carbon', { input: 2, output: 10, cacheRead: 0.1 }, { thinkingLevelMap: THINKING_LEVEL_LOW_HIGH }),
  'chat:gemini-4-hydrogen': vertexModel('gemini-4-hydrogen', 'Gemini 4 Hydrogen', { input: 1.5, output: 7.5, cacheRead: 0.075 }, { thinkingLevelMap: THINKING_LEVEL_LOW_HIGH }),
})

// Self-contained so patchPiAiGoogleVertexSource can serialize it into pi-ai's dist/api/google-vertex.js.
export function supportsVertexStreamFunctionCallArguments(modelId) {
  if (typeof modelId !== 'string') return false
  const id = modelId.trim().toLowerCase()
  const match = id.match(/^gemini(?:-live)?-(\d+)(?:\.(\d+))?/)
  if (!match) return false
  const major = Number.parseInt(match[1], 10)
  if (!Number.isFinite(major) || major < 3) return false
  // Vertex docs explicitly exclude Gemini 3.1 Flash-Lite; image variants do not use text tool-arg streaming.
  if (id.startsWith('gemini-3.1-flash-lite') || id.endsWith('-image')) return false
  return true
}

// Self-contained Vertex `partialArgs` -> append-only JSON `toolcall_delta` state machine.
export function createVertexToolCallStreamer({ output, stream, nextToolCallId, retainThoughtSignature }) {
  let active = null
  const blockIndex = () => output.content.length - 1

  function parseJsonPath(jsonPath) {
    if (typeof jsonPath !== 'string' || jsonPath[0] !== '$') return null
    const segments = []
    let i = 1
    while (i < jsonPath.length) {
      const ch = jsonPath[i]
      if (ch === '.') {
        i++
        const start = i
        while (i < jsonPath.length && jsonPath[i] !== '.' && jsonPath[i] !== '[') i++
        if (i === start) return null
        segments.push(jsonPath.slice(start, i))
      } else if (ch === '[') {
        i++
        const quote = jsonPath[i]
        if (quote === "'" || quote === '"') {
          i++
          let key = ''
          let closed = false
          while (i < jsonPath.length) {
            const c = jsonPath[i++]
            if (c === '\\') {
              if (i >= jsonPath.length) return null
              key += jsonPath[i++]
            } else if (c === quote) {
              closed = true
              break
            } else {
              key += c
            }
          }
          if (!closed || jsonPath[i] !== ']') return null
          i++
          segments.push(key)
        } else {
          const start = i
          while (i < jsonPath.length && jsonPath[i] !== ']') i++
          if (i === start || jsonPath[i] !== ']') return null
          const rawIndex = jsonPath.slice(start, i)
          if (!/^\d+$/.test(rawIndex)) return null
          i++
          segments.push(Number.parseInt(rawIndex, 10))
        }
      } else {
        return null
      }
    }
    return segments
  }

  function hasArgValue(pa) {
    return (
      pa.stringValue !== undefined ||
      pa.numberValue !== undefined ||
      pa.boolValue !== undefined ||
      'nullValue' in pa
    )
  }

  function applyArgToObject(rootArgs, segments, pa) {
    if (!segments || segments.length === 0) return
    let cur = rootArgs
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      const nextSeg = segments[i + 1]
      const existing = cur[seg]
      if (existing === null || typeof existing !== 'object') {
        cur[seg] = typeof nextSeg === 'number' ? [] : {}
      }
      cur = cur[seg]
    }
    const leaf = segments[segments.length - 1]
    if (pa.stringValue !== undefined) {
      cur[leaf] = (typeof cur[leaf] === 'string' ? cur[leaf] : '') + pa.stringValue
    } else if (pa.numberValue !== undefined) {
      cur[leaf] = pa.numberValue
    } else if (pa.boolValue !== undefined) {
      cur[leaf] = pa.boolValue
    } else if ('nullValue' in pa) {
      cur[leaf] = null
    } else if (pa.willContinue !== true && cur[leaf] === undefined) {
      cur[leaf] = ''
    }
  }

  function escapeJsonStringContent(str) {
    return JSON.stringify(str).slice(1, -1)
  }

  function emitDelta(delta) {
    if (!delta || !active) return
    stream.push({
      type: 'toolcall_delta',
      contentIndex: active.contentIndex,
      delta,
      partial: output,
    })
  }

  function emitPartialArg(pa) {
    const segments = parseJsonPath(pa?.jsonPath)
    if (!segments || segments.length === 0) {
      active.linearBroken = true
      return
    }
    applyArgToObject(active.toolCall.arguments, segments, pa)
    if (active.linearBroken) return

    const pathKey = JSON.stringify(segments)
    if (active.openStringPath === pathKey) {
      let chunk = ''
      if (typeof pa.stringValue === 'string' && pa.stringValue.length > 0) {
        chunk += escapeJsonStringContent(pa.stringValue)
      }
      if (pa.willContinue !== true) {
        chunk += '"'
        active.openStringPath = null
      }
      emitDelta(chunk)
      return
    }

    let delta = ''
    if (active.openStringPath !== null) {
      delta += '"'
      active.openStringPath = null
    }

    // Match the open container prefix against segments[0 .. segments.length - 2].
    const stack = active.stack
    let common = 0
    while (common < segments.length - 1 && common + 1 < stack.length && stack[common + 1].seg === segments[common]) {
      common++
    }

    // Validate before mutating `stack` so an out-of-order path never leaves open containers broken.
    const branchFrame = stack[common]
    const branchSeg = segments[common]
    if (branchFrame.kind === 'array') {
      if (typeof branchSeg !== 'number' || branchSeg < branchFrame.count) {
        active.linearBroken = true
        return
      }
    } else {
      if (typeof branchSeg !== 'string' || branchFrame.keys.has(branchSeg)) {
        active.linearBroken = true
        return
      }
    }
    for (let i = common + 1; i < segments.length; i++) {
      const s = segments[i]
      if (typeof s !== 'string' && typeof s !== 'number') {
        active.linearBroken = true
        return
      }
    }

    for (let d = stack.length - 1; d > common; d--) {
      const frame = stack.pop()
      delta += frame.kind === 'array' ? ']' : '}'
    }

    for (let i = common; i < segments.length - 1; i++) {
      const parent = stack[stack.length - 1]
      const seg = segments[i]
      const nextSeg = segments[i + 1]
      const nextKind = typeof nextSeg === 'number' ? 'array' : 'object'
      if (parent.kind === 'array') {
        while (parent.count < seg) {
          delta += (parent.count > 0 ? ',' : '') + 'null'
          parent.count++
        }
        delta += parent.count > 0 ? ',' : ''
        parent.count++
      } else {
        parent.keys.add(seg)
        delta += (parent.count > 0 ? ',' : '') + JSON.stringify(seg) + ':'
        parent.count++
      }
      delta += nextKind === 'array' ? '[' : '{'
      stack.push({ kind: nextKind, seg, count: 0, keys: new Set() })
    }

    const parent = stack[stack.length - 1]
    const leaf = segments[segments.length - 1]
    if (parent.kind === 'array') {
      while (parent.count < leaf) {
        delta += (parent.count > 0 ? ',' : '') + 'null'
        parent.count++
      }
      delta += parent.count > 0 ? ',' : ''
      parent.count++
    } else {
      parent.keys.add(leaf)
      delta += (parent.count > 0 ? ',' : '') + JSON.stringify(leaf) + ':'
      parent.count++
    }

    if (pa.stringValue !== undefined) {
      if (pa.willContinue === true) {
        delta += '"' + escapeJsonStringContent(pa.stringValue)
        active.openStringPath = pathKey
      } else {
        delta += JSON.stringify(pa.stringValue)
      }
    } else if (pa.numberValue !== undefined) {
      delta += JSON.stringify(pa.numberValue)
    } else if (pa.boolValue !== undefined) {
      delta += JSON.stringify(pa.boolValue)
    } else if ('nullValue' in pa) {
      delta += 'null'
    } else if (!hasArgValue(pa)) {
      delta += '""'
    }

    emitDelta(delta)
  }

  function flush() {
    if (!active) return
    const current = active
    active = null
    let closing = ''
    if (current.openStringPath !== null) {
      closing += '"'
      current.openStringPath = null
    }
    while (current.stack.length > 0) {
      const frame = current.stack.pop()
      closing += frame.kind === 'array' ? ']' : '}'
    }
    if (closing.length > 0) {
      stream.push({
        type: 'toolcall_delta',
        contentIndex: current.contentIndex,
        delta: closing,
        partial: output,
      })
    }
    stream.push({
      type: 'toolcall_end',
      contentIndex: current.contentIndex,
      toolCall: current.toolCall,
      partial: output,
    })
  }

  function startToolCall(fc, thoughtSignature) {
    const providedId = fc.id
    const needsNewId = !providedId || output.content.some((b) => b.type === 'toolCall' && b.id === providedId)
    const toolCallId = needsNewId ? nextToolCallId(fc.name || '') : providedId
    const toolCall = {
      type: 'toolCall',
      id: toolCallId,
      name: fc.name || '',
      arguments: {},
      ...(thoughtSignature && { thoughtSignature }),
    }
    output.content.push(toolCall)
    const contentIndex = blockIndex()
    stream.push({ type: 'toolcall_start', contentIndex, partial: output })
    active = {
      contentIndex,
      toolCall,
      stack: [{ kind: 'object', seg: undefined, count: 0, keys: new Set() }],
      openStringPath: null,
      linearBroken: false,
    }
    emitDelta('{')
  }

  function handlePart(part) {
    const fc = part.functionCall
    if (!fc) return

    const hasPartialArgs = Array.isArray(fc.partialArgs) && fc.partialArgs.length > 0
    const isStreaming = Boolean(active || fc.willContinue === true || Array.isArray(fc.partialArgs))

    if (!isStreaming) {
      const providedId = fc.id
      const needsNewId = !providedId || output.content.some((b) => b.type === 'toolCall' && b.id === providedId)
      const toolCallId = needsNewId ? nextToolCallId(fc.name || '') : providedId
      const toolCall = {
        type: 'toolCall',
        id: toolCallId,
        name: fc.name || '',
        arguments: fc.args ?? {},
        ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
      }
      output.content.push(toolCall)
      stream.push({ type: 'toolcall_start', contentIndex: blockIndex(), partial: output })
      stream.push({
        type: 'toolcall_delta',
        contentIndex: blockIndex(),
        delta: JSON.stringify(toolCall.arguments),
        partial: output,
      })
      stream.push({ type: 'toolcall_end', contentIndex: blockIndex(), toolCall, partial: output })
      return
    }

    if (fc.name) {
      if (active) flush()
      startToolCall(fc, part.thoughtSignature)
    } else if (!active) {
      // Defensive fallback if an unnamed partialArgs chunk arrives first.
      startToolCall(fc, part.thoughtSignature)
    }

    if (part.thoughtSignature && active) {
      const retained = retainThoughtSignature(active.toolCall.thoughtSignature, part.thoughtSignature)
      if (retained) active.toolCall.thoughtSignature = retained
    }

    if (hasPartialArgs && active) {
      for (const pa of fc.partialArgs) {
        emitPartialArg(pa)
      }
    }

    if (fc.willContinue !== true) {
      flush()
    }
  }

  return {
    handlePart,
    flush,
    hasActive: () => active !== null,
  }
}

function replaceOnce(text, from, to) {
  const first = text.indexOf(from)
  if (first < 0 || text.indexOf(from, first + from.length) >= 0) return null
  return text.slice(0, first) + to + text.slice(first + from.length)
}

export function patchPiAiGoogleVertexSource(source) {
  const text = String(source)
  if (text.includes(PI_AI_VERTEX_STREAM_MARKER)) return { status: 'patched', text }
  let patched = text

  const replacements = [
    [
      '\n            let currentBlock = null;\n            const blocks = output.content;\n            const blockIndex = () => blocks.length - 1;',
      '\n            let currentBlock = null;\n            const blocks = output.content;\n            const blockIndex = () => blocks.length - 1;\n            const toolCallStreamer = createVertexToolCallStreamer({\n                output,\n                stream,\n                nextToolCallId: (name) => `${name}_${Date.now()}_${++toolCallCounter}`,\n                retainThoughtSignature,\n            });',
    ],
    [
      '\n                        if (part.text !== undefined) {',
      '\n                        if (part.text !== undefined) {\n                            toolCallStreamer.flush();',
    ],
    [
      '\n                            const providedId = part.functionCall.id;\n'
      + '                            const needsNewId = !providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);\n'
      + '                            const toolCallId = needsNewId\n'
      + '                                ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`\n'
      + '                                : providedId;\n'
      + '                            const toolCall = {\n'
      + '                                type: "toolCall",\n'
      + '                                id: toolCallId,\n'
      + '                                name: part.functionCall.name || "",\n'
      + '                                arguments: part.functionCall.args ?? {},\n'
      + '                                ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),\n'
      + '                            };\n'
      + '                            output.content.push(toolCall);\n'
      + '                            stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });\n'
      + '                            stream.push({\n'
      + '                                type: "toolcall_delta",\n'
      + '                                contentIndex: blockIndex(),\n'
      + '                                delta: JSON.stringify(toolCall.arguments),\n'
      + '                                partial: output,\n'
      + '                            });\n'
      + '                            stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });',
      '\n                            toolCallStreamer.handlePart(part);',
    ],
    [
      '\n                if (candidate?.finishReason) {',
      '\n                if (candidate?.finishReason) {\n                    toolCallStreamer.flush();',
    ],
    [
      '\n            if (currentBlock) {',
      '\n            toolCallStreamer.flush();\n            if (currentBlock) {',
    ],
    [
      '\n        ...(functionCallingMode !== undefined && {\n'
      + '            toolConfig: { functionCallingConfig: { mode: functionCallingMode } },\n'
      + '        }),',
      '\n        ...(currentTools.length > 0 && (functionCallingMode !== undefined || (supportsVertexStreamFunctionCallArguments(model.id) && functionCallingMode !== "NONE")) && {\n'
      + '            toolConfig: {\n'
      + '                functionCallingConfig: {\n'
      + '                    ...(functionCallingMode !== undefined && { mode: functionCallingMode }),\n'
      + '                    ...(supportsVertexStreamFunctionCallArguments(model.id) && functionCallingMode !== "NONE" && { streamFunctionCallArguments: true }),\n'
      + '                },\n'
      + '            },\n'
      + '        }),\n'
      + '        ...(currentTools.length > 0 && supportsVertexStreamFunctionCallArguments(model.id) && functionCallingMode !== "NONE" && {\n'
      + '            automaticFunctionCalling: { disable: true },\n'
      + '        }),',
    ],
  ]

  for (const [from, to] of replacements) {
    patched = replaceOnce(patched, from, to)
    if (patched === null) return { status: 'unmatched', text }
  }

  const anchor = 'export const stream = (model, context, options) => {'
  const helperBlock = `${PI_AI_VERTEX_STREAM_MARKER}\n${supportsVertexStreamFunctionCallArguments.toString()}\n${createVertexToolCallStreamer.toString()}\n\n${anchor}`
  patched = replaceOnce(patched, anchor, helperBlock)
  if (patched === null) return { status: 'unmatched', text }
  return { status: 'applied', text: patched }
}

export function patchPiAiGoogleSharedSource(source) {
  const text = String(source)
  if (text.includes(PI_AI_GOOGLE_SHARED_MODELS_MARKER) || text.includes('/gemini-(?:[4-9]|[1-9]\\d)/.test(id)')) {
    return { status: 'patched', text }
  }
  const from = '    /gemini-3(?:\\.\\d+)?-(?:pro|flash)/.test(id) ||\n        id === "gemini-flash-latest" ||'
  const to = `    ${PI_AI_GOOGLE_SHARED_MODELS_MARKER}\n    /gemini-3(?:\\.\\d+)?-(?:pro|flash)/.test(id) ||\n        /gemini-(?:[4-9]|[1-9]\\d)/.test(id) ||\n        id === "gemini-flash-latest" ||`
  const patched = replaceOnce(text, from, to)
  if (patched === null) return { status: 'unmatched', text }
  return { status: 'applied', text: patched }
}

export function patchPiAiGoogleVertexModelsJson(source) {
  let parsed
  try {
    parsed = JSON.parse(String(source))
  } catch {
    return { status: 'unmatched', text: String(source) }
  }
  if (!parsed || typeof parsed !== 'object' || !parsed['google-vertex'] || typeof parsed['google-vertex'] !== 'object') {
    return { status: 'unmatched', text: String(source) }
  }
  const existing = parsed['google-vertex']
  let changed = false
  const next = { ...existing }
  for (const [key, model] of Object.entries(LATEST_GOOGLE_VERTEX_MODELS)) {
    const serialized = JSON.stringify(model)
    if (!existing[key] || JSON.stringify(existing[key]) !== serialized) {
      next[key] = structuredClone(model)
      changed = true
    }
  }
  if (!changed) return { status: 'patched', text: String(source) }
  parsed['google-vertex'] = next
  return { status: 'applied', text: JSON.stringify(parsed) }
}
