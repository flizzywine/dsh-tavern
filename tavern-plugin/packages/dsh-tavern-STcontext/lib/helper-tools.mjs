// Serialized into QuickJS along with helperGuest. No host functions or imports
// cross the boundary. Unsupported schema features fail before model generation.
export function createHelperTools({ clone, deny, scriptId, inScript }) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const equal = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  };
  const types = {
    object, array: Array.isArray, string: value => typeof value === 'string',
    number: value => typeof value === 'number' && Number.isFinite(value),
    integer: Number.isInteger, boolean: value => typeof value === 'boolean', null: value => value === null,
  };
  const annotations = ['title', 'description', 'default', 'examples', '$comment', 'deprecated', 'readOnly', 'writeOnly'];
  const counts = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'];
  const bounds = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
  const combinations = ['anyOf', 'oneOf', 'allOf'];
  const keywords = new Set([...annotations, ...counts, ...bounds, ...combinations,
    'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'uniqueItems', 'pattern', 'not']);
  function checkSchema(root) {
    let nodes = 0;
    function visit(schema, depth = 0) {
      if (++nodes > 1024 || depth > 32) return deny('工具 JSON Schema 过于复杂');
      if (typeof schema === 'boolean') return;
      if (!object(schema)) return deny('工具 JSON Schema 必须是对象或布尔值');
      for (const key of Object.keys(schema)) if (!keywords.has(key)) return deny('工具 JSON Schema 关键字 ' + key);
      if (schema.type !== undefined) {
        const list = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!list.length || new Set(list).size !== list.length || list.some(type => typeof type !== 'string' || !Object.hasOwn(types, type))) return deny('工具 JSON Schema type');
      }
      if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) return deny('工具 JSON Schema enum');
      for (const key of counts) if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || schema[key] < 0)) return deny('工具 JSON Schema ' + key);
      for (const key of bounds) if (schema[key] !== undefined && (!Number.isFinite(schema[key]) || key === 'multipleOf' && schema[key] <= 0)) return deny('工具 JSON Schema ' + key);
      if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') return deny('工具 JSON Schema uniqueItems');
      if (schema.pattern !== undefined) {
        if (typeof schema.pattern !== 'string') return deny('工具 JSON Schema pattern');
        try { new RegExp(schema.pattern, 'u'); } catch { return deny('工具 JSON Schema pattern'); }
      }
      if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string')
        || new Set(schema.required).size !== schema.required.length)) return deny('工具 JSON Schema required');
      if (schema.properties !== undefined) {
        if (!object(schema.properties)) return deny('工具 JSON Schema properties');
        for (const child of Object.values(schema.properties)) visit(child, depth + 1);
      }
      for (const key of ['additionalProperties', 'items', 'not']) if (schema[key] !== undefined) visit(schema[key], depth + 1);
      for (const key of combinations) if (schema[key] !== undefined) {
        if (!Array.isArray(schema[key]) || !schema[key].length) return deny('工具 JSON Schema ' + key);
        for (const child of schema[key]) visit(child, depth + 1);
      }
    }
    visit(root);
    if (!object(root) || root.type !== 'object') return deny('工具参数 Schema 顶层必须为 object');
  }
  function validate(schema, value) {
    let steps = 0;
    function matches(rule, data, depth = 0) {
      if (++steps > 100000 || depth > 64) return deny('工具参数校验超过预算');
      if (typeof rule === 'boolean') return rule;
      if (rule.type !== undefined && !(Array.isArray(rule.type) ? rule.type : [rule.type]).some(type => types[type](data))) return false;
      if (rule.enum && !rule.enum.some(item => equal(item, data))) return false;
      if (Object.hasOwn(rule, 'const') && !equal(rule.const, data)) return false;
      if (rule.allOf && !rule.allOf.every(child => matches(child, data, depth + 1))) return false;
      if (rule.anyOf && !rule.anyOf.some(child => matches(child, data, depth + 1))) return false;
      if (rule.oneOf && rule.oneOf.filter(child => matches(child, data, depth + 1)).length !== 1) return false;
      if (rule.not !== undefined && matches(rule.not, data, depth + 1)) return false;
      if (typeof data === 'string') {
        const length = Array.from(data).length;
        if (length < (rule.minLength ?? 0) || length > (rule.maxLength ?? Infinity)) return false;
        if (rule.pattern !== undefined && !new RegExp(rule.pattern, 'u').test(data)) return false;
      }
      if (typeof data === 'number') {
        if (data < (rule.minimum ?? -Infinity) || data > (rule.maximum ?? Infinity)
          || data <= (rule.exclusiveMinimum ?? -Infinity) || data >= (rule.exclusiveMaximum ?? Infinity)) return false;
        if (rule.multipleOf !== undefined) {
          const quotient = data / rule.multipleOf;
          if (Math.abs(quotient - Math.round(quotient)) > 1e-10) return false;
        }
      }
      if (Array.isArray(data)) {
        if (data.length < (rule.minItems ?? 0) || data.length > (rule.maxItems ?? Infinity)) return false;
        if (rule.items !== undefined && !data.every(item => matches(rule.items, item, depth + 1))) return false;
        if (rule.uniqueItems) for (let i = 0; i < data.length; i++) for (let j = 0; j < i; j++) {
          if (++steps > 100000) return deny('工具参数校验超过预算');
          if (equal(data[i], data[j])) return false;
        }
      }
      if (object(data)) {
        const keys = Object.keys(data);
        if (keys.length < (rule.minProperties ?? 0) || keys.length > (rule.maxProperties ?? Infinity)) return false;
        if (rule.required?.some(key => !Object.hasOwn(data, key))) return false;
        for (const key of keys) {
          const child = Object.hasOwn(rule.properties || {}, key) ? rule.properties[key] : rule.additionalProperties;
          if (child !== undefined && !matches(child, data[key], depth + 1)) return false;
        }
      }
      return true;
    }
    if (!object(value) || !matches(schema, value)) return deny('工具正文参数不符合声明的 JSON Schema');
  }

  const registered = new Map();
  let selected = new Map(), bound = new Map();
  const manager = {
    get tools() { return [...registered.values()]; },
    registerFunctionTool(def) {
      if (!object(def) || typeof def.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(def.name)) return deny('无效工具名称');
      for (const key of ['action', 'shouldRegister']) if (def[key] !== undefined && typeof def[key] !== 'function') return deny('无效工具 ' + key);
      const parameters = clone(def.parameters ?? { type: 'object', properties: {} });
      checkSchema(parameters);
      const entry = { ...def, parameters, scriptId: scriptId() };
      // This declaration is independent of subsequent mutations of the caller's object.
      const declaration = { type: 'function', function: { name: def.name, description: String(def.description || ''), parameters: clone(parameters) } };
      entry.toFunctionOpenAI = () => clone(declaration);
      registered.set(def.name, Object.freeze(entry));
      return entry;
    },
    unregisterFunctionTool(name) { registered.delete(name); },
  };
  return {
    manager,
    async declarations() {
      selected = new Map();
      for (const entry of registered.values()) {
        const enabled = !entry.shouldRegister || await inScript(entry.scriptId, () => entry.shouldRegister()) === true;
        if (enabled) selected.set(entry.name, { ...entry, parameters: clone(entry.toFunctionOpenAI().function.parameters) });
      }
      return [...selected.values()].map(entry => entry.toFunctionOpenAI());
    },
    bindRequest(request) {
      bound = new Map();
      for (const tool of request.tools || []) {
        const entry = selected.get(tool?.function?.name);
        if (!entry) continue;
        if (!equal(entry.parameters, tool.function.parameters)) return deny('请求改写改变了 ToolManager 参数 Schema');
        bound.set(entry.name, entry);
      }
    },
    handledNames: () => [...bound.keys()],
    async consume(message) {
      if (!Array.isArray(message.tool_calls) || !message.tool_calls.length) return;
      const owned = [], remaining = [];
      // Validate every owned call before running any action; never partially
      // consume a malformed response. Other tools retain their original order.
      for (const call of message.tool_calls) {
        const entry = bound.get(call?.function?.name);
        if (!entry) { remaining.push(call); continue; }
        const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
        validate(entry.parameters, args);
        owned.push({ entry, args });
      }
      if (!owned.length) return;
      const parts = [message.content || ''];
      for (const { entry, args } of owned) {
        const result = entry.action ? await inScript(entry.scriptId, () => entry.action(clone(args))) : undefined;
        let text = typeof result === 'string' && result.trim() ? result : args.content;
        if (typeof text !== 'string' && entry.parameters.required?.length === 1) text = args[entry.parameters.required[0]];
        if (typeof text !== 'string' || !text.trim()) return deny('ToolManager 工具没有返回有效正文：' + entry.name);
        parts.push(text);
      }
      message.content = parts.filter(text => text.length).join('\n\n');
      if (remaining.length) message.tool_calls = remaining;
      else delete message.tool_calls;
    },
  };
}
