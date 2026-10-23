		const TAVERN_FRAME_MAX_HEIGHT = 32000;
		function clampTavernFrameHeight(value) {
			const height = Number(value);
			return Number.isFinite(height) ? Math.max(48, Math.min(TAVERN_FRAME_MAX_HEIGHT, Math.ceil(height))) : 48;
		}
		function estimatedTavernFrameHeight(content) {
			const chars = String(content || "").length;
			return clampTavernFrameHeight(Math.max(160, Math.min(1200, 160 + Math.ceil(chars / 80) * 18)));
		}
		function tavernFrameHeightKey(props) {
			return ["dsh-tavern-frame-height", String(props.sessionId || ""), String(props.turn || 0), String(props.partIndex || 0), String(String(props.content || "").length)].join(":");
		}
		function restoredTavernFrameHeight(key, content) {
			try {
				const saved = Number(window.sessionStorage.getItem(key));
				if (Number.isFinite(saved) && saved >= 48) return clampTavernFrameHeight(saved);
			} catch (_) {}
			return estimatedTavernFrameHeight(content);
		}

		function nextTavernFrameToken() {
			return window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random());
		}

		// Every card iframe used to inline the whole chat, including each floor's rendered
		// template output: frame size grew with history and frame count grew with it too.
		// Iframes read older floors on demand through historyAccess; only recent floors and
		// the frame's own floor travel inline. Template display output is a host rendering
		// artifact that card scripts do not read.
		const TAVERN_FRAME_INLINE_FLOORS = 48;
		const tavernFrameRows = new WeakMap(), tavernFrameStubs = new WeakMap(), tavernFrameContexts = new WeakMap();
		function tavernFrameRow(row) {
			const data = row && typeof row === "object" && !row.stub ? row.pluginData : null;
			if (!data || (data.template_display === undefined && data.template_rendered === undefined)) return row;
			let view = tavernFrameRows.get(row);
			if (!view) {
				const pluginData = Object.assign({}, data);
				delete pluginData.template_display; delete pluginData.template_rendered;
				view = Object.assign({}, row, { pluginData: pluginData });
				tavernFrameRows.set(row, view);
			}
			return view;
		}
		function tavernFrameStub(row) {
			if (!row || typeof row !== "object" || row.stub) return row;
			let view = tavernFrameStubs.get(row);
			if (!view) {
				view = { pluginData: {}, message_id: row.message_id, role: row.role, message: "", swipe_id: row.swipe_id, swipes: [""], swipes_data: [], variables: {}, stub: true };
				if (row.is_hidden !== undefined) view.is_hidden = row.is_hidden;
				if (row.name !== undefined) view.name = row.name;
				tavernFrameStubs.set(row, view);
			}
			return view;
		}
		function tavernFrameHelperContext(context, turn) {
			if (!context || typeof context !== "object" || !Array.isArray(context.messages)) return context;
			let byTurn = tavernFrameContexts.get(context);
			if (!byTurn) { byTurn = new Map(); tavernFrameContexts.set(context, byTurn); }
			const key = String(Math.max(0, Number(turn) || 0));
			if (byTurn.has(key)) return byTurn.get(key);
			const own = context.turnMessageIds && context.turnMessageIds[key];
			const inlineFrom = context.historyAccess ? context.messages.length - TAVERN_FRAME_INLINE_FLOORS : 0;
			const view = Object.assign({}, context, { messages: context.messages.map(function (row, index) {
				return index < inlineFrom && index !== Number(own) ? tavernFrameStub(row) : tavernFrameRow(row);
			}) });
			byTurn.set(key, view);
			return view;
		}
		// Each update is compared once per frame; serialize each shared object only once.
		const tavernFrameJson = new WeakMap();
		function tavernFrameJsonOf(value) {
			if (!value || typeof value !== "object") return JSON.stringify(value);
			let json = tavernFrameJson.get(value);
			if (json === undefined) { json = JSON.stringify(value); tavernFrameJson.set(value, json); }
			return json;
		}

		function createTavernHelperContextUpdate(previous, next, previousTurn, nextTurn) {
			function clone(value) { return value === undefined ? undefined : JSON.parse(tavernFrameJsonOf(value)); }
			function same(left, right) { return left === right || tavernFrameJsonOf(left) === tavernFrameJsonOf(right); }
			const target = next && typeof next === "object" ? next : null;
			if (!target) return null;
			const turn = Math.max(0, Number(nextTurn) || 0);
			if (!previous || Number(previous.version) !== Number(target.version) || Number(target.stateRevision) < Number(previous.stateRevision)) {
				// Recovery replaces the view's state too; notify read-only renderers after installation.
				return { version: 1, kind: "snapshot", stateRevision: Math.max(0, Number(target.stateRevision) || 0), turn: turn, context: clone(target), events: ["MESSAGE_UPDATED", "mag_variable_update_ended"] };
			}
			const operations = [];
			const beforeMessages = Array.isArray(previous.messages) ? previous.messages : [];
			const afterMessages = Array.isArray(target.messages) ? target.messages : [];
			const shared = Math.min(beforeMessages.length, afterMessages.length);
			let variablesChanged = false;
			for (let index = 0; index < shared; index += 1) {
				if (same(beforeMessages[index], afterMessages[index])) continue;
				operations.push({ op: "message.replace", index: index, value: clone(afterMessages[index]) });
				if (!same(beforeMessages[index] && beforeMessages[index].variables, afterMessages[index] && afterMessages[index].variables)) variablesChanged = true;
			}
			if (afterMessages.length > shared) operations.push({ op: "messages.append", values: clone(afterMessages.slice(shared)) });
			if (afterMessages.length < beforeMessages.length) operations.push({ op: "messages.truncate", length: afterMessages.length });
			for (const key of ["turnMessageIds", "chatVariables", "scriptVariables", "globalVariables", "characterVariables", "worldbook", "character", "characterName", "playerName", "regexScripts", "lifecycleRevision"]) {
				if (same(previous[key], target[key])) continue;
				operations.push({ op: "value.replace", key: key, value: clone(target[key]) });
				if (["chatVariables", "scriptVariables", "globalVariables", "characterVariables"].includes(key)) variablesChanged = true;
			}
			const stateRevision = Math.max(0, Number(target.stateRevision) || 0);
			if (operations.length === 0 && Number(previousTurn) === turn && Number(previous.stateRevision) === stateRevision) return null;
			const events = [];
			if (afterMessages.length > beforeMessages.length && afterMessages.slice(beforeMessages.length).some(function (message) { return message && message.role === "assistant"; })) events.push("MESSAGE_RECEIVED");
			if (operations.length > 0) events.push("MESSAGE_UPDATED");
			if (variablesChanged) events.push("mag_variable_update_ended");
			return { version: 1, kind: "patch", baseRevision: Math.max(0, Number(previous.stateRevision) || 0), stateRevision: stateRevision, turn: turn, operations: operations, events: events };
		}

		function applyTavernHelperContextUpdate(previous, update) {
			function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			if (!update || Number(update.version) !== 1) throw new Error("不支持的 Helper Context 更新协议");
			if (update.kind === "snapshot") return { context: clone(update.context || {}), turn: Math.max(0, Number(update.turn) || 0), events: Array.isArray(update.events) ? update.events.slice() : [] };
			const before = previous && typeof previous === "object" ? previous : {};
			if (update.kind !== "patch" || Math.max(0, Number(before.stateRevision) || 0) !== Math.max(0, Number(update.baseRevision) || 0)) throw new Error("Helper Context 版本失配");
			// Patch operations replace complete messages/values; untouched history stays shared.
			// Copy the envelope and message list so append/truncate never mutate the prior view.
			const context = Object.assign({}, before, { messages: Array.isArray(before.messages) ? before.messages.slice() : [] });
			for (const operation of Array.isArray(update.operations) ? update.operations : []) {
				if (operation.op === "message.replace") context.messages[Math.max(0, Number(operation.index) || 0)] = clone(operation.value);
				else if (operation.op === "messages.append") context.messages.push(...clone(Array.isArray(operation.values) ? operation.values : []));
				else if (operation.op === "messages.truncate") context.messages.length = Math.max(0, Number(operation.length) || 0);
				else if (operation.op === "value.replace") context[operation.key] = clone(operation.value);
			}
			context.stateRevision = Math.max(0, Number(update.stateRevision) || 0);
			return { context: context, turn: Math.max(0, Number(update.turn) || 0), events: Array.isArray(update.events) ? update.events.slice() : [] };
		}

		// One transport per document: a loading iframe retains its bootstrap baseline.
		// State changes are coalesced until ready; recovery uses the same wire protocol.
		function createTavernFrameContextChannel(document) {
			let node = null;
			let ready = false;
			let current = { context: document.helperContext, turn: document.turn };
			return Object.freeze({
				attach: function (value) {
					node = value;
					if (!value) { ready = false; current = { context: document.helperContext, turn: document.turn }; }
				},
				accepts: function (event) { return Boolean(node && node.contentWindow && event.source === node.contentWindow && event.data && event.data.token === document.token); },
				element: function () { return node; },
				sync: function (context, turn, mode) {
					if (mode === "ready") ready = true;
					if (!ready || !node || !node.contentWindow || !context) return;
					const update = createTavernHelperContextUpdate(mode === "snapshot" ? null : current.context, context, current.turn, turn);
					if (!update) return;
					node.contentWindow.postMessage({ type: "dsh-tavern-helper-context-update", token: document.token, update: update }, "*");
					current = { context: context, turn: turn };
				}
			});
		}

		// Owns document replacement, authenticated frame messages and their cleanup.
		// React only renders the visible/pending documents and controls lazy activation.
		function createTavernMessageFrameLifecycle(initial, options) {
			const hostWindow = options && options.window || window;
			const invoke = options && options.rpc || rpc;
			const configuredSlashExecutor = options && options.executeSlash;
			const invalidate = options && options.invalidate || function (sessionId) { liveTavernView.invalidate(sessionId); };
			const channels = new Map();
            const generationOwners = new Set();
            function retireGenerations(document) {
                if (!document?.generationJobs) return;
                for (const job of document.generationJobs.values()) void Promise.resolve().then(job.stop).catch(function () {});
                document.generationJobs.clear();
                generationOwners.delete(document);
            }
            async function frameCall(document, method, args, sessionId, preparationId) {
                const send = (name, payload) => preparationId
                    ? invoke("callOpeningRuntime", {id:preparationId, method:name, args:payload})
                    : invoke(name, payload, sessionId);
                if (method !== "generateTavernHelper" && method !== "generateTavernHelperRaw") return send(method, args);
                const generationId = String(args?.config?.generation_id || "dsh-frame-" + nextTavernFrameToken());
                const generationToken = String(args?.generationToken || nextTavernFrameToken());
                const jobs = document.generationJobs || (document.generationJobs = new Map());
                if (jobs.has(generationId)) throw new Error("生成编号正在使用: " + generationId);
                const job = {stop:() => send("stopTavernHelperGeneration", {generationId, generationToken, pending:true})};
                jobs.set(generationId, job); generationOwners.add(document);
                try {
                    return await send(method, Object.assign({}, args, {generationToken,
                        config:Object.assign({}, args?.config || {}, {generation_id:generationId})}));
                } finally {
                    if (jobs.get(generationId) === job) jobs.delete(generationId);
                    if (!jobs.size) generationOwners.delete(document);
                }
            }
            const touchRelay = createTavernTouchRelay(hostWindow);
			const frameSizeObservers = new Map();
            const sizingObservers = new Map();
            const frameVisibility = new Map();
			let props = initial;
			let frozenHelperContext = initial.helperContext;
			let helperContext = frozenHelperContext;
			let refreshRevision = 0;
			let runtimeTimer = null;
			let pendingRuntime = null;
			let listener = null;
			let lifetime = 0;
			let synchronizationKey = "";
			let lastTextAccent = null;
			let documentInputs = null;
			let cachedDocumentKey = "";
			let desired = createDocument();
			let visible = desired;
			let pending = null;
			let height = (props.openingPreview ? 160 : restoredTavernFrameHeight(visible.heightKey, visible.content));
			function documentKey() {
				const values = [props.sessionId, props.content, props.persistent === true ? 0 : props.turn, props.observeMvuView, props.runtimeReporting, props.persistent, props.trustedCardMode, Boolean(props.helperContext), JSON.stringify(props.openingPreview), JSON.stringify(props.frameSizing), refreshRevision];
				if (!documentInputs || values.some(function (value, index) { return value !== documentInputs[index]; })) {
					documentInputs = values;
                    const keyValues = values.slice();
                    keyValues[9] = tavernFrameSizing(props.content, props.frameSizing, props.persistent ? props.panelId : undefined);
					cachedDocumentKey = JSON.stringify(keyValues);
				}
				return cachedDocumentKey;
			}
			function createDocument() {
				const document = {
					key: documentKey(), token: nextTavernFrameToken(),
					helperContext: tavernFrameHelperContext(helperContext, props.turn), turn: props.turn,
					heightKey: tavernFrameHeightKey(props), content: props.content,
                    sizing: tavernFrameSizing(props.content, props.frameSizing, props.persistent ? props.panelId : undefined),
					sessionId: props.sessionId,
					trustedCardMode: props.trustedCardMode, refreshRequested: false
				};
				document.html = buildTavernFrameDocument({ content: props.content, frameSizing: props.frameSizing, panelId: props.panelId, token: document.token, openingPreview: props.openingPreview, helperContext: tavernFrameHelperContext(helperContext, props.turn), trustedCardMode: props.trustedCardMode === true, turn: props.turn, observeMvuView: props.observeMvuView, runtimeReporting: props.runtimeReporting, persistent: props.persistent, preserveInstance: props.preserveInstance, textColorsEnabled: tavernTextColorsEnabled(hostWindow), colorScheme: hostWindow.document?.body && typeof hostWindow.getComputedStyle === "function" ? currentTavernHostTheme(hostWindow).colorScheme : undefined });
				const channel = createTavernFrameContextChannel(document);
				// Stable callback identity preserves the per-document delta baseline.
				document.ref = function (node) {
                    const previousSizing = sizingObservers.get(document.token);
                    if (previousSizing) { previousSizing.stop(); sizingObservers.delete(document.token); }
                    const stopVisibility = frameVisibility.get(document.token);
                    if (stopVisibility) { stopVisibility(); frameVisibility.delete(document.token); }
                    const previous = frameSizeObservers.get(document.token);
                    if (previous) { previous.disconnect(); frameSizeObservers.delete(document.token); }
					touchRelay.stop();
                    if (node) node.__dshTavernSessionId = document.sessionId;
                    channel.attach(node);
                    if (node && typeof hostWindow.IntersectionObserver === "function") {
                        let nearby = true;
                        const sync = () => node.contentWindow?.postMessage({ type: "dsh-tavern-frame-measure-active", token: document.token,
                            active: nearby && hostWindow.document.visibilityState !== "hidden" }, "*");
                        const observer = new hostWindow.IntersectionObserver(entries => {
                            nearby = entries[entries.length - 1]?.isIntersecting === true;
                            sync();
                        }, { rootMargin: "240px 0px" });
                        observer.observe(node);
                        node.addEventListener("load", sync);
                        hostWindow.document.addEventListener("visibilitychange", sync);
                        const stop = () => {
                            observer.disconnect();
                            node.removeEventListener("load", sync);
                            hostWindow.document.removeEventListener("visibilitychange", sync);
                        };
                        stop.sync = sync;
                        frameVisibility.set(document.token, stop);
                    }
                    // Trusted cards may replace their document and lose our reporter,
                    // then resize frameElement directly. Observe outside that document.
                    if (node && !document.sizing && document.trustedCardMode && typeof hostWindow.MutationObserver === "function") {
                        const observer = new hostWindow.MutationObserver(function () {
                            if (channel.element() !== node || frameSizeObservers.get(document.token) !== observer) return;
                            const raw = String(node.style && node.style.height || "");
                            if (!/^\d+(?:\.\d+)?px$/.test(raw)) return;
                            const value = clampTavernFrameHeight(parseFloat(raw));
                            if (document.height === value && (document !== visible || height === value)) return;
                            document.height = value;
                            if (document === visible) { rememberHeight(document, value); publish(); }
                        });
                        frameSizeObservers.set(document.token, observer);
                        observer.observe(node, { attributes: true, attributeFilter: ["style"] });
                    }
					if (node) channels.set(document.token, channel);
                    if (node && document.sizing) sizingObservers.set(document.token, observeTavernFrameSizing(hostWindow, node, document.sizing, function (layout) {
                        document.layout = layout;
                        if (document.sizing.mode !== "content") applySizing(document, channel, layout.height);
                    }));
                    if (!node) { retireGenerations(document); channels.delete(document.token); }
				};
				return document;
			}
            function applySizing(document, channel, measured) {
                const config = document.sizing;
                const node = channel.element();
                if (config && (node === hostWindow.document?.fullscreenElement || node?.hasAttribute?.("data-dsh-tavern-expanded"))) return;
                const value = config ? tavernFrameSizingHeight(config, document.layout?.width || 0, document.layout?.available || hostWindow.innerHeight || 600, measured) : clampTavernFrameHeight(measured);
                const changed = document.height !== value;
                document.height = value;
                if (config) channel.element()?.contentWindow?.postMessage({ type: "dsh-tavern-frame-layout", token: document.token, scroll: config.mode === "content" && measured > value }, "*");
                if (document === visible && (changed || height !== value || (config && Math.abs(node?.clientHeight - value) > 1))) { rememberHeight(document, value); publish(); }
            }
			function snapshot() { return { visibleDocument: visible, pendingDocument: pending, height: height }; }
			function publish() { if (listener) listener(snapshot()); }
			function cancelRuntimeReport() {
				if (runtimeTimer !== null) hostWindow.clearTimeout(runtimeTimer);
				runtimeTimer = null;
				pendingRuntime = null;
			}
			function sendContext(document, mode) {
				const channel = document && channels.get(document.token);
				if (channel) channel.sync(tavernFrameHelperContext(helperContext, props.turn), props.turn, mode);
			}
			function sendTextColors(document, theme) {
				const body = hostWindow.document && hostWindow.document.body;
				if (!body || typeof hostWindow.getComputedStyle !== "function") return;
				const current = theme || currentTavernHostTheme(hostWindow), textColorOverrides = current.textColorOverrides;
                if (!document && textColorOverrides.quote + ":" + current.colorScheme === lastTextAccent) return;
                lastTextAccent = textColorOverrides.quote + ":" + current.colorScheme;
				channels.forEach(function (channel, token) {
					if (document && token !== document.token) return;
					const node = channel.element();
					if (node && node.contentWindow) node.contentWindow.postMessage({ type: "dsh-tavern-text-colors", token: token, enabled: tavernTextColorsEnabled(hostWindow), textColorOverrides: textColorOverrides, colorScheme: current.colorScheme }, "*");
				});
			}
			function reconcile() {
				if (desired.key === visible.key) {
					if (pending) { retireGenerations(pending); pending = null; publish(); }
				} else if (!pending || pending.key !== desired.key) {
					if (pending && pending !== desired) retireGenerations(pending);
                    pending = desired;
					publish();
				}
			}
			function update(next) {
				const sessionChanged = props.sessionId !== next.sessionId;
				if (sessionChanged || props.turn !== next.turn || props.partIndex !== next.partIndex) {
					lifetime++;
					cancelRuntimeReport();
				}
				props = next;
				if (sessionChanged || props.eager === true) frozenHelperContext = props.helperContext;
				helperContext = props.eager === true ? props.helperContext : frozenHelperContext;
				if (desired.key !== documentKey()) desired = createDocument();
				if (sessionChanged) {
					// Never keep an old conversation's page eligible for writes in a new one.
                    for (const owner of Array.from(generationOwners)) retireGenerations(owner);
					channels.clear();
					visible = desired; pending = null;
					height = (props.openingPreview ? 160 : restoredTavernFrameHeight(visible.heightKey, visible.content));
					publish();
				} else reconcile();
				const contextKey = helperContext ? [helperContext.version, helperContext.stateRevision, helperContext.lifecycleRevision].map(function (value) { return String(Number(value) || 0); }).join(":") : "";
				const nextSynchronizationKey = visible.token + ":" + String(props.turn) + ":" + contextKey;
				// Height changes and parent rerenders must not rescan the message history.
				if (nextSynchronizationKey !== synchronizationKey) {
					synchronizationKey = nextSynchronizationKey;
					sendContext(visible);
				}
			}
			function rememberHeight(document, value) {
				height = value;
				try { hostWindow.sessionStorage.setItem(document.heightKey, value); } catch (_) {}
			}
            function submitOpening(document, text) {
                if (!listener || document !== visible || document.key !== desired.key || typeof props.onSubmitOpening !== "function") return Promise.reject(new Error("开场预览已失效，请重新打开"));
                if (!document.openingSender) document.openingSender = createTavernFrameLifecycle(hostWindow).sender({
                    once: true,
                    valid: () => Boolean(listener) && document === visible && document.key === desired.key && typeof props.onSubmitOpening === "function",
                    stale: "开场预览已失效，请重新打开",
                    submit: text => props.onSubmitOpening(text)
                });
                return document.openingSender.send(text);
            }
            // A native tavern regex UI reads and writes #send_textarea in the host
            // document. In trusted mode that element exists here, so its value and
            // input events must reach the real composer draft.
            function composerApi() { return configuredSlashExecutor || props.executeSlash; }
            function writeComposerInput(text, sessionId) {
                const target = String(sessionId || props.sessionId || "");
                if (!target) throw new Error("当前界面无法写入输入框，请刷新页面后重试");
                const api = composerApi();
                if (typeof api === "function") return api("/setinput " + String(text == null ? "" : text), target);
                throw new Error("当前界面无法写入输入框，请刷新页面后重试");
            }
            function readComposerInput(sessionId) {
                const target = String(sessionId || props.sessionId || "");
                const api = composerApi();
                if (!api || !target || typeof api.readInput !== "function") return "";
                try { return api.readInput(target); } catch (_) { return ""; }
            }
			function receive(event) {
				const data = event && event.data;
				const channel = data && channels.get(data.token);
				if (!channel || !channel.accepts(event)) return;
				const sourceDocument = visible.token === data.token ? visible : (pending && pending.token === data.token ? pending : null);
				if (!sourceDocument) return;
				const requestProps = props;
				const requestLifetime = lifetime;
				function current() { return lifetime === requestLifetime && channels.get(data.token) === channel && (visible === sourceDocument || pending === sourceDocument); }
				if (data.type === "dsh-tavern-status-stale" && props.persistent === true && sourceDocument.key === desired.key && !sourceDocument.refreshRequested) {
					sourceDocument.refreshRequested = true;
					refreshRevision++;
					desired = createDocument();
					reconcile();
					return;
				}
				if (data.type === "dsh-tavern-frame-ready") {
                    frameVisibility.get(data.token)?.sync();
                    sizingObservers.get(data.token)?.schedule();
					sendTextColors(sourceDocument);
					sendContext(sourceDocument, "ready");
					if (sourceDocument === pending && pending.key === desired.key) {
						rememberHeight(pending, pending.height || (props.openingPreview ? 160 : restoredTavernFrameHeight(pending.heightKey, pending.content)));
						touchRelay.stop();
						retireGenerations(visible);
                        visible = pending; pending = null;
						publish();
					}
				} else if (data.type === "dsh-tavern-frame-touch-start" || data.type === "dsh-tavern-frame-scroll") {
                    if (sourceDocument === visible && channel.element()) touchRelay.receive(channel.element(), data.token, data);
				} else if (data.type === "dsh-tavern-frame-height") {
					if (!sourceDocument.sizing || sourceDocument.sizing.mode === "content") applySizing(sourceDocument, channel, data.height);
				} else if (data.type === "dsh-tavern-helper-context-request") {
					sendContext(sourceDocument, "snapshot");
				} else if (data.type === "dsh-tavern-mvu-view-used" && props.observeMvuView !== false && props.sessionId && props.turn > 0) {
					invoke("captureDisplayRuntime", { turn: props.turn, partIndex: props.partIndex, runtime: { capturedAt: Date.now(), mvuViewUsed: true } }, props.sessionId).then(function (result) {
						if (current() && result && result.captured === true) invalidate(requestProps.sessionId);
					}, function () {});
				} else if (data.type === "dsh-tavern-frame-runtime" && props.runtimeReporting !== false && props.sessionId && props.turn > 0) {
					pendingRuntime = Object.assign({}, data.runtime, { layout: Object.assign({}, data.runtime?.layout, {
                        availableHeight: sourceDocument.layout?.available, reason: sourceDocument.sizing?.mode === "content" ? "content" : sourceDocument.layout?.reason || "content",
                        mode: sourceDocument.sizing?.mode || "legacy", source: sourceDocument.sizing?.source || "legacy"
                    }) });
					if (runtimeTimer === null) runtimeTimer = hostWindow.setTimeout(function () {
						runtimeTimer = null;
						const runtime = pendingRuntime; pendingRuntime = null;
						if (current()) invoke("captureDisplayRuntime", { turn: requestProps.turn, partIndex: requestProps.partIndex, runtime: Object.assign({}, runtime, { panelId: requestProps.panelId || "", placement: requestProps.placement || (requestProps.persistent ? "sidebar" : "message") }) }, requestProps.sessionId).catch(function () {});
					}, 1000);
				} else if ((data.type === "dsh-tavern-opening-worldbook" || data.type === "dsh-tavern-opening-save" || data.type === "dsh-tavern-opening-read") && !props.sessionId && props.openingPreview) {
					void (async function () {
					try {
						if (sourceDocument.key !== desired.key) throw new Error("开场预览已失效");
						const preview = props.openingPreview;
						let result;
						if (data.type === "dsh-tavern-opening-read") {
							result = await invoke("getOpeningPreparation", { id: preview.preparationId });
						} else if (data.type === "dsh-tavern-opening-worldbook") {
							if (!preview.preparationId) throw new Error("开局草稿不存在");
							result = await invoke("replaceOpeningWorldbook", { id: preview.preparationId, entries: data.entries, expectedEntries: data.expectedEntries });
						} else {
							openingPreviewSelection(preview, data.swipeId);
							result = preview.preparationId ? await invoke("saveOpeningSelection", { id: preview.preparationId, openingId: openingPreviewSelection(preview, data.swipeId) }) : { saved: true };
						}
						event.source.postMessage({ type: "dsh-tavern-opening-response", token: data.token, requestId: data.requestId, ok: true, result }, "*");
					} catch (error) {
						event.source.postMessage({ type: "dsh-tavern-opening-response", token: data.token, requestId: data.requestId, ok: false, error: String(error.message || error) }, "*");
					}
					})();
				} else if (data.type === "dsh-tavern-opening-select" && !props.sessionId && props.openingPreview) {
					try {
						const openingId = openingPreviewSelection(props.openingPreview, data.swipeId);
						if (sourceDocument !== visible || sourceDocument.key !== desired.key || typeof props.onSelectOpening !== "function") throw new Error("开场预览已失效");
						props.onSelectOpening(openingId);
						event.source.postMessage({ type: "dsh-tavern-opening-response", token: data.token, requestId: data.requestId, ok: true }, "*");
					} catch (error) {
						event.source.postMessage({ type: "dsh-tavern-opening-response", token: data.token, requestId: data.requestId, ok: false, error: String(error.message || error) }, "*");
					}
				} else if (data.type === "dsh-tavern-helper-call" && !props.sessionId && props.openingPreview) {
					// The pending frame initializes its private draft before it becomes visible.
					if (sourceDocument.key !== desired.key) return;
                    if (data.method === "triggerTavernSlash") {
                        // Only a pipe ending in /trigger starts the game. Scripts also query
                        // (/pass {{user}}) or notify (/echo); answer those without starting.
                        const line = String(data.args && data.args.line || "");
                        // A lone /send or /sys only prepares the text; the page has to
                        // stay mounted until the script saves its data and sends /trigger.
                        const preparesOnly = /^\/(send|sys)\s+[\s\S]+$/.test(line.trim()) && !/(?<!\\)\|(?=\s*\/)/.test(line);
                        if (!preparesOnly && !/(?:^|\|)\s*\/trigger(?:\s[^|]*)?\s*$/.test(line)) {
                            const query = /^\s*\/pass\s+([\s\S]*)$/.exec(line);
                            const names = { user: String(helperContext && helperContext.playerName || "你"), char: String(helperContext && helperContext.characterName || "角色") };
                            const result = query ? { pipe: query[1].replace(/{{\s*(user|char)\s*}}/gi, function (_, key) { return names[key.toLowerCase()]; }).replace(/{{[^{}]*}}/g, "") }
                                : /^\s*\/echo\b/.test(line) ? { pipe: "" } : null;
                            if (current()) event.source.postMessage(result
                                ? { type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result: result }
                                : { type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: "开局准备页只执行 /send 文本、/sys 文本或以 /trigger 结束的开局命令" }, "*");
                            return;
                        }
                        // Calls arrive in the order the card makes them, so they queue
                        // behind each other; the draft keeps what a lone /send recorded.
                        const step = (sourceDocument.openingCommandQueue || Promise.resolve()).then(async function () {
                            if (!current() || sourceDocument !== visible) throw new Error("开场预览已失效，请重新打开");
                            const plan = await invoke("callOpeningRuntime", { id: props.openingPreview.preparationId,
                                method: "prepareOpeningCommand", args: { line: line,
                                    openingId: openingPreviewSelection(props.openingPreview, props.openingPreview.selectedIndex) } });
                            if (plan && plan.deferred) return { pipe: "", deferred: true };
                            if (!sourceDocument.openingCommandStarted) sourceDocument.openingCommandStarted = submitOpening(sourceDocument, plan.input);
                            return sourceDocument.openingCommandStarted;
                        }).catch(function (error) {
                            tavernErrorHub.report("开始游戏", error);
                            throw error;
                        });
                        sourceDocument.openingCommandQueue = step.then(function () {}, function () {});
                        step.then(function (result) {
                            if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result }, "*");
                        }, function (error) {
                            if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: String(error.message || error) }, "*");
                        });
                        return;
                    }
					(data.method === "submitTavernHelperInput"
                        ? submitOpening(sourceDocument, data.args && data.args.text)
                        : frameCall(sourceDocument, data.method, data.args, undefined, requestProps.openingPreview.preparationId)).then(function (result) {
						if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result }, "*");
					}, function (error) {
						if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: String(error.message || error) }, "*");
					});
				} else if (data.type === "dsh-tavern-helper-call" && props.sessionId) {
					const allowedMethods = new Set(["generateTavernHelper", "generateTavernHelperRaw", "stopTavernHelperGeneration", "stopAllTavernHelperGeneration", "prepareSessionOpening", "createTavernHelperMessages", "updateTavernHelperPrompts", "updateTavernHelperVariables", "updateTavernHelperMessages", "getTavernHelperWorldbook", "replaceTavernHelperWorldbook", "patchTavernHelperWorldbook"]);
					if (data.method === "startSessionOpening") {
						const request = sourceDocument.openingRequest;
						const start = async function () {
							if (!current() || !request || request.preparationId !== (data.args && data.args.preparationId)) throw new Error("请先保存开场选择");
							if (!sourceDocument.openingStart) sourceDocument.openingStart = new Promise(function (resolve, reject) {
								const detail = { request: request, sourceSessionId: props.sessionId, resolve: resolve, reject: reject, handled: false };
								hostWindow.dispatchEvent(new CustomEvent("dsh-tavern-start-session-opening", { detail: detail }));
								if (!detail.handled) reject(new Error("开局入口尚未就绪，请刷新页面"));
							}).catch(function (error) { sourceDocument.openingStart = null; throw error; });
							return sourceDocument.openingStart;
						};
						start().then(function (result) {
							if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result: result }, "*");
						}, function (error) {
							tavernErrorHub.report("开始旅程", error);
							if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: String(error.message || error) }, "*");
						});
						return;
					}

					if (data.method === "triggerTavernSlash") {
						const executeSlash = configuredSlashExecutor || requestProps.executeSlash;
						Promise.resolve().then(function () {
							if (typeof executeSlash !== "function") throw new Error("当前界面无法触发生成，请刷新页面后重试");
							return executeSlash(String(data.args && data.args.line || ""), props.sessionId);
						}).then(function (result) {
							return invoke("getSession", {}, props.sessionId).then(function (snapshot) {
								const context = snapshot && snapshot.view && snapshot.view.tavernHelper;
								if (context) helperContext = context;
								return Object.assign({}, typeof result === "string" ? { pipe: result } : result || {}, context ? { context: tavernFrameHelperContext(context, props.turn) } : {});
							});
						}).then(function (result) {
							if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result: result }, "*");
						}, function (error) {
							if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: String(error && error.message || error), errorCode: String(error && error.code || "") }, "*");
						});
						return;
					}
                    if (!allowedMethods.has(data.method)) {
                        event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false,
                            error: "当前消息不支持 Helper 方法: " + String(data.method || ""), errorCode: "UNSUPPORTED_HELPER_METHOD" }, "*");
                        return;
                    }
					const args = Object.assign({}, data.args || {}, { sessionId: props.sessionId, expectedLifecycleRevision: Math.max(0, Number(helperContext && helperContext.lifecycleRevision) || 0) });
					frameCall(sourceDocument, data.method, args, requestProps.sessionId).then(function (result) {
						if (current() && data.method === "prepareSessionOpening") sourceDocument.openingRequest = result;
						if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: true, result: result }, "*");
					}, function (error) {
						if (data.method === "prepareSessionOpening") tavernErrorHub.report("开始旅程", error);
						if (current()) event.source.postMessage({ type: "dsh-tavern-helper-response", token: data.token, requestId: data.requestId, ok: false, error: String(error && error.message || error) }, "*");
					});
				}
			}
			return Object.freeze({
				update: update, snapshot: snapshot,
				start: function (onChange) {
					listener = onChange;
					// Preview companions can import modules that append UI to the real host.
					// Give them the same lifetime cleanup as the conversation script runtime.
					const openingArtifacts = props.openingPreview && props.trustedCardMode
						? createTavernHostArtifactScope({ document: hostWindow.document }) : null;
					hostWindow.addEventListener("message", receive);
                    const releaseComposer = props.trustedCardMode && hostWindow.document
                        ? installFrameHostComposer(hostWindow.document, function (node) {
                            const channel = channels.get(visible.token);
                            return Boolean(listener && visible.key === desired.key && node && channel && channel.element() === node);
                        }, function (text) {
                            if (!listener || visible.key !== desired.key) throw new Error("卡片已失效，请重新打开");
                            if (props.openingPreview) {
                                return submitOpening(visible, text);
                            }
                            const executeSlash = configuredSlashExecutor || props.executeSlash;
                            if (!props.sessionId || typeof executeSlash !== "function") throw new Error("当前界面无法触发生成，请刷新页面后重试");
                            return executeSlash("/send " + text + "|/trigger", props.sessionId);
                        }, function (error) { tavernErrorHub.report("填写输入框", error); },
                        writeComposerInput, readComposerInput) : function () {};

					const unsubscribeTheme = hostWindow.document && typeof hostWindow.MutationObserver === "function"
						? subscribeTavernHostTheme(hostWindow, function (theme) { sendTextColors(null, theme); }) : null;
					return function () {
                        touchRelay.stop();
						releaseComposer();
						if (openingArtifacts) {
							for (const channel of channels.values()) {
								const frame = channel.element();
								if (frame) releaseTavernHostJQueryHandlers(hostWindow, frame.contentWindow);
							}
							openingArtifacts.dispose();
						}
						if (unsubscribeTheme) unsubscribeTheme();
                        frameSizeObservers.forEach(function (observer) { observer.disconnect(); });
                        frameSizeObservers.clear();
                        sizingObservers.forEach(observer => observer.stop());
                        sizingObservers.clear();
                        frameVisibility.forEach(stop => stop());
                        frameVisibility.clear();
                        for (const owner of Array.from(generationOwners)) retireGenerations(owner);
						listener = null; lifetime++;
						hostWindow.removeEventListener("message", receive);
						cancelRuntimeReport();
					};
				}
			});
		}

		// Own only placement, never iframe content or story state. moveBefore keeps
		// the browsing context alive; appendChild would silently reset form state.
		function createTavernPanelRegistry() {
			const entries = new Map(), listeners = new Set();
			let snapshot = [], activation = 0, reveal = null;
			function publish() { snapshot = Array.from(entries.values()); listeners.forEach(function (fn) { fn(); }); }
			function move(entry, target) {
				if (!target || entry.node.parentNode === target) return;
				if (typeof target.moveBefore !== "function") throw new Error("当前浏览器不支持保留页面状态的移动，请在原消息中使用此面板。");
				target.moveBefore(entry.node, null);
			}
			return {
				subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
				inspect: function () { return snapshot; },
				register: function (entry) {
					entries.set(entry.id, entry); publish();
					return function () {
						if (entries.get(entry.id) !== entry) return;
						if (entry.node.parentNode !== entry.home && entry.home.isConnected) move(entry, entry.home);
						entries.delete(entry.id); publish();
					};
				},
				pin: function (id, pinned) {
					const entry = entries.get(id); if (!entry) return;
					if (typeof entry.home.moveBefore !== "function") throw new Error("当前浏览器不支持保留页面状态的移动，请在原消息中使用此面板。");
					if (!pinned) move(entry, entry.home);
					entry.pinned = pinned; if (pinned) entry.activation = ++activation; publish();
					// The panel docks only where the status tab is mounted; bring that tab forward.
					if (pinned && reveal) reveal(entry.sessionId);
				},
				onPin: function (fn) { reveal = fn; return function () { if (reveal === fn) reveal = null; }; },
				dock: function (id, target) { const entry = entries.get(id); if (entry && entry.pinned) move(entry, target); },
				restore: function (id) { const entry = entries.get(id); if (entry && entry.home.isConnected) move(entry, entry.home); }
			};
		}
		const tavernPanelRegistry = createTavernPanelRegistry();

		// @include modules/frame-activation.js
		const enqueueTavernFrameActivation = createTavernFrameActivationQueue(window);

		// @include modules/retained-message-frames.js
        const tavernRetainedFrames = createRetainedTavernFrames({ window: window, retention: tavernSessionRetention,
            panels: tavernPanelRegistry, createLifecycle: function (props) { return createTavernMessageFrameLifecycle(props); } });
