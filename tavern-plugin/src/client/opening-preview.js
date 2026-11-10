// The pre-game iframe can select a card greeting, but cannot write Session history.
function installOpeningPreviewBridge(token, preview) {
  const original = preview.runtime ? {
    host: window.SillyTavern, helper: window.TavernHelper,
    getChatMessages: window.getChatMessages, setChatMessages: window.setChatMessages,
    waitGlobalInitialized: window.waitGlobalInitialized
  } : null;
  const swipes = preview.swipes.slice();
  let selected = preview.selectedIndex;
  let nextId = 0;
  const pending = new Map();
  let worldbook = preview.worldbook ? JSON.parse(JSON.stringify(preview.worldbook)) : null;
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function request(type, payload) {
    // document.open() removes window listeners while preserving these API functions.
    addEventListener('message', receive);
    const requestId = 'opening-preview:' + (++nextId);
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { pending.delete(requestId); reject(new Error('开场操作超时，请重试')); }, type === 'dsh-tavern-helper-call' ? 300000 : 10000);
      pending.set(requestId, { resolve, reject, timer });
      parent.postMessage(Object.assign({ type, token, requestId }, payload), '*');
    });
  }
  window.triggerSlash = function (line) {
    const command = String(line || '');
    const triggers = /(?:^|\|)\s*\/trigger(?:\s+await=(?:true|false))?\s*$/i.test(command.trim());
    const send = function () { return request('dsh-tavern-helper-call', { method: 'triggerTavernSlash', args: { line: command } }); };
    const pendingCall = triggers && typeof window.__dshFlushBeforeGenerate === 'function'
      ? window.__dshFlushBeforeGenerate().then(send)
      : (triggers && typeof window.eventEmit === 'function'
        ? Promise.resolve().then(function () { return window.eventEmit('GENERATION_AFTER_COMMANDS', 'normal', {}, false); }).then(send)
        : send());
    return pendingCall.then(function (result) {
      if (result && result.deferred) showPendingFloor(command);
      return result;
    }).catch(function (error) {
      // Many legacy wizards replace their body before submitting. Keep a retry
      // entry even when their own button and form have already disappeared.
      if (typeof document !== 'undefined' && document.body) {
        document.querySelector('[data-dsh-opening-error]')?.remove();
        const notice = document.createElement('div');
        notice.setAttribute('data-dsh-opening-error', ''); notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:16px;background:Canvas;color:CanvasText;border:1px solid currentColor;border-radius:8px;font:14px/1.6 system-ui';
        const message = document.createElement('p'); message.textContent = '开局未完成：' + error.message;
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试开局';
        retry.onclick = function () { notice.remove(); window.triggerSlash(command).catch(function () {}); };
        notice.append(message, retry); document.body.append(notice);
      }
      throw error;
    });
  };
  // the opening-form API. One player name (the
  // prep page's), MVU values written to the draft opening, then the launch message starts the game.
  window.dshOpening = {
    playerName: function () { return String(preview.playerName || '你'); },
    start: async function (options) {
      const input = options || {};
      const message = String(input.message || '').trim();
      if (!message) throw new Error('开局内容为空');
      const variables = input.variables && typeof input.variables === 'object' ? input.variables : null;
      if (variables && Object.keys(variables).length) {
        if (!preview.runtime || typeof window.updateVariablesWith !== 'function') throw new Error('这张卡没有开局变量');
        if (preview.runtime.scripts.some(function (script) { return script.system === 'official-mvu'; })) await window.waitGlobalInitialized('Mvu');
        await window.updateVariablesWith(function (all) {
          const root = all.stat_data && typeof all.stat_data === 'object' ? all.stat_data : (all.stat_data = {});
          for (const path of Object.keys(variables)) {
            const keys = path.split('.');
            let node = root;
            for (const key of keys.slice(0, -1)) node = node[key] && typeof node[key] === 'object' ? node[key] : (node[key] = {});
            const last = keys[keys.length - 1];
            // MVU stores [value, description]; keep the description.
            if (Array.isArray(node[last]) && node[last].length === 2 && typeof node[last][1] === 'string') node[last][0] = variables[path];
            else node[last] = variables[path];
          }
          return all;
        }, { type: 'message', message_id: 0 });
      }
      const playerName = String(input.playerName || '').trim().slice(0, 80) || window.dshOpening.playerName();
      return request('dsh-tavern-helper-call', { method: 'triggerTavernSlash', args: { line: '/send ' + message.replace(/\|/g, '\\|') + '|/trigger', playerName: playerName, scriptStart: input.scriptStart } });
    }
  };
  // generate builds the request from the card and preset; generateRaw takes an explicit order.
  function generation(method, config) {
    const payload = copy(config);
    const streaming = payload && payload.should_stream === true;
    const generationId = payload && payload.generation_id != null && String(payload.generation_id) !== ''
      ? String(payload.generation_id)
      : ('dsh-gen-' + Date.now().toString(16));
    if (streaming && window.iframe_events && typeof window.eventEmit === 'function') {
      if (payload.generation_id == null || payload.generation_id === '') payload.generation_id = generationId;
      void window.eventEmit(window.iframe_events.GENERATION_STARTED, generationId);
    }
    return request('dsh-tavern-helper-call', { method: method, args: { config: payload } }).then(function (result) {
      const text = result.text;
      if (!streaming || !window.iframe_events || typeof window.eventEmit !== 'function') return text;
      const events = window.iframe_events;
      return Promise.resolve(window.eventEmit(events.STREAM_TOKEN_RECEIVED_FULLY, text, generationId))
        .then(function () { return window.eventEmit(events.STREAM_TOKEN_RECEIVED_INCREMENTALLY, text, generationId); })
        .then(function () { return window.eventEmit(events.GENERATION_ENDED, text, generationId); })
        .then(function () { return text; });
    });
  }
  window.generate = function (config) { return generation('generateTavernHelper', config); };
  window.generateRaw = function (config) { return generation('generateTavernHelperRaw', config); };
  window.getCharWorldbookNames = function () { return { primary: worldbook ? worldbook.name : null, additional: [] }; };
  window.getGlobalWorldbookNames = function () { return []; };
  window.getChatWorldbookName = function () { return null; };
  // With the script runtime, its versioned reads and changed-entry writes reach the
  // draft; these whole-draft round trips would move a large book several times per write.
  if (!original) {
    window.getWorldbook = async function (name) {
      if (preview.preparationId) {
        const result = await request('dsh-tavern-opening-read', {});
        worldbook = result.worldbook;
      }
      if (!worldbook || name !== worldbook.name) throw new Error('开场准备只能访问绑定的世界书');
      return copy(worldbook.entries);
    };
    window.updateWorldbookWith = async function (name, updater) {
      const previous = await window.getWorldbook(name);
      const draft = copy(previous);
      const updated = await updater(draft);
      const entries = updated === undefined ? draft : updated;
      const result = await request('dsh-tavern-opening-worldbook', { entries, expectedEntries: previous });
      worldbook = copy(result.worldbook);
      return copy(worldbook.entries);
    };
  }
  window.TavernHelper = Object.assign({}, window.TavernHelper, original && original.helper, { triggerSlash: window.triggerSlash, generate: window.generate, generateRaw: window.generateRaw, getCharWorldbookNames: window.getCharWorldbookNames, getGlobalWorldbookNames: window.getGlobalWorldbookNames, getChatWorldbookName: window.getChatWorldbookName,
    getWorldbook: window.getWorldbook, updateWorldbookWith: window.updateWorldbookWith });
  const chat = [{ is_user: false, name: preview.characterName || '', mes: swipes[selected], swipe_id: selected, swipes: swipes.slice() }];
  // A wizard writes its opening record into "the floor it just sent". The game
  // starts later, so that floor is only a promise until the host creates it;
  // showing it here keeps the wizard's own bookkeeping working.
  let pendingFloor = null;
  function contextChat() { return pendingFloor ? chat.concat([pendingFloor]) : chat; }
  function showPendingFloor(line) {
    const match = /^\s*\/send\s+([\s\S]+)$/.exec(String(line || '').trim());
    const text = match ? match[1].trim().replace(/\\\|/g, '|') : '';
    if (!text) return;
    pendingFloor = Object.assign(pendingFloor || {}, { is_user: true, name: preview.playerName || '你',
      mes: text, message: text, swipe_id: 0, swipes: [text], variables: pendingFloor ? pendingFloor.variables : {} });
  }
  let savedIndex = selected;
  const swipe = { to: async function (_chatId, direction, options = {}) {
    if (options.forceMesId !== undefined && Number(options.forceMesId) !== 0) throw new Error('只能切换开场消息');
    const index = options.forceSwipeId !== undefined ? Number(options.forceSwipeId)
      : direction === 'left' ? selected - 1 : direction === 'right' ? selected + 1 : NaN;
    return window.setChatMessages([{ message_id: 0, swipe_id: index }]);
  } };
  if (!window.toastr) window.toastr = { info: console.info, success: console.info, warning: console.warn, error: console.error };
  window.SillyTavern = Object.assign({}, original && original.host, {
    chat, swipe,
    getContext: function () { return Object.assign({}, original && original.host.getContext(), { chat: contextChat(), swipe, extensionSettings: original ? original.host.getContext().extensionSettings : {} }); },
    saveChat: async function () {
      const message = chat[0];
      const index = Number(message && message.swipe_id);
      if (chat.length !== 1 || !Number.isInteger(index) || !preview.openingIds[index] || message.mes !== swipes[index]) {
        throw new Error('开场准备只能选择人物卡已有开场');
      }
      // Persist selection before acknowledging save, without unmounting its caller.
      await request('dsh-tavern-opening-save', { swipeId: index });
      savedIndex = index;
    },
    reloadCurrentChat: async function () {
      await window.setChatMessages([{ message_id: 0, swipe_id: savedIndex }]);
    }
  });
  window.getCurrentMessageId = window.getLastMessageId = function () { return contextChat().length - 1; };
  window.getChatMessages = function (id, options) {
    if (original) return original.getChatMessages(id, options);
    const rows = contextChat();
    const index = id === 'latest' || id === undefined ? rows.length - 1 : Number(id);
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return [];
    if (index === 0) {
      if (options && options.role && !['all', 'assistant'].includes(options.role)) return [];
      return [{ message_id: 0, role: 'assistant', message: swipes[selected], swipe_id: selected, swipes: swipes.slice() }];
    }
    if (options && options.role && !['all', 'user'].includes(options.role)) return [];
    return [Object.assign({}, pendingFloor, { message_id: index, role: 'user' })];
  };
  // Standalone choosers without a preparation draft may await this gate without reading MVU.
  window.waitGlobalInitialized = async function (name) {
    if (original) return original.waitGlobalInitialized(name);
    if (name === 'Mvu' && !preview.preparationId) return undefined;
    if (window[name] !== undefined) return window[name];
    throw new Error('开场预览尚未初始化 ' + name);
  };
  window.errorCatched = function (callback) {
    return function () { return Promise.resolve().then(() => callback.apply(this, arguments)).catch(console.error); };
  };
  window.setChatMessages = async function (patches) {
    if (original && Array.isArray(patches) && patches.every(patch => patch.swipe_id === undefined)) return original.setChatMessages(patches);
    if (!Array.isArray(patches) || patches.length !== 1) throw new Error('开场预览只能选择一条开场');
    const patch = patches[0];
    const index = Number(patch && patch.swipe_id);
    if (!patch || Number(patch.message_id) !== 0 || !Number.isInteger(index) || !preview.openingIds[index] ||
        Object.keys(patch).some(key => !['message_id', 'swipe_id', 'message'].includes(key)) ||
        (patch.message !== undefined && patch.message !== swipes[index])) {
      throw new Error('开场预览只支持选择人物卡已有开场，不能修改正文或变量');
    }
    await request('dsh-tavern-opening-select', { swipeId: index });
    selected = index;
  };
  window.setChatMessage = function (message, messageId, options) {
    return window.setChatMessages([{ message_id: messageId, message, swipe_id: options && options.swipe_id }]);
  };
  function receive(event) {
    const data = event.data;
    if (event.source !== parent || !data || data.token !== token || !['dsh-tavern-opening-response', 'dsh-tavern-helper-response'].includes(data.type)) return;
    const task = pending.get(data.requestId);
    if (!task) return;
    pending.delete(data.requestId); clearTimeout(task.timer);
    if (data.ok) task.resolve(data.result); else task.reject(new Error(data.error || '开场选择失败'));
  }
  addEventListener('message', receive);
  window.__dshTavernHelperCompatibility?.refresh();
}

