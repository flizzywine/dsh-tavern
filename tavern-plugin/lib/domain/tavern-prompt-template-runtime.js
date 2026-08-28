import variant from '@jitl/quickjs-singlefile-mjs-release-sync'
import ejs from 'ejs'
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'
import YAML from 'yaml'

const MAX_TEMPLATE_CHARS = 256 * 1024
const MAX_OUTPUT_CHARS = 256 * 1024
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024
const MAX_STACK_BYTES = 512 * 1024
const MAX_INTERRUPT_POLLS = 512
const MAX_PENDING_JOBS = 1024
const APPEND_SOURCE = 'function __append(s) { if (s !== undefined && s !== null) __output += s }'

let quickjsModule

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function mergeVariables(target, source) {
  if (!object(source) || Object.keys(object(source)).length === 0) return target
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) target[key] = serializable(value)
    else if (object(value) === value) target[key] = mergeVariables(object(target[key]), value)
    else target[key] = value
  }
  return target
}

function initialVariableBody(entry) {
  const comment = String(entry && (entry.comment || entry.name) || '')
  let content = String(entry && entry.content || '')
  let decorated = comment.startsWith('[InitialVariables]')
  if (content.startsWith('@@')) {
    const lines = content.replaceAll('\r\n', '\n').split('\n')
    let index = 0
    while (index < lines.length && lines[index].startsWith('@@')) {
      if (lines[index].split(/\s+/, 1)[0] === '@@initial_variables') decorated = true
      index += 1
    }
    content = lines.slice(index).join('\n')
  }
  return decorated && entry && entry.enabled !== false ? content : null
}

function failureKind(value) {
  const record = value !== null && typeof value === 'object' ? value : {}
  const message = String(record.message || value || '')
  if (message.includes('__DSH_EJS_OUTPUT_LIMIT__')) return 'output-limit'
  if (message.includes('__DSH_EJS_RESOURCE_UNSUPPORTED__')) return 'resource-unsupported'
  if (message.includes('interrupted')) return 'execution-limit'
  if (/out of memory|memory limit/i.test(message)) return 'memory-limit'
  if (record.name === 'SyntaxError') return 'syntax-error'
  return 'runtime-error'
}

function compileTemplate(template) {
  const compiled = ejs.compile(template, {
    async: true,
    outputFunctionName: 'print',
    _with: true,
    localsName: 'locals',
    client: true
  }).toString()
  if (!compiled.includes(APPEND_SOURCE)) throw new Error('EJS 3.1.9 输出函数结构不匹配')
  return compiled.replace(APPEND_SOURCE, [
    'function __append(s) {',
    '  if (s === undefined || s === null) return;',
    '  __output += s;',
    `  if (__output.length > ${MAX_OUTPUT_CHARS}) throw new Error('__DSH_EJS_OUTPUT_LIMIT__');`,
    '}'
  ].join('\n'))
}

