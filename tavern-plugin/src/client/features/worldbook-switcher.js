// 世界书快捷面板：顶栏世界书按钮下方弹出，只做两件高频小事——换书、开关条目。
// 编辑、导入导出、绑定人物卡都留在右侧栏的世界书库，面板里的「完整」直接跳过去。
const WBSW_STORAGE_KEY = "dsh-tavern-worldbook-switcher";

function readWbSwitcherSelected() {
	try {
		const saved = JSON.parse(window.localStorage.getItem(WBSW_STORAGE_KEY) || "null");
		return saved && typeof saved.selectedKey === "string" ? saved.selectedKey : "";
	} catch (_) { return ""; }
}

function writeWbSwitcherSelected(key) {
	try { window.localStorage.setItem(WBSW_STORAGE_KEY, JSON.stringify({ selectedKey: String(key || "") })); } catch (_) {}
}

function wbSourceKey(source) {
	if (!source || typeof source !== "object") return "";
	return source.kind === "card" ? "card:" + String(source.cardPath || "") : "standalone:" + String(source.path || "");
}

function wbRowLabel(entry) {
	return String(entry && (entry.title || entry.comment) || "").trim() || "未命名条目";
}

// 下拉分组：全局生效的书最常用，放最前；其余独立书与人物卡内置书各成一组。
function wbCatalogGroups(catalog) {
	const byName = (left, right) => String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN");
	const standalone = (catalog && catalog.standalone || []).slice().sort(byName);
	const embedded = (catalog && catalog.embedded || []).slice().sort(byName);
	return [
		{ label: "全局生效", rows: standalone.filter(row => row.globalEnabled === true) },
		{ label: "其他世界书", rows: standalone.filter(row => row.globalEnabled !== true) },
		{ label: "人物卡内置", rows: embedded }
	].filter(group => group.rows.length > 0);
}

function wbPickDefault(rows, selectedKey) {
	return rows.find(row => row.key === selectedKey) || rows.find(row => row.globalEnabled === true) || rows[0] || null;
}

