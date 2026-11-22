// Shared synchronous public API semantics for script and message iframes.
// Keep factories self-contained: the document builders serialize their source.
function installTavernHelperContext({window, facade, context, readChat}) {
    function chatId() { return String(context().chatId || ''); }
    let source, chat;
    function readMessageChat() {
        const messages = context().messages || [];
        if (messages === source) return chat;
        source = messages;
        chat = new Array(messages.length);
        for (let id = 0; id < messages.length; id++) {
            Object.defineProperty(chat, id, { enumerable: true, get() {
                // Only an indexed read of an old floor loads it from the host.
                // A held view cannot accidentally read a different conversation.
                const row = context().messages === messages
                    ? window.getChatMessages(id)[0] : structuredClone(messages[id]);
                if (!row) return undefined;
                return { ...row.pluginData, ...row, mes: String(row.message || ''),
                    is_user: row.role === 'user', variables: row.swipes_data || [] };
            } });
        }
        return chat;
    }
    const events = { on: 'eventOn', once: 'eventOnce', off: 'eventOff', removeListener: 'eventOff',
        makeFirst: 'eventMakeFirst', makeLast: 'eventMakeLast', emit: 'eventEmit' };
    const eventSource = Object.fromEntries(Object.entries(events).map(([key, name]) =>
        [key, (...args) => window[name](...args)]));
    Object.defineProperties(facade, {
        chatId: { enumerable: true, get: chatId },
        name1: { enumerable: true, get: () => String(context().playerName || '你') },
        name2: { enumerable: true, get: () => String(context().characterName || '角色') },
        TavernHelper: { enumerable: true, configurable: true, get: () => window.TavernHelper },
        eventTypes: { enumerable: true, get: () => window.tavern_events }
    });
    if (!Object.hasOwn(facade, 'chat')) Object.defineProperty(facade, 'chat', {
        enumerable: true, get: readChat || readMessageChat
    });
    facade.getCurrentChatId = chatId;
    facade.getContext = () => facade;
    facade.eventSource = eventSource;
    window.getContext = () => window.SillyTavern.getContext();
}

function isCurrentTavernHelperContext(current, incoming) {
    if (incoming.chatId && current.chatId && incoming.chatId !== current.chatId) return false;
    const next = Number(incoming.lifecycleRevision || 0), previous = Number(current.lifecycleRevision || 0);
    return next > previous || next === previous && Number(incoming.stateRevision || 0) >= Number(current.stateRevision || 0);
}

function createTavernHelperMessageWriter({context, copy, request}) {
    return async function (patches) {
        const {chatId, lifecycleRevision} = context();
        const result = await request('updateTavernHelperMessages', {messages: copy(patches || [])});
        const current = context();
        if (result?.stale || chatId !== current.chatId || lifecycleRevision !== current.lifecycleRevision) {
            throw Object.assign(new Error('聊天已变化，请重新读取消息'), {code: 'TAVERN_HELPER_STALE'});
        }
        if (result?.updated !== true) throw new Error('消息修改未保存');
        return result;
    };
}

