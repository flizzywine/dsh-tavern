// This entire function is serialized into QuickJS. Nothing here is a host bridge.
// Compatibility surface follows Tavern Helper's public event/macro contracts;
// browser objects below are private, in-memory objects with no I/O capability.
export async function helperGuest(input, installBrowser, createTools) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const stringify = JSON.stringify.bind(JSON), parse = JSON.parse.bind(JSON);
  const evaluate = (0, eval), NativeDate = Date;
  const isBundled = input.bundled === true;
  const failures = [], notes = [], listeners = new Map(), emitted = new Set(), macros = new Map(), ready = [];
  const deny = what => { const text = '受限助手环境不支持：' + what; failures.push(text); throw Error(text); };
  let currentScript = '', seed = input.seed >>> 0, captured, resolveCapture, active = false, calls = 0;
  const capturedPromise = new Promise(resolve => { resolveCapture = resolve; });
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  Math.random = random;
  // Replay evaluates the same hooks against the same logical clock.
  let elapsed = 0;
  globalThis.performance = Object.freeze({ now: () => ++elapsed, timeOrigin: input.now });
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [input.now])); }
    static now() { return input.now; }
  };
  globalThis.crypto = Object.freeze({
    getRandomValues(array) {
      if (!ArrayBuffer.isView(array) || array.byteLength > 65536) return deny('随机数组大小');
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
      return array;
    },
    randomUUID() {
      return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
        (+c ^ Math.floor(random() * 16) >> +c / 4).toString(16)
      );
    },
  }); // Deterministic identifiers for replay, NOT cryptographic randomness.
  globalThis.structuredClone = clone;
  const baseEvents = {
    GENERATION_STARTED: 'generation_started',
    GENERATION_AFTER_COMMANDS: 'generation_after_commands',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
    ...(input.version === 2 && { GENERATE_AFTER_DATA: 'generate_after_data' }),
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    MESSAGE_RECEIVED: 'message_received',
  };
  const events = isBundled
    ? new Proxy(baseEvents, { get(t, k) { return typeof k === 'string' ? (t[k] || k.toLowerCase()) : undefined; } })
    : Object.freeze(baseEvents);
  const eventOn = (event, fn, order, once = false) => {
    if (typeof event !== 'string' || typeof fn !== 'function') return deny('无效事件监听');
    const items = listeners.get(event) || [];
    const found = items.findIndex(item => item.fn === fn);
    if (found >= 0 && !order) return { stop: () => eventRemoveListener(event, fn) };
    if (found >= 0) items.splice(found, 1);
    const item = { fn, once, scriptId: currentScript };
    if (order === 'first') items.unshift(item); else items.push(item);
    listeners.set(event, items);
    return { stop: () => eventRemoveListener(event, fn) };
  };
  const eventRemoveListener = (event, fn) => listeners.set(event, (listeners.get(event) || []).filter(item => item.fn !== fn));
  const emit = async (event, ...args) => {
    emitted.add(event);
    for (const item of [...(listeners.get(event) || [])]) {
      if (item.once) eventRemoveListener(event, item.fn);
      const previous = currentScript; currentScript = item.scriptId;
      try { await item.fn(...args); } finally { currentScript = previous; }
    }
  };
  const stores = new Map();
  for (const [key, value] of Object.entries(input.variables || {})) stores.set(key, clone(value));
  const variableKey = (option = {}) => {
    const type = option.type || 'chat';
    if (!['chat', 'global', 'preset', 'script'].includes(type)) return deny('变量作用域 ' + type);
    return type === 'script' ? type + ':' + (option.script_id || currentScript) : type;
  };
  const getVariables = option => clone(stores.get(variableKey(option)) || {});
  const replaceVariables = (value, option) => { stores.set(variableKey(option), clone(value)); };
  const storage = new Map();
  const localStorage = Object.freeze({ getItem: key => storage.get(String(key)) ?? null,
    setItem: (key, value) => storage.set(String(key), String(value)), removeItem: key => storage.delete(String(key)), clear: () => storage.clear() });
  const tools = createTools({ clone, deny, scriptId: () => currentScript,
    async inScript(id, run) {
      const previous = currentScript; currentScript = id;
      try { return await run(); } finally { currentScript = previous; }
    },
  });
  const chat = clone(input.chat || []);
  const context = {
    name1: input.userName,
    name2: input.charName,
    characters: [{ avatar: 'character.png', name: input.charName || 'Assistant' }],
    characterId: 0,
    groupId: null,
    chatId: 'chat-main',
    getCurrentChatId: () => 'chat-main',
    chat: chat.map(row => ({ name: row.name, mes: row.message, is_user: row.role === 'user', is_system: row.role === 'system', is_hidden: false, extra: {} })),
    extensionSettings: {},
    powerUserSettings: {},
    chatCompletionSettings: input.rawPreset ? clone(input.rawPreset) : { function_calling: input.functionCalling !== false, chat_completion_source: input.source || 'openai', preset_settings_openai: 'active-preset' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    messageFormatter: { addHook: () => () => {} },
    ToolManager: tools.manager,
    registerFunctionTool: tools.manager.registerFunctionTool,
    unregisterFunctionTool: tools.manager.unregisterFunctionTool,
    canPerformToolCalls: () => input.functionCalling !== false,
    eventTypes: events,
    event_types: events,
    eventSource: {
      on: eventOn,
      once: (e, f) => eventOn(e, f, undefined, true),
      makeFirst: (e, f) => eventOn(e, f, 'first'),
      makeLast: (e, f) => eventOn(e, f, 'last'),
      removeListener: eventRemoveListener,
      emit,
    },
  };
  const api = {
    tavern_events: events, event_types: events, eventSource: context.eventSource,
    eventOn, eventOnce: (e, f) => eventOn(e, f, undefined, true),
    eventMakeFirst: (e, f) => eventOn(e, f, 'first'), eventMakeLast: (e, f) => eventOn(e, f, 'last'),
    eventEmit: emit, eventEmitAndWait: emit, eventRemoveListener,
    eventClearEvent: event => listeners.delete(event), eventClearAll: () => listeners.clear(),
    eventClearListener: fn => { for (const event of listeners.keys()) eventRemoveListener(event, fn); },
    registerMacroLike: (regex, replace) => {
      if (!(regex instanceof RegExp) || typeof replace !== 'function') return deny('无效助手宏');
      const scriptId = currentScript;
      macros.set(regex, (...args) => { const previous = currentScript; currentScript = scriptId;
        try { return replace(...args); } finally { currentScript = previous; }
      }); return { unregister: () => macros.delete(regex) };
    }, unregisterMacroLike: regex => macros.delete(regex),
    getVariables, replaceVariables, insertOrAssignVariables: (value, option) => {
      const next = { ...getVariables(option), ...value }; replaceVariables(next, option); return next;
    },
    updateVariablesWith: (update, option) => {
      const next = update(getVariables(option));
      if (next?.then) return next.then(value => { replaceVariables(value, option); return value; });
      replaceVariables(next, option); return next;
    },
    getScriptId: () => currentScript,
    getLastMessageId: () => chat.length - 1,
    getChatMessages: (range = '0-{{lastMessageId}}', options = {}) => {
      const { role = 'all', hide_state = 'all', include_swipes = false } = options;
      if (include_swipes || Object.keys(options).some(k => !['role', 'hide_state', 'include_swipes'].includes(k))) {
        if (isBundled) throw Error('未导出的消息页或聊天选项');
        return deny('未导出的消息页或聊天选项');
      }
      if (!['all', 'user', 'assistant', 'system'].includes(role) || !['all', 'hidden', 'unhidden'].includes(hide_state)) return deny('聊天筛选选项');
      const match = String(range).replace(/\{\{lastMessageId\}\}/gi, String(chat.length - 1)).match(/^(-?\d+)(?:-(-?\d+))?$/);
      if (!match) return deny('聊天范围 ' + range);
      const index = text => Number(text) < 0 ? chat.length + Number(text) : Number(text);
      const start = index(match[1]), end = index(match[2] ?? match[1]);
      return clone(chat.filter(row => row.message_id >= start && row.message_id <= end && (role === 'all' || row.role === role) && hide_state !== 'hidden'));
    },
    getPreset: (name = 'in_use') => (name === 'in_use' || name === 'active-preset') ? clone(input.preset) : deny('未冻结的预设 ' + name),
    getLoadedPresetName: () => 'active-preset',
    getPresetNames: () => ['active-preset'],
  };
  Object.assign(globalThis, api);
  for (const name of ['generate', 'generateRaw', 'setChatMessages', 'createChatMessages', 'deleteChatMessages', 'triggerSlash', 'fetch',
    'XMLHttpRequest', 'WebSocket', 'setTimeout', 'setInterval', 'Worker', 'importScripts']) {
    globalThis[name] = () => deny(name);
  }
  const SillyTavern = { ...context, getContext: () => context };
  const win = globalThis;
  Object.assign(win, { SillyTavern, TavernHelper: api, localStorage, sessionStorage: localStorage, ...api });
  win.window = win; win.parent = win; win.top = win; win.self = win;

  installBrowser({ isBundled, bootstrapIds: input.bootstrapIds, ready, eventOn, eventRemoveListener, deny });
  Object.assign(globalThis, { window: win, parent: win, top: win, self: win, document: win.document, localStorage, SillyTavern, TavernHelper: api, $: win.$ });

  class Headers {
    constructor(values = {}) { this.values = new Map(values instanceof Headers ? values.values : Object.entries(values).map(([k, v]) => [k.toLowerCase(), String(v)])); }
    get(name) { return this.values.get(name.toLowerCase()) ?? null; }
    set(name, value) { this.values.set(name.toLowerCase(), String(value)); }
    delete(name) { this.values.delete(name.toLowerCase()); }
    entries() { return this.values.entries(); }
    [Symbol.iterator]() { return this.entries(); }
  }
  class TextEncoder {
    encode(text = '') {
      const bytes = [];
      for (const character of String(text)) {
        let c = character.codePointAt(0); if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
        if (c < 128) bytes.push(c);
        else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
        else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
        else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
      }
      return new Uint8Array(bytes);
    }
  }
  class TextDecoder {
    constructor(encoding = 'utf-8') {
      if (!['utf-8', 'utf8'].includes(String(encoding).toLowerCase())) return deny('文本编码 ' + encoding);
      this.pending = [];
    }
    decode(bytes = [], options = {}) {
      bytes = [...this.pending, ...bytes]; this.pending = [];
      let text = '';
      for (let i = 0; i < bytes.length;) {
        const start = i, a = bytes[i++], size = a < 128 ? 1 : a >= 194 && a <= 223 ? 2 : a >= 224 && a <= 239 ? 3 : a >= 240 && a <= 244 ? 4 : 0;
        if (!size) { text += '\ufffd'; continue; }
        if (start + size > bytes.length) {
          if (options.stream) this.pending = bytes.slice(start); else text += '\ufffd';
          break;
        }
        let cp = a & (size === 1 ? 127 : size === 2 ? 31 : size === 3 ? 15 : 7), valid = true;
        for (let j = 1; j < size; j++) {
          const b = bytes[start + j];
          if ((b & 192) !== 128) { valid = false; break; }
          cp = cp << 6 | b & 63;
        }
        if (!valid || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff || size > 1 && cp < [0, 0, 128, 2048, 65536][size]) { text += '\ufffd'; continue; }
        i = start + size;
        text += String.fromCodePoint(cp);
      }
      return text;
    }
  }
  class ReadableStream {
    constructor(source = {}) {
      this.queue = []; this.closed = false; this.source = source;
      this.controller = { enqueue: value => this.queue.push(value), close: () => { this.closed = true; }, error: error => { this.error = error; } };
      this.started = Promise.resolve(source.start?.(this.controller));
    }
    getReader() { return { read: async () => {
      await this.started;
      if (!this.queue.length && !this.closed) await this.source.pull?.(this.controller);
      if (this.error) throw this.error;
      if (this.queue.length) return { value: this.queue.shift(), done: false };
      if (!this.closed) return deny('异步外部流');
      return { done: true };
    }, cancel: reason => { this.closed = true; return this.source.cancel?.(reason); }, releaseLock() {} }; }
    tee() {
      const reader = this.getReader(), buffered = []; let pulling;
      const branch = () => { let position = 0; return new ReadableStream({ async pull(controller) {
        if (position === buffered.length) {
          pulling ||= reader.read().then(value => { buffered.push(value); pulling = null; });
          await pulling;
        }
        const item = buffered[position++];
        if (item.done) controller.close(); else controller.enqueue(item.value);
      } }); };
      return [branch(), branch()];
    }
  }
  class Response {
    constructor(body = '', options = {}) {
      this.status = options.status ?? 200; this.statusText = options.statusText || 'OK'; this.ok = this.status >= 200 && this.status < 300;
      this.headers = new Headers(options.headers); this.bodyUsed = false;
      this.raw = typeof body === 'string' ? body : null;
      this.body = body instanceof ReadableStream ? body : new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
    }
    async text() {
      if (this.bodyUsed) throw Error('response 已消费'); this.bodyUsed = true;
      const reader = this.body.getReader(), decoder = new TextDecoder(); let text = '';
      for (;;) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
      return text + decoder.decode();
    }
    async json() { return parse(await this.text()); }
    clone() {
      if (this.bodyUsed) throw Error('response 已消费');
      const [original, copy] = this.body.tee(); this.body = original;
      return new Response(copy, this);
    }
  }
  class Request {
    constructor(value, options = {}) {
      if (Object.keys(options).some(key => !['method', 'body', 'headers'].includes(key))) return deny('Request 传输参数');
      this.url = typeof value === 'string' ? value : value.url; this.method = options.method || value.method || 'GET'; this.body = options.body ?? value.body;
      this.headers = new Headers(options.headers || value.headers);
    }
    clone() { return new Request(this); }
    async text() { return this.body || ''; }
  }
  Object.assign(globalThis, { Headers, Response, Request, ReadableStream, TextEncoder, TextDecoder });
  const endpoint = '/api/backends/chat-completions/generate';
  const baseFetch = async (url, options = {}) => {
    const rawUrl = typeof url === 'string' ? url : url?.url;
    if (isBundled && rawUrl !== endpoint && typeof rawUrl === 'string' && /^(?:https?:\/\/localhost)?\/api\//i.test(rawUrl)) {
      throw Error('本地管理接口未启用');
    }
    if (!active || rawUrl !== endpoint || ++calls !== 1) return deny('网络访问或额外生成');
    if (String(options.method || url?.method || 'GET').toUpperCase() !== 'POST' || Object.keys(options).some(key => !['method', 'body', 'headers'].includes(key))) return deny('生成传输参数');
    const headers = new Headers(options.headers || url?.headers);
    if ([...headers].some(([key, value]) => key !== 'content-type' || value !== 'application/json')) return deny('生成传输 headers');
    const body = options.body ?? url.body;
    if (typeof body !== 'string') return deny('非 JSON 生成请求');
    captured = parse(body);
    tools.bindRequest(captured);
    resolveCapture(captured);
    if (input.phase === 'request') return new Promise(() => {});
    if (stringify(captured) !== input.expected) return deny('请求重放不一致');
    return new Response(stringify(input.response), { headers: { 'content-type': 'application/json' } });
  };
  win.fetch = baseFetch;
  for (const script of input.scripts) {
    currentScript = script.id;
    const start = ready.length;
    try {
      const initialized = evaluate(script.content);
      if (initialized && typeof initialized.then === 'function') await initialized;
      for (let i = start; i < ready.length; i++) await ready[i]();
    } catch (error) {
      throw Error('初始化「' + script.name + '」失败：' + (error?.message || error));
    }
    // Each script is initialized once; callbacks run in its script ID scope.
    if (failures.length) throw Error(failures[0]);
  }
  await emit(events.GENERATION_STARTED, input.trigger, {}, false);
  if (isBundled || listeners.has(events.GENERATION_AFTER_COMMANDS)) {
    await emit(events.GENERATION_AFTER_COMMANDS, input.trigger, {}, false);
  }
  let wire = clone(input.request);
  const playerInput = wire.messages[input.inputMessageIndex];
  // Object spread preserves a symbol; JSON serialization does not expose it
  // in history snapshots, tool descriptions, or the provider request.
  const inputOrigin = Symbol();
  if (input.version === 2 && playerInput?.role === 'user') playerInput[inputOrigin] = true;
  const initialMessages = input.phase === 'templates' ? new Map(wire.messages.map((message, index) => [message, index])) : null;
  // ST's virtual /generate envelope also carries client-side routing fields.
  // They belong to the frozen transport, never the provider's wire payload.
  const routing = input.source ? { type: input.trigger || 'normal', chat_completion_source: input.source, stream: false } : {};
  Object.assign(wire, routing);
  for (const [index, message] of wire.messages.entries()) for (const [regex, replace] of macros) {
    message.content = message.content.replace(regex, (...args) => replace({ role: message.role, message_id: index }, ...args));
  }
  const prompt = { chat: wire.messages, dryRun: false };
  await emit(events.CHAT_COMPLETION_PROMPT_READY, prompt); wire.messages = prompt.chat;
  const declarations = await tools.declarations();
  if (declarations.length) wire.tools = [...(wire.tools || []), ...declarations];
  let taggedRow;
  // Enumerable so an object spread carries the serializer along with its
  // is_user flag. Helpers often JSON-encode whole rows into tool descriptions.
  function serializeInputRow() {
    const { is_user, toJSON, ...plain } = this;
    return plain;
  }
  const removeInputFlags = () => {
    if (!taggedRow || !Array.isArray(wire.messages)) return;
    for (const [index, message] of wire.messages.entries()) {
      const taggedSerializer = message?.toJSON === serializeInputRow;
      if (!taggedSerializer && message?.is_user !== true) continue;
      if (Reflect.deleteProperty(message, 'is_user') && (!taggedSerializer || Reflect.deleteProperty(message, 'toJSON'))) continue;
      const copy = { ...message };
      delete copy.is_user;
      if (taggedSerializer) delete copy.toJSON;
      wire.messages[index] = copy;
    }
  };
  if (input.version === 2) {
    // Both the native .prompt and legacy wire fields are own properties. This
    // preserves cloning, enumeration, and writes performed by existing hooks.
    const afterData = wire;
    const original = Object.getOwnPropertyDescriptor(afterData, 'prompt');
    let dispatching = true;
    Object.defineProperty(afterData, 'prompt', { configurable: true, enumerable: true,
      get() {
        if (dispatching && !taggedRow && playerInput?.role === 'user' && Array.isArray(afterData.messages)) {
          // A previous prompt hook may have reordered or spread rows. Never
          // infer provenance from equal text across user-role material.
          if (afterData.messages.includes(playerInput)) taggedRow = playerInput;
          else {
            const copies = afterData.messages.filter(message => message?.[inputOrigin] === true);
            if (copies.length === 1) taggedRow = copies[0];
          }
          // Respect a serializer installed by a preceding helper.
          if (taggedRow && !('toJSON' in taggedRow) && Object.isExtensible(taggedRow)) {
            Object.assign(taggedRow, { is_user: true, toJSON: serializeInputRow });
          }
        }
        return afterData.messages;
      },
      set(value) { afterData.messages = value; },
    });
    await emit(events.GENERATE_AFTER_DATA, afterData, false);
    dispatching = false;
    const fields = Object.getOwnPropertyDescriptors(afterData);
    if (original) fields.prompt = original;
    else delete fields.prompt;
    wire = Object.defineProperties({}, fields);
    if (taggedRow?.toJSON === serializeInputRow) {
      Reflect.deleteProperty(taggedRow, 'is_user');
      Reflect.deleteProperty(taggedRow, 'toJSON');
    }
    removeInputFlags();
  }
  if (input.phase === 'templates') {
    if (failures.length) throw Error(failures[0]);
    return { messages: wire.messages, origins: wire.messages.map(message => initialMessages.get(message) ?? -1),
      settingsListeners: !!listeners.get(events.CHAT_COMPLETION_SETTINGS_READY)?.length,
      variables: { chat: getVariables({ type: 'chat' }), global: getVariables({ type: 'global' }) } };
  }
  if (input.templatePass) {
    if (stringify(wire.messages) !== input.templatePass.before) return deny('EJS 准备阶段重放不一致');
    for (const edit of input.templatePass.edits) wire.messages[edit.index].content = edit.text;
  }
  await emit(events.CHAT_COMPLETION_SETTINGS_READY, wire);
  // A response may belong to a request compiled before the event order changed.
  if (input.version === 1) await emit(events.GENERATE_AFTER_DATA || 'generate_after_data', wire, false);
  removeInputFlags();
  for (const name of listeners.keys()) if (!emitted.has(name) && !['pagehide', events.MESSAGE_RECEIVED].includes(name)) notes.push('未触发助手事件：' + name);
  active = true;
  const pending = Promise.resolve(win.fetch(endpoint, { method: 'POST', body: stringify(wire) }));
  let rejected;
  pending.catch(error => { rejected = error; });
  const request = await Promise.race([capturedPromise, pending.then(() => { throw Error('助手没有转交生成请求'); })]);
  await Promise.resolve();
  if (rejected) throw rejected;
  if (failures.length) throw Error(failures[0]);
  if (input.phase === 'request') return { request, handledTools: tools.handledNames(), notes, intercepts: win.fetch !== baseFetch };
  const response = await (await pending).json();
  active = false;
  const message = response?.choices?.[0]?.message;
  if (message) {
    await tools.consume(message);
    if (typeof message.content === 'string' && message.content.length > 0 && (listeners.get(events.MESSAGE_RECEIVED) || []).length > 0) {
      context.chat.push({ name: input.charName || 'Assistant', mes: message.content, is_user: false, is_system: false, is_hidden: false, extra: {} });
      await emit(events.MESSAGE_RECEIVED, context.chat.length - 1, input.trigger || 'normal');
      const updated = context.chat.at(-1)?.mes;
      if (typeof updated === 'string') message.content = updated;
    }
  }
  await emit('pagehide');
  if (failures.length) throw Error(failures[0]);
  return { response, notes };
}
