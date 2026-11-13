import { AsyncLocalStorage } from 'node:async_hooks'

export const GEMINI_THOUGHT_SIGNATURE_SENTINEL = 'skip_thought_signature_validator'
export const GEMINI_ALT_THOUGHT_SIGNATURE_SENTINEL = 'context_engineering_is_the_way_to_go'
export const GEMINI_THOUGHT_SIGNATURE_SENTINEL_BASE64 = Buffer.from(
  GEMINI_THOUGHT_SIGNATURE_SENTINEL,
  'utf8'
).toString('base64')

const ALT_SENTINEL_BASE64 = Buffer.from(
  GEMINI_ALT_THOUGHT_SIGNATURE_SENTINEL,
  'utf8'
).toString('base64')

const BASE64_SIGNATURE_RE = /^[A-Za-z0-9+/]+={0,2}$/
const AUTO_TOOL_ONLY_MODEL_RE = /^pg-/i
const GEMINI_MODEL_RE = /gemini/i

const directiveStorage = new AsyncLocalStorage()
const capturedSignatures = new Map()
const MAX_CAPTURED_SIGNATURES = 512
const fetchPatches = new WeakMap()

function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

export function isAutoToolOnlyModel(modelId) {
  return AUTO_TOOL_ONLY_MODEL_RE.test(str(modelId).trim())
}

export function isGeminiModelId(modelId) {
  return GEMINI_MODEL_RE.test(str(modelId))
}

export function toGeminiNativeSignature(signature) {
  const raw = str(signature).trim()
  if (!raw || raw === GEMINI_THOUGHT_SIGNATURE_SENTINEL) {
    return GEMINI_THOUGHT_SIGNATURE_SENTINEL_BASE64
  }
  if (raw === GEMINI_ALT_THOUGHT_SIGNATURE_SENTINEL) {
    return ALT_SENTINEL_BASE64
  }
  if (raw.length % 4 === 0 && BASE64_SIGNATURE_RE.test(raw)) {
    return raw
  }
  return Buffer.from(raw, 'utf8').toString('base64')
}

export function toOpenAICompatSignature(signature) {
  const raw = str(signature).trim()
  if (!raw || raw === GEMINI_THOUGHT_SIGNATURE_SENTINEL_BASE64) {
    return GEMINI_THOUGHT_SIGNATURE_SENTINEL
  }
  if (raw === ALT_SENTINEL_BASE64) {
    return GEMINI_ALT_THOUGHT_SIGNATURE_SENTINEL
  }
  return raw
}

export function rememberCapturedThoughtSignature(callId, signature) {
  const id = str(callId).trim()
  const sig = str(signature).trim()
  if (!id || !sig) return
  if (capturedSignatures.has(id)) capturedSignatures.delete(id)
  capturedSignatures.set(id, sig)
  while (capturedSignatures.size > MAX_CAPTURED_SIGNATURES) {
    const oldest = capturedSignatures.keys().next().value
    if (oldest === undefined) break
    capturedSignatures.delete(oldest)
  }
}

export function getCapturedThoughtSignature(callId) {
  const id = str(callId).trim()
  return id ? capturedSignatures.get(id) : undefined
}

function getHeaderValue(headers, targetName) {
  if (!headers) return ''
  const lower = targetName.toLowerCase()
  if (typeof headers.get === 'function') {
    return str(headers.get(targetName) || headers.get(lower))
  }
  if (Array.isArray(headers)) {
    const pair = headers.find(entry => Array.isArray(entry) && str(entry[0]).toLowerCase() === lower)
    return pair ? str(pair[1]) : ''
  }
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lower) return str(value)
    }
  }
  return ''
}

function setHeaderValue(headers, targetName, nextValue) {
  if (!headers) return headers
  const lower = targetName.toLowerCase()
  if (typeof headers.set === 'function') {
    const cloned = new Headers(headers)
    if (nextValue === null || nextValue === '') cloned.delete(targetName)
    else cloned.set(targetName, nextValue)
    return cloned
  }
  if (Array.isArray(headers)) {
    const filtered = headers.filter(entry => !(Array.isArray(entry) && str(entry[0]).toLowerCase() === lower))
    if (nextValue !== null && nextValue !== '') filtered.push([targetName, nextValue])
    return filtered
  }
  if (typeof headers === 'object') {
    const copy = {}
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== lower) copy[key] = value
    }
    if (nextValue !== null && nextValue !== '') copy[targetName] = nextValue
    return copy
  }
  return headers
}

