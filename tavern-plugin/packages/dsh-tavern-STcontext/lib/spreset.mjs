import { renderMacros, createMacroEnvironment } from './macros.mjs';
import { parseRegex } from './regex.mjs';
import { inspectScript } from './script-syntax.mjs';
import { transformHelperRequest } from './helper.mjs';
import { outputStage } from './errors.mjs';
import { normalizeStopSequences } from './request.mjs';

const object = v => v && typeof v === 'object' && !Array.isArray(v);
const knownSections = new Set(['ChatSquash', 'ToolBindings', 'MessageInjections', 'OutputPreprocessing', 'FinalRequestProcessing', 'RegexBinding', 'MacroNest', 'FixedPresetName', 'ForcedPostProcessing', 'LogUpload']);
export function activePromptIds(document, trigger) {
  const group = document.prompt_order.find(g => Number(g.character_id) === 100001) || document.prompt_order[0];
  const definitions = new Map(document.prompts.map(p => [p.identifier, p]));
  return group.order.filter(o => {
    const triggers = definitions.get(o.identifier)?.injection_trigger;
    return o.enabled !== false && (!trigger || !Array.isArray(triggers) || !triggers.length || triggers.includes(trigger));
  }).map(o => o.identifier);
}
export function inspectSpreset(document, { trigger } = {}) {
  const config = document.extensions?.SPreset, diagnostics = [], hooks = [];
  const add = (severity, path, message) => diagnostics.push({ severity, stage: 'spreset', path: 'extensions.SPreset.' + path, message });
  if (!config) return { diagnostics, hooks };
  if (!object(config)) { add('error', '', 'SPreset 配置必须是对象'); return { diagnostics, hooks }; }
  for (const key of ['ChatSquash', 'ToolBindings', 'MessageInjections', 'OutputPreprocessing', 'FinalRequestProcessing', 'ForcedPostProcessing', 'LogUpload']) {
    if (config[key] !== undefined && !object(config[key])) add('error', key, '配置必须是对象');
  }
  if (diagnostics.some(item => item.severity === 'error')) return { diagnostics, hooks };
  const script = (path, source, kind = 'function') => {
    const result = inspectScript(source, kind); hooks.push(path);
    if (result.error) add('error', path, '脚本语法不受支持：' + result.error);
    const provided = path === 'FinalRequestProcessing.script' ? ['window', 'parent', 'SillyTavern', 'TavernHelper'] : [];
    const unavailable = result.capabilities.filter(name => !provided.includes(name));
    if (unavailable.length) add('warning', path, '脚本引用受限环境未提供的名称：' + unavailable.join('、') + '；若实际调用将失败。');
    if (path === 'FinalRequestProcessing.script' && result.protocols.length) add('warning', path, '脚本引用请求协议字段：' + result.protocols.join('、') + '。编译后校验实际字段；工具选择及签名还需服务商协议兼容，不会自动删字段或降级。');
  };
  for (const [key, value] of Object.entries(config)) if (!knownSections.has(key)) add(value?.enabled ? 'error' : 'warning', key, '未支持的 SPreset 配置项');
  const squash = config.ChatSquash;
  if (squash?.enabled) {
    for (const key of ['parse_clewd', 'user_role_system', 're_split', 'enable_stop_string']) if (squash[key]) add('error', 'ChatSquash.' + key, '当前不支持此合并选项');
    if (squash.role && !['system', 'user', 'assistant'].includes(squash.role)) add('error', 'ChatSquash.role', '不支持的合并角色');
    if (squash.squashed_post_script_enable) script('ChatSquash.squashed_post_script', squash.squashed_post_script);
    if (squash.enable_squashed_separator && squash.squashed_separator_regex) {
      try { parseRegex(squash.squashed_separator_string); } catch (error) { add('error', 'ChatSquash.squashed_separator_string', error.message); }
    }
  }
  const ids = new Set(activePromptIds(document, trigger));
  for (const [id, binding] of Object.entries(config.ToolBindings || {})) if (binding?.enabled && ids.has(id)) {
    if (config.OutputPreprocessing?.consumeToolCalls !== true) add('error', 'ToolBindings.' + id, '工具只能作为正文输出协议，必须启用 consumeToolCalls；不执行工具 action。');
    if (config.OutputPreprocessing?.toolCallFormatter?.enabled !== true) add('error', 'ToolBindings.' + id, '输出工具需要启用 toolCallFormatter，不能在模型返回后才发现无法解包');
    if (binding.editorMode === 'form' && object(binding.form)) {
      if (!binding.form.name || !Array.isArray(binding.form.parameters)) add('error', 'ToolBindings.' + id, '工具表单缺少名称或参数数组');
    } else script('ToolBindings.' + id + '.code', binding.code, 'body');
  }
  for (const [id, injection] of Object.entries(config.MessageInjections || {})) if (injection?.enabled && ids.has(id)) add('error', 'MessageInjections.' + id, '当前 DSH 适配层不支持预置工具调用、推理签名或工具结果消息');
  if (config.FinalRequestProcessing?.enabled) {
    script('FinalRequestProcessing.script', config.FinalRequestProcessing.script);
    add('warning', 'FinalRequestProcessing', '最终请求在脚本执行后校验工具历史、选择与签名；额外私有字段仍拒绝。');
  }
  if (config.OutputPreprocessing?.enabled) script('OutputPreprocessing.script', config.OutputPreprocessing.script);
  if (config.OutputPreprocessing?.toolCallFormatter?.enabled) script('OutputPreprocessing.toolCallFormatter.script', config.OutputPreprocessing.toolCallFormatter.script);
  if (config.ForcedPostProcessing?.enabled && config.ForcedPostProcessing.mode) add('error', 'ForcedPostProcessing', '不支持强制提供商后处理模式');
  if (config.LogUpload?.enabled) add('warning', 'LogUpload', '日志上传已禁用；受限运行时不提供网络访问。');
  add('warning', '', '最终请求脚本可读取本轮冻结的预设、聊天与变量快照。DOM、文件、外部网络和工具 action 均不执行。');
  return { diagnostics, hooks };
}

