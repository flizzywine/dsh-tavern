        // Self-contained: embedded into both script and message iframe documents.
        function installTavernHelperEventApi(target, options = {}) {
            const pendingWaits = new Set();
            let disposed = false;
            let clearLocalEvents = null;
            function closedError() {
                const error = new Error("事件运行时已关闭，等待已取消");
                error.name = "AbortError";
                return error;
            }
            function assertOpen() { if (disposed) throw closedError(); }

            // Shared script sandboxes already have an identity-aware bus. Do not
            // wrap or replace its registration/removal methods: ownership belongs
            // to the registering script, including when its stop handle runs later.
            if (options.localEvents === true) {
                const listeners = new Map();
                const aliases = { message_sent: "MESSAGE_SENT", message_received: "MESSAGE_RECEIVED", message_updated: "MESSAGE_UPDATED", message_swiped: "MESSAGE_SWIPED", message_deleted: "MESSAGE_DELETED", message_edited: "MESSAGE_EDITED", chat_id_changed: "CHAT_CHANGED", chat_created: "CHAT_CREATED", character_page_loaded: "CHARACTER_PAGE_LOADED", generation_after_commands: "GENERATION_AFTER_COMMANDS", generate_before_combine_prompts: "GENERATE_BEFORE_COMBINE_PROMPTS" };
                function eventName(name) {
                    name = String(name);
                    return Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
                }
                function remove(name, entry) {
                    const entries = listeners.get(name);
                    if (!entries) return;
                    entries.delete(entry);
                    if (!entries.size) listeners.delete(name);
                }
                function listen(name, handler, position, once) {
                    assertOpen();
                    if (typeof handler !== "function") throw new TypeError("事件监听器必须是函数");
                    name = eventName(name);
                    let entries = listeners.get(name) || new Set();
                    let entry = Array.from(entries).find(item => item.handler === handler);
                    if (!entry) entry = { handler: handler, once: once === true };
                    if (position) entries.delete(entry);
                    if (position === "first") entries = new Set([entry].concat(Array.from(entries)));
                    else entries.add(entry);
                    listeners.set(name, entries);
                    return { stop: function () { remove(name, entry); } };
                }
                target.eventOn = function (name, handler) { return listen(name, handler); };
                target.eventOnce = function (name, handler) { return listen(name, handler, null, true); };
                target.eventMakeFirst = function (name, handler) { return listen(name, handler, "first"); };
                target.eventMakeLast = function (name, handler) { return listen(name, handler, "last"); };
                target.eventOff = function (name, handler) {
                    name = eventName(name);
                    for (const entry of Array.from(listeners.get(name) || [])) if (entry.handler === handler) remove(name, entry);
                };
                target.eventRemoveListener = target.eventOff;
                target.eventClearEvent = function (name) { listeners.delete(eventName(name)); };
                target.eventClearListener = function (handler) {
                    for (const [name, entries] of listeners) for (const entry of Array.from(entries)) if (entry.handler === handler) remove(name, entry);
                };
                clearLocalEvents = function () { listeners.clear(); };
                target.eventClearAll = clearLocalEvents;
                target.eventEmit = async function (name) {
                    assertOpen();
                    name = eventName(name);
                    const args = Array.prototype.slice.call(arguments, 1);
                    for (const entry of Array.from(listeners.get(name) || [])) {
                        // A listener removed by an earlier callback must not run.
                        if (!listeners.get(name)?.has(entry)) continue;
                        // Remove before invoking, even when a callback emits recursively.
                        if (entry.once) remove(name, entry);
                        await entry.handler.apply(null, args);
                    }
                };
            }
            if (typeof target.eventOn !== "function" || typeof target.eventOff !== "function" || typeof target.eventEmit !== "function") {
                throw new TypeError("事件工具需要已有事件总线或 localEvents 选项");
            }
            target.eventEmitAndWait = async function () {
                assertOpen();
                await target.eventEmit.apply(target, arguments);
            };

            function waitFor(name, read, checkCurrent) {
                return new Promise(function (resolve, reject) {
                    assertOpen();
                    let subscription, finished = false;
                    function stop() {
                        if (subscription && typeof subscription.stop === "function") subscription.stop();
                        else target.eventOff(name, listener);
                    }
                    function finish(success, value) {
                        if (finished) return;
                        finished = true;
                        pendingWaits.delete(cancel);
                        try { stop(); }
                        catch (error) { if (success) { success = false; value = error; } }
                        if (success) resolve(value);
                        else reject(value);
                    }
                    function cancel() { finish(false, closedError()); }
                    function listener() {
                        try {
                            const result = read(Array.prototype.slice.call(arguments));
                            if (result.ready) finish(true, result.value);
                        } catch (error) { finish(false, error); }
                    }
                    pendingWaits.add(cancel);
                    try {
                        subscription = target.eventOn(name, listener);
                        // Support a synchronous registration callback without leaking it.
                        if (finished) stop();
                        else if (checkCurrent) listener();
                    } catch (error) { finish(false, error); }
                });
            }
            // Convenience extension: resolves to the next emission's argument array.
            // Registration happens synchronously, so an immediate emit is not lost.
            target.eventWaitOnce = function (name) {
                return waitFor(name, function (args) { return { ready: true, value: args }; });
            };
            function globalName(name) {
                if (typeof name !== "string" || !name || name === "__proto__") throw new TypeError("全局接口名称无效");
                return name;
            }
            function settled(value) { return value !== undefined && !(value && value.__dshBootstrap === true); }
            target.initializeGlobal = function (name, value) {
                assertOpen();
                name = globalName(name);
                if (!Reflect.set(target, name, value)) throw new TypeError("全局接口不可写: " + name);
                return target.eventEmitAndWait("global_" + name + "_initialized");
            };
            target.waitGlobalInitialized = async function (name) {
                assertOpen();
                name = globalName(name);
                const value = target[name];
                if (settled(value)) return value;
                return await waitFor("global_" + name + "_initialized", function () {
                    const current = target[name];
                    return { ready: settled(current), value: current };
                }, true);
            };
            // Match the established event strings without replacing existing custom
            // constants. These are local notifications, not a cross-frame bridge.
            target.iframe_events = Object.freeze(Object.assign({
                MESSAGE_IFRAME_RENDER_STARTED: "message_iframe_render_started",
                MESSAGE_IFRAME_RENDER_ENDED: "message_iframe_render_ended",
                GENERATION_REQUESTED: "js_generation_requested",
                GENERATION_STARTED: "js_generation_started",
                STREAM_TOKEN_RECEIVED_FULLY: "js_stream_token_received_fully",
                STREAM_TOKEN_RECEIVED_INCREMENTALLY: "js_stream_token_received_incrementally",
                GENERATION_ENDED: "js_generation_ended"
            }, target.iframe_events || {}));
            target.tavern_events = Object.assign({
                MESSAGE_SENT: "MESSAGE_SENT",
                MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
                MESSAGE_UPDATED: "MESSAGE_UPDATED",
                MESSAGE_SWIPED: "MESSAGE_SWIPED",
                MESSAGE_DELETED: "MESSAGE_DELETED",
                MESSAGE_EDITED: "MESSAGE_EDITED",
                CHAT_CHANGED: "CHAT_CHANGED",
                CHAT_CREATED: "CHAT_CREATED",
                CHARACTER_PAGE_LOADED: "CHARACTER_PAGE_LOADED",
                GENERATION_AFTER_COMMANDS: "GENERATION_AFTER_COMMANDS",
                GENERATE_BEFORE_COMBINE_PROMPTS: "GENERATE_BEFORE_COMBINE_PROMPTS",
                USER_MESSAGE_RENDERED: "user_message_rendered",
                CHARACTER_MESSAGE_RENDERED: "character_message_rendered"
            }, target.tavern_events || {});
            const namespace = target.TavernHelper || (target.TavernHelper = {});
            for (const name of ["eventOn", "eventOnce", "eventMakeFirst", "eventMakeLast", "eventOff", "eventRemoveListener", "eventClearEvent", "eventClearListener", "eventClearAll", "eventEmit", "eventEmitAndWait", "eventWaitOnce", "initializeGlobal", "waitGlobalInitialized", "iframe_events", "tavern_events"]) {
                if (target[name] === undefined) continue;
                Object.defineProperty(namespace, name, { enumerable: true, configurable: true,
                    get: function () { return target[name]; }, set: function (value) { target[name] = value; } });
            }
            function dispose() {
                if (disposed) return;
                disposed = true;
                for (const cancel of Array.from(pendingWaits)) cancel();
                if (clearLocalEvents) clearLocalEvents();
                if (typeof target.removeEventListener === "function") target.removeEventListener("pagehide", dispose);
            }
            if (typeof target.addEventListener === "function") target.addEventListener("pagehide", dispose, { once: true });
            return { dispose: dispose };
        }
