// Reasoning rows in the DSH chat view are user-driven disclosures: the 「思考」 line is
// collapsed unless the reader clicks it, and a settled turn folds the whole process
// away. The Tavern setting 设置 › 高级 › 流式显示思维链 wants the opposite cadence: the
// reasoning body follows the stream — open while the model is still thinking, folded
// the moment that thinking ends — without touching the host's 「工作步骤展示」 level.
//
// The chat view's client bundle is the only place that owns the disclosure state, so
// the same two-channel patch used for the answer step applies here: writable hosts get
// it at install time (bin/chat-reasoning-fold-patch.mjs), a desktop host keeps the
// view in a read-only app.asar and the page applies it when the module registers
// (chat-answer-boot-patch.js). Keep this function self-contained: the page embeds its
// source, so every constant it needs is declared inside the function body.
export const CHAT_REASONING_STREAM_MARKER = '/* dsh-tavern:reasoning-stream */'

// The preference itself lives in localStorage: the ui-chat bundle has no RPC channel,
// and the Tavern client (src/client/features/reasoning-stream.js) rewrites this key
// and fires the event whenever the setting is saved. A missing key means "on", which
// matches the shipped default.
export function patchReasoningChatSource(text) {
  const MARKER = '/* dsh-tavern:reasoning-stream */'
  const PREF_KEY = 'dsh-tavern.reasoningStreamOnly'
  const EVENT = 'dsh-tavern-reasoning-stream'
  if (text.includes(MARKER)) return { status: 'patched', text }
  // The shipped bundle memoizes the row: `const ReasoningRow = (0, react.memo)(function
  // ReasoningRow(props) { … })`. Match that statement first — helper declarations cannot
  // live inside the memo() argument — and fall back to a bare function declaration.
  const memoized = /const\s+ReasoningRow\s*=\s*\(0,\s*react\.memo\)\(function\s+ReasoningRow\s*\(\s*\{[^{}]*\}\s*\)\s*\{\s*const\s*\{\s*expanded\s*,\s*toggle\s*\}\s*=\s*useDisclosure\(\);/
  const plain = /(?:^|\n)([\t ]*)function\s+ReasoningRow\s*\(\s*\{[^{}]*\}\s*\)\s*\{\s*const\s*\{\s*expanded\s*,\s*toggle\s*\}\s*=\s*useDisclosure\(\);/
  const match = memoized.exec(text) ?? plain.exec(text)
  if (!match) return { status: 'unmatched', text }
  // 压缩宿主（0.2.2-rc.2+）里这句是 `const{expanded,toggle}=useDisclosure();`，
  // 可读拼写的 lastIndexOf 会落空并把切点钉在 -1，截断语句造成语法错误。
  // 按形状定位声明起点，两种宿主都切在语句边界上。
  let cut = -1
  for (const disclosure of match[0].matchAll(/const\s*\{\s*expanded\s*,\s*toggle\s*\}\s*=\s*useDisclosure\(\);/g)) cut = disclosure.index
  if (cut < 0) return { status: 'unmatched', text }
  const before = match[0].slice(0, cut)
  // Leading newline + indentation stay in front of the inserted declarations.
  const lead = /^\n?[ \t]*/.exec(before)[0]
  const head = before.slice(lead.length)
  // `expanded` is renamed: the stream decides the effective value, while the reader's
  // own choice keeps working once the turn settles.
  const rewritten = 'const { expanded: userExpanded, toggle } = useDisclosure();'
    + ' const tavernStreamReasoning = useTavernReasoningStream();'
    + ' const expanded = userExpanded || (tavernStreamReasoning && running);'
  const helpers = MARKER + ' function tavernReasoningStreamSnapshot() {'
    + ' try { return globalThis.localStorage?.getItem("' + PREF_KEY + '") !== "0"; }'
    + ' catch (error) { return true; } }'
    + ' function tavernReasoningStreamSubscribe(listener) {'
    + ' var target = globalThis;'
    + ' if (typeof target.addEventListener !== "function") return function () {};'
    + ' target.addEventListener("' + EVENT + '", listener);'
    + ' return function () { target.removeEventListener("' + EVENT + '", listener); }; }'
    + ' function useTavernReasoningStream() {'
    + ' return (0, react.useSyncExternalStore)(tavernReasoningStreamSubscribe, tavernReasoningStreamSnapshot, tavernReasoningStreamSnapshot); }'
  const segment = lead + helpers + ' ' + head + rewritten
  const patched = text.slice(0, match.index) + segment + text.slice(match.index + match[0].length)
  return { status: 'applied', text: patched }
}