function stripAnthropicInterleavedThinkingHeader(headers) {
  const beta = getHeaderValue(headers, 'anthropic-beta')
  if (!beta || !/interleaved-thinking/i.test(beta)) return { headers, stripped: false }
  const parts = beta
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '' && !/^interleaved-thinking/i.test(item))
  return {
    headers: setHeaderValue(headers, 'anthropic-beta', parts.join(',')),
    stripped: true
  }
}

export function detectWireProtocol(body, url = '', headers = undefined) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const urlText = str(url)
  if (Array.isArray(body.contents)) return 'gemini-native'
  if (Array.isArray(body.input) && /\/responses(?:\?|$)/i.test(urlText)) return 'openai-responses'
  if (!Array.isArray(body.messages)) return null
  if (
    getHeaderValue(headers, 'anthropic-version') !== '' ||
    /\/v\d+\/messages(?:\?|$)/i.test(urlText) ||
    (Array.isArray(body.tools) && body.tools.some(tool => tool && typeof tool === 'object' && 'input_schema' in tool && !('function' in tool)))
  ) {
    return 'anthropic-messages'
  }
  return 'openai-completions'
}

function applyToolSchemaOverride(parameters, schemaSpec, includePropertyOrdering) {
  if (!parameters || typeof parameters !== 'object' || !schemaSpec) return parameters
  const orderedProps = {}
  const order = Array.isArray(schemaSpec.order) ? schemaSpec.order : Object.keys(schemaSpec.properties || {})
  for (const key of order) {
    if (schemaSpec.properties && Object.hasOwn(schemaSpec.properties, key)) {
      orderedProps[key] = schemaSpec.properties[key]
    }
  }
  for (const [key, value] of Object.entries(schemaSpec.properties || {})) {
    if (!Object.hasOwn(orderedProps, key)) orderedProps[key] = value
  }
  const next = {
    ...parameters,
    type: 'object',
    properties: orderedProps,
    required: Array.isArray(schemaSpec.required) ? [...schemaSpec.required] : []
  }
  if (includePropertyOrdering && order.length > 0) {
    next.propertyOrdering = [...order]
  } else {
    delete next.propertyOrdering
  }
  return next
}

export function createCapabilityQuirkStore() {
  const store = new Map()
  function keyOf(provider, model) {
    return `${str(provider).trim().toLowerCase()}::${str(model).trim().toLowerCase()}`
  }
  return Object.freeze({
    get(provider, model) {
      return store.get(keyOf(provider, model)) || {}
    },
    mark(provider, model, patch) {
      const key = keyOf(provider, model)
      const prev = store.get(key) || {}
      const next = { ...prev, ...patch }
      store.set(key, next)
      return next
    },
    clear() {
      store.clear()
    }
  })
}

export const defaultCapabilityQuirks = createCapabilityQuirkStore()

/**
 * Transform a parsed outbound LLM request JSON object according to a Tavern tool protocol directive.
 */
