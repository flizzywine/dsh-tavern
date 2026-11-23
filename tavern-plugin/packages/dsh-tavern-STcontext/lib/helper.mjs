import { createHash, randomBytes } from 'node:crypto';
import { parse } from './vendor/parser.mjs';
import { MAX_SCRIPT_BYTES } from './script-syntax.mjs';
import { executeScript } from './sandbox.mjs';
import { helperGuest } from './helper-guest.mjs';
import { installHelperBrowser } from './helper-browser.mjs';
import { analyzePanel } from './helper-panel.mjs';
import { createHelperTools } from './helper-tools.mjs';
import { isReverieLoader } from './reverie.mjs';

// Compose only our own source. Every dependency is instantiated inside QuickJS.
const guestSource = 'input => (' + helperGuest + ')(input, ' + installHelperBrowser + ', ' + createHelperTools + ')';

const hash = value => createHash('sha256').update(value).digest('hex');
export const MAX_ORDINARY_HELPER_BYTES = 512 * 1024;
export const MAX_BUNDLED_HELPER_BYTES = 4 * 1024 * 1024;
const BUNDLED_HOOK_RE = /\b(?:CHAT_COMPLETION_PROMPT_READY|CHAT_COMPLETION_SETTINGS_READY|MESSAGE_RECEIVED|chat_completion_prompt_ready|chat_completion_settings_ready|message_received|registerFunctionTool|ToolManager)\b/;
const BUNDLED_UI_RE = /\b(?:createElement|querySelector|MutationObserver|localStorage|addEventListener)\b/;

function parseHelper(source, bytes, sourceType = 'script') {
  let remaining = 160000;
  return parse(source, { ecmaVersion: 2024, sourceType,
    ...(bytes > MAX_SCRIPT_BYTES && { onToken() { if (--remaining < 0) throw Error('大型脚本超过静态解析预算'); } }) });
}

function prepareHelper(source, bytes) {
  try { return { tree: parseHelper(source, bytes) }; }
  catch (error) {
    if (!(error instanceof SyntaxError) || !source.includes('export')) throw error;
  }
  const tree = parseHelper(source, bytes, 'module');
  // A script's own named exports need no module resolver. Keep top-level
  // bindings private and strict, as they were in its browser module.
  if (!tree.body.some(node => node.type === 'ExportNamedDeclaration')) throw Error('助手模块仅支持本地命名导出');
  const parts = [], statements = [], pending = [...tree.body];
  let cursor = 0;
  for (const node of tree.body) {
    if (node.type === 'ExportNamedDeclaration' && !node.source) {
      parts.push(source.slice(cursor, node.start));
      if (node.declaration) {
        cursor = node.start + 'export'.length;
        statements.push(node.declaration);
      } else {
        parts.push(';');
        cursor = node.end;
      }
    } else {
      if (node.type.startsWith('Export') || node.type === 'ImportDeclaration') throw Error('助手模块仅支持本地命名导出');
      statements.push(node);
    }
  }
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'ImportExpression' || (node.type === 'MetaProperty' && node.meta.name === 'import')) {
      throw Error('助手模块不能导入外部依赖或访问 import.meta');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child?.type) pending.push(child); }
      else if (value?.type) pending.push(value);
    }
  }
  parts.push(source.slice(cursor));
  return { tree: { ...tree, body: statements }, content: '(async function () {\n"use strict";\n' + parts.join('') + '\n})()' };
}

function mountsUiWithAfterData(tree) {
  const prop = node => node?.type === 'MemberExpression' && !node.computed ? node.property.name : null;
  const pending = [tree];
  let ui = false, afterData = false;
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'CallExpression' && ['createElement', 'createElementNS', 'querySelector'].includes(prop(node.callee))) ui = true;
    if (node.type === 'CallExpression' && ['on', 'once', 'makeFirst', 'makeLast'].includes(prop(node.callee))) {
      const receiver = node.callee.object, event = node.arguments[0];
      if (prop(receiver) === 'eventSource' && prop(event) === 'GENERATE_AFTER_DATA' &&
        ['eventTypes', 'event_types'].includes(prop(event.object)) && receiver.object.type === 'Identifier' &&
        event.object.object?.name === receiver.object.name && node.arguments.length === 2) afterData = true;
    }
    if (ui && afterData) return true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child?.type) pending.push(child); }
      else if (value?.type) pending.push(value);
    }
  }
  return false;
}

