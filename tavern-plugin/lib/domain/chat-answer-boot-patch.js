// Page-side half of the answer-step fix (chat-answer-step.js): a desktop host keeps the
// chat view in a read-only app.asar, so the install-time patch cannot write it. A small
// script injected first into index.html wraps window.__ModuleLoader__.load and rebuilds
// the chat view's factory from its patched source when it registers. The factory is a
// self-contained `(require) => …` bundle, so rebuilding it loses no scope. Any failure
// (a changed shape, a CSP without eval) leaves the original factory in place.
import { patchChatSource } from './chat-answer-step.js'
import { patchReasoningChatSource } from './chat-reasoning-fold.js'
import { patchToolReplyStreamChatSource } from './chat-tool-reply-stream.js'

export const CHAT_UI_MODULE_ID = '@deepseek-ai/dsh-client-ui-chat'

export function chatAnswerBootScript() {
  return `(function () {
  var ID = ${JSON.stringify(CHAT_UI_MODULE_ID)}
  var patchChatSource = ${patchChatSource.toString()}
  var patchReasoningChatSource = ${patchReasoningChatSource.toString()}
  var patchToolReplyStreamChatSource = ${patchToolReplyStreamChatSource.toString()}
  function patchFactory(factory) {
    try {
      var source = String(factory)
      var changed = false
      var answer = patchChatSource(source)
      if (answer.status === 'applied') { source = answer.text; changed = true }
      var reasoning = patchReasoningChatSource(source)
      if (reasoning.status === 'applied') { source = reasoning.text; changed = true }
      var toolStream = patchToolReplyStreamChatSource(source)
      if (toolStream.status === 'applied') { source = toolStream.text; changed = true }
      if (!changed) return factory
      var rebuilt = new Function('return (' + source + ')')()
      return typeof rebuilt === 'function' ? rebuilt : factory
    } catch (error) {
      console.warn('[dsh-tavern] 对话界面补丁未生效：', error)
      return factory
    }
  }
  function installed(load) {
    return function (registration) {
      if (registration && registration.id === ID && typeof registration.factory === 'function') {
        var factory = patchFactory(registration.factory)
        if (factory !== registration.factory) registration = Object.assign({}, registration, { factory: factory })
      }
      return load.call(this, registration)
    }
  }
  function wrap(loader) {
    if (!loader || typeof loader.load !== 'function' || loader.__dshTavernAnswerStep) return loader
    // The host swaps its queued loader for the live one by assigning load again; keep wrapping.
    var current = installed(loader.load)
    try {
      Object.defineProperty(loader, 'load', { configurable: true, enumerable: true,
        get: function () { return current },
        set: function (value) { current = typeof value === 'function' ? installed(value) : value } })
      Object.defineProperty(loader, '__dshTavernAnswerStep', { value: true })
    } catch (error) { loader.load = current }
    return loader
  }
  var loader = wrap(window.__ModuleLoader__)
  try {
    Object.defineProperty(window, '__ModuleLoader__', { configurable: true, enumerable: true,
      get: function () { return loader },
      set: function (value) { loader = wrap(value) } })
  } catch (error) { console.warn('[dsh-tavern] 回复步骤补丁未能安装：', error) }
})()`
}

/** Put the script first in the page head, before any plugin bundle registers its factory. */
export function installChatAnswerBootPatch(ctx) {
  ctx.inject(['webServer'], webCtx => {
    webCtx.on('webserver/index-inject', table => {
      if (!Array.isArray(table) || table.some(row => row?.dshTavernAnswerStep)) return
      table.unshift({ kind: 'script', placement: 'head', text: chatAnswerBootScript(), dshTavernAnswerStep: true })
    })
  })
}