function createTavernHelperMessageReader(options) {
    return function (target, settings) {
        const state = options.context(), count = (state.messages || []).length;
        if (!count) return [];
        const current = options.currentId();
        const raw = target === undefined || target === null ? String(current) : String(target)
            .replace(/{{\s*lastMessageId\s*}}/gi, String(count - 1));
        const match = /^(-?\d+)(?:-(-?\d+))?$/.exec(raw.trim());
        if (!match) return [];
        const normalize = value => Math.max(0, Math.min(count - 1, value < 0 ? count + value : value));
        const start = normalize(Number(match[1])), end = normalize(Number(match[2] ?? match[1]));
        const selected = [], filter = settings || {};
        const customPlayerName = typeof state.chatVariables?.playerName === 'string' ? state.chatVariables.playerName.trim() : '';
        const userName = customPlayerName || state.playerName || '你';
        const charName = state.characterName || state.character?.name || '';
        const resolveIdentity = text => String(text ?? '').replace(/<(user|char)>/gi, (token, kind) => kind.toLowerCase() === 'user' ? userName : (charName || token));
        for (let id = Math.min(start, end); id <= Math.max(start, end); id++) {
            const source = options.readMessage(id);
            if (!source) continue;
            if (filter.role && filter.role !== 'all' && source.role !== filter.role) continue;
            const hidden = source.is_hidden === true;
            if (filter.hide_state === 'hidden' && !hidden || filter.hide_state === 'unhidden' && hidden) continue;
            const row = options.copy(source);
            const swipe = Number(row.swipe_id) || 0;
            row.name = row.name || (row.role === 'user' ? userName : charName || '角色');
            row.is_hidden = hidden;
            row.swipe_id = swipe;
            row.swipes = (Array.isArray(row.swipes) && row.swipes.length ? row.swipes : [String(row.message || '')]).map(resolveIdentity);
            row.swipes_data = row.swipes.map((_, index) => options.copy(row.swipes_data?.[index] ?? (index === swipe ? row.variables : undefined) ?? {}));
            row.swipes_info = row.swipes.map((_, index) => options.copy(row.swipes_info?.[index] ?? row.pluginData?.swipe_info?.[index] ?? (index === swipe ? row.extra ?? row.pluginData?.extra : undefined) ?? {}));
            row.message = resolveIdentity(row.message ?? row.swipes[swipe] ?? '');
            row.data = options.copy(row.swipes_data[swipe] || row.variables || {});
            row.extra = options.copy(row.swipes_info[swipe] || {});
            // Retain the existing DSH fields as aliases. Both upstream overloads
            // can read their required fields, without breaking older card scripts.
            selected.push(row);
        }
        return selected;
    };
}

function installTavernHelperUtilities(target) {
    target.getIframeName = function () {
        if (target.name) return String(target.name);
        return typeof target.getScriptId === 'function' ? 'TH-script--' + target.getScriptName() + '--' + target.getScriptId() : '';
    };
    target.getMessageId = function (iframeName) {
        // Official IDs end in a timestamp; DSH uses a per-document token.
        const match = /^TH-message--(\d+)--[^\s]+$/.exec(String(iframeName));
        if (!match) throw new Error('不是有效的消息 iframe 名称: ' + String(iframeName));
        return Number(match[1]);
    };
    target.errorCatched = function (factory) {
        return function () {
            function fail(error) {
                try {
                    if (target.toastr && typeof target.toastr.error === 'function') target.toastr.error(String(error?.message || error));
                    else target.console?.error(error);
                } catch (_) { /* Reporting must never replace the caller's error. */ }
                throw error;
            }
            try {
                const result = factory.apply(this, arguments);
                return result && typeof result.then === 'function' ? Promise.resolve(result).catch(fail) : result;
            } catch (error) { return fail(error); }
        };
    };
    target.retrieveDisplayedMessage = function (messageId) {
        const found = [], id = Number(messageId);
        if (!Number.isSafeInteger(id) || id < 0) return target.jQuery ? target.jQuery() : [];
        try {
            // Trusted scripts reach the displayed message itself, as in SillyTavern.
            const host = target.parent, session = target.frameElement && target.frameElement.__dshTavernSessionId;
            if (host && host !== target && typeof host.__dshTavernScriptLayers === 'function') {
                for (const layer of host.__dshTavernScriptLayers(session, id)) found.push(layer);
                if (found.length) return target.jQuery ? target.jQuery(found) : found;
            }
        } catch (_) { /* Sandboxed frames cannot reach the host page. */ }
        try {
            if (target.getIframeName().startsWith('TH-message--') && target.getMessageId(target.name) === id) found.push(target.document.body);
            else {
                const session = target.frameElement && target.frameElement.__dshTavernSessionId;
                if (session) for (const frame of target.parent.document.querySelectorAll('iframe.dsh-tavern-message-frame')) {
                    if (frame.__dshTavernSessionId !== session || frame.isConnected === false || frame.getAttribute('aria-hidden') === 'true' || frame.closest('[hidden]')) continue;
                    try {
                        if (target.getMessageId(frame.contentWindow.name) === id && frame.contentDocument?.body) found.push(frame.contentDocument.body);
                    } catch (_) { /* Isolated and cross-origin frames remain inaccessible. */ }
                }
            }
        } catch (_) { /* Parent DOM access is available only in trusted mode. */ }
        return target.jQuery ? target.jQuery(found) : found;
    };
}
