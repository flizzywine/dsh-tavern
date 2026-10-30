		function isIgnoredTavernError(value) {
			return /failed to fetch/i.test(String(value && value.message || value || "").trim());
		}

		function sanitizeTavernModuleFailure(value) {
			if (!value || value.phase !== "module-load") return null;
			function url(raw) { try { const parsed = new URL(String(raw)); return /^https?:$/.test(parsed.protocol) ? (parsed.origin + parsed.pathname).slice(0, 500) : ""; } catch (_) { return ""; } }
			return { phase: "module-load", reason: ["offline", "http", "unknown"].includes(value.reason) ? value.reason : "unknown",
				message: String(value.message || "").replace(/https?:\/\/[^\s"'<>]+/gi, url).replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, "[REDACTED]").slice(0, 1000),
				references: (Array.isArray(value.references) ? value.references : []).slice(0, 8).map(url).filter(Boolean),
				resources: (Array.isArray(value.resources) ? value.resources : []).slice(0, 8).filter(function (entry) { return entry && Number.isInteger(entry.status) && entry.status >= 400 && entry.status <= 599; }).map(function (entry) { return { url: url(entry.url), status: entry.status }; }).filter(function (entry) { return entry.url; }) };
		}

		const tavernErrorHub = (function () {
			const storageKey = "dsh-tavern:error-history:v1";
			function loadItems() {
				try {
					const value = JSON.parse(window.sessionStorage.getItem(storageKey) || "[]");
					return Array.isArray(value) ? value.filter(function (item) {
						return item && typeof item.id === "string" && typeof item.source === "string" && typeof item.message === "string" && (item.code === undefined || typeof item.code === "string");
					}).slice(0, 1).map(function (item) { return Object.assign({}, item, { moduleFailure: sanitizeTavernModuleFailure(item.moduleFailure) }); }) : [];
				} catch (_) { return []; }
			}
			let items = loadItems();
			let sequence = Date.now();
			const listeners = new Set();
			function emit() {
				try { window.sessionStorage.setItem(storageKey, JSON.stringify(items)); } catch (_) {}
				listeners.forEach(function (listener) { listener(items.slice()); });
			}
			return {
				getSnapshot: function () { return items.slice(); },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				report: function (source, error) {
					if (isIgnoredTavernError(error) && !error?.dshTavernModuleFailure) return;
					const message = String(error && error.message || error || "").trim();
					if (!message) return;
					const code = error && typeof error === "object" && error.code ? String(error.code) : "";
					const scope = String(source || "DSH Tavern");
					const now = Date.now();
					const existing = items[0] && items[0].source === scope && items[0].message === message ? items[0] : null;
					if (existing) {
						items = [{ id: existing.id, source: scope, message: message, code: code, firstAt: existing.firstAt, lastAt: now, count: existing.count + 1, moduleFailure: sanitizeTavernModuleFailure(error && error.dshTavernModuleFailure) || existing.moduleFailure }];
					} else {
						items = [{ id: "tavern-error-" + (++sequence), source: scope, message: message, code: code, firstAt: now, lastAt: now, count: 1, moduleFailure: sanitizeTavernModuleFailure(error && error.dshTavernModuleFailure) }];
					}
					emit();
				},
				dismiss: function (id) { items = items.filter(function (item) { return item.id !== id; }); emit(); },
				resolve: function (source, beforeAt) {
					if (!items[0] || items[0].source !== String(source || "")) return;
					const cutoff = Number(beforeAt);
					if (Number.isFinite(cutoff) && Number(items[0].lastAt) >= cutoff) return;
					items = [];
					emit();
				},
				clear: function () { items = []; emit(); }
			};
		})();

		// Stage, galgame and mod views sit inside core surfaces (the input dock, every reply). A render
		// failure there is reported and the view disappears; the chat, input and story keep working.
		let tavernStageBoundaryClass = null;
		// fallback: what stands in for the view after a failure (default: nothing).
		function tavernStageBoundary(label, element, fallback = null) {
			if (!tavernStageBoundaryClass) tavernStageBoundaryClass = class TavernStageBoundary extends React.Component {
				constructor(props) { super(props); this.state = { failed: false }; }
				static getDerivedStateFromError() { return { failed: true }; }
				componentDidCatch(error) { try { tavernErrorHub.report(this.props.label, error); } catch (_) { console.error(error); } }
				render() { return this.state.failed ? this.props.fallback : this.props.children; }
			};
			// Same key as the view: switching games remounts the boundary, so one game's failure stays there.
			return React.createElement(tavernStageBoundaryClass, { key: element && element.key, label: label, fallback: fallback }, element);
		}

		function usePersistentError(source) {
			const [error, setLocalError] = React.useState("");
			const lastReported = React.useRef("");
			const setError = React.useCallback(function (value) {
				const message = String(value && value.message || value || "");
				const visible = isIgnoredTavernError(message) ? "" : message;
				// the panel says it in plain Chinese; the raw text goes to the hub (调试视图 / 复制).
				setLocalError(visible ? playerErrorText(value) : "");
				if (!visible) tavernErrorHub.resolve(source);
				else if (visible !== lastReported.current) tavernErrorHub.report(source, value);
				lastReported.current = visible;
			}, [source]);
			return [error, setError];
		}

		function formatErrorTime(ts) {
			const date = new Date(ts);
			return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0");
		}

		function copyErrorText(text) {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				navigator.clipboard.writeText(text).catch(function () { console.warn("dsh-tavern: 复制失败，请手动选择文本。\n" + text); });
			} else console.warn("dsh-tavern: 当前环境不支持剪贴板，请手动选择文本。\n" + text);
		}

		// @include modules/confirm-dialog.js

		/**
		 * In-app replacement for window.prompt.
		 *
		 * Electron never implements window.prompt, so every previous caller failed
		 * silently on desktop: it returns undefined (or throws), so guards written as
		 * `value === null` fell through and the async caller swallowed the result.
		 * This uses a modal <dialog> instead, so it behaves identically on every client.
		 *
		 * Resolves with the trimmed value, or null when cancelled.
		 * options: { title, description, initialValue, placeholder, maxLength, confirmLabel, onSubmit }
		 * When onSubmit is supplied the dialog stays open showing busy/error state until
		 * it settles, which preserves the previous "save, then close" semantics.
		 */
		function askTavernText(options) {
			const opts = options && typeof options === "object" ? options : {};
			if (typeof document === "undefined") return Promise.resolve(null);
			return new Promise(function (resolve) {
				const dialog = document.createElement("dialog");
				dialog.className = "dsh-tavern-prompt";
				dialog.setAttribute("aria-label", String(opts.title || "输入"));

				const panel = document.createElement("div");
				panel.className = "dsh-tavern-prompt-panel";

				const title = document.createElement("div");
				title.className = "dsh-tavern-prompt-title";
				title.textContent = String(opts.title || "输入");
				panel.append(title);

				if (opts.description) {
					const description = document.createElement("div");
					description.className = "dsh-tavern-question-sub";
					description.textContent = String(opts.description);
					panel.append(description);
				}

				const input = document.createElement("input");
				input.type = "text";
				input.className = "dsh-tavern-prompt-input";
				input.autocomplete = "off";
				input.spellcheck = false;
				input.value = opts.initialValue === undefined || opts.initialValue === null ? "" : String(opts.initialValue);
				if (opts.placeholder) input.placeholder = String(opts.placeholder);
				const maxLength = Number(opts.maxLength);
				input.maxLength = Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 200;
				panel.append(input);

				const errorLine = document.createElement("div");
				errorLine.className = "dsh-tavern-prompt-error";
				errorLine.setAttribute("role", "alert");
				errorLine.hidden = true;
				panel.append(errorLine);

				const actions = document.createElement("div");
				actions.className = "dsh-tavern-prompt-actions";
				const cancelButton = document.createElement("button");
				cancelButton.type = "button";
				cancelButton.className = "dsh-tavern-btn";
				cancelButton.textContent = "取消";
				const confirmButton = document.createElement("button");
				confirmButton.type = "button";
				confirmButton.className = "dsh-tavern-btn";
				const confirmLabel = String(opts.confirmLabel || "确认");
				confirmButton.textContent = confirmLabel;
				actions.append(cancelButton, confirmButton);
				panel.append(actions);

				dialog.append(panel);

				let settled = false;
				let busy = false;
				function finish(value) {
					if (settled) return;
					settled = true;
					dialog.close();
					resolve(value);
				}
				function cancel() { if (!busy) finish(null); }
				function setBusy(next) {
					busy = next;
					input.disabled = next;
					cancelButton.disabled = next;
					confirmButton.disabled = next || (!opts.allowEmpty && input.value.trim() === "");
					confirmButton.textContent = next ? "保存中…" : confirmLabel;
				}
				async function submit() {
					if (busy) return;
					const value = input.value.trim();
					if (value === "" && !opts.allowEmpty) return;
					if (typeof opts.onSubmit !== "function") { finish(value); return; }
					errorLine.hidden = true;
					setBusy(true);
					try { await opts.onSubmit(value); finish(value); }
					catch (error) {
						setBusy(false);
						errorLine.textContent = playerErrorText(error);
						errorLine.hidden = false;
						input.focus();
					}
				}

				input.addEventListener("input", function () { if (!busy) confirmButton.disabled = !opts.allowEmpty && input.value.trim() === ""; });
				input.addEventListener("keydown", function (event) {
					// 部分 WebKit 在确认选字时先结束 composition；229 仍表示本次按键属于输入法。
					if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
					event.preventDefault();
					void submit();
				});
				cancelButton.addEventListener("click", cancel);
				confirmButton.addEventListener("click", function () { void submit(); });
				// <dialog> covers the viewport, so backdrop clicks target the element itself.
				dialog.addEventListener("click", function (event) { if (event.target === dialog) cancel(); });
				dialog.addEventListener("cancel", function (event) { event.preventDefault(); cancel(); });
				dialog.addEventListener("close", function () {
					dialog.remove();
					if (!settled) { settled = true; resolve(null); }
				}, { once: true });

				document.body.append(dialog);
				setBusy(false);
				dialog.showModal();
				input.focus();
				if (typeof input.select === "function") input.select();
			});
		}

		function TavernErrorCenter() {
			const [items, setItems] = React.useState(tavernErrorHub.getSnapshot());
			React.useEffect(function () { return tavernErrorHub.subscribe(setItems); }, []);
			if (!items.length) return null;
			const h = React.createElement;
			const item = items[0];
			const text = "[" + formatErrorTime(item.lastAt) + "] " + item.source + (item.count > 1 ? "（重复 " + item.count + " 次）" : "") + "\n" + (item.code ? item.code + ": " : "") + item.message + (item.moduleFailure ? "\n" + JSON.stringify(item.moduleFailure, null, 2) : "");
			// the player reads the shared Chinese sentence; the raw
			// message (provider English, codes, ids) and the module-load details show only in the 调试视图 (body.dsh-fork-debug), and 复制 copies them.
			const debugView = typeof document !== "undefined" && !!document.body && document.body.classList.contains("dsh-fork-debug");
			const said = playerErrorText(item);
			return h("section", { className: "dsh-tavern-error-center", role: "region", "aria-label": "DSH Tavern 错误记录" },
				h("div", { className: "dsh-tavern-error-center-head" }, h("span", null, "最新错误"), h("button", { className: "dsh-tavern-btn", onClick: function () { copyErrorText(text); } }, "复制"), h("button", { className: "dsh-tavern-btn", onClick: tavernErrorHub.clear }, "清除")),
				h("div", { className: "dsh-tavern-error-list" }, h("article", { className: "dsh-tavern-error-item", key: item.id },
					h("div", { className: "dsh-tavern-error-meta" }, h("span", null, item.source), item.count > 1 ? h("span", null, "重复 " + item.count + " 次") : null, h("time", { dateTime: new Date(item.lastAt).toISOString() }, formatErrorTime(item.lastAt))),
					h("div", { className: "dsh-tavern-error-message" }, said),
					debugView && said !== item.message ? h("pre", { className: "dsh-tavern-error-raw" }, text) : null,
					item.moduleFailure && !debugView ? h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { window.location.reload(); } }, "刷新页面重试") : null,
					debugView && item.moduleFailure ? h("details", { className: "dsh-tavern-module-error-details" }, h("summary", null, "查看详情"),
						h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, "阶段：模块加载\n原因：" + ({ offline: "浏览器离线", http: "依赖请求返回 HTTP 错误", unknown: "浏览器未提供确切原因" }[item.moduleFailure.reason] || "未知") + "\n浏览器信息：" + (item.moduleFailure.message || "未提供") + "\n脚本引用（不代表已确认失败）：\n" + (item.moduleFailure.references || []).join("\n") + "\n同期失败资源（浏览器可见范围）：\n" + (item.moduleFailure.resources || []).map(function (entry) { return entry.url + " — HTTP " + entry.status; }).join("\n")),
						h("p", null, "刷新将重新初始化页面脚本，请先保存未提交的输入。"),
						h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () { window.location.reload(); } }, "刷新页面重试")) : null
				))
			);
		}
