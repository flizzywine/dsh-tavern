// DSH 0.1.5 session projections use findLast; Android WebView 95 lacks it.
(function () {
  for (const name of ['findLast', 'findLastIndex']) {
    if (typeof Array.prototype[name] === 'function') continue
    Object.defineProperty(Array.prototype, name, {
      configurable: true, writable: true,
      value: function (predicate, thisArg) {
        'use strict'
        if (this == null) throw new TypeError('Array receiver is null or undefined')
        const object = Object(this)
        const length = Math.min(Math.max(Math.trunc(Number(object.length)) || 0, 0), Number.MAX_SAFE_INTEGER)
        if (typeof predicate !== 'function') throw new TypeError('predicate must be a function')
        for (let index = length - 1; index >= 0; index--) {
          const value = object[index]
          if (predicate.call(thisArg, value, index, object)) return name === 'findLast' ? value : index
        }
        return name === 'findLast' ? undefined : -1
      }
    })
  }
})();

// MuMu / older Android WebView lack AbortSignal.throwIfAborted / any used by DSH history load.
// A bad AbortSignal.any polyfill aborts follow immediately → empty transcript, no error toast.
(function (global) {
	if (!global || !global.AbortSignal) return;
	var AbortSignal = global.AbortSignal;
	var AbortController = global.AbortController;
	if (typeof AbortSignal.prototype.throwIfAborted !== "function") {
		AbortSignal.prototype.throwIfAborted = function throwIfAborted() {
			if (!this.aborted) return;
			if (this.reason !== undefined) throw this.reason;
			var error = new Error("This operation was aborted");
			error.name = "AbortError";
			throw error;
		};
	}
	if (typeof AbortSignal.any !== "function" && AbortController) {
		AbortSignal.any = function any(signals) {
			var list = Array.prototype.slice.call(signals || []);
			var controller = new AbortController();
			function onAbort() {
				if (controller.signal.aborted) return;
				var reason;
				for (var i = 0; i < list.length; i++) {
					if (list[i] && list[i].aborted) { reason = list[i].reason; break; }
				}
				if (reason === undefined) {
					reason = new Error("This operation was aborted");
					reason.name = "AbortError";
				}
				try { controller.abort(reason); } catch (_) { controller.abort(); }
			}
			for (var i = 0; i < list.length; i++) {
				var signal = list[i];
				if (!signal || typeof signal.addEventListener !== "function") continue;
				if (signal.aborted) { onAbort(); break; }
				(function (target) {
					function onAbortOnce() {
						if (typeof target.removeEventListener === "function") target.removeEventListener("abort", onAbortOnce);
						onAbort();
					}
					target.addEventListener("abort", onAbortOnce);
				})(signal);
			}
			return controller.signal;
		};
	}
	if (global.Promise && typeof global.Promise.withResolvers !== "function") {
		global.Promise.withResolvers = function withResolvers() {
			var resolve, reject;
			var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
			return { promise: promise, resolve: resolve, reject: reject };
		};
	}
})(typeof globalThis !== "undefined" ? globalThis : window);