function openingPreviewSelection(preview, swipeId) {
  if (!preview || !Number.isInteger(swipeId) || swipeId < 0 || !preview.openingIds[swipeId]) throw new Error('人物卡开场白不存在');
  return preview.openingIds[swipeId];
}

// SillyTavern cards address the first floor by swipe index, including cards
// that update chat[0] directly and then call saveChat/reloadCurrentChat.
function installSessionOpeningBridge(token, descriptor) {
  const swipes = descriptor.swipes.slice();
  const chat = [{ is_user: false, name: descriptor.characterName, mes: swipes[descriptor.selectedIndex], swipe_id: descriptor.selectedIndex, swipes }];
  const pending = new Map();
  let sequence = 0, selected = descriptor.selectedIndex, revision = descriptor.lifecycleRevision || 0;
  let openingVersion = descriptor.version;
  let switching = null;
  function call(args) {
    const requestId = 'opening-session:' + (++sequence);
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { pending.delete(requestId); reject(new Error('切换开场白超时')); }, 120000);
      pending.set(requestId, { resolve, reject, timer });
      parent.postMessage({ type: 'dsh-tavern-helper-call', token, requestId, method: 'switchSessionOpening', args }, '*');
    });
  }
  addEventListener('message', function (event) {
    const data = event.data;
    if (event.source !== parent || !data || data.token !== token || data.type !== 'dsh-tavern-helper-response') return;
    const task = pending.get(data.requestId);
    if (!task) return;
    pending.delete(data.requestId); clearTimeout(task.timer);
    if (data.ok) task.resolve(data.result); else task.reject(new Error(data.error || '切换开场白失败'));
  });
  async function select(index, message) {
    if (!Number.isInteger(index) || !descriptor.openingIds[index] || message !== swipes[index]) throw new Error('只能选择人物卡已有开场');
    if (switching) throw new Error('正在切换开场白');
    switching = call({ swipeId: index, message, expectedLifecycleRevision: revision, expectedOpeningVersion: openingVersion });
    try {
      const result = await switching;
      selected = result.selectedIndex;
      revision = result.lifecycleRevision;
      openingVersion = result.openingVersion;
      return result;
    } finally {
      chat[0].swipe_id = selected;
      chat[0].mes = swipes[selected];
      switching = null;
    }
  }
  const swipe = { to: async function (_chatId, direction, options = {}) {
    if (options.forceMesId !== undefined && Number(options.forceMesId) !== 0) throw new Error('只能切换开场消息');
    const index = options.forceSwipeId !== undefined ? Number(options.forceSwipeId)
      : direction === 'left' ? chat[0].swipe_id - 1 : direction === 'right' ? chat[0].swipe_id + 1 : NaN;
    if (!Number.isInteger(index) || !descriptor.openingIds[index]) throw new Error('人物卡开场白不存在');
    return select(index, swipes[index]);
  } };
  if (!window.toastr) window.toastr = { info: console.info, success: console.info, warning: console.warn, error: console.error };
  window.SillyTavern = Object.assign(window.SillyTavern || {}, {
    extensionSettings: window.SillyTavern?.extensionSettings || descriptor.extensionSettings || {},
    TavernHelper: window.TavernHelper,
    chat, swipe,
    getContext: function () { return window.SillyTavern; },
    saveChat: function () {
      const row = chat[0], index = row && row.swipe_id;
      if (chat.length !== 1) throw new Error('只能选择人物卡已有开场');
      return select(index, row.mes);
    },
    reloadCurrentChat: async function () { if (switching) await switching; }
  });
  const setMessage = window.setChatMessage;
  const setMessages = window.setChatMessages;
  window.setChatMessage = async function (message, messageId, options) {
    const index = options && options.swipe_id;
    if (Number(messageId) === 0 && index !== undefined) return select(index, message ?? swipes[index]);
    return setMessage(message, messageId, options);
  };
  window.setChatMessages = async function (patches, options) {
    const patch = Array.isArray(patches) && patches.length === 1 ? patches[0] : null;
    if (patch && Number(patch.message_id) === 0 && patch.swipe_id !== undefined && patch.data === undefined) {
      return select(patch.swipe_id, patch.message ?? swipes[patch.swipe_id]);
    }
    return setMessages(patches, options);
  };
}

