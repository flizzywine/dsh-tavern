import { parse } from './vendor/parser.mjs';

export const MAX_SCRIPT_BYTES = 256 * 1024;
const unavailable = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'window', 'document', 'parent', 'SillyTavern', 'TavernHelper', 'process', 'require', 'Deno', 'Bun', 'setTimeout', 'setInterval']);
export function scriptExpression(source, kind = 'function') {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_SCRIPT_BYTES) throw new Error('脚本必须是非空文本，且不超过 256 KiB');
  const expression = kind === 'body' ? '(function () {\n' + source + '\n})' : '(' + source.trim().replace(/;\s*$/, '') + '\n)';
  const tree = parse(expression, { ecmaVersion: 2024, sourceType: 'script' });
  const node = tree.body[0]?.expression;
  if (tree.body.length !== 1 || !['FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type) || node.generator) throw new Error('处理脚本必须是函数或箭头函数');
  return { expression, node };
}
export function inspectScript(source, kind) {
  try {
    const { node } = scriptExpression(source, kind), capabilities = new Set(), protocols = new Set();
    const stack = [node];
    while (stack.length) {
      const current = stack.pop();
      if (current.type === 'ImportExpression') capabilities.add('import');
      if (current.type === 'Identifier' && unavailable.has(current.name)) capabilities.add(current.name);
      const key = current.type === 'Property' ? (current.computed ? current.key.value : current.key.name ?? current.key.value)
        : current.type === 'MemberExpression' ? (current.computed ? current.property.value : current.property.name) : null;
      if (['tool_calls', 'tool_call_id', 'thoughtSignature', 'signature', 'extra_content', 'toolConfig', 'custom_include_body'].includes(key)) protocols.add(key);
      if (current.type === 'AssignmentExpression' && current.left.type === 'MemberExpression'
        && (current.left.property.name || current.left.property.value) === 'tool_choice'
        && current.right.type === 'Literal' && !['auto', 'none'].includes(current.right.value)) protocols.add('tool_choice=' + current.right.value);
      for (const value of Object.values(current)) {
        if (Array.isArray(value)) { for (const child of value) if (child?.type) stack.push(child); }
        else if (value?.type) stack.push(value);
      }
    }
    return { capabilities: [...capabilities], protocols: [...protocols] };
  } catch (error) { return { error: error.message, capabilities: [], protocols: [] }; }
}
