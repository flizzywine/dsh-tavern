// Live streaming preview for `submit_story` tool calls in `@deepseek-ai/dsh-client-ui-chat`.
// Keep `patchToolReplyStreamChatSource` completely self-contained so `chat-answer-boot-patch.js`
// can embed `patchToolReplyStreamChatSource.toString()` in read-only desktop `app.asar` builds.
export const CHAT_TOOL_REPLY_STREAM_MARKER = '/* dsh-tavern:tool-reply-stream */'

export function patchToolReplyStreamChatSource(text) {
  const MARKER = '/* dsh-tavern:tool-reply-stream */'
  if (typeof text !== 'string') return { status: 'unmatched', text: String(text ?? '') }
  if (text.includes(MARKER)) return { status: 'patched', text }

  // 0.2.2-rc.2+ 的聊天包是压缩形状：无空白、反引号字符串、省略分号、箭头参数不带括号。
  // 每个锚点同时匹配可读与压缩两种形状；替换文本在两种宿主里都是合法 JS。
  const compactRe = /function\s+compactBlocks\s*\(\s*blocks\s*\)\s*\{\s*return\s+blocks\.filter\(\s*(?:\(\s*block\s*\)|block)\s*=>\s*block\s*!==\s*void\s*0\s*\)\s*;?\s*\}/
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

  const visibleRe = /if\s*\(\s*block\s*===\s*void\s*0\s*\|\|\s*block\.kind\s*===\s*(["'`])tool-call\1\s*\)\s*return\s+false\s*;?/
  const visibleMatch = visibleRe.exec(patched)
  if (!visibleMatch) return { status: 'unmatched', text }
  const visibleReplacement = 'if (block === void 0 || (block.kind === "tool-call" && !tavernSubmitStoryVisible(block))) return false;'
  patched = patched.slice(0, visibleMatch.index) + visibleReplacement + patched.slice(visibleMatch.index + visibleMatch[0].length)

  const earlyRe = /if\s*\(\s*previous\?\.kind\s*===\s*(["'`])tool-call\1\s*&&\s*previous\.callId\s*!==\s*(["'`])\2\s*&&\s*\(\s*chunk\.name\s*===\s*void\s*0\s*\|\|\s*chunk\.name\s*===\s*previous\.name\s*\)\s*&&\s*\(\s*state\.firstTokenTime\s*!==\s*void\s*0\s*\|\|\s*!\s*isTokenDelta\(\s*chunk\s*\)\s*\)\s*\)\s*return\s+state\s*;?/
  const earlyMatch = earlyRe.exec(patched)
  if (!earlyMatch) return { status: 'unmatched', text }
  const earlyReplacement = 'if (previous?.kind === "tool-call" && previous.callId !== "" && (chunk.name ?? previous.name) !== "submit_story" && (chunk.name === void 0 || chunk.name === previous.name) && (state.firstTokenTime !== void 0 || !isTokenDelta(chunk))) return state;'
  const earlyIdx = earlyMatch.index
  patched = patched.slice(0, earlyIdx) + earlyReplacement + patched.slice(earlyIdx + earlyMatch[0].length)

  const argsRe = /argsRaw\s*:\s*previous\?\.kind\s*===\s*(["'`])tool-call\1\s*\?\s*previous\.argsRaw\s*:\s*(["'`])\2/
  const argsMatch = argsRe.exec(patched.slice(earlyIdx))
  if (!argsMatch) return { status: 'unmatched', text }
  const argsIdx = earlyIdx + argsMatch.index
  const usesNextVisible = patched.slice(earlyIdx, argsIdx).includes('let nextVisible')
  const argsReplacement = 'argsRaw: (previous?.kind === "tool-call" ? previous.argsRaw : "") + ((chunk.name ?? (previous?.kind === "tool-call" ? previous.name : "")) === "submit_story" ? String(chunk.argumentsDelta ?? "") : "")'
  patched = patched.slice(0, argsIdx) + argsReplacement + patched.slice(argsIdx + argsMatch[0].length)

  if (usesNextVisible) {
    const closeMatch = /\bbreak\s*;?/.exec(patched.slice(argsIdx))
    if (!closeMatch || closeMatch.index > 320) return { status: 'unmatched', text }
    const closeAfterArgs = argsIdx + closeMatch.index
    patched = patched.slice(0, closeAfterArgs) + 'nextVisible = blockIsVisible(blocks[chunk.index]); ' + patched.slice(closeAfterArgs)
  }

  return { status: 'applied', text: patched }
}