// A retained preview still owns its private host draft while hidden. Renew only
// its expiry without applying the response to the iframe. Older hosts ignore
// touchOnly and return the draft, so a refreshed client needs no host restart.
function retainOpeningPreparation(id, options) {
  const host = options.window;
  let stopped = false, pending = false, lastError = "";
  async function renew() {
    if (stopped || pending) return;
    pending = true;
    try {
      await options.call("getOpeningPreparation", { id: id, touchOnly: true });
      lastError = "";
    } catch (error) {
      const message = String(error && error.message || error);
      if (!stopped && message !== lastError) { lastError = message; options.onError(error); }
    } finally { pending = false; }
  }
  void renew();
  const timer = host.setInterval(renew, 60000);
  host.addEventListener("focus", renew);
  return function () {
    stopped = true;
    host.clearInterval(timer);
    host.removeEventListener("focus", renew);
  };
}

// Preview panels emit compatibility events on the real host document.
const tavernPreviewEventRelays = new WeakMap();
function installTavernPreviewHostEventRelay(hostDocument, frame) {
  if (!hostDocument || typeof hostDocument.dispatchEvent !== 'function') return function () {};
  let relay = tavernPreviewEventRelays.get(hostDocument);
  if (!relay) {
    const originalDispatch = hostDocument.dispatchEvent;
    const previous = Object.getOwnPropertyDescriptor(hostDocument, 'dispatchEvent');
    const owners = new Map();
    function dispatch(event) {
      try { return originalDispatch.call(hostDocument, event); }
      finally {
        const detail = event?.detail;
        if (typeof event?.type === 'string' && !event.type.startsWith('dsh-') && detail && typeof detail === 'object') {
          const target = Array.from(owners.values()).findLast(node => node.isConnected !== false);
          try {
            const preview = target?.contentDocument;
            if (preview) preview.dispatchEvent(new preview.defaultView.CustomEvent(event.type, { detail }));
          } catch (_) { /* A frame can navigate away from the preview origin. */ }
        }
      }
    }
    try { Object.defineProperty(hostDocument, 'dispatchEvent', { configurable: true, value: dispatch }); }
    catch (_) { return function () {}; }
    relay = { owners, dispatch, previous };
    tavernPreviewEventRelays.set(hostDocument, relay);
  }
  const owner = {};
  relay.owners.set(owner, frame);
  return function () {
    if (!relay.owners.delete(owner) || relay.owners.size) return;
    if (Object.getOwnPropertyDescriptor(hostDocument, 'dispatchEvent')?.value === relay.dispatch) {
      if (relay.previous) Object.defineProperty(hostDocument, 'dispatchEvent', relay.previous);
      else delete hostDocument.dispatchEvent;
    }
    tavernPreviewEventRelays.delete(hostDocument);
  };
}

