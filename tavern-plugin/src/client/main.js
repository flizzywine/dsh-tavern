// @include android-web-polyfills.js
window.__ModuleLoader__.load({
	id: "dsh-tavern-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			let React = require("react");
			let DshUi = require("@deepseek-ai/dsh-client-ui-primitives");

		// @include crypto-digest.js
		// @include stylesheet.js
		if (typeof document !== "undefined") installTavernStylesheet(document, __TAVERN_BUNDLED_CSS__);


		function isPlayMode(mode) {
			return mode === "story" || mode === "script";
		}
		function groupOfMode(mode) {
			return isPlayMode(mode || "story") ? "play" : "card";
		}
		function playModeOfCard(card) {
			return card && card.script ? "script" : "story";
		}
		function modeLabel(mode) {
			return mode === "script" ? "剧本" : mode === "card" ? "卡片" : "故事";
		}

		function ascii(bytes, off, len) {
			let s = "";
			for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[off + i]);
			return s;
		}

		function bytesToBase64(bytes) {
			let binary = "";
			for (let offset = 0; offset < bytes.length; offset += 32768) {
				binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(bytes.length, offset + 32768)));
			}
			return btoa(binary);
		}

		// @include interaction-diagnostics.js
		const tavernInteractionDiagnostics = createInteractionDiagnostics(window);

		// @include text-resource-file.js

		function parseCardFile(file) {
			const name = String(file.name || "");
			if (name.toLowerCase().endsWith(".json")) {
				return file.text().then(function (text) { return { kind: "text", name: name, text: text }; });
			}
			return file.arrayBuffer().then(function (buf) {
				const bytes = new Uint8Array(buf);
				if (bytes.length <= 8 || ascii(bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") {
					throw new Error("无法识别的角色卡文件（需要 PNG 或 JSON）");
				}
				let off = 8;
				while (off + 8 <= bytes.length) {
					const len = (((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3])) >>> 0;
					const type = ascii(bytes, off + 4, 4);
					if (type === "tEXt" && off + 8 + len <= bytes.length) {
						const dataOff = off + 8;
						let nul = -1;
						for (let i = 0; i < len; i++) {
							if (bytes[dataOff + i] === 0) { nul = i; break; }
						}
						if (nul >= 0) {
							const keyword = ascii(bytes, dataOff, nul);
							const value = ascii(bytes, dataOff + nul + 1, len - nul - 1);
							if (keyword === "chara" || keyword === "ccv3") return { kind: "png", name: name, b64: value, fileB64: bytesToBase64(bytes) };
						}
					}
					if (type === "IEND") break;
					off += 12 + len;
				}
				throw new Error("PNG 中未找到角色卡数据（chara/ccv3 文本块）");
			});
		}

		const MOBILE_IMPORT_SORTS = Object.freeze([
			{ id: "modified-desc", label: "修改时间 新→旧" },
			{ id: "modified-asc", label: "修改时间 旧→新" },
			{ id: "name-asc", label: "文件名 A→Z" },
			{ id: "name-desc", label: "文件名 Z→A" },
			{ id: "size-desc", label: "大小 大→小" },
			{ id: "size-asc", label: "大小 小→大" },
			{ id: "png-first", label: "PNG 优先" },
			{ id: "json-first", label: "JSON 优先" }
		]);
		const MOBILE_IMPORT_SORT_STORAGE = "dsh-tavern-mobile-import-sort";
		const MOBILE_IMPORT_SORT_DEFAULT = "modified-desc";

		function mobileImportNameOf(file) {
			return String(file && file.name || "");
		}

		function isMobileImportImage(name) {
			return /\.png$/i.test(String(name || ""));
		}

		function readMobileImportSort() {
			try {
				const stored = window.localStorage.getItem(MOBILE_IMPORT_SORT_STORAGE);
				if (MOBILE_IMPORT_SORTS.some(function (option) { return option.id === stored; })) return stored;
			} catch (_error) {}
			return MOBILE_IMPORT_SORT_DEFAULT;
		}

		function saveMobileImportSort(value) {
			try { window.localStorage.setItem(MOBILE_IMPORT_SORT_STORAGE, value); } catch (_error) {}
		}

		let mobileImportCollator = null;
		function mobileImportNameCompare(left, right) {
			const leftName = mobileImportNameOf(left);
			const rightName = mobileImportNameOf(right);
			if (mobileImportCollator === null) {
				try { mobileImportCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" }); }
				catch (_error) { mobileImportCollator = false; }
			}
			return mobileImportCollator ? mobileImportCollator.compare(leftName, rightName) : (leftName < rightName ? -1 : (leftName > rightName ? 1 : 0));
		}

		function sortMobileImportFiles(files, sort) {
			const items = files.slice();
			const byName = mobileImportNameCompare;
			const byExtension = function (jsonFirst) {
				return function (left, right) {
					const leftRank = isMobileImportImage(left.name) === jsonFirst ? 1 : 0;
					const rightRank = isMobileImportImage(right.name) === jsonFirst ? 1 : 0;
					return leftRank - rightRank || byName(left, right);
				};
			};
			if (sort === "modified-asc") items.sort(function (left, right) { return Number(left.modifiedAt) - Number(right.modifiedAt) || byName(left, right); });
			else if (sort === "name-asc") items.sort(byName);
			else if (sort === "name-desc") items.sort(function (left, right) { return byName(right, left); });
			else if (sort === "size-desc") items.sort(function (left, right) { return Number(right.size) - Number(left.size) || byName(left, right); });
			else if (sort === "size-asc") items.sort(function (left, right) { return Number(left.size) - Number(right.size) || byName(left, right); });
			else if (sort === "png-first") items.sort(byExtension(false));
			else if (sort === "json-first") items.sort(byExtension(true));
			else items.sort(function (left, right) { return Number(right.modifiedAt) - Number(left.modifiedAt) || byName(left, right); });
			return items;
		}

		function MobileCardImportButton(props) {
			const [catalog, setCatalog] = React.useState(null);
			const [open, setOpen] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [filter, setFilter] = React.useState("");
			const [sort, setSort] = React.useState(readMobileImportSort);
			const [selecting, setSelecting] = React.useState(false);
			const [selected, setSelected] = React.useState(function () { return new Set(); });
			const [progress, setProgress] = React.useState(null);
			function load() {
				return rpcWithTimeout("listMobileCardImports", {}).then(function (result) { setCatalog(result); return result; }, function () { setCatalog({ available: false, files: [] }); return { available: false, files: [] }; });
			}
			React.useEffect(function () { load(); }, []);
			async function activate() {
				const current = catalog || await load();
				if (current.available) { setOpen(true); load(); }
				else if (props.inputRef.current) props.inputRef.current.click();
			}
			function close() {
				setOpen(false); setSelecting(false); setSelected(new Set()); setProgress(null); setError("");
			}
			function toggle(file) {
				setSelected(function (previous) {
					const next = new Set(previous);
					if (next.has(file.id)) next.delete(file.id); else next.add(file.id);
					return next;
				});
			}
			async function importQueue(queue) {
				if (!queue.length) return;
				setBusy(true); setError("");
				const failures = [];
				let last = null;
				for (let index = 0; index < queue.length; index += 1) {
					setProgress({ done: index + 1, total: queue.length });
					try { const result = await rpc("importMobileCard", { id: queue[index].id }); last = result.card; }
					catch (err) { failures.push(mobileImportNameOf(queue[index]) + "：" + String(err && err.message || err)); }
				}
				setBusy(false); setProgress(null);
				if (last) { if (!failures.length) close(); await props.onImported(last); }
				if (failures.length) {
					setError(failures.length + " 个文件导入失败：\n" + failures.slice(0, 4).join("\n") + (failures.length > 4 ? "\n…" : ""));
					await load();
				}
			}
			async function importFile(file) { await importQueue([file]); }
			const h = React.createElement;
			const allFiles = catalog && Array.isArray(catalog.files) ? catalog.files : [];
			const needle = filter.trim().toLowerCase();
			const matched = needle ? allFiles.filter(function (file) { return mobileImportNameOf(file).toLowerCase().indexOf(needle) >= 0; }) : allFiles;
			const files = sortMobileImportFiles(matched, sort);
			const selectedFiles = sortMobileImportFiles(allFiles.filter(function (file) { return selected.has(file.id); }), sort);
			const everyVisibleSelected = files.length > 0 && files.every(function (file) { return selected.has(file.id); });
			function selectAllVisible() {
				const ids = files.map(function (file) { return file.id; });
				const every = everyVisibleSelected;
				setSelected(function (previous) {
					const next = new Set(previous);
					for (const id of ids) { if (every) next.delete(id); else next.add(id); }
					return next;
				});
			}
			function thumbnailOf(file) {
				return h("span", { className: "dsh-tavern-mobile-import-thumb" + (isMobileImportImage(file.name) ? "" : " placeholder"), "aria-hidden": "true" },
					h("span", { className: "dsh-tavern-mobile-import-thumb-fallback" }, mobileImportNameOf(file).replace(/^.*\./, "").toUpperCase()),
					isMobileImportImage(file.name) ? h("img", { src: "/api/dsh-tavern/mobile-card-thumbnail?id=" + encodeURIComponent(file.id), alt: "", loading: "lazy", decoding: "async", onError: function (event) { event.currentTarget.hidden = true; } }) : null);
			}
			function rowOf(file) {
				const picked = selected.has(file.id);
				return h("button", {
					key: file.id,
					className: "dsh-tavern-mobile-import-file" + (picked ? " selected" : ""),
					disabled: busy,
					"aria-pressed": selecting ? picked : undefined,
					onClick: function () { if (selecting) toggle(file); else importFile(file); }
				},
					selecting ? h("span", { className: "dsh-tavern-mobile-import-mark", "aria-hidden": "true" }, "✓") : null,
					thumbnailOf(file),
					h("span", { className: "dsh-tavern-mobile-import-meta" },
						h("b", { title: mobileImportNameOf(file) }, mobileImportNameOf(file)),
						h("span", null, file.directory + " · " + Math.ceil(file.size / 1024) + " KB")));
			}
			function emptyState() {
				if (needle) return h("div", { className: "dsh-tavern-empty" }, "没有匹配“" + filter.trim() + "”的文件");
				return h("div", { className: "dsh-tavern-empty" }, catalog && catalog.storageAccessible === false ? "DSHA 无法读取下载目录。请在系统设置中允许 DSHA ‘访问所有文件’，然后点刷新；也可尝试系统文件选择器。" : "下载目录里还没有 PNG/JSON 人物卡。");
			}
			const countText = "共 " + allFiles.length + " 个文件"
				+ (needle ? "，匹配 " + files.length + " 个" : "")
				+ (selected.size ? "，已选 " + selected.size + " 个" : "")
				+ (progress ? "，正在导入 " + progress.done + "/" + progress.total : "");
			return h(React.Fragment, null,
				h("button", { className: "dsh-tavern-btn primary", disabled: props.disabled || busy, onClick: activate }, "导入人物卡"),
				open ? h("div", { className: "dsh-tavern-mobile-import", role: "dialog", "aria-modal": "true", "aria-label": "从手机下载目录导入人物卡" }, h("div", { className: "dsh-tavern-mobile-import-shell" }, h("div", { className: "dsh-tavern-mobile-import-panel" },
					h("div", { className: "dsh-tavern-mobile-import-title" }, "从手机下载目录导入"),
					h("div", { className: "dsh-tavern-question-sub" }, "把 PNG 或 JSON 人物卡放进手机 Download，回到这里点选。"),
					h("div", { className: "dsh-tavern-mobile-import-count" }, countText),
					error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
					h("div", { className: "dsh-tavern-mobile-import-tools" },
						h("input", { className: "dsh-tavern-mobile-import-search", type: "search", value: filter, placeholder: "筛选文件名", disabled: busy, onChange: function (event) { setFilter(event.target.value); } }),
						h("select", { className: "dsh-tavern-mobile-import-sort", value: sort, disabled: busy, "aria-label": "排序方式", onChange: function (event) { const value = event.target.value; setSort(value); saveMobileImportSort(value); } },
							MOBILE_IMPORT_SORTS.map(function (option) { return h("option", { key: option.id, value: option.id }, option.label); }))),
					selecting ? h("div", { className: "dsh-tavern-mobile-import-selection" },
						h("span", { className: "dsh-tavern-mobile-import-selection-copy" }, selected.size ? "已选 " + selected.size + " 个（可跨筛选累计）" : "点条目勾选，可跨筛选累计"),
						h("button", { className: "dsh-tavern-btn", disabled: busy || !files.length, onClick: selectAllVisible }, everyVisibleSelected ? "取消全选" : "全选 " + files.length + " 项"),
						h("button", { className: "dsh-tavern-btn", disabled: busy || !selected.size, onClick: function () { setSelected(new Set()); } }, "清空选择"),
						h("button", { className: "dsh-tavern-btn primary dsh-tavern-mobile-import-selection-primary", disabled: busy || !selectedFiles.length, onClick: function () { importQueue(selectedFiles); } }, "导入选中 " + selectedFiles.length + " 个")
					) : null,
					h("div", { className: "dsh-tavern-mobile-import-list" }, files.length ? files.map(rowOf) : emptyState()),
					h("div", { className: "dsh-tavern-library-head-actions dsh-tavern-mobile-import-actions" },
						h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: load }, "刷新"),
						h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { close(); if (props.inputRef.current) props.inputRef.current.click(); } }, "使用系统文件选择器"),
						h("button", { className: "dsh-tavern-btn", disabled: busy || !allFiles.length, onClick: function () { setSelecting(!selecting); } }, selecting ? "退出多选" : "多选"),
						h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: close }, "关闭"))
				))) : null
			);
		}

		// @include modules/runtime-generation-monitor.js

		function reloadTavernClient() {
			const script = Array.from(document.scripts || []).find(function (item) {
				return String(item && item.src || "").includes("/plugins/dsh-tavern-plugin/client.js");
			});
			const warm = script && script.src
				? fetch(script.src, { cache: "reload" }).catch(function () {})
				: Promise.resolve();
			return warm.then(function () { window.location.reload(); });
		}

		const tavernRuntimeGenerationMonitor = createTavernRuntimeGenerationMonitor({
			load: function () {
				return fetch("/api/dsh-tavern/runtime-generation", { cache: "no-store" }).then(readTavernJsonResponse);
			},
			refresh: reloadTavernClient
		});

		async function readTavernJsonResponse(response, onBody) {
			function failure(message, retryable) {
				const error = new Error(message);
				error.status = response.status;
				error.retryable = retryable;
				return error;
			}
			if (response.status === 401) throw failure("连接认证已失效，请通过服务启动时提供的地址重新打开页面", false);
			if (response.status === 403) throw failure("请求被拒绝，请检查访问地址和权限", false);
			if (!response.ok) throw failure("服务请求失败（HTTP " + response.status + "），请稍后重试", [404, 408, 429, 502, 503, 504].includes(response.status));
			const body = await response.text();
            if (onBody) onBody(body);
			if (!body.trim()) throw failure("服务返回空响应，可能仍在启动或重启，请稍后重试", true);
			try { return JSON.parse(body); }
			catch (_error) { throw failure("服务返回非 JSON 或不完整的响应，请稍后重试", true); }
		}

		// @include opening-performance.js
		const pagePerformance = { observedMs: 0, longTaskCount: 0, longTaskTotalMs: 0, longTaskMaxMs: 0, slowRpcCount: 0, slowRpcMaxMs: 0, longTaskSupported: false };
		const pagePerformanceStarted = Date.now();
		let performanceReportAt = 0;
		let performanceActiveRequests = 0;
		const performanceRequests = [];
		if (typeof window !== "undefined" && typeof PerformanceObserver !== "undefined") {
			try {
				if (window.__dshTavernPerformanceObserver) window.__dshTavernPerformanceObserver.disconnect();
				if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
					const observer = new PerformanceObserver(function (list) {
						for (const entry of list.getEntries()) {
							if (entry.duration < 100) continue;
							pagePerformance.longTaskCount++;
							pagePerformance.longTaskTotalMs += Math.round(entry.duration);
							pagePerformance.longTaskMaxMs = Math.max(pagePerformance.longTaskMaxMs, Math.round(entry.duration));
						}
					});
					observer.observe({ type: "longtask" });
					window.__dshTavernPerformanceObserver = observer;
					pagePerformance.longTaskSupported = true;
				}
			} catch (_) {}
		}

		// @include-domain indexed-array.js
		// @include-domain ordered-numeric-index.js
		// @include modules/session-view-sync.js
		const beginSessionViewRead = createSessionViewReader();

		function rpc(method, args, sessionId, requestOptions) {
			const runtimeControl = ["claimTavernScriptWork", "startTavernScriptWork", "getTavernScriptWorkState", "heartbeatTavernScriptRuntime", "completeTavernHelperEvent", "releaseTavernHelperRuntime"].includes(method);
			const controlChannel = runtimeControl && typeof tavernSessionSignals !== "undefined" && typeof tavernSessionSignals.control === "function" ? tavernSessionSignals : null;
			const started = Date.now();
            const clockStart = performance.now();
            const traced = ["getSession", "syncSession", "getCardOpenings", "initializeOpeningTemplate", "preparePlayStart", "startChat"].includes(method);
            const trace = traced ? { id: window.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16); }), method, sentAt: started, active: ++performanceActiveRequests } : null;
            const payload = Object.assign({}, args || {});
			if (!runtimeControl && (started - performanceReportAt >= 60000 || /diagnostic|export/i.test(method))) {
				pagePerformance.observedMs = started - pagePerformanceStarted;
				payload._performance = Object.assign({}, pagePerformance, { requests: performanceRequests.slice(), openingRequests: typeof openingPerformance !== "undefined" ? openingPerformance.requests() : [], openings: typeof openingPerformance !== "undefined" ? openingPerformance.read() : [] });
				performanceReportAt = started;
			}
			if (trace) payload._traceId = trace.id;
			if (sessionId) payload.sessionId = sessionId;
			const viewRead = method === "getSession" ? beginSessionViewRead(payload.sessionId) : null;
			if (viewRead) { payload.viewSync = 1; payload.resourceSync = 1; payload.openingWindow = 1; if (historyFromSessions.has(payload.sessionId)) payload.historyFrom = historyFromSessions.get(payload.sessionId); payload.viewCursor = viewRead.cursor; if (viewRead.receiptSync) payload.receiptSync = 1; }
			if (method === "getTavernHelperContext" && !payload.eventId && !payload.fullView) payload.openingWindow = 1;
			const requestBody = JSON.stringify(payload);
			if (trace) {
				try { trace.requestBytes = typeof TextEncoder === "function" ? new TextEncoder().encode(requestBody).length : requestBody.length; }
				catch (_error) { trace.requestBytes = requestBody.length; }
			}
			const request = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: requestBody
			};
			if (requestOptions && requestOptions.signal) request.signal = requestOptions.signal;
			// Release ownership even when a cancelled carrier never settles.
			const releaseViewRead = viewRead ? () => viewRead.release() : null;
			if (releaseViewRead && request.signal) {
				if (request.signal.aborted) releaseViewRead();
				else request.signal.addEventListener("abort", releaseViewRead, { once: true });
			}
			if (requestOptions && requestOptions.keepalive === true) request.keepalive = true;
			if (method === "generateSceneImage") recordImageInteraction(payload.sessionId, payload.turn, payload.requestId, "sent");
			const responsePromise = controlChannel
				? Promise.resolve().then(() => controlChannel.control(method, JSON.parse(requestBody), requestOptions && requestOptions.signal))
				: fetch("/api/dsh-tavern/" + method, request).then(async function (response) {
                if (trace) trace.headersMs = Math.round(performance.now() - clockStart);
                const result = await readTavernJsonResponse(response, trace ? body => { trace.bodyChars = body.length; } : undefined);
                if (trace) {
					trace.parsedMs = Math.round(performance.now() - clockStart);
					try {
						const header = response.headers && typeof response.headers.get === "function" ? response.headers.get("content-length") : null;
						if (header) trace.responseBytes = Number(header);
						// bodyChars measures the decoded body without serializing the large result again.
					} catch (_error) {}
				}
                return result;
            });
			function checkCancelled() {
				if (request.signal && request.signal.aborted) {
					if (typeof request.signal.throwIfAborted === "function") request.signal.throwIfAborted();
					const error = new Error("会话读取已取消");
					error.name = "AbortError";
					throw error;
				}
			}
			return responsePromise.then(function (result) {
				checkCancelled();
				result = viewRead && viewRead.current() || result;
				tavernRuntimeGenerationMonitor.observe(result && result.runtimeGeneration);
				if (!result || !result.ok) {
					const error = new Error(result && result.error ? result.error : "操作失败");
					if (typeof result?.errorCode === "string" && result.errorCode) error.code = result.errorCode;
					throw error;
				}
				const accepted = viewRead ? viewRead.accept(result) : result;
                if (accepted.contextWindow) return {...accepted,context:expandTavernOpeningWindow(accepted.contextWindow).tavernHelper};
                return accepted.view && accepted.view.historyWindow ? {...accepted,view:expandTavernOpeningWindow(accepted.view)} : accepted;
			}).catch(function (error) {
				checkCancelled();
				const newer = viewRead && viewRead.current();
				if (newer) return newer.view && newer.view.historyWindow ? {...newer,view:expandTavernOpeningWindow(newer.view)} : newer;
                if (trace) trace.failed = true;
				if (method === "generateSceneImage") recordImageInteraction(payload.sessionId, payload.turn, payload.requestId, "failed", "rpc-error");
				throw error;
			}).finally(function () {
				if (viewRead) viewRead.release();
				if (releaseViewRead && request.signal) request.signal.removeEventListener("abort", releaseViewRead);
				const elapsed = Date.now() - started;
                if (trace) {
                    performanceActiveRequests--;
                    trace.durationMs = Math.round(performance.now() - clockStart);
                    performanceRequests.push(trace);
                    if (!["getSession", "syncSession"].includes(method) && typeof openingPerformance !== "undefined") openingPerformance.recordRequest(trace);
                    if (performanceRequests.length > 60) performanceRequests.shift();
                }
                if (elapsed >= 1000) { pagePerformance.slowRpcCount++; pagePerformance.slowRpcMaxMs = Math.max(pagePerformance.slowRpcMaxMs, elapsed); }
			});
		}

		function recordImageInteraction(sessionId, turn, requestId, stage, reason) {
			void rpc("recordSceneImageInteraction", { turn: turn, requestId: requestId, stage: stage, reason: reason }, sessionId).catch(function () {});
		}

		function rpcWithTimeout(method, args, sessionId) {
			const controller = new AbortController();
			const timer = window.setTimeout(function () { controller.abort(); }, 15000);
			return rpc(method, args, sessionId, { signal: controller.signal }).catch(function (error) {
				if (controller.signal.aborted) throw new Error("读取超时，请重新读取");
				throw error;
			}).finally(function () { window.clearTimeout(timer); });
		}

		function worldBookCatalogDiagnostic(result) {
			const diagnostics = result && Array.isArray(result.diagnostics) ? result.diagnostics : [];
			if (!diagnostics.length) return "";
			return "已跳过 " + diagnostics.length + " 个损坏资源：\n" + diagnostics.map(function (item) { return String(item.path || "未知资源") + "：" + String(item.message || "无法读取"); }).join("\n");
		}

		function notifyTavernDataChanged(kinds, source) {
			const changedKinds = Array.isArray(kinds) ? kinds.filter(Boolean) : [];
			window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed", { detail: { kinds: changedKinds, source: String(source || "") } }));
		}

		function tavernDataChangeAffects(event, kinds, owner) {
			const detail = event && event.detail && typeof event.detail === "object" ? event.detail : null;
			if (!detail || !Array.isArray(detail.kinds) || detail.kinds.length === 0) return true;
			if (owner && detail.source === owner) return false;
			const expected = Array.isArray(kinds) ? kinds : [];
			return detail.kinds.indexOf("*") >= 0 || expected.some(function (kind) { return detail.kinds.indexOf(kind) >= 0; });
		}

		// @include modules/library-refresh.js

        const tavernSidebarOpens = new Map();
        function openTavernSidebarTab(ctx, seed, scope) {
            const key = JSON.stringify([scope.sessionId, seed]);
            if (tavernSidebarOpens.has(key)) return tavernSidebarOpens.get(key);
            const operation = (async function () {
                const deadline = Date.now() + 10000;
                for (;;) {
                    try { ctx.betterSidebar.openTab(seed, scope); return; }
                    catch (error) {
                        // The session list can restore before DSH mounts its native
                        // sidebar seat. Retry this specific readiness error only.
                        if (!/sidebarRight: no session surface is mounted/.test(String(error.message || error)) || Date.now() >= deadline) throw error;
                        await new Promise(resolve => window.setTimeout(resolve, 100));
                        if (ctx.sessions.list.getSnapshot().current !== scope.sessionId) return;
                    }
                }
            })().catch(error => tavernErrorHub.report("打开酒馆侧栏", error)).finally(() => tavernSidebarOpens.delete(key));
            tavernSidebarOpens.set(key, operation);
            return operation;
        }

		function openPlayChatDebugWorkspace(sourceSessionId, turn) {
			return new Promise(function (resolve, reject) {
				let settled = false;
				const timer = window.setTimeout(function () {
					if (settled) return;
					settled = true;
					reject(new Error("卡片工作台没有响应，请重试"));
				}, 15000);
				function finish(callback, value) {
					if (settled) return;
					settled = true;
					window.clearTimeout(timer);
					callback(value);
				}
				window.dispatchEvent(new CustomEvent("dsh-tavern-debug-play-chat", { detail: {
					sourceSessionId: sourceSessionId,
					turn: Number(turn),
					resolve: function (value) { finish(resolve, value); },
					reject: function (error) { finish(reject, error); }
				} }));
			});
		}

		// @include modules/session-refresh-controller.js
		// @include modules/live-tavern-view.js

		function isMissingTavernCardError(value) {
			return /^人物卡不存在:\s*/.test(String(value && value.message || value || ""));
		}

        // @include helper-history.js
        // @include helper-resources.js
        // @include helper-model.js

        function expandTavernOpeningWindow(view) {
            const range=view && view.historyWindow, helper=view && view.tavernHelper;
            if (!range || !helper || !Array.isArray(helper.messages)) return view;
            const messages=Array.from({length:range.messageCount},function (_,message_id) { return {message_id:message_id,stub:true}; });
            for (const row of helper.messages) messages[row.message_id]=row;
            return {...view,tavernHelper:{...helper,messages:messages}};
        }

		function applyTavernHelperMessageHydration(view, payload) {
			if (!view || !view.tavernHelper || !Array.isArray(view.tavernHelper.messages) || !payload || !Array.isArray(payload.messages)) return view;
			const messages = view.tavernHelper.messages.slice();
			for (const message of payload.messages) {
				const index = Number(message && message.message_id);
				if (!Number.isSafeInteger(index) || index < 0 || index >= messages.length) continue;
				messages[index] = message;
			}
			const nextHelper = Object.assign({}, view.tavernHelper, { messages: messages });
			delete nextHelper.messagesPending;
			return Object.assign({}, view, { tavernHelper: nextHelper });
		}

		async function hydrateLiveTavernHelperMessages(sessionId, view, request) {
            // First paint is independent of compatibility/history preparation.
            // A window must not be promoted to a complete view by filling only
            // Helper rows: historical display projections need their full read.
            if (view && view.historyWindow) return (await rpc("getSession", {fullView:true}, sessionId, request)).view;
			const pending = view && view.tavernHelper && view.tavernHelper.messagesPending;
			if (!pending) return view;
			const payload = await rpc("hydrateTavernHelperMessages", {
                chatId: view.tavernHelper.chatId,
                revision: view.tavernHelper.stateRevision,
				from: pending.from,
				to: pending.to
			}, sessionId, request);
			return applyTavernHelperMessageHydration(view, payload);
		}

		const liveTavernView = createLiveTavernViewModule({
			deduplicateViews: true,
			loadTimeoutMs: 10000,
			cacheRetentionMs: 10 * 60 * 1000,
			timeoutRetryDelayMs: 5000,
			load: function (sessionId, request) { return rpc("getSession", {}, sessionId, request); },
			hydrateHelperMessages: hydrateLiveTavernHelperMessages,
			shouldPoll: function (view) { return !!(view && view.activity && view.activity.busy); },
			pollWhileBusy: false,
			isTerminalError: isMissingTavernCardError
		});
		// Side panels read the session view too. Started together with the conversation's own
		// first read they had no delta cursor yet, so each downloaded the whole view (a few MB
		// for heavy cards). Waiting for the conversation's view makes theirs a delta read.
		function readSessionViewAfterLive(sessionId) {
			const ready = function (state) { return state.phase === "ready" || state.phase === "unavailable" || state.phase === "retrying"; };
			const wait = ready(liveTavernView.getSnapshot(sessionId)) ? Promise.resolve() : new Promise(function (resolve) {
				let stop = null, done = false;
				const timer = window.setTimeout(finish, 10000);
				function finish() { if (done) return; done = true; window.clearTimeout(timer); if (stop) stop(); resolve(); }
				stop = liveTavernView.subscribe(sessionId, function (state) { if (ready(state)) finish(); });
				if (done) stop();
			});
			return wait.then(function () { return rpc("getSession", { sessionId: sessionId }, sessionId); });
		}
		function coordinationView(result, sessionId) {
			const sync = result && result.sync ? result.sync : (result || {});
			const tasks = sync.tasks && typeof sync.tasks === "object" ? sync.tasks : {};
			const background = tasks.background || null;
			return {
				runtimeGeneration: String(sync.runtimeGeneration || ""),
				liveSession: sync.liveSession === true,
				requestMode: sync.requestMode === "sillytavern" ? "sillytavern" : "dsh",
				cardPath: String(sync.cardPath || ""),
				cardName: String(sync.cardName || ""),
				activity: background ? { phase: background.status === "queued" ? "pending" : (background.status === "succeeded" ? "idle" : background.status), busy: background.busy === true, role: background.kind, operationId: background.operationId, updatedAt: background.updatedAt } : (sync.activity || null),
				task: tasks.candidate || sync.task || null,
				tasks: tasks,
				mailboxVersion: Number(sync.mailboxVersion) || 0,
				projectionRevision: Number(sync.projectionRevision) || 0
			};
		}

		let tavernSessionSignals;

		// @include modules/tavern-coordination.js

		const coordinatedCardPaths = new Map();
		const tavernCoordination = createTavernCoordinationEventModule({
			onView: function (sessionId, view) {
				liveTavernView.invalidate(sessionId);
				const cardPath = String(view && view.cardPath || "");
				const observed = coordinatedCardPaths.has(sessionId);
				const previous = observed ? coordinatedCardPaths.get(sessionId) : cardPath;
				coordinatedCardPaths.set(sessionId, cardPath);
				if (observed && previous === "" && cardPath !== "") notifyTavernDataChanged(["cards", "sessions"], "coordination");
			},
			connect: function (sessionId, handlers) {
				return createTavernCoordinationConnection({
					load: request => rpc("syncSession", { kind: "candidate" }, sessionId, request),
					subscribe: (message, error, connected) => tavernSessionSignals.subscribe(sessionId, "tavern-state", message, error, connected),
					view: result => coordinationView(result, sessionId),
					handlers
				});
			}
		});

		function describeTavernActivity(value) {
			const activity = value && typeof value === "object" ? value : {};
			const role = String(activity.role || "");
			// The worldbook prefilter yields to any other task, so it never blocks the player.
			const busy = activity.busy === true && role !== "worldbook-filter";
			let label = "生成候选项";
			let blockReason = "";
			if (busy && role === "candidate") { label = "生成中…"; blockReason = "正在生成候选项，请稍候…"; }
			else if (busy) { label = "后台结算中…"; blockReason = "后台结算中，请稍候…"; }
			return { phase: String(activity.phase || "idle"), busy: busy, role: role, label: label, blockReason: blockReason };
		}


		function useLiveTavernView(sessionId, revision, paths) {
            const dependencyKey = JSON.stringify(paths);
			const subscribe = React.useCallback(function (notify) { return liveTavernView.subscribe(sessionId, notify, paths); }, [sessionId, dependencyKey]);
			const snapshot = React.useCallback(function () { return liveTavernView.getSnapshot(sessionId); }, [sessionId]);
			const state = React.useSyncExternalStore(subscribe, snapshot, snapshot);
			const previous = React.useRef({ sessionId: sessionId, revision: revision });
			React.useEffect(function () {
				const last = previous.current;
				previous.current = { sessionId: sessionId, revision: revision };
				if (last.sessionId === sessionId && last.revision !== revision) liveTavernView.invalidate(sessionId);
			}, [sessionId, revision]);
			return state;
		}

        // Scrolling into older floors extends the session's history window by one
        // page; later view syncs keep that range instead of a complete history.
        const TAVERN_HISTORY_PAGE = 120;
        const historyFromSessions = new Map();
        const historyLoads = new Map();
        function requestOlderHistory(sessionId, windowFrom) {
            if(historyLoads.has(sessionId))return historyLoads.get(sessionId);
            const current=historyFromSessions.get(sessionId);
            historyFromSessions.set(sessionId,Math.max(0,Math.min(current ?? windowFrom,windowFrom)-TAVERN_HISTORY_PAGE));
            const task=rpc("getSession",{},sessionId).then(result=>liveTavernView.setView(sessionId,result.view)).finally(()=>historyLoads.delete(sessionId));
            historyLoads.set(sessionId,task);
            return task;
        }

		function useScopedLiveTavernView(sessionId, revision, paths) {
			const key = JSON.stringify(paths);
			const selection = React.useMemo(function () { return liveTavernView.select(sessionId, paths); }, [sessionId, key]);
			const state = React.useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
			const previous = React.useRef({ sessionId: sessionId, revision: revision });
			React.useEffect(function () {
				const last = previous.current;
				previous.current = { sessionId: sessionId, revision: revision };
				if (last.sessionId === sessionId && last.revision !== revision) liveTavernView.invalidate(sessionId);
			}, [sessionId, revision]);
			return state;
		}

		function useTavernCoordination(sessionId, revision) {
			const [state, setState] = React.useState(function () { return tavernCoordination.getSnapshot(sessionId); });
			React.useEffect(function () { return tavernCoordination.subscribe(sessionId, setState); }, [sessionId]);
			React.useEffect(function () { tavernCoordination.invalidate(sessionId); }, [sessionId, revision]);
			return state;
		}