window.__ModuleLoader__.load({
	id: "dsh-tavern-entry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const CSS = `
.dsh-tavern-embed { position:fixed; inset:0; z-index:2147483000; background:#14110d; display:flex; flex-direction:column; box-sizing:border-box; padding-top:env(safe-area-inset-top,0px); }
.dsh-tavern-embed iframe { flex:1; min-height:0; width:100%; border:0; background:white; }
.dsh-tavern-entry-btn {
  display: flex; align-items: center; gap: 7px; width: 100%;
  box-sizing: border-box; margin: 4px 0;
  padding: 7px 10px;
  border: 1px solid rgba(154,98,47,.45); border-radius: 9px;
  background: rgba(154,98,47,.10);
  color: #a66b35; cursor: pointer; font-size: 12.5px; font-weight: 650;
  text-align: left;
}
.dsh-tavern-entry-btn:hover { background: rgba(154,98,47,.20); color: #8e5728; }
.dsh-tavern-entry-btn:disabled { opacity: .45; cursor: default; }
.dsh-tavern-entry-actions { display: flex; gap: 5px; width: 100%; }
.dsh-tavern-entry-actions .dsh-tavern-entry-btn:first-child { flex: 1; }
.dsh-tavern-entry-manage { flex: none; width: auto; white-space: nowrap; }
.dsh-tavern-entry-state { margin-left: auto; font-size: 10.5px; font-weight: 400; opacity: .8; }
.dsh-tavern-entry-message { padding: 0 4px 4px; font-size: 10px; line-height: 1.35; opacity: .75; }
.dsh-tavern-entry-message.error { color: #c45f5f; opacity: 1; }
`;

		const tagId = "dsh-tavern-entry/tavern-entry.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-tavern-entry";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		// 布局视口与可视区差这么多才算键盘把页面顶上去；更小的差值只是取整或浏览器界面高度。
		const EMBED_KEYBOARD_INSET_MIN = 8;
		// 输入法动画约 250ms；焦点进出后自己刷几帧，事件只给首尾两次时页面也不会慢半拍。
		const EMBED_SETTLE_MS = 450;

		function installEmbeddedViewport(root) {
			if (!root) return function () {};
			const view = root.ownerDocument.defaultView;
			const viewport = view.visualViewport;
			let chasing = 0, until = 0;
			// 内嵌 iframe 看不到顶层软键盘的遮挡，必须由外壳决定 iframe 有多高。
			// 顶层布局视口已经被键盘顶短（DSHA 原生按 ime insets 缩窗口）时，外壳铺满就是同帧
			// 跟随，内部酒馆按 100% 重排也不会慢；只有键盘浮在页面上（Chrome 的 resizes-visual）
			// 才按 visualViewport 缩像素，否则 iframe 里的输入条会被键盘盖住。
			function sync() {
				if (viewport && Math.abs(viewport.scale - 1) > 0.02) return;
				const layout = view.innerHeight;
				const visual = viewport && viewport.height > 0 ? viewport.height : layout;
				if (Math.round(layout - visual) < EMBED_KEYBOARD_INSET_MIN) {
					root.style.top = "0px";
					root.style.height = "100%";
				} else {
					root.style.top = (viewport ? viewport.offsetTop : 0) + "px";
					root.style.height = Math.round(visual) + "px";
				}
				root.style.bottom = "auto";
			}
			function chase() {
				chasing = 0;
				sync();
				if (Date.now() < until) chasing = view.requestAnimationFrame(chase);
			}
			// 当场改样式，别再等一帧：等一帧就是键盘先到位、页面后到位的那段错位。
			function apply() {
				sync();
				until = Math.max(until, Date.now() + EMBED_SETTLE_MS);
				if (!chasing) chasing = view.requestAnimationFrame(chase);
			}
			viewport?.addEventListener("resize", apply);
			viewport?.addEventListener("scroll", apply);
			view.addEventListener("resize", apply);
			sync();
			return function () {
				if (chasing) view.cancelAnimationFrame(chasing);
				viewport?.removeEventListener("resize", apply);
				viewport?.removeEventListener("scroll", apply);
				view.removeEventListener("resize", apply);
				root.style.removeProperty("top"); root.style.removeProperty("height"); root.style.removeProperty("bottom");
			};
		}

		function checkTavern() {
			return new Promise(function (resolve) {
				const img = new Image();
				img.onload = function () { resolve(true); };
				img.onerror = function () { resolve(false); };
				img.src = "http://127.0.0.1:3088/favicon.ico?probe=" + Date.now();
				setTimeout(function () { resolve(false); }, 2500);
			});
		}

		async function request(path, method) {
			const response = await fetch(path, { method: method || "GET", headers: { "Accept": "application/json" } });
			let payload = null;
			try { payload = await response.json(); } catch (_error) {}
			if (!response.ok) throw new Error(payload && payload.error || ("请求失败：" + response.status));
			return payload;
		}

		const inject = ["slots"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;

			ctx.effect(() => slots.inject("sidebar.footer.action", () => slots.register(
				{ name: "sidebar.footer.action", id: "dsh-tavern-entry", priority: 999 },
				function (props) {
					const [state, setState] = react.useState({ online: null, update: { phase: "idle", host: "android" } });
					const [error, setError] = react.useState("");
					const [frame, setFrame] = react.useState("");
					const frameRoot = react.useRef(null);
					react.useEffect(function () { return installEmbeddedViewport(frameRoot.current); }, [frame]);
					// 窗口内零控件，返回键就是关闭：DSHA 的返回键会先问页面（注入脚本找可见的
					// dialog 并派发 Escape，处理了就不再回退）；没走这条路时，原生 goBack 会弹掉
					// 打开时压入的哨兵历史条目。两条路都只关窗口、回到 DSHA，不会退出应用。
					// 窗口卡住或白屏时，返回再点一次「酒馆工作台」就是重新加载。
					react.useEffect(function () {
						if (!frame) return undefined;
						const marker = "dsh-tavern-embed-" + Date.now();
						window.history.pushState({ dshTavernEmbed: marker }, "");
						function close() { setFrame(""); }
						function onKeyDown(event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }
						window.addEventListener("popstate", close);
						window.addEventListener("keydown", onKeyDown, true);
						return function () {
							window.removeEventListener("popstate", close);
							window.removeEventListener("keydown", onKeyDown, true);
							if (window.history.state && window.history.state.dshTavernEmbed === marker) window.history.back();
						};
					}, [frame]);
					async function openEmbedded() {
					  try { const result = await request("/api/dsh-tavern-android/embed", "POST"); setFrame(result.url); setError(""); }
					  catch (err) { setError(String(err.message || err)); }
					}
					react.useEffect(function () {
						let stopped = false;
						async function refresh() {
							try {
								const next = await request("/api/dsh-tavern-android/status");
								if (!stopped) { setState(next); setError(""); }
							} catch (err) {
								const online = await checkTavern();
								if (!stopped) { setState(function (current) { return Object.assign({}, current, { online: online }); }); setError(String(err && err.message || err)); }
							}
						}
						refresh();
						const timer = setInterval(refresh, 3000);
						return function () { stopped = true; clearInterval(timer); };
					}, []);
					const updating = state.update && state.update.phase === "running";
					async function startUpdate() {
						setError("");
						setState(function (current) { return Object.assign({}, current, { update: { phase: "running", host: "android" } }); });
						try { setState(await request("/api/dsh-tavern-android/update", "POST")); }
						catch (err) { setError(String(err && err.message || err)); setState(function (current) { return Object.assign({}, current, { update: { phase: "failed", host: "android" } }); }); }
					}
					const updateFailed = state.update && state.update.phase === "failed";
					const message = updating
						? "正在下载、安装并重启酒馆…"
						: state.update && state.update.phase === "completed"
							? "更新完成；界面未变化时请重启 DSHA。"
							: updateFailed
								? (state.update.error || "更新失败，请重试。")
								: state.online === false ? "酒馆未启动，可点击更新/修复。" : "";
					return react.createElement("div", null,
						frame ? react.createElement("div", {
						  className: "dsh-tavern-embed", ref: frameRoot,
						  // 不要声明 aria-modal：dsh-web-mobile 在
						  // `@media (max-width:1023px) and (pointer:coarse)` 里给
						  // `[aria-modal="true"]:not(:has(> :first-child > :last-child > button))`
						  // 加了 `max-width: calc(100vw - 32px)`，那是给宿主内容弹窗留左右
						  // 边距的；这一层是全屏外壳，带上该属性就被截成 100vw-32px，右侧
						  // 恒定露出 32px 遮罩缺口。DSHA 的返回键按 `[role="dialog"]` 判定。
						  role: "dialog", "aria-label": "酒馆工作台"
						},
						  react.createElement("iframe", { title: "酒馆工作台", src: frame, referrerPolicy: "no-referrer", allow: "clipboard-read; clipboard-write; fullscreen", allowFullScreen: true })
						) : null,
						react.createElement("div", { className: "dsh-tavern-entry-actions" },
							react.createElement("button", {
								type: "button", className: "dsh-tavern-entry-btn",
								title: "打开酒馆工作台（3088）",
								onClick: openEmbedded
							}, react.createElement("span", null, "🍺"), react.createElement("span", null, "酒馆工作台"),
								react.createElement("span", { className: "dsh-tavern-entry-state" }, state.online === true ? "在线" : (state.online === false ? "未启动" : "检测中…"))),
							react.createElement("button", { type: "button", className: "dsh-tavern-entry-btn dsh-tavern-entry-manage", disabled: updating, onClick: startUpdate }, updating ? "更新中…" : "更新/修复")
						),
						react.createElement("div", { className: "dsh-tavern-entry-message" }, "酒馆在应用内全屏打开；按返回键回到这里，再点一次即可重新加载。保持 DSHA 运行。"),
						message || error ? react.createElement("div", { className: "dsh-tavern-entry-message" + (error || updateFailed ? " error" : "") }, error || message) : null
					);
				}
			)), "dsh-tavern-entry: sidebar footer button");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