function ensureText(value, stage) { if (typeof value !== 'string') throw new Error(stage + ' 必须返回字符串'); return value; }
function makeTool(binding, execute) {
  if (binding.editorMode !== 'form' || !object(binding.form)) return execute(binding.code, null, { kind: 'body', stage: 'ToolBindings' });
  const form = binding.form, properties = {}, required = [];
  for (const parameter of form.parameters) {
    if (!/^[\w-]+$/.test(parameter.name) || Object.hasOwn(properties, parameter.name)) throw new Error('工具参数名称无效或重复');
    Object.defineProperty(properties, parameter.name, { enumerable: true, value: { type: parameter.type || 'string', description: String(parameter.description || '') } });
    if (parameter.required) required.push(parameter.name);
  }
  return { name: form.name, description: form.description || '', parameters: { type: 'object', properties, required } };
}
function squashMessages(messages, config, execute, env, protection) {
  if (!config?.enabled) return messages;
  const tag = config.conditional_tag || '';
  if (config.conditional_enabled && (!tag || !messages.some(m => protection.restoreText(m.content).includes(tag)))) return messages;
  const groups = [];
  for (const message of messages) {
    const history = ['history', 'input'].includes(message.source);
    if (!groups.length || (config.separate_chat_history && groups.at(-1).history !== history)) groups.push({ history, messages: [] });
    groups.at(-1).messages.push(message);
  }
  const format = text => renderMacros(text || '', env, { opaque: protection.tokenFor });
  return groups.flatMap(group => {
    let content = group.messages.map(m => {
      // Only remove control tags from preset text, never from captured materials.
      const text = m.source === 'preset' && tag ? m.content.split(tag).join('') : m.content;
      // Host turn context uses a portable user role, but is not player speech.
      // Keep preset-authored user/assistant messages and fixed markers intact.
      const prefix = m.turnMaterial ? '' : m.role === 'user' ? config.user_prefix : m.role === 'assistant' ? config.char_prefix : '';
      const suffix = m.turnMaterial ? '' : m.role === 'user' ? config.user_suffix : m.role === 'assistant' ? config.char_suffix : '';
      return format(prefix) + text + format(suffix);
    }).join('\n\n');
    content = format(config.prefix_system) + content + format(config.suffix_system);
    if (config.squashed_post_script_enable) content = protection.remapText(content,
      ensureText(execute(config.squashed_post_script, protection.restoreText(content), { stage: 'ChatSquash' }), 'ChatSquash'));
    const separator = config.enable_squashed_separator && config.squashed_separator_string;
    const chunks = separator ? content.split(config.squashed_separator_regex ? parseRegex(separator) : separator) : [content];
    return chunks.filter(text => typeof text === 'string' && text.trim()).map(text => ({ role: config.role || 'system', content: text }));
  });
}

