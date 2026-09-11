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
  window.generateRaw = function (config) {
    return request('dsh-tavern-helper-call', { method: 'generateTavernHelperRaw', args: { config: copy(config) } }).then(function (result) { return result.text; });
  };
  window.getCharWorldbookNames = function () { return { primary: worldbook ? worldbook.name : null, additional: [] }; };
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
  window.TavernHelper = Object.assign({}, original && original.helper, { generateRaw: window.generateRaw, getCharWorldbookNames: window.getCharWorldbookNames,
    getWorldbook: window.getWorldbook, updateWorldbookWith: window.updateWorldbookWith });
  const chat = [{ is_user: false, name: preview.characterName || '', mes: swipes[selected], swipe_id: selected, swipes: swipes.slice() }];
  let savedIndex = selected;
  window.SillyTavern = Object.assign({}, original && original.host, {
    chat,
    getContext: function () { return Object.assign({}, original && original.host.getContext(), { chat, extensionSettings: original ? original.host.getContext().extensionSettings : {} }); },
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
  if (original) {
    window.getTavernHelperVersion = function () { return "4.8.19"; };
    window.TavernHelper.getTavernHelperVersion = window.getTavernHelperVersion;
  }
  window.getCurrentMessageId = window.getLastMessageId = function () { return 0; };
  window.getChatMessages = function (id, options) {
    if (original) return original.getChatMessages(id, options);
    if (Number(id) !== 0 || (options && options.role && !['all', 'assistant'].includes(options.role))) return [];
    return [{ message_id: 0, role: 'assistant', message: swipes[selected], swipe_id: selected, swipes: swipes.slice() }];
  };
  // Some chooser pages await this gate without reading MVU. No game state exists yet.
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
    if (original && Array.isArray(patches) && patches.every(patch => patch.swipe_id === undefined && patch.message === undefined)) return original.setChatMessages(patches);
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
}

function openingPreviewSelection(preview, swipeId) {
  if (!preview || !Number.isInteger(swipeId) || swipeId < 0 || !preview.openingIds[swipeId]) throw new Error('人物卡开场白不存在');
  return preview.openingIds[swipeId];
}

// A legacy home already saved as a greeting can finish setup via the native
// new-game coordinator. It never edits the source session's event history.
function installSessionOpeningBridge(token, descriptor) {
  const swipes = descriptor.swipes.slice();
  const chat = [{ is_user: false, name: descriptor.characterName, mes: swipes[descriptor.selectedIndex], swipe_id: descriptor.selectedIndex, swipes }];
  const pending = new Map();
  let sequence = 0, saved = null, starting = null;
  function call(method, args) {
    const requestId = 'opening-session:' + (++sequence);
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { pending.delete(requestId); reject(new Error('开始旅程超时，请检查左侧错误提示')); }, 120000);
      pending.set(requestId, { resolve, reject, timer });
      parent.postMessage({ type: 'dsh-tavern-helper-call', token, requestId, method, args }, '*');
    });
  }
  addEventListener('message', function (event) {
    const data = event.data;
    if (event.source !== parent || !data || data.token !== token || data.type !== 'dsh-tavern-helper-response') return;
    const task = pending.get(data.requestId);
    if (!task) return;
    pending.delete(data.requestId); clearTimeout(task.timer);
    if (data.ok) task.resolve(data.result); else task.reject(new Error(data.error || '开始旅程失败'));
  });
  window.SillyTavern = Object.assign({}, window.SillyTavern, {
    extensionSettings: descriptor.extensionSettings || {},
    TavernHelper: window.TavernHelper,
    chat,
    getContext: function () { return window.SillyTavern; },
    saveChat: async function () {
      const row = chat[0], index = row && row.swipe_id;
      if (chat.length !== 1 || !Number.isInteger(index) || !descriptor.openingIds[index] || row.mes !== swipes[index]) throw new Error('只能选择人物卡已有开场');
      saved = await call('prepareSessionOpening', { swipeId: index, message: row.mes });
    },
    reloadCurrentChat: function () {
      if (!saved) return Promise.reject(new Error('请先保存开场选择'));
      if (!starting) starting = call('startSessionOpening', { preparationId: saved.preparationId }).catch(function (error) { starting = null; throw error; });
      return starting;
    }
  });
  window.setChatMessage = async function (message, messageId, options) {
    const index = options && options.swipe_id;
    if (Number(messageId) !== 0 || !Number.isInteger(index) || message !== swipes[index]) throw new Error('只能选择人物卡已有开场');
    chat[0].swipe_id = index;
    chat[0].mes = message;
    await window.SillyTavern.saveChat();
    return window.SillyTavern.reloadCurrentChat();
  };

}
