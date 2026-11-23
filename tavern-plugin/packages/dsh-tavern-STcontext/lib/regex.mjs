export function parseRegex(value) {
  if (typeof value !== 'string' || !value) throw new Error('正则表达式不能为空');
  if (!value.startsWith('/')) return new RegExp(value);
  const end = value.lastIndexOf('/');
  if (end <= 0) return new RegExp(value);
  return new RegExp(value.slice(1, end), value.slice(end + 1));
}
export function nativeRegexes(document) {
  const source = document?.extensions?.regex_scripts;
  if (source === undefined) return [];
  if (!Array.isArray(source)) throw new Error('extensions.regex_scripts 必须是数组');
  return source;
}
export function regexProblem(rule) {
  if (rule.placement !== undefined && !Array.isArray(rule.placement)) return { field: 'placement', message: 'placement 必须是数组' };
  if (rule.trimStrings !== undefined && !Array.isArray(rule.trimStrings)) return { field: 'trimStrings', message: 'trimStrings 必须是数组' };
  if (rule.substituteRegex !== undefined && Number(rule.substituteRegex) !== 0) return { field: 'substituteRegex', message: '尚不支持查找正则中的宏替换模式' };
  try { parseRegex(rule.findRegex); }
  catch (error) { return { field: 'findRegex', message: '查找表达式无效：' + error.message }; }
  return null;
}
// The host saves two independent layers at depth zero. Send just the current
// display projection, leaving future depth-dependent prompts to the compiler.
export function displayRegexes(document) {
  return nativeRegexes(document).filter(rule => regexEnabled(rule, { placement: 2, depth: 0, channel: 'display' }) && !regexProblem(rule))
    .map(rule => ({ ...rule, placement: [2], replaceString: String(rule.replaceString ?? ''), markdownOnly: true, promptOnly: false,
      minDepth: null, maxDepth: null }));
}
function depthValue(value) { return value === null || value === undefined || value === '' ? null : Number(value); }
export function regexEnabled(script, { placement = 2, depth, channel = 'write', isEdit = false } = {}) {
  if (!script || script.disabled === true || script.enabled === false) return false;
  if (!Array.isArray(script.placement) || !script.placement.map(Number).includes(placement)) return false;
  const applies = channel === 'display' ? script.markdownOnly === true : channel === 'prompt'
    ? script.promptOnly === true : !script.markdownOnly && !script.promptOnly;
  if (!applies || (isEdit && !script.runOnEdit)) return false;
  // ST writes a newly received message without a depth. Rendering and sending
  // both supply their own depth from the current visible chat.
  if (typeof depth !== 'number') return true;
  const min = depthValue(script.minDepth), max = depthValue(script.maxDepth);
  return !(min !== null && min >= -1 && depth < min) && !(max !== null && max >= 0 && depth > max);
}
function replacement(script) {
  const trims = (script.trimStrings || []).map(String);
  return (...args) => {
    const named = typeof args.at(-1) === 'object' ? args.at(-1) : null;
    const captured = index => {
      // Exclude String.replace's offset and source arguments.
      const count = args.length - (named ? 3 : 2);
      let value = Number(index) < count ? String(args[Number(index)] ?? '') : '';
      for (const trim of trims) if (trim) value = value.split(trim).join('');
      return value;
    };
    return String(script.replaceString ?? '').replace(/\{\{match\}\}/gi, '$0')
      .replace(/\$(\d+)|\$<([^>]+)>/g, (_token, number, name) => {
        if (number !== undefined) return captured(number);
        let value = String(named?.[name] ?? '');
        for (const trim of trims) if (trim) value = value.split(trim).join('');
        return value;
      });
  };
}
export function applyRegexOnce(text, scripts, options = {}) {
  const applied = [];
  let result = String(text ?? '');
  for (const [index, script] of scripts.entries()) {
    if (!result || !regexEnabled(script, options)) continue;
    if (options.channel === 'display' && regexProblem(script)) continue;
    let count = 0;
    const replace = replacement(script);
    result = result.replace(parseRegex(script.findRegex), (...args) => { count++; return replace(...args); });
    if (count) applied.push({ index, id: String(script.id || ''), name: String(script.scriptName || script.name || index), matches: count });
  }
  return { text: result, applied };
}
