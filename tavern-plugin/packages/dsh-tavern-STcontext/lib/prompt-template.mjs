import { executeScript } from './sandbox.mjs';
import { scriptExpression } from './script-syntax.mjs';

// Template blocks are the only text compiled as JavaScript. Native macro
// results and all host data cross into the guest separately as JSON.
function parseTemplate(source) {
  const statements = [], literals = [], preview = [];
  const emitLiteral = (text, visible = true) => {
    if (!text) return;
    const index = literals.push(text) - 1;
    statements.push('__parts.push(' + index + ');');
    if (visible) preview.push(index);
  };
  const opener = /<%([=#_%\-]?)/g, closer = /([_\-%]?)%>/g;
  let cursor = 0, match;
  while ((match = opener.exec(source))) {
    const mode = match[1];
    const literal = source.slice(cursor, match.index);
    const trimmed = mode === '_' ? literal.replace(/[ \t]+$/, '') : literal;
    emitLiteral(trimmed);
    preview.push(literal.slice(trimmed.length));
    closer.lastIndex = opener.lastIndex;
    const end = closer.exec(source);
    if (!end) throw new Error('EJS 缺少闭合标签 %>');
    const code = source.slice(opener.lastIndex, end.index);
    preview.push(source.slice(match.index, closer.lastIndex));
    if (mode === '%') {
      emitLiteral('<%' + code + '%>', false);
    } else if (mode !== '#') {
      if (code.includes('{{')) throw new Error('EJS 代码块中的原生宏无法安全插值，请使用 userName、charName 或 getvar()');
      if (mode === '=' || mode === '-') {
        const expr = code.trim().replace(/;$/, '');
        statements.push((mode === '=' ? 'print(__escape(' : 'print(') + expr + '\n' + (mode === '=' ? '));' : ');'));
      } else statements.push(code + '\n');
    }
    cursor = closer.lastIndex;
    if (end[1] === '_') cursor += /^[ \t]*/.exec(source.slice(cursor))[0].length;
    if (end[1] === '-' || end[1] === '_') cursor += /^(?:\r\n|\r|\n)?/.exec(source.slice(cursor))[0].length;
    preview.push(source.slice(closer.lastIndex, cursor));
    opener.lastIndex = cursor;
  }
  emitLiteral(source.slice(cursor));
  return { statements, literals, preview };
}

// This function runs inside QuickJS. Only frozen values from the current
// frame and the commonly used read functions from prepareContext are exposed.
function templateLocals(data) {
  const { scopes, ...locals } = data;
  // Variables describe the frozen turn. A script expecting a writable
  // plugin variable store must receive an error instead of losing its edit.
  const protectedValues = new WeakMap();
  const readOnly = value => {
    if (!value || typeof value !== 'object') return value;
    if (!protectedValues.has(value)) {
      const denyWrite = () => { throw new Error('EJS 变量快照只读'); };
      const proxy = new Proxy(value, {
        get: (target, name) => readOnly(Reflect.get(target, name)),
        set: denyWrite, defineProperty: denyWrite, deleteProperty: denyWrite, setPrototypeOf: denyWrite,
      });
      protectedValues.set(value, proxy);
      protectedValues.set(proxy, proxy);
    }
    return protectedValues.get(value);
  };
  const variables = readOnly(Object.assign({}, scopes.global, scopes.local, scopes.message));
  function read(object, key, fallback) {
    if (key == null) return object;
    if (Object.hasOwn(object, key)) return object[key];
    const path = String(key).replace(/\[(\d+)\]/g, '.$1');
    if (path.includes('[') || path.includes(']')) throw new Error('EJS 变量路径支持点路径和数字下标');
    let value = object;
    for (const name of path.split('.')) {
      if (value == null || !Object.hasOwn(value, name)) return fallback;
      value = value[name];
    }
    return value;
  }
  function getvar(key, options = {}) {
    if (typeof options === 'string') options = { scope: options };
    if (!options || typeof options !== 'object' ||
        Object.keys(options).some(k => !['scope', 'defaults', 'index', 'clone'].includes(k))) throw new Error('EJS getvar 选项不受支持');
    const scope = options.scope || 'cache';
    // Upstream's message scope without withMsg reads the combined variable
    // cache, including the current floor's variables on top of the chat.
    const store = scope === 'cache' || scope === 'message' ? variables : scopes[scope];
    if (!['global', 'local', 'cache', 'message'].includes(scope)) throw new Error('当前宿主未提供 EJS 变量作用域 ' + scope);
    if (options.index != null) return read(JSON.parse(read(store, key, '{}') || '{}'), options.index, options.defaults);
    const value = read(store, key, options.defaults);
    return options.clone && value !== undefined ? JSON.parse(JSON.stringify(value)) : readOnly(value);
  }
  const scoped = scope => (key, options = {}) => getvar(key, { ...options, scope });
  return { ...locals, variables, getvar, getLocalVar: scoped('local'), getGlobalVar: scoped('global'), getMessageVar: scoped('message') };
}

function sourceFor(statements) {
  return [
    'async data => {',
    'const __parts = [];',
    'const print = (...args) => { for (const v of args) if (v != null) __parts.push(String(v)); };',
    "const entities = {'&':'&amp;','<':'&lt;','>':'&gt;', '\"':'&#34;', \"'\":'&#39;'};",
    'const __escape = x => x == null ? "" : String(x).replace(/[&<>"\\x27]/g, c => entities[c]);',
    'const locals = (' + templateLocals.toString() + ')(data);',
    'const result = await (async function() { with (locals) {', ...statements, '} }).call(locals);',
    'return result === undefined ? __parts : [String(result)];',
    '}',
  ].join('\n');
}

export function inspectPromptTemplate(source) {
  if (!source?.includes('<%')) return;
  try { scriptExpression(sourceFor(parseTemplate(source).statements)); }
  catch (error) { return error.message; }
}

function evaluate({ statements, text }, { env, materials, trigger, opaque }, variables) {
  const chat = env.chat;
  const lastUserMessageId = chat.findLastIndex(row => row.role === 'user');
  const lastCharMessageId = chat.findLastIndex(row => row.role === 'assistant');
  const data = {
    userName: env.userName, charName: env.charName, assistantName: env.charName, chatId: materials.gameId,
    lastUserMessageId, lastUserMessage: chat[lastUserMessageId]?.text || '',
    lastCharMessageId, lastCharMessage: chat[lastCharMessageId]?.text || '', lastMessageId: chat.length - 1,
    runType: 'generate', generateType: trigger, isDryRun: false,
    scopes: { global: variables?.global ?? env.global, local: variables?.chat ?? { ...materials.beforeState?.variables, ...env.local },
      message: materials.beforeState?.messageVariables || {} },
  };
  const parts = executeScript(sourceFor(statements), data, { stage: 'Prompt Template EJS', template: true });
  if (!Array.isArray(parts)) throw new Error('EJS 输出格式无效');
  // Invalid or deliberately expansive loops must also respect the guest's
  // output bound when repeated literal references expand back to text.
  let bytes = 0;
  return parts.map(part => {
    const value = typeof part === 'string' ? opaque(part) : Number.isInteger(part) ? text[part] : undefined;
    if (typeof value !== 'string') throw new Error('EJS 输出片段无效');
    bytes += Buffer.byteLength(value);
    if (bytes > 8 * 1024 * 1024) throw new Error('EJS 输出超过 8 MiB');
    return value;
  }).join('');
}

// Keep the native-macro pass in prompt order. Only evaluate templates which
// are present at SETTINGS_READY, using the variables available at that point.
export function createPromptTemplates(options) {
  const entries = new Map();
  function prepare(source) {
    if (!source.includes('<%')) return options.renderNative(source);
    const { statements, literals, preview } = parseTemplate(source);
    const text = literals.map(options.renderNative);
    const before = preview.map(part => typeof part === 'number' ? text[part] : part).join('');
    entries.set(before, { before, statements, text, tag: before.indexOf('<%') });
    return before;
  }
  function patches(initial, { messages, origins, variables, settingsListeners } = {}) {
    const edits = [];
    let totalBytes = 0;
    for (const [index, message] of messages.entries()) {
      const content = message?.content;
      if (typeof content !== 'string' || !content.includes('<%')) continue;
      if (settingsListeners) throw new Error('EJS 与助手同时监听 SETTINGS_READY，当前无法确定两个扩展的注册顺序');
      if (origins && (origins[index] < 0 || initial[origins[index]]?.content !== content)) {
        throw new Error('助手生成或修改了含 EJS 的消息，无法确认模板来源');
      }
      let offset = 0, result = '';
      for (let tag = content.indexOf('<%'); tag !== -1; tag = content.indexOf('<%', offset)) {
        const candidates = [...entries.values()].filter(candidate => tag - candidate.tag >= offset &&
          content.startsWith(candidate.before, tag - candidate.tag));
        const entry = candidates.length === 1 ? candidates[0] : offset === 0 ? entries.get(content) : undefined;
        if (!entry) throw new Error('请求含有无法定位到原预设条目的 EJS，已停止发送');
        const start = tag - entry.tag;
        const part = content.slice(offset, start) + evaluate(entry, options, variables);
        totalBytes += Buffer.byteLength(part);
        if (totalBytes > 8 * 1024 * 1024) throw new Error('EJS 输出超过 8 MiB');
        result += part;
        offset = start + entry.before.length;
      }
      const tail = content.slice(offset);
      totalBytes += Buffer.byteLength(tail);
      if (totalBytes > 8 * 1024 * 1024) throw new Error('EJS 输出超过 8 MiB');
      edits.push({ index, text: result + tail });
    }
    return edits;
  }
  return { prepare, get active() { return entries.size > 0; }, patches };
}