export function isBundledHelperScript(source = '', tree) {
  const text = String(source || '');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (!bytes || bytes > MAX_BUNDLED_HELPER_BYTES) return false;
  if (BUNDLED_HOOK_RE.test(text)) return bytes > MAX_SCRIPT_BYTES || BUNDLED_UI_RE.test(text);
  if (!text.includes('GENERATE_AFTER_DATA') || !BUNDLED_UI_RE.test(text)) return false;
  try { return mountsUiWithAfterData(tree ?? parseHelper(text, bytes)); } catch { return false; }
}

// Same-origin SillyTavern admin routes a bundled script may reference as string
// literals. Only the virtual generation endpoint exists here; at run time every
// other /api/ route fails with a catchable error (see helperGuest's baseFetch),
// so this static scan reports the same boundary. It is a reference scan, not a
// proof the route is called: a library bundled into the script may only mention it.
const SUPPORTED_BACKEND_ROUTE = '/api/backends/chat-completions/generate';
const BACKEND_ROUTE_RE = /(['"`])(\/api\/[A-Za-z0-9_\-./]*[A-Za-z0-9_\-])/g;
export const MAX_REPORTED_BACKEND_ROUTES = 12;

export function unavailableBackendRoutes(source = '') {
  const routes = new Set();
  for (const match of String(source || '').matchAll(BACKEND_ROUTE_RE)) {
    const route = match[2];
    if (route !== SUPPORTED_BACKEND_ROUTE) routes.add(route);
  }
  return [...routes].sort();
}

// Identifies the SPreset engine bootstrap, not a preset. Its configured engine
// is implemented locally; remote code is never fetched, cached or executed.
const BUILTIN_BOOTSTRAPS = new Set(['8298258224ebc3edaae17072b3bd93004f5cef05c479fa6012603dc049e3c632']);
export function helperScripts(doc) {
  const list = doc.extensions?.tavern_helper?.scripts ?? [];
  if (!Array.isArray(list)) throw new Error('酒馆助手 scripts 必须是数组');
  const result = [];
  function visit(items) {
    for (const item of items) {
      if (item?.enabled === false) continue;
      if (item?.type === 'folder' && Array.isArray(item.scripts)) { visit(item.scripts); continue; }
      if (item?.enabled !== true) continue;
      const content = String(item.content || '');
      const reverie = isReverieLoader(content) ? {
        managedValues: item.data?.managed_values ?? {},
        noiseEnabled: item.data?.noise_padding?.enabled === true,
      } : undefined;
      result.push({ id: String(item.id || 'script-' + result.length), name: String(item.name || item.id || '未命名脚本'), content,
        ...(reverie && { reverie }) });
    }
  }
  visit(list);
  if (result.length > 32) throw new Error('启用的助手脚本超过 32 个');
  return result;
}
export function inspectHelpers(doc) {
  const scripts = helperScripts(doc), diagnostics = [];
  const prepared = new Map();
  const reports = scripts.map((script, index) => {
    const source = script.content, normalized = source.replace(/\r\n/g, '\n').trim(), fingerprint = hash(normalized);
    const reverieLoader = !!script.reverie;
    const builtin = reverieLoader || (BUILTIN_BOOTSTRAPS.has(fingerprint) && !!doc.extensions?.SPreset);
    let bundled = false;
    const add = (severity, message) => diagnostics.push({ severity, stage: 'helper', path: 'extensions.tavern_helper.scripts[' + index + '] (' + script.name + ')', message });
    if (reverieLoader) add('warning', '命定预设助手的正文生成功能由内置适配处理；远程助手面板和后台服务不运行。');
    else if (builtin) add('warning', 'SPreset 引擎加载器由内置接口接管，不下载或执行远程代码。');
    else try {
      const bytes = Buffer.byteLength(source);
      if (!normalized || bytes > MAX_BUNDLED_HELPER_BYTES) throw Error('脚本必须非空且不超过静态分析上限 4 MiB');
      const { tree, content } = prepareHelper(source, bytes);
      if (content !== undefined) prepared.set(script, { ...script, content });
      const panel = analyzePanel(tree, { standalone: scripts.length === 1 });
      if (panel.uiOnly) {
        add('info', panel.reason + '，正文生成时忽略。');
        return { name: script.name, hash: fingerprint, supported: 'ui-only', builtin: false, kind: 'ui-only' };
      }
      bundled = isBundledHelperScript(source, tree);
      if (!bundled && bytes > MAX_ORDINARY_HELPER_BYTES) throw Error('未确认是纯面板（' + panel.reason +
        '），超过普通助手执行上限 ' + MAX_ORDINARY_HELPER_BYTES / 1024 + ' KiB；若仅需界面，可在预设编辑器中停用此助手脚本');
      add('info', '不自动跳过：' + panel.reason + '。');
      if (bundled) {
        add('warning', '打包型助手脚本在受限沙箱环境执行：浏览器 UI 挂载与定时器以惰性内存桩运行，仅生效本次生成事件、ToolManager 输出工具与回复后处理。');
        const routes = unavailableBackendRoutes(source);
        if (routes.length) {
          const shown = routes.slice(0, MAX_REPORTED_BACKEND_ROUTES).join('、');
          const more = routes.length > MAX_REPORTED_BACKEND_ROUTES ? ' 等 ' + routes.length + ' 个' : '';
          add('warning', '脚本引用了酒馆后端接口：' + shown + more + '。这些接口在此环境不可用，调用会得到「本地管理接口未启用」错误，依赖它们的功能（如记忆/世界书编辑、聊天回读）不会生效。此为静态引用扫描，不代表一定会被调用。');
        }
      } else {
        const stack = [tree], unavailable = new Set();
        while (stack.length) {
          const node = stack.pop();
          if (node.type === 'ImportExpression') unavailable.add('import');
          if (node.type === 'Identifier' && ['XMLHttpRequest', 'WebSocket', 'process', 'require', 'generate', 'generateRaw', 'setChatMessages', 'triggerSlash', 'setTimeout', 'setInterval'].includes(node.name)) unavailable.add(node.name);
          for (const value of Object.values(node)) {
            if (Array.isArray(value)) { for (const child of value) if (child?.type) stack.push(child); }
            else if (value?.type) stack.push(value);
          }
        }
        if (unavailable.size) add('warning', '引用未提供的能力：' + [...unavailable].join('、') + '；调用时将失败。');
        add('warning', '脚本在受限助手环境执行；只允许本次事件、临时变量和虚拟生成请求，未实现的 API 会报错。');
      }
    } catch (error) { add('error', '助手脚本语法或大小不受支持：' + error.message); }
    return { name: script.name, hash: fingerprint, supported: builtin ? 'builtin' : 'restricted', builtin,
      ...(bundled ? { bundled: true, kind: 'bundled' } : {}) };
  });
  return { diagnostics, scripts, reports, bundled: reports.some(r => r.bundled),
    executable: scripts.filter((_, i) => reports[i].supported === 'restricted').map(script => prepared.get(script) ?? script) };
}

export function transformHelperRequest(document, wire, options = {}) {
  const inspected = inspectHelpers(document), scripts = inspected.executable;
  if (!scripts.length) {
    if (options.templates) {
      for (const edit of options.templates.patches(wire.messages, wire)) wire.messages[edit.index].content = edit.text;
    }
    return { wire };
  }
  const sourceMap = { openai: 'openai', openrouter: 'openrouter', google: 'makersuite', 'google-vertex': 'vertexai', anthropic: 'claude' };
  const source = Object.hasOwn(sourceMap, options.provider) ? sourceMap[options.provider] : 'custom';
  const rawPreset = inspected.bundled ? buildRawPreset(document, source) : undefined;
  const preset = helperPreset(document, wire);
  const state = { version: 2, seed: randomBytes(4).readUInt32LE() || 1, now: Date.now(), request: wire,
    bundled: inspected.bundled, bootstrapIds: [], source, functionCalling: document.function_calling !== false,
    trigger: options.trigger, userName: options.env?.userName, charName: options.env?.charName,
    inputMessageIndex: options.inputMessageIndex,
    variables: { chat: options.chatVariables || options.env?.local || {}, global: options.env?.global || {} },
    chat: (options.env?.chat || []).map((row, message_id) => ({ message_id, name: row.role === 'user' ? options.env.userName : options.env.charName,
      role: row.role, message: row.text, is_hidden: false, data: {}, extra: {} })),
  };
  const run = phase => executeScript(guestSource, { ...state, scripts, preset, ...(rawPreset ? { rawPreset } : {}), phase },
    { stage: 'TavernHelper', timeout: 1800 });
  if (options.templates) {
    const snapshot = run('templates');
    state.templatePass = { before: JSON.stringify(snapshot.messages), edits: options.templates.patches(wire.messages, snapshot) };
  }
  const result = run('request');
  const expected = JSON.stringify(result.request);
  const { type, chat_completion_source, stream, ...outgoing } = result.request;
  if (type !== (state.trigger || 'normal') || chat_completion_source !== source || stream !== false) {
    throw new Error('助手脚本不能更改已冻结的生成类型、连接或流式模式');
  }
  // Receipt is compiler-owned and never part of the model request or UI preview.
  return {
    wire: outgoing,
    handledTools: result.handledTools || [],
    helperState: { ...state, expected, documentHash: hash(JSON.stringify(document)) },
    notes: result.notes,
    intercepts: result.intercepts,
  };
}

function buildRawPreset(document, source) {
  return {
    prompts: document.prompts,
    prompt_order: document.prompt_order,
    preset_settings_openai: 'active-preset',
    function_calling: document.function_calling !== false,
    squash_system_messages: !!document.squash_system_messages,
    chat_completion_source: source,
  };
}

function stripLargeScripts(items) {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    if (!item || typeof item !== 'object') return item;
    if (item.type === 'folder' && Array.isArray(item.scripts)) return { ...item, scripts: stripLargeScripts(item.scripts) };
    if (typeof item.content === 'string' && isReverieLoader(item.content)) return { ...item, data: {} };
    if (typeof item.content === 'string' && Buffer.byteLength(item.content, 'utf8') > MAX_SCRIPT_BYTES) return { ...item, content: '' };
    return item;
  });
}

