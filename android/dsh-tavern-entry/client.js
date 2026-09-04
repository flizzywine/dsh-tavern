window.__ModuleLoader__.load({
	id: "dsh-tavern-entry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const CSS = `
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
						react.createElement("div", { className: "dsh-tavern-entry-actions" },
							react.createElement("button", {
								type: "button", className: "dsh-tavern-entry-btn",
								title: "打开酒馆工作台（3088）",
								onClick: function () { window.location.assign("/api/dsh-tavern-android/open"); }
							}, react.createElement("span", null, "🍺"), react.createElement("span", null, "酒馆工作台"),
								react.createElement("span", { className: "dsh-tavern-entry-state" }, state.online === true ? "在线" : (state.online === false ? "未启动" : "检测中…"))),
							react.createElement("button", { type: "button", className: "dsh-tavern-entry-btn dsh-tavern-entry-manage", disabled: updating, onClick: startUpdate }, updating ? "更新中…" : "更新/修复")
						),
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
