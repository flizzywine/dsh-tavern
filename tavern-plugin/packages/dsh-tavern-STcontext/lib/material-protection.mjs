import { randomBytes } from 'node:crypto';

const fields = wire => [
  ...(wire.messages || []).flatMap((message, index) => typeof message.content === 'string' ? [{ key: 'message:' + index, owner: message, property: 'content' }] : []),
  ...(wire.tools || []).flatMap((tool, index) => typeof tool.function?.description === 'string' ? [{ key: 'tool:' + index, owner: tool.function, property: 'description' }] : []),
];

// Keep provenance while it is known, before messages lose their source fields.
// Hooks may read and edit prose. Literal macro/EJS expressions in captured
// material stay opaque to template stages, even after messages are combined.
export function createMaterialProtection(literalTags) {
  const prefix = 'STCONTEXT_MATERIAL_' + randomBytes(12).toString('hex') + '_';
  const tokens = new Map(), textTokens = new Map(), literalFields = new Set();
  const literalToken = text => {
    if (!text) return text;
    if (textTokens.has(text)) return textTokens.get(text);
    const token = prefix + tokens.size + '_END';
    tokens.set(token, text); textTokens.set(text, token); return token;
  };
  const tokenFor = text => {
    let masked = text.replace(/\{\{[\s\S]*?(?:\}\}|$)|<%[\s\S]*?(?:%>|$)/g, literalToken);
    if (literalTags) masked = masked.replace(literalTags, literalToken);
    if (masked !== text) literalFields.add(masked);
    return masked;
  };
  const pattern = () => new RegExp(prefix + '\\d+_END', 'g');
  const restoreText = text => text.replace(pattern(), token => tokens.get(token) ?? token);
  function restoreEncodedText(text) {
    if (!text.includes(prefix)) return text;
    const replacements = [];
    function collect(value, level) {
      if (!value.includes(prefix)) return;
      // Distinguish an original JSON-looking chat message from containers a
      // request hook added with JSON.stringify (possibly more than once).
      if (!literalFields.has(value) && /^\s*[\[{"]/.test(value)) {
        let encoded = false;
        try { JSON.parse(value); encoded = true; } catch { /* ordinary prose */ }
        if (encoded) {
          if (level === 32) throw new Error('材料嵌套 JSON 超过 32 层');
          for (const [quoted] of value.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)) {
            if (quoted.includes(prefix)) collect(JSON.parse(quoted), level + 1);
          }
          return;
        }
      }
      for (const [token] of value.matchAll(pattern())) {
        let replacement = tokens.get(token) ?? token;
        for (let i = 0; i < level; i++) {
          replacement = JSON.stringify(replacement).slice(1, -1);
          if (replacement.length > 8 * 1024 * 1024) throw new Error('转义后材料超过最终请求容量');
        }
        replacements.push(replacement);
      }
    }
    collect(text, 0);
    let index = 0;
    // Replace only the placeholders. Whitespace and existing escape spellings
    // elsewhere in the serialized payload are part of the authored request.
    return text.replace(pattern(), token => replacements[index++] ?? token);
  }
  const protectMessages = messages => messages.map(message => {
    if (message.source === 'preset' || !message.content) return { ...message };
    return { ...message, content: tokenFor(message.content) };
  });
  const restore = wire => {
    const result = structuredClone(wire);
    for (const { owner, property } of fields(result)) owner[property] = restoreEncodedText(owner[property]);
    for (const message of result.messages || []) {
      for (const call of message.tool_calls || []) {
        const fn = call?.function;
        if (typeof fn?.arguments === 'string') fn.arguments = restoreEncodedText(fn.arguments);
      }
    }
    if (JSON.stringify(result).includes(prefix)) throw new Error('助手将冻结材料移动到不支持的字段，未发送请求');
    return result;
  };

  function remap(previous, next) {
    const before = fields(previous), result = structuredClone(next), after = fields(result);
    const used = new Set(before.flatMap(({ owner, property }) => owner[property].match(pattern()) || []));
    if (!used.size) return result;
    const anchors = new Map();
    const add = (raw, protectedText) => {
      if (!raw) return;
      const values = anchors.get(raw) || new Set(); values.add(protectedText); anchors.set(raw, values);
    };
    // Whole fields also include templates: reserve those spans before trying
    // shorter material fragments, so history "c" cannot mask {{custom}}.
    for (const { owner, property } of before) {
      add(restoreText(owner[property]), owner[property]);
      // A changed surrounding template can no longer anchor its whole field.
      // Reserve its still-unexpanded macro independently from short material.
      for (const match of owner[property].matchAll(/\{\{[\s\S]*?\}\}/g)) add(match[0], match[0]);
    }
    for (const token of used) add(tokens.get(token), token);
    // A raw hook can introduce a new template, not just edit an existing one.
    // Give its complete macro span precedence over shorter captured text. If
    // that macro also occurs in captured material, prefer its literal meaning
    // for an ambiguous rewritten span. Unchanged fields retain exact provenance.
    for (const { owner, property } of after) {
      for (const match of owner[property].matchAll(/\{\{[\s\S]*?\}\}/g)) add(match[0], match[0]);
    }
    const ordered = [...anchors].sort((a, b) => b[0].length - a[0].length);
    const originals = new Map(before.map(field => [field.key, field]));
    for (const { key, owner, property } of after) {
      const text = owner[property], original = originals.get(key);
      const metadata = (owner, property) => JSON.stringify({ ...owner, [property]: undefined });
      if (original && restoreText(original.owner[original.property]) === text
        && metadata(original.owner, original.property) === metadata(owner, property)) {
        owner[property] = original.owner[original.property]; continue;
      }
      let parts = [{ text }];
      for (const [raw, replacements] of ordered) {
        parts = parts.flatMap(part => {
          if (part.protected !== undefined) return [part];
          const pieces = part.text.split(raw);
          if (pieces.length === 1) return [part];
          const protectedText = replacements.size === 1 ? replacements.values().next().value : tokenFor(raw);
          return pieces.flatMap((piece, index) => index ? [{ protected: protectedText }, { text: piece }] : [{ text: piece }]);
        });
      }
      owner[property] = parts.map(part => part.protected ?? part.text).join('');
    }
    return result;
  }
  const remapText = (previous, next) => remap({ messages: [{ content: previous }] }, { messages: [{ content: next }] }).messages[0].content;
  return { protectMessages, tokenFor, restore, restoreText, remap, remapText };
}
