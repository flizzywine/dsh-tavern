		// Browser half of the public plugin API (docs/plugin-api.md): the `tavernUi`
		// service, plugin media under assistant text, markers and plugin buttons.
		// Only additive changes: published plugins depend on these names.
		// @include-domain plugin-text-segments.js

		function createTavernUiExtensions() {
			const mediaRenderers = new Map();
			const markers = [];
			const messageActions = [];
			const composerActions = [];
			const panels = new Map();
			const listeners = new Set();
			// Tavern's own context, for the sidebar a plugin panel opens in (set at apply).
			let host = null;
			let version = 0;
			function changed() { version += 1; Array.from(listeners).forEach(function (listener) { listener(); }); }
			function ownerOf(service) {
				const ctx = service && service.ctx;
				const fiber = ctx && (ctx[Symbol.for("cordis.shadow")] ? Object.getPrototypeOf(ctx) : ctx).fiber;
				return String(fiber && fiber.name || "插件");
			}
			function owned(service, register, label) {
				const ctx = service && service.ctx;
				return ctx && typeof ctx.effect === "function" ? ctx.effect(register, label) : register();
			}
			function addTo(list, entry) {
				list.push(entry);
				changed();
				return function () { const index = list.indexOf(entry); if (index >= 0) { list.splice(index, 1); changed(); } };
			}
			function action(input, kind) {
				if (!input || typeof input.label !== "string" || !input.label.trim()) throw new TypeError(kind + " 需要 label");
				if (typeof input.run !== "function") throw new TypeError(kind + " 需要 run 函数");
				if (input.when !== undefined && typeof input.when !== "function") throw new TypeError(kind + " 的 when 必须是函数");
				return { id: String(input.id || input.label), label: input.label.trim(), when: input.when, run: input.run };
			}
			const service = {
				ctx: undefined,
				apiVersion: 2,
				registerMediaRenderer(kind, render) {
					if (typeof kind !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/.test(kind)) throw new TypeError("只能为插件自定义的 <插件名>/<类型> 注册显示方式");
					if (typeof render !== "function") throw new TypeError("registerMediaRenderer 需要 render 函数");
					const entry = { owner: ownerOf(this), render: render };
					return owned(this, function () {
						mediaRenderers.set(kind, entry);
						changed();
						return function () { if (mediaRenderers.get(kind) === entry) { mediaRenderers.delete(kind); changed(); } };
					}, "tavernUi.registerMediaRenderer()");
				},
				registerTextMarker(input) {
					if (!input || !(input.pattern instanceof RegExp)) throw new TypeError("registerTextMarker 需要正则 pattern");
					if (typeof input.render !== "function") throw new TypeError("registerTextMarker 需要 render 函数");
					const entry = { owner: ownerOf(this), pattern: input.pattern, render: input.render };
					return owned(this, function () { return addTo(markers, entry); }, "tavernUi.registerTextMarker()");
				},
				registerMessageAction(input) {
					const entry = Object.assign({ owner: ownerOf(this) }, action(input, "registerMessageAction"));
					return owned(this, function () { return addTo(messageActions, entry); }, "tavernUi.registerMessageAction()");
				},
				registerComposerAction(input) {
					const entry = Object.assign({ owner: ownerOf(this) }, action(input, "registerComposerAction"));
					return owned(this, function () { return addTo(composerActions, entry); }, "tavernUi.registerComposerAction()");
				},
				// Call a host handler registered with tavern.handle(name, handler); JSON in, JSON out.
				callHost(name, args) {
					if (typeof name !== "string" || !name) return Promise.reject(new TypeError("callHost 需要处理函数的名字"));
					return rpc("callPluginHandler", { name: name, args: args === undefined ? {} : args }).then(function (reply) { return reply ? reply.result : null; });
				},
				// A sidebar page of the plugin's own, for the game open beside it (apiVersion 2).
				registerPanel(input) {
					if (!input || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.id)) throw new TypeError("registerPanel 的 id 只能用小写字母、数字、点、下划线和连字符");
					if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 40) throw new TypeError("registerPanel 需要 1–40 字的 title");
					if (typeof input.render !== "function") throw new TypeError("registerPanel 需要 render 函数");
					const owner = ownerOf(this);
					const tabId = "tavern-plugin:" + owner + ":" + input.id;
					const render = input.render, title = input.title.trim();
					return owned(this, function () {
						if (panels.has(tabId)) throw new Error("面板 " + input.id + " 已注册");
						if (!host || !host.betterSidebar || typeof host.betterSidebar.registerTab !== "function") throw new Error("当前界面没有侧栏，无法注册插件面板");
						const dispose = host.betterSidebar.registerTab({ id: tabId, title: title, order: 60, single: true,
							component: function (props) {
								const gameId = props.scope && props.scope.sessionId || "";
								return React.createElement(tavernPluginBoundary(), { owner: owner, fallback: React.createElement("p", { className: "dsh-tavern-plugin-panel-error" }, "插件 " + owner + " 的面板出错了") },
									gameId ? render({ gameId: gameId, visible: props.visible !== false }) : React.createElement("p", { className: "dsh-tavern-plugin-panel-empty" }, "请先打开一局游戏。"));
							} });
						panels.set(tabId, owner);
						changed();
						return function () { if (typeof dispose === "function") dispose(); panels.delete(tabId); changed(); };
					}, "tavernUi.registerPanel()");
				}
			};
			Object.defineProperty(service, Symbol.for("cordis.tracker"), { value: { associate: "tavernUi", property: "ctx" } });
			return {
				service: service,
				attachHost: function (ctx) { host = ctx; },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				getSnapshot: function () { return version; },
				mediaRenderer: function (kind) { return mediaRenderers.get(kind); },
				markers: function () { return markers.slice(); },
				messageActions: function () { return messageActions.slice(); },
				composerActions: function () { return composerActions.slice(); }
			};
		}
		const tavernUiExtensions = createTavernUiExtensions();
		function useTavernUiExtensions() {
			return React.useSyncExternalStore(tavernUiExtensions.subscribe, tavernUiExtensions.getSnapshot, tavernUiExtensions.getSnapshot);
		}

		// Created on first use: React is the host's, not available at bundle load.
		let tavernPluginBoundaryClass = null;
		function tavernPluginBoundary() {
			if (tavernPluginBoundaryClass) return tavernPluginBoundaryClass;
			tavernPluginBoundaryClass = class TavernPluginBoundary extends React.Component {
				constructor(props) { super(props); this.state = { failed: false }; }
				static getDerivedStateFromError() { return { failed: true }; }
				componentDidCatch(error) { try { tavernErrorHub.report("插件 " + this.props.owner, error); } catch (_) {} }
				render() { return this.state.failed ? (this.props.fallback === undefined ? null : this.props.fallback) : this.props.children; }
			};
			return tavernPluginBoundaryClass;
		}

		// Per-session index of turns holding plugin items; refreshed by the host signal.
		const tavernPluginMediaIndex = (function () {
			const entries = new Map();
			function entryFor(sessionId) {
				let entry = entries.get(sessionId);
				if (entry) return entry;
				entry = { turns: new Set(), version: 0, listeners: new Set(), stop: null, revision: 0 };
				entries.set(sessionId, entry);
				return entry;
			}
			async function refresh(sessionId) {
				const entry = entryFor(sessionId);
				const requested = ++entry.revision;
				try {
					const result = await rpc("pluginMediaTurns", {}, sessionId);
					if (requested !== entry.revision) return;
					entry.turns = new Set((result.turns || []).map(Number));
				} catch (_) { if (requested !== entry.revision) return; }
				entry.version += 1;
				Array.from(entry.listeners).forEach(function (listener) { listener(); });
			}
			function subscribe(sessionId, listener) {
				const entry = entryFor(sessionId);
				entry.listeners.add(listener);
				if (!entry.stop) {
					let stop = function () {};
					try {
						if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") {
							stop = tavernSessionSignals.subscribe(sessionId, "plugin-media", function () { void refresh(sessionId); });
						}
					} catch (_) {}
					entry.stop = stop;
					void refresh(sessionId);
				}
				return function () {
					entry.listeners.delete(listener);
					if (!entry.listeners.size) { entry.stop(); entries.delete(sessionId); }
				};
			}
			return {
				subscribe: subscribe,
				version: function (sessionId) { return entries.get(sessionId) ? entries.get(sessionId).version : 0; },
				has: function (sessionId, turn) { return Boolean(entries.get(sessionId) && entries.get(sessionId).turns.has(Number(turn))); }
			};
		})();

		function useTavernPluginMedia(sessionId, turn, enabled) {
			const subscribe = React.useCallback(function (listener) { return sessionId ? tavernPluginMediaIndex.subscribe(sessionId, listener) : function () {}; }, [sessionId]);
			const indexVersion = React.useSyncExternalStore(subscribe, function () { return tavernPluginMediaIndex.version(sessionId); });
			const wanted = Boolean(enabled && sessionId && turn > 0 && tavernPluginMediaIndex.has(sessionId, turn));
			const [state, setState] = React.useState({ key: null, items: [] });
			React.useEffect(function () {
				let active = true;
				if (!wanted) { setState({ key: null, items: [] }); return; }
				rpc("pluginMediaForTurn", { turn: turn }, sessionId).then(function (result) {
					if (active) setState({ key: result.key || null, items: Array.isArray(result.items) ? result.items : [] });
				}, function () {});
				return function () { active = false; };
			}, [sessionId, turn, wanted, indexVersion]);
			return state;
		}

		function tavernPluginMediaUrl(sessionId, item) {
			return "/api/dsh-tavern/plugin-media?" + new URLSearchParams({ sessionId: sessionId, id: item.id, v: String(item.updatedAt || "") }).toString();
		}

		function TavernPluginMediaItem(props) {
			useTavernUiExtensions();
			const h = React.createElement;
			const item = props.item;
			const caption = item.caption ? h("figcaption", null, item.caption) : null;
			let body;
			if (item.kind.indexOf("/") > 0) {
				const renderer = tavernUiExtensions.mediaRenderer(item.kind);
				if (!renderer) return null;
				body = h(tavernPluginBoundary(), { owner: renderer.owner }, renderer.render({ item: Object.assign({}, item, { url: item.attachment ? tavernPluginMediaUrl(props.sessionId, item) : "" }), gameId: props.sessionId, turn: props.turn }));
			} else if (item.status === "pending") {
				body = h("div", { className: "dsh-tavern-plugin-media-pending", role: "status" }, typeof item.progress === "number" ? "生成中… " + Math.round(item.progress * 100) + "%" : "生成中…");
			} else if (item.status === "failed") {
				body = h("div", { className: "dsh-tavern-plugin-media-failed", role: "status" }, item.error ? "生成失败：" + item.error : "生成失败");
			} else if (item.attachment) {
				const url = tavernPluginMediaUrl(props.sessionId, item);
				if (item.kind === "image") body = h("a", { href: url, "aria-label": "放大插图", onClick: function (event) { event.preventDefault(); openSceneImagePreview(url, event.currentTarget); } }, h("img", { src: url, alt: item.caption || "插图", loading: "lazy" }));
				else if (item.kind === "video") body = h("video", { src: url, controls: true, preload: "metadata", playsInline: true });
				else body = h("audio", { src: url, controls: true, preload: "metadata" });
			}
			if (!body) return null;
			return h("figure", { className: "dsh-tavern-plugin-media dsh-tavern-illustration", "data-kind": item.kind, "data-owner": item.owner }, body, caption);
		}

		function TavernPluginMarker(props) {
			const marker = props.marker;
			const fallback = React.createElement("span", null, props.match[0]);
			let rendered;
			try {
				rendered = marker.render({ match: props.match[0], groups: props.match.slice(1), gameId: props.sessionId, turn: props.turn, streaming: Boolean(props.streaming) });
			} catch (error) {
				try { tavernErrorHub.report("插件 " + marker.owner, error); } catch (_) {}
				return fallback;
			}
			if (rendered === null || rendered === undefined) return fallback;
			return React.createElement(tavernPluginBoundary(), { owner: marker.owner, fallback: fallback }, rendered);
		}

		/**
		 * Context for renderTavernAssistantBlocks: which markers apply and which
		 * media still needs a place. `placed` collects anchored ids during render.
		 */
		function createTavernPluginTextContext(input) {
			const markers = tavernUiExtensions.markers();
			// `extras` are Tavern's own anchored elements (the built-in scene picture).
			const extras = new Map((input.extras || []).filter(function (extra) { return extra.anchor; }).map(function (extra) { return [extra.id, extra]; }));
			const anchored = input.items.filter(function (item) { return item.anchor; }).concat(Array.from(extras.values()));
			if (!markers.length && !anchored.length) return null;
			const byId = new Map(input.items.map(function (item) { return [item.id, item]; }));
			const placed = new Set();
			const anchors = input.streaming ? [] : anchored.map(function (item) { return { id: item.id, anchor: item.anchor }; });
			return {
				placed: placed,
				render: function (text, key, renderText) {
					const result = segmentPluginText(text, { markers: markers.map(function (marker) { return marker.pattern; }), anchors: anchors.filter(function (anchor) { return !placed.has(anchor.id); }) });
					result.placed.forEach(function (id) { placed.add(id); });
					if (result.segments.length === 1 && result.segments[0].kind === "text") return renderText(text, key);
					return React.createElement(React.Fragment, { key: key }, result.segments.map(function (segment, index) {
						if (segment.kind === "text") return renderText(segment.text, index);
						if (segment.kind === "media") return React.createElement(React.Fragment, { key: index }, segment.ids.map(function (id) {
							if (extras.has(id)) return React.createElement(React.Fragment, { key: id }, extras.get(id).render());
							return React.createElement(TavernPluginMediaItem, { key: id, item: byId.get(id), sessionId: input.sessionId, turn: input.turn });
						}));
						return React.createElement(TavernPluginMarker, { key: index, marker: markers[segment.marker], match: segment.match, sessionId: input.sessionId, turn: input.turn, streaming: input.streaming });
					}));
				},
				renderHtmlMarkers: function (html) {
					if (!markers.length) return { html: html, after: null };
					const extracted = extractPluginMarkers(html, markers.map(function (marker) { return marker.pattern; }));
					if (!extracted.markers.length) return { html: html, after: null };
					return { html: extracted.html, after: extracted.markers.map(function (segment, index) {
						return React.createElement(TavernPluginMarker, { key: "marker:" + index, marker: markers[segment.marker], match: segment.match, sessionId: input.sessionId, turn: input.turn, streaming: input.streaming });
					}) };
				}
			};
		}

		function TavernPluginActionButtons(props) {
			useTavernUiExtensions();
			const [busy, setBusy] = React.useState("");
			const context = props.context;
			const visible = props.actions.filter(function (entry) {
				if (!entry.when) return true;
				try { return Boolean(entry.when(Object.assign({}, context))); }
				catch (error) { try { tavernErrorHub.report("插件 " + entry.owner, error); } catch (_) {} return false; }
			});
			if (!visible.length) return null;
			return React.createElement("div", { className: props.className },
				visible.map(function (entry) {
					const key = entry.owner + ":" + entry.id;
					return React.createElement("button", { key: key, type: "button", className: props.buttonClassName, title: entry.owner, disabled: Boolean(busy) || props.disabled, onClick: async function () {
						setBusy(key);
						try { await entry.run(Object.assign({}, context)); }
						catch (error) { tavernErrorHub.report("插件 " + entry.owner, error); }
						finally { setBusy(""); }
					} }, busy === key ? entry.label + "…" : entry.label);
				}));
		}

		function TavernPluginMessageActions(props) {
			useTavernUiExtensions();
			const actions = tavernUiExtensions.messageActions();
			if (!actions.length) return null;
			return React.createElement(TavernPluginActionButtons, { actions: actions, className: "dsh-tavern-plugin-message-actions", buttonClassName: "dsh-tavern-btn",
				context: { gameId: props.sessionId, turn: props.turn, settled: props.settled } });
		}

		function TavernPluginComposerActions(props) {
			useTavernUiExtensions();
			const actions = tavernUiExtensions.composerActions();
			if (!actions.length) return null;
			return React.createElement(TavernPluginActionButtons, { actions: actions, className: "dsh-tavern-plugin-composer-actions", buttonClassName: "dsh-tavern-choice-trigger",
				disabled: props.running, context: { gameId: props.sessionId, turn: props.turn, busy: Boolean(props.running) } });
		}
