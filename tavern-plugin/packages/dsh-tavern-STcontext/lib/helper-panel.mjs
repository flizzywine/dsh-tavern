const interaction = new Set(['click', 'dblclick', 'change', 'input', 'submit', 'pointerdown', 'pointerup', 'pointermove', 'keydown', 'keyup', 'focus', 'blur']);
const tags = /^(button|div|span|section|p|input|label|select|option|textarea|header|footer|aside|strong|small|ul|li)$/i;
const fields = new Set(['id', 'className', 'textContent', 'title', 'value']);
const globals = new Set(['document', '$', 'eventOn', 'eventSource', 'getButtonEvent', 'tavern_events', 'event_types', 'SillyTavern', 'String']);
const observers = new Map([['chat_completion_settings_ready', 'request'], ['chat_completion_prompt_ready', 'prompt']]);
const scalar = { kind: 'scalar' }, nothing = { kind: 'undefined' }, element = { kind: 'element' };
const scope = parent => ({ parent, bindings: new Map() });
const closure = (node, env) => ({ kind: 'function', node, env });

export function analyzePanel(tree, { standalone = false } = {}) {
  let budget = 24000, ui = false, stats = false;
  const active = new Set();
  const unknown = (message, node) => { throw new Error(message + (node ? '（源码偏移 ' + node.start + '）' : '')); };
  const step = () => { if (--budget < 0) unknown('静态分析达到工作量上限'); };
  function lookup(node, env) {
    for (let current = env; current; current = current.parent) {
      if (!current.bindings.has(node.name)) continue;
      return current.bindings.get(node.name) ?? unknown('引用尚未初始化的绑定', node);
    }
    if (globals.has(node.name)) return { kind: node.name };
    unknown('无法确定标识符 ' + node.name.slice(0, 64) + ' 的影响', node);
  }
  function invoke(fn, args) {
    if (fn?.kind !== 'function' || fn.node.generator) unknown('无法追踪回调');
    const { node } = fn;
    if (active.has(node) || active.size >= 48) unknown('调用链递归或过深', node);
    if (node.type === 'FunctionExpression' && node.id) unknown('具名函数表达式', node);
    active.add(node);
    const local = scope(fn.env);
    if (node.type !== 'ArrowFunctionExpression') local.bindings.set('arguments', null);
    node.params.forEach((param, index) => {
      if (param.type !== 'Identifier') unknown('动态参数绑定', param);
      local.bindings.set(param.name, args[index] ?? nothing);
    });
    const result = node.body.type === 'BlockStatement' ? block(node.body.body, local) : expr(node.body, local);
    active.delete(node);
    if (node.async) {
      if (!['scalar', 'undefined'].includes(result.kind)) unknown('未确认的异步返回值', node);
      return { kind: 'promise', result };
    }
    return result;
  }
  function member(object, key, node) {
    if (object.kind === 'document' && key === 'body') return element;
    if (object.kind === 'context' && key === 'eventSource') return { kind: 'eventSource' };
    if (object.kind === 'context' && ['eventTypes', 'event_types'].includes(key)) return { kind: 'tavern_events' };
    if (['tavern_events', 'event_types'].includes(object.kind) && observers.has(key.toLowerCase()) && key === key.toUpperCase()) {
      return { kind: 'event', payload: observers.get(key.toLowerCase()) };
    }
    if (object.kind === 'request' && key === 'messages' || object.kind === 'prompt' && key === 'chat') return { kind: 'messages' };
    if (object.kind === 'message' && ['content', 'role'].includes(key)) return scalar;
    if (['messages', 'scalar'].includes(object.kind) && key === 'length') return scalar;
    unknown('未确认的属性读取 ' + key.slice(0, 64), node);
  }
  function call(node, env) {
    const target = node.callee;
    const method = target.type === 'MemberExpression' && !target.computed ? target.property.name : null;
    const receiver = expr(method !== null ? target.object : target, env);
    const args = node.arguments.map(arg => expr(arg, env));
    const [first, second] = args;
    const key = first?.value, count = args.length;
    if (method === null) {
      if (receiver.kind === 'function') return invoke(receiver, args);
      if (receiver.kind === 'String' && count === 1 && first.kind === 'scalar') return scalar;
      if (receiver.kind === '$' && count === 1) {
        if (first.kind === 'function') { invoke(first, []); return nothing; }
        if (first.kind === 'document') return { kind: 'jquery-document' };
        if (typeof key === 'string' && !key.trimStart().startsWith('<')) return { kind: 'jquery' };
      }
      if (receiver.kind === 'getButtonEvent' && count === 1 && typeof key === 'string') return { kind: 'button-event' };
    }
    if (receiver.kind === 'SillyTavern' && method === 'getContext' && count === 0) return { kind: 'context' };
    if ((receiver.kind === 'eventOn' && method === null || receiver.kind === 'eventSource' &&
      ['on', 'once', 'makeFirst', 'makeLast'].includes(method)) && count === 2 && second.kind === 'function') {
      if (first.kind === 'button-event') { ui = true; return nothing; }
      const payload = first.kind === 'event' ? first.payload : observers.get(key);
      if (payload) { invoke(second, [{ kind: payload }]); stats = true; return nothing; }
    }
    if (receiver.kind === 'document' && count === 1 && typeof key === 'string' &&
      (method === 'createElement' && tags.test(key) || ['getElementById', 'querySelector'].includes(method))) {
      ui = true; return element;
    }
    if (receiver.kind === 'document' && method === 'addEventListener' && count === 2 && key === 'DOMContentLoaded') {
      invoke(second, []); return nothing;
    }
    if (receiver.kind === 'jquery-document' && method === 'ready' && count === 1) {
      invoke(first, []); return receiver;
    }
    if (receiver.kind === 'jquery' && method === 'text' && count === 1 && first.kind === 'scalar') {
      ui = true; return receiver;
    }
    if ((receiver.kind === 'element' && method === 'addEventListener' || receiver.kind === 'jquery' && method === 'on') &&
      count === 2 && interaction.has(key) && second.kind === 'function') {
      ui = true; return receiver.kind === 'jquery' ? receiver : nothing;
    }
    if (receiver.kind === 'element' && ['appendChild', 'append', 'prepend'].includes(method) &&
      (method !== 'appendChild' || count === 1 && first.kind === 'element') &&
      args.every(arg => ['element', 'scalar'].includes(arg.kind))) {
      ui = true; return method === 'appendChild' ? first : nothing;
    }
    if (receiver.kind === 'messages' && method === 'reduce' && count === 2 && second.kind === 'scalar' &&
      invoke(first, [scalar, { kind: 'message' }, scalar, receiver]).kind === 'scalar') return scalar;
    unknown('无法证明调用仅影响面板', node);
  }
  function expr(node, env) {
    step();
    switch (node.type) {
      case 'Literal':
        if (!node.regex && node.bigint === undefined) return { kind: 'scalar', value: node.value };
        break;
      case 'Identifier': return lookup(node, env);
      case 'ArrowFunctionExpression': case 'FunctionExpression': return closure(node, env);
      case 'ChainExpression': return expr(node.expression, env);
      case 'CallExpression': return call(node, env);
      case 'AwaitExpression': {
        const value = expr(node.argument, env);
        if (value.kind === 'promise') return value.result;
        if (['scalar', 'undefined'].includes(value.kind)) return value;
        break;
      }
      case 'MemberExpression':
        if (!node.computed) return member(expr(node.object, env), node.property.name, node);
        break;
      case 'TemplateLiteral':
        if (node.expressions.every(part => expr(part, env).kind === 'scalar')) return scalar;
        break;
      case 'BinaryExpression':
        if (['+', '-', '*', '/', '===', '!==', '<', '>'].includes(node.operator) &&
          expr(node.left, env).kind === 'scalar' && expr(node.right, env).kind === 'scalar') return scalar;
        break;
      case 'AssignmentExpression': {
        const left = node.left;
        if (node.operator === '=' && left.type === 'MemberExpression' && !left.computed && fields.has(left.property.name) &&
          expr(left.object, env).kind === 'element') {
          const right = expr(node.right, env);
          if (right.kind === 'scalar') { ui = true; return right; }
        }
        return unknown('存在非面板字段或共享状态的写入', node);
      }
    }
    unknown('未确认的表达式 ' + node.type, node);
  }
  function block(statements, parent, program = false, nested = false) {
    const env = scope(parent);
    const scopedFunctions = !nested && (!program || standalone || statements[0]?.directive === 'use strict');
    for (const st of statements) {
      step();
      if (st.type === 'FunctionDeclaration') {
        if (!scopedFunctions) unknown('非严格模式的顶层函数可能被其他脚本使用', st);
        env.bindings.set(st.id.name, closure(st, env));
      }
      if (st.type === 'VariableDeclaration') {
        if (st.kind === 'var') unknown('未确认的 var 作用域', st);
        for (const decl of st.declarations) {
          if (decl.id.type !== 'Identifier') unknown('动态解构', decl);
          env.bindings.set(decl.id.name, null);
        }
      }
    }
    for (const st of statements) {
      switch (st.type) {
        case 'EmptyStatement': case 'FunctionDeclaration': break;
        case 'VariableDeclaration':
          for (const decl of st.declarations) env.bindings.set(decl.id.name, decl.init ? expr(decl.init, env) : nothing);
          break;
        case 'ExpressionStatement': expr(st.expression, env); break;
        case 'ReturnStatement':
          if (nested || st !== statements.at(-1)) unknown('提前返回的控制流', st);
          return st.argument ? expr(st.argument, env) : nothing;
        case 'BlockStatement': block(st.body, env, false, true); break;
        case 'IfStatement':
          expr(st.test, env);
          for (const branch of [st.consequent, st.alternate]) if (branch) {
            block(branch.type === 'BlockStatement' ? branch.body : [branch], env, false, true);
          }
          break;
        default: unknown('未确认的语句 ' + st.type, st);
      }
    }
    return nothing;
  }
  try {
    block(tree.body, null, true);
    if (ui) return { uiOnly: true, reason: stats ? '生成回调只读取消息统计并更新界面' : '初始化仅操作界面或绑定交互回调' };
    return { uiOnly: false, reason: '无可确认的面板操作' };
  } catch (error) {
    return { uiOnly: false, reason: error instanceof RangeError ? '静态分析嵌套过深' : error.message };
  }
}