export function enhanceToolProtocolPayload(body, { url = '', headers = undefined, directive = null, quirks = defaultCapabilityQuirks } = {}) {
  if (!directive || !body || typeof body !== 'object') {
    return { body, headers, changed: false, applied: {} }
  }
  const protocol = detectWireProtocol(body, url, headers)
  if (!protocol) return { body, headers, changed: false, applied: {} }

  const modelId = str(body.model || directive.model)
  const providerId = str(directive.provider)
  const quirk = quirks ? quirks.get(providerId, modelId) : {}
  const forceWanted = directive.forceToolChoice === true && !isAutoToolOnlyModel(modelId) && !quirk.noForcedToolChoice
  const allowed = Array.isArray(directive.allowedToolNames)
    ? directive.allowedToolNames.map(name => str(name).trim()).filter(Boolean)
    : []
  const signaturesByCallId = directive.signaturesByCallId && typeof directive.signaturesByCallId === 'object'
    ? directive.signaturesByCallId
    : {}

  let nextBody = structuredClone(body)
  let nextHeaders = headers
  let changed = false
  const applied = { protocol }

  // Determine whether Anthropic forced tool_choice strips native thinking and thus needs tool-level think slot.
  let anthropicThinkingStripped = false
  if (protocol === 'anthropic-messages' && forceWanted) {
    if (nextBody.thinking && nextBody.thinking.type !== 'disabled') {
      delete nextBody.thinking
      anthropicThinkingStripped = true
      changed = true
      applied.strippedAnthropicThinking = true
    }
    const strippedHeader = stripAnthropicInterleavedThinkingHeader(nextHeaders)
    if (strippedHeader.stripped) {
      nextHeaders = strippedHeader.headers
      changed = true
      applied.strippedAnthropicThinkingHeader = true
    }
  }

  // Resolve per-tool schema overrides (e.g. promoting or omitting `think` on `submit_story`).
  const resolveSchemaSpec = typeof directive.resolveToolSchema === 'function'
    ? name => directive.resolveToolSchema(name, { protocol, modelId, providerId, anthropicThinkingStripped, forceToolChoice: forceWanted })
    : name => directive.toolSchemas?.[name] || null

  if (protocol === 'gemini-native') {
    if (Array.isArray(nextBody.tools)) {
      for (const group of nextBody.tools) {
        if (!Array.isArray(group?.functionDeclarations)) continue
        for (const decl of group.functionDeclarations) {
          const spec = resolveSchemaSpec(decl?.name)
          if (!spec) continue
          if (decl.parametersJsonSchema) {
            decl.parametersJsonSchema = applyToolSchemaOverride(decl.parametersJsonSchema, spec, true)
            changed = true
          } else if (decl.parameters) {
            decl.parameters = applyToolSchemaOverride(decl.parameters, spec, true)
            changed = true
          }
        }
      }
    }
    if (forceWanted) {
      nextBody.toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          ...(allowed.length > 0 ? { allowedFunctionNames: allowed } : {})
        }
      }
      changed = true
      applied.forcedToolChoice = 'gemini-any'
    }
    if (directive.injectThoughtSignatures !== false && Array.isArray(nextBody.contents)) {
      for (const content of nextBody.contents) {
        if (content?.role !== 'model' || !Array.isArray(content.parts)) continue
        const fnParts = content.parts.filter(part => part && typeof part === 'object' && part.functionCall)
        if (fnParts.length === 0) continue
        const anySigned = fnParts.some(part => typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0)
        if (!anySigned) {
          const first = fnParts[0]
          const callId = str(first.functionCall?.id)
          const mapped = (callId && signaturesByCallId[callId]) || getCapturedThoughtSignature(callId)
          first.thoughtSignature = toGeminiNativeSignature(mapped)
          changed = true
          applied.injectedThoughtSignature = true
        }
      }
    }
    return { body: changed ? nextBody : body, headers: nextHeaders, changed, applied }
  }

  if (protocol === 'anthropic-messages') {
    if (Array.isArray(nextBody.tools)) {
      for (const tool of nextBody.tools) {
        const spec = resolveSchemaSpec(tool?.name)
        if (!spec || !tool.input_schema) continue
        tool.input_schema = applyToolSchemaOverride(tool.input_schema, spec, false)
        changed = true
      }
    }
    if (forceWanted && Array.isArray(nextBody.tools) && nextBody.tools.length > 0) {
      nextBody.tool_choice = allowed.length === 1
        ? { type: 'tool', name: allowed[0] }
        : { type: 'any' }
      changed = true
      applied.forcedToolChoice = allowed.length === 1 ? 'anthropic-tool' : 'anthropic-any'
    }
    return { body: changed ? nextBody : body, headers: nextHeaders, changed, applied }
  }

  if (protocol === 'openai-responses') {
    if (Array.isArray(nextBody.tools)) {
      for (const tool of nextBody.tools) {
        const name = tool?.name || tool?.function?.name
        const spec = resolveSchemaSpec(name)
        if (!spec) continue
        if (tool.parameters) {
          tool.parameters = applyToolSchemaOverride(tool.parameters, spec, false)
          changed = true
        }
      }
    }
    if (forceWanted && Array.isArray(nextBody.tools) && nextBody.tools.length > 0) {
      nextBody.tool_choice = allowed.length === 1 && !quirk.noNamedToolChoice
        ? { type: 'function', name: allowed[0] }
        : 'required'
      changed = true
      applied.forcedToolChoice = typeof nextBody.tool_choice === 'object' ? 'responses-named' : 'responses-required'
    }
    return { body: changed ? nextBody : body, headers: nextHeaders, changed, applied }
  }

  // protocol === 'openai-completions'
  const geminiTarget = isGeminiModelId(modelId)
  if (Array.isArray(nextBody.tools)) {
    for (const tool of nextBody.tools) {
      const fn = tool?.function
      if (!fn || typeof fn !== 'object') continue
      const spec = resolveSchemaSpec(fn.name)
      if (!spec || !fn.parameters) continue
      const allowOrdering = geminiTarget && fn.strict !== true
      fn.parameters = applyToolSchemaOverride(fn.parameters, spec, allowOrdering)
      changed = true
    }
  }

  if (forceWanted && Array.isArray(nextBody.tools) && nextBody.tools.length > 0) {
    if (allowed.length === 1 && !quirk.noNamedToolChoice) {
      nextBody.tool_choice = { type: 'function', function: { name: allowed[0] } }
      applied.forcedToolChoice = 'openai-named'
    } else {
      nextBody.tool_choice = 'required'
      applied.forcedToolChoice = 'openai-required'
    }
    changed = true
  }

  if (directive.injectThoughtSignatures !== false && geminiTarget && !quirk.noExtraContent && Array.isArray(nextBody.messages)) {
    for (const msg of nextBody.messages) {
      if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) continue
      const anySigned = msg.tool_calls.some(tc => {
        const google = tc?.extra_content?.google
        return Boolean(google && (google.thought_signature || google.thoughtSignature))
      })
      if (!anySigned) {
        const first = msg.tool_calls[0]
        const callId = str(first?.id)
        const mapped = (callId && signaturesByCallId[callId]) || getCapturedThoughtSignature(callId)
        const sig = toOpenAICompatSignature(mapped)
        first.extra_content = {
          ...(first.extra_content && typeof first.extra_content === 'object' ? first.extra_content : {}),
          google: {
            ...(first.extra_content?.google && typeof first.extra_content.google === 'object' ? first.extra_content.google : {}),
            thought_signature: sig
          }
        }
        changed = true
        applied.injectedExtraContent = true
      }
    }
  }

  return { body: changed ? nextBody : body, headers: nextHeaders, changed, applied }
}

