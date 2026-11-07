		function createTavernHelperTransport(options) {
			const { parent, token, copy, identity, onContext, onEvent } = options;
			let nextId = 1;
			const pending = Object.create(null);
            let contextReady = null;
			const waitingEvents = new Set();
			function deliverEvent(data) {
				if (!contextReady) { onEvent(data); return; }
				const eventId = String(data.eventId || "");
				if (eventId) waitingEvents.add(eventId);
				contextReady.then(function () { if (eventId) waitingEvents.delete(eventId); onEvent(data); }, function (error) {
					if (eventId) waitingEvents.delete(eventId);
					// Without a usable context the handlers must not run; say so instead of going silent.
					if (eventId) post({ type: "dsh-tavern-helper-event-complete", eventId: eventId, error: "上下文同步失败：" + String(error && error.message || error), errorCode: "TAVERN_HELPER_CONTEXT_FAILED", args: copy(data.args || []) });
				});
			}
			function post(message) { parent.postMessage(Object.assign({}, message, { token: token }), "*"); }
			function request(method, args) {
				// A card may replace its document; DOM listeners must be restored before RPC.
				options.listen(receive);
				return new Promise(function (resolve, reject) {
					const requestId = String(nextId++);
					const owner = identity();
					pending[requestId] = { resolve: resolve, reject: reject, method: method, owner: owner };
					post(Object.assign({ type: "dsh-tavern-helper-call", requestId: requestId, method: method, args: copy(args || {}) }, owner));
				});
			}
			function receive(event) {
				const data = event && event.data;
				if (event.source !== parent || !data || data.token !== token) return;
				if (data.type === "dsh-tavern-helper-context") { const ready = Promise.resolve(onContext(data.contextDelta ? {contextDelta:data.contextDelta} : { context: data.context || {} })); contextReady = ready; ready.then(function () { if (contextReady === ready) contextReady = null; }, function (error) { console.error(error); }); return; }
				// Probes and receipt acks only read event bookkeeping, so a slow context sync must
				// not make a live sandbox look lost; only the event itself waits for its context.
				if (data.type === "dsh-tavern-helper-event-ack") { onEvent(data); return; }
				if (data.type === "dsh-tavern-helper-event-query") {
					if (waitingEvents.has(String(data.eventId || ""))) post({ type: "dsh-tavern-helper-event-state", eventId: String(data.eventId || ""), phase: "queued" });
					else onEvent(data);
					return;
				}
				if (data.type === "dsh-tavern-helper-event") { deliverEvent(data); return; }
				if (data.type !== "dsh-tavern-helper-response") return;
				const task = pending[data.requestId];
				if (!task) return;
				delete pending[data.requestId];
				if (data.ok) {
                    // A variable receipt may need a read-only resync before the
                    // caller can safely read its synchronous compatibility state.
                    try { Promise.resolve(onContext(data.result || {}, task.method)).then(function () { task.resolve(data.result); }, task.reject); }
                    catch (error) { task.reject(error); }
                }
				else {
					const error = new Error(String(data.error || "Helper 调用失败"));
					if (typeof data.errorCode === "string" && data.errorCode) error.code = data.errorCode;
					error.dshTavernScriptId = task.owner.scriptId;
					error.dshTavernEventId = task.owner.eventId;
					error.dshTavernMethod = task.method;
					task.reject(error);
				}
			}
			options.listen(receive);
			return Object.freeze({ request: request, post: post });
		}

		function createTavernHelperEventBus(options) {
			const { currentScript, withScript, reportSubscriptions, post } = options;
			const listeners = Object.create(null);
			function eventName(name) {
				const aliases = { message_sent: "MESSAGE_SENT", message_received: "MESSAGE_RECEIVED", message_updated: "MESSAGE_UPDATED", message_swiped: "MESSAGE_SWIPED", message_deleted: "MESSAGE_DELETED", message_edited: "MESSAGE_EDITED", chat_id_changed: "CHAT_CHANGED", chat_created: "CHAT_CREATED", character_page_loaded: "CHARACTER_PAGE_LOADED", generation_started: "GENERATION_STARTED", generation_stopped: "GENERATION_STOPPED", generation_ended: "GENERATION_ENDED", generation_after_commands: "GENERATION_AFTER_COMMANDS", generate_before_combine_prompts: "GENERATE_BEFORE_COMBINE_PROMPTS" };
				return aliases[String(name)] || String(name);
			}
			function removeEventEntry(name, entry) {
				if (listeners[name]) listeners[name].delete(entry);
				reportSubscriptions();
			}
			function listen(name, handler, position, once) {
				name = eventName(name);
				if (typeof handler !== "function") throw new TypeError("事件监听器必须是函数");
				let items = listeners[name] || (listeners[name] = new Set());
				let entry = Array.from(items).find(function (item) { return item.scriptId === currentScript().id && item.handler === handler; });
				if (!entry) entry = { scriptId: currentScript().id, handler: handler, once: once === true };
				if (position) items.delete(entry);
				if (position === "first") listeners[name] = new Set([entry].concat(Array.from(items)));
				else items.add(entry);
				reportSubscriptions();
				return { stop: function () { removeEventEntry(name, entry); } };
			}
			async function invokeEventEntry(name, entry, args) {
				if (!listeners[name] || !listeners[name].has(entry)) return;
				// Remove before calling so recursive emits cannot invoke a once-listener twice.
				if (entry.once) removeEventEntry(name, entry);
				const pending = withScript(entry.scriptId, function () { return entry.handler.apply(null, args); });
                return name === "mag_variable_initialized" && options.initializationTiming
                    ? await options.initializationTiming.wait("variable-initialized", pending, entry.scriptId) : await pending;
			}
			async function eventEmit(name) {
				name = eventName(name);
				const args = Array.prototype.slice.call(arguments, 1);
				const items = listeners[name] ? Array.from(listeners[name]) : [];
				// mvu_zod gates validation details on the official panel's checkbox.
				// Our executor has no visible panel: capture those errors for the receipt
				// without changing stored settings, commands, or validation behavior.
				let notification, previous;
				if (name === "mag_command_parsed_for_zod") {
					try {
						notification = options.document && options.document.getElementById("mvu_notification_error");
						if (notification) { previous = notification.checked; notification.checked = true; }
					} catch (_) { notification = null; }
				}
				try { for (const entry of items) await invokeEventEntry(name, entry, args); }
				finally { try { if (notification) notification.checked = previous; } catch (_) {} }
			}
			async function emitHostEvent(eventId, name, args) {
				name = eventName(name);
				// A synthetic empty CHAT_CHANGED resets Official MVU's last-chat guard while
				// keeping the real chatId; companion UIs must not treat it as leaving the chat.
				const mvuResetOnly = name === "CHAT_CHANGED" && Array.isArray(args) && args[0] === ""
					&& Boolean(options.context && String(options.context()?.chatId || ""));
				const items = (listeners[name] ? Array.from(listeners[name]) : []).filter(function (entry) {
					return !mvuResetOnly || entry.scriptId === "__dsh_official_mvu__";
				});
				for (const entry of items) {
					if (eventId) post({ type: "dsh-tavern-helper-event-progress", eventId: eventId, scriptId: entry.scriptId, phase: "started" });
					try { await invokeEventEntry(name, entry, args); }
					catch (error) {
						if (error && typeof error === "object" && !error.dshTavernScriptId) error.dshTavernScriptId = entry.scriptId;
						if (eventId) post({ type: "dsh-tavern-helper-event-progress", eventId: eventId, scriptId: entry.scriptId, phase: "failed" });
						throw error;
					}
					if (eventId) post({ type: "dsh-tavern-helper-event-progress", eventId: eventId, scriptId: entry.scriptId, phase: "completed" });
				}
			}
			function off(name, handler) {
				name = eventName(name);
				if (listeners[name]) for (const entry of Array.from(listeners[name])) if (entry.handler === handler && entry.scriptId === currentScript().id) listeners[name].delete(entry);
				reportSubscriptions();
			}
			function clearMatching(predicate) {
				const scriptId = currentScript().id;
				for (const name of Object.keys(listeners)) for (const entry of Array.from(listeners[name])) {
					if (entry.scriptId === scriptId && predicate(name, entry)) listeners[name].delete(entry);
				}
				reportSubscriptions();
			}
			return Object.freeze({
				clearEvent: function (name) { name = eventName(name); clearMatching(function (key) { return key === name; }); },
				clearListener: function (handler) { clearMatching(function (_name, entry) { return entry.handler === handler; }); },
				clearAll: function () { clearMatching(function () { return true; }); },
				listen: listen, off: off, emit: eventEmit, emitHost: emitHostEvent,
				names: function () { return Object.keys(listeners).filter(function (name) { return listeners[name] && listeners[name].size > 0; }); },
				subscriptionsFor: function (scriptId) { return Object.keys(listeners).filter(function (name) { return listeners[name] && Array.from(listeners[name]).some(function (entry) { return entry.scriptId === scriptId; }); }); }
			});
		}

		function createTavernHelperPopup(options) {
			const { document, parent, token } = options;
			const formattingTags = new Set("b blockquote br code dd div dl dt em h1 h2 h3 h4 h5 h6 hr i li ol p pre small span strong sub sup table tbody td th thead tr u ul".split(" "));
			function popupMarkup(raw) {
				// Parse inertly, then allow only formatting markup and passive attributes.
				const template = document.createElement("template");
				template.innerHTML = raw;
				for (const element of template.content.querySelectorAll("*")) {
					if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || !formattingTags.has(element.localName)) {
						element.remove();
						continue;
					}
					for (const name of element.getAttributeNames()) {
						if (name !== "class" && name !== "title") element.removeAttribute(name);
					}
				}
				return template.content;
			}
			function HelperPopup(content, type, title, options) {
				const popup = this;
				popup.content = content;
				popup.options = options && typeof options === "object" ? options : {};
				popup.root = null;
				popup.resolve = null;
				async function complete(result) {
					if (popup.root) popup.root.remove();
					popup.root = null;
					parent.postMessage({ type: "dsh-tavern-helper-ui-close", token: token }, "*");
					if (popup.resolve) { const resolve = popup.resolve; popup.resolve = null; resolve(result); }
					return result;
				}
				popup.completeAffirmative = function () { return complete(true); };
				popup.completeNegative = function () { return complete(false); };
				popup.show = function () {
					if (popup.root) return Promise.resolve(false);
					const overlay = document.createElement("div");
					overlay.setAttribute("data-dsh-helper-popup", "");
					overlay.style.cssText = "position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.64);box-sizing:border-box";
					const panel = document.createElement("section");
					panel.style.cssText = "width:min(920px,100%);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:16px;background:#15191f;color:#eef4fb;box-shadow:0 24px 80px rgba(0,0,0,.5);box-sizing:border-box";
					if (title) { const heading = document.createElement("h2"); heading.textContent = String(title); panel.appendChild(heading); }
					const node = content && content.jquery ? content[0] : content;
					if (node && typeof node.nodeType === "number") panel.appendChild(node);
					else if (node !== undefined && node !== null) {
						const text = document.createElement("div");
						const raw = String(node);
						if (/<[a-z][\s\S]*>/i.test(raw)) text.appendChild(popupMarkup(raw));
						else { text.style.whiteSpace = "pre-wrap"; text.textContent = raw; }
						panel.appendChild(text);
					}
					const actions = document.createElement("div");
					actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:14px";
					const close = document.createElement("button");
					close.type = "button"; close.textContent = String(popup.options.okButton || "关闭");
					close.style.cssText = "border:1px solid rgba(255,255,255,.24);border-radius:9px;padding:7px 14px;background:#273241;color:#fff;cursor:pointer";
					close.addEventListener("click", popup.completeAffirmative);
					actions.appendChild(close);
					const cancelButton = popup.options.cancelButton;
					const hasCancel = cancelButton === true || (typeof cancelButton === "string" && cancelButton !== "") || (type === "confirm" && cancelButton !== false);
					if (hasCancel) {
						const cancel = document.createElement("button");
						cancel.type = "button"; cancel.textContent = typeof cancelButton === "string" && cancelButton ? cancelButton : "取消";
						cancel.style.cssText = "border:1px solid rgba(255,255,255,.24);border-radius:9px;padding:7px 14px;background:rgba(255,255,255,.08);color:#eef4fb;cursor:pointer";
						cancel.addEventListener("click", popup.completeNegative);
						actions.appendChild(cancel);
					}
					panel.appendChild(actions); overlay.appendChild(panel); document.body.appendChild(overlay);
					popup.root = overlay;
					parent.postMessage({ type: "dsh-tavern-helper-ui-open", token: token }, "*");
					return new Promise(function (resolve) { popup.resolve = resolve; });
				};
			}
			return HelperPopup;
		}

		function createTavernChatDataFacade(options) {
			const { copy, request } = options;
			const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
			const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
			const reserved = new Set(["message_id", "message", "mes", "role", "is_user", "is_system", "name", "send_date", "swipe_id", "swipes", "swipes_data", "variables", "pluginData", "original_avatar", "force_avatar"]);
			let chat = [], metadata = {}, rows = [], metadataBase = {}, metadataRevision = 0;
			let binding = "", chatId = "", lifecycleRevision = 0, lastRevision = -1;
			let tail = Promise.resolve(), saving = false, deferred = null;
			function keyOf(value) { return String(value.chatId || "") + ":" + Number(value.lifecycleRevision || 0); }
			function set(target, key, value) {
				Object.defineProperty(target, key, { value: copy(value), writable: true, configurable: true, enumerable: true });
			}
			function reconcile(target, source) {
				for (const key of Object.keys(target)) if (!own(source, key)) delete target[key];
				for (const key of Object.keys(source)) {
					const a = own(target, key) ? target[key] : undefined, b = source[key];
					if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
						reconcile(a, b); if (Array.isArray(a)) a.length = b.length;
					} else set(target, key, b);
				}
			}
			function pluginData(value) {
				const result = {};
				for (const key of Object.keys(value)) if (!reserved.has(key)) set(result, key, value[key]);
				return result;
			}
			function mergeView(target, base, remote, fields) {
				for (const key of new Set(Object.keys(base).concat(Object.keys(remote)))) {
					if (fields && !fields(key)) continue;
					if (own(target, key) !== own(base, key) || !same(target[key], base[key])) continue;
					if (!own(remote, key)) delete target[key];
					else if (target[key] && remote[key] && typeof target[key] === "object" && typeof remote[key] === "object" && Array.isArray(target[key]) === Array.isArray(remote[key])) {
						reconcile(target[key], remote[key]); if (Array.isArray(target[key])) target[key].length = remote[key].length;
					} else set(target, key, remote[key]);
				}
			}
			function coreOf(message) {
				const core = copy(message); delete core.pluginData;
				core.mes = String(message.message || ""); core.is_user = message.role === "user";
				core.variables = copy(message.swipes_data || []);
				return core;
			}
			function identity(core) { return [core.message_id, core.role, core.message, core.swipe_id, core.swipes]; }
			function layoutMatches() { return exposedLayoutMatches() && chat.length === rows.length && rows.every((row, index) => chat[index] === row.view); }
			function dirty() { return !layoutMatches() || !same(metadata, metadataBase) || rows.some(row => !row.core.stub && (!same(pluginData(row.view), row.base) || !same(row.view.variables, row.variablesBase))); }
			function sync(value, acknowledged, variableDelta) {
				if (!value) return;
				if (saving && !acknowledged) {
					if (!deferred || keyOf(value) !== keyOf(deferred) || Number(value.stateRevision || 0) >= Number(deferred.stateRevision || 0)) deferred = copy(value);
					return;
				}
				const nextBinding = keyOf(value), revision = Number(value.stateRevision || 0);
				if (binding !== nextBinding) {
					if (binding && dirty()) console.warn("聊天或历史版本已切换，未保存的插件编辑已隔离，请在当前聊天重新操作");
					chat = []; rows = []; metadata = {}; metadataBase = {}; metadataRevision = revision; lastRevision = -1;
					binding = nextBinding;
				}
				if (revision < lastRevision && !acknowledged) return;
				chatId = String(value.chatId || ""); lifecycleRevision = Number(value.lifecycleRevision || 0);
                const variablesOnly = variableDelta && !acknowledged && revision === variableDelta.stateRevision
                    && lastRevision === (variableDelta.kind === 'transaction' ? variableDelta.stateRevision : variableDelta.baseRevision)
                    && rows.length === (value.messages || []).length;
                const changedRows = variableDelta?.version === 2 ? new Set((variableDelta.messages || []).map(m=>m.message_id)) : new Set([variableDelta?.messageId]);
                function mergeRow(message, index) {
                    if(message?.stub && rows[index] && !rows[index].core.stub && options.readMessage
                        && !same(pluginData(rows[index].view),rows[index].base)) message=options.readMessage(index);
					const core = coreOf(message), remote = copy(message.pluginData || {});
					let row = rows[index];
					if (!row || !same(identity(row.core), identity(core))) {
						const view = copy(remote); for (const key of Object.keys(core)) set(view, key, core[key]);
						return { view: view, core: core, base: remote, revision: revision, variablesBase: core.variables, variablesRevision: revision };
					}
					const ack = acknowledged && acknowledged.messages.find(item => item.message_id === core.message_id);
					mergeView(row.view, ack ? ack.data : row.base, remote, key => !reserved.has(key));
					const variableAck = acknowledged && (acknowledged.variableUpdates || []).find(item => item.message_id === core.message_id);
                    const priorCore = Object.assign({}, row.core, { variables: variableAck ? copy(row.variablesBase) : row.variablesBase });
                    if (variableAck) priorCore.variables[variableAck.swipe_id] = copy(variableAck.data);
                    mergeView(row.view, priorCore, core, key => reserved.has(key));
                    if (variableAck || same(row.view.variables, core.variables)) { row.variablesBase = core.variables; row.variablesRevision = revision; }
					row.core = core;
					if (ack || same(pluginData(row.view), remote)) { row.base = remote; row.revision = revision; }
					return row;
                }
                if (variablesOnly) {
                    // Preserve arbitrary unsaved plugin edits, including an invalid
                    // layout elsewhere. Full save still checks every row; a receipt
                    // must neither scan nor silently repair untouched plugin data.
                    if (chat.length !== rows.length || [...changedRows].some(id => !rows[id] || chat[id] !== rows[id].view)) return;
                    for (const id of changedRows) {
                        rows[id] = mergeRow(value.messages[id], id);
                        chat[id] = rows[id].view;
                    }
                } else {
                    if (!layoutMatches()) return;
                    rows = (value.messages || []).map(mergeRow);
                    chat.splice(0, chat.length, ...rows.map(row => row.view));
                    refreshExposed();
                }
				const remoteMetadata = copy(value.chatMetadata || {}), ackMetadata = acknowledged && acknowledged.metadata;
				mergeView(metadata, ackMetadata ? ackMetadata.data : metadataBase, remoteMetadata);
				if (ackMetadata || same(metadata, remoteMetadata)) { metadataBase = remoteMetadata; metadataRevision = revision; }
				lastRevision = revision;
			}
			function snapshot() {
				if (!layoutMatches()) throw new Error("saveChat 不支持新增、删除、替换或重排历史消息");
				const messages = [], variableUpdates = [];
				for (const row of rows) {
                    if (row.core.stub) continue;
					for (const key of reserved) if (key !== "variables" && (own(row.view, key) !== own(row.core, key) || !same(row.view[key], row.core[key]))) throw new Error("saveChat 不支持修改正文、身份或消息版本: " + key);
                    if (!same(row.view.variables, row.variablesBase)) {
                        const desired = row.view.variables, base = row.variablesBase, swipe = row.core.swipe_id || 0;
                        if (!Array.isArray(desired) || !Array.isArray(base) || desired.length !== base.length || !base[swipe]
                            || desired.some((value, index) => index !== swipe && !same(value, base[index]))) throw new Error("saveChat 不支持删除变量历史或修改其他消息版本");
                        variableUpdates.push({message_id:row.core.message_id, swipe_id:swipe, stateRevision:row.variablesRevision, data:copy(desired[swipe])});
                    }
					const data = pluginData(row.view);
					if (!same(data, row.base)) messages.push({ message_id: row.core.message_id, stateRevision: row.revision, data: data });
				}
				const result = { chatId: chatId, lifecycleRevision: lifecycleRevision, messages: messages };
                if (variableUpdates.length) result.variableUpdates = variableUpdates;
				if (!same(metadata, metadataBase)) result.metadata = { stateRevision: metadataRevision, data: copy(metadata) };
				return result;
			}
			function save() {
				const requestedBinding = binding;
				const task = tail.catch(function () {}).then(async function () {
					if (binding !== requestedBinding) throw new Error("聊天已切换，已取消旧聊天的排队保存");
					const submitted = snapshot();
					if (!submitted.messages.length && !submitted.metadata && !submitted.variableUpdates?.length) return;
					saving = true;
					try {
						const result = await request("saveTavernChatData", { request: submitted });
						if (!result || result.updated !== true || !result.context) throw new Error("插件聊天数据未保存");
						sync(result.context, submitted);
					} finally {
						saving = false;
						const pending = deferred; deferred = null; if (pending) sync(pending);
					}
				});
				tail = task;
				task.catch(function (error) { console.error(error); });
				return task;
			}
			function updateMetadata(values, reset) {
				if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("聊天元数据必须是对象");
				if (reset) reconcile(metadata, values);
				else for (const key of Object.keys(values)) set(metadata, key, values[key]);
			}
            let exposed, exposedFor, accessors=[];
            function exposedLayoutMatches() {
                if(exposedFor!==chat)return true;
                if(exposed.length!==chat.length)return false;
                return accessors.slice(0,chat.length).every((pair,id)=>{
                    const descriptor=Object.getOwnPropertyDescriptor(exposed,String(id));
                    return descriptor?.get===pair.get && descriptor?.set===pair.set;
                });
            }
            function refreshExposed() {
                if(exposedFor!==chat)return;
                const target=chat;
                exposed.length=chat.length;
                for(let id=0;id<chat.length;id++) {
                    if(Object.hasOwn(exposed,id))continue;
                    const pair={
                        get() {
                            if(target===chat && rows[id]?.core.stub && chat[id]===rows[id].view && options.readMessage) {
                                const source=options.readMessage(id), core=coreOf(source), remote=copy(source.pluginData || {});
                                const view=copy(remote);for(const field of Object.keys(core))set(view,field,core[field]);
                                rows[id]={view,core,base:remote,revision:lastRevision,variablesBase:core.variables,variablesRevision:lastRevision};chat[id]=view;
                            }
                            return target[id];
                        },
                        set(value) {target[id]=value;}
                    };
                    accessors[id]=pair;
                    Object.defineProperty(exposed,String(id),{...pair,enumerable:true,configurable:true});
                }
            }
            function exposedChat() {
                if(exposedFor===chat)return exposed;
                exposedFor=chat;exposed=[];accessors=[];refreshExposed();
                return exposed;
            }
            sync(options.context());
            return { sync: sync, save: save, updateMetadata: updateMetadata, chat: () => options.readMessage ? exposedChat() : chat, metadata: () => metadata };
		}

		function installTavernCompatibilityDiagnostics(options) {
			const counts = new Map();
			for (const entry of options.catalog || []) {
				const target = options.surfaces[entry.surface];
				if (!target || !["noop", "reject", "missing"].includes(entry.policy)) continue;
				function record(args) {
					const scriptId = options.currentScript().id;
					const key = scriptId + "\n" + entry.id;
					const count = Math.min(Number.MAX_SAFE_INTEGER, (counts.get(key) || 0) + 1);
					counts.set(key, count);
					// typeof never traverses plugin objects, invokes getters or serializes secrets.
					const argumentTypes = Array.from(args).slice(0, 12).map(value => value === null ? "null" : typeof value);
					options.post({ type: "dsh-tavern-helper-compatibility", scriptId: scriptId, capabilityId: entry.id, count: count, argumentTypes: argumentTypes });
				}
				if (entry.policy === "missing") {
					// Preserve typeof-based fallbacks. This records a lookup, never a successful call.
					Object.defineProperty(target, entry.name, { configurable: true, get: function () { record([]); return undefined; },
						set: function (value) { Object.defineProperty(target, entry.name, { value: value, configurable: true, writable: true }); } });
				} else target[entry.name] = function () {
					record(arguments);
					if (entry.policy === "reject") {
						const error = new Error("[unsupported] " + entry.id + " 尚未实现，操作未执行");
						error.code = "TAVERN_CAPABILITY_UNSUPPORTED";
						throw error;
					}
				};
				// Helper scripts also use the same APIs as bare window globals.
				if (entry.surface === "TavernHelper") Object.defineProperty(options.window, entry.name, {
					configurable: true, get: function () { return target[entry.name]; }, set: function (value) { target[entry.name] = value; }
				});
			}
		}

		// @include local-variables.js
        // @include variable-receipts.js
        applyTavernVariableReceipt.indexApi = createIndexedArrayApi({valid: row => Boolean(row && !row.stub), eligible: row => Boolean(row?.variables?.stat_data !== undefined && row?.variables?.schema !== undefined)});
        applyTavernVariableReceipt.turnFields = createTurnFieldIndex();

		function installTavernHelperFacade(options) {
			const nativeWorldInfoSnapshots = new WeakMap();
			const nativeWorldInfoByName = new Map();
			const functionTools = new Map();
			const { window, copy, context, request: call, Popup: HelperPopup } = options;
			const chatData = options.createChatData({ copy: copy, context: context, request: call, readMessage:options.readMessage });
            const localVariables = options.createLocalVariables({ context, request: call, copy, currentScript: options.currentScript, reportError: error => console.error(error) });
            async function saveChatData() {
                const chatId = context().chatId, revision = context().lifecycleRevision;
                await localVariables.flush();
                if (context().chatId !== chatId || context().lifecycleRevision !== revision) throw new Error("聊天已切换或历史版本已变化，插件数据未保存");
                return chatData.save();
            }
			const extensionSettings = Object.assign(Object.create(null), copy(context().extensionSettings || {}));
			// Tavern applies enabled card regexes without ST's per-avatar opt-in.
			// Project that host-owned permission without persisting a fabricated setting.
			const visibleExtensionSettings = new Proxy(extensionSettings, {
                set: function (target, key, value) {
                    target[key] = key === "mvu_settings" && options.normalizeMvuSettings ? options.normalizeMvuSettings(value, target[key]) : value;
                    return true;
                },
				get: function (target, key) {
                    if (key === "mvu_settings" && options.projectMvuSettings) return options.projectMvuSettings(target[key]);
                    if (key === "regex" && !Array.isArray(target.regex)) return options.readGlobalRegexes ? options.readGlobalRegexes() : [];
					if (key !== "character_allowed_regex") return target[key];
					const allowed = Array.isArray(target[key]) ? target[key].slice() : [];
					const character = context().character;
					if (character && typeof character === "object") {
						const avatar = character.avatar || String(character.path || "");
						if (!allowed.includes(avatar)) allowed.push(avatar);
					}
					return allowed;
				}
			});
			let savedExtensionSettings = copy(extensionSettings);
			let settingsTail = Promise.resolve();
			// Keep plugin-held object references stable when acknowledging persisted settings.
			function reconcileSettings(target, source) {
				for (const key of Object.keys(target)) if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
				for (const key of Object.keys(source)) {
					const value = source[key], previous = Object.prototype.hasOwnProperty.call(target, key) ? target[key] : undefined;
					if (value && previous && typeof value === "object" && typeof previous === "object" && Array.isArray(value) === Array.isArray(previous)) {
						reconcileSettings(previous, value);
						if (Array.isArray(previous)) previous.length = value.length;
					} else Object.defineProperty(target, key, { value: copy(value), enumerable: true, configurable: true, writable: true });
				}
			}
			function saveExtensionSettings() {
				// Serialize calls without an unload-sensitive debounce timer. Capture at execution
				// time so a burst of legacy fire-and-forget calls saves the newest edits.
				const task = settingsTail.catch(function () {}).then(async function () {
					const submitted = JSON.parse(JSON.stringify(extensionSettings));
					const result = await call("saveTavernExtensionSettings", { settings: submitted, expectedSettings: savedExtensionSettings });
					if (!result || !result.extensionSettings || result.updated === false) throw new Error("插件设置未保存");
					const remote = result.extensionSettings;
					for (const key of new Set(Object.keys(submitted).concat(Object.keys(remote)))) {
						// Edits made while the write was in flight stay dirty for the next call.
						if (JSON.stringify(extensionSettings[key]) !== JSON.stringify(submitted[key])) continue;
						if (Object.prototype.hasOwnProperty.call(remote, key)) {
							const patch = Object.create(null); patch[key] = remote[key];
							const current = Object.create(null);
							if (Object.prototype.hasOwnProperty.call(extensionSettings, key)) current[key] = extensionSettings[key];
							reconcileSettings(current, patch);
							Object.defineProperty(extensionSettings, key, { value: current[key], enumerable: true, configurable: true, writable: true });
						} else delete extensionSettings[key];
					}
					savedExtensionSettings = copy(remote);
					return copy(remote);
				});
				settingsTail = task;
				task.catch(function (error) { console.error(error); });
				return task;
			}
			// Both entry points reference the same functions; plugin wrappers stay visible to each other.
			const helper = {};
			const helperNames = ["formatAsTavernRegexedString", "isCharacterTavernRegexesEnabled", "getMessageId", "getIframeName", "errorCatched", "retrieveDisplayedMessage", "initializeGlobal", "waitGlobalInitialized", "triggerSlash", "generateRaw", "injectPrompts", "uninjectPrompts", "getScriptId", "getScriptName", "getScriptInfo", "replaceScriptInfo", "getScriptButtons", "getAllEnabledScriptButtons", "replaceScriptButtons", "updateScriptButtonsWith", "appendInexistentScriptButtons", "getButtonEvent", "getCharData", "getCurrentCharacterName", "getCurrentMessageId", "getLastMessageId", "getChatMessages", "setChatMessages", "createChatMessages", "getVariables", "getAllVariables", "replaceVariables", "insertOrAssignVariables", "insertVariables", "updateVariablesWith", "deleteVariable", "getTavernRegexes", "replaceTavernRegexes", "updateTavernRegexesWith", "importRawTavernRegex", "replaceWorldbook", "createWorldbookEntries", "deleteWorldbookEntries", "setLorebookEntries", "createLorebookEntries", "deleteLorebookEntries", "getLorebooks", "getWorldbookNames", "getCharWorldbookNames", "getGlobalWorldbookNames", "getChatWorldbookName", "getWorldbook", "getLorebookEntries", "getCharLorebooks", "getCurrentCharPrimaryLorebook", "getLorebookSettings", "setLorebookSettings", "updateWorldbookWith", "getTavernHelperVersion", "substitudeMacros", "iframe_events", "tavern_events"];
			for (const name of helperNames) Object.defineProperty(helper, name, { enumerable: true, configurable: true, get: function () { return window[name]; }, set: function (value) { window[name] = value; } });
			window.TavernHelper = helper;
			const eventSource = { on: window.eventOn, once: window.eventOnce, off: window.eventOff, removeListener: window.eventOff, makeFirst: window.eventMakeFirst, makeLast: window.eventMakeLast, emit: window.eventEmit };
			const sillyTavern = {
				TavernHelper: helper,
                variables: Object.freeze({ local: localVariables.api }),
				substituteParams: function (value) { return window.substitudeMacros(value); },
				getContext: function () { return sillyTavern; },
				eventSource: eventSource,
				eventTypes: window.tavern_events,
				Popup: HelperPopup,
				POPUP_TYPE: Object.freeze({ DISPLAY: "display", TEXT: "text", CONFIRM: "confirm", INPUT: "input" }),
				POPUP_RESULT: Object.freeze({ AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null, CUSTOM1: 2 }),
				extensionSettings: visibleExtensionSettings,
				// These ST rewriting/media restrictions are disabled in Tavern rendering.
				powerUserSettings: Object.freeze({ auto_fix_generated_markdown: false, trim_sentences: false, forbid_external_media: false, encode_tags: false }),
				get characters() {
					const character = options.readCharacter ? options.readCharacter() : context().character;
					if (!character || typeof character !== "object") return [];
					const current = copy(character);
                    if (!current.data) current.data = copy(character);
                    // Legacy exports wrap scripts in {type, value}; expose the same
                    // effective script records that the host execution reader uses.
                    const extensions = current.data.extensions;
                    if (Array.isArray(extensions?.TavernHelper_scripts)) {
                        extensions.TavernHelper_scripts = extensions.TavernHelper_scripts.map(function (entry) {
                            if (entry?.type !== "script" || !entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)) return entry;
                            return Object.assign({}, entry.value, { type: entry.type,
                                enabled: entry.enabled !== false && entry.disabled !== true && entry.value.enabled !== false && entry.value.disabled !== true });
                        });
                    }
					if (!current.avatar) current.avatar = String(current.path || "");
					return [current];
				},
				get characterId() { return context().character && typeof context().character === "object" ? 0 : undefined; },
				chatCompletionSettings: {},
				ToolManager: Object.freeze({ isToolCallingSupported: function () { return false; } }),
				isToolCallingSupported: function () { return false; },
				canPerformToolCalls: function () { return false; },
				registerFunctionTool: function (tool) {
					if (!tool || typeof tool !== "object" || Array.isArray(tool)) throw new TypeError("Function Tool 定义无效");
					const name = String(tool.name || "").trim();
					if (!name) throw new TypeError("Function Tool 名称不能为空");
					if (typeof tool.action !== "function") throw new TypeError("Function Tool action 必须是函数");
					if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) throw new TypeError("Function Tool parameters 必须是 JSON Schema 对象");
					functionTools.set(name, tool);
				},
				unregisterFunctionTool: function (name) { functionTools.delete(String(name || "")); },
				getCurrentChatId: function () { return String(context().chatId || ""); },
				getCurrentLocale: function () { return "zh-CN"; },
				getCharacterCardFields: function () { const character = options.readCharacter ? options.readCharacter() : context().character; return copy(character && (character.data || character) || {}); },
				loadWorldInfo: async function (name) {
					const result = await call("loadTavernWorldInfo", { name: name });
					const document = copy(result.worldInfo);
					nativeWorldInfoSnapshots.set(document, copy(document));
					nativeWorldInfoByName.set(String(name || "current"), copy(document));
					return document;
				},
				saveWorldInfo: async function (name, document) {
					const expected = nativeWorldInfoSnapshots.get(document) || nativeWorldInfoByName.get(String(name || "current"));
					if (!expected) throw new Error("保存前请先读取世界书");
					const result = await call("saveTavernWorldInfo", { name: name, worldInfo: copy(document), expectedWorldInfo: copy(expected) });
					if (!result || result.updated === false) throw new Error("世界书未保存");
					nativeWorldInfoSnapshots.set(document, copy(result.worldInfo));
					nativeWorldInfoByName.set(String(name || "current"), copy(result.worldInfo));
					context().worldbook = copy(result.worldbook);
				},
				callGenericPopup: function (content, type, title, options) {
					// MVU's legacy JSONL compaction is not a DSH history operation. Decline only
					// this maintenance prompt; never delete snapshots or dismiss other confirms.
					const legacyCleanup = typeof content === "string" && (
						content.startsWith("检测到可以清理本聊天文件中的旧变量以减小文件体积，是否清理？") ||
						content.startsWith("Old variables can be removed from this chat to reduce its file size. Clean them now?")
					);
					if (type === "confirm" && legacyCleanup) return Promise.resolve(0);
					return new HelperPopup(content, type, title, options).show().then(function (result) { return result ? 1 : 0; });
				},
				saveChat: saveChatData,
				saveMetadata: saveChatData,
				saveMetadataDebounced: saveChatData,
				updateChatMetadata: chatData.updateMetadata,
				saveSettingsDebounced: saveExtensionSettings,
				// ST answers from the device class; scripts use it to pick a layout.
				isMobile: function () {
					try { return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse) and (max-width: 1000px)").matches; }
					catch (_) { return false; }
				}
			};
			Object.defineProperties(sillyTavern, {
				chatId: { enumerable: true, get: function () { return String(context().chatId || ""); } },
				name1: { enumerable: true, get: function () { return String(context().playerName || "你"); } },
				chat: { enumerable: true, get: chatData.chat },
				chatMetadata: { enumerable: true, get: chatData.metadata },
				name2: { enumerable: true, get: function () { return String(context().characterName || "角色"); } }
			});
			options.installCompatibility({ catalog: context().compatibilityCapabilities, surfaces: { TavernHelper: helper, SillyTavern: sillyTavern }, window: window, currentScript: options.currentScript, post: options.post });
			window.SillyTavern = Object.freeze(sillyTavern);
			window.getContext = sillyTavern.getContext;
			window.errorCatched = function (factory) { return function () { try { return factory.apply(this, arguments); } catch (error) { console.error(error); return {}; } }; };
			// Trusted card scripts reach the displayed message like in SillyTavern.
			window.retrieveDisplayedMessage = function (messageId) {
				let found = [];
				try {
					const frame = window.frameElement, host = window.parent;
					// Copy into this realm: jQuery treats another realm's array as one object.
					if (frame && host && host !== window && typeof host.__dshTavernScriptLayers === "function") found = Array.prototype.slice.call(host.__dshTavernScriptLayers(frame.__dshTavernSessionId, Number(messageId)));
				} catch (_) { /* Sandboxed scripts cannot reach the host page. */ }
				return window.jQuery ? window.jQuery(found) : found;
			};
			window.toastr = { success: console.info, info: console.info, warning: console.warn, error: console.error };
			return { sync: function (value, variableDelta) { chatData.sync(value, undefined, variableDelta); localVariables.sync(); }, flushVariables: localVariables.flush };
		}
