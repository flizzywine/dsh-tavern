import { parsePreset } from './preset.mjs';
import { nativeRegexes, parseRegex } from './regex.mjs';

// Editing is lossless for unknown fields. Validate structure, without executing
// extensions or requiring a preset with compatibility blockers to be runnable.
export function parseEditedPreset(source) {
  const doc = parsePreset(source);
  for (const [index, rule] of nativeRegexes(doc).entries()) {
    if (rule.disabled === true || rule.enabled === false || (rule.markdownOnly === true && rule.promptOnly !== true)) continue;
    try { parseRegex(rule.findRegex); }
    catch (error) { throw new Error('extensions.regex_scripts[' + index + '].findRegex 无效：' + error.message); }
  }
  const ids = new Set(doc.prompts.map(item => item.identifier));
  for (const group of doc.prompt_order) {
    if (!group || !Array.isArray(group.order)) throw new Error('预设顺序不是数组');
    const seen = new Set();
    for (const entry of group.order) {
      if (!entry || !ids.has(entry.identifier)) throw new Error('顺序引用了不存在的提示词');
      if (seen.has(entry.identifier)) throw new Error('同一提示词在顺序中重复出现');
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') throw new Error('提示词启用状态无效');
      seen.add(entry.identifier);
    }
  }
  const number = (value, name, { min = 0, max = Infinity, integer = false } = {}) => {
    if (value === undefined) return;
    // Some ST exports store numeric controls as strings. Preserve those values.
    const n = Number(value);
    if (value === null || value === '' || !['number', 'string'].includes(typeof value)
      || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isSafeInteger(n))) throw new Error(name + ' 无效');
  };
  for (const prompt of doc.prompts) {
    number(prompt.injection_position, '提示词注入位置', { max: 1, integer: true });
    number(prompt.injection_depth, '提示词注入深度', { integer: true });
    number(prompt.injection_order, '提示词注入顺序', { min: Number.MIN_SAFE_INTEGER, integer: true });
    if (prompt.injection_trigger?.some(value => typeof value !== 'string')) throw new Error('提示词触发类型必须是字符串');
  }
  number(doc.temperature, '温度', { max: 2 });
  for (const key of ['openai_max_tokens', 'max_tokens']) number(doc[key], '输出 token 上限', { min: 1, integer: true });
  return doc;
}
