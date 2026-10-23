// 舞台素材: the asset library's editor (docs/design/asset-library.md「编辑界面」). The library panel lists every pack
// with its 全局 / 本卡 / 关闭 state; a pack opens one window (entries on the left, the chosen entry on the right); 舞台设置
// › 素材包 lists this card's packs. Every write goes to the host's store (CAS revisions); nothing is kept on the page.
const TAVERN_ASSET_KINDS = Object.freeze({ backgrounds: "背景", music: "音乐" });
const TAVERN_ASSET_KIND_ORDER = Object.freeze(["backgrounds", "music"]);
const TAVERN_ASSET_EVENT = "dsh-tavern-asset-packs-changed";
const TAVERN_PACK_STATES = Object.freeze({ global: "全局", card: "本卡", off: "关闭" });
const TAVERN_PACK_STATE_ORDER = Object.freeze(["global", "card", "off"]);
const TAVERN_PACK_STATE_TITLES = Object.freeze({ off: "关闭：不参与演出", card: "本卡：只在这张卡使用", global: "全局：所有卡都可使用" });
const TAVERN_ENTRY_LAMPS = Object.freeze({ constant: "蓝灯", keyword: "绿灯", off: "关闭" });
const TAVERN_ASSET_HELP = Object.freeze({
	lamp: "同 SillyTavern 世界书：蓝灯始终可选，绿灯在名称或触发词命中时才选。关闭：这一条不再用于舞台。",
	lampBackground: "背景目前只用蓝灯。",
	triggers: "名称本身也算触发词。不填，或填 3–6 个正文里真会出现的短词。",
	notes: { backgrounds: "会和名称一起发给导演，用来判断这一幕用哪个背景。只写适用情景，最多 300 字。", music: "会和名称一起发给导演，用来判断什么时候放这首曲子。只写适用情景，最多 300 字。" },
	remark: "只给你和改卡 AI 看，导演看不到",
	usage: "这首曲子的用途笔记，不发给导演。",
	volume: "这条素材在游戏里播放时的响度，试听也按它播放。",
	packs: "这张卡用到的素材包。「管理」给这张卡开启或关闭其它素材包。"
});
const TAVERN_ASSET_ACCEPT = Object.freeze({ backgrounds: "image/png,image/webp,image/jpeg", music: "audio/*,.mp3,.ogg,.wav,.m4a,.flac" });
const TAVERN_ASSET_GLYPHS = Object.freeze({
	back: "M10 3.5 5.5 8l4.5 4.5", close: "M4 4l8 8M12 4l-8 8", more: "M3.5 8h.01M8 8h.01M12.5 8h.01", plus: "M8 3v10M3 8h10",
	upload: "M8 10.5V3M5 6l3-3 3 3M3 10.5v2.5h10v-2.5", search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3 13.5 13.5",
	filter: "M2.5 4h11M4.5 8h7M6.5 12h3", sort: "M4.5 2.5v11M2.5 11.5l2 2 2-2M8.5 4h5M8.5 8h3.5M8.5 12h2", check: "M3.5 8.5l3 3 6-7",
	chevDown: "M5 6.5 8 9.5l3-3", chevRight: "M6 4l4 4-4 4", warning: "M8 2.5 14 13H2zM8 6.5v3M8 11.4v.1",
	voice: "M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.2 3.8a6 6 0 0 1 0 8.4", voiceOff: "M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 6l3 4M13.5 6l-3 4",
	backgrounds: "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3", music: "M6 12.5V4l7-1.5V11M6 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM13 11a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
	tray: "M2.5 9.5h3l1 2h3l1-2h3M2.5 9.5 4 3.5h8l1.5 6v3h-11z"
});
function TavernAssetGlyph(props) {
	return React.createElement("svg", { className: "dsh-tavern-asset-glyph", width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
		React.createElement("path", { d: TAVERN_ASSET_GLYPHS[props.name], stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" }));
}
function TavernAssetIconButton(props) {
	const { icon, label, className, danger, ...rest } = props;
	return React.createElement("button", { type: "button", className: "dsh-tavern-asset-icon" + (danger ? " is-danger" : "") + (className ? " " + className : ""), "aria-label": label, title: label, ...rest },
		React.createElement(TavernAssetGlyph, { name: icon }));
}
// 「?」 beside a name: the one sentence of explanation, in its tooltip.
function TavernAssetHelp(props) {
	return React.createElement("span", { className: "dsh-tavern-switch-help", role: "img", "aria-label": props.label + " 说明：" + props.text, title: props.text }, "?");
}

// The one error → player sentence of the editor: a known code says what happened, a host message that is already
// plain Chinese keeps its reason, anything else (English, a bare code) is the fallback. The raw text goes to the console.
const TAVERN_ASSET_ERRORS = Object.freeze({ REVISION_CONFLICT: "内容已被修改，请重新载入", LIMIT_EXCEEDED: "素材超过大小或数量限制，未能保存",
	ASSET_UNAVAILABLE: "素材不可用，请重新载入", RECOVERY_REQUIRED: "素材库需要恢复，请重启后再试", DUPLICATE_ID: "素材已存在，请重新载入",
	TRIGGER_LINT: "触发词不符合要求，请填写能在正文中出现的简短词语，去掉重复或过于笼统的词后再保存" });
function tavernAssetErrorText(error, fallback) {
	if (!error) return "";
	const code = String(error.code || ""), message = String(error.message || error);
	if (code || message) console.warn("dsh-tavern:", [code, message].filter(Boolean).join(": "));
	if (TAVERN_ASSET_ERRORS[code]) return TAVERN_ASSET_ERRORS[code];
	return /\p{Script=Han}/u.test(message) && !/[A-Za-z_]{4,}/.test(message.replace(/MP3|OGG|WAV|M4A|FLAC|PNG|WebP|JPEG|BGM/g, "")) ? message : fallback || "出错了，请稍后再试";
}
// A rejected trigger word: the store's first finding, minus its internal references.
function tavernTriggerLintText(error) {
	const match = /触发词「([^」]*)」违反 \S+：([^。]*)。正例：([^。]*)。/.exec(String(error && error.message || ""));
	return match ? "「" + match[1] + "」：" + match[2] + "。例如：" + match[3] : TAVERN_ASSET_ERRORS.TRIGGER_LINT;
}
const tavernAssetChars = value => Array.from(String(value || "")).length;
const tavernAssetsChanged = () => window.dispatchEvent(new CustomEvent(TAVERN_ASSET_EVENT));
const tavernEntryLamp = asset => asset.enabled === false ? "off" : asset.recall && asset.recall.mode === "constant" ? "constant" : "keyword";
const tavernSetEntryLamp = (asset, mode) => mode === "off" ? { ...asset, enabled: false } : { ...asset, enabled: true, recall: { ...asset.recall, mode } };
const tavernPackItems = (pack, kind) => (pack && pack.manifest && pack.manifest.assets || []).filter(asset => asset.kind === kind);
const tavernPackCount = (pack, kind) => kind ? tavernPackItems(pack, kind).length : (pack && pack.manifest && pack.manifest.assets || []).filter(asset => Object.hasOwn(TAVERN_ASSET_KINDS, asset.kind)).length;
const tavernAssetFileStem = name => Array.from(String(name || "").replace(/\.[^.]+$/, "").trim()).slice(0, 120).join("") || "未命名";

// Big files go up as a raw body (the host's upload route) and wait on disk for the call that uses them.
async function tavernAssetUpload(file) {
	const response = await fetch("/api/dsh-tavern/card-upload", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
	let reply = null;
	try { reply = await response.json(); } catch (_error) {}
	if (!reply || !reply.ok) throw new Error(reply && reply.error || "上传失败");
	return { uploadId: reply.uploadId, name: tavernAssetFileStem(file.name) };
}

// Shared media URLs: one host lease per pack picture or track, reused by every view of it.
const tavernPackMedia = new Map();
function tavernPackMediaUrl(packId, hash, fresh) {
	const key = packId + "\n" + hash;
	if (fresh) tavernPackMedia.delete(key);
	if (!tavernPackMedia.has(key)) {
		const pending = rpc("previewAssetPackMedia", { packId, hash }).then(result => result.url);
		pending.catch(() => { if (tavernPackMedia.get(key) === pending) tavernPackMedia.delete(key); });
		tavernPackMedia.set(key, pending);
	}
	return tavernPackMedia.get(key);
}
// A picture fades in once decoded; until then its box keeps its size, empty. A failed lease is asked for once more.
function TavernPackPicture(props) {
	const [url, setUrl] = React.useState(""), [attempt, setAttempt] = React.useState(0), [failed, setFailed] = React.useState(false), [shown, setShown] = React.useState(false);
	React.useEffect(() => {
		let live = true;
		setFailed(false);
		if (props.hash) tavernPackMediaUrl(props.packId, props.hash, attempt > 0).then(value => { if (live) setUrl(value); }, () => { if (live) setFailed(true); });
		return () => { live = false; };
	}, [props.packId, props.hash, attempt]);
	const onError = () => { if (attempt < 1) { setUrl(""); setAttempt(attempt + 1); } else setFailed(true); };
	return React.createElement("span", { className: props.className, "data-empty": !url || undefined, "data-failed": failed || undefined, title: failed ? "图片载入失败" : undefined },
		url && !failed ? React.createElement("img", { src: url, alt: "", decoding: "async", loading: "lazy", "data-shown": shown || undefined, onLoad: () => setShown(true), onError }) : null);
}

// Things shown only after 150 ms (a wait that ends sooner never flashes).
function useTavernAssetLater(ms = 150) {
	const [late, setLate] = React.useState(false);
	React.useEffect(() => { const timer = setTimeout(() => setLate(true), ms); return () => clearTimeout(timer); }, []);
	return late;
}
// A wait shaped like the list it stands for: rows (name · state) fading in after 150 ms.
function TavernAssetLoading(props) {
	const late = useTavernAssetLater();
	return React.createElement("div", { className: "dsh-tavern-asset-loading", role: "status", "aria-label": "正在载入" },
		late ? Array.from({ length: props.count || 5 }, (_, index) => React.createElement("span", { key: index, className: "dsh-tavern-asset-skeleton" + (props.lead ? " has-lead" : "") }, React.createElement("i"), React.createElement("b"))) : null);
}
// The one empty state: an icon in a soft circle and one short line; with a search or filter, the way to clear it.
function TavernAssetEmpty(props) {
	const h = React.createElement, filtered = !!(props.query && props.query.trim() || props.filter);
	const text = props.text || (props.query && props.query.trim() ? "没有找到「" + props.query.trim() + "」" : props.filter ? "没有「" + props.filter + "」" + props.noun : "还没有" + props.noun);
	return h("div", { className: "dsh-tavern-asset-empty" + (props.compact ? " is-compact" : "") },
		h("span", { className: "dsh-tavern-asset-empty-icon" }, h(TavernAssetGlyph, { name: props.query && props.query.trim() ? "search" : props.filter ? "filter" : props.icon || "tray" })),
		h("p", null, text),
		filtered && props.onClear ? h("button", { type: "button", className: "dsh-tavern-asset-link", onClick: props.onClear }, props.query && props.query.trim() ? "清除搜索" : "清除筛选") : props.action || null);
}
function TavernAssetAlert(props) {
	if (!props.error) return null;
	return React.createElement("p", { role: "alert", className: "dsh-tavern-asset-alert" }, React.createElement(TavernAssetGlyph, { name: "warning" }), React.createElement("span", null, props.error),
		props.onReload ? React.createElement("button", { type: "button", className: "dsh-tavern-asset-link", onClick: props.onReload }, "重新载入") : null);
}

// Layers (windows, menus) float above everything in one portal; Esc and a press outside close only the topmost.
const tavernAssetLayers = [];
function useTavernAssetLayer(open, nodes, close) {
	const entry = React.useRef(null);
	entry.current = { nodes, close };
	React.useEffect(() => {
		if (!open) return undefined;
		const layer = entry;
		tavernAssetLayers.push(layer);
		const outside = event => {
			if (tavernAssetLayers[tavernAssetLayers.length - 1] !== layer) return;
			if (layer.current.nodes().some(node => node && node.contains(event.target))) return;
			layer.current.close("outside");
		};
		document.addEventListener("pointerdown", outside, true);
		return () => { document.removeEventListener("pointerdown", outside, true); const at = tavernAssetLayers.indexOf(layer); if (at >= 0) tavernAssetLayers.splice(at, 1); };
	}, [open]);
}
// A menu anchored to its trigger: under it, or above when the window has more room there, inside the window edges.
function TavernAssetMenu(props) {
	const h = React.createElement, [open, setOpen] = React.useState(false), [place, setPlace] = React.useState(null), root = React.useRef(null), menu = React.useRef(null);
	const close = refocus => { setOpen(false); setPlace(null); if (refocus) { const button = root.current && root.current.querySelector("button"); if (button) button.focus(); } };
	useTavernAssetLayer(open, () => [root.current, menu.current], reason => close(reason === "escape"));
	React.useLayoutEffect(() => {
		if (!open) return undefined;
		const update = () => {
			const anchor = root.current && root.current.getBoundingClientRect(), node = menu.current;
			if (!anchor || !node) return;
			const gap = 4, edge = 8, height = node.offsetHeight, width = node.offsetWidth, below = window.innerHeight - anchor.bottom - gap - edge, up = height > below && anchor.top > below;
			const top = up ? Math.max(edge, anchor.top - gap - height) : Math.max(edge, Math.min(anchor.bottom + gap, window.innerHeight - edge - height));
			const left = Math.max(edge, Math.min(props.alignLeft ? anchor.left : anchor.right - width, window.innerWidth - edge - width));
			setPlace(current => current && current.top === Math.round(top) && current.left === Math.round(left) ? current : { top: Math.round(top), left: Math.round(left) });
		};
		update();
		window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
		return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
	}, [open]);
	React.useEffect(() => {
		if (!open || !place || !menu.current) return;
		const first = menu.current.querySelector('[aria-checked="true"]') || menu.current.querySelector("button:not(:disabled), input");
		if (first) first.focus({ preventScroll: true });
	}, [open, !!place]);
	const keys = event => {
		if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
		if (event.key === "Tab") { close(false); return; }
		const items = Array.from(menu.current.querySelectorAll("button:not(:disabled), label")), at = items.indexOf(document.activeElement), n = items.length;
		const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[event.key];
		if (next === undefined || !n) return;
		event.preventDefault(); items[(next + n) % n].focus();
	};
	const toggle = () => { if (open) close(false); else setOpen(true); };
	return h("span", { ref: root, className: "dsh-tavern-asset-menu-anchor" + (props.className ? " " + props.className : ""), onClick: props.stopClicks ? event => event.stopPropagation() : undefined },
		props.trigger({ open, toggle }),
		open ? require("react-dom").createPortal(h("div", { ref: menu, className: "dsh-tavern-asset-menu", role: "menu", "aria-label": props.label, onKeyDown: keys,
			style: place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: "hidden" } }, props.content(() => close(true))), document.body) : null);
}
function TavernAssetMenuItem(props) {
	const h = React.createElement;
	return h("button", { type: "button", role: props.checked === undefined ? "menuitem" : "menuitemradio", "aria-checked": props.checked, className: "dsh-tavern-asset-menu-item" + (props.danger ? " is-danger" : ""),
		disabled: props.disabled, onClick: props.onClick },
		props.lamp ? h("span", { className: "dsh-tavern-asset-lamp", "data-mode": props.lamp }) : null,
		props.state ? h("span", { className: "dsh-tavern-asset-state-dot", "data-state": props.state }) : null,
		props.icon ? h(TavernAssetGlyph, { name: props.icon }) : null,
		h("span", { className: "dsh-tavern-asset-menu-text" }, props.children),
		props.checked ? h(TavernAssetGlyph, { name: "check" }) : null);
}
// A window: opaque, its focus kept inside, Esc / ✕ close it (never while busy) and focus returns where it came from.
function TavernAssetModal(props) {
	const h = React.createElement, ref = React.useRef(null);
	const close = () => { if (!props.busy) props.onClose(); };
	useTavernAssetLayer(true, () => [ref.current], close);
	React.useEffect(() => {
		const previous = document.activeElement;
		const target = props.focusDialog ? ref.current : ref.current && (ref.current.querySelector("[data-autofocus]") || ref.current.querySelector("button, input, textarea"));
		if (target) target.focus({ preventScroll: true });
		return () => { if (previous && previous.isConnected && previous.focus) previous.focus({ preventScroll: true }); };
	}, []);
	const keys = event => {
		if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); return; }
		if (event.key !== "Tab") return;
		const nodes = Array.from(ref.current.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']")).filter(node => node.offsetParent !== null);
		if (!nodes.length) return;
		const first = nodes[0], last = nodes[nodes.length - 1];
		if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	};
	return require("react-dom").createPortal(h("div", { className: "dsh-tavern-asset-scrim" },
		h("section", { ref, className: "dsh-tavern-asset-modal" + (props.className ? " " + props.className : ""), role: "dialog", "aria-modal": "true", "aria-label": props.label, tabIndex: props.focusDialog ? -1 : undefined, onKeyDown: keys },
			props.head || h("header", { className: "dsh-tavern-asset-modal-head" }, h("h2", null, props.label), h(TavernAssetIconButton, { icon: "close", label: "关闭", disabled: props.busy, onClick: close })),
			props.children, props.foot || null)), document.body);
}
// A question before a destructive step: one sentence of consequence, 取消 and the verb.
function TavernAssetConfirm(props) {
	const h = React.createElement, [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
	async function confirm() {
		setBusy(true); setError("");
		try { await props.onConfirm(); props.onClose(); }
		catch (err) { setError(tavernAssetErrorText(err)); setBusy(false); }
	}
	return h(TavernAssetModal, { label: props.title, busy, onClose: props.onClose, className: "is-confirm" },
		h("p", { className: "dsh-tavern-asset-confirm-body" }, props.body), h(TavernAssetAlert, { error }),
		h("div", { className: "dsh-tavern-asset-actions" },
			h("button", { type: "button", className: "dsh-tavern-asset-text-button", "data-autofocus": true, disabled: busy, onClick: props.onClose }, "取消"),
			h("button", { type: "button", className: "dsh-tavern-asset-primary" + (props.danger ? " is-danger" : ""), disabled: busy, onClick: confirm }, busy ? "正在删除…" : props.confirmLabel)));
}

// ---------- Packs: the list, their state and the shared rows ----------
// Every pack (a broken one is { packId, error }); any editor's write reloads it.
function useTavernAssetPacks() {
	const [packs, setPacks] = React.useState(null), [error, setError] = React.useState(""), ticket = React.useRef(0);
	const reload = React.useCallback(async () => {
		const mine = ++ticket.current;
		setError("");
		try { const result = await rpc("listAssetPacks", {}); if (mine === ticket.current) setPacks(result.packs); }
		catch (err) { if (mine === ticket.current) setError(tavernAssetErrorText(err)); }
	}, []);
	React.useEffect(() => {
		void reload();
		window.addEventListener(TAVERN_ASSET_EVENT, reload);
		return () => { ticket.current++; window.removeEventListener(TAVERN_ASSET_EVENT, reload); };
	}, [reload]);
	return { packs, error, reload };
}
// One pack's state seen from a card: 全局 (every card), 本卡 (this card's binding), 关闭. Without a card: 全局 / 关闭.
// A change applies at once, without a confirmation.
function useTavernPackScope(path) {
	const [value, setValue] = React.useState(null), [pending, setPending] = React.useState({}), [error, setError] = React.useState("");
	React.useEffect(() => {
		let live = true;
		const load = () => rpc("getCardAssetPacks", { path: path || "" }).then(result => { if (live) setValue(result); }, err => { if (live) setError(tavernAssetErrorText(err)); });
		load();
		window.addEventListener(TAVERN_ASSET_EVENT, load);
		return () => { live = false; window.removeEventListener(TAVERN_ASSET_EVENT, load); };
	}, [path]);
	const bound = value ? value.boundPackIds : [], global = value ? value.globalEnabledPackIds : [];
	const stateOf = id => global.includes(id) ? "global" : bound.includes(id) ? "card" : "off";
	const options = (id, installed) => !installed ? ["off"] : path ? TAVERN_PACK_STATE_ORDER : TAVERN_PACK_STATE_ORDER.filter(state => state !== "card");
	async function set(id, next) {
		if (stateOf(id) === next) return;
		setPending(current => ({ ...current, [id]: true })); setError("");
		try { setValue(await rpc("setAssetPackState", { path: path || "", packId: id, state: next })); tavernAssetsChanged(); }
		catch (err) { setError(tavernAssetErrorText(err)); }
		finally { setPending(current => { const rest = { ...current }; delete rest[id]; return rest; }); }
	}
	return { card: !!path, ready: !!value, bound, global, stateOf, options, set, pending, error };
}
// The state chip: small text only, 全局 blue / 本卡 green / 关闭 grey and hollow; its menu carries the lamps and ✓.
function TavernPackStateTag(props) {
	const h = React.createElement, scope = props.scope, state = scope.stateOf(props.id), busy = !!scope.pending[props.id];
	return h(TavernAssetMenu, { label: props.name + " 使用状态", className: "dsh-tavern-pack-state-anchor", stopClicks: true,
		trigger: menu => h("button", { type: "button", className: "dsh-tavern-pack-state", "data-state": state, "aria-haspopup": "menu", "aria-expanded": menu.open, "aria-busy": busy || undefined,
			"aria-label": props.name + "：" + TAVERN_PACK_STATES[state] + "，更改", title: TAVERN_PACK_STATE_TITLES[state], onClick: busy ? undefined : menu.toggle },
			busy ? h("span", { className: "dsh-tavern-asset-spin", "aria-hidden": true }) : null, h("span", null, TAVERN_PACK_STATES[state])),
		content: close => scope.options(props.id, props.installed !== false).map(option => h(TavernAssetMenuItem, { key: option, state: option, checked: state === option,
			onClick: () => { close(); void scope.set(props.id, option); } }, TAVERN_PACK_STATES[option])) });
}
// One row everywhere: the name (the keyboard target) and the state chip; the whole row opens the pack.
function TavernPackRow(props) {
	const h = React.createElement, pack = props.pack, name = pack ? pack.manifest.name : "未知素材包";
	const open = () => props.onOpen(props.id);
	if (!pack) return h("li", { className: "dsh-tavern-pack-row is-missing", "data-state": props.scope.stateOf(props.id) },
		h("span", { className: "dsh-tavern-pack-name is-missing", title: props.id }, h(TavernAssetGlyph, { name: "warning" }), name),
		h("span", { className: "dsh-tavern-pack-state" }, "未安装"),
		h("button", { type: "button", className: "dsh-tavern-asset-text-button", disabled: !!props.scope.pending[props.id], "aria-label": "移除 " + name, onClick: () => props.scope.set(props.id, "off") }, "移除"));
	return h("li", { className: "dsh-tavern-pack-row is-openable", "data-state": props.scope.stateOf(props.id),
		onClick: event => { if (!event.target.closest("button, a, input, [role=menu]")) open(); } },
		h("button", { type: "button", className: "dsh-tavern-pack-name", "aria-label": "打开 " + name, title: name, onClick: event => { event.stopPropagation(); open(); } }, name),
		h(TavernPackStateTag, { scope: props.scope, id: props.id, name }));
}
// Kind filter (全部 + the kinds the listed packs hold) and sort (名称 / 数量 / 时间), as icon menus on the search row.
const TAVERN_PACK_SORTS = Object.freeze([["name", "名称"], ["count", "数量"], ["time", "时间"]]);
const TAVERN_PACK_SORT_KEY = "dsh-tavern:pack-sort";
function useTavernPackSort() {
	const read = () => { try { const value = localStorage.getItem(TAVERN_PACK_SORT_KEY); return TAVERN_PACK_SORTS.some(row => row[0] === value) ? value : "name"; } catch (_) { return "name"; } };
	const [sort, setSort] = React.useState(read);
	return [sort, value => { try { localStorage.setItem(TAVERN_PACK_SORT_KEY, value); } catch (_) {} setSort(value); }];
}
const tavernPackCollator = typeof Intl !== "undefined" ? new Intl.Collator("zh-Hans-CN", { numeric: true }) : null;
// 全局 first, then 本卡, then 关闭 (`rank`, fixed for one load so a row never jumps while its state changes); the sort orders each band.
function tavernOrderPacks(ids, byId, rank, sort, kind) {
	const name = id => byId.get(id) ? byId.get(id).manifest.name : "";
	const byName = (a, b) => tavernPackCollator ? tavernPackCollator.compare(name(a), name(b)) : name(a).localeCompare(name(b));
	const count = id => byId.get(id) ? tavernPackCount(byId.get(id), kind) : -1, time = id => byId.get(id) ? Number(byId.get(id).updatedAt) || 0 : 0;
	return ids.slice().sort((a, b) => (rank(a) - rank(b)) || (sort === "time" ? time(b) - time(a) : sort === "count" ? count(b) - count(a) : 0) || byName(a, b));
}
function TavernPackTools(props) {
	const h = React.createElement, present = TAVERN_ASSET_KIND_ORDER.filter(kind => kind === props.kind || props.packs.some(pack => tavernPackCount(pack, kind) > 0));
	const kindName = props.kind ? TAVERN_ASSET_KINDS[props.kind] : "全部", sortName = (TAVERN_PACK_SORTS.find(row => row[0] === props.sort) || TAVERN_PACK_SORTS[0])[1];
	return h(React.Fragment, null,
		h(TavernAssetMenu, { label: "按种类筛选", trigger: menu => h("button", { type: "button", className: "dsh-tavern-asset-icon dsh-tavern-pack-kind-menu", "data-on": props.kind || undefined,
				"aria-haspopup": "menu", "aria-expanded": menu.open, "aria-label": "按种类筛选：" + kindName, title: "按种类筛选：" + kindName, onClick: menu.toggle },
				h(TavernAssetGlyph, { name: "filter" }), props.kind ? h("span", null, kindName) : null),
			content: close => ["", ...present].map(kind => h(TavernAssetMenuItem, { key: kind || "all", icon: kind || "filter", checked: props.kind === kind, onClick: () => { close(); props.setKind(kind); } }, kind ? TAVERN_ASSET_KINDS[kind] : "全部")) }),
		h(TavernAssetMenu, { label: "排序", trigger: menu => h(TavernAssetIconButton, { icon: "sort", label: "排序：" + sortName, "data-on": props.sort !== "name" || undefined, "aria-expanded": menu.open, onClick: menu.toggle }),
			content: close => TAVERN_PACK_SORTS.map(row => h(TavernAssetMenuItem, { key: row[0], checked: props.sort === row[0], onClick: () => { close(); props.setSort(row[0]); } }, "按" + row[1])) }));
}
function TavernAssetSearch(props) {
	const h = React.createElement;
	return h("label", { className: "dsh-tavern-asset-search" + (props.className ? " " + props.className : "") }, h(TavernAssetGlyph, { name: "search" }),
		h("input", { type: "search", value: props.value, placeholder: "搜索", "aria-label": props.label, onChange: event => props.onChange(event.target.value),
			onKeyDown: event => { if (event.key === "Escape" && props.value) { event.preventDefault(); event.stopPropagation(); props.onChange(""); } } }));
}
// Bands fixed when the list loads (and when the card's view first arrives).
function useTavernPackRanks(packs, scope) {
	const frozen = React.useRef({ packs: null, ready: false, rank: new Map() });
	if (frozen.current.packs !== packs || frozen.current.ready !== scope.ready) {
		const rank = new Map();
		for (const id of scope.global) rank.set(id, 0);
		for (const id of scope.bound) if (!rank.has(id)) rank.set(id, 1);
		frozen.current = { packs, ready: scope.ready, rank };
	}
	return id => frozen.current.rank.has(id) ? frozen.current.rank.get(id) : 2;
}

// The way from 舞台设置 (BGM ›, a pack row) into 舞台素材: the pack and kind to open, and the way back.
const tavernAssetNav = (function () {
	let target = null;
	const listeners = new Set();
	return {
		go(next) { target = next; listeners.forEach(listener => listener()); },
		take() { const next = target; target = null; return next; },
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
	};
})();

// 舞台素材: one toolbar (search · kind filter · sort · ＋), one flat list, the shared pack window. With a game open the
// states are that card's (全局 / 本卡 / 关闭); without one, 全局 / 关闭.
function TavernPackLibrary(props) {
	const h = React.createElement, list = useTavernAssetPacks(), scope = useTavernPackScope(props.cardPath);
	const [query, setQuery] = React.useState(""), [kind, setKind] = React.useState(""), [sort, setSort] = useTavernPackSort();
	const [draft, setDraft] = React.useState(null), [creating, setCreating] = React.useState(false), [createError, setCreateError] = React.useState(""), [open, setOpen] = React.useState(null);
	React.useEffect(() => {
		const consume = () => { const next = tavernAssetNav.take(); if (next) { setKind(""); setOpen({ ...next, at: Date.now() }); } };
		consume();
		return tavernAssetNav.subscribe(consume);
	}, []);
	const packs = (list.packs || []).filter(pack => !pack.error), broken = (list.packs || []).filter(pack => pack.error);
	const byId = new Map(packs.map(pack => [pack.manifest.id, pack])), rank = useTavernPackRanks(list.packs, scope);
	const needle = query.trim().toLowerCase();
	const ids = tavernOrderPacks(packs.map(pack => pack.manifest.id).filter(id => (!kind || tavernPackCount(byId.get(id), kind) > 0) && (!needle || byId.get(id).manifest.name.toLowerCase().includes(needle))), byId, rank, sort, kind);
	async function create() {
		const name = String(draft || "").trim();
		if (!name || creating) return;
		setCreating(true); setCreateError("");
		try { const result = await rpc("createAssetPack", { name }); setDraft(null); tavernAssetsChanged(); setOpen({ packId: result.pack.manifest.id }); }
		catch (err) { setCreateError(tavernAssetErrorText(err)); }
		finally { setCreating(false); }
	}
	const newRow = draft !== null ? h("div", { className: "dsh-tavern-pack-row is-new" },
		h("input", { className: "dsh-tavern-asset-new-input", autoFocus: true, value: draft, placeholder: "素材包名称", "aria-label": "新素材包名称", maxLength: 256, disabled: creating,
			onChange: event => setDraft(event.target.value), onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); void create(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); } } }),
		h("button", { type: "button", className: "dsh-tavern-asset-pill", disabled: creating || !draft.trim(), onClick: create }, "创建"),
		h(TavernAssetIconButton, { icon: "close", label: "取消新建", onClick: () => setDraft(null) })) : null;
	const body = !list.packs ? (list.error ? null : h(TavernAssetLoading, { count: 6 })) : !list.packs.length ? h(TavernAssetEmpty, { noun: "素材包" }) : h(React.Fragment, null,
		ids.length ? h("ul", { className: "dsh-tavern-pack-list", "aria-label": "素材包" }, ids.map(id => h(TavernPackRow, { key: id, id, pack: byId.get(id), scope, onOpen: packId => setOpen({ packId, kind: kind || undefined }) })))
			: h(TavernAssetEmpty, { noun: "素材包", query, filter: kind && TAVERN_ASSET_KINDS[kind], text: !needle && kind ? "没有含「" + TAVERN_ASSET_KINDS[kind] + "」的素材包" : undefined, onClear: () => { setQuery(""); setKind(""); } }),
		broken.length ? h("ul", { className: "dsh-tavern-pack-list is-broken" }, broken.map(pack => h("li", { key: pack.packId, className: "dsh-tavern-pack-row is-missing" },
			h("span", { className: "dsh-tavern-pack-name is-missing" }, h(TavernAssetGlyph, { name: "warning" }), "无法读取的素材包")))) : null);
	return h("section", { className: "dsh-tavern-asset-library", "aria-label": "素材包" },
		h("div", { className: "dsh-tavern-pack-toolbar" },
			h(TavernAssetSearch, { label: "搜索素材包", value: query, onChange: setQuery }),
			packs.length ? h(TavernPackTools, { packs, kind, setKind, sort, setSort }) : null,
			h(TavernAssetIconButton, { icon: "plus", label: "新建素材包", disabled: draft !== null, onClick: () => { setDraft(""); setCreateError(""); } })),
		h(TavernAssetAlert, { error: list.error, onReload: list.reload }), h(TavernAssetAlert, { error: scope.error }), h(TavernAssetAlert, { error: createError }),
		newRow, body,
		open ? h(TavernPackWindow, { key: open.packId + ":" + (open.at || ""), packId: open.packId, initial: open, scope, onClose: () => setOpen(null) }) : null);
}

// ---------- The pack window: entries on the left, the chosen one on the right ----------
function useTavernAssetNarrow() {
	const query = "(max-width: 720px)", [narrow, setNarrow] = React.useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
	React.useEffect(() => {
		if (typeof matchMedia !== "function") return undefined;
		const list = matchMedia(query), change = () => setNarrow(list.matches);
		list.addEventListener("change", change);
		return () => list.removeEventListener("change", change);
	}, []);
	return narrow;
}
// One preview at a time per window, at the entry's own 音量; `level` follows the slider while that entry plays.
function useTavernAudioPreview(packId) {
	const [state, setState] = React.useState(null), current = React.useRef(null);
	function stop() {
		const playing = current.current;
		current.current = null;
		if (playing && playing.audio) { playing.audio.onended = playing.audio.onerror = playing.audio.ontimeupdate = null; playing.audio.pause(); playing.audio.removeAttribute("src"); }
		setState(null);
	}
	async function toggle(asset) {
		const id = asset.kind + "/" + asset.id;
		if (current.current && current.current.id === id) { stop(); return; }
		stop();
		if (!asset.media) return;
		const playing = { id };
		current.current = playing;
		setState({ id, status: "loading" });
		try {
			const url = await tavernPackMediaUrl(packId, asset.media);
			if (current.current !== playing) return;
			const audio = new Audio(url);
			playing.audio = audio;
			audio.volume = typeof asset.volume === "number" ? Math.min(1, Math.max(0, asset.volume)) : 1;
			audio.onended = () => { if (current.current === playing) stop(); };
			audio.onerror = () => { if (current.current === playing) { stop(); setState({ id, status: "error" }); } };
			audio.ontimeupdate = () => { if (current.current === playing) setState({ id, status: "playing", time: audio.currentTime, duration: audio.duration }); };
			await audio.play();
			if (current.current === playing) setState({ id, status: "playing", time: audio.currentTime || 0, duration: audio.duration });
		} catch (_error) { if (current.current === playing) { stop(); setState({ id, status: "error" }); } }
	}
	function level(asset, value) { const playing = current.current; if (playing && playing.audio && playing.id === asset.kind + "/" + asset.id) playing.audio.volume = Math.min(1, Math.max(0, value)); }
	React.useEffect(() => stop, [packId]);
	return { state, toggle, stop, level };
}
const tavernPlayTime = seconds => Number.isFinite(seconds) ? Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0") : "–:––";
function TavernAssetPlay(props) {
	const h = React.createElement, id = props.asset.kind + "/" + props.asset.id, status = props.audio.state && props.audio.state.id === id ? props.audio.state.status : null, on = status === "playing" || status === "loading";
	return h("button", { type: "button", className: "dsh-tavern-asset-play" + (props.big ? " is-big" : ""), "data-state": status || undefined, "aria-pressed": on, "aria-label": (on ? "停止试听 " : "试听 ") + props.asset.name,
		title: status === "error" ? "无法播放" : undefined, disabled: !props.asset.media, onClick: event => { event.stopPropagation(); void props.audio.toggle(props.asset); } },
		status === "loading" ? h("span", { className: "dsh-tavern-asset-spin", "aria-hidden": true }) : h("svg", { viewBox: "0 0 20 20", "aria-hidden": true },
			status === "playing" ? h("path", { d: "M7 5v10M13 5v10", className: "is-stroke" }) : h("path", { d: "M7 4.6v10.8L15.6 10z", className: "is-fill" })));
}
// A slider (音量): drag previews, release saves; ←→ step 5%, Home / End.
function TavernAssetSlider(props) {
	const h = React.createElement, [draft, setDraft] = React.useState(null), track = React.useRef(null), value = draft === null ? props.value : draft;
	const at = event => { const rect = track.current.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 20) * 5; };
	const move = next => { setDraft(next); if (props.onDraft) props.onDraft(next); };
	const done = next => { setDraft(null); if (next !== props.value) props.onCommit(next); };
	return h("span", { ref: track, className: "dsh-tavern-asset-slider", role: "slider", tabIndex: 0, "aria-label": props.label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": value, "aria-valuetext": value + "%",
		style: { "--value": value + "%" },
		onPointerDown: event => { event.currentTarget.setPointerCapture(event.pointerId); move(at(event)); },
		onPointerMove: event => { if (draft !== null && event.currentTarget.hasPointerCapture(event.pointerId)) move(at(event)); },
		onPointerUp: event => { if (draft !== null) done(at(event)); },
		onKeyDown: event => {
			const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[event.key];
			const next = event.key === "Home" ? 0 : event.key === "End" ? 100 : step === undefined ? null : Math.min(100, Math.max(0, value + step));
			if (next === null) return;
			event.preventDefault(); if (props.onDraft) props.onDraft(next); done(next);
		} },
		h("span", { className: "dsh-tavern-asset-slider-fill" }), h("span", { className: "dsh-tavern-asset-slider-knob" }));
}
// The lamp: one 7px dot that opens 蓝灯 / 绿灯 / 关闭; `named` (a 「label value」 row) reads 「● 绿灯 ⌄」.
function TavernLampMenu(props) {
	const h = React.createElement, [busy, setBusy] = React.useState(false), name = TAVERN_ENTRY_LAMPS[props.mode];
	const pick = value => { if (value === props.mode) return; setBusy(true); Promise.resolve(props.onChange(value)).finally(() => setBusy(false)); };
	return h(TavernAssetMenu, { label: props.label, className: "dsh-tavern-asset-lamp-anchor", stopClicks: true, alignLeft: props.named,
		trigger: menu => h("button", { type: "button", className: props.named ? "dsh-tavern-asset-lamp-named" : "dsh-tavern-asset-lamp-button", "data-mode": props.mode, "aria-haspopup": "menu", "aria-expanded": menu.open,
			"aria-busy": busy || undefined, "aria-label": props.label + "：" + name + (props.named ? "" : "，更改"), title: props.named ? undefined : name, disabled: busy, onClick: menu.toggle },
			h("span", { className: "dsh-tavern-asset-lamp", "data-mode": props.mode }), props.named ? h("span", null, name) : null, props.named ? h(TavernAssetGlyph, { name: "chevDown" }) : null),
		content: close => ["constant", "keyword", "off"].map(mode => h(TavernAssetMenuItem, { key: mode, lamp: mode, checked: props.mode === mode, onClick: () => { close(); pick(mode); } }, TAVERN_ENTRY_LAMPS[mode])) });
}
// A list row: the picture or the play button · the name · the lamp (a quick menu; choosing never selects the row).
function TavernEntryItem(props) {
	const h = React.createElement, item = props.item;
	return h("li", { role: "option", "aria-selected": props.focused, className: "dsh-tavern-entry-item", "data-disabled": item.enabled === false || undefined, onClick: props.onSelect },
		item.kind === "music" ? h(TavernAssetPlay, { audio: props.audio, asset: item }) : h(TavernPackPicture, { packId: props.packId, hash: item.media, className: "dsh-tavern-entry-thumb" }),
		h("button", { type: "button", className: "dsh-tavern-entry-main", onClick: event => { event.stopPropagation(); props.onSelect(); } }, h("span", { className: "dsh-tavern-entry-name" }, item.name)),
		h(TavernLampMenu, { mode: tavernEntryLamp(item), label: item.name + " 的触发策略", onChange: props.onLamp }));
}
// Text that reads as text until it is edited: Enter or leaving saves, Esc restores; an invalid draft stays with its message.
function TavernAssetText(props) {
	const h = React.createElement, [draft, setDraft] = React.useState(null), [error, setError] = React.useState(""), value = draft === null ? props.value || "" : draft;
	const ref = React.useRef(null);
	React.useEffect(() => { if (props.autoFocus && ref.current) ref.current.focus(); }, []);
	React.useLayoutEffect(() => { const node = ref.current; if (props.multiline && node) { node.style.height = "auto"; node.style.height = node.scrollHeight + "px"; } }, [value]);
	function save() {
		if (draft === null) { if (props.onLeave) props.onLeave(value); return; }
		const next = props.trim === false ? draft : draft.trim(), problem = props.validate ? props.validate(next) : "";
		if (problem) { setError(problem); return; }
		setDraft(null); setError("");
		if (next !== (props.value || "")) props.onCommit(next);
		if (props.onLeave) props.onLeave(next);
	}
	const field = h(props.multiline ? "textarea" : "input", { ref, className: "dsh-tavern-asset-text-input", value, rows: props.multiline ? 1 : undefined, placeholder: props.placeholder, "aria-label": props.label,
		"aria-invalid": error ? true : undefined, spellCheck: false,
		onChange: event => { setDraft(event.target.value); setError(""); },
		onBlur: save,
		onKeyDown: event => {
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); save(); event.currentTarget.blur(); }
			if (event.key === "Escape" && (draft !== null || error)) { event.preventDefault(); event.stopPropagation(); setDraft(null); setError(""); }
		} });
	return h("span", { className: "dsh-tavern-asset-text" + (props.className ? " " + props.className : "") }, field, error ? h("span", { className: "dsh-tavern-asset-field-error", role: "alert" }, error) : null);
}
// 触发词: chips with ✕ and a dashed ＋ that opens into a box (Enter or a comma adds). Each change is saved; a word the
// store's lint refuses stays on screen with the reason until it is fixed or removed.
const tavernSplitWords = value => [...new Set(String(value || "").split(/[,，、\n]/).map(word => word.trim()).filter(Boolean))];
const tavernWordsProblem = words => words.length > 16 ? "触发词最多 16 个" : (bad => bad ? "「" + bad + "」需为 2–40 字" : "")(words.find(word => tavernAssetChars(word) < 2 || tavernAssetChars(word) > 40));
function TavernTriggerChips(props) {
	const h = React.createElement, [pending, setPending] = React.useState(null), [error, setError] = React.useState(""), [typed, setTyped] = React.useState("");
	const words = pending || props.words, ref = React.useRef(null), latest = React.useRef(0);
	React.useEffect(() => { if (props.autoFocus && ref.current) ref.current.focus(); }, []);
	// Only the newest change speaks: an earlier refusal that arrives late never covers a later saved list.
	function commit(next) {
		const problem = tavernWordsProblem(next);
		if (problem) { setError(problem); return false; }
		const mine = ++latest.current;
		setError(""); setPending(next);
		Promise.resolve(props.onCommit(next)).then(() => { if (mine === latest.current) { setPending(null); setError(""); } },
			err => { if (mine === latest.current) setError(err && err.code === "TRIGGER_LINT" ? tavernTriggerLintText(err) : tavernAssetErrorText(err)); });
		return true;
	}
	function add() {
		if (!typed.trim()) return;
		const next = [...new Set([...words, ...tavernSplitWords(typed)])];
		if (commit(next)) setTyped("");
	}
	return h("span", { className: "dsh-tavern-asset-chips" },
		words.map(word => h("span", { key: word, className: "dsh-tavern-asset-chip" }, h("span", null, word),
			h("button", { type: "button", "aria-label": "删除触发词 " + word, title: "删除", onClick: () => commit(words.filter(other => other !== word)) }, h(TavernAssetGlyph, { name: "close" })))),
		h("label", { className: "dsh-tavern-asset-chip-add", "data-draft": typed ? true : undefined, title: "添加触发词" }, h(TavernAssetGlyph, { name: "plus" }),
			h("input", { ref, value: typed, size: 1, "aria-label": "添加触发词", "aria-invalid": error ? true : undefined, spellCheck: false,
				onChange: event => { setTyped(event.target.value); setError(""); },
				onKeyDown: event => {
					if ((event.key === "Enter" || event.key === "," || event.key === "，" || event.key === "、") && !event.isComposing) { event.preventDefault(); add(); }
					if (event.key === "Escape" && (typed || error)) { event.preventDefault(); event.stopPropagation(); setTyped(""); setError(""); }
				},
				onBlur: () => { add(); if (props.onLeave) props.onLeave(words.length > 0 || !!typed.trim()); } })),
		error ? h("span", { className: "dsh-tavern-asset-field-error", role: "alert" }, error) : null);
}
function TavernAssetField(props) {
	const h = React.createElement;
	return h("div", { className: "dsh-tavern-asset-field", "data-wide": props.wide || undefined },
		h("span", { className: "dsh-tavern-asset-field-label" }, h("span", null, props.label), props.help ? h(TavernAssetHelp, { label: props.label, text: props.help }) : null),
		h("span", { className: "dsh-tavern-asset-field-value" }, props.children));
}
// The chosen entry: its name (the page title), the picture or the player, then one column of 「label value」 rows.
// Empty optional rows are not shown; they wait as 「＋ 名称」 chips at the end and come back in place when chosen.
function TavernEntryDetail(props) {
	const h = React.createElement, asset = props.asset, kind = asset.kind, packId = props.pack.manifest.id;
	const [error, setError] = React.useState(""), [opened, setOpened] = React.useState(() => new Set()), [confirm, setConfirm] = React.useState(false), picker = React.useRef(null);
	const write = update => { setError(""); return props.commit(kind, asset.id, update).catch(err => { setError(tavernAssetErrorText(err)); }); };
	const openRow = key => setOpened(current => new Set(current).add(key));
	const foldRow = key => setOpened(current => { const next = new Set(current); next.delete(key); return next; });
	const shows = (key, value) => !!(Array.isArray(value) ? value.length : value) || opened.has(key);
	const status = props.audio.state && props.audio.state.id === kind + "/" + asset.id ? props.audio.state : null, pct = status && status.duration ? Math.min(100, 100 * status.time / status.duration) : 0;
	const volume = typeof asset.volume === "number" ? Math.min(1, Math.max(0, asset.volume)) : 1;
	const hero = kind === "music" ? h("div", { className: "dsh-tavern-asset-player", "data-playing": status && status.status === "playing" || undefined },
		h(TavernAssetPlay, { audio: props.audio, asset, big: true }),
		h("div", { className: "dsh-tavern-asset-player-main" },
			h("div", { className: "dsh-tavern-asset-progress", role: "progressbar", "aria-label": "播放进度", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(pct) }, h("span", { style: { width: pct + "%" } })),
			h("div", { className: "dsh-tavern-asset-player-foot" },
				h("span", { className: "dsh-tavern-asset-player-time" }, tavernPlayTime(status ? status.time : 0) + " / " + tavernPlayTime(status ? status.duration : NaN)),
				h("span", { className: "dsh-tavern-asset-player-volume" }, h(TavernAssetGlyph, { name: volume > 0 ? "voice" : "voiceOff" }),
					h(TavernAssetSlider, { label: "音量", value: Math.round(volume * 100), onDraft: value => props.audio.level(asset, value / 100), onCommit: value => write(current => ({ ...current, volume: value / 100 })) }),
					h("span", { className: "dsh-tavern-asset-player-level" }, Math.round(volume * 100) + "%"),
					h(TavernAssetHelp, { label: "音量", text: TAVERN_ASSET_HELP.volume })))))
		: h("button", { type: "button", className: "dsh-tavern-asset-hero", "aria-label": "查看大图 " + asset.name, title: "查看大图",
			onClick: event => { const target = event.currentTarget; void tavernPackMediaUrl(packId, asset.media).then(url => openSceneImagePreview(url, target, null, null, null, asset.name)); } },
			h(TavernPackPicture, { packId, hash: asset.media, className: "dsh-tavern-asset-hero-picture" }));
	const words = asset.recall.keywords || [], note = asset.directorNote || "", remark = asset.remark || "";
	const adds = [["triggers", "触发词", words], ["note", "导演说明", note], ["remark", "备注", remark]].filter(row => !shows(row[0], row[2]));
	const menu = h(TavernAssetMenu, { label: asset.name + " 操作", trigger: m => h(TavernAssetIconButton, { icon: "more", label: "更多操作 " + asset.name, "aria-expanded": m.open, disabled: props.busy, onClick: m.toggle }),
		content: close => [h(TavernAssetMenuItem, { key: "replace", onClick: () => { close(); if (picker.current) picker.current.click(); } }, "替换媒体…"),
			h("span", { key: "sep", className: "dsh-tavern-asset-menu-sep", role: "separator" }),
			h(TavernAssetMenuItem, { key: "remove", danger: true, onClick: () => { close(); setConfirm(true); } }, "删除…")] });
	return h("div", { className: "dsh-tavern-entry-detail", "data-disabled": asset.enabled === false || undefined },
		h("div", { className: "dsh-tavern-entry-title" },
			props.back ? h("button", { type: "button", className: "dsh-tavern-asset-icon dsh-tavern-asset-back", "aria-label": "返回" + props.back.parent, title: "返回" + props.back.parent, onClick: props.back.onBack }, h(TavernAssetGlyph, { name: "back" })) : null,
			h(TavernAssetText, { key: asset.name, className: "is-title", label: "名称", value: asset.name, validate: value => !value ? "名称不能为空" : tavernAssetChars(value) > 256 ? "名称最多 256 字" : "", onCommit: value => write(current => ({ ...current, name: value })) }),
			menu,
			h("input", { ref: picker, type: "file", hidden: true, tabIndex: -1, accept: TAVERN_ASSET_ACCEPT[kind], onChange: event => { const file = event.target.files && event.target.files[0]; event.target.value = ""; if (file) props.replace(asset, file).catch(err => setError(tavernAssetErrorText(err))); } })),
		h(TavernAssetAlert, { error }),
		hero,
		h("div", { className: "dsh-tavern-asset-fields", role: "group", "aria-label": asset.name + " 设置" },
			h(TavernAssetField, { label: "触发策略", help: TAVERN_ASSET_HELP.lamp + (kind === "backgrounds" ? TAVERN_ASSET_HELP.lampBackground : "") },
				h(TavernLampMenu, { named: true, mode: tavernEntryLamp(asset), label: "触发策略", onChange: mode => write(current => tavernSetEntryLamp(current, mode)) })),
			shows("triggers", words) ? h(TavernAssetField, { label: "触发词", help: TAVERN_ASSET_HELP.triggers },
				h(TavernTriggerChips, { key: asset.id, words, autoFocus: opened.has("triggers") && !words.length, onLeave: any => { if (!any) foldRow("triggers"); },
					onCommit: next => props.commit(kind, asset.id, current => tavernEntryWords(current, next)) })) : null,
			shows("note", note) ? h(TavernAssetField, { label: "导演说明", help: TAVERN_ASSET_HELP.notes[kind] },
				h(TavernAssetText, { key: asset.id + ":note", multiline: true, label: "导演说明", placeholder: "适用情景", value: note, autoFocus: opened.has("note") && !note,
					validate: value => tavernAssetChars(value) > 300 ? "导演说明最多 300 字" : "", onLeave: value => { if (!value) foldRow("note"); }, onCommit: value => write(current => ({ ...current, directorNote: value })) })) : null,
			shows("remark", remark) ? h(TavernAssetField, { label: "备注", help: TAVERN_ASSET_HELP.remark },
				h(TavernAssetText, { key: asset.id + ":remark", multiline: true, label: "备注", value: remark, autoFocus: opened.has("remark") && !remark, onLeave: value => { if (!value) foldRow("remark"); },
					onCommit: value => write(current => { const next = { ...current }; if (value) next.remark = value; else delete next.remark; return next; }) })) : null,
			kind === "music" && asset.usage ? h(TavernAssetField, { label: "用途", help: TAVERN_ASSET_HELP.usage },
				h(TavernAssetText, { key: asset.id + ":usage", label: "用途", value: asset.usage, validate: value => tavernAssetChars(value) > 300 ? "用途最多 300 字" : "",
					onCommit: value => write(current => { const next = { ...current }; if (value) next.usage = value; else delete next.usage; return next; }) })) : null,
			adds.length ? h("div", { className: "dsh-tavern-asset-adds" }, adds.map(row => h("button", { key: row[0], type: "button", className: "dsh-tavern-asset-add-chip", "aria-label": "添加" + row[1], onClick: () => openRow(row[0]) },
				h(TavernAssetGlyph, { name: "plus" }), h("span", null, row[1])))) : null),
		confirm ? h(TavernAssetConfirm, { title: "删除" + TAVERN_ASSET_KINDS[kind] + "「" + asset.name + "」？", body: "从素材包「" + props.pack.manifest.name + "」中删除，用到这个素材包的卡都不再使用它。",
			confirmLabel: "删除", danger: true, onConfirm: () => props.remove(asset), onClose: () => setConfirm(false) }) : null);
}
// Trigger words replace the list; a synonym list follows its word out.
function tavernEntryWords(current, keywords) {
	const recall = { ...current.recall, keywords };
	const synonyms = Object.fromEntries(Object.entries(current.recall.synonyms || {}).filter(row => keywords.includes(row[0]) && row[1].length));
	if (Object.keys(synonyms).length) recall.synonyms = synonyms;
	else delete recall.synonyms;
	return { ...current, recall };
}
// 「添加文件」: one item per kind, each a multi-file picker (one file, one entry named after the file).
function TavernAddFilesMenu(props) {
	const h = React.createElement;
	return h(TavernAssetMenu, { label: "添加文件", className: "dsh-tavern-asset-add-files",
		trigger: menu => props.label ? h("button", { type: "button", className: "dsh-tavern-asset-pill is-large", "aria-expanded": menu.open, disabled: props.disabled, onClick: menu.toggle }, h(TavernAssetGlyph, { name: "upload" }), props.label)
			: h(TavernAssetIconButton, { icon: "upload", label: "添加文件", "aria-expanded": menu.open, disabled: props.disabled, onClick: menu.toggle }),
		content: close => TAVERN_ASSET_KIND_ORDER.map(kind => h("label", { key: kind, className: "dsh-tavern-asset-menu-item", tabIndex: -1, "data-kind": kind,
			onKeyDown: event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.querySelector("input").click(); } } },
			h(TavernAssetGlyph, { name: kind }), h("span", { className: "dsh-tavern-asset-menu-text" }, TAVERN_ASSET_KINDS[kind]),
			h("input", { type: "file", multiple: true, accept: TAVERN_ASSET_ACCEPT[kind], "aria-label": "添加" + TAVERN_ASSET_KINDS[kind],
				onChange: event => { const files = Array.from(event.target.files || []); event.target.value = ""; close(); if (files.length) props.onFiles(kind, files); } }))) });
}
// The kinds a pack holds, as tabs (none for a pack of one kind): ←→ Home End switch.
function TavernPackKindNav(props) {
	const h = React.createElement;
	if (props.present.length < 2) return null;
	const keys = event => {
		const at = props.present.indexOf(props.current), n = props.present.length, step = { ArrowRight: 1, ArrowLeft: -1, Home: -at, End: n - 1 - at }[event.key];
		if (step === undefined) return;
		event.preventDefault();
		props.onSwitch(props.present[(at + step + n) % n]);
		const next = event.currentTarget;
		setTimeout(() => { const tab = next.querySelector('[aria-selected="true"]'); if (tab) tab.focus(); }, 0);
	};
	return h("div", { role: "tablist", "aria-label": "素材分类", className: "dsh-tavern-pack-kinds", onKeyDown: keys },
		props.present.map(kind => h("button", { key: kind, type: "button", role: "tab", "aria-selected": kind === props.current, tabIndex: kind === props.current ? 0 : -1, onClick: () => props.onSwitch(kind) }, TAVERN_ASSET_KINDS[kind])));
}
// initial: { packId, kind?, back?: { label, open() } } — a window opened from a 基础设置 「›」 starts with ‹ back there.
function TavernPackWindow(props) {
	const h = React.createElement, packId = props.packId, narrow = useTavernAssetNarrow(), audio = useTavernAudioPreview(packId);
	const [pack, setPack] = React.useState(null), [loadError, setLoadError] = React.useState(""), [error, setError] = React.useState(""), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
	const [kind, setKind] = React.useState(props.initial && props.initial.kind || null), [selected, setSelected] = React.useState(null), [query, setQuery] = React.useState(""), [filter, setFilter] = React.useState("all");
	const [detail, setDetail] = React.useState(false), [removing, setRemoving] = React.useState(false);
	const latest = React.useRef(null), queue = React.useRef(Promise.resolve());
	const load = React.useCallback(() => { setLoadError(""); return rpc("getAssetPack", { packId }).then(result => { latest.current = result.pack; setPack(result.pack); }, err => setLoadError(tavernAssetErrorText(err))); }, [packId]);
	React.useEffect(() => { void load(); }, [load]);
	React.useEffect(() => { if (!notice) return undefined; const timer = setTimeout(() => setNotice(""), 8000); return () => clearTimeout(timer); }, [notice]);
	// Every write is serialized on the newest revision, so quick edits chain instead of conflicting.
	function enqueue(job) {
		const run = queue.current.then(async () => {
			const result = await job(latest.current);
			if (result && result.pack) { latest.current = result.pack; setPack(result.pack); tavernAssetsChanged(); }
			return result;
		});
		queue.current = run.catch(() => {});
		return run;
	}
	const commit = (entryKind, id, update) => enqueue(async current => {
		const attempt = snapshot => rpc("updateAssetPackEntries", { packId, expectedRevision: snapshot.revision, assets: snapshot.manifest.assets.map(asset => asset.kind === entryKind && asset.id === id ? update(asset) : asset) });
		try { return await attempt(current); }
		catch (err) {
			if (err.code !== "REVISION_CONFLICT") throw err;
			const fresh = (await rpc("getAssetPack", { packId })).pack;
			latest.current = fresh;
			return attempt(fresh);
		}
	});
	async function task(job) {
		setBusy(true); setError("");
		try { return await job(); } catch (err) { setError(tavernAssetErrorText(err)); return undefined; } finally { setBusy(false); }
	}
	const addFiles = (fileKind, files) => task(async () => {
		audio.stop();
		const uploads = [];
		for (const file of files) uploads.push(await tavernAssetUpload(file));
		const result = await enqueue(() => rpc("addAssetPackFiles", { packId, kind: fileKind, files: uploads }));
		setKind(fileKind); setQuery(""); setFilter("all");
		if (result.added.length) { setSelected(result.added[0]); if (narrow) setDetail(true); }
		const refused = result.rejected.map(row => row.name).join("、");
		setNotice(result.added.length ? "已添加 " + result.added.length + " 项" + (refused ? "；没能添加：" + refused : "") : "");
		if (!result.added.length) setError("没能添加：" + refused + "（" + (fileKind === "music" ? "请选择 MP3、OGG、WAV、M4A 或 FLAC 音频" : "请选择 4 MB 以内的 PNG、WebP 或 JPEG 图片") + "）");
	});
	const replace = async (asset, file) => {
		audio.stop();
		const upload = await tavernAssetUpload(file);
		await enqueue(current => rpc("replaceAssetPackMedia", { packId, expectedRevision: current.revision, kind: asset.kind, id: asset.id, uploadId: upload.uploadId }));
	};
	const removeEntry = async asset => {
		audio.stop();
		await enqueue(current => rpc("removeAssetPackEntry", { packId, expectedRevision: current.revision, kind: asset.kind, id: asset.id }));
		setSelected(null); setDetail(false); setNotice("已删除");
	};
	const removePack = async () => {
		audio.stop();
		await rpc("removeAssetPack", { packId, expectedRevision: latest.current.revision });
		tavernAssetsChanged();
		props.onClose();
	};
	const close = () => { audio.stop(); props.onClose(); };
	const name = pack ? pack.manifest.name : "素材包";
	const present = pack ? TAVERN_ASSET_KIND_ORDER.filter(entryKind => tavernPackCount(pack, entryKind) > 0) : [];
	const current = kind && present.includes(kind) ? kind : present[0] || null;
	const all = pack && current ? tavernPackItems(pack, current) : [], needle = query.trim().toLowerCase();
	const shown = all.filter(asset => (filter === "all" || tavernEntryLamp(asset) === filter) && (!needle || [asset.name, asset.directorNote, ...(asset.recall.keywords || [])].some(value => String(value || "").toLowerCase().includes(needle))));
	const chosen = all.find(asset => asset.id === selected) || shown[0] || null;
	const switchKind = next => { audio.stop(); setKind(next); setSelected(null); setQuery(""); setDetail(false); };
	const back = props.initial && props.initial.back;
	const head = h("header", { className: "dsh-tavern-asset-modal-head" },
		back ? h("button", { type: "button", className: "dsh-tavern-asset-icon dsh-tavern-asset-back", "aria-label": "返回" + back.label, title: "返回" + back.label, onClick: () => { close(); back.open(); } }, h(TavernAssetGlyph, { name: "back" })) : null,
		h("h2", null, name),
		h("span", { className: "dsh-tavern-asset-modal-tools" },
			pack ? h(TavernAssetMenu, { label: name + " 操作", trigger: menu => h(TavernAssetIconButton, { icon: "more", label: "更多操作 " + name, "aria-expanded": menu.open, onClick: menu.toggle }),
				content: closeMenu => h(TavernAssetMenuItem, { danger: true, onClick: () => { closeMenu(); setRemoving(true); } }, "删除") }) : null,
			h(TavernAssetIconButton, { icon: "close", label: "关闭", onClick: close })));
	const filterMenu = h(TavernAssetMenu, { label: "筛选条目", trigger: menu => h(TavernAssetIconButton, { icon: "filter", label: "筛选条目", "data-on": filter !== "all" || undefined, "aria-expanded": menu.open, onClick: menu.toggle }),
		content: closeMenu => ["all", "constant", "keyword", "off"].map(mode => h(TavernAssetMenuItem, { key: mode, lamp: mode === "all" ? undefined : mode, icon: mode === "all" ? "filter" : undefined, checked: filter === mode,
			onClick: () => { closeMenu(); setFilter(mode); } }, mode === "all" ? "全部" : TAVERN_ENTRY_LAMPS[mode])) });
	const left = pack && present.length ? h("aside", { className: "dsh-tavern-pack-left" },
		h(TavernPackKindNav, { present, current, onSwitch: switchKind }),
		h("div", { className: "dsh-tavern-pack-tools" }, h(TavernAssetSearch, { label: "搜索条目", value: query, onChange: setQuery }), filterMenu, h(TavernAddFilesMenu, { disabled: busy, onFiles: addFiles })),
		shown.length ? h("ul", { className: "dsh-tavern-entry-list", role: "listbox", "aria-label": TAVERN_ASSET_KINDS[current] }, shown.map(item => h(TavernEntryItem, { key: item.id, item, packId, audio, focused: !!chosen && chosen.id === item.id,
			onSelect: () => { setSelected(item.id); if (narrow) setDetail(true); }, onLamp: mode => commit(current, item.id, asset => tavernSetEntryLamp(asset, mode)).catch(err => setError(tavernAssetErrorText(err))) })))
			: h(TavernAssetEmpty, { noun: TAVERN_ASSET_KINDS[current], icon: current, query, filter: filter !== "all" ? TAVERN_ENTRY_LAMPS[filter] : "", onClear: () => { setQuery(""); setFilter("all"); } })) : null;
	const right = pack && chosen ? h("section", { className: "dsh-tavern-pack-right", "aria-label": chosen.name },
		h(TavernEntryDetail, { key: current + "/" + chosen.id, pack, asset: chosen, audio, busy, commit, replace, remove: removeEntry,
			back: narrow ? { parent: TAVERN_ASSET_KINDS[current], onBack: () => setDetail(false) } : null })) : null;
	const empty = pack && !present.length ? h(TavernAssetEmpty, { text: "还没有内容", action: h(TavernAddFilesMenu, { label: "添加文件", disabled: busy, onFiles: addFiles }) }) : null;
	const foot = busy || notice || error ? h("div", { className: "dsh-tavern-asset-modal-foot" },
		busy ? h("p", { role: "status", className: "dsh-tavern-asset-notice" }, h("span", { className: "dsh-tavern-asset-spin", "aria-hidden": true }), "正在处理…") : null,
		notice ? h("p", { role: "status", className: "dsh-tavern-asset-notice" }, notice) : null, h(TavernAssetAlert, { error })) : null;
	return h(TavernAssetModal, { label: name, head, foot, focusDialog: true, className: "dsh-tavern-pack-window", onClose: close },
		!pack ? (loadError ? h(TavernAssetAlert, { error: loadError, onReload: load }) : h(TavernAssetLoading, { lead: true, count: 6 }))
			: empty || h("div", { className: "dsh-tavern-pack-cols", "data-detail": narrow && detail || undefined }, left, right),
		removing && pack ? h(TavernAssetConfirm, { title: "删除「" + name + "」？", danger: true, confirmLabel: "确认删除", onConfirm: removePack, onClose: () => setRemoving(false),
			body: (props.scope && props.scope.global.includes(packId) ? "它现在对所有卡启用。" : "") + "删除后，用到它的卡会少掉里面的素材，不会自动换成别的。" }) : null);
}