function requestContext(document, env, materials, scriptState) {
  const chat = env.chat.map(row => ({
    name: row.role === 'user' ? env.userName : env.charName, mes: row.text,
    is_user: row.role === 'user', is_system: false, extra: row.extra || {}, swipe_id: 0,
    ...(Array.isArray(row.variables) ? { variables: row.variables } : {}),
  }));
  chat.at(-1).variables = [materials?.beforeState?.messageVariables || {}];
  return {
    userName: env.userName, charName: env.charName, chat, chatId: materials?.gameId || '',
    chatCompletionSettings: { prompts: document.prompts, prompt_order: document.prompt_order,
      function_calling: document.function_calling },
    chatMetadata: scriptState?.chatMetadata || {},
    variables: { chat: { ...materials?.beforeState?.variables, ...env.local }, global: env.global || {},
      preset: document.extensions?.tavern_helper?.variables || {} },
  };
}

export function transformSpresetRequest(document, messages, request, { execute, env, trigger, protection, pendingMacros = [], materials, scriptState, temperatureOverride, templates }) {
  const config = document.extensions?.SPreset || {};
  if (templates?.active && (config.FinalRequestProcessing?.enabled || config.ChatSquash?.enabled)) {
    throw new Error('当前无法确定 SPreset 请求改写与 EJS 模板扩展的加载顺序，未发送请求');
  }
  // Script-facing shape is an OpenAI-style request, never a DSH config or token.
  const squashed = squashMessages(messages, config.ChatSquash, execute, env, protection);
  let wire = { messages: squashed.map(({ role, content }) => ({ role, content })),
    model: request.model?.model || '', temperature: request.temperature, max_tokens: request.maxTokens };
  const tools = [], ids = new Set(activePromptIds(document, trigger));
  for (const [id, binding] of Object.entries(config.ToolBindings || {})) if (binding?.enabled && ids.has(id)) {
    const tool = makeTool(binding, execute);
    if (!object(tool)) throw new Error('ToolBindings 必须返回工具对象');
    // Functions in a tool declaration are never called; only this data crosses.
    tools.push({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } });
  }
  if (tools.length) wire.tools = tools;
  let updatedState;
  if (config.FinalRequestProcessing?.enabled) {
    const result = execute(config.FinalRequestProcessing.script, { request: protection.restore(wire) }, {
      stage: 'FinalRequestProcessing', requestContext: requestContext(document, env, materials, scriptState),
    });
    const raw = result.value;
    if (!object(raw)) throw new Error('FinalRequestProcessing 必须返回请求对象');
    const snapshot = result.scriptState;
    if (!object(snapshot.chatMetadata) || !object(snapshot.currentInputExtra)) throw new Error('最终请求脚本返回的聊天状态格式无效');
    if (scriptState || Object.keys(snapshot.chatMetadata).length || Object.keys(snapshot.currentInputExtra).length) updatedState = snapshot;
    wire = protection.remap(wire, raw);
  }
  if (!object(wire)) throw new Error('FinalRequestProcessing 必须返回请求对象');
  // A squash or final hook may replace/reorder messages, losing the original floor index.
  const inputMessageIndex = squashed === messages && !config.FinalRequestProcessing?.enabled
    ? messages.findIndex(message => message.source === 'input') : -1;
  const helper = transformHelperRequest(document, wire, { env, trigger, provider: request.model?.provider,
    ...(inputMessageIndex >= 0 ? { inputMessageIndex } : {}),
    ...(templates?.active ? { templates, chatVariables: { ...materials?.beforeState?.variables, ...env.local } } : {}) });
  wire = helper.wire;
  // Resolve identities introduced by script templates before restoring opaque
  // host materials. Never run native macros on captured historical text.
  const mapText = text => typeof text === 'string' ? text.replace(/\{\{(user|char)\}\}/gi,
    (_, name) => protection.tokenFor(name.toLowerCase() === 'user' ? env.userName : env.charName)) : text;
  for (const message of wire.messages || []) message.content = mapText(message.content);
  for (const tool of wire.tools || []) if (object(tool.function)) tool.function.description = mapText(tool.function.description);
  const strings = [], stack = [wire];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === 'string') strings.push(value);
    else if (value && typeof value === 'object') stack.push(...Object.values(value));
  }
  for (const token of pendingMacros) {
    if (strings.some(text => text.includes(token))) {
      throw new Error((token.startsWith('<|') ? '助手未处理预设请求标记：' : '请求钩子未解析预设宏：') + token);
    }
  }
  wire = protection.restore(wire);
  const allowed = new Set(['messages', 'tools', 'tool_choice', 'toolConfig', 'model', 'temperature', 'max_tokens', 'stop']);
  for (const key of Object.keys(wire)) if (!allowed.has(key)) throw new Error('请求协议不支持字段：' + key);
  if (wire.model !== (request.model?.model || '')) throw new Error('请求脚本不能更改已冻结的正文模型');
  if (wire.max_tokens !== request.maxTokens) throw new Error('请求脚本不能更改已冻结的输出 token 上限');
  const temperature = temperatureOverride ? request.temperature : wire.temperature;
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) throw new Error('请求脚本的温度必须在 0–2 之间');
  if (wire.tools !== undefined && !Array.isArray(wire.tools)) throw new Error('最终请求 tools 必须是数组');
  const handledTools = new Set(helper.handledTools || []);
  const unhandledTools = (wire.tools || []).filter(tool => !handledTools.has(tool?.function?.name));
  if (unhandledTools.length && !helper.intercepts && (!config.OutputPreprocessing?.consumeToolCalls || !config.OutputPreprocessing?.toolCallFormatter?.enabled)) throw new Error('最终请求中的输出工具必须启用 consumeToolCalls 和 toolCallFormatter，或由助手请求拦截器处理回包');
  const stop = normalizeStopSequences(wire.stop);
  const plan = { ...request, messages: wire.messages, ...(stop ? { stop } : {}), ...(wire.tools ? { tools: wire.tools.map(tool => {
    if (tool.type !== 'function' || !object(tool.function) || Object.keys(tool).some(k => !['type', 'function'].includes(k))) throw new Error('不支持的工具定义协议');
    return tool.function;
  }) } : {}), ...(wire.tool_choice !== undefined ? { toolChoice: wire.tool_choice } : {}),
    ...(wire.toolConfig !== undefined ? { toolConfig: wire.toolConfig } : {}) };
  if (temperature === undefined) delete plan.temperature;
  else plan.temperature = temperature;
  return { plan, helperState: helper.helperState, notes: helper.notes, ...(updatedState ? { scriptState: updatedState } : {}) };
}

