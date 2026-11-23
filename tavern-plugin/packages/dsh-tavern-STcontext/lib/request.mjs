const object = value => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys, label) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(label + ' 包含不支持的字段');
};
const identifier = value => typeof value === 'string' && /^[\w.-]{1,256}$/.test(value);

// Resolve equivalent ST/Gemini controls without silently weakening either one.
export function toolPolicy(request) {
  const names = (request.tools || []).map(t => t.name), choice = request.toolChoice;
  let mode = 'AUTO', allowed;
  if (choice !== undefined) {
    if (['auto', 'none', 'required'].includes(choice)) mode = { auto: 'AUTO', none: 'NONE', required: 'ANY' }[choice];
    else {
      only(choice, ['type', 'function'], 'tool_choice');
      only(choice.function, ['name'], 'tool_choice.function');
      if (choice.type !== 'function' || !names.includes(choice.function.name)) throw new Error('强制工具选择必须指向已声明的工具');
      mode = 'ANY'; allowed = [choice.function.name];
    }
  }
  if (request.toolConfig !== undefined) {
    only(request.toolConfig, ['functionCallingConfig'], 'toolConfig');
    const config = request.toolConfig.functionCallingConfig;
    only(config, ['mode', 'allowedFunctionNames'], 'functionCallingConfig');
    if (!['AUTO', 'ANY', 'NONE'].includes(config.mode)) throw new Error('toolConfig.mode 无效');
    const list = config.allowedFunctionNames;
    if (list !== undefined && (!Array.isArray(list) || !list.length || new Set(list).size !== list.length
      || list.some(name => !names.includes(name)) || config.mode !== 'ANY')) throw new Error('allowedFunctionNames 必须是 ANY 模式下已声明的工具名称');
    if (choice !== undefined && (mode !== config.mode || (allowed && (list ? list.length !== 1 || list[0] !== allowed[0] : names.length !== 1)))) throw new Error('tool_choice 与 toolConfig 冲突');
    mode = config.mode; allowed = list || allowed;
  }
  if (mode === 'ANY' && !names.length) throw new Error('强制工具选择需要已声明的工具');
  return { mode, names: allowed || names };
}

export function toolSignature(message, call, index = 0) {
  const values = [call?.signature, call?.extra_content?.google?.thoughtSignature,
    ...(index === 0 ? [message.thoughtSignature] : [])].filter(v => v !== undefined);
  if (values.some(v => typeof v !== 'string' || !v.length || Buffer.byteLength(v) > 65536)) throw new Error('工具签名必须是非空字符串且不超过 64 KiB');
  if (new Set(values).size > 1) throw new Error('同一个工具调用的签名字段冲突');
  return values[0];
}

export function normalizeStopSequences(value) {
  if (value == null) return undefined;
  const entries = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) throw new Error('stop 停止串必须是字符串或字符串数组');
  // Spaces and newlines are meaningful stop sequences.
  const stop = [...new Set(entries.filter(entry => entry.length > 0))];
  return stop.length ? stop : undefined;
}

export function needsProtocolTransport(request) {
  // The official DSH DeepSeek adapters forward GenerateOptions.stop. Its pi-ai
  // adapter rejects that option and needs a provider-protocol body instead.
  if (request.stop?.length && !['deepseek-official', 'deepseek-account'].includes(request.model?.provider)) return true;
  return request.toolConfig !== undefined || (request.toolChoice !== undefined && request.toolChoice !== 'auto' && !(request.toolChoice === 'none' && !request.tools?.length))
    || request.messages.some(m => m.thoughtSignature !== undefined || m.tool_calls?.some(c => c.signature !== undefined || c.extra_content !== undefined));
}