function TavernOpeningNav({ sessionId, opening, lifecycleRevision }) {
	const [switching, setSwitching] = React.useState(false);
	const indices = opening.openingIds.flatMap((id, index) => id ? [index] : []);
	const position = indices.indexOf(opening.selectedIndex);
	async function select(offset) {
		if (switching) return;
		setSwitching(true);
		try {
			const swipeId = indices[(position + offset + indices.length) % indices.length];
			await rpc("switchSessionOpening", { swipeId, expectedLifecycleRevision: lifecycleRevision, expectedOpeningVersion: opening.version }, sessionId);
			tavernErrorHub.resolve("切换开场白");
		} catch (error) {
			tavernErrorHub.report("切换开场白", error);
		} finally {
			liveTavernView.invalidate(sessionId);
			tavernStoryInputChanged(window, sessionId);
			setSwitching(false);
		}
	}
	const h = React.createElement;
	return h("div", { className: "dsh-tavern-greeting-nav", role: "group", "aria-label": "切换开场白" },
		h("button", { type: "button", className: "dsh-tavern-btn", disabled: switching, "aria-label": "上一条开场白", onClick: () => select(-1) }, "←"),
		h("span", { className: "dsh-tavern-greeting-count", "aria-live": "polite" }, (position + 1) + " / " + indices.length),
		h("button", { type: "button", className: "dsh-tavern-btn", disabled: switching, "aria-label": "下一条开场白", onClick: () => select(1) }, "→"));
}