function sandboxSource(compiled, context) {
  const input = JSON.stringify(serializable({
    charName: String(context.charName || ''),
    userName: String(context.userName || '你'),
    runType: String(context.runType || 'generate'),
    generateType: String(context.generateType || ''),
    transcript: Array.isArray(context.transcript) ? context.transcript : [],
    messages: Array.isArray(context.messages) ? context.messages : [],
    scopes: object(context.scopes),
    locals: object(context.locals),
    worldBookEntries: Array.isArray(context.worldBookEntries) ? context.worldBookEntries : []
  }))
  return `(async () => {
    const __input = JSON.parse(${JSON.stringify(input)});
    const __owns = (record, key) => Object.prototype.hasOwnProperty.call(Object(record), key);
    const __unsafe = key => key === '__proto__' || key === 'prototype' || key === 'constructor';
    const __plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const __clone = (value, seen = new WeakMap()) => {
      if (value === null || typeof value !== 'object') return value;
      if (seen.has(value)) return seen.get(value);
      const result = Array.isArray(value) ? [] : Object.create(null);
      seen.set(value, result);
      for (const key of Object.keys(value)) if (!__unsafe(key)) result[key] = __clone(value[key], seen);
      return result;
    };
    const __path = value => {
      if (Array.isArray(value)) return value.map(String).filter(key => !__unsafe(key));
      const result = [];
      String(value ?? '').replace(/[^.[\\]]+|\\[(?:(-?\\d+(?:\\.\\d+)?)|(["'])((?:(?!\\2)[^\\\\]|\\\\.)*?)\\2)\\]/g,
        (match, number, quote, quoted) => { const key = quote ? quoted.replace(/\\\\([\\\\"'])/g, '$1') : (number === undefined ? match : number); if (!__unsafe(key)) result.push(key); });
      return result;
    };
    const __get = (record, path, fallback = undefined) => {
      let value = record;
      const parts = __path(path);
      if (parts.length === 0) return fallback;
      for (const key of parts) {
        if (value === null || value === undefined || !__owns(value, key)) return fallback;
        value = value[key];
      }
      return value;
    };
    const __has = (record, path) => {
      const missing = Object.create(null);
      return __get(record, path, missing) !== missing;
    };
    const __set = (record, path, value) => {
      const parts = __path(path);
      if (parts.length === 0) {
        if (__plain(value)) for (const key of Object.keys(value)) if (!__unsafe(key)) record[key] = value[key];
        return record;
      }
      let current = record;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const key = parts[index], next = parts[index + 1];
        if (current[key] === null || typeof current[key] !== 'object') current[key] = /^\\d+$/.test(next) ? [] : Object.create(null);
        current = current[key];
      }
      current[parts[parts.length - 1]] = value;
      return record;
    };
    const __unset = (record, path) => {
      const parts = __path(path);
      if (parts.length === 0) return false;
      let current = record;
      for (let index = 0; index < parts.length - 1; index += 1) {
        if (current === null || typeof current !== 'object' || !__owns(current, parts[index])) return false;
        current = current[parts[index]];
      }
      return current !== null && typeof current === 'object' && delete current[parts[parts.length - 1]];
    };
    const __merge = (target, source) => {
      if (!__plain(source)) return target;
      for (const key of Object.keys(source)) {
        if (__unsafe(key)) continue;
        const value = source[key];
        if (__plain(value)) target[key] = __merge(__plain(target[key]) ? target[key] : Object.create(null), value);
        else target[key] = __clone(value);
      }
      return target;
    };
    const __scopes = {
      global: __clone(__input.scopes.global || {}),
      initial: __clone(__input.scopes.initial || {}),
      local: __clone(__input.scopes.local || __input.scopes.chat || {}),
      message: __clone(__input.scopes.message || {})
    };
    const variables = [__scopes.global, __scopes.initial, __scopes.local, __scopes.message]
      .reduce((result, item) => __merge(result, item), Object.create(null));
    const __options = value => {
      if (typeof value === 'string') {
        if (['global', 'local', 'message', 'initial', 'cache'].includes(value)) return { scope: value };
        if (['nx', 'xx', 'nxs', 'xxs', 'n'].includes(value)) return { flags: value };
        if (['old', 'new', 'fullcache'].includes(value)) return { results: value };
      }
      return __plain(value) ? value : {};
    };
    const __scope = value => {
      const options = __options(value), name = options.scope || 'cache';
      if (name === 'global') return __scopes.global;
      if (name === 'local' || name === 'chat') return __scopes.local;
      if (name === 'message') return __scopes.message;
      if (name === 'initial') return __scopes.initial;
      return variables;
    };
    const getvar = (name, options = {}) => {
      options = __options(options);
      let value = __get(__scope(options), name, options.defaults);
      if (options.index !== undefined) {
        try { value = __get(JSON.parse(value || '{}'), options.index, options.defaults); } catch { value = options.defaults; }
      }
      return options.clone ? __clone(value) : value;
    };
    const setvar = (name, value, options = {}) => {
      options = __options(options);
      const destination = __scope({ scope: options.scope || 'message' });
      const existed = __has(variables, name);
      if ((options.flags === 'nx' || options.flags === 'nxs') && existed) return undefined;
      if ((options.flags === 'xx' || options.flags === 'xxs') && !existed) return undefined;
      const oldValue = __get(variables, name);
      let next = value;
      if (options.merge && __plain(oldValue) && __plain(value)) next = __merge(__clone(oldValue), value);
      if (options.index !== undefined) {
        let data;
        try { data = JSON.parse(__get(variables, name, '{}') || '{}'); } catch { data = {}; }
        value === undefined ? __unset(data, options.index) : __set(data, options.index, value);
        next = JSON.stringify(data);
      }
      if (next === undefined) { __unset(destination, name); __unset(variables, name); }
      else { __set(destination, name, __clone(next)); __set(variables, name, __clone(next)); }
      if (options.results === 'old') return oldValue;
      if (options.results === 'fullcache') return variables;
      return next;
    };
    const __getScoped = scope => (name, options = {}) => getvar(name, Object.assign({}, __options(options), { scope }));
    const __setScoped = scope => (name, value, options = {}) => setvar(name, value, Object.assign({}, __options(options), { scope }));
    const getLocalVar = __getScoped('local'), getGlobalVar = __getScoped('global'), getMessageVar = __getScoped('message');
    const setLocalVar = __setScoped('local'), setGlobalVar = __setScoped('global'), setMessageVar = __setScoped('message');
    const incvar = (name, amount = 1, options = {}) => setvar(name, Number(getvar(name, options) || 0) + Number(amount || 0), options);
    const decvar = (name, amount = 1, options = {}) => incvar(name, -Number(amount || 0), options);
    const __incScoped = scope => (name, amount = 1, options = {}) => incvar(name, amount, Object.assign({}, __options(options), { scope }));
    const __decScoped = scope => (name, amount = 1, options = {}) => decvar(name, amount, Object.assign({}, __options(options), { scope }));
    const incLocalVar = __incScoped('local'), incGlobalVar = __incScoped('global'), incMessageVar = __incScoped('message');
    const decLocalVar = __decScoped('local'), decGlobalVar = __decScoped('global'), decMessageVar = __decScoped('message');
    const delvar = (name, index = undefined, options = {}) => {
      if (index === undefined || index === null) return setvar(name, undefined, options);
      const value = __clone(getvar(name, options));
      if (Array.isArray(value)) { const position = value.indexOf(index); if (position >= 0) value.splice(position, 1); }
      else if (__plain(value)) delete value[String(index)];
      else if (typeof value === 'string' && typeof index === 'string') return setvar(name, value.replace(index, ''), options);
      return setvar(name, value, options);
    };
    const __delScoped = scope => (name, index = undefined, options = {}) => delvar(name, index, Object.assign({}, __options(options), { scope }));
    const delLocalVar = __delScoped('local'), delGlobalVar = __delScoped('global'), delMessageVar = __delScoped('message');
    const insvar = (name, value, index = undefined, options = {}) => {
      let current = __clone(getvar(name, options));
      if (Array.isArray(current)) current.splice(index === undefined ? current.length : Number(index), 0, value);
      else if (__plain(current)) current[String(index ?? Object.keys(current).length)] = value;
      else if (typeof current === 'string') current = current.slice(0, Number(index ?? current.length)) + String(value) + current.slice(Number(index ?? current.length));
      else current = [value];
      return setvar(name, current, options);
    };
    const __insScoped = scope => (name, value, index = undefined, options = {}) => insvar(name, value, index, Object.assign({}, __options(options), { scope }));
    const insertLocalVar = __insScoped('local'), insertGlobalVar = __insScoped('global'), insertMessageVar = __insScoped('message');
    const _ = Object.freeze({
      get: __get, set: __set, has: __has, unset: __unset, cloneDeep: __clone,
      merge: (...values) => values.slice(1).reduce((result, value) => __merge(result, value), values[0] || {}),
      mergeWith: (...values) => values.filter(value => typeof value !== 'function').slice(1).reduce((result, value) => __merge(result, value), values[0] || {}),
      isArray: Array.isArray, isObject: value => value !== null && typeof value === 'object', isPlainObject: __plain,
      isString: value => typeof value === 'string', isNumber: value => typeof value === 'number', isBoolean: value => typeof value === 'boolean',
      keys: Object.keys, values: Object.values, entries: Object.entries, assign: Object.assign,
      concat: (...values) => values.flat(), map: (values, fn) => Object.keys(Object(values)).map(key => fn(values[key], key, values)),
      mapValues: (values, fn) => Object.fromEntries(Object.keys(Object(values)).map(key => [key, fn(values[key], key, values)])),
      isEmpty: value => value == null || (typeof value === 'string' || Array.isArray(value) ? value.length === 0 : Object.keys(Object(value)).length === 0),
      range: (start, end = undefined) => { if (end === undefined) { end = start; start = 0; } return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index); },
      times: (count, fn) => Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => fn(index)),
      constant: value => () => value
    });
    const __transcript = __input.transcript;
    const __messageIndex = value => { const id = Number(value); return Number.isInteger(id) ? (id < 0 ? __transcript.length + id : id) : -1; };
    const getChatMessage = id => { const item = __transcript[__messageIndex(id)]; return item ? item.content : ''; };
    const getChatMessages = (count, role = undefined) => {
      const selected = role ? __transcript.filter(item => item.role === role) : __transcript;
      return selected.slice(-Math.max(0, Number(count) || 0)).map(item => item.content);
    };
    const __last = role => { for (let i = __transcript.length - 1; i >= 0; i -= 1) if (__transcript[i].role === role) return { id: i, content: __transcript[i].content }; return { id: -1, content: '' }; };
    const __lastUser = __last('user'), __lastChar = __last('assistant');
    const getWorldInfo = async (bookOrEntry, entry = undefined) => {
      const items = __input.worldBookEntries.filter(item => entry === undefined || item.book === String(bookOrEntry));
      const key = String(entry === undefined ? bookOrEntry : entry);
      const match = items.find(item => item.id === key || item.name === key || item.comment === key);
      if (!match) return '';
      if (/<%[=_-]?[\\s\\S]*?%>/i.test(match.content)) throw new Error('__DSH_EJS_RESOURCE_UNSUPPORTED__');
      return match.content;
    };
    const console = Object.freeze({ log() {}, info() {}, warn() {}, error() {}, debug() {} });
    const toastr = Object.freeze({ success() {}, info() {}, warning() {}, error() {} });
    const YAML = Object.freeze({ stringify: value => globalThis.__dshYamlStringify(value) });
    const locals = Object.assign({}, __clone(__input.locals), {
      _, YAML, console, toastr, variables,
      char: __input.charName, charName: __input.charName, assistantName: __input.charName,
      user: __input.userName, userName: __input.userName,
      runType: __input.runType, generateType: __input.generateType,
      messages: __input.messages, generateData: __input.messages,
      lastMessageId: __transcript.length - 1,
      lastUserMessageId: __lastUser.id, lastUserMessage: __lastUser.content,
      lastCharMessageId: __lastChar.id, lastCharMessage: __lastChar.content,
      lastMessage: __transcript.length ? __transcript[__transcript.length - 1].content : '',
      getChatMessage, getChatMessages, getWorldInfo, getwi: getWorldInfo,
      getvar, getVar: getvar, setvar,
      getLocalVar, getGlobalVar, getMessageVar, setLocalVar, setGlobalVar, setMessageVar,
      incvar, decvar, incLocalVar, incGlobalVar, incMessageVar, decLocalVar, decGlobalVar, decMessageVar,
      delvar, delLocalVar, delGlobalVar, delMessageVar,
      insvar, insertLocalVar, insertGlobalVar, insertMessageVar
    });
    const __template = (${compiled});
    const text = await __template.call(locals, locals);
    if (String(text).length > ${MAX_OUTPUT_CHARS}) throw new Error('__DSH_EJS_OUTPUT_LIMIT__');
    return JSON.stringify({ text: String(text), scopes: __scopes });
  })()`
}