export function formatSpresetOutput(document, response, execute, observe = () => {}) {
  const config = document.extensions?.SPreset || {}, calls = response.toolCalls || [];
  let text = response.text || '';
  const formatter = config.OutputPreprocessing?.toolCallFormatter;
  if (calls.length && (!config.OutputPreprocessing?.consumeToolCalls || !formatter?.enabled)) outputStage('tool-formatter', '工具正文格式化', () => { throw new Error('工具输出缺少已启用的消费与格式化处理器'); });
  if (formatter?.enabled) {
    for (const call of calls) {
      // Truncated JSON is never passed to permissive script recovery paths.
      const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      if (!object(args)) throw new Error('工具正文参数必须是完整 JSON 对象');
    }
    text = outputStage('tool-formatter', '工具正文格式化', () => ensureText(execute(formatter.script, { calls, defaultText: text }, { stage: 'toolCallFormatter' }), 'toolCallFormatter'));
    observe('tool-formatter', text);
  }
  if (config.OutputPreprocessing?.enabled) {
    text = outputStage('output-script', '预设输出脚本处理', () => {
      const result = execute(config.OutputPreprocessing.script, { buffer: text, final: true, state: {} }, { stage: 'OutputPreprocessing' });
      if (!object(result) || typeof result.output !== 'string' || (result.hold !== undefined && result.hold !== '')) throw new Error('最终输出处理必须返回 output 文本，且 hold 为空');
      if (result.state?.rejected === true) throw new Error('预设输出处理器拒绝了本次正文');
      return result.output;
    });
    observe('output-script', text);
  }
  return text;
}