function classifyHttp400Downgrade(errorText, applied) {
  const text = str(errorText)
  if (applied.injectedExtraContent && /extra_content|thought_signature|thoughtSignature|extra inputs|unknown field|unrecognized field/i.test(text)) {
    return { noExtraContent: true }
  }
  if (
    (applied.forcedToolChoice === 'openai-named' || applied.forcedToolChoice === 'responses-named') &&
    /tool_choice|function|named|not supported|invalid_request|invalid_value/i.test(text)
  ) {
    return { noNamedToolChoice: true }
  }
  if (
    applied.forcedToolChoice &&
    /tool_choice|toolConfig|functionCallingConfig|function_calling_config|allowedFunctionNames|allowed_function_names|thinking|auto/i.test(text)
  ) {
    return { noForcedToolChoice: true }
  }
  return null
}

function inspectOpenAISseStreamForSignatures(response) {
  const contentType = getHeaderValue(response?.headers, 'content-type')
  if (!/text\/event-stream/i.test(contentType) || !response?.body || typeof response.body.tee !== 'function') {
    return response
  }
  let consumerStream
  let tapStream
  try {
    ;[consumerStream, tapStream] = response.body.tee()
  } catch {
    return response
  }

  ;(async () => {
    const reader = tapStream.getReader()
    const decoder = new TextDecoder()
    const idsByIndex = new Map()
    let pending = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        let newlineIndex
        while ((newlineIndex = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newlineIndex).trim()
          pending = pending.slice(newlineIndex + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            const toolCalls = parsed?.choices?.[0]?.delta?.tool_calls
            if (!Array.isArray(toolCalls)) continue
            for (const tc of toolCalls) {
              const idx = Number.isInteger(tc?.index) ? tc.index : 0
              if (typeof tc?.id === 'string' && tc.id !== '') idsByIndex.set(idx, tc.id)
              const sig = tc?.extra_content?.google?.thought_signature || tc?.extra_content?.google?.thoughtSignature
              const callId = (typeof tc?.id === 'string' && tc.id) || idsByIndex.get(idx)
              if (callId && typeof sig === 'string' && sig !== '') {
                rememberCapturedThoughtSignature(callId, sig)
              }
            }
          } catch {}
        }
      }
    } catch {} finally {
      try { reader.releaseLock() } catch {}
    }
  })()

  return new Response(consumerStream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

export function runWithToolProtocolDirective(directive, fn) {
  if (!directive) return fn()
  return directiveStorage.run(directive, fn)
}

export function currentToolProtocolDirective() {
  return directiveStorage.getStore() || null
}

/**
 * Install a ref-counted AsyncLocalStorage-scoped global fetch wrapper.
 * Requests outside `runWithToolProtocolDirective` pass straight through untouched.
 */
export function installToolProtocolFetchPatch(target = globalThis, { quirks = defaultCapabilityQuirks } = {}) {
  if (!target || typeof target.fetch !== 'function') return () => {}
  let patch = fetchPatches.get(target)
  if (!patch) {
    const original = target.fetch
    const replacement = async function patchedToolProtocolFetch(input, init) {
      const directive = directiveStorage.getStore()
      if (!directive || !init || typeof init.body !== 'string') {
        return original.call(this, input, init)
      }
      const method = str(init.method || (input && typeof input === 'object' ? input.method : 'GET')).toUpperCase()
      if (method !== 'POST') return original.call(this, input, init)

      let parsedBody
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        return original.call(this, input, init)
      }

      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : str(input?.url)
      let currentAttempt = enhanceToolProtocolPayload(parsedBody, {
        url,
        headers: init.headers,
        directive,
        quirks: patch.quirks
      })

      if (!currentAttempt.changed) {
        const res = await original.call(this, input, init)
        return isGeminiModelId(parsedBody?.model || directive.model) ? inspectOpenAISseStreamForSignatures(res) : res
      }

      const modelId = str(parsedBody?.model || directive.model)
      const providerId = str(directive.provider)

      for (let attempt = 0; attempt < 3; attempt++) {
        const nextInit = {
          ...init,
          headers: currentAttempt.headers,
          body: JSON.stringify(currentAttempt.body)
        }
        const response = await original.call(this, input, nextInit)
        if (response.status !== 400 || !currentAttempt.changed || attempt === 2) {
          return isGeminiModelId(modelId) && currentAttempt.applied.protocol === 'openai-completions'
            ? inspectOpenAISseStreamForSignatures(response)
            : response
        }
        let errorText = ''
        try {
          errorText = await response.text()
        } catch {
          return response
        }
        const downgrade = classifyHttp400Downgrade(errorText, currentAttempt.applied)
        if (!downgrade) {
          return new Response(errorText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          })
        }
        patch.quirks.mark(providerId, modelId, downgrade)
        currentAttempt = enhanceToolProtocolPayload(parsedBody, {
          url,
          headers: init.headers,
          directive,
          quirks: patch.quirks
        })
      }
      return original.call(this, input, init)
    }
    patch = { original, replacement, quirks, users: 0 }
    target.fetch = replacement
    fetchPatches.set(target, patch)
  }
  patch.users++
  let active = true
  return () => {
    if (!active) return
    active = false
    if (--patch.users) return
    if (target.fetch === patch.replacement) target.fetch = patch.original
    fetchPatches.delete(target)
  }
}