// Tavern Helper's public getPreset contract uses ordered {id, enabled} prompts,
// not the raw ST {identifier, prompt_order} file shape. Only frozen settings
// with a known mapping are exposed; unsupported settings are not invented.
function helperPreset(document, wire) {
  const group = document.prompt_order.find(g => Number(g.character_id) === 100001) || document.prompt_order[0];
  const definitions = new Map(document.prompts.map(p => [p.identifier, p]));
  const used = new Set(group.order.map(p => p.identifier));
  const convert = (p, enabled) => ({ id: p.identifier, name: p.name || p.identifier, enabled,
    role: p.role || 'system', ...(p.marker ? {} : { content: p.content || '' }),
    position: Number(p.injection_position) === 1 ? { type: 'in_chat', depth: Number(p.injection_depth) || 0, order: Number(p.injection_order) || 0 } : { type: 'relative' },
  });
  const settings = { max_completion_tokens: wire.max_tokens, ...(wire.temperature !== undefined ? { temperature: wire.temperature } : {}),
    should_stream: false, reply_count: 1, squash_system_messages: !!document.squash_system_messages };
  const aliases = { max_context: 'openai_max_context', reasoning_effort: 'reasoning_effort', request_thoughts: 'show_thoughts', enable_function_calling: 'function_calling',
    frequency_penalty: 'frequency_penalty', presence_penalty: 'presence_penalty', top_p: 'top_p', top_k: 'top_k', top_a: 'top_a', min_p: 'min_p', seed: 'seed', repetition_penalty: 'repetition_penalty' };
  for (const [key, source] of Object.entries(aliases)) if (document[source] !== undefined) settings[key] = document[source];
  const extensions = structuredClone(document.extensions || {});
  if (Array.isArray(extensions.tavern_helper?.scripts)) {
    extensions.tavern_helper.scripts = stripLargeScripts(extensions.tavern_helper.scripts);
  }
  return { settings, prompts: group.order.map(item => convert(definitions.get(item.identifier), item.enabled !== false)),
    prompts_unused: document.prompts.filter(p => !used.has(p.identifier)).map(p => convert(p, false)),
    extensions };
}
export function formatHelperOutput(document, response, state) {
  const inspected = inspectHelpers(document);
  if (!state) {
    if (inspected.executable.length) throw Error('助手输出缺少冻结的编译状态');
    return response;
  }
  if (![1, 2].includes(state.version) || state.documentHash !== hash(JSON.stringify(document))) throw Error('助手预设与冻结状态不一致');
  const toolCalls = (response.toolCalls || []).map(call => ({ id: call.id, type: 'function', function: {
    name: call.name, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
  } }));
  const envelope = { choices: [{ index: 0, message: { role: 'assistant', content: response.text || '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }] };
  const scripts = state.scripts || inspected.executable;
  const preset = state.preset || helperPreset(document, state.request || {});
  const rawPreset = state.rawPreset || (inspected.bundled ? buildRawPreset(document, state.source || 'openai') : undefined);
  const result = executeScript(guestSource, {
    ...state,
    scripts,
    preset,
    ...(rawPreset ? { rawPreset } : {}),
    phase: 'response',
    response: envelope,
  }, { stage: 'TavernHelper 输出', timeout: 1800 });
  const message = result.response?.choices?.[0]?.message;
  if (!message || (message.content != null && typeof message.content !== 'string') || (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))) throw Error('助手输出不是有效的完整消息');
  return { text: message.content || '', toolCalls: (message.tool_calls || []).map(call => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments })) };
}
