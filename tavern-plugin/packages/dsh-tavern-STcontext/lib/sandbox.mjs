import { createEngine } from './vendor/quickjs.mjs';
import { scriptExpression } from './script-syntax.mjs';

const engine = await createEngine();
const MAX_JSON = 8 * 1024 * 1024;

// Serialized into QuickJS. The "window" only exposes the frozen generation
// inputs. Each invocation creates its own mutable copies for the preset.
function installRequestContext(data) {
  const { chat, chatMetadata, chatId, chatCompletionSettings, variables } = data;
  const inputMessage = chat.at(-1);
  const context = {
    name1: data.userName, name2: data.charName, chat, chatId, chatCompletionSettings,
    chatMetadata: { ...chatMetadata, variables: variables.chat },
    getCurrentChatId: () => chatId,
    substituteParams: text => String(text).replace(/\{\{(user|char)\}\}/gi, (_, name) =>
      name.toLowerCase() === 'user' ? data.userName : data.charName),
  };
  const SillyTavern = { getContext: () => context };
  const TavernHelper = {
    getVariables({ type = 'chat', message_id } = {}) {
      if (type === 'message') return chat.at(message_id ?? -1)?.variables?.[0] || {};
      return variables[type] || {};
    },
  };
  const win = { SillyTavern, TavernHelper };
  win.window = win.parent = win.top = win;
  Object.assign(globalThis, { window: win, parent: win, top: win, SillyTavern, TavernHelper });
  return () => {
    // Host variables belong to the frozen frame. Only preset metadata and
    // the generating player's floor extra may be committed by the caller.
    const { variables: hostVariables, ...metadata } = context.chatMetadata;
    return { chatMetadata: metadata, currentInputExtra: inputMessage?.extra || {} };
  };
}

// Guest JavaScript runs in WASM QuickJS, never in Node's realm. No host function,
// module loader, network, filesystem, timers, DOM, credentials or DSH API is bound.
// A fresh runtime is used for every hook, so globals cannot leak between stages.
export function executeScript(source, input, { kind = 'function', stage = 'script', timeout = 500, requestContext, template = false } = {}) {
  const { expression } = scriptExpression(source, kind);
  const json = JSON.stringify(requestContext ? { input, requestContext } : input);
  if (json === undefined || Buffer.byteLength(json) > MAX_JSON) throw new Error(stage + '：脚本输入超过 8 MiB 或不是 JSON');
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + Math.min(Math.max(timeout, 1), 2000);
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const context = runtime.newContext();
  let result;
  try {
    const inputHandle = context.newString(json);
    context.setProp(context.global, '__inputJSON', inputHandle); inputHandle.dispose();
    // Capture serialization before guest code can replace JSON or its methods.
    // The only values crossing this boundary are bounded JSON strings.
    result = context.evalCode(`(() => {
      const stringify = JSON.stringify, parse = JSON.parse;
      const payload = parse(globalThis.__inputJSON);
      delete globalThis.__inputJSON;
      globalThis.console = Object.freeze({ log() {}, warn() {}, error() {}, info() {}, debug() {} });
      ${template ? `// Compiled EJS may use ordinary JS, but cannot compile chat data as new JS.
        for (const fn of [function(){}, async function(){}, function*(){}, async function*(){}])
          Object.defineProperty(Object.getPrototypeOf(fn), 'constructor', { value: undefined, configurable: false, writable: false });
        globalThis.eval = globalThis.Function = undefined;` : ''}
      const serialize = value => {
        const text = stringify(value);
        if (typeof text !== 'string' || text.length > ${MAX_JSON}) throw new Error('脚本结果不是 JSON 或超过限制');
        return text;
      };
      ${requestContext ? `const snapshot = (${installRequestContext.toString()})(payload.requestContext);` : ''}
      const finish = ${requestContext ? 'value => serialize({ value, scriptState: snapshot() })' : 'serialize'};
      const value = (${expression})(${requestContext ? 'payload.input' : 'payload'});
      return value && typeof value.then === 'function' ? value.then(finish) : finish(value);
    })()`, 'preset-hook.js');
    if (result.error) throw new Error(context.dump(result.error)?.message || '脚本执行失败');
    // Allow async pure computations, but no timers or indefinitely pending work.
    let state = context.getPromiseState(result.value), jobs = 0;
    while (state.type === 'pending') {
      if (++jobs > 1000 || Date.now() >= deadline || !runtime.hasPendingJob()) throw new Error('脚本异步任务未完成或超时');
      const pending = runtime.executePendingJobs(1);
      if (pending.error) { pending.error.dispose(); throw new Error('脚本异步任务失败'); }
      state = context.getPromiseState(result.value);
    }
    const handle = state.type === 'rejected' ? state.error : state.value;
    try {
      if (state.type === 'rejected') throw new Error(context.dump(handle)?.message || '脚本异步任务失败');
      const output = context.getString(handle);
      if (Buffer.byteLength(output) > MAX_JSON) throw new Error('脚本输出超过 8 MiB');
      return JSON.parse(output);
    } finally { if (handle !== result.value) handle.dispose(); }
  } catch (error) {
    const detail = Date.now() >= deadline ? '脚本执行超时' : String(error?.message || error).slice(0, 350);
    throw new Error(stage + '：' + detail);
  } finally {
    if (result?.error) result.error.dispose();
    if (result?.value) result.value.dispose();
    context.dispose(); runtime.dispose();
  }
}