// @include runtime/conversation-lifecycle.js

// @include ui/error-center.js

// @include ui/lazy-details.js

// @include ui/visible-refresh.js


// @include runtime/host-artifacts.js

// @include runtime/helper-public-api.js
// @include runtime/helper-macro-api.js
// @include runtime/helper-display-api.js
// @include runtime/helper-generation-api.js
// @include runtime/helper-event-api.js
// @include-domain tavern-regex-engine.js
// @include-domain tavern-helper-regex-api.js
// @include-domain response-refusal.js
// @include refusal-notice.js
// @include runtime/frame-document.js

// @include modules/host-theme.js

// @include runtime/helper-facade.js

        // Bounded, value-free timings shared by every card's initialization.
// @include runtime/helper-bootstrap.js

		// Only downloading is repeatable. Once evaluation starts, its effects are unknown.
// @include runtime/helper-loader.js

		// jQuery captures its owning document. Sharing the iframe's instance with
		// the host would still send $('body') into the hidden script iframe.
// @include runtime/helper-host.js

// @include runtime/helper-script-runtime.js

		// The execution owner holds the lease, signal subscription and sandbox as one lifetime.
		// A new session (including A -> B -> A) gets a distinct lease identity.
// @include runtime/script-execution.js

		// Guard pathological card resize loops without constraining normal long content.
