        function createTavernInitializationTiming(options = {}) {
            const now = options.now || Date.now;
            const schedule = options.schedule || setTimeout;
            const cancel = options.cancel || clearTimeout;
            const report = options.report || function () {};
            const startedAt = now(), groups = new Map(), active = new Map();
            let nextId = 0, timer = null, closed = false, dirty = false, dropped = 0;
            function snapshot() {
                const at = now();
                return { elapsedMs: Math.max(0, at - startedAt), dropped,
                    entries: Array.from(groups.values()).map(function (row) {
                        const starts = Array.from(active.values()).filter(item => item.key === row.key).map(item => item.at);
                        const { key, ...value } = row;
                        return { ...value, pending: starts.length, oldestPendingMs: starts.length ? Math.max(0, at - Math.min(...starts)) : 0 };
                    }) };
            }
            function flush() {
                timer = null;
                if (dirty || active.size) { dirty = false; try { report(snapshot()); } catch (_) {} }
                if (closed) return;
                if (now() - startedAt >= 180000) { closed = true; return; }
                if (active.size || dirty) arm();
            }
            function arm() { timer = schedule(flush, 5000); if (timer && typeof timer.unref === "function") timer.unref(); }
            async function wait(stage, promise, scriptId = '') {
                if (closed) return await promise;
                const key = stage + '\n' + scriptId;
                if (!groups.has(key)) {
                    if (groups.size >= 32) { dropped++; return await promise; }
                    groups.set(key, { key, stage, scriptId, count: 0, failures: 0, totalMs: 0, maxMs: 0 });
                }
                const row = groups.get(key), id = ++nextId, at = now();
                active.set(id, { key, at }); dirty = true;
                if (!timer) arm();
                try { return await promise; }
                catch (error) { row.failures++; throw error; }
                finally {
                    const duration = Math.max(0, now() - at);
                    active.delete(id); row.count++; row.totalMs += duration; row.maxMs = Math.max(row.maxMs, duration); dirty = true;
                    if (!closed && !timer) arm();
                }
            }
            function dispose() { if (timer) cancel(timer); timer = null; closed = true; flush(); }
            return { wait, snapshot, dispose };
        }

		function tavernHelperScriptBootstrap(metadata, initialContext, modules) {
            // Every page switch tears the frame down, and a detached frame loses
            // window.parent; a report from then on has no reader and must not throw.
            function postToHost(message, target) {
                const host = window.parent;
                if (!host || typeof host.postMessage !== "function") return false;
                try { host.postMessage(message, target || "*"); return true; } catch (_) { return false; }
            }
            modules.applyVariableReceipt.indexApi = modules.createIndexedArrayApi({valid: row => Boolean(row && !row.stub), eligible: row => Boolean(row?.variables?.stat_data !== undefined && row?.variables?.schema !== undefined)});
            modules.applyVariableReceipt.turnFields = modules.createTurnFieldIndex({createIndex:modules.createOrderedNumericIndex,visit:function(){}});
            const initializationTiming = modules.createInitializationTiming({ report: function (timings) { postToHost({ type: "dsh-tavern-mvu-load-diagnostic", token: metadata.token, diagnostic: { phase: "initialization-timing", timings: timings } }, "*"); } });
            window.__dshTavernInitializationTiming = initializationTiming;
            window.addEventListener("pagehide", initializationTiming.dispose, { once: true });
			if (modules.installFrameStorage) modules.installFrameStorage(metadata.frameStorage); // persistent card storage
			try { void window.localStorage; }
			catch (_) {
				let values = Object.create(null);
				let keys = [];
				const storage = {
					getItem: function (key) { key = String(key); return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
					setItem: function (key, value) { key = String(key); if (!Object.prototype.hasOwnProperty.call(values, key)) keys.push(key); values[key] = String(value); },
					removeItem: function (key) { key = String(key); if (!Object.prototype.hasOwnProperty.call(values, key)) return; delete values[key]; keys.splice(keys.indexOf(key), 1); },
					clear: function () { values = Object.create(null); keys = []; },
					key: function (index) { return index >= 0 && index < keys.length ? keys[index] : null; }
				};
				Object.defineProperty(storage, "length", { get: function () { return keys.length; } });
				try { Object.defineProperty(window, "localStorage", { configurable: true, value: storage }); } catch (_) {}
			}
			let state = initialContext && typeof initialContext === "object" ? initialContext : {};
            const resources = modules.createResourceReader();
            function readCharacter() {
                if (!state.characterResourceAccess) return state.character;
                const character = resources.read(state.characterResourceAccess);
                return character && !character.data ? {...character, data: copy(character)} : character;
            }
            state = {...state, messages:modules.applyVariableReceipt.indexApi.from(state.messages || [])};
            const readMessage = modules.createHistoryReader({context:()=>state,install:row=>{
                row.mes=row.message; row.is_user=row.role==='user'; row.is_system=row.role==='system';
                if(!row.name)row.name=row.is_user ? (state.playerName || '你') : (state.characterName || '角色');
                state = {...state,messages:modules.applyVariableReceipt.indexApi.update(state.messages,[[row.message_id,row]])};
            }});
			const token = String(metadata.token || "");
			const officialMvuEnabled = metadata.officialMvu === true;
			let lorebookSettings = { selected_global_lorebooks: [] };
			const scriptList = (Array.isArray(metadata.scripts) ? metadata.scripts : [metadata]).map(function (script) {
				return {
					id: String(script && script.id || ""),
					name: String(script && script.name || script && script.id || ""),
					info: String(script && script.info || ""),
					buttons: Array.isArray(script && script.buttons) ? script.buttons : [],
                    buttonsEnabled: !script || script.buttonsEnabled !== false,
					ready: false,
					failed: false
				};
			}).filter(function (script) { return script.id !== ""; });
			const scriptsById = Object.create(null);
			for (const script of scriptList) scriptsById[script.id] = script;
			let currentScriptId = scriptList[0] ? scriptList[0].id : "";
			let activeHostEventId = "";
			// MVU settlement events keep a short sticky identity so setTimeout/debounce
			// writes after the handler returns still attach to the open transaction.
			let stickyHostEventId = "";
			let stickyHostEventUntil = 0;
			const MVU_WORK_EVENT_PREFIX = "mvu-work:";
			const MVU_WORK_EVENT_STICKY_MS = 3000;
			let synchronousScriptId = "";
			let hostEventTail = Promise.resolve();
            const hostEvents = new Map();
			let facade;
			const transport = modules.createTransport({ parent: parent, token: token, copy: copy,
				identity: function () {
					let eventId = activeHostEventId;
					if (!eventId && stickyHostEventId && Date.now() < stickyHostEventUntil) eventId = stickyHostEventId;
					return { eventId: eventId, scriptId: currentScript().id, lifecycleRevision: Number(state.lifecycleRevision) || 0 };
				},
				listen: function (receive) { addEventListener("message", receive); },
				onContext: async function (result, method) {
                    if (result.contextDelta) {
                        const next = modules.applyVariableReceipt(state, result.contextDelta);
                        if (next === null) await transport.request("getTavernHelperContext", result.contextDelta.version === 2 ? {eventId:result.contextDelta.eventId} : {});
                        else if (next !== state) { state = next; if (facade) facade.sync(state, result.contextDelta); }
                        return;
                    }
					const incoming = result.context;
					// An old RPC reply must not restore a context that the host has left.
					if (method && incoming && ((incoming.chatId && state.chatId && incoming.chatId !== state.chatId)
						|| Number(incoming.lifecycleRevision || 0) < Number(state.lifecycleRevision || 0)
                        || (Number(incoming.lifecycleRevision || 0) === Number(state.lifecycleRevision || 0)
                            && Number(incoming.stateRevision || 0) < Number(state.stateRevision || 0)))) return;
					if (incoming) { state = Object.assign({}, state, copy(incoming)); state.messages = modules.applyVariableReceipt.indexApi.from(state.messages || []); if (!incoming.transaction) delete state.transaction; }
					// Version-only and patch replies are merged by the worldbook API itself.
					if (result.worldbook && Array.isArray(result.worldbook.entries)) state.worldbook = copy(result.worldbook);
					// Chat-data saves acknowledge their own submitted snapshot separately.
					if (incoming && facade && method !== "saveTavernChatData") facade.sync(state);
				},
				onEvent: function (data) {
                    const eventId = String(data.eventId || "");
                    const known = hostEvents.get(eventId);
                    if (data.type === "dsh-tavern-helper-event-ack") {
                        if (known && known.receipt) { known.receipt = null; known.phase = "acknowledged"; }
                        return;
                    }
                    function status() { postToHost({ type: "dsh-tavern-helper-event-state", token: token, eventId: eventId, phase: hostEvents.get(eventId).phase }, "*"); }
                    if (known) {
                        status();
                        if (known.receipt) postToHost(known.receipt, "*");
                        return;
                    }
                    if (data.type === "dsh-tavern-helper-event-query") {
                        postToHost({ type: "dsh-tavern-helper-event-state", token: token, eventId: eventId, phase: "unknown" }, "*");
                        return;
                    }
                    const entry = { phase: "queued", receipt: null };
                    hostEvents.set(eventId, entry);
                    status();
                    function complete(receipt) {
                        entry.phase = "completed";
                        entry.receipt = Object.assign({ type: "dsh-tavern-helper-event-complete", token: token, eventId: eventId }, receipt);
                        postToHost(entry.receipt, "*");
                    }
					diagnosticCount = 0;
					const suppliedArgs = copy(data.args || []);
					const task = hostEventTail.catch(function () {}).then(async function () {
						entry.phase = "executing";
                        const previousEventId = activeHostEventId;
						activeHostEventId = String(data.eventId || "");
						try {
                            // Host-only deterministic edit: never replay MESSAGE_RECEIVED or prose commands.
                            if (data.name === "DSH_VARIABLE_EDIT") {
                                if (!officialMvuEnabled || !window.Mvu || window.Mvu.__dshBootstrap || typeof window.Mvu.parseMessage !== "function") throw new Error("Official MVU edit runtime is unavailable");
                                const id = suppliedArgs[0], command = suppliedArgs[1];
                                if (!Number.isInteger(id) || typeof command !== "string" || !activeHostEventId.startsWith(MVU_WORK_EVENT_PREFIX)) throw new Error("Invalid MVU edit event");
                                const option = { type: "message", message_id: id }, baseline = getVariables(option);
                                if (!baseline.stat_data || baseline.schema === undefined) throw new Error("MVU edit baseline is unavailable");
                                const parsed = await window.Mvu.parseMessage(command, copy(baseline));
                                if (!parsed || !parsed.stat_data || parsed.schema === undefined) throw new Error("MVU edit validation failed");
                                const update = { variables: parsed, message_content: String(readMessage(id)?.message || "") };
                                await events.emitHost(data.eventId, window.Mvu.events.BEFORE_MESSAGE_UPDATE, [update]);
                                const next = copy(baseline);
                                for (const key of ["stat_data", "schema", "display_data", "delta_data"]) {
                                    if (Object.prototype.hasOwnProperty.call(update.variables, key)) next[key] = copy(update.variables[key]);
                                    else delete next[key];
                                }
                                localReplace(next, option);
                                await call("updateTavernHelperVariables", { option: option, variables: next });
                                return [id];
                            }
							if (data.name === "mag_variable_update_ended" && suppliedArgs.length === 0) {
								const option = { type: "message", message_id: currentId() };
								const variables = getVariables(option);
								const before = JSON.stringify(variables);
								await events.emitHost(data.eventId, data.name, [variables]);
								if (JSON.stringify(variables) !== before) {
									localReplace(variables, option);
									await call("updateTavernHelperVariables", { option: option, variables: variables });
								}
								return [variables];
							}
							await events.emitHost(data.eventId, data.name, suppliedArgs);
							return suppliedArgs;
						} finally {
							const endingId = String(data.eventId || "");
							if (endingId.indexOf(MVU_WORK_EVENT_PREFIX) === 0) {
								stickyHostEventId = endingId;
								stickyHostEventUntil = Date.now() + MVU_WORK_EVENT_STICKY_MS;
							}
							activeHostEventId = previousEventId;
						}
					});
					hostEventTail = task;
					task.then(function (args) {
						if (data.eventId) complete({ args: copy(args || []) });
					}).catch(function (error) {
						console.error(error);
						if (data.eventId) complete({ scriptId: String(error && error.dshTavernScriptId || ""), error: String(error && error.message || error), errorCode: String(error && error.code || ""), args: suppliedArgs });
					});
				}
			});
			const call = function (method, args) {
                if (method === "updateTavernHelperVariables") args = Object.assign({}, args, { contextBaseline: {
                    chatId: state.chatId, stateRevision: state.stateRevision, lifecycleRevision: Number(state.lifecycleRevision) || 0
                } });
                const stage = { getTavernHelperWorldbook: "worldbook-read", loadTavernWorldInfo: "worldbook-read", updateTavernHelperPrompts: "prompt-write", updateTavernHelperMessages: "message-write", updateTavernHelperVariables: "variable-write" }[method];
                const pending = transport.request(method, args);
                return stage ? initializationTiming.wait(stage, pending, currentScript().id) : pending;
            };
			// Persistence receipts belong to the script that issued the write. A
			// different script's event must not drain this entire shared sandbox.
			const promptWritesByScript = new Map();
			function promptWriteState(scriptId) {
				if (!promptWritesByScript.has(scriptId)) promptWritesByScript.set(scriptId, { pending: new Set(), failures: new Map() });
				return promptWritesByScript.get(scriptId);
			}
			const pendingPromptOperations = new Map();
			function writePrompts(operation) {
				const owner = currentScript();
				const writes = promptWriteState(owner.id);
				const ids = operation.kind === "inject" ? operation.prompts.map(function (prompt) { return prompt && prompt.id; }) : operation.ids;
				const signature = JSON.stringify([owner.id, activeHostEventId, state.lifecycleRevision, operation]);
				const previous = ids.length ? pendingPromptOperations.get(ids[0]) : null;
				// Share only an identical in-flight, non-once operation. Any intervening
				// operation touching these IDs breaks sharing, so remove/reinsert order survives.
				if (!operation.once && previous && previous.signature === signature
					&& ids.every(function (id) { return pendingPromptOperations.get(id) === previous; })) return;
				for (const id of ids) pendingPromptOperations.delete(id);
				const task = call("updateTavernHelperPrompts", { operation: operation }).then(function (result) {
					if (result && result.stale) throw new Error("聊天已变化，提示词未保存");
				});
				const entry = { signature: signature };
				if (!operation.once) for (const id of ids) pendingPromptOperations.set(id, entry);
				function release() { for (const id of ids) if (pendingPromptOperations.get(id) === entry) pendingPromptOperations.delete(id); }
				task.then(release, release);
				writes.pending.add(task);
				task.then(function () { writes.pending.delete(task); }, function (error) {
					writes.pending.delete(task);
					error.dshTavernScriptId = owner.id;
					writes.failures.set(task, error);
					console.error("人物卡脚本「" + (owner.name || owner.id) + "」提示词写入失败", error);
				});
			}
			async function drainPromptWrites(scriptId) {
				const writes = promptWritesByScript.get(scriptId);
				if (!writes) return;
				// Confirm writes issued by the time the callback returned, including
				// writes after its awaits. Later timer writes must not extend this fence.
				const receipts = Array.from(new Set([...writes.pending, ...writes.failures.keys()]));
				try { await Promise.all(receipts); }
				finally { for (const receipt of receipts) writes.failures.delete(receipt); }
			}
			window.injectPrompts = function (prompts, options) {
				if (!Array.isArray(prompts)) throw new TypeError("提示词必须是数组");
				if (prompts.some(function (prompt) { return prompt && prompt.filter !== undefined; })) throw new Error("DSH 暂不支持提示词 filter 回调");
				const ids = prompts.map(function (prompt) { return prompt.id; });
				writePrompts({ kind: "inject", prompts: copy(prompts), once: !!(options && options.once) });
				return { uninject: function () { window.uninjectPrompts(ids); } };
			};
			window.uninjectPrompts = function (ids) { writePrompts({ kind: "remove", ids: copy(ids) }); };

			const events = modules.createEvents({ currentScript: currentScript, withScript: withScript,
				reportSubscriptions: reportSubscriptions, post: transport.post, document: window.document, initializationTiming: initializationTiming });
			function copy(value) {
				try { return structuredClone(value); }
				catch (_) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			}
			function currentScript() { return scriptsById[currentScriptId] || scriptList[0] || { id: "", name: "", info: "", buttons: [] }; }
			async function withScript(scriptId, factory) {
				const previous = currentScriptId;
				currentScriptId = String(scriptId || previous || "");
				const ownerId = currentScript().id;
				try {
                    let pending;
                    const previousSync = synchronousScriptId;
                    synchronousScriptId = ownerId;
                    try { pending = factory(); } finally { synchronousScriptId = previousSync; }
                    const result = await initializationTiming.wait("script-callback", pending, ownerId); if (facade) await facade.flushVariables(ownerId); await initializationTiming.wait("prompt-drain", drainPromptWrites(ownerId), ownerId); return result; }
                catch (error) {
                    // Keep the innermost owner, including failures after await and
                    // primitive/frozen rejections that cannot carry metadata.
                    if (error && error.dshTavernScriptId) throw error;
                    let failure = error;
                    try {
                        if (failure && typeof failure === "object") failure.dshTavernScriptId = ownerId;
                    } catch (_) {}
                    if (!failure || failure.dshTavernScriptId !== ownerId) {
                        failure = new Error(String(error && error.message || error));
                        failure.cause = error;
                        if (error && error.stack) failure.stack = error.stack;
                        failure.dshTavernScriptId = ownerId;
                    }
                    throw failure;
                }
				finally { currentScriptId = previous; }
			}
			function stringHash(value, seed) {
				if (typeof value !== "string") return 0;
				let h1 = 0xdeadbeef ^ (Number(seed) || 0), h2 = 0x41c6ce57 ^ (Number(seed) || 0);
				for (let index = 0; index < value.length; index += 1) {
					const code = value.charCodeAt(index);
					h1 = Math.imul(h1 ^ code, 2654435761);
					h2 = Math.imul(h2 ^ code, 1597334677);
				}
				h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
				h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
				return 4294967296 * (2097151 & h2) + (h1 >>> 0);
			}
			function buttonEvent(name, scriptId) { return String(scriptId || currentScript().id) + "_" + stringHash(String(name || "")); }
			function reportSubscriptions() {
				postToHost({
					type: "dsh-tavern-helper-subscriptions",
					token: token,
					names: events.names(),
					ready: scriptList.every(function (script) { return script.ready || script.failed; }),
					scripts: scriptList.map(function (script) { return { id: script.id, names: events.subscriptionsFor(script.id), ready: script.ready, failed: script.failed }; })
				}, "*");
			}
			function lastId() { return Math.max(-1, (state.messages || []).length - 1); }
			function normalizeId(value) {
				let id = Number(value);
				if (!Number.isFinite(id)) id = lastId();
				if (id < 0) id = (state.messages || []).length + id;
				return Math.max(0, Math.min(lastId(), id));
			}
			function currentId() { return lastId(); }
			function optionOf(option) {
				const value = option && typeof option === "object" ? copy(option) : { type: "message" };
				if (!value.type) value.type = "message";
                if (!["message", "chat", "character", "global", "script"].includes(value.type)) throw Object.assign(new Error("尚未支持的变量作用域: " + value.type), { code: "TAVERN_CAPABILITY_UNSUPPORTED" });
				if (value.type === "message") {
					if (value.message_id === undefined || value.message_id === null || value.message_id === "latest") value.message_id = currentId();
				} else if (value.type === "script" && !value.script_id) value.script_id = currentScript().id;
				return value;
			}
            const messagesFor = modules.createMessageReader({ context: () => state, currentId, copy, readMessage });

			function getVariables(option) {
				const resolved = optionOf(option);
				if (resolved.type === "global") return copy(state.globalVariables || {});
				if (resolved.type === "character") return copy(state.characterVariables || {});
				if (resolved.type === "chat") return copy(state.chatVariables || {});
				if (resolved.type === "script") return copy(state.scriptVariables && state.scriptVariables[resolved.script_id] || {});
				const message = readMessage(normalizeId(resolved.message_id));
				return copy(message && message.variables && typeof message.variables === "object" ? message.variables : {});
			}
			function localReplace(variables, option) {
				const resolved = optionOf(option);
				if (resolved.type === "global") state.globalVariables = copy(variables);
				else if (resolved.type === "character") state.characterVariables = copy(variables);
				else if (resolved.type === "chat") state.chatVariables = copy(variables);
				else if (resolved.type === "script") {
					if (!state.scriptVariables || typeof state.scriptVariables !== "object") state.scriptVariables = {};
					state.scriptVariables[resolved.script_id] = copy(variables);
				} else {
					const message = readMessage(normalizeId(resolved.message_id));
					if (message) {
						message.variables = copy(variables);
						if (Array.isArray(message.swipes_data)) message.swipes_data[message.swipe_id || 0] = copy(variables);
					}
				}
				return resolved;
			}
			function localSetMessages(patches) {
				(patches || []).forEach(function (patch) {
					const message = readMessage(normalizeId(patch.message_id));
					if (!message) return;
					if (patch.swipe_id !== undefined) {
						message.swipe_id = Math.max(0, Math.min((message.swipes || []).length - 1, Number(patch.swipe_id) || 0));
						message.message = (message.swipes || [])[message.swipe_id] || message.message;
						message.mes = message.message;
					}
					if (patch.message !== undefined) {
						message.message = String(patch.message);
						message.mes = message.message;
						if (Array.isArray(message.swipes)) message.swipes[message.swipe_id || 0] = message.message;
					}
					if (patch.data !== undefined) {
						message.variables = copy(patch.data || {});
						if (Array.isArray(message.swipes_data)) message.swipes_data[message.swipe_id || 0] = copy(patch.data || {});
					}
					if (patch.swipes_data !== undefined) {
						message.swipes_data = copy(Array.isArray(patch.swipes_data) ? patch.swipes_data : []);
						message.variables = copy(message.swipes_data[message.swipe_id || 0] || {});
					}
				});
			}

			function regexGroups() {
				if (!state.regexScripts || typeof state.regexScripts !== "object") state.regexScripts = { global: [], character: [] };
				if (!Array.isArray(state.regexScripts.global)) state.regexScripts.global = [];
				if (!Array.isArray(state.regexScripts.character)) state.regexScripts.character = [];
				return state.regexScripts;
			}
			function internalRegex(regex) {
				const source = regex && regex.source || {}, destination = regex && regex.destination || {};
				return {
					id: String(regex && regex.id || ""), name: String(regex && (regex.script_name || regex.scriptName) || ""), enabled: !regex || (Object.prototype.hasOwnProperty.call(regex, "enabled") ? regex.enabled !== false : regex.disabled !== true),
					findRegex: String(regex && (regex.find_regex || regex.findRegex) || ""), trimStrings: copy(regex && (regex.trim_strings || regex.trimStrings) || []), replaceString: String(regex && (regex.replace_string || regex.replaceString) || ""),
					placement: Array.isArray(regex && regex.placement) ? copy(regex.placement) : [source.user_input && 1, source.ai_output && 2, source.slash_command && 3, source.world_info && 5, source.reasoning && 6].filter(Boolean),
					markdownOnly: regex && regex.markdownOnly === true || destination.display === true, promptOnly: regex && regex.promptOnly === true || destination.prompt === true, runOnEdit: regex && (regex.runOnEdit === true || regex.run_on_edit === true),
					substituteRegex: 0, minDepth: regex && (regex.min_depth ?? regex.minDepth) == null ? null : Number(regex.min_depth ?? regex.minDepth), maxDepth: regex && (regex.max_depth ?? regex.maxDepth) == null ? null : Number(regex.max_depth ?? regex.maxDepth)
				};
			}
			function rawRegex(script) {
				return {
					id: String(script.id || ""), scriptName: String(script.name || ""), disabled: script.enabled === false,
					findRegex: String(script.findRegex || ""), trimStrings: copy(script.trimStrings || []), replaceString: String(script.replaceString || ""),
					placement: copy(script.placement || []), markdownOnly: script.markdownOnly === true, promptOnly: script.promptOnly === true,
					runOnEdit: script.runOnEdit === true, substituteRegex: script.substituteRegex == null ? 0 : script.substituteRegex,
					minDepth: script.minDepth == null ? null : script.minDepth, maxDepth: script.maxDepth == null ? null : script.maxDepth
				};
			}

			window.getScriptId = function () { return currentScript().id; };
			window.getScriptName = function () { return currentScript().name; };
			window.getScriptInfo = function () { return currentScript().info; };
			window.replaceScriptInfo = function (value) { currentScript().info = String(value || ""); };
			window.getScriptButtons = function () { return copy(currentScript().buttons); };
			window.replaceScriptButtons = function (buttons) { currentScript().buttons = copy(Array.isArray(buttons) ? buttons : []); };
			window.updateScriptButtonsWith = async function (updater) { const next = await updater(copy(currentScript().buttons)); window.replaceScriptButtons(next); return copy(currentScript().buttons); };
			window.appendInexistentScriptButtons = function (buttons) {
				const next = copy(currentScript().buttons);
				for (const button of Array.isArray(buttons) ? buttons : []) if (!next.some(function (item) { return item && item.name === button.name; })) next.push(copy(button));
				window.replaceScriptButtons(next);
				return copy(next);
			};
            window.getAllEnabledScriptButtons = function () {
                const result = {};
                for (const script of scriptList) {
                    if (script.buttonsEnabled === false || script.failed) continue;
                    const buttons = script.buttons.filter(button => button && button.visible === true)
                        .map(button => ({ button_id: buttonEvent(button.name, script.id), button_name: button.name }));
                    if (buttons.length) Object.defineProperty(result, script.id, { value: buttons, enumerable: true, configurable: true, writable: true });
                }
                return copy(result);
            };
			window.getButtonEvent = buttonEvent;
			window.getCharData = function () { return copy(readCharacter() || null); };
			window.getCurrentCharacterName = function () { return String(state.characterName || state.character && state.character.name || ""); };
			window.getCurrentMessageId = currentId;
			window.getLastMessageId = lastId;
			window.getChatMessages = messagesFor;
			window.getVariables = getVariables;
			window.getAllVariables = function () {
				return Object.assign({}, copy(state.globalVariables || {}), copy(state.characterVariables || {}), getVariables({ type: "script" }), copy(state.chatVariables || {}));
			};
			window.replaceVariables = function (variables, option) {
                const resolved = optionOf(option), plain = copy(variables || {}), before = getVariables(resolved);
                const revision = [state.chatId, state.lifecycleRevision, state.stateRevision];
                localReplace(plain, resolved);
                return call("updateTavernHelperVariables", { option: resolved, variables: plain }).then(function (result) {
                    if (result && result.stale) throw new Error("聊天已变化，变量未保存");
                    return result;
                }).catch(function (error) {
                    // Preserve a newer context or overlapping edit; roll back only
                    // our own unacknowledged optimistic value on the same revision.
                    if (JSON.stringify(revision) === JSON.stringify([state.chatId, state.lifecycleRevision, state.stateRevision])
                        && JSON.stringify(getVariables(resolved)) === JSON.stringify(plain)) localReplace(before, resolved);
                    console.error(error);
                    throw error;
                });
			};
			window.insertOrAssignVariables = function (variables, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				const next = window._.mergeWith(current, copy(variables || {}), function (_left, right) {
					return Array.isArray(right) ? right : undefined;
				});
				return call("updateTavernHelperVariables", { option: resolved, variables: copy(next) }).then(function (result) {
					if (result && result.stale) throw new Error("聊天已变化，变量未保存");
					localReplace(next, resolved);
					return copy(next);
				});
			};
			window.insertVariables = function (variables, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				const next = window._.mergeWith({}, copy(variables || {}), current, function (_left, right) {
					return Array.isArray(right) ? right : undefined;
				});
				return call("updateTavernHelperVariables", { option: resolved, variables: copy(next) }).then(function (result) {
					if (result && result.stale) throw new Error("聊天已变化，变量未保存");
					localReplace(next, resolved);
					return copy(next);
				});
			};
			window.updateVariablesWith = async function (updater, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				let next = typeof updater === "function" ? await updater(copy(current)) : current;
				if (next === undefined) next = current;
				next = copy(next);
				localReplace(next, resolved);
				await call("updateTavernHelperVariables", { option: resolved, variables: next });
				return copy(next);
			};
			window.deleteVariable = async function (path, option) {
				const resolved = optionOf(option);
				const next = getVariables(resolved);
				const deleted = window._.unset(next, String(path || ""));
				await window.replaceVariables(next, resolved);
				return { variables: copy(next), delete_occurred: deleted };
			};
			window.setChatMessages = async function (patches) {
				const plain = copy(patches || []);
				localSetMessages(plain);
				return await call("updateTavernHelperMessages", { messages: plain });
			};
			window.triggerSlash = function (line) {
				return call("triggerTavernSlash", { line: window.substitudeMacros(String(line || "")) }).then(function (result) {
					return result && Object.prototype.hasOwnProperty.call(result, "pipe") ? result.pipe : result;
				});
			};
			window.createChatMessages = async function (messages, option) {
				const result = await call("createTavernHelperMessages", {
					messages: copy(Array.isArray(messages) ? messages : []),
					option: copy(option && typeof option === "object" ? option : {})
				});
				if (result && result.stale) throw new Error("聊天已变化，消息未创建");
			};
			window.getWorldbookNames = function () { return state.worldbook && state.worldbook.name ? [state.worldbook.name] : []; };
			window.getCharWorldbookNames = function () { return { primary: state.worldbook && state.worldbook.name || null, additional: [] }; };
			// Global and extra bound books reach scripts merged into the game's one book; there is no separate chat book.
			window.getGlobalWorldbookNames = function () { return []; };
			window.getChatWorldbookName = function () { return null; };
			window.getWorldbook = async function (name) {
				if (state.worldbook && (name === "current" || name === state.worldbook.name)) {
                    const access = state.worldbook.resourceAccess;
                    // A copy from an earlier write is checked by version; only a changed book comes back whole.
                    if (!access) return state.worldbook.version ? await freshWorldbook(state.worldbook.name) : copy(state.worldbook.entries || []);
                    const book = await resources.readAsync(access);
                    if (state.worldbook?.resourceAccess?.token === access.token) state.worldbook = copy(book);
                    return copy(book && book.entries || []);
                }
				return await freshWorldbook(name);
			};
			function legacyWorldbookEntry(entry, index) {
				const extra = entry.extra || {};
				return {
					uid: entry.uid, display_index: extra.displayIndex === undefined ? index : extra.displayIndex,
					comment: entry.name, enabled: entry.enabled, type: entry.strategy.type,
					position: entry.position.type === "at_depth" ? "at_depth_as_" + entry.position.role : entry.position.type,
					depth: entry.position.type === "at_depth" ? entry.position.depth : null, order: entry.position.order,
					probability: entry.probability, content: entry.content, keys: copy(entry.strategy.keys),
					logic: entry.strategy.keys_secondary.logic, filters: copy(entry.strategy.keys_secondary.keys), scan_depth: entry.strategy.scan_depth,
					case_sensitive: extra.caseSensitive == null ? "same_as_global" : extra.caseSensitive,
					match_whole_words: extra.matchWholeWords == null ? "same_as_global" : extra.matchWholeWords,
					group: extra.group || "", exclude_recursion: entry.recursion.prevent_incoming, prevent_recursion: entry.recursion.prevent_outgoing,
					delay_until_recursion: entry.recursion.delay_until === null ? false : entry.recursion.delay_until,
					sticky: entry.effect.sticky, cooldown: entry.effect.cooldown, delay: entry.effect.delay,
					use_group_scoring: "same_as_global", automation_id: null, group_prioritized: false, group_weight: 100
				};
			}
			function legacyWorldbookPatch(patch, original) {
				const next = copy(original || {});
				function set(path, value) {
					const parts = path.split("."); let target = next;
					for (const key of parts.slice(0, -1)) target = target[key] || (target[key] = {});
					target[parts[parts.length - 1]] = copy(value);
				}
				const mappings = { uid: "uid", comment: "name", enabled: "enabled", content: "content", probability: "probability", type: "strategy.type", keys: "strategy.keys", filters: "strategy.keys_secondary.keys", logic: "strategy.keys_secondary.logic", scan_depth: "strategy.scan_depth", order: "position.order", exclude_recursion: "recursion.prevent_incoming", prevent_recursion: "recursion.prevent_outgoing", sticky: "effect.sticky", cooldown: "effect.cooldown", delay: "effect.delay", group: "extra.group", display_index: "extra.displayIndex" };
				for (const key of Object.keys(mappings)) if (Object.prototype.hasOwnProperty.call(patch, key)) set(mappings[key], patch[key]);
				for (const pair of [["case_sensitive", "caseSensitive"], ["match_whole_words", "matchWholeWords"]]) if (Object.prototype.hasOwnProperty.call(patch, pair[0])) set("extra." + pair[1], patch[pair[0]] === "same_as_global" ? null : patch[pair[0]]);
				if (patch.depth !== undefined && patch.depth !== null) set("position.depth", patch.depth);
				if (patch.position !== undefined) {
					const match = /^at_depth_as_(system|user|assistant)$/.exec(patch.position);
					set("position.type", match ? "at_depth" : patch.position);
					if (match) set("position.role", match[1]);
				}
				if (patch.delay_until_recursion !== undefined) set("recursion.delay_until", patch.delay_until_recursion === false ? null : patch.delay_until_recursion === true ? 1 : patch.delay_until_recursion);
				const unsupported = { use_group_scoring: "same_as_global", automation_id: null, group_prioritized: false, group_weight: 100 };
				for (const key of Object.keys(unsupported)) if (patch[key] !== undefined && patch[key] !== unsupported[key]) throw new Error("当前兼容层尚未支持世界书字段: " + key);
				return next;
			}
			function worldbookPayload(entries) {
				if (!Array.isArray(entries)) throw new TypeError("世界书条目必须是数组");
				// Convert RegExp before crossing the JSON host boundary.
				return entries.map(function (value) {
					const entry = copy(value);
					if (value.strategy && Array.isArray(value.strategy.keys)) entry.strategy.keys = value.strategy.keys.map(String);
					if (value.strategy && value.strategy.keys_secondary && Array.isArray(value.strategy.keys_secondary.keys)) entry.strategy.keys_secondary.keys = value.strategy.keys_secondary.keys.map(String);
					return entry;
				});
			}
			function fullWorldbook(worldbook) {
				state.worldbook = copy(worldbook);
				return copy(state.worldbook.entries || []);
			}
			// Send only the entries that differ from the version read; a large book is not uploaded again.
			async function writeWorldbook(name, entries, current, version) {
				const next = worldbookPayload(entries), before = new Map(), seen = new Set(), upserts = [];
				for (const entry of current) before.set(String(entry.uid), JSON.stringify(entry));
				for (const entry of next) {
					const key = entry.uid === undefined ? "" : String(entry.uid);
					if (key && seen.has(key)) throw new Error("世界书条目编号无效或重复");
					if (key) seen.add(key);
					if (!key || before.get(key) !== JSON.stringify(entry)) upserts.push(entry);
				}
				const deletes = current.filter(function (entry) { return !seen.has(String(entry.uid)); }).map(function (entry) { return entry.uid; });
				if (!upserts.length && !deletes.length) return copy(current);
				const result = await call("patchTavernHelperWorldbook", { name: name, patch: { version: version, upserts: upserts, deletes: deletes } });
				const book = result.worldbook, byUid = new Map(current.map(function (entry) { return [String(entry.uid), entry]; }));
				for (const entry of book.changed || []) byUid.set(String(entry.uid), entry);
				const written = (book.uids || []).map(function (uid) { return byUid.get(String(uid)); });
				if (written.some(function (entry) { return !entry; })) return await freshWorldbook(name);
				return fullWorldbook({ name: book.name, version: book.version, entries: written });
			}
			async function freshWorldbook(name) {
				const held = state.worldbook && state.worldbook.name === name && state.worldbook.version && Array.isArray(state.worldbook.entries) ? state.worldbook : null;
				const result = await call("getTavernHelperWorldbook", held ? { name: name, knownVersion: held.version } : { name: name });
				if (held && result.worldbook && result.worldbook.unchanged && result.worldbook.version === held.version) { state.worldbook = held; return copy(held.entries); }
				return fullWorldbook(result.worldbook);
			}
			window.replaceWorldbook = async function (name, entries) {
				const current = await freshWorldbook(name);
				await writeWorldbook(name, entries, current, state.worldbook.version);
			};
			window.updateWorldbookWith = async function (name, updater) {
				if (typeof updater !== "function") throw new TypeError("世界书更新器必须是函数");
				const current = await freshWorldbook(name), version = state.worldbook.version, draft = copy(current);
				const next = await updater(draft);
				return await writeWorldbook(name, next === undefined ? draft : next, current, version);
			};
			window.createWorldbookEntries = async function (name, entries) {
				const additions = worldbookPayload(entries).map(function (entry) { delete entry.uid; return entry; });
				let previous;
				const worldbook = await window.updateWorldbookWith(name, function (current) { previous = new Set(current.map(function (entry) { return entry.uid; })); return current.concat(additions); });
				return { worldbook: worldbook, new_entries: worldbook.filter(function (entry) { return !previous.has(entry.uid); }) };
			};
			window.deleteWorldbookEntries = async function (name, predicate) {
				if (typeof predicate !== "function") throw new TypeError("世界书删除条件必须是函数");
				const deleted = [];
				const worldbook = await window.updateWorldbookWith(name, function (current) {
					return current.filter(function (entry) { if (!predicate(copy(entry))) return true; deleted.push(copy(entry)); return false; });
				});
				return { worldbook: worldbook, deleted_entries: deleted };
			};
			window.getLorebookEntries = async function (name) { return (await window.getWorldbook(name)).map(legacyWorldbookEntry); };
			window.setLorebookEntries = async function (name, patches) {
				const worldbook = await window.updateWorldbookWith(name, function (entries) {
					const known = new Set(entries.map(function (entry) { return entry.uid; }));
					for (const patch of patches) if (!known.has(patch.uid)) throw new Error("世界书条目不存在: " + patch.uid);
					return entries.map(function (entry) { for (const patch of patches) if (patch.uid === entry.uid) entry = legacyWorldbookPatch(patch, entry); return entry; });
				});
				return worldbook.map(legacyWorldbookEntry);
			};
			window.createLorebookEntries = async function (name, entries) {
				const result = await window.createWorldbookEntries(name, entries.map(function (entry) { return legacyWorldbookPatch(entry); }));
				return { entries: result.worldbook.map(legacyWorldbookEntry), new_uids: result.new_entries.map(function (entry) { return entry.uid; }) };
			};
			window.deleteLorebookEntries = async function (name, uids) {
				const result = await window.deleteWorldbookEntries(name, function (entry) { return uids.includes(entry.uid); });
				return { entries: result.worldbook.map(legacyWorldbookEntry), delete_occurred: result.deleted_entries.length > 0 };
			};
			window.getLorebooks = window.getWorldbookNames;
			window.getCharLorebooks = async function () { return window.getCharWorldbookNames(); };
			window.getCurrentCharPrimaryLorebook = function () { return window.getCharWorldbookNames().primary; };
			window.getLorebookSettings = function () { return copy(lorebookSettings); };
			window.setLorebookSettings = function (settings) { lorebookSettings = Object.assign({}, lorebookSettings, copy(settings || {})); return copy(lorebookSettings); };
			window.eventOn = function (name, handler) { return events.listen(name, handler); };
			// Legacy Tavern Helper shorthand; resolve the button in its registering script.
			window.eventOnButton = function (name, handler) { window.eventOn(window.getButtonEvent(name), handler); };
			window.eventMakeFirst = function (name, handler) { return events.listen(name, handler, "first"); };
			window.eventMakeLast = function (name, handler) { return events.listen(name, handler, "last"); };
			window.eventOnce = function (name, handler) { return events.listen(name, handler, null, true); };
			window.eventOff = events.off;
			window.eventRemoveListener = window.eventOff;
			window.eventClearEvent = events.clearEvent;
			window.eventClearListener = events.clearListener;
			window.eventClearAll = events.clearAll;
			window.eventEmit = events.emit;
			let resolveCompanionScriptsReady;
			window.__dshTavernCompanionScriptsReady = initializationTiming.wait("companion-barrier", new Promise(function (resolve) { resolveCompanionScriptsReady = resolve; }));
			window.__dshTavernResolveCompanionScriptsReady = function () {
				if (!resolveCompanionScriptsReady) return;
				const resolve = resolveCompanionScriptsReady;
				resolveCompanionScriptsReady = null;
				resolve();
			};
			window.__dshTavernHelperSetCurrentScript = function (scriptId) { if (scriptsById[String(scriptId)]) currentScriptId = String(scriptId); };
			// jQuery defers $(fn) until after module evaluation. Capture ownership at
			// registration, before the loader advances to the next card script.
			if (window.jQuery && window.jQuery.fn && typeof window.jQuery.fn.ready === "function") {
				const originalReady = window.jQuery.fn.ready;
				window.jQuery.fn.ready = function (callback) {
					if (typeof callback !== "function") return originalReady.apply(this, arguments);
					const owner = currentScript().id;
					return originalReady.call(this, function () {
						const receiver = this, args = arguments;
						return withScript(owner, function () { return callback.apply(receiver, args); }).catch(function (error) {
							if (error && typeof error === "object" && !error.dshTavernScriptId) error.dshTavernScriptId = owner;
							throw error;
						});
					});
				};
			}
			window.__dshTavernHelperSubscriptionsReady = function (scriptId) { const script = scriptsById[String(scriptId || currentScript().id)]; if (script) script.ready = true; reportSubscriptions(); };
			window.__dshTavernHelperSubscriptionsFailed = function (scriptId, error) {
				const script = scriptsById[String(scriptId || currentScript().id)];
				if (script) script.failed = true;
				postToHost({ type: "dsh-tavern-helper-script-runtime", token: token, scriptId: script && script.id || currentScript().id, level: "error", message: String(error && error.message || error || "人物卡脚本初始化失败"), moduleFailure: error && error.dshTavernModuleFailure || null }, "*");
				reportSubscriptions();
			};
			window.tavern_events = {
				MESSAGE_SENT: "MESSAGE_SENT", MESSAGE_RECEIVED: "MESSAGE_RECEIVED", MESSAGE_UPDATED: "MESSAGE_UPDATED",
				MESSAGE_SWIPED: "MESSAGE_SWIPED", MESSAGE_DELETED: "MESSAGE_DELETED", MESSAGE_EDITED: "MESSAGE_EDITED",
				CHAT_CHANGED: "CHAT_CHANGED", CHAT_CREATED: "CHAT_CREATED", CHARACTER_PAGE_LOADED: "CHARACTER_PAGE_LOADED",
				GENERATE_BEFORE_COMBINE_PROMPTS: "GENERATE_BEFORE_COMBINE_PROMPTS"
			};
			window.iframe_events = Object.freeze({
				MESSAGE_IFRAME_RENDER_STARTED: "message_iframe_render_started",
				MESSAGE_IFRAME_RENDER_ENDED: "message_iframe_render_ended",
				GENERATION_STARTED: "js_generation_started",
				STREAM_TOKEN_RECEIVED_FULLY: "js_stream_token_received_fully",
				STREAM_TOKEN_RECEIVED_INCREMENTALLY: "js_stream_token_received_incrementally",
				GENERATION_ENDED: "js_generation_ended"
			});
			// Opening UIs often sync-check window.Mvu while the official bundle is still
			// downloading. Expose a writable bootstrap so those checks pass; waiters still
			// block until initializeGlobal replaces it with the real module.
			const mvuApi = {
				events: { VARIABLE_INITIALIZED: "mag_variable_initialized", VARIABLE_UPDATE_STARTED: "mag_variable_update_started", COMMAND_PARSED: "mag_command_parsed", VARIABLE_UPDATE_ENDED: "mag_variable_update_ended", BEFORE_MESSAGE_UPDATE: "mag_before_message_update" },
				getMvuData: function (option) { return getVariables(option); },
				replaceMvuData: async function (value, option) { await window.updateVariablesWith(function () { return value; }, option); return copy(value); },
				parseMessage: async function () { throw new Error("当前兼容层尚未开放脚本内手动 MVU 重算"); }
			};
			if (officialMvuEnabled) window.Mvu = Object.assign({ __dshBootstrap: true }, mvuApi);
			else if (state.mvuEnabled !== false) window.Mvu = mvuApi;
			window.initializeGlobal = function (name, value) {
				window[name] = value;
				return window.eventEmit("global_" + String(name) + "_initialized");
			};
			window.waitGlobalInitialized = async function (name) {
				function settled(value) { return value !== undefined && !(value && value.__dshBootstrap === true); }
				if (settled(window[name])) return window[name];
				return await new Promise(function (resolve) {
					const eventName = "global_" + String(name) + "_initialized";
					const listener = function () {
						if (!settled(window[name])) return;
						window.eventOff(eventName, listener);
						resolve(window[name]);
					};
					window.eventOn(eventName, listener);
				});
			};
			// Compatibility version shared by the script runtime and opening preview.
			window.getTavernHelperVersion = function () { return "4.8.19"; };
			window.substitudeMacros = function (value) {
				return String(value || "")
					.replace(/{{\s*user\s*}}/gi, String(state.playerName || "你"))
					.replace(/{{\s*char\s*}}/gi, String(state.characterName || "角色"));
			};
			window.submitTavernInput = function (text) { return call("submitTavernHelperInput", { text: String(text || "") }); };
            const backgroundModel = modules.installBackgroundModel({ window: window, request: call, context: function () { return state; } });
			facade = modules.installFacade({ projectMvuSettings: backgroundModel.projectMvuSettings, normalizeMvuSettings: backgroundModel.normalizeMvuSettings, readGlobalRegexes: function () { return regexGroups().global.map(rawRegex); }, installCompatibility: modules.installCompatibility, currentScript: currentScript, post: transport.post, createChatData: modules.createChatData, readMessage:readMessage, readCharacter:readCharacter, createLocalVariables: modules.createLocalVariables, window: window, copy: copy, request: call, context: function () { return state; },
				Popup: modules.createPopup({ document: window.document, parent: parent, token: token }) });
            modules.installUtilities(window);
            modules.installEventApi(window);
            modules.installMacros({window, context: () => state});
            modules.installRegexApi({window, context: () => state, createEngine: modules.createRegexEngine});
            modules.installDisplay(window);
            modules.installGeneration({window, request:call, copy});
			let regexSaveTimer = null;
			async function persistGlobalRegexes() {
				if (regexSaveTimer !== null) { clearTimeout(regexSaveTimer); regexSaveTimer = null; }
				window.SillyTavern.extensionSettings.regex = regexGroups().global.map(rawRegex);
				await window.SillyTavern.saveSettingsDebounced();
				return window.getTavernRegexes({ type: "global" });
			}
			window.replaceTavernRegexes = async function (regexes, option) {
				const resolved = option && typeof option === "object" ? option : {};
				const items = Array.isArray(regexes) ? copy(regexes) : [];
				if (resolved.type && resolved.type !== "global") throw new Error("当前兼容层只允许脚本修改全局正则");
				if (!resolved.type && resolved.scope && !["all", "global"].includes(resolved.scope)) throw new Error("当前兼容层只允许脚本修改全局正则");
				const globals = resolved.type === "global" ? items : items.filter(function (item) { return item && item.scope === "global"; });
				if (!resolved.type && (!resolved.scope || resolved.scope === "all")) {
					const submittedCharacters = items.filter(function (item) { return item && item.scope === "character"; });
					const currentCharacters = window.getTavernRegexes({ scope: "character", enable_state: "all" });
					if (JSON.stringify(submittedCharacters) !== JSON.stringify(currentCharacters)) throw new Error("当前兼容层不允许脚本修改人物卡内置正则");
				}
				regexGroups().global = globals.map(internalRegex);
				await persistGlobalRegexes();
			};
			window.updateTavernRegexesWith = async function (updater, option) {
				if (typeof updater !== "function") throw new TypeError("酒馆正则更新器必须是函数");
				const current = window.getTavernRegexes(option), draft = copy(current);
				const updated = await updater(draft);
				const next = updated === undefined ? draft : updated;
				await window.replaceTavernRegexes(next, option);
				return window.getTavernRegexes(option);
			};
			window.importRawTavernRegex = function (filename, content) {
				try {
					const raw = JSON.parse(String(content || ""));
					if (!raw || typeof raw !== "object" || !raw.findRegex) return false;
					raw.id = "dsh-regex-" + Date.now() + "-" + Math.random().toString(16).slice(2);
					raw.scriptName = String(filename || "未命名正则");
					regexGroups().global.push(internalRegex(raw));
					if (regexSaveTimer !== null) clearTimeout(regexSaveTimer);
					regexSaveTimer = setTimeout(function () { regexSaveTimer = null; void persistGlobalRegexes().catch(function (error) { console.error(error); }); }, 50);
					return true;
				} catch (_) { return false; }
			};
			function errorScriptId(error, filename) {
                if (error && error.dshTavernScriptId) return error.dshTavernScriptId;
                const match = String(filename || error && error.stack || "").match(/dsh-tavern-script:([^\s):]+)/);
                if (!match) return "";
                try { return decodeURIComponent(match[1]); } catch (_) { return ""; }
            }
			// MVU reports some rejected operations through warn/toastr without throwing.
			let diagnosticCount = 0;
			for (const level of ["warn", "error"]) {
				const original = console[level].bind(console);
				console[level] = function () {
					original.apply(null, arguments);
					if (diagnosticCount++ >= 50) return;
					try {
						const message = Array.from(arguments).map(function (value) { return typeof value === "string" ? value : value && value.message || "[structured diagnostic omitted]"; }).join(" ").slice(0, 4000);
						const failure = Array.from(arguments).find(value => value && value.dshTavernScriptId !== undefined);
						postToHost({ type: "dsh-tavern-helper-diagnostic", token: token, eventId: failure ? failure.dshTavernEventId : activeHostEventId, scriptId: failure ? failure.dshTavernScriptId : errorScriptId(Array.from(arguments).find(value => value && value.stack) || new Error()) || synchronousScriptId, level: level, message: message }, "*");
					} catch (_) {}
				};
			}
			window.toastr.warning = console.warn;
			window.toastr.error = console.error;
			const ready = Promise.all([
				import(new URL("/api/dsh-tavern/vendor/runtime-assets/zod/index.mjs",document.baseURI).href),
				import(new URL("/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs",document.baseURI).href)
			]).then(function (modules) { window.z = modules[0]; window.YAML = modules[1]; return true; });
			window.__dshTavernHelperReady = ready;
			void ready.catch(function (error) {
				postToHost({ type: "dsh-tavern-helper-bootstrap-failed", token: token, message: String(error && error.message || error || "人物卡脚本依赖加载失败") }, "*");
			});
			addEventListener("error", function (event) {
				const target = event && event.target;
				const resource = target && target !== window ? String(target.src || target.href || "") : "";
				const message = event && event.message ? String(event.message) : (resource ? "资源加载失败: " + resource : "人物卡脚本加载失败");
				postToHost({ type: "dsh-tavern-helper-script-runtime", token: token, scriptId: errorScriptId(event.error, event.filename), level: "error", message: message }, "*");
			});
			addEventListener("unhandledrejection", function (event) {
				postToHost({ type: "dsh-tavern-helper-script-runtime", token: token, scriptId: errorScriptId(event.reason), eventId: event.reason && event.reason.dshTavernEventId || "", method: event.reason && event.reason.dshTavernMethod || "", level: "error", message: String(event.reason && event.reason.message || event.reason || "人物卡脚本 Promise 失败") }, "*");
			});
			postToHost({ type: "dsh-tavern-helper-script-ready", token: token }, "*");
		}