export function validateRequestProtocol(request) {
  if (!object(request)) throw new Error('独立生成需要请求对象');
  const allowed = new Set(['messages', 'tools', 'toolChoice', 'toolConfig', 'temperature', 'maxTokens', 'model', 'contextLimit', 'stop']);
  for (const key of Object.keys(request)) if (!allowed.has(key)) throw new Error('独立生成不支持请求字段：' + key);
  normalizeStopSequences(request.stop);
  if (!Array.isArray(request.messages) || !request.messages.length || request.messages.length > 20000) throw new Error('独立生成需要完整 messages，且不超过 20000 条');
  const tools = request.tools ?? [], names = new Set();
  if (!Array.isArray(tools) || tools.length > 16) throw new Error('独立生成最多支持 16 个输出工具');
  for (const tool of tools) {
    if (!object(tool) || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(tool.name) || names.has(tool.name)
      || typeof tool.description !== 'string' || !object(tool.parameters) || tool.parameters.type !== 'object'
      || Object.keys(tool).some(key => !['name', 'description', 'parameters'].includes(key))) throw new Error('独立生成工具定义无效');
    names.add(tool.name);
  }
  const pending = new Map(), seen = new Set();
  for (const message of request.messages) {
    if (!object(message) || !['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('请求消息角色无效');
    only(message, message.role === 'tool' ? ['role', 'content', 'tool_call_id', 'name']
      : message.role === 'assistant' ? ['role', 'content', 'tool_calls', 'thoughtSignature'] : ['role', 'content'], '请求消息');
    const calls = message.tool_calls;
    if (typeof message.content !== 'string' && !(message.role === 'assistant' && calls?.length && message.content == null)) throw new Error('消息正文必须为文本；只有工具调用消息可以省略正文');
    if (message.role === 'tool') {
      const name = pending.get(message.tool_call_id);
      if (!name || (message.name !== undefined && message.name !== name)) throw new Error('工具结果缺少匹配的调用，或名称冲突');
      pending.delete(message.tool_call_id);
      continue;
    }
    if (pending.size) throw new Error('工具历史必须先补齐全部工具结果');
    if (calls !== undefined) {
      if (!Array.isArray(calls) || !calls.length || calls.length > 128) throw new Error('tool_calls 必须是非空工具调用数组，且不超过 128 项');
      for (const [index, call] of calls.entries()) {
        only(call, ['id', 'type', 'function', 'signature', 'extra_content'], 'tool_calls');
        only(call.function, ['name', 'arguments'], 'tool_calls.function');
        if (call.type !== 'function' || !identifier(call.id) || seen.has(call.id) || !names.has(call.function.name)) throw new Error('工具调用 ID 重复/无效，或工具未声明');
        let args;
        try { args = JSON.parse(call.function.arguments); } catch { throw new Error('工具历史参数必须是完整 JSON 对象'); }
        if (typeof call.function.arguments !== 'string' || !object(args)) throw new Error('工具历史参数必须是完整 JSON 对象');
        if (call.extra_content !== undefined) {
          only(call.extra_content, ['google'], 'extra_content');
          only(call.extra_content.google, ['thoughtSignature'], 'extra_content.google');
          if (call.extra_content.google.thoughtSignature === undefined) throw new Error('extra_content 缺少签名');
        }
        toolSignature(message, call, index);
        pending.set(call.id, call.function.name); seen.add(call.id);
      }
    } else if (message.thoughtSignature !== undefined) toolSignature(message);
  }
  if (pending.size) throw new Error('工具历史末尾缺少工具结果');
  toolPolicy(request);
  if (Buffer.byteLength(JSON.stringify(request)) > 8 * 1024 * 1024) throw new Error('最终请求超过 8 MiB');
  return names;
}

// Conservative guard: script transformations must leave every captured material
// verbatim in model-facing message text or tool descriptions, including repeats.
// Never "repair" a failed guard by silently appending or regenerating history.
export function assertMaterialsPreserved(messages, request) {
  const required = [];
  for (const message of messages) if (message.source !== 'preset') {
    const text = message.rawContent ?? message.content;
    if (text) required.push(text);
  }
  const texts = [...request.messages.map(m => m.content), ...(request.tools || []).map(t => t.description)].filter(t => typeof t === 'string');
  // Ordinary messages and ChatSquash preserve material order. Check those in
  // one forward pass, reserving each occurrence instead of counting substrings.
  let field = 0, offset = 0;
  const ordered = required.every(text => {
    while (field < texts.length) {
      const start = texts[field].indexOf(text, offset);
      if (start >= 0) { offset = start + text.length; return true; }
      field++; offset = 0;
    }
    return false;
  });
  if (ordered) return;

  const counts = new Map();
  for (const text of required) counts.set(text, (counts.get(text) || 0) + 1);
  // Exact fields are safe to reserve: any shorter materials assigned inside one
  // can instead occupy the identical occurrence freed elsewhere by this choice.
  const fields = texts.filter(text => {
    const count = counts.get(text) || 0;
    if (!count) return true;
    counts.set(text, count - 1); return false;
  });
  const remaining = [...counts].sort(([a], [b]) => b.length - a.length)
    .flatMap(([text, count]) => Array(count).fill(text));
  if (!remaining.length) return;

  // Reordered/overlapping materials need disjoint interval assignment. Search
  // lazily so short text cannot allocate millions of candidate positions. Bound
  // backtracking explicitly; failure to prove preservation never sends a body.
  const occupied = fields.map(() => []), frames = [{ field: 0, offset: 0 }];
  let searches = 0, depth = 0;
  const maxSearches = Math.min(200000, Math.max(10000, remaining.length * 32));
  while (depth >= 0) {
    const frame = frames[depth], text = remaining[depth];
    if (frame.choice) {
      const intervals = occupied[frame.choice.field];
      intervals.splice(intervals.indexOf(frame.choice), 1); frame.choice = null;
    }
    while (frame.field < fields.length) {
      if (++searches > maxSearches) throw new Error('材料排列过于复杂，无法在校验预算内确认完整历史保护；请简化预设请求改写');
      const start = fields[frame.field].indexOf(text, frame.offset), end = start + text.length;
      if (start < 0) { frame.field++; frame.offset = 0; continue; }
      const intervals = occupied[frame.field];
      let low = 0, high = intervals.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (intervals[middle].end <= start) low = middle + 1;
        else high = middle;
      }
      if (intervals[low]?.start < end) { frame.offset = intervals[low].end; continue; }
      const choice = { field: frame.field, start, end };
      intervals.splice(low, 0, choice); frame.choice = choice; frame.offset = start + 1;
      break;
    }
    if (!frame.choice) { frames.pop(); depth--; continue; }
    if (++depth === remaining.length) return;
    // Equal materials are interchangeable; only visit their occurrences in
    // ascending order instead of exploring every permutation of duplicates.
    frames[depth] = remaining[depth] === text
      ? { field: frame.choice.field, offset: frame.choice.end } : { field: 0, offset: 0 };
  }
  throw new Error('SPreset 改写删减或修改了冻结材料，未发送请求（完整历史保护）');
}