function createWorldBookSwitcherFeatureModule() {
	let switcherState = { open: false, anchor: null, rect: null, sessionId: "" };
	const switcherListeners = new Set();

	function publishSwitcher(next) {
		switcherState = Object.assign({}, switcherState, next);
		for (const listener of Array.from(switcherListeners)) {
			try { listener(); } catch (_) {}
		}
	}

	function subscribeSwitcher(listener) {
		switcherListeners.add(listener);
		return function () { switcherListeners.delete(listener); };
	}

	function snapshotSwitcher() {
		return switcherState;
	}

	function openWorldBookSwitcher(anchor, sessionId) {
		const element = anchor && anchor.nodeType === 1 ? anchor : null;
		if (switcherState.open && switcherState.anchor === element) {
			publishSwitcher({ open: false, anchor: null, rect: null });
			return false;
		}
		let rect = null;
		if (element) {
			const box = element.getBoundingClientRect();
			rect = { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
		}
		publishSwitcher({ open: true, anchor: element, rect: rect, sessionId: String(sessionId || "") });
		return true;
	}

	function closeWorldBookSwitcher() {
		if (!switcherState.open) return;
		publishSwitcher({ open: false, anchor: null, rect: null });
	}

	async function loadWbCatalog(sessionId) {
		const result = await rpcWithTimeout("listWorldBooks", {}, sessionId);
		const tag = function (row, source) { return Object.assign({}, row, { key: wbSourceKey(source), source: source }); };
		const standalone = (result && Array.isArray(result.standalone) ? result.standalone : []).map(row => tag(row, { kind: "standalone", path: row.path }));
		const embedded = (result && Array.isArray(result.embedded) ? result.embedded : []).map(row => tag(row, { kind: "card", cardPath: row.cardPath }));
		return { standalone: standalone, embedded: embedded, all: standalone.concat(embedded) };
	}

	// the one shared switch; the row click stays the big target.
	function WbSwitch(props) {
		const h = React.createElement;
		return h("span", { className: "dsh-tavern-wbsw-switch", onClick: function (event) { event.stopPropagation(); } },
			h(Switch, { label: props.label || props.title, title: props.title, checked: Boolean(props.checked), disabled: Boolean(props.disabled), onChange: function (next) { props.onChange(next); } }));
	}

	function WorldBookSwitcherPanel(props) {
		const h = React.createElement;
		const state = props.state;
		const sessionId = state.sessionId;
		const [catalog, setCatalog] = React.useState(null);
		const [book, setBook] = React.useState(null);
		const [loading, setLoading] = React.useState(true);
		const [error, setError] = React.useState("");
		const [query, setQuery] = React.useState("");
		const [geometry, setGeometry] = React.useState(null);
		const rootRef = React.useRef(null);

		async function selectRow(row) {
			if (!row) return;
			setError("");
			try {
				const record = await rpcWithTimeout("getWorldBook", { source: row.source }, sessionId);
				setBook(Object.assign({}, record, { key: row.key, source: row.source }));
				setQuery("");
				writeWbSwitcherSelected(row.key);
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		React.useEffect(function () {
			let alive = true;
			setLoading(true);
			loadWbCatalog(sessionId).then(async function (next) {
				if (!alive) return;
				setCatalog(next);
				const row = wbPickDefault(next.all, readWbSwitcherSelected());
				if (row) await selectRow(row);
				if (alive) setLoading(false);
			}).catch(function (err) {
				if (!alive) return;
				setError(String(err && err.message || err));
				setLoading(false);
			});
			return function () { alive = false; };
		}, [sessionId]);

		// 贴在按钮下方，水平居中于按钮，整块不越出视口；窄屏铺满宽度。
		React.useLayoutEffect(function () {
			const rect = state.rect;
			const vw = window.innerWidth || 1280;
			const vh = window.innerHeight || 720;
			const width = Math.min(320, vw - 16);
			const top = Math.max(8, rect ? rect.bottom + 8 : 72);
			const height = Math.max(240, Math.min(520, vh - top - 8));
			const center = rect ? rect.left + rect.width / 2 : vw / 2;
			const left = Math.max(8, Math.min(vw - width - 8, Math.round(center - width / 2)));
			setGeometry({ left: left, top: top, width: width, height: height });
		}, [state.rect]);

		React.useEffect(function () {
			function onPointer(event) {
				const root = rootRef.current;
				if (!root || root.contains(event.target)) return;
				if (state.anchor && state.anchor.contains(event.target)) return;
				// the book menu (InlineField) opens in the shared popup layer on <body>; a pick there is inside.
				if (event.target && event.target.closest && event.target.closest(".fork-inline-layer")) return;
				closeWorldBookSwitcher();
			}
			function onKey(event) { if (event.key === "Escape") closeWorldBookSwitcher(); }
			document.addEventListener("pointerdown", onPointer, true);
			document.addEventListener("keydown", onKey);
			return function () {
				document.removeEventListener("pointerdown", onPointer, true);
				document.removeEventListener("keydown", onKey);
			};
		}, [state.anchor]);

		async function toggleEntry(entry, next) {
			if (!book) return;
			try {
				const record = await rpc("updateWorldBook", { source: book.source, update: { operations: [{ op: "update", ref: entry.ref, patch: { enabled: next } }] } }, sessionId);
				setBook(Object.assign({}, record, { key: book.key, source: book.source }));
				notifyTavernDataChanged(["worldbooks"], "worldbook-switcher");
			} catch (err) {
				setError(String(err && err.message || err));
			}
		}

		function openLibrary() {
			closeWorldBookSwitcher();
			props.openLibrary(book ? book.source : null, sessionId);
		}

		const allEntries = book && book.view && Array.isArray(book.view.entries) ? book.view.entries : [];
		const needle = query.trim().toLocaleLowerCase();
		const entries = needle ? allEntries.filter(function (entry) {
			return [entry.title, entry.comment, entry.content].concat(entry.primaryKeys || [], entry.secondaryKeys || [])
				.some(value => String(value || "").toLocaleLowerCase().includes(needle));
		}) : allEntries;
		const groups = wbCatalogGroups(catalog);

		return h("div", {
			ref: rootRef,
			className: "dsh-tavern-wbsw-shell",
			role: "dialog", "aria-label": "世界书快捷面板",
			style: geometry
				? { left: geometry.left + "px", top: geometry.top + "px", width: geometry.width + "px", height: geometry.height + "px" }
				: { visibility: "hidden" }
		},
			h("div", { className: "dsh-tavern-wbsw-head" },
				// the shared inline menu, its groups are 独立 / the card's own books.
				h(InlineField, {
					kind: "menu", className: "dsh-tavern-wbsw-select", label: "选择世界书", hideLabel: true, value: book ? book.key : "", disabled: groups.length === 0,
					options: groups.length === 0 ? [{ value: "", label: "暂无世界书" }] : groups.flatMap(function (group) {
						return group.rows.map(row => ({ value: row.key, label: row.name + (row.cardName ? " · " + row.cardName : ""), group: group.label }));
					}),
					onCommit: function (value) {
						const row = (catalog ? catalog.all : []).find(item => item.key === value);
						if (row) void selectRow(row);
					}
				}),
				h("button", { type: "button", className: "dsh-tavern-wbsw-btn", title: "在右侧栏打开完整世界书库", onClick: openLibrary }, "完整")),
			h("div", { className: "dsh-tavern-wbsw-list" },
				// the shared loading and empty states.
				loading ? h(PanelLoading, { label: "正在读取世界书…" }) : null,
				error ? h("div", { className: "dsh-tavern-wbsw-error", role: "alert" }, error) : null,
				!loading && !book && !error ? h(EmptyState, { compact: true, text: "还没有世界书。点「完整」进入世界书库导入。" }) : null,
				!loading && book && entries.length === 0 ? (needle ? h(EmptyState, { compact: true, plain: true, query: query.trim(), onClear: function () { setQuery(""); } }) : h(EmptyState, { compact: true, noun: "条目" })) : null,
				entries.map(function (entry) {
					const enabled = entry.enabled !== false;
					return h("div", { key: entry.ref, className: "dsh-tavern-wbsw-row" + (enabled ? "" : " is-disabled"), onClick: function () { void toggleEntry(entry, !enabled); } },
						h(WbSwitch, { checked: enabled, title: enabled ? "停用条目" : "启用条目", onChange: function (next) { void toggleEntry(entry, next); } }),
						h("span", { className: "dsh-tavern-wbsw-row-name", title: wbRowLabel(entry) }, wbRowLabel(entry)));
				})),
			allEntries.length > 8 ? h("div", { className: "dsh-tavern-wbsw-footer" },
				h(SearchBox, { bare: true, inputClassName: "dsh-tavern-wbsw-search", value: query, placeholder: "搜索条目…", label: "搜索条目", onChange: function (value) { setQuery(value); } })) : null);
	}

	function WorldBookSwitcherLayer(props) {
		const state = React.useSyncExternalStore(subscribeSwitcher, snapshotSwitcher, snapshotSwitcher);
		if (!state.open) return null;
		return React.createElement(WorldBookSwitcherPanel, { key: state.sessionId, state: state, openLibrary: props.openLibrary });
	}

	function register(input) {
		const container = document.createElement("div");
		container.className = "dsh-tavern-wbsw-portal";
		document.body.append(container);
		const root = require("react-dom/client").createRoot(container);
		root.render(React.createElement(WorldBookSwitcherLayer, { openLibrary: input.openLibrary }));
		return function () {
			closeWorldBookSwitcher();
			try { root.unmount(); } catch (_) {}
			container.remove();
		};
	}

	return Object.freeze({
		register: register,
		open: openWorldBookSwitcher,
		close: closeWorldBookSwitcher,
		snapshot: snapshotSwitcher,
		catalogGroups: wbCatalogGroups,
		pickDefault: wbPickDefault
	});
}

const worldBookSwitcherFeature = createWorldBookSwitcherFeatureModule();
