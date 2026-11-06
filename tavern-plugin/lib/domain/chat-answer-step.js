// The DSH chat view takes a turn's last step as its final answer (latestAnswer), but
// a step only gets reply content from an appended assistant message. When Tavern
// rewrites a settled reply, DSH no longer accepts the write in the closed step, so
// it lands in an edit step of its own that holds only the replacement. The view
// then sees no answer and folds the whole round as process: collapsing the process
// or 「隐藏上下文注入和思考过程」 hides the body too. Point latestAnswer at the last
// step that has reply content; a turn whose last step already has content is unaffected.
//
// Matched loosely on purpose: any DSH whose latestAnswer still reads the last step
// via `<turn>.steps.at(-1)` is patched, whatever the surrounding code or formatting.
// Writable hosts get it at install time (bin/chat-answer-step-patch.mjs); a desktop
// host keeps the chat view in a read-only app.asar, so the page applies the same
// function when the module registers (chat-answer-boot-patch.js). Keep this function
// self-contained: the page embeds its source.
export const CHAT_ANSWER_STEP_MARKER = '/* dsh-tavern:answer-step */'

export function patchChatSource(text) {
  const MARKER = '/* dsh-tavern:answer-step */'
  const LATEST_ANSWER = /function\s+latestAnswer\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g
  // Plain loop: findLast is missing from older Android WebViews.
  const answerStep = turn => MARKER + '((steps) => { if (!Array.isArray(steps)) return steps.at(-1); '
    + 'for (let index = steps.length - 1; index > 0; index--) { '
    + 'if (steps[index]?.data?.get?.("assistant-step")?.blocks?.length > 0) return steps[index]; } '
    + 'return steps[0]; })(' + turn + '.steps)'
  if (text.includes(MARKER)) return { status: 'patched', text }
  let patched = text
  let applied = 0
  // Back to front, so earlier offsets stay valid; a bundle may carry several copies.
  for (const match of [...text.matchAll(LATEST_ANSWER)].reverse()) {
    const turn = match[1]
    const bodyStart = match.index + match[0].length
    // Only the function's own opening statements: stop at the next function.
    const head = text.slice(bodyStart, bodyStart + 600)
    const end = head.search(/\n\s*function\s/)
    const target = new RegExp('(?<![\\w$])' + turn.replace(/\$/g, '\\$') + '\\.steps\\.at\\(\\s*-1\\s*\\)')
    const found = target.exec(end === -1 ? head : head.slice(0, end))
    if (!found) continue
    const at = bodyStart + found.index
    patched = patched.slice(0, at) + answerStep(turn) + patched.slice(at + found[0].length)
    applied++
  }
  return applied ? { status: 'applied', text: patched } : { status: 'unmatched', text }
}
