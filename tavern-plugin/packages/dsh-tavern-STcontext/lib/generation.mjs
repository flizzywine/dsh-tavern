import { randomUUID } from 'node:crypto'
import { normalizeModelSelection } from './models.mjs'
import { validateRequestProtocol, needsProtocolTransport, normalizeStopSequences, toolPolicy } from './request.mjs'
import { generationError, modelFailure } from './errors.mjs'

const fail = (code, text) => Object.assign(new Error(text), { code })
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const positive = value => Number.isSafeInteger(value) && value > 0

/** Use the plugin's saved route, independent of all session model choices. */
export function selectGenerationModel(value) {
  const model = normalizeModelSelection(value);
  if (!model) throw new Error('请先在 STcontext 面板选择插件正文模型并保存设置');
  return model;
}

/** One-shot generation using DSH controls and, when needed, a plugin protocol transport. */
export function createDshGeneration({ llm, meter, protocolTransport }) {
  return async function runIsolated({ request, reverieSystemPrompt, signal }) {
    signal?.throwIfAborted()
    request = structuredClone(request)
    const names = validateRequestProtocol(request)
    const model = selectGenerationModel(request.model)
    request.model = model
    const stop = normalizeStopSequences(request.stop)
    if (stop) request.stop = stop
    else delete request.stop
    const messages = request.messages.map(message => ({ id: randomUUID(), role: message.role,
      content: [...(typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : []),
        ...(message.tool_calls || []).map(call => ({ type: 'tool-call', id: call.id, name: call.function.name, arguments: call.function.arguments }))],
      ...(message.role === 'tool' ? { toolCallId: message.tool_call_id, source: { kind: 'tool', callId: message.tool_call_id } }
        : { source: message.role === 'assistant' && message.tool_calls?.length ? { kind: 'model', provider: model.provider, model: model.model } : { kind: 'plugin:dsh-tavern-STcontext' } }) }))
    const tools = request.tools ?? []
    if (request.maxTokens !== undefined && !positive(request.maxTokens)) throw new Error('maxTokens 必须是正整数')
    if (request.contextLimit !== undefined && !positive(request.contextLimit)) throw new Error('contextLimit 必须是正整数')
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) throw new Error('temperature 必须在 0 到 2 之间')
    const extended = needsProtocolTransport(request)
    if (extended && !protocolTransport) throw fail('STCONTEXT_PROTOCOL_ROUTE_UNSUPPORTED',
      stop ? '当前正文模型需要停止串兼容发送接口；未发送请求' : '当前环境未提供工具选择/签名兼容发送接口；未降级发送')
    const route = extended ? protocolTransport.capture(model, { stop: !!stop, reverieSystemPrompt }) : undefined
    const config = { ...model }
    if (stop && !extended) config.stop = stop
    if (request.maxTokens !== undefined) config.maxTokens = request.maxTokens
    if (request.temperature !== undefined && model.provider !== 'openai-codex') config.temperature = request.temperature
    const estimateText = text => Math.max(Math.ceil(Buffer.byteLength(text, 'utf8') / 3),
      Number(meter?.estimateMessage?.({ role: 'system', content: [{ type: 'text', text }] })) || 0)
    let estimatedInputTokens
    const checkBudget = (controls, info) => {
      const serialized = route ? route.serialize(request, { ...model, ...controls }) : JSON.stringify({ messages: request.messages, tools, stop })
      estimatedInputTokens = estimateText(serialized) + messages.length * 12 + tools.length * 32
      const modelLimit = info?.context?.contextWindow
      const contextLimit = positive(modelLimit) ? Math.min(modelLimit, request.contextLimit ?? modelLimit) : request.contextLimit
      if (!positive(contextLimit)) throw fail('STCONTEXT_CONTEXT_CAPACITY_UNKNOWN', '无法确定模型上下文容量，请在插件中设置上下文上限')
      if (estimatedInputTokens + controls.maxTokens + Math.max(128, Math.ceil(contextLimit * 0.01)) > contextLimit) {
        throw generationError('CONTEXT_OVERFLOW', `完整上下文估算 ${estimatedInputTokens} 词元，输出预留 ${controls.maxTokens}，超过模型窗口 ${contextLimit}；未截断历史或发送请求`, 'budget')
      }
    }
    let capturedInfo
    // Bind native dispatch to its adapter snapshot. Extended dispatch verifies
    // that its captured public route settings stayed stable through preparation.
    let prepared
    try { prepared = await llm.prepareCall(config, signal, (controls, info) => {
      capturedInfo = info
      const reserve = controls.maxTokens ?? info?.defaultMaxTokens ?? 8192
      if (!positive(reserve)) throw new Error('模型输出预算无效')
      checkBudget({ ...controls, maxTokens: reserve }, info)
      return { ...controls, maxTokens: reserve }
    }) } catch (error) {
      signal?.throwIfAborted()
      if (error?.code?.startsWith?.('STCONTEXT_')) throw error
      const failure = modelFailure(error, { stage: 'request' })
      // Unknown preparation failures may be local model/configuration errors.
      throw failure.code === 'STCONTEXT_PROVIDER_ERROR' ? error : failure
    }
    signal?.throwIfAborted()
    route?.verify()
    if (stop && !route && (prepared.config.stop?.length !== stop.length || stop.some((value, i) => value !== prepared.config.stop[i]))) {
      throw fail('STCONTEXT_PROTOCOL_ROUTE_UNSUPPORTED', '宿主模型接口未保留预设停止串；未发送请求')
    }
    checkBudget(prepared.config, capturedInfo)
    const blocks = new Map()
    let finishReason, usage, received = 0, reasoning = false
    const options = { ...prepared.config, messages, system: '', tools: structuredClone(tools), ...(signal ? { signal } : {}) }
    try {
      const stream = route ? route.stream(request, prepared.config, signal) : prepared.stream(options)
      for await (const chunk of stream) {
        signal?.throwIfAborted()
        const index = chunk.index ?? 0
        if (chunk.type === 'text-delta') {
          const prior = blocks.get(index)
          blocks.set(index, { type: 'text', text: (prior?.text || '') + chunk.text })
          received += Buffer.byteLength(chunk.text || '')
        } else if (chunk.type === 'tool-call-delta') {
          const prior = blocks.get(index)
          blocks.set(index, { type: 'tool-call', id: chunk.id || prior?.id, name: chunk.name || prior?.name,
            arguments: (prior?.arguments || '') + (chunk.argumentsDelta || '') })
          received += Buffer.byteLength(chunk.argumentsDelta || '')
        } else if (chunk.type === 'block-end' && ['text', 'tool-call'].includes(chunk.block?.type)) {
          blocks.set(index, structuredClone(chunk.block))
          received += Buffer.byteLength(JSON.stringify(chunk.block))
        } else if (chunk.type === 'finish') {
          if (!finishReason || ['stop', 'tool-calls'].includes(finishReason.kind)) finishReason = chunk.reason
        }
        else if (chunk.type === 'reasoning-delta' || chunk.type === 'block-end' && chunk.block?.type === 'reasoning') reasoning = true
        else if (chunk.type === 'usage') usage = structuredClone(chunk.usage ?? chunk)
        if (received > 8 * 1024 * 1024) throw generationError('RESPONSE_TOO_LARGE', '模型输出超过大小限制，未采用不完整正文', 'response')
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (error?.code?.startsWith?.('STCONTEXT_')) throw error
      throw modelFailure(error)
    }
    signal?.throwIfAborted()
    if (!finishReason) throw generationError('STREAM_INTERRUPTED', '模型响应未收到结束回执，未采用不完整正文', 'response')
    if (!['stop', 'tool-calls'].includes(finishReason?.kind)) {
      throw modelFailure(finishReason.failure, { finishReason: finishReason.kind, fallback: 'GENERATION_INCOMPLETE' })
    }
    const output = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, block]) => block)
    const text = output.filter(block => block.type === 'text').map(block => block.text).join('')
    if (!text.trim() && !output.some(block => block.type === 'tool-call')) {
      throw generationError(reasoning ? 'REASONING_ONLY' : 'EMPTY_RESPONSE', reasoning
        ? '模型只返回了思考过程，没有返回正文'
        : '模型未返回有效正文或工具结果，服务商未提供具体原因', 'response')
    }
    const toolCalls = output.filter(block => block.type === 'tool-call').map(({ id, name, arguments: args }) => {
      if (!names.has(name)) throw generationError('TOOL_PROTOCOL', '模型返回了未声明的输出工具，未采用正文', 'tool-validation')
      if (typeof args === 'string') { try { if (!object(JSON.parse(args))) throw new Error() } catch { throw generationError('TOOL_PROTOCOL', '模型工具参数不是完整 JSON 对象，未采用不完整正文', 'tool-validation') } }
      else if (!object(args)) throw generationError('TOOL_PROTOCOL', '模型工具参数无效', 'tool-validation')
      return { id, name, arguments: args }
    })
    const policy = toolPolicy(request)
    if (policy.mode === 'ANY' && (!toolCalls.length || toolCalls.some(call => !policy.names.includes(call.name)))) throw generationError('TOOL_PROTOCOL', '模型未遵守强制工具选择，未采用正文', 'tool-validation')
    if (policy.mode === 'NONE' && toolCalls.length) throw generationError('TOOL_PROTOCOL', '模型在禁用工具时返回工具调用，未采用正文', 'tool-validation')
    return { text, toolCalls, finishReason: finishReason.kind, usage, model: structuredClone(model), estimatedInputTokens }
  }
}