// ---------- 舞台设置 › 素材包: the packs this card uses ----------
// 全局 rows first, then 本卡 in binding order, each with its state chip. 「管理」 grows the same section into every pack
// (search, kind filter, sort; the bands fixed while managing); 「完成」 shrinks it back. A row opens the pack window.
function TavernStagePacks(props) {
	const h = React.createElement, list = useTavernAssetPacks(), scope = useTavernPackScope(props.path);
	const [manage, setManage] = React.useState(false), [query, setQuery] = React.useState(""), [kind, setKind] = React.useState(""), [sort, setSort] = useTavernPackSort(), [open, setOpen] = React.useState(null);
	const packs = (list.packs || []).filter(pack => !pack.error), byId = new Map(packs.map(pack => [pack.manifest.id, pack])), rank = useTavernPackRanks(list.packs, scope);
	const effective = [...scope.global.filter(id => byId.has(id)), ...scope.bound.filter(id => !scope.global.includes(id))];
	const needle = query.trim().toLowerCase();
	const managed = tavernOrderPacks(packs.map(pack => pack.manifest.id).filter(id => (!kind || tavernPackCount(byId.get(id), kind) > 0) && (!needle || byId.get(id).manifest.name.toLowerCase().includes(needle))), byId, rank, sort, kind);
	const row = id => h(TavernPackRow, { key: id, id, pack: byId.get(id), scope, onOpen: packId => setOpen({ packId }) });
	const ready = !!list.packs && scope.ready;
	return h("section", { className: "dsh-tavern-stage-section dsh-tavern-stage-packs", "aria-label": "素材包" },
		h("header", { className: "dsh-tavern-stage-section-head" }, h("h3", null, "素材包", ready ? h("span", { className: "dsh-tavern-stage-section-meta" }, manage ? packs.length : effective.length) : null),
			h(TavernAssetHelp, { label: "素材包", text: TAVERN_ASSET_HELP.packs }),
			ready ? h("button", { type: "button", className: "dsh-tavern-asset-manage" + (manage ? " is-done" : ""), "aria-expanded": manage, onClick: () => { setManage(!manage); setQuery(""); setKind(""); } }, manage ? "完成" : "管理") : null),
		h(TavernAssetAlert, { error: list.error, onReload: list.reload }), h(TavernAssetAlert, { error: scope.error }),
		!ready ? (list.error ? null : h(TavernAssetLoading, { count: 2 })) : manage ? h(React.Fragment, null,
			h("div", { className: "dsh-tavern-pack-toolbar" }, h(TavernAssetSearch, { label: "搜索素材包", value: query, onChange: setQuery }), packs.length ? h(TavernPackTools, { packs, kind, setKind, sort, setSort }) : null),
			managed.length ? h("ul", { className: "dsh-tavern-pack-list", "aria-label": "素材包" }, managed.map(row))
				: h(TavernAssetEmpty, { noun: "素材包", query, filter: kind && TAVERN_ASSET_KINDS[kind], text: !needle && kind ? "没有含「" + TAVERN_ASSET_KINDS[kind] + "」的素材包" : undefined, onClear: () => { setQuery(""); setKind(""); } }),
			props.openLibrary ? h("p", { className: "dsh-tavern-asset-more" }, h("button", { type: "button", className: "dsh-tavern-asset-link", onClick: () => props.openLibrary() }, "去舞台素材新建 ›")) : null)
			: effective.length ? h("ul", { className: "dsh-tavern-pack-list is-current", "aria-label": "当前素材包" }, effective.map(row)) : h(TavernAssetEmpty, { compact: true, text: "未使用素材包" }),
		open ? h(TavernPackWindow, { key: open.packId, packId: open.packId, initial: open, scope, onClose: () => setOpen(null) }) : null);
}
// The packs this card uses that hold `kind` (全局 first, then 本卡): what a 基础设置 「›」 opens.
function useTavernKindPacks(path, kind) {
	const list = useTavernAssetPacks(), scope = useTavernPackScope(path);
	const used = (list.packs || []).filter(pack => !pack.error && (scope.global.includes(pack.manifest.id) || scope.bound.includes(pack.manifest.id)) && tavernPackCount(pack, kind) > 0);
	return [...used.filter(pack => scope.global.includes(pack.manifest.id)), ...used.filter(pack => !scope.global.includes(pack.manifest.id))];
}
// The quiet 「›」 of a 基础设置 row: one pack opens directly in 舞台素材 at that kind; several list their names.
function TavernStageKindJump(props) {
	const h = React.createElement, name = "在舞台素材查看" + props.label;
	if (!props.packs.length) return null;
	if (props.packs.length === 1) return h("button", { type: "button", className: "dsh-tavern-switch-jump", "aria-label": name, title: name, onClick: () => props.onPick(props.packs[0]) }, h(TavernAssetGlyph, { name: "chevRight" }));
	return h(TavernAssetMenu, { label: name, className: "dsh-tavern-switch-jump-anchor", alignLeft: true,
		trigger: menu => h("button", { type: "button", className: "dsh-tavern-switch-jump", "aria-label": name, title: name, "aria-haspopup": "menu", "aria-expanded": menu.open, onClick: menu.toggle }, h(TavernAssetGlyph, { name: "chevRight" })),
		content: close => props.packs.map(pack => h(TavernAssetMenuItem, { key: pack.manifest.id, onClick: () => { close(); props.onPick(pack); } }, pack.manifest.name)) });
}