// @include runtime/message-frame-lifecycle.js

// @include features/plugin-extensions.js

// @include ui/message-frame.js

// @include features/assistant-renderer.js

// @include features/card-list.js

// @include features/sidebar.js

// @include features/scene-images.js
// @include features/settings.js

// @include features/user-profile.js

// @include features/guide-library.js
// @include features/regex-library.js

// @include features/system-prompts.js

// @include features/resources-library.js

        // @include card-memory.js

// @include features/skills.js


// @include features/preset-library.js


// @include features/worldbook-library.js

// @include features/card-library.js

// @include features/turn-history.js

// @include features/play-controls.js

// @include features/request-context.js


		const inject = ["slots", "sessions", "workspaces", "layout", "connection", "conversation", "betterSidebar", "remote", "remote.commands", "tavernSessionSignals"];

		function apply(ctx) {
			ctx.effect(() => displayPreferences.start(), "dsh-tavern: global display preferences");
			ctx.effect(() => tavernInteractionDiagnostics.start(), "dsh-tavern: interaction diagnostics");
			ctx.effect(() => syncTavernSubagentCatalogs(ctx.sessions), "dsh-tavern: subagent catalog synchronization");
			ctx.effect(() => syncTavernCardAgentResources(ctx.sessions), "dsh-tavern: card Agent resource refresh");
			const slots = ctx.slots;
			if (slots === undefined) return;
            ctx.effect(() => slots.inject("conversation.view", () => slots.register({
                name: "conversation.view", id: "dsh-tavern:full-context", order: 11,
                label: "完整上下文", inject: sessionId => ({ contextSessionId: sessionId })
            }, FullRequestContextView)), "dsh-tavern: full request context");
            ctx.effect(() => slots.inject("conversation.view", () => slots.register({
                name: "conversation.view", id: "dsh-tavern:gallery", order: 12,
                label: "画廊", inject: sessionId => ({ gallerySessionId: sessionId })
            }, SceneImageGallery)), "dsh-tavern: picture gallery");
			// Public browser API for third-party plugins (docs/plugin-api.md).
			tavernUiExtensions.service.ctx = ctx;
			if (typeof ctx.provide === "function") ctx.provide("tavernUi", tavernUiExtensions.service);
			const signals = ctx.tavernSessionSignals;
			if (!signals || typeof signals.subscribe !== "function") throw new Error("DSH Tavern Remote 状态流不可用");
			tavernSessionSignals = signals;
			ctx.effect(function () { return function () { if (tavernSessionSignals === signals) tavernSessionSignals = undefined; }; }, "dsh-tavern: remote session signals");
			ctx.effect(function () { return tavernRuntimeGenerationMonitor.start(); }, "dsh-tavern: runtime generation monitor");
			function reconcileLibraryTabTitles() {
				if (!ctx.betterSidebar || typeof ctx.betterSidebar.getSnapshot !== "function" || typeof ctx.betterSidebar.updateTab !== "function") return;
				const snapshot = ctx.betterSidebar.getSnapshot();
				const state = snapshot.state;
				if (!state) return;
				const retiredTabs = [];
				const expectedTitles = {
					"dsh-tavern:conversation-settings": "本局设置",
					"dsh-tavern:user-profile": "长期偏好",
					"dsh-tavern:cards": "人物卡库",
					"dsh-tavern:presets": "预设库",
					"dsh-tavern:worldbooks": "世界书库",
					"dsh-tavern:resources": "剧本与素材库"
				};
				function visit(node) {
					if (!node) return;
					if (node.kind === "split") {
						(node.children || []).forEach(visit);
						return;
					}
					(node.tabs || []).forEach(function (tab) {
						if (tab.type === "dsh-tavern:boundary-prompts" || tab.type === "dsh-tavern:bypass-plans") { retiredTabs.push(tab.id); return; }
						const title = expectedTitles[tab.type];
						if (title && tab.title !== title) ctx.betterSidebar.updateTab(tab.id, { title: title });
					});
				}
				visit(state.splits);
				visit(state.bottomSplits);
				if (typeof ctx.betterSidebar.closeTab === "function") retiredTabs.forEach(function (tabId) { ctx.betterSidebar.closeTab(tabId, snapshot.sessionId ? { sessionId: snapshot.sessionId } : undefined); });
			}
			function appendMention(sessionId, kind, path, label) {
				try {
					const actx = ctx.sessions.scope(sessionId);
					const conversation = ctx.get("conversation");
					if (!actx || !conversation) throw new Error("当前对话输入框不可用");
					const input = conversation.input.for(actx);
					const safePath = String(path || "").replace(/\\/g, "/").replace(/["\r\n]/g, "");
					const safeLabel = String(label || safePath.split("/").pop() || "世界书").replace(/[\]\r\n]/g, "");
					const mention = kind === "worldbook" ? "@[" + safeLabel + "](tavern-worldbook:" + encodeURIComponent(safePath) + ")" : "@\"" + safePath + "\"";
					const draft = input.state.getSnapshot().draft;
					input.setDraft(draft.trim() === "" ? mention : draft + (/\s$/.test(draft) ? "" : " ") + mention);
				} catch (err) {
					console.warn("dsh-tavern: resource mention failed", err);
					tavernErrorHub.report("在对话中引用", err);
				}
			}
			function cleanWorkspaceDraft(sessionId) {
				const input = ctx.get("conversation").input.for(ctx.sessions.scope(sessionId));
				let busy = false, stopped = false;
				async function clean() {
					const draft = String(input.state.getSnapshot().draft || "");
					const taskStart = draft.indexOf("【卡片任务：");
					if (busy || stopped || !draft.startsWith("【当前 Tavern 资源工作区】") || taskStart < 0) return;
					busy = true;
					try {
						const result = await rpc("getCardTaskPrompt", { task: "edit" }, sessionId);
						const normalize = text => String(text || "").replace(/\s+/g, " ").trim();
						if (!stopped && result.legacyWorkspaceText && normalize(draft.slice(0, taskStart)) === normalize(result.legacyWorkspaceText) && input.state.getSnapshot().draft === draft) input.setDraft(draft.slice(taskStart));
					} catch (error) { tavernErrorHub.report("整理工作区说明", error); }
					finally { busy = false; }
				}
				const unsubscribe = input.state.subscribe(clean);
				void clean();
				return function () { stopped = true; unsubscribe(); };
			}
			async function injectTaskPrompt(sessionId, task, label, card, hasInitialResources, taskSupplement) {
				const actx = ctx.sessions.scope(sessionId);
				const conversation = ctx.get("conversation");
				if (!actx || !conversation) throw new Error("当前对话输入框不可用");
				const input = conversation.input.for(actx);
				const targetPath = card && card.path ? String(card.path).replace(/\\/g, "/").replace(/["\r\n]/g, "") : "";
				if (task === "writing-skill") {
					const references = String(input.state.getSnapshot().draft || "");
					input.setDraft("/create-writing-skill\n\n请从已引用的素材中提炼写作 Skill，用于前台正文写作。先与我确认适用场景、禁用场景和写作要求，再编写自包含的提示词；成品不依赖原素材或参考文件。\n\n【参考素材】\n" + references);
					return;
				}
				if (task === "gentle") {
					if (!targetPath) throw new Error("温和改写缺少目标人物卡");
					input.setDraft("/gentle-rewrite\n\n@\"" + targetPath + "\"\n\n先调用 tavern_copy_card 创建保留原卡图片的独立副本，再按温和改写 skill 完成改写，交付副本路径与改写摘要。");
					return;
				}
				if (task === "mvu") {
					if (!targetPath) throw new Error("MVU 转换缺少目标人物卡");
					input.setDraft(
						"/card-to-mvu\n\n【目标人物卡】\n@\"" + targetPath + "\"\n\n" +
						"先用 tavern_copy_card 建一份副本，在副本上改成 MVU 版，原卡保持不变；保留剧情设定与状态栏视觉风格。原卡自带的候选项（生成提示、按钮、正则和专用脚本）移除，统一使用 DSH Tavern 内置候选项；手机、开场主页等与状态栏和候选项无关的美化与脚本原样保留。"
					);
					return;
				}
				if (task === "create") {
					input.setDraft("/create-card\n\n我想新建一张人物卡。请逐题问我，每次一个问题并给参考选项；问清角色、玩家身份、世界和开场，再问我是否需要 MVU 变量和前端美化。选了美化先给 HTML 草图让我挑，确认设定后再创建。\n\n我的初步想法：");
					return;
				}
				if (task === "user-profile") {
					input.setDraft(
						"/user-profile\n\n通过分批提问了解我的长期游玩与写作偏好。可以提供差异明确的参考选项，也允许我自由回答或跳过；信息足够后形成长期偏好草案让我核对，只有我明确确认后才保存。"
					);
					return;
				}
				const result = await rpc("getCardTaskPrompt", { task: task }, sessionId);
				const draft = String(input.state.getSnapshot().draft || "");
				const supplement = draft + (taskSupplement ? "\n\n" + taskSupplement : "");
				const targetSection = targetPath ? "\n\n【目标人物卡】\n@\"" + targetPath + "\"" : "";
				const resourceSection = hasInitialResources ? (task === "worldbook" || task === "preset" || task === "script" ? "\n\n【编辑目标】\n" : "\n\n【初始剧本】\n") : "";
				if (task === "debug-play") {
					input.setDraft("/debug-card" + targetSection + "\n\n" + supplement.trim() + "\n\n请结合已引用的游玩记录，检查这张人物卡的异常表现，按需读取相关日志和状态，说明原因并给出修改建议。");
					return;
				}
				if (task === "edit") {
					const editPrompt = String(result && result.text || "").trim();
					const target = targetPath ? "\n\n目标卡：@\"" + targetPath + "\"" : "";
					input.setDraft(editPrompt.replace("/edit-card", "/edit-card" + target) + resourceSection + (supplement ? "\n\n" + supplement : ""));
					return;
				}
				const taskText = "【卡片任务：" + label + "】" + targetSection + "\n\n" + String(result && result.text || "").trim() + resourceSection;
				input.setDraft(taskText + supplement);
			}
			registerTavernStartPage(ctx, slots);
			playControlsFeature.register({ ctx: ctx, slots: slots });
			assistantRendererFeature.register({ ctx: ctx, slots: slots });
			ctx.effect(function () {
				return slots.inject("conversation.input.right", function () { return slots.register({
					name: "conversation.input.right",
					id: "dsh-tavern-background-model",
					order: 100
				}, function (props) { return React.createElement(TavernBackgroundModelLabel, Object.assign({}, props, { sessions: ctx.sessions })); }); });
			}, "dsh-tavern: background model label");
			ctx.effect(function () {
				return slots.inject("settings.section", function () { return slots.register({
					name: "settings.section",
					id: "dsh-tavern",
					order: 110,
					label: function () { return "DSH Tavern"; }
				}, TavernSettingsSection); });
			}, "dsh-tavern: settings section");
			ctx.effect(function () {
				let dispose = null, active = true;
				// Releases without scene images get no page at all.
				rpc("getTavernSettings").then(function (result) {
					if (!active || !(result.releaseCapabilities && result.releaseCapabilities.sceneImages)) return;
					dispose = slots.inject("settings.section", function () { return slots.register({
						name: "settings.section",
						id: "dsh-tavern-scene-images",
						order: 111,
						label: function () { return "场景生图"; }
					}, function () { return React.createElement("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings" }, React.createElement(SceneImageSettings, null)); }); });
				}, function () {});
				return function () { active = false; if (typeof dispose === "function") dispose(); };
			}, "dsh-tavern: scene image settings section");

			ctx.effect(function () {
				const dispose = ctx.betterSidebar.registerTab({ id: "dsh-tavern:system-prompts", title: "系统提示词", order: 5, single: true, component: SystemPromptSidebarTab });
				return function () { if (typeof dispose === "function") dispose(); };
			}, "dsh-tavern: system prompt sidebar tab");
			userPreferenceProfileFeature.register({ ctx: ctx });
			presetLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			resourcesLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
            ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-tavern:guide-library", title: "Guide 库", order: 9, single: true, component: GuideLibraryTab }), "dsh-tavern: guide library");
            ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-tavern:regex-library", title: "正则库", order: 9, single: true, component: RegexLibraryTab }), "dsh-tavern: regex library");
			ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-tavern:skills", title: "Skill 库", order: 8, single: true, component: props => React.createElement(TavernSkillsTab, { sessionId: props.scope.sessionId }) }), "dsh-tavern: Skill library");
            ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-tavern:card-memory", title: "改卡记忆", order: 9, single: true, component: props => React.createElement(TavernCardMemoryTab, { sessionId: props.scope.sessionId }) }), "dsh-tavern: card memory");
			worldBookLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			cardLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			ctx.effect(function () {
				reconcileLibraryTabTitles();
				if (typeof ctx.betterSidebar.subscribeState !== "function") return;
				return ctx.betterSidebar.subscribeState(reconcileLibraryTabTitles);
			}, "dsh-tavern: reconcile persisted library tab titles");
			ctx.effect(function () {
				function invalidateLiveView(event) { if (tavernDataChangeAffects(event, ["sessions", "cards", "presets", "worldbooks", "scripts"], "live-view")) liveTavernView.invalidate(); }
				window.addEventListener("dsh-tavern-data-changed", invalidateLiveView);
				return function () { window.removeEventListener("dsh-tavern-data-changed", invalidateLiveView); };
			}, "dsh-tavern: live Tavern view invalidation");
			tavernShellFeature.register({ ctx: ctx, slots: slots, appendMention: appendMention, injectTaskPrompt: injectTaskPrompt, cleanWorkspaceDraft: cleanWorkspaceDraft });
		}

		exports.TavernMessageFrame = TavernMessageFrame;
		exports.TavernPersistentStatusRuntime = TavernPersistentStatusRuntime;
		exports.createTavernMessageFrameLifecycle = createTavernMessageFrameLifecycle;
		exports.createTavernScriptExecutionModule = createTavernScriptExecutionModule;
		exports.createTavernScriptSessionOwner = createTavernScriptSessionOwner;
		exports.createTavernSessionRetention = createTavernSessionRetention;
		exports.createRetainedTavernFrames = createRetainedTavernFrames;
		exports.createMvuBundleLoader = createMvuBundleLoader;
		exports.TavernMvuLoadRecovery = TavernMvuLoadRecovery;
		exports.findTavernQuoteRanges = findTavernQuoteRanges;
        exports.installTavernTextColors = installTavernTextColors;
        exports.TavernColoredMarkdown = TavernColoredMarkdown;
        exports.apply = apply;
		exports.createTurnHistoryProjection = createTurnHistoryProjection;
		exports.createTurnErrorControls = createTurnErrorControls;
		exports.createSupersededErrorProjection = createSupersededErrorProjection;
		exports.inject = inject;
		exports.buildOpeningPreviewDocument = buildOpeningPreviewDocument;
		exports.buildTavernFrameDocument = buildTavernFrameDocument;
		exports.openingPreviewSelection = openingPreviewSelection;
		exports.syncTavernSubagentCatalogs = syncTavernSubagentCatalogs;
		exports.syncTavernCardAgentResources = syncTavernCardAgentResources;
		exports.applyTavernVariableReceipt = applyTavernVariableReceipt;
		exports.createTavernHelperTransport = createTavernHelperTransport;
		exports.createTavernInitializationTiming = createTavernInitializationTiming;
		exports.createTavernHelperEventBus = createTavernHelperEventBus;
		exports.buildTavernHelperScriptDocument = buildTavernHelperScriptDocument;
        exports.startTavernHelperFromMessage = startTavernHelperFromMessage;
        exports.createTavernChatDataFacade = createTavernChatDataFacade;
        exports.createTavernHistoryReader = createTavernHistoryReader;
        exports.expandTavernOpeningWindow = expandTavernOpeningWindow;
		exports.createTavernHostStylesheetBridge = createTavernHostStylesheetBridge;
		exports.createTavernPanelRegistry = createTavernPanelRegistry;
		exports.createTavernCardAppPresence = createTavernCardAppPresence;
		exports.createTavernCardAppDock = createTavernCardAppDock;
		exports.createTavernHelperScriptRuntime = createTavernHelperScriptRuntime;
		exports.ensureTavernHostJQuery = ensureTavernHostJQuery;
		exports.ensureTavernHostJQueryUi = ensureTavernHostJQueryUi;
		exports.installTavernTrustedHostFacade = installTavernTrustedHostFacade;
        exports.loadTavernHelperModule = loadTavernHelperModule;
        exports.installTavernBackgroundModel = installTavernBackgroundModel;
        exports.mountTavernLegacyMessage = mountTavernLegacyMessage;
        exports.mountTavernScriptLayer = mountTavernScriptLayer;
        exports.tavernScriptLayers = tavernScriptLayers;
        window.__dshTavernScriptLayers = function (sessionId, messageId) { return tavernScriptLayers(window.document, sessionId, messageId); };
		exports.releaseTavernHostJQueryHandlers = releaseTavernHostJQueryHandlers;
		exports.tavernScriptRuntimeReady = tavernScriptRuntimeReady;
		exports.clampTavernFrameHeight = clampTavernFrameHeight;
		exports.createTavernHelperContextUpdate = createTavernHelperContextUpdate;
		exports.applyTavernHelperContextUpdate = applyTavernHelperContextUpdate;
		exports.projectionPartsOf = projectionPartsOf;
		exports.createTavernPreviewWindow = createTavernPreviewWindow;
		exports.tavernStoryTurnForDshTurn = tavernStoryTurnForDshTurn;
		exports.tavernMvuReceiptForTurn = tavernMvuReceiptForTurn;
		exports.tavernUserTextForTurn = tavernUserTextForTurn;
		exports.createTavernFrameSlashExecutor = createTavernFrameSlashExecutor;
		exports.createWorldBookLibraryRefreshModule = createWorldBookLibraryRefreshModule;
		exports.groupWorldBookEditorEntries = groupWorldBookEditorEntries;
		exports.orderWorldBookCatalogItems = orderWorldBookCatalogItems;
		exports.filterWorldBookCatalogItems = filterWorldBookCatalogItems;
		exports.groupPresetEntriesByPhase = groupPresetEntriesByPhase;
		exports.createCardLibraryRefreshModule = createCardLibraryRefreshModule;
		exports.tavernDataChangeAffects = tavernDataChangeAffects;
		exports.createLiveTavernViewModule = createLiveTavernViewModule;
        exports.createSessionViewReader = createSessionViewReader;
		exports.applyBodyRegenerationResult = applyBodyRegenerationResult;
		exports.createTavernCoordinationEventModule = createTavernCoordinationEventModule;
		exports.createTavernCoordinationConnection = createTavernCoordinationConnection;
		exports.createSessionRefreshController = createSessionRefreshController;
		exports.describeTavernActivity = describeTavernActivity;
		exports.deleteTavernCards = deleteTavernCards;
		exports.deleteTavernChats = deleteTavernChats;
		exports.askTavernCardChatRemoval = askTavernCardChatRemoval;
		exports.removeTavernCardChats = removeTavernCardChats;
		exports.groupTavernHistory = groupTavernHistory;
		exports.createPlayWorkspaceResolver = createPlayWorkspaceResolver;
		exports.createSessionListRecoveryModule = createSessionListRecoveryModule;
		exports.createTavernFrameLifecycle = createTavernFrameLifecycle;
		exports.installOpeningHostComposer = installOpeningHostComposer;
        exports.installFrameHostComposer = installFrameHostComposer;
        exports.createTavernComposerWindow = createTavernComposerWindow;
        exports.parseTavernInlineFragment = parseTavernInlineFragment;
        exports.TavernInlineFragment = TavernInlineFragment;
        exports.bindTavernFontZoom = bindTavernFontZoom;
        exports.tavernProviderRefusalNotice = tavernProviderRefusalNotice;
        exports.tavernModelRefusalNotice = tavernModelRefusalNotice;
        exports.renderTavernProjection = renderTavernProjection;
		exports.createConversationLifecycleModule = createConversationLifecycleModule;
		exports.createConversationHostAdapter = createConversationHostAdapter;
		exports.createConversationPrewarmModule = createConversationPrewarmModule;
        exports.createConversationAttemptStore = createConversationAttemptStore;
		exports.resolveConversationChatBinding = resolveConversationChatBinding;
		exports.createResourcesLibraryFeatureModule = createResourcesLibraryFeatureModule;
		exports.createPresetLibraryFeatureModule = createExternalPresetAndBypassPlanFeatureModule;
		exports.createWorldBookLibraryFeatureModule = createWorldBookLibraryFeatureModule;
		exports.createCardLibraryFeatureModule = createCardLibraryFeatureModule;
		exports.createPlayControlsFeatureModule = createPlayControlsFeatureModule;
		exports.createTavernAssistantRendererFeatureModule = createTavernAssistantRendererFeatureModule;
		exports.createTavernShellFeatureModule = createTavernShellFeatureModule;
		exports.createTavernRuntimeGenerationMonitor = createTavernRuntimeGenerationMonitor;
		// @include modules/assistant-visibility.js
		installTavernAssistantVisibilityPatch(require);
		// @include modules/host-session-patch.js
		installTavernSessionHistoryPatch(require, rpc);
		return module.exports;
	}
});