export class TavernPromptTemplateRuntime {
  constructor(quickjs) {
    this.quickjs = quickjs
  }

  static async create() {
    quickjsModule ??= newQuickJSWASMModuleFromVariant(variant)
    return new TavernPromptTemplateRuntime(await quickjsModule)
  }

  render(template, context = {}) {
    if (typeof template !== 'string' || !template.includes('<%')) return { ok: true, text: String(template ?? ''), scopes: object(context.scopes), evaluated: false }
    if (template.length > MAX_TEMPLATE_CHARS) return { ok: false, kind: 'source-limit' }
    let compiled
    try { compiled = compileTemplate(template) } catch (error) { return { ok: false, kind: failureKind(error) } }
    const runtime = this.quickjs.newRuntime()
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
    runtime.setMaxStackSize(MAX_STACK_BYTES)
    let polls = 0
    runtime.setInterruptHandler(function () { return ++polls > MAX_INTERRUPT_POLLS })
    const vm = runtime.newContext()
    try {
      const stringify = vm.newFunction('__dshYamlStringify', function (handle) {
        return vm.newString(YAML.stringify(vm.dump(handle), { blockQuote: 'literal' }))
      })
      vm.setProp(vm.global, '__dshYamlStringify', stringify)
      stringify.dispose()
      const result = vm.evalCode(sandboxSource(compiled, context), 'dsh-tavern:prompt-template')
      if (result.error !== undefined) {
        const error = vm.dump(result.error)
        result.error.dispose()
        return { ok: false, kind: failureKind(error) }
      }
      const promise = result.value
      if (promise === undefined) return { ok: false, kind: 'runtime-error' }
      const jobs = runtime.executePendingJobs(MAX_PENDING_JOBS)
      if (jobs.error !== undefined) {
        const error = jobs.error.context.dump(jobs.error)
        jobs.error.dispose()
        jobs.dispose()
        promise.dispose()
        return { ok: false, kind: failureKind(error) }
      }
      jobs.dispose()
      const settled = vm.getPromiseState(promise)
      promise.dispose()
      if (settled.type === 'pending') return { ok: false, kind: 'execution-limit' }
      if (settled.type === 'rejected') {
        const error = vm.dump(settled.error)
        settled.error.dispose()
        return { ok: false, kind: failureKind(error) }
      }
      const dumped = vm.dump(settled.value)
      settled.value.dispose()
      let value
      try { value = JSON.parse(dumped) } catch { return { ok: false, kind: 'runtime-error' } }
      return { ok: true, text: String(value.text ?? ''), scopes: object(value.scopes), evaluated: true }
    } catch (error) {
      return { ok: false, kind: failureKind(error) }
    } finally {
      vm.dispose()
      runtime.dispose()
    }
  }

