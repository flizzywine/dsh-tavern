// Only preset source is parsed. Substituted material is opaque, never re-parsed.
const VARIABLES = ['setvar', 'setglobalvar', 'addvar', 'addglobalvar', 'incvar', 'decvar', 'incglobalvar', 'decglobalvar', 'getvar', 'getglobalvar'];
const BUILTINS = new Set(['user', 'char', 'newline', 'trim', 'noop', 'lastusermessage', 'lastcharmessage', 'lastmessage', 'lastmessageid', 'random', 'roll', ...VARIABLES]);
export function createMacroEnvironment({ userName = '你', charName = '', history = [], input = '', random = Math.random, dynamicMacros = {} } = {}) {
  const chat = [...history.map(row => ({ role: row.role, text: row.text })), { role: 'user', text: input }];
  return { userName, charName, random, chat, dynamicMacros, local: Object.create(null), global: Object.create(null) };
}
// Pair optional bare setters backwards: a legacy {{setvar name}} with no
// matching closing tag is still an ordinary single macro.
function groupBlocks(parts, depth) {
  const setters = new Set();
  let closings = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const raw = parts[i].raw;
    if (!raw) continue;
    if (/^\{\{\s*\/setvar\s*\}\}$/i.test(raw)) closings++;
    else if (closings && /^\{\{\s*#?setvar(?:\s+|::)[^:{}]+\}\}$/i.test(raw)) {
      setters.add(parts[i]); closings--;
    }
  }
  const root = [], stack = [];
  let current = root;
  for (const part of parts) {
    const name = typeof part === 'string' ? '' : nameOf(part);
    if (name === 'if' || name === '#if' || name === '#setvar' || setters.has(part)) {
      if (stack.length + depth >= 32) throw new Error('宏嵌套超过 32 层');
      const block = { ...part, block: name.replace(/^#/, ''), body: [], preserveWhitespace: name.startsWith('#') };
      current.push(block);
      stack.push({ block, parent: current });
      current = block.body;
    } else if (name === 'else' || name === '/if' || name === '/setvar') {
      const frame = stack.at(-1);
      if (!frame || !/^\{\{\s*(?:else|\/(?:if|setvar))\s*\}\}$/i.test(part.raw)
          || (name === 'else' ? frame.block.block !== 'if' || frame.block.otherwise : frame.block.block !== name.slice(1))) {
        throw new Error('宏块标记不匹配：' + part.raw);
      }
      if (name === 'else') current = frame.block.otherwise = [];
      else { current = frame.parent; stack.pop(); }
    } else current.push(part);
  }
  if (stack.length) throw new Error('宏块未闭合：' + stack.at(-1).block.raw);
  return root;
}
function parse(value) {
  const source = String(value ?? '');
  const scopedSyntax = /\{\{\s*(?:#?if\b|#setvar\b|\/(?:setvar|if)\b|else\s*\}\})/i.test(source);
  const text = scopedSyntax ? source : source.replace(/(?:\r?\n)*\{\{\s*trim\s*\}\}(?:\r?\n)*/gi, '');
  const finish = (parts, depth) => scopedSyntax ? groupBlocks(parts, depth) : parts;
  let offset = 0, count = 0;
  function scan(nested = false, depth = 0) {
    if (depth > 32) throw new Error('宏嵌套超过 32 层');
    const parts = [];
    while (offset < text.length) {
      if (nested && text.startsWith('}}', offset)) { offset += 2; return finish(parts, depth); }
      if (text.startsWith('{{', offset)) {
        if (++count > 10000) throw new Error('宏数量超过上限');
        const start = offset; offset += 2;
        if (/^\s*\/\//.test(text.slice(offset))) {
          const end = text.indexOf('}}', offset);
          if (end < 0) throw new Error('预设宏未闭合');
          offset = end + 2; continue;
        }
        const children = scan(true, depth + 1);
        parts.push({ children, raw: text.slice(start, offset) });
      } else {
        const start = offset++;
        while (offset < text.length && !text.startsWith('{{', offset) && !(nested && text.startsWith('}}', offset))) offset++;
        parts.push(text.slice(start, offset));
      }
    }
    if (nested) throw new Error('预设宏未闭合');
    return finish(parts, depth);
  }
  return scan();
}
function nameOf(node) { return String(node.children[0] ?? '').trim().split(/::|\s+/)[0].toLowerCase(); }
function hasBlocks(parts) { return parts.some(part => typeof part !== 'string' && (part.block || hasBlocks(part.children))); }
export function inspectMacros(value, { dynamicMacros = {} } = {}) {
  const unknown = new Set(), requiredUnknown = new Set(), names = new Set();
  function visit(parts, conditional = false) {
    for (const part of parts) if (typeof part !== 'string') {
      const name = nameOf(part); names.add(name);
      if (!part.block && !BUILTINS.has(name) && !Object.hasOwn(dynamicMacros, name)) {
        unknown.add(part.raw);
        if (!conditional) requiredUnknown.add(part.raw);
      }
      visit(part.children, conditional);
      if (part.body) visit(part.body, conditional || part.block === 'if');
      if (part.otherwise) visit(part.otherwise, true);
    }
  }
  try { visit(parse(value)); return { unknown: [...unknown], requiredUnknown: [...requiredUnknown], names: [...names] }; }
  catch (error) { return { unknown: [], requiredUnknown: [], names: [], error: error.message }; }
}
function choose(env, count) { return Math.min(count - 1, Math.max(0, Math.floor(env.random() * count))); }
// Apply only trim tokens that came from the template. A literal "{{trim}}"
// inside frozen input must survive, including when read back from a variable.
function resolveScopedTrims(pieces) {
  if (!pieces.some(piece => piece.trim)) return pieces;
  const result = [];
  let trimNext = false;
  for (const piece of pieces) {
    if (piece.trim) {
      while (result.length && !result.at(-1).captured) {
        const last = result.pop(), text = last.text.replace(/(?:\r?\n)+$/, '');
        if (text) { result.push({ ...last, text }); break; }
      }
      trimNext = true;
    } else {
      const text = trimNext && !piece.captured ? piece.text.replace(/^(?:\r?\n)+/, '') : piece.text;
      if (text) { result.push(text === piece.text ? piece : { ...piece, text }); trimNext = false; }
    }
  }
  return result;
}
// Preserve provenance separately from variable values. Helpers still receive
// ordinary local/global strings, while native set/add/get chains retain which
// fragments came from captured identities or chat rather than preset syntax.
const variableOrigins = new WeakMap();
export function renderMacros(value, env, { allowScript = false, opaque = value => value } = {}) {
  let parts = parse(value);
  const scoped = hasBlocks(parts);
  let origins = variableOrigins.get(env);
  if (!origins) { origins = { local: new Map(), global: new Map() }; variableOrigins.set(env, origins); }
  const fragment = (text, captured = false) => {
    const value = String(text ?? '');
    return value ? [{ text: value, captured }] : [];
  };
  const textOf = pieces => pieces.map(piece => piece.text).join('');
  const slice = (pieces, start, end = Infinity) => {
    const result = []; let offset = 0;
    for (const piece of pieces) {
      const from = Math.max(0, start - offset), to = Math.min(piece.text.length, end - offset);
      if (from < to) result.push({ ...piece, text: piece.text.slice(from, to) });
      offset += piece.text.length;
    }
    return result;
  };
  const stored = (scope, key) => {
    const value = env[scope][key], entry = origins[scope].get(key);
    return entry && Object.is(entry.value, value) ? entry.pieces : fragment(value ?? '');
  };
  const assign = (scope, key, value, pieces = fragment(value)) => {
    env[scope][key] = value; origins[scope].set(key, { value, pieces });
  };
  function scopedBody(parts, preserveWhitespace) {
    let pieces = resolveScopedTrims(parts.flatMap(evaluate));
    if (preserveWhitespace) return pieces;
    // Bare scoped macros dedent relative to the first nonempty line. Keep the
    // origin of every fragment across whitespace removal and variable storage.
    const first = textOf(pieces).split('\n').find(line => line.trim());
    const indent = first?.match(/^[ \t]*/)[0].length ?? 0;
    if (indent) {
      let remaining = indent;
      pieces = pieces.map(piece => {
        const lines = piece.text.split('\n').map((line, index) => {
          if (index) remaining = indent;
          if (!remaining) return line;
          const removed = Math.min(remaining, line.match(/^[ \t]*/)[0].length);
          remaining = line.length === removed ? remaining - removed : 0;
          return line.slice(removed);
        });
        return { ...piece, text: lines.join('\n') };
      });
    }
    const text = textOf(pieces);
    return slice(pieces, text.length - text.trimStart().length, text.trimEnd().length);
  }
  function evaluate(part) {
    if (typeof part === 'string') return fragment(part);
    if (part.pieces) return part.pieces;
    const name = nameOf(part);
    if (scoped && name === 'trim') return [{ text: '{{trim}}', trim: true }];
    if (part.block) {
      const [head, ...nested] = part.children;
      const argument = head.replace(/^\s*#?(?:setvar|if)\b(?:\s*::)?\s*/i, '');
      if (!argument && !nested.length) throw new Error('宏块缺少参数：' + part.raw);
      const pieces = [argument, ...nested].flatMap(evaluate);
      if (pieces.some(piece => piece.pending)) throw new Error('宏块参数含待助手处理的宏：' + part.raw);
      const arg = textOf(pieces).trim();
      if (part.block === 'setvar') {
        if (!arg) throw new Error('变量宏缺少变量名：' + name);
        const body = scopedBody(part.body, part.preserveWhitespace);
        assign('local', arg, textOf(body), body);
        return [];
      }
      const inverted = argument.trimStart().startsWith('!');
      const condition = inverted ? arg.slice(1).trimStart() : arg;
      const truthy = !['', 'false', 'off', '0'].includes(condition.toLowerCase());
      return scopedBody(truthy !== inverted ? part.body : part.otherwise || [], part.preserveWhitespace);
    }
    if (Object.hasOwn(env.dynamicMacros ?? {}, name)) {
      if (part.raw.slice(2, -2).trim().toLowerCase() !== name) throw new Error('动态宏不接受参数：' + name);
      const value = env.dynamicMacros[name];
      return fragment(typeof value === 'function' ? value() : value, true);
    }
    if (allowScript && !BUILTINS.has(name)) return [{ text: part.raw, captured: false, pending: true }];
    if (!BUILTINS.has(name)) throw new Error('预设含尚不支持的宏：' + part.raw.slice(2, -2));
    const innerPieces = part.children.flatMap(evaluate), inner = textOf(innerPieces);
    const delimiter = inner.indexOf('::');
    let start = delimiter >= 0 ? delimiter + 2 : inner.length - inner.trimStart().length + name.length;
    let end = inner.length;
    if (delimiter < 0) { while (/\s/.test(inner[start] || '') && start < end) start++; while (end > start && /\s/.test(inner[end - 1])) end--; }
    const argsPieces = slice(innerPieces, start, end), args = textOf(argsPieces);
    if (VARIABLES.includes(name)) {
      const split = args.indexOf('::'), key = (split < 0 ? args : args.slice(0, split)).trim();
      if (!key) throw new Error('变量宏缺少变量名：' + name);
      const argPieces = split < 0 ? [] : slice(argsPieces, split + 2), arg = textOf(argPieces);
      const scope = name.includes('global') ? 'global' : 'local', store = env[scope];
      if (name.startsWith('set')) { assign(scope, key, arg, argPieces); return []; }
      if (name.startsWith('get')) return stored(scope, key);
      if (name.startsWith('inc') || name.startsWith('dec')) {
        assign(scope, key, (Number(store[key]) || 0) + (name.startsWith('inc') ? 1 : -1)); return fragment(store[key]);
      }
      const current = store[key] ?? '', left = Number(current), right = Number(arg);
      if (current !== '' && Number.isFinite(left) && Number.isFinite(right)) assign(scope, key, left + right);
      else assign(scope, key, String(current) + arg, [...stored(scope, key), ...argPieces]);
      return [];
    }
    if (name === 'random') {
      const choices = args.split('::'), selected = choose(env, choices.length);
      const offset = choices.slice(0, selected).reduce((total, choice) => total + choice.length + 2, 0);
      return slice(argsPieces, offset, offset + choices[selected].length);
    }
    if (name === 'roll') {
      const match = args.match(/^(\d+)(?:d(\d+))?$/i);
      if (!match) throw new Error('roll 的范围不受支持');
      const n = Number(match[2] ? match[1] : 1), sides = Number(match[2] || match[1]);
      if (n < 1 || n > 100 || sides < 1 || sides > 1e9) throw new Error('roll 的范围不受支持');
      return fragment(Array.from({ length: n }, () => choose(env, sides) + 1).reduce((a, b) => a + b, 0));
    }
    const chat = env.chat || [];
    const result = ({ user: env.userName, char: env.charName, newline: '\n', trim: '', noop: '',
      lastusermessage: chat.findLast(row => row.role === 'user')?.text ?? '',
      lastcharmessage: chat.findLast(row => row.role === 'assistant')?.text ?? '',
      lastmessage: chat.at(-1)?.text ?? '', lastmessageid: chat.length ? String(chat.length - 1) : '',
    })[name];
    return fragment(result, ['user', 'char', 'lastusermessage', 'lastcharmessage', 'lastmessage'].includes(name));
  }
  // Scoped templates require source order and lazy branches. Unscoped templates
  // retain legacy per-variable-class ordering, including reads before setters.
  if (!scoped) {
    for (const name of VARIABLES) parts = parts.map(part => typeof part !== 'string' && !part.pieces && nameOf(part) === name ? { pieces: evaluate(part) } : part);
  }
  return resolveScopedTrims(parts.flatMap(evaluate)).map(piece => piece.captured ? opaque(piece.text) : piece.text).join('');
}
