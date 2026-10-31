// @include android-web-polyfills.js
window.__ModuleLoader__.load({
	id: "dsh-tavern-plugin",
	// Parenthesized: V8 compiles this 6 MB factory with the off-thread streamed script instead of
	// lazily re-parsing all of it on the main thread when the loader first calls it (~57 ms per load).
	factory: ((require) => {
		var module = { exports: {} };
		var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			let React = require("react");
			let DshUi = require("@deepseek-ai/dsh-client-ui-primitives");
			// portals the sidebar theme menu into the host logo row.
			let ReactDOM = (function () { try { return require("react-dom"); } catch (_) { return null; } })();

		// @include crypto-digest.js
		// @include stylesheet.js
        // @include surfaces.cjs
		// @include hscroll.js
		if (typeof document !== "undefined") { installTavernStylesheet(document, __TAVERN_BUNDLED_CSS__, __TAVERN_FEATURE_CSS__);  }
		// @include spinner.js
		// @include stage-load-progress.cjs
		// @include wait-lines.js
		// @include jump-latest.js
		// @include inline-field.js
		// @include spine-runtime-entry.js
        // @include pixi-runtime.js
		// @include image-viewer.js
		// @include data-picker.js
		// @include mod-config-ui.js


		// `dsh-tavern-shell-active` gates every Tavern rule that touches host chrome.
		// It used to be added only when the left sidebar mounted. On a phone that
		// sidebar is a drawer, so the class never appeared: the header cell fell back
		// to the host's `display: none` and the whole top bar vanished, while the
		// host's own corner buttons stayed. Mark the document as soon as the Tavern
		// client loads, independently of which panels are mounted.
		function markTavernShellActive() {
			if (typeof document === "undefined") return;
			const mark = function () {
				if (document.body && !document.body.classList.contains("dsh-tavern-shell-active")) {
					document.body.classList.add("dsh-tavern-shell-active");
				}
			};
			if (document.body) mark();
			else document.addEventListener("DOMContentLoaded", mark, { once: true });
		}
		markTavernShellActive();


		// @include foreground.js
		// @include tab-icons.js
		// @include variable-bindings.cjs
		// @include pack-transport.js
		// @include asset-pack-binding.js
		// @include stage-empty.js
		// @include asset-pack-ui.js
		// @include figure-color-contrast.js

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
		// @include download.js

		/** Import one card file: PNG and JSON go as parsed JSON; archives (CHARX, DSH cards) and other
		 * formats (a plugin's importer, tavern.cardImporter) go up as raw files. */
		async function importTavernCardFile(file, call) {
			const archive = !/\.(png|json)$/i.test(String(file.name || "")) && /\.[^./\\]+$/.test(String(file.name || ""));
			// A PNG ending like a ZIP may be a card archive with its cover in front (大肥鱼.dshcard.png): it goes up
			// as a file too, and the host decides (a plain card PNG that only looked like one still imports).
			if (archive || /\.png$/i.test(String(file.name || "")) && await tavernPngEndsLikeZip(file)) {
				const response = await fetch("/api/dsh-tavern/card-upload", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
				let reply = null;
				try { reply = await response.json(); } catch (_error) {}
				if (!reply || !reply.ok) throw new Error(reply && reply.error || "上传失败（HTTP " + response.status + "）");
				return call("importCardUpload", { uploadId: reply.uploadId, name: file.name });
			}
			return call("importCard", { payload: await parseCardFile(file) });
		}

		/** Whether a file's last 64 KB hold a ZIP end record. */
		async function tavernPngEndsLikeZip(file) {
			const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
			for (let index = tail.length - 22; index >= 0; index--) {
				if (tail[index] === 0x50 && tail[index + 1] === 0x4b && tail[index + 2] === 0x05 && tail[index + 3] === 0x06) return true;
			}
			return false;
		}

		/** What a card file brought into its character material, for the import notice. */
		function tavernCardAssetNotice(assets, card) {
			const extra = [];
			if (card && card.plugins && card.plugins.length) extra.push(card.pluginError ? "卡内插件没有启用：" + card.pluginError : "卡内插件 " + card.plugins.map(function (plugin) { return plugin.name; }).join("、") + " 已启用，刷新页面后完整生效");
			if (card && card.startDefaults) extra.push("用这张卡开新局时默认" + (card.startDefaults.preset ? "使用卡里的预设「" + card.startDefaults.preset.replace(/\.json$/i, "") + "」" + (card.startDefaults.settings ? "和推荐设置" : "") : "使用卡里的推荐设置") + "，开局后可在本局设置里改");
			if (card && card.packs && card.packs.length) extra.push("素材包 " + card.packs.map(function (pack) { return pack.title || pack.id; }).join("、") + (card.packs.some(function (pack) { return pack.reused; }) ? "（已有的包直接复用）" : ""));
			// What could not go into the asset library (the stage reads packs from there).
			if (card && card.libraryNotices && card.libraryNotices.length) extra.push(card.libraryNotices.join("；"));
			const base = tavernCardAssetText(assets);
			return [base].concat(extra).filter(Boolean).join("；");
		}
		function tavernCardAssetText(assets) {
			if (!assets) return "";
			if (assets.error) return "角色素材导入失败：" + assets.error;
			const parts = [];
			if (assets.sprites) parts.push(assets.sprites + " 张立绘");
			if (assets.backgrounds) parts.push(assets.backgrounds + " 张背景");
			if (assets.avatars) parts.push(assets.avatars + " 个头像");
			const notes = parts.length ? ["带入" + parts.join("、")] : [];
			const unmatched = assets.unmatched || [];
			if (unmatched.length) notes.push(unmatched.length + " 个表情名未识别（" + unmatched.slice(0, 5).join("、") + (unmatched.length > 5 ? "…" : "") + "），已保留，导出 CHARX 时写回");
			else if (assets.kept) notes.push("另有 " + assets.kept + " 个素材原样保留，导出 CHARX 时写回");
			if (assets.skipped) notes.push(assets.skipped + " 个素材读不到，已跳过");
			return notes.join("；");
		}

		// No file filter on card import: macOS file dialogs (Chrome, Safari) grey out .dshcard and
		// .charx however the accept list names them, since the system knows no type for them.
		// The import checks the format and says what it accepts.
		const TAVERN_CARD_FILE_ACCEPT = undefined;

		function parseCardFile(file) {
			const name = String(file.name || "");
			if (name.toLowerCase().endsWith(".charx")) {
				return file.arrayBuffer().then(function (buf) { return { kind: "charx", name: name, fileB64: bytesToBase64(new Uint8Array(buf)) }; });
			}
			if (name.toLowerCase().endsWith(".json")) {
				return file.text().then(function (text) { return { kind: "text", name: name, text: text }; });
			}
			// a card bundle ZIP picked here gets pointed at its own importer.
			const ZIP_CARD_HINT = "这是卡 ZIP，请用「导入卡 ZIP」打开";
			if (name.toLowerCase().endsWith(".zip")) return Promise.reject(new Error(ZIP_CARD_HINT));
			return file.arrayBuffer().then(function (buf) {
				const bytes = new Uint8Array(buf);
				if (bytes.length > 4 && ascii(bytes, 0, 4) === "PK\x03\x04") throw new Error(ZIP_CARD_HINT);
				if (bytes.length <= 8 || ascii(bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") {
					throw new Error("无法识别的人物卡文件（需要 PNG、JSON、CHARX 或 DSH 人物卡 .dshcard）");
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
				if (needle) return h(EmptyState, { query: filter, onClear: function () { setFilter(""); } });
				return catalog && catalog.storageAccessible === false ? h("div", { className: "dsh-tavern-empty" }, "DSHA 无法读取下载目录。请在系统设置中允许 DSHA ‘访问所有文件’，然后点刷新；也可尝试系统文件选择器。") : h(EmptyState, { text: "下载目录里还没有 PNG/JSON 人物卡" });
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

        // Bounded, metadata-only startup trace, persisted by the read-only scenario collector.
        const roundLoadRows = [], roundLoadCounts = new Map();
        const roundLoadTrace = window.__dshRoundLoadTrace = {
            mark(phase, detail = {}) {
                if (roundLoadRows.length < 200) roundLoadRows.push({phase, at:Date.now(), pageMs:typeof performance === 'undefined' ? null : Math.round(performance.now()), ...detail});
            },
            read: () => roundLoadRows.slice()
        };
        roundLoadTrace.mark('client.module', {navigationAt:typeof performance === 'undefined' ? null : Math.round(performance.timeOrigin)});
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
		// @include modules/session-compat.js
		const beginSessionViewRead = createSessionViewReader();

        // @include rpc-transport.cjs
        const presentationRequest = createPresentationQueue();

		// A save whose session log cannot be upgraded may not open at all, so this works from the
		// conversation menu too: the structure goes to the developer, the story text stays home.
		async function downloadSessionDiagnostics(args, sessionId) {
			const result = await rpc("exportSessionDiagnostics", args, sessionId);
			downloadTavernBlob(new Blob([result.text], { type: "application/json;charset=utf-8" }), result.filename);
		}

		function rpc(method, args, sessionId, requestOptions) {
			// While DSH restarts (after an update) it accepts requests a moment before Tavern's
			// routes and auth are mounted: they answer 404/401/5xx without running the handler.
			// Wait that window out instead of reporting it; a lasting failure still surfaces.
			const RESTART_STATUSES = [401, 404, 502, 503, 504];
			async function fetchThroughRestart(url, request) {
				const deadline = Date.now() + 8000;
				for (let delay = 250; ; delay = Math.min(delay * 2, 2000)) {
					const response = await fetch(url, request);
					if (!RESTART_STATUSES.includes(response.status) || Date.now() + delay > deadline || request.signal?.aborted) return response;
					await new Promise(function (resolve) { window.setTimeout(resolve, delay); });
				}
			}
			const runtimeControl = ["claimTavernScriptWork", "startTavernScriptWork", "getTavernScriptWorkState", "heartbeatTavernScriptRuntime", "completeTavernHelperEvent", "releaseTavernHelperRuntime"].includes(method);
            // Keep stage reads on authenticated HTTP; the upstream mux only declares script controls.
			const controlChannel = runtimeControl && typeof tavernSessionSignals !== "undefined" && typeof tavernSessionSignals.control === "function" ? tavernSessionSignals : null;
			const started = Date.now();
            const clockStart = performance.now();
            const roundKey = method + ':' + (sessionId || args?.sessionId || '');
            const roundTrace = ['getSession','getStageDirection','getDialogueBubbles','getAssetPackPresentation','getStageMusicTracks','getStageBackgrounds'].includes(method)
                && roundLoadCounts.size < 64 && (roundLoadCounts.get(roundKey) || 0) < 3;
            if (roundTrace) {
                roundLoadCounts.set(roundKey, (roundLoadCounts.get(roundKey) || 0) + 1);
                roundLoadTrace.mark('rpc.begin', {method, sessionId:sessionId || args?.sessionId, channel:controlChannel ? 'mux' : 'http'});
            }
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
			if (viewRead) { payload.viewSync = 1; payload.resourceSync = 1; payload.helperWorldbookSync = 1; payload.openingWindow = 1; if (historyFromSessions.has(payload.sessionId)) payload.historyFrom = historyFromSessions.get(payload.sessionId); payload.viewCursor = viewRead.cursor; if (viewRead.receiptSync) payload.receiptSync = 1; }
			if (method === "getTavernHelperContext" && !payload.eventId && !payload.fullView) payload.openingWindow = 1;
			const requestBody = JSON.stringify(payload);
			if (trace) {
				try { trace.requestBytes = typeof TextEncoder === "function" ? new TextEncoder().encode(requestBody).length : requestBody.length; }
				catch (_error) { trace.requestBytes = requestBody.length; }
			}
			const request = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: requestBody,
                priority: rpcFetchPriority(method)
			};
			if (requestOptions && requestOptions.signal) request.signal = requestOptions.signal;
			// Release ownership even when a cancelled carrier never settles.
			const releaseViewRead = viewRead ? () => viewRead.release() : null;
			if (releaseViewRead && request.signal) {
				if (request.signal.aborted) releaseViewRead();
				else request.signal.addEventListener("abort", releaseViewRead, { once: true });
			}
			if (requestOptions && requestOptions.keepalive === true) request.keepalive = true;

            const httpRead = () => {
                if (roundTrace) roundLoadTrace.mark('rpc.dispatch', {method, sessionId:payload.sessionId, priority:request.priority});
                return fetchThroughRestart("/api/dsh-tavern/" + method, request).then(async function (response) {
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
            };
            // Projections retain their HTTP authority and origin-bound media lease checks.
            const responsePromise = controlChannel
                ? Promise.resolve().then(() => controlChannel.control(method, JSON.parse(requestBody), requestOptions && requestOptions.signal))
                : ['getAssetPackPresentation', 'getStagePhonePresentation'].includes(method)
                    ? presentationRequest(httpRead, request.signal) : httpRead();
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
					const detail = result?.error && typeof result.error === "object" ? result.error : null;
					const error = new Error(detail?.message || result?.error || "操作失败");
					if (detail) { error.code = detail.code; error.retryable = detail.retryable === true; error.mayHaveCharged = detail.mayHaveCharged === true; }
					if (typeof result?.errorCode === "string" && result.errorCode) error.code = result.errorCode;
					// the cycle ids / conflicting mods the player message names (UI-CONTRACT.md 错误).
					if (result?.errorDetails) error.details = result.errorDetails;
					throw error;
				}
                ;
                ;
				const accepted = viewRead ? viewRead.accept(result) : result;
                if (method === 'getSession' && accepted.view && payload.sessionId) {
                    ;
                    ;
                }
				if (viewRead) rememberHistoryWindow(payload.sessionId, accepted.view);
                if (accepted.contextWindow) return {...accepted,context:expandTavernOpeningWindow(accepted.contextWindow).tavernHelper};
                return accepted.view && accepted.view.historyWindow ? {...accepted,view:expandTavernOpeningWindow(accepted.view)} : accepted;
			}).catch(function (error) {
				checkCancelled();
				const newer = viewRead && viewRead.current();
				if (newer) return newer.view && newer.view.historyWindow ? {...newer,view:expandTavernOpeningWindow(newer.view)} : newer;
                if (trace) trace.failed = true;
				throw error;
			}).finally(function () {
				if (viewRead) viewRead.release();
				if (releaseViewRead && request.signal) request.signal.removeEventListener("abort", releaseViewRead);
				const elapsed = Date.now() - started;
                if (roundTrace) roundLoadTrace.mark('rpc.end', {method, sessionId:sessionId || args?.sessionId, durationMs:Math.round(performance.now() - clockStart)});
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
                    try { ctx.betterSidebar.openTab(seed, scope); return true; }
                    catch (error) {
                        // The session list can restore before DSH mounts its native
                        // sidebar seat. Retry this specific readiness error only.
                        if (!/sidebarRight: no session surface is mounted/.test(String(error.message || error)) || Date.now() >= deadline) throw error;
                        await new Promise(resolve => window.setTimeout(resolve, 100));
                        // 0.2.0 没有顶层 current，主会话只在 byId 行上以 mainView retain
                        // 表示；0.1.5 才用快照的 current。会话已切换则这次重试打开的 tab
                        // 不再属于它。
                        const snapshotNow = ctx.sessions.list.getSnapshot();
                        const main = Object.values(snapshotNow.byId || {}).find(function (row) { return row && row.retainedBy && (row.retainedBy.mainView ?? 0) > 0; });
                        if (main ? main.id !== scope.sessionId : snapshotNow.current !== scope.sessionId) return false;
                    }
                }
            })().catch(error => { tavernErrorHub.report("打开酒馆侧栏", error); return false; }).finally(() => tavernSidebarOpens.delete(key));
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
				activity: background ? { ...sync.activity, phase: background.status === "queued" ? "pending" : (background.status === "succeeded" ? "idle" : background.status), busy: background.busy === true, role: background.kind, operationId: background.operationId, updatedAt: background.updatedAt } : (sync.activity || null),
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
			// Next-turn preparation (worldbook prefilter, style reference) yields to any other task, so it never blocks the player.
			const busy = activity.busy === true && role !== "worldbook-filter" && role !== "style-reference";
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
        // The first window's start stays: later syncs keep every floor already on the page and
        // only append new rounds. A window that slid forward with each reply dropped floors the
        // page still showed, which then asked for older history again and again, down to the
        // first floor, turning every later view into the complete history.
        function rememberHistoryWindow(sessionId, view) {
            const from = view && view.historyWindow && view.historyWindow.from;
            if (sessionId && Number.isSafeInteger(from) && from > 0 && !historyFromSessions.has(sessionId)) historyFromSessions.set(sessionId, from);
        }
        // Older floors load because the player scrolls up to them, not because a layout change
        // brought one into view on its own.
        let lastScrollIntentAt = 0;
        const scrollIntentWaiters = new Set();
        const scrollKeys = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);
        // Hosts without a page (tests loading the bundle in a bare context) have no events.
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") for (const type of ["wheel", "touchmove", "keydown", "pointerdown"]) window.addEventListener(type, function (event) {
            // Typing in the composer is not scrolling.
            if (type === "keydown" && (!scrollKeys.has(event.key) || event.target && event.target.closest && event.target.closest("input, textarea, [contenteditable]:not([contenteditable=\"false\"])"))) return;
            lastScrollIntentAt = Date.now();
            for (const waiter of [...scrollIntentWaiters]) waiter();
        }, { capture: true, passive: true });
        function whenScrolledByPlayer(callback) {
            if (Date.now() - lastScrollIntentAt < 3000) { callback(); return function () {}; }
            const waiter = function () { scrollIntentWaiters.delete(waiter); callback(); };
            scrollIntentWaiters.add(waiter);
            return function () { scrollIntentWaiters.delete(waiter); };
        }
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
// @include-domain response-classification.js
// @include-domain chat-import-batch.js
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

// @include features/reply-observer.js

// @include features/speech.js

// @include features/music.js

// @include features/cast-stage.js

// @include ui/message-frame.js

// @include features/assistant-renderer.js

// @include features/card-list.js

// @include-domain update-status-controller.js
// @include features/sidebar.js

// @include features/scene-images.js
// @include modules/view-tabs.js
// @include features/settings.js
// @include modules/model-image-input.js

// @include features/prose-layout.js
// @include features/text-layout.js

// @include features/user-profile.js

// @include features/guide-library.js
// @include features/regex-library.js

// @include features/system-prompts.js
// @include features/card-personas.js

// @include features/resources-library.js

        // @include card-memory.js

// @include features/skills.js
// @include features/worldbook-inspector.js


// @include features/preset-library.js
// @include features/preset-hub.js


// @include features/worldbook-library.js

// @include features/worldbook-switcher.js

// @include features/transfer.js

// @include features/card-plugins.js

// @include features/card-library.js

// @include features/turn-history.js

// @include modules/conversation-settings.js
// @include features/conversation-header.js
// @include-domain play-interaction-flow.js
// @include features/play-interaction-panels.js
// @include modules/turn-rail.js
// @include features/play-controls.js

// @include features/request-context.js
// @include features/polish-compare.js

// @include stage-session-binding.js



		const inject = ["slots", "sessions", "workspaces", "layout", "connection", "conversation", "betterSidebar", "remote", "remote.commands", "remote.session", "tavernSessionSignals", "theme", "modelDirectories", "remote.settings"]; // host theme, shared model directory, settings writes (「能看图」)

		// @include tavern-presentation.js

		function apply(ctx) {
			// The profile switch page (dsh-profile-bridge) names itself by side from this flag.
			window.__dshTavernLoaded = true;
            installTavernPresentation(ctx);
            // The stage's registrations ride on this boot, where one throw fails the whole web boot (DSH treats a
            // throwing apply as a plugin load failure). A stage that cannot start is reported; the chat still starts.
            const stageEffect = (run, label) => ctx.effect(() => {
                try { return run(); } catch (error) { tavernErrorHub.report("舞台", error); }
            }, label);
            // Local debug capture delegates to the same session and stage routes as the UI.
            // No endpoint, cursor writer or replay protocol: live never installs this adapter.
            stageEffect(() => {
                // Debug launch fills this marker only in its isolated code copy; normal builds stay null.
                const captureSlot = /* dsh-debug-capture-slot */ null;
                if (!captureSlot) return;
                const navigate = async ({ sessionId, turn, para = 1 }) => {
                    if (!sessionId || !Number.isSafeInteger(turn) || turn < 1 || !Number.isSafeInteger(para) || para < 1) throw new Error('Debug capture target refused');
                    await createSessionCompat(ctx.sessions, ctx.get("uiWorkspace")).open(sessionId);
                    galEnter(sessionId, { turn, para });
                    // A round before the conversation's loaded window is not indexed, so the stage's navigation skipped it and the
                    // stage stayed on the previous round. Pull earlier pages through the backlog's 「加载更早」 route, then enter it.
                    const index = () => stageSessions.get(sessionId)?.getSnapshot().textIndex;
                    for (let wait = 0; wait < 200 && !index()?.size; wait++) await new Promise(resolve => setTimeout(resolve, 50));
                    if (index()?.size && !index().has(turn)) {
                        while (!index().has(turn) && stageSessions.owner.hasOlder(sessionId) && await stageSessions.owner.loadOlder(sessionId));
                        galEnter(sessionId, { turn, para });
                    }
                    const data = bubbleStore.get(sessionId);
                    return { loaded: Boolean(data), available: Boolean(data?.cardPath && data?.config?.enabled) };
                };
                window.forkCaptureNavigate = navigate;
                return () => { if (window.forkCaptureNavigate === navigate) delete window.forkCaptureNavigate; };
            }, 'dsh-tavern: debug capture navigation');
			ctx.effect(() => installFrameStorageBridge(window), "dsh-tavern: frame storage bridge");
			ctx.effect(() => forkStageAudio.install(window), "dsh-tavern: audio resume gesture");
			ctx.effect(() => installForkFonts(ctx), "dsh-tavern: layered local fonts");
			ctx.effect(function () { return tavernTextLayoutFeature.register(ctx); }, "dsh-tavern: text layout in appearance settings");
			ctx.effect(() => displayPreferences.start(), "dsh-tavern: global display preferences");
			ctx.effect(() => tavernInteractionDiagnostics.start(), "dsh-tavern: interaction diagnostics");
			ctx.effect(() => syncTavernSubagentCatalogs(ctx.sessions, ctx.tavernSessionSignals), "dsh-tavern: subagent catalog synchronization");
			ctx.effect(() => syncTavernCardAgentResources(ctx.sessions), "dsh-tavern: card Agent resource refresh");
			const slots = ctx.slots;
			if (slots === undefined) return;
			if (ctx.betterSidebar) stageEffect(() => registerTab(ctx.betterSidebar, {
				// the tab reads 「舞台设置」 (「Tavern 舞台」 was cut off).
				id: "dsh-tavern:bubbles", title: "舞台设置", order: 9, single: true,
				icon: function (size) { const s = size || 16; return React.createElement("svg", { width: s, height: s, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
					React.createElement("rect", { x: 1.5, y: 2.5, width: 4, height: 4, rx: 1.2, stroke: "currentColor", strokeWidth: 1.2 }),
					React.createElement("path", { d: "M7.5 3.5h6.5M7.5 6h4.5M1.5 10.5h13M1.5 13h9", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" })); },
				component: props => React.createElement(TavernStageTab, props)
			}), "dsh-tavern: dialogue bubbles tab");
			if (ctx.betterSidebar) ctx.effect(() => registerTab(ctx.betterSidebar, {
				id: "dsh-tavern:card-scripts", title: "卡片脚本", order: 10, single: true,
				component: props => React.createElement(CardScriptsTab, props)
			}), "dsh-tavern: card helper scripts tab");
            ctx.effect(() => slots.inject("conversation.view", () => slots.register({
                name: "conversation.view", id: "dsh-tavern:full-context", order: 11,
                label: "完整上下文", inject: sessionId => ({ contextSessionId: sessionId })
            }, FullRequestContextView)), "dsh-tavern: full request context");
            ctx.effect(() => slots.inject("conversation.view", () => slots.register({
                name: "conversation.view", id: "dsh-tavern:gallery", order: 12,
                label: "画廊", inject: sessionId => ({ gallerySessionId: sessionId })
            }, SceneImageGallery)), "dsh-tavern: picture gallery");
            ctx.effect(() => slots.inject("conversation.view", () => slots.register({
                name: "conversation.view", id: "dsh-tavern:polish", order: 13,
                label: "精修", inject: sessionId => ({ polishSessionId: sessionId })
            }, PolishComparisonView)), "dsh-tavern: polish comparison");
            // 顶部标签（对话/轨迹/完整上下文/画廊/精修）的设置：设置页读这份
            // 目录，标签行由 installTavernViewTabLayout 按保存的顺序显示或隐藏。
            ctx.effect(function () {
                const publish = function () { tavernViewTabCatalog.publish(tavernViewTabEntries(slots)); };
                const dispose = typeof slots.subscribe === "function" ? slots.subscribe("conversation.view", publish) : function () { };
                publish();
                return dispose;
            }, "dsh-tavern: view tab catalog");
            ctx.effect(function () { return installTavernViewTabLayout({ document: document, slots: slots }); }, "dsh-tavern: view tab layout");
			// Public browser API for third-party plugins (docs/plugin-api.md).
			tavernUiExtensions.service.ctx = ctx;
			tavernUiExtensions.attachHost(ctx);
			if (typeof ctx.provide === "function") ctx.provide("tavernUi", tavernUiExtensions.service);
			const signals = ctx.tavernSessionSignals;
			if (!signals || typeof signals.subscribe !== "function") throw new Error("DSH Tavern Remote 状态流不可用");
			tavernSessionSignals = signals;
			ctx.effect(function () { return function () { if (tavernSessionSignals === signals) tavernSessionSignals = undefined; }; }, "dsh-tavern: remote session signals");
			ctx.effect(function () { return tavernRuntimeGenerationMonitor.start(); }, "dsh-tavern: runtime generation monitor");
            // one input runtime per open native session, independent of React.
            stageEffect(() => stageSessions.start(ctx), "dsh-tavern: stage session inputs");
            stageEffect(() => galStageShortcut(ctx), "dsh-tavern: stage keyboard shortcut");
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
					"dsh-tavern:presets": "预设",
					"dsh-tavern:worldbooks": "世界书库",
					"dsh-tavern:resources": "剧本与素材库",
					"dsh-tavern:transfer": "导出与导入"
				};
				function visit(node) {
					if (!node) return;
					if (node.kind === "split") {
						(node.children || []).forEach(visit);
						return;
					}
					(node.tabs || []).forEach(function (tab) {
						// 系统提示词与长期偏好已并入“预设”标签页。
						if (tab.type === "dsh-tavern:boundary-prompts" || tab.type === "dsh-tavern:bypass-plans" || tab.type === "dsh-tavern:system-prompts" || tab.type === "dsh-tavern:user-profile") { retiredTabs.push(tab.id); return; }
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
					if (busy || stopped || !(draft.startsWith("<card_workspace>\n") || draft.startsWith("【当前 Tavern 资源工作区】")) || taskStart < 0) return;
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
			registerTavernPhonePanel(ctx);
			playControlsFeature.register({ ctx: ctx, slots: slots });
			assistantRendererFeature.register({ ctx: ctx, slots: slots });
			tavernReplyObserverFeature.register({ ctx: ctx, slots: slots });
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
					label: function () { return "DSH Tavern"; },
                    children: { "settings.tavern.appearance": { kind: "list", scope: "root" } }
				}, TavernSettingsSection); });
			}, "dsh-tavern: settings section");
			// 「能看图」 inside each pi-ai card of the upstream Models page (modules/model-image-input.js).
			ctx.effect(function () {
				return slots.inject("settings.models.provider-card", function () { return slots.register({ name: "settings.models.provider-card", key: MODEL_IMAGE_NS },
					function (props) { return React.createElement(ModelImageInput, Object.assign({}, props, { remote: ctx.remote })); }); });
			}, "dsh-tavern: model image input");
			ctx.effect(function () {
				return slots.inject("settings.section", function () { return slots.register({ name: "settings.section", id: "dsh-tavern-asset-gen", order: 112, label: function () { return "生图"; } },
					function () { return React.createElement("div", { className: "dsh-tavern-settings-section" }, React.createElement(packUi.GenPromptSettings, { call: engineRpc })); }); });
			}, "dsh-tavern: asset generation prompt settings section");
			ctx.effect(function () {
				return slots.inject("settings.section", function () { return slots.register({ name: "settings.section", id: "dsh-tavern-speech", order: 113, label: function () { return "台词朗读"; } },
					function () { return React.createElement("div", { className: "dsh-tavern-global-settings" }, React.createElement(TavernSpeechSettings, null)); }); });
			}, "dsh-tavern: speech settings");
			// 系统提示词与长期偏好在「预设」标签页（preset-hub.js）。

			presetLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			resourcesLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
            ctx.effect(() => registerTab(ctx.betterSidebar, { id: "dsh-tavern:guide-library", title: "Guide 库", order: 9, single: true, component: GuideLibraryTab }), "dsh-tavern: guide library");
			ctx.effect(() => registerTab(ctx.betterSidebar, { id: "dsh-tavern:skills", title: "Skill 库", order: 8, single: true, component: props => React.createElement(TavernSkillsTab, { sessionId: props.scope.sessionId }) }), "dsh-tavern: Skill library");
            ctx.effect(() => registerTab(ctx.betterSidebar, { id: "dsh-tavern:card-memory", title: "改卡记忆", order: 9, single: true, component: props => React.createElement(TavernCardMemoryTab, { sessionId: props.scope.sessionId }) }), "dsh-tavern: card memory");
            ctx.effect(() => registerTab(ctx.betterSidebar, { id: "dsh-tavern:regex-library", title: "正则库", order: 9, single: true, component: RegexLibraryTab }), "dsh-tavern: regex library");
			worldBookLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			ctx.effect(function () {
				return worldBookSwitcherFeature.register({
					ctx: ctx,
					openLibrary: function (source, sessionId) {
						return openTavernSidebarTab(ctx, { type: "dsh-tavern:worldbooks", meta: source ? { worldBookSource: source } : null }, { sessionId: sessionId });
					}
				});
			}, "dsh-tavern: worldbook switcher panel");
cardLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			transferFeature.register({ ctx: ctx });
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
		exports.createStepFoldControls = createStepFoldControls;
		exports.createSupersededErrorProjection = createSupersededErrorProjection;
		exports.inject = inject;
		exports.buildOpeningPreviewDocument = buildOpeningPreviewDocument;
		exports.buildTavernFrameDocument = buildTavernFrameDocument;
		exports.openingPreviewSelection = openingPreviewSelection;
		exports.tavernReplyReveal = tavernReplyReveal;
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
		exports.createSessionCompat = createSessionCompat;
		exports.tavernMainSessionId = tavernMainSessionId;
		exports.sessionListAdapters = sessionListAdapters;
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
		exports.latestTavernUserTurn = latestTavernUserTurn;
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
		// @include modules/reply-reveal.js
		// @include modules/assistant-visibility.js
		installTavernAssistantVisibilityPatch(require);
		// @include modules/host-session-patch.js
		// The page's session history only: the server's headless card runtime has none, and
		// would report the missing patch for the whole profile.
		if (!window.__dshTavernHeadless) installTavernSessionHistoryPatch(require, rpc);
		return module.exports;
	})
});
