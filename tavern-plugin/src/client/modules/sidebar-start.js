// The top bar, the start page and the settings list share one catalog of
// right-sidebar pages, so a page offered in settings is the one the start page opens.
// by default the top bar has no 酒馆状态 button (the status tab stays in the right sidebar);
// only 导出 (the fork's ⋯ menu). The owner can add pages, 酒馆状态 included, in 顶栏设置. Same default as DEFAULT_HEADER_ITEMS.
const TAVERN_HEADER_DEFAULT = Object.freeze({ display: "icon-text", items: Object.freeze(["header:export"]) });
const TAVERN_HEADER_NOT_FOLDED = Object.freeze(["dsh-tavern:status", "header:export"]);

const TAVERN_START_GROUPS = Object.freeze([
	["本局", Object.freeze(["dsh-tavern:status", "dsh-tavern:background-tasks", "dsh-tavern:conversation-settings", "dsh-tavern:virtual-skills"])],
	["资料库", Object.freeze(["dsh-tavern:cards", "dsh-tavern:worldbooks", "dsh-tavern:regex-library", "dsh-tavern:resources", "dsh-tavern:skills"])],
	["偏好", Object.freeze(["dsh-tavern:presets", "dsh-tavern:guide-library", "dsh-tavern:card-memory"])],
	["迁移", Object.freeze(["dsh-tavern:transfer"])]
]);

const TAVERN_START_ICON_PATHS = Object.freeze({
	status: 'M4 18a9 9 0 1 1 16 0M12 13l5-5M11 13a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
	'background-tasks': 'M3 6h12M3 11h7M3 16h7M12 16a5 5 0 1 0 10 0a5 5 0 1 0-10 0M17 13.5V16l1.5 1.5',
	'conversation-settings': 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
	cards: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0',
	worldbooks: 'M3 5c0-4 18-4 18 0s-18 4-18 0v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0',
	presets: 'M10 4a2 2 0 1 0 4 0a2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6l-3 8M16 6l3 8M9 19h6',
	resources: 'M3 8V5h7l3 3h8v12H3zM3 11h18',
	skills: 'M13 21H5V3h14v9M8 7h8M8 11h5M18 14l1.5 3.5L23 19l-3.5 1.5L18 24l-1.5-3.5L13 19l3.5-1.5z',
	'regex-library': 'M15 4v9M11 6.2l8 4.6M11 10.8l8-4.6M4 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
	'guide-library': 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
	'system-prompts': 'M10 3L6 21M18 3l-4 18M3 9h18M2 15h18',
	'user-profile': 'M3 6h10m4 0h4M3 12h4m4 0h10M3 18h10m4 0h4M13 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M13 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
	'card-memory': 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
	transfer: 'M12 3v10m0 0-3.5-3.5M12 13l3.5-3.5M4 15v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
	fallback: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'
});

