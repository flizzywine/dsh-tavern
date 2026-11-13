// Live streaming preview for `submit_story` tool calls in `@deepseek-ai/dsh-client-ui-chat`.
// Keep `patchToolReplyStreamChatSource` completely self-contained so `chat-answer-boot-patch.js`
// can embed `patchToolReplyStreamChatSource.toString()` in read-only desktop `app.asar` builds.
export const CHAT_TOOL_REPLY_STREAM_MARKER = '/* dsh-tavern:tool-reply-stream */'

export function patchToolReplyStreamChatSource(text) {
  const MARKER = '/* dsh-tavern:tool-reply-stream */'
  if (typeof text !== 'string') return { status: 'unmatched', text: String(text ?? '') }
  if (text.includes(MARKER)) return { status: 'patched', text }

  const compactRe = /function\s+compactBlocks\s*\(\s*blocks\s*\)\s*\{\s*return\s+blocks\.filter\(\(block\)\s*=>\s*block\s*!==\s*void\s*0\);\s*\}/
  const compactMatch = compactRe.exec(text)
  if (!compactMatch) return { status: 'unmatched', text }

  const helpers = [
    MARKER,
    'function tavernParseSubmitStoryArgs(raw) {',
    '  if (typeof raw !== "string" || raw === "") return { think: "", content: "" };',
    '  var state = 0, keyBuf = "", curKey = "", esc = 0, hex = "", hi = null, depth = 0, inStr = false, nEsc = false;',
    '  var out = { think: "", content: "" };',
    '  function emit(ch, isKey) { if (isKey) keyBuf += ch; else if (curKey === "think" || curKey === "content") out[curKey] += ch; }',
    '  function flushHi(isKey) { if (hi !== null) { emit(String.fromCharCode(hi), isKey); hi = null; } }',
    '  function stepStr(ch, isKey) {',
    '    if (esc === 0) {',
    '      if (ch === "\\\\") { esc = 1; return false; }',
    '      if (ch === "\\"") { flushHi(isKey); return true; }',
    '      flushHi(isKey); emit(ch, isKey); return false;',
    '    }',
    '    if (esc === 1) {',
    '      if (ch === "u") { esc = 2; hex = ""; return false; }',
    '      esc = 0; flushHi(isKey);',
    '      var mapped = ch === "n" ? "\\n" : ch === "r" ? "\\r" : ch === "t" ? "\\t" : ch === "b" ? "\\b" : ch === "f" ? "\\f" : ch;',
    '      emit(mapped, isKey); return false;',
    '    }',
    '    var c = ch.charCodeAt(0);',
    '    var ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);',
    '    if (!ok) { esc = 0; flushHi(isKey); emit("\\\\u" + hex + ch, isKey); hex = ""; return false; }',
    '    hex += ch;',
    '    if (hex.length === 4) {',
    '      var u = parseInt(hex, 16); esc = 0; hex = "";',
    '      if (u >= 0xD800 && u <= 0xDBFF) { flushHi(isKey); hi = u; }',
    '      else if (u >= 0xDC00 && u <= 0xDFFF && hi !== null) { emit(String.fromCodePoint(((hi - 0xD800) << 10) + (u - 0xDC00) + 0x10000), isKey); hi = null; }',
    '      else { flushHi(isKey); emit(String.fromCharCode(u), isKey); }',
    '    }',
    '    return false;',
    '  }',
    '  for (var i = 0; i < raw.length; i++) {',
    '    var ch = raw[i];',
    '    var ws = ch === " " || ch === "\\n" || ch === "\\r" || ch === "\\t";',
    '    if (state === 9) break;',
    '    if (state === 0) { if (ws) continue; state = ch === "{" ? 1 : 9; continue; }',
    '    if (state === 1) { if (ws) continue; if (ch === "\\"") { keyBuf = ""; esc = 0; hi = null; state = 2; } else if (ch === "}") state = 9; continue; }',
    '    if (state === 2) { if (stepStr(ch, true)) { curKey = keyBuf; state = 3; } continue; }',
    '    if (state === 3) { if (ws) continue; if (ch === ":") state = 4; continue; }',
    '    if (state === 4) {',
    '      if (ws) continue;',
    '      if (ch === "\\"") { esc = 0; hi = null; state = 5; }',
    '      else if (ch === "{" || ch === "[") { depth = 1; inStr = false; nEsc = false; state = 6; }',
    '      else state = 7;',
    '      continue;',
    '    }',
    '    if (state === 5) { if (stepStr(ch, false)) state = 8; continue; }',
    '    if (state === 6) {',
    '      if (inStr) { if (nEsc) nEsc = false; else if (ch === "\\\\") nEsc = true; else if (ch === "\\"") inStr = false; }',
    '      else { if (ch === "\\"") inStr = true; else if (ch === "{" || ch === "[") depth++; else if (ch === "}" || ch === "]") { if (--depth <= 0) state = 8; } }',
    '      continue;',
    '    }',
    '    if (state === 7) { if (ch === ",") state = 1; else if (ch === "}") state = 9; continue; }',
    '    if (state === 8) { if (ws) continue; if (ch === ",") state = 1; else if (ch === "}") state = 9; }',
    '  }',
    '  return out;',
    '}',
    'function tavernSubmitStoryVisible(block) {',
    '  if (!block || block.kind !== "tool-call" || block.name !== "submit_story" || !block.argsRaw) return false;',
    '  var parsed = tavernParseSubmitStoryArgs(block.argsRaw);',
    '  return parsed.think.trim() !== "" || parsed.content.trim() !== "";',
    '}',
    'function tavernExpandSubmitStoryBlocks(blocks) {',
    '  var compact = blocks.filter(function (b) { return b !== void 0; });',
    '  var hasSubmit = compact.some(function (b) { return b.kind === "tool-call" && b.name === "submit_story" && b.argsRaw; });',
    '  if (!hasSubmit) return compact;',
    '  var result = [];',
    '  for (var i = 0; i < compact.length; i++) {',
    '    var b = compact[i];',
    '    if (b.kind === "text") continue;',
    '    if (b.kind === "tool-call" && b.name === "submit_story" && b.argsRaw) {',
    '      var parsed = tavernParseSubmitStoryArgs(b.argsRaw);',
    '      var pushed = false;',
    '      if (parsed.think.trim() !== "") { result.push({ kind: "reasoning", text: parsed.think }); pushed = true; }',
    '      if (parsed.content.trim() !== "") { result.push({ kind: "text", text: parsed.content }); pushed = true; }',
    '      if (!pushed) result.push(b);',
    '      continue;',
    '    }',
    '    result.push(b);',
    '  }',
    '  return result;',
    '}',
    'function compactBlocks(blocks) {',
    '  return tavernExpandSubmitStoryBlocks(blocks);',
    '}'
  ].join(' ')

  let patched = text.slice(0, compactMatch.index) + helpers + text.slice(compactMatch.index + compactMatch[0].length)

  const visibleNeedle = 'if (block === void 0 || block.kind === "tool-call") return false;'
  const visibleReplacement = 'if (block === void 0 || (block.kind === "tool-call" && !tavernSubmitStoryVisible(block))) return false;'
  const visIdx = patched.indexOf(visibleNeedle)
  if (visIdx < 0) return { status: 'unmatched', text }
  patched = patched.slice(0, visIdx) + visibleReplacement + patched.slice(visIdx + visibleNeedle.length)

  const earlyNeedle = 'if (previous?.kind === "tool-call" && previous.callId !== "" && (chunk.name === void 0 || chunk.name === previous.name) && (state.firstTokenTime !== void 0 || !isTokenDelta(chunk))) return state;'
  const earlyReplacement = 'if (previous?.kind === "tool-call" && previous.callId !== "" && (chunk.name ?? previous.name) !== "submit_story" && (chunk.name === void 0 || chunk.name === previous.name) && (state.firstTokenTime !== void 0 || !isTokenDelta(chunk))) return state;'
  const earlyIdx = patched.indexOf(earlyNeedle)
  if (earlyIdx < 0) return { status: 'unmatched', text }
  patched = patched.slice(0, earlyIdx) + earlyReplacement + patched.slice(earlyIdx + earlyNeedle.length)

  const argsNeedle = 'argsRaw: previous?.kind === "tool-call" ? previous.argsRaw : ""'
  const argsIdx = patched.indexOf(argsNeedle, earlyIdx)
  if (argsIdx < 0) return { status: 'unmatched', text }
  const usesNextVisible = patched.slice(earlyIdx, argsIdx).includes('let nextVisible')
  const argsReplacement = 'argsRaw: (previous?.kind === "tool-call" ? previous.argsRaw : "") + ((chunk.name ?? (previous?.kind === "tool-call" ? previous.name : "")) === "submit_story" ? String(chunk.argumentsDelta ?? "") : "")'
  patched = patched.slice(0, argsIdx) + argsReplacement + patched.slice(argsIdx + argsNeedle.length)

  if (usesNextVisible) {
    const closeAfterArgs = patched.indexOf('break;', argsIdx)
    if (closeAfterArgs < 0 || closeAfterArgs - argsIdx > 320) return { status: 'unmatched', text }
    patched = patched.slice(0, closeAfterArgs) + 'nextVisible = blockIsVisible(blocks[chunk.index]); ' + patched.slice(closeAfterArgs)
  }

  return { status: 'applied', text: patched }
}