  renderMessages(messages, context = {}) {
    let scopes = serializable(object(context.scopes))
    const diagnostics = []
    let evaluated = 0
    const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
      return message && typeof message === 'object' ? Object.assign({}, message) : message
    })
    for (const [index, message] of projected.entries()) {
      if (!message || typeof message.content !== 'string') {
        continue
      }
      const result = this.render(message.content, Object.assign({}, context, {
        scopes,
        messages: projected.map(function (item) { return item && typeof item.content === 'string' ? item.content : '' })
      }))
      if (!result.ok) {
        diagnostics.push({ kind: 'prompt-template', code: result.kind, messageIndex: index })
        continue
      }
      scopes = serializable(result.scopes)
      if (result.evaluated) evaluated += 1
      projected[index] = Object.assign({}, message, { content: result.text })
    }
    return { messages: projected, scopes, diagnostics, evaluated }
  }

  initializeVariables(entries, context = {}) {
    let scopes = serializable(object(context.scopes))
    const initial = {}
    const diagnostics = []
    let evaluated = 0
    for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
      const body = initialVariableBody(entry)
      if (body === null) continue
      const rendered = this.render(body, Object.assign({}, context, { scopes: Object.assign({}, scopes, { initial }) }))
      if (!rendered.ok) {
        diagnostics.push({ kind: 'prompt-template-initial-variables', code: rendered.kind, entryIndex: index })
        continue
      }
      if (rendered.evaluated) evaluated += 1
      scopes = serializable(rendered.scopes)
      let parsed
      try { parsed = JSON.parse(rendered.text) } catch {
        try { parsed = YAML.parse(rendered.text) } catch {
          diagnostics.push({ kind: 'prompt-template-initial-variables', code: 'parse-error', entryIndex: index })
          continue
        }
      }
      if (object(parsed) !== parsed) {
        diagnostics.push({ kind: 'prompt-template-initial-variables', code: 'format-error', entryIndex: index })
        continue
      }
      mergeVariables(initial, parsed)
    }
    scopes.initial = initial
    return { initial, scopes, diagnostics, evaluated }
  }
}