// One icon for a page, wherever it is drawn: the start page card, the top bar
// button, or the settings list. Tavern tabs keep their path; a plugin tab hands
// over its own component; everything else gets the neutral square.
function tavernStartIcon(id, option, size) {
	const key = String(id || "").replace(/^dsh-tavern:/, "");
	const dimension = size ? { width: size, height: size } : {};
	const path = TAVERN_START_ICON_PATHS[key] || TAVERN_START_ICON_PATHS.fallback;
	if (!TAVERN_START_ICON_PATHS[key] && option && option.icon) return React.createElement(option.icon, { size: size || 24 });
	return React.createElement("svg", Object.assign({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, dimension), React.createElement("path", { d: path }));
}

// Group the flat catalog the same way the start page does: Tavern's own groups
// first, then groups plugins registered, then plugin tabs, then the rest.
function tavernStartGroups(options, pluginGroups) {
	const list = Array.isArray(options) ? options.filter(Boolean) : [];
	const claimed = new Set();
	for (const group of TAVERN_START_GROUPS) for (const id of group[1]) claimed.add(id);
	const groups = [];
	for (const [title, ids] of TAVERN_START_GROUPS) {
		const found = ids.map(id => list.find(option => option.id === id)).filter(Boolean);
		if (found.length) groups.push([title, found]);
	}
	for (const group of pluginGroups || []) {
		const tabs = (group && group.tabs || []).filter(id => !claimed.has(id) && (claimed.add(id), true));
		const found = tabs.map(id => list.find(option => option.id === id)).filter(Boolean);
		if (found.length) groups.push([group.title, found]);
	}
	const plugins = list.filter(option => String(option.id).startsWith("tavern-plugin:") && !claimed.has(option.id));
	if (plugins.length) groups.push(["插件", plugins]);
	const others = list.filter(option => !claimed.has(option.id) && !String(option.id).startsWith("tavern-plugin:"));
	if (others.length) groups.push(["其他", others]);
	return groups;
}

// How many trailing pinned pages no longer fit. Fixed buttons (酒馆状态, 导出)
// stay: 导出 opens its own menu, and 酒馆状态 is the way back into the panel.
function tavernHeaderFold(ids, widthOf, available, options) {
	const list = Array.isArray(ids) ? ids : [];
	const gap = Number(options && options.gap) || 0;
	const fixed = new Set(options && options.fixed || []);
	const moreWidth = Number(options && options.moreWidth) || 0;
	const width = id => Number(widthOf(id)) || 0;
	let total = 0;
	for (const id of list) total += width(id);
	total += gap * Math.max(0, list.length - 1);
	if (total <= available) return [];
	let budget = available - moreWidth;
	for (const id of list) if (fixed.has(id)) budget -= width(id) + gap;
	const folded = [];
	let folding = false;
	for (const id of list) {
		if (fixed.has(id)) continue;
		const itemWidth = width(id);
		if (!folding && itemWidth + gap <= budget) budget -= itemWidth + gap;
		else { folding = true; folded.push(id); }
	}
	return folded;
}

// 手机上一行放不下所有快捷入口：固定最多 3 个，其余进 ⋮ 菜单。
// 上限与当前标题长短无关，所以不会出现「按钮随标题内容忽隐忽现」。
const TAVERN_HEADER_MOBILE_LIMIT = 3;
// 一格按钮的占宽：40px 按钮 + 2px 间距；标题行剩余宽度按它折算槽位。
const TAVERN_HEADER_MOBILE_SLOT = 42;

// 导出是独立下拉菜单，折进 ⋮ 里点不到，所以优先保留它。
function tavernHeaderMobileFold(ids, limit) {
	const list = Array.isArray(ids) ? ids : [];
	const max = Math.max(1, Number(limit) || TAVERN_HEADER_MOBILE_LIMIT);
	if (list.length <= max) return [];
	const keep = new Set();
	if (list.includes("header:export")) keep.add("header:export");
	for (const id of list) {
		if (keep.size >= max) break;
		keep.add(id);
	}
	return list.filter(id => !keep.has(id));
}

// 手机上一行能留几个快捷入口。**只做一次预算，不看当前渲染结果**：
//   槽位数 = 标题行内容宽 / 42
//   全部放得下（且 ≤ 上限 3）→ 全显示，不出现 ⋮
//   放不下                    → 留 slots-1 个图标，最后一个槽位给 ⋮
// 「标题行内容宽」不随当前保留数量变化，所以不会收一个→标题变宽→又想放回。
function tavernHeaderMobileCapacity(itemCount, rowWidth, options) {
	const slot = Number(options && options.slot) > 0 ? Number(options.slot) : TAVERN_HEADER_MOBILE_SLOT;
	const limit = Number(options && options.limit) > 0 ? Number(options.limit) : TAVERN_HEADER_MOBILE_LIMIT;
	const count = Math.max(0, Number(itemCount) || 0);
	const slots = Math.max(1, Math.floor(Math.max(0, Number(rowWidth) || 0) / slot));
	// 读数是「这一行放得下几个」，不随当前条目数缩水，便于夹具与排查。
	const fits = Math.min(limit, slots);
	if (count <= fits) return fits;
	// 需要 ⋮：最后一个格位留给它。极端窄屏（约 320px）只剩 1 个位置时，
	// 优先给导出——它是独立下拉，折进 ⋮ 里点不到；其余条目都在 ⋮ 里可达。
	return Math.max(1, Math.min(limit, slots - 1));
}

// 标题行里「不归快捷入口」的固定开销，实测值（390px 视口）：
//   标题行两处间距 4 + 4、标题簇内间距 10、宿主动作组（目录开关 28 + 全屏 40）68、
//   角落按钮 40、标题至少留 16；标题行没有内边距（角落按钮在行内 flex 流里）。
// （手机方向 A「极简游玩」）：手机游玩会话（调试视图关闭）没有角落按钮，全屏收进 ⋯（动作组 68 → 28），
// 固定开销降到 58 = 4 + 10 + 28 + 16（角落按钮没了，标题行只剩一处间距；审计按两处估 62，390px 实测 58），
// 由 tavern.css 在 html.dsh-fork-phone-play 下给出；卡片模式与桌面仍是 142。
// CSS 变量 --dsh-tavern-header-fixed 是权威值，这里只是读不到时的同值后备。
const TAVERN_HEADER_MOBILE_CHROME = 142;
const TAVERN_HEADER_MOBILE_CHROME_PHONE_PLAY = 58;
function tavernHeaderMobileChrome(row) {
	const fallback = typeof document !== "undefined" && document.documentElement.classList.contains("dsh-fork-phone-play") ? TAVERN_HEADER_MOBILE_CHROME_PHONE_PLAY : TAVERN_HEADER_MOBILE_CHROME;
	if (!row) return fallback;
	const raw = window.getComputedStyle(row).getPropertyValue("--dsh-tavern-header-fixed");
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

// 手机判定：窄屏、触屏，或安卓壳注入的 frame 容器。
function tavernMobileHeader() {
	if (typeof window === "undefined") return false;
	const coarse = Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
	const narrow = window.innerWidth <= 767;
	const frame = typeof document !== "undefined" && document.querySelector('[data-mobile-nav="frame"]');
	return narrow || coarse || Boolean(frame);
}
function useTavernMobileHeader() {
	const [mobile, setMobile] = React.useState(tavernMobileHeader);
	React.useEffect(function () {
		if (typeof window === "undefined" || !window.matchMedia) return undefined;
		const query = window.matchMedia("(max-width: 767px)");
		const onChange = function () { setMobile(tavernMobileHeader()); };
		if (query.addEventListener) query.addEventListener("change", onChange);
		else if (query.addListener) query.addListener(onChange);
		window.addEventListener("resize", onChange);
		onChange();
		return function () {
			if (query.removeEventListener) query.removeEventListener("change", onChange);
			else if (query.removeListener) query.removeListener(onChange);
			window.removeEventListener("resize", onChange);
		};
	}, []);
	return mobile;
}

// The catalog follows `sidebarRightTabs`: every guide entry becomes a page the
// top bar can show. Entries are rebuilt only when the registry changes, so the
// snapshot stays reference-stable for useSyncExternalStore.
function createTavernHeaderCatalog() {
	let registry = null, entries = [], attached = false;
	const listeners = new Set();
	function publish() {
		const source = registry && typeof registry.guide === "function" ? registry.guide() : [];
		entries = source.map(function (entry) {
			let label = "";
			try { label = String(entry.title() || ""); } catch (_) {}
			return { id: String(entry.kind || ""), label: label || String(entry.kind || ""), icon: entry.icon || null };
		}).filter(entry => entry.id);
		listeners.forEach(listener => listener());
	}
	function attach(next) {
		if (registry === next && attached) return function () {};
		registry = next;
		attached = true;
		const unsubscribe = next && typeof next.subscribe === "function" ? next.subscribe(publish) : null;
		publish();
		return function () {
			if (typeof unsubscribe === "function") unsubscribe();
			if (registry === next) { registry = null; attached = false; entries = []; listeners.forEach(listener => listener()); }
		};
	}
	return {
		attach: attach,
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		snapshot() { return entries; }
	};
}
const tavernHeaderCatalog = createTavernHeaderCatalog();

function useTavernHeaderCatalog() {
	return React.useSyncExternalStore(tavernHeaderCatalog.subscribe, tavernHeaderCatalog.snapshot, tavernHeaderCatalog.snapshot);
}

function useTavernHeaderItems() {
	const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
	const value = preferences && preferences.headerItems;
	return value && Array.isArray(value.items) ? value : TAVERN_HEADER_DEFAULT;
}

function TavernStartCards(props) {
	const { newTabOptions, onNewTab } = props;
	const h = React.createElement;
	const groups = tavernStartGroups(newTabOptions, props.pluginGroups);
	const css = `.dsh-tavern-start{box-sizing:border-box;padding:18px 16px 24px;overflow:auto;min-height:0;width:100%;color:var(--dsw-alias-label-primary);container-type:inline-size}.dsh-tavern-start section+section{margin-top:22px}.dsh-tavern-start h3{font-size:12px;font-weight:500;color:var(--dsw-alias-label-tertiary);margin:0 2px 8px}.dsh-tavern-start-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,104px),1fr));gap:8px}.dsh-tavern-start-card{appearance:none;font:inherit;font-size:13px;color:inherit;background:var(--dsw-specific-input-major,#fff);border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;min-width:0;min-height:88px;padding:14px 8px 12px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;cursor:pointer;transition:border-color 140ms ease,transform 140ms ease,box-shadow 140ms ease}.dsh-tavern-start-card:hover:not(:disabled){border-color:var(--dsh-tavern-accent-border);box-shadow:0 4px 14px rgba(0,0,0,.06);transform:translateY(-1px)}.dsh-tavern-start-card:active:not(:disabled){transform:none}.dsh-tavern-start-card:focus-visible{outline:2px solid var(--dsh-tavern-accent);outline-offset:2px}.dsh-tavern-start-card:disabled{filter:var(--fk-current-dim, grayscale(1));cursor:default}.dsh-tavern-start-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--dsh-tavern-accent-soft);color:var(--dsh-tavern-accent)}.dsh-tavern-start-icon svg{width:20px;height:20px}.dsh-tavern-start-label{text-align:center;line-height:1.4;overflow-wrap:anywhere}@media (prefers-reduced-motion:reduce){.dsh-tavern-start-card{transition:none}.dsh-tavern-start-card:hover:not(:disabled){transform:none}}@container(max-width:260px){.dsh-tavern-start-grid{gap:6px}.dsh-tavern-start-card{font-size:12px;padding:10px 6px;min-height:76px}}`;
	return h('div', { className: 'dsh-tavern-start' }, h('style', null, css), groups.map(([title, options], index) => {
		if (!options.length) return null;
		return h('section', { key: index + ':' + title, 'aria-label': title }, h('h3', null, title), h('div', { className: 'dsh-tavern-start-grid' }, options.map(option => h('button', { key: option.id, type: 'button', className: 'dsh-tavern-start-card', disabled: option.disabled === true, title: option.label, onClick: () => onNewTab(option.id) },
			h('span', { className: 'dsh-tavern-start-icon', 'aria-hidden': true }, tavernStartIcon(option.id, option)),
			h('span', { className: 'dsh-tavern-start-label' }, option.label)))));
	}));
}

function registerTavernStartPage(ctx, slots) {
 ctx.inject(["sidebarRightTabs"], injected => {
  const registry = injected.get("sidebarRightTabs");
  injected.effect(() => tavernHeaderCatalog.attach(registry), "dsh-tavern: header item catalog");
  injected.effect(() => slots.inject("sidebar.right.tab.guide", () => slots.register({name:"sidebar.right.tab.guide",id:"dsh-tavern:start",priority:-1,select:()=>true}, function TavernStartPage(props) {
   const entries = useTavernHeaderCatalog();
   const {tab} = props.useTabInfo();
   useTavernUiExtensions();
   return React.createElement(TavernStartCards,{pluginGroups:tavernUiExtensions.startGroups(),newTabOptions:entries,onNewTab:id=>tab.actions.openTab(id,{replaceTab:true})});
  })), "dsh-tavern: native start page");
 });
}

// below 768px the host shows the right panel full screen, over the story. A phone page does not
// inherit a panel left expanded on the desktop, nor one that the session's restore expands on its own (a card status
// panel, a restored tab): for a few seconds after a session's panel first mounts on this page load at phone width,
// an expansion without a recent tap or key press is collapsed again. Opening it yourself works as usual. While a
// full-screen panel is open, a 「回到故事」 button (shown by CSS, tavern.css) collapses it.
const TAVERN_PHONE_PANEL_QUERY = "(max-width: 767px)", TAVERN_PHONE_PANEL_GUARD_MS = 5000, TAVERN_PHONE_PANEL_GESTURE_MS = 1500;
function tavernPanelSessionId(panel) {
 try { return panel.binding?.sessionId || ""; } catch (_) { return ""; }
}
function registerTavernPhonePanel(ctx) {
 ctx.inject(["sidebarRight"], injected => {
  const panel = injected.get("sidebarRight");
  injected.effect(() => {
   const view = window, narrow = view.matchMedia(TAVERN_PHONE_PANEL_QUERY), list = ctx.sessions && ctx.sessions.list;
   const guarded = new Map(); // sessionId → guard end (ms), set when its panel first mounts on this page load
   let timer = 0, deadline = 0, disposed = false, gestureAt = -Infinity;
   const gesture = () => { gestureAt = Date.now(); };
   const expanded = () => { try { return panel.isExpanded(); } catch (_) { return false; } };
   function tick() {
    timer = 0;
    if (disposed || !list) return;
    const current = list.getSnapshot().current, now = Date.now();
    if (!current) { if (now < deadline) timer = view.setTimeout(tick, 150); return; }
    if (!guarded.has(current)) {
     if (!narrow.matches) { guarded.set(current, 0); return; }
     // The seat binds the session's surface (restored from storage) shortly after the session is selected.
     if (tavernPanelSessionId(panel) !== current || !panel.mounted?.()) { if (now < deadline) timer = view.setTimeout(tick, 100); return; }
     guarded.set(current, now + TAVERN_PHONE_PANEL_GUARD_MS);
    }
    const until = guarded.get(current);
    if (now >= until || tavernPanelSessionId(panel) !== current) return;
    if (narrow.matches && expanded() && now - gestureAt > TAVERN_PHONE_PANEL_GESTURE_MS) { try { panel.toggleExpanded(); } catch (_) {} }
    timer = view.setTimeout(tick, 150);
   }
   function schedule() {
    if (disposed) return;
    deadline = Date.now() + 8000;
    if (!timer) timer = view.setTimeout(tick, 0);
   }
   const stopList = list ? list.subscribe(schedule) : null;
   view.addEventListener("pointerdown", gesture, true);
   view.addEventListener("keydown", gesture, true);
   schedule();
   const button = document.createElement("button");
   button.type = "button"; button.className = "dsh-tavern-story-return";
   button.textContent = "‹ 回到故事"; button.setAttribute("aria-label", "回到故事");
   button.addEventListener("click", () => { if (expanded()) { try { panel.toggleExpanded(); } catch (_) {} } });
   document.body.appendChild(button);
   const stopBottom = tavernPhoneBottomGuard(ctx, view, () => gestureAt);
   return () => {
    disposed = true; if (timer) view.clearTimeout(timer); stopList?.(); stopBottom(); button.remove();
    view.removeEventListener("pointerdown", gesture, true); view.removeEventListener("keydown", gesture, true);
   };
  }, "dsh-tavern: phone right panel");
 });
}
// the inherited bottom workbench (dsh-better-sidebar's bottom panel, e.g. a 舞台设置 tab left
// there on the desktop) starts collapsed on a phone (≤720px): when a session's sidebar state first loads on this page
// load, and for a few seconds after, an open bottom panel without a recent tap or key press is collapsed through the
// panel's own collapse button (the sidebar store has no other write face). Opening a tab into it, or the ⋯ menu's
// 「底部面板」 (tavernBottomPanel), opens it as usual. Its persisted state follows the host (collapsing is saved).
const TAVERN_PHONE_BOTTOM_QUERY = "(max-width: 720px)";
const tavernBottomPanel = {
 open: sidebar => { try { return sidebar?.getSnapshot()?.state?.bottomOpen === true; } catch (_) { return false; } },
 tabs: sidebar => { try { const root = sidebar?.getSnapshot()?.state?.bottomSplits; const walk = node => !node ? 0 : node.kind === "leaf" ? node.tabs.length : (node.children || []).reduce((n, child) => n + walk(child), 0); return walk(root); } catch (_) { return 0; } },
 toggle() { const close = document.querySelector("[data-dsh-bottom-panel] > button"); if (close) close.click(); return !!close; }
};
function tavernPhoneBottomGuard(ctx, view, gestureAt) {
 const sidebar = ctx.betterSidebar, list = ctx.sessions && ctx.sessions.list;
 if (!sidebar || typeof sidebar.subscribeState !== "function" || !list) return () => {};
 const narrow = view.matchMedia(TAVERN_PHONE_BOTTOM_QUERY), guarded = new Map();
 let timer = 0, disposed = false;
 function check() {
  if (timer) view.clearTimeout(timer);
  timer = 0;
  if (disposed) return;
  const current = list.getSnapshot().current, snapshot = sidebar.getSnapshot(), now = Date.now();
  if (!current || !snapshot || snapshot.sessionId !== current || !snapshot.state) return;
  if (!guarded.has(current)) guarded.set(current, narrow.matches ? now + TAVERN_PHONE_PANEL_GUARD_MS : 0);
  if (now >= guarded.get(current)) return;
  // Before the panel host mounts there is no collapse button yet: look again shortly.
  if (narrow.matches && tavernBottomPanel.open(sidebar) && now - gestureAt() > TAVERN_PHONE_PANEL_GESTURE_MS && !tavernBottomPanel.toggle()) timer = view.setTimeout(check, 50);
  else timer = view.setTimeout(check, 150);
 }
 // A state change is checked right after the store's notification (a microtask, before the next paint).
 const wake = () => { if (!disposed) queueMicrotask(check); };
 const stops = [sidebar.subscribeState(wake), list.subscribe(wake)];
 check();
 return () => { disposed = true; if (timer) view.clearTimeout(timer); stops.forEach(stop => stop()); };
}
