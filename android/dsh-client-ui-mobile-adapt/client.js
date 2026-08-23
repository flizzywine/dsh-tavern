window.__ModuleLoader__.load({
	id: "dsh-client-ui-mobile-adapt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region lib/types/client/locales.js
		/** `mobileAdapt` namespace dictionaries: shell controls and stats panel labels. */
		const zh = {
			"nav.open": "打开侧边栏",
			"stats.title": "会话统计",
			"stats.close": "关闭",
			"stats.turns": "轮数",
			"stats.steps": "步数",
			"stats.llm": "LLM 耗时",
			"stats.tool": "工具调用耗时",
			"stats.ttft": "平均首 Token 延迟",
			"stats.tps": "解码速度",
			"stats.decodeTokens": "解码 Tokens",
			"stats.cacheHit": "缓存命中率",
			"stats.input": "输入 Tokens",
			"stats.output": "输出 Tokens",
			"stats.inputDetail": "输入明细",
			"stats.uncached": "未缓存",
			"stats.cacheRead": "缓存读",
			"stats.cacheWrite": "缓存写",
			"stats.pillTurnsSteps": "{turns} 轮 · {steps} 步",
			"stats.pillCache": "缓存 {percent}%",
			"stats.pillTokens": "{input} / {output}"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"nav.open": "Open sidebar",
			"stats.title": "Session stats",
			"stats.close": "Close",
			"stats.turns": "Turns",
			"stats.steps": "Steps",
			"stats.llm": "LLM time",
			"stats.tool": "Tool call time",
			"stats.ttft": "Avg first-token delay",
			"stats.tps": "Decode speed",
			"stats.decodeTokens": "Decoded tokens",
			"stats.cacheHit": "Cache hit rate",
			"stats.input": "Input tokens",
			"stats.output": "Output tokens",
			"stats.inputDetail": "Input breakdown",
			"stats.uncached": "uncached",
			"stats.cacheRead": "cache read",
			"stats.cacheWrite": "cache write",
			"stats.pillTurnsSteps": "{turns} turns · {steps} steps",
			"stats.pillCache": "cache {percent}%",
			"stats.pillTokens": "{input} / {output}"
		};
		//#endregion
		//#region \0dsh-css:mobile-adapt/client.module.css
		const css = `
/* ===== dsh-mobile: 手机端适配 (v20) ===== */

/* 汉堡按钮与遮罩层在桌面端一律隐藏 */
.dsh-mobile-hamburger,
.dsh-mobile-scrim {
  display: none !important;
}

/* 平板（769-1024px）：复用内置窄栏模式，仅压缩头部 */
@media (max-width: 1024px) {
  .wSkVaW_header {
    padding: 12px 20px 0 16px;
  }
  .wSkVaW_tabs {
    gap: 24px;
  }
}

/* 手机（<= 768px）：单栏布局 */
@media (max-width: 768px) {
  /* 动态视口高度：避免 iOS 工具栏遮挡底部输入区 */
  html,
  body {
    height: 100dvh;
  }

  /* 三栏网格 -> 只有中栏。显式锁定每列所属轨道，
     侧边栏脱离文档流(fixed)后 Grid 自动布局才不会把中栏挤进 0 宽轨道 */
  .pI_x6G_frame {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
    transition: none !important;
  }
  .pI_x6G_sidebarCol {
    grid-column: 1;
  }
  .pI_x6G_centerCol {
    grid-column: 2;
  }
  .pI_x6G_detailsCol {
    grid-column: 3;
    display: none !important;
  }
  .pI_x6G_handle {
    display: none !important;
  }

  /* 侧边栏 -> 左侧抽屉。不能用 transform 做显隐动画
     （transform 会让内部 fixed 面板锚定到抽屉而被裁剪），
     改用 left 位移 */
  .pI_x6G_sidebarCol {
    position: fixed !important;
    top: 0;
    bottom: 0;
    left: -110%;
    width: min(320px, 86vw) !important;
    z-index: 40;
    transition: left 0.25s ease;
    box-shadow: 4px 0 24px rgb(0 0 0 / 30%);
  }
  .pI_x6G_frame:not([data-sidebar-collapsed]) .pI_x6G_sidebarCol {
    left: 0;
  }

  /* 侧边栏内容组件填满抽屉宽度 */
  .pI_x6G_sidebarCol .hHd-Xa_root {
    width: 100% !important;
  }

  /* 汉堡按钮 */
  .dsh-mobile-hamburger {
    display: grid !important;
    position: fixed;
    top: max(10px, env(safe-area-inset-top, 0px));
    left: max(12px, env(safe-area-inset-left, 0px));
    z-index: 41;
    width: 40px;
    height: 40px;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 12px;
    background: var(--dsw-alias-button-floating-fill);
    color: var(--dsw-alias-label-primary);
    box-shadow: var(--dsw-shadow-lv2);
    place-items: center;
    cursor: pointer;
    pointer-events: auto;
    -webkit-tap-highlight-color: transparent;
  }
  .dsh-mobile-hamburger:active {
    background: var(--dsw-alias-button-floating-hover);
  }

  /* 抽屉遮罩：仅在抽屉打开时显示，点按关闭 */
  .dsh-mobile-scrim {
    display: none !important;
    position: fixed;
    inset: 0;
    z-index: 39;
    background: rgb(0 0 0 / 35%);
    pointer-events: auto;
  }
  .pI_x6G_frame:not([data-sidebar-collapsed]) .dsh-mobile-scrim {
    display: block !important;
  }

  /* 会话头部：给汉堡按钮留位，允许换行 */
  .wSkVaW_header {
    padding: 10px 12px 0 60px;
  }
  .wSkVaW_titleRow {
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .wSkVaW_headerActions {
    gap: 4px;
  }
  .wSkVaW_headerUtilities {
    gap: 4px;
    margin-left: 8px;
  }
  .wSkVaW_crumb {
    max-width: 130px;
  }

  /* 顶栏「对话/轨迹」标签：以中间为对称轴居中放置 */
  .wSkVaW_tabs {
    justify-content: center;
    padding-left: 0;
    gap: 32px;
    margin-left: -36px;
  }

  /* 内容与输入区：收紧留白 */
  .wSkVaW_root {
    --dsh-composer-side-clearance: 8px;
  }

  /* 输入工具行：强制单行不换行，压缩间距与触发器宽度 */
  .uV2eYG_row {
    flex-wrap: nowrap !important;
    gap: 8px;
    padding: 2px 6px 6px;
  }
  .uV2eYG_tools {
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .uV2eYG_modes {
    gap: 4px;
  }
  .uV2eYG_trailing {
    gap: 6px;
    margin-left: auto;
    flex: none;
  }
  .Sh0Q9G_trigger,
  ._7KE1Ra_trigger {
    max-width: 112px !important;
  }
  .Sh0Q9G_triggerLabel,
  ._7KE1Ra_triggerLabel {
    font-size: 12px;
  }
  .Md3f7G_flowItem {
    min-width: 0;
    max-width: 100%;
  }
  .wSkVaW_composerSeat {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* 弹层不超出视口 */
  ._7KE1Ra_menu,
  .JObwrW_panel,
  .mufS8W_card {
    max-width: calc(100vw - 16px) !important;
  }
  ._7KE1Ra_menu {
    width: min(240px, calc(100vw - 16px)) !important;
  }
  .JObwrW_panel {
    width: min(264px, calc(100vw - 16px)) !important;
  }

  /* ===== 设置面板：全屏悬浮（自带关闭按钮），可滚动 ===== */
  .VOzbGW_overlay {
    padding: 0;
  }
  .VOzbGW_panel {
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100% !important;
    border-radius: 0;
    flex-direction: column;
  }
  .VOzbGW_nav {
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    gap: 4px;
    padding: 10px 12px 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex: none;
  }
  .VOzbGW_nav::-webkit-scrollbar {
    display: none;
  }
  .VOzbGW_navTitle {
    display: none;
  }
  .VOzbGW_navList {
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 4px;
    flex: none;
  }
  .VOzbGW_navCell {
    height: 34px;
    padding: 6px 12px;
    white-space: nowrap;
    flex: none;
  }
  .VOzbGW_header {
    height: 46px;
    padding: 12px 12px 4px;
    flex: none;
  }
  .VOzbGW_options {
    flex: 1 1 0 !important;
    min-height: 0 !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    padding: 0 16px 32px;
  }

  /* ===== 运行中插件面板：fixed 悬浮，底部抬高到 badge 之上 ===== */
  .Nqubda_panel {
    position: fixed !important;
    bottom: 130px !important;
    left: 12px;
    width: min(420px, calc(100vw - 24px)) !important;
    max-width: calc(100vw - 24px) !important;
    max-height: 55vh;
    z-index: 42;
  }

  /* ===== 轨迹页面（trajectory）手机端 ===== */
  .qBU-ya_root,
  .qBU-ya_ledger {
    isolation: auto !important;
  }
  .Y0dWHa_split {
    display: block;
  }
  .Y0dWHa_tablePane {
    width: 100%;
  }
  .Y0dWHa_details {
    position: fixed !important;
    top: auto !important;
    right: 12px !important;
    bottom: 130px !important;
    left: 12px !important;
    width: auto !important;
    max-width: none !important;
    min-width: 0 !important;
    height: min(52vh, 460px) !important;
    max-height: min(52vh, 460px) !important;
    z-index: 1000 !important;
    border: 1px solid var(--dsw-alias-border-l2);
    border-left: 1px solid var(--dsw-alias-border-l2);
    border-radius: 14px;
    box-shadow: var(--dsw-shadow-lv3);
    background: var(--dsw-alias-bg-layer-1) !important;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .Y0dWHa_detailsResizeHandle {
    display: none !important;
  }
  .Y0dWHa_detailsHeader {
    flex: none;
    padding-top: 12px;
  }
  .Y0dWHa_detailBody {
    flex: 1 1 0 !important;
    min-height: 0 !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 16px !important;
  }
  .Y0dWHa_detailBodySummary {
    padding-bottom: 12px !important;
  }
  .Y0dWHa_detailTabs {
    flex: none;
  }
  .pI_x6G_frame:has(.Y0dWHa_details) .dsh-mobile-hamburger,
  .pI_x6G_frame:has(.Y0dWHa_details) .dsh-mobile-scrim {
    display: none !important;
  }
  .fV0t5q_inner {
    gap: 4px;
    padding: 0 4px;
  }
  .fV0t5q_search {
    flex: 0 1 110px;
    min-width: 64px;
  }
  .fV0t5q_actions {
    gap: 0;
  }

  /* ===== 底部统计：胶囊 + 展开面板 ===== */
  .dsh-stats {
    position: relative;
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 0 8px;
    box-sizing: border-box;
  }
  .dsh-stats-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    max-width: 100%;
    min-height: 28px;
    padding: 4px 16px;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 999px;
    background: var(--dsw-alias-bg-layer-2);
    color: var(--dsw-alias-label-tertiary);
    font-size: 12px;
    line-height: 18px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-tap-highlight-color: transparent;
    font-family: inherit;
  }
  .dsh-stats-pill:active {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .dsh-stats-pill[aria-expanded=true] {
    color: var(--dsw-alias-label-primary);
    border-color: var(--dsw-alias-state-business-primary);
  }
  /* 展开面板：悬浮在输入区上方，可滚动 */
  .dsh-stats-panel {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 176px;
    z-index: 1000;
    max-height: 48vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    box-sizing: border-box;
    border: 1px solid var(--dsw-alias-border-l2);
    border-radius: 14px;
    background: var(--dsw-alias-bg-layer-1);
    box-shadow: var(--dsw-shadow-lv3);
    padding: 6px 14px 10px;
    color: var(--dsw-alias-label-primary);
  }
  .dsh-stats-panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 0 6px;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    border-bottom: 1px solid var(--dsw-alias-border-l1);
  }
  .dsh-stats-close {
    width: 28px;
    height: 28px;
    flex: none;
    color: var(--dsw-alias-label-secondary);
    cursor: pointer;
    background: 0 0;
    border: 0;
    border-radius: 999px;
    place-items: center;
    padding: 0;
    font-size: 18px;
    line-height: 18px;
    display: inline-flex;
  }
  .dsh-stats-close:active {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .dsh-stats-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 7px 0;
    font-size: 13px;
    line-height: 20px;
    border-bottom: 1px solid var(--dsw-alias-border-l1);
  }
  .dsh-stats-row:last-child {
    border-bottom: none;
  }
  .dsh-stats-label {
    flex: none;
    color: var(--dsw-alias-label-secondary);
  }
  .dsh-stats-value {
    min-width: 0;
    text-align: right;
    color: var(--dsw-alias-label-primary);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .pI_x6G_frame:has(.dsh-stats-panel) .dsh-mobile-hamburger,
  .pI_x6G_frame:has(.dsh-stats-panel) .dsh-mobile-scrim {
    display: none !important;
  }

  /* ===== dsh-tavern 手机适配 (窄屏) ===== */
  /* 侧栏工具按钮：放大大点按目标 */
  .dsh-tavern-side-icon {
    width: 40px !important;
    height: 40px !important;
    font-size: 18px !important;
  }
  /* 新建对话 / 模式切换 / 标签按钮：加高触控区 */
  .dsh-tavern-side-new,
  .dsh-tavern-mode-switch button,
  .dsh-tavern-picker-tabs button {
    min-height: 40px !important;
  }
  /* 会话列表行：加高可点区域 */
  .dsh-tavern-side-row-main {
    padding-top: 11px !important;
    padding-bottom: 11px !important;
  }
  /* 候选项 / 行动按钮：加大触控目标 */
  .dsh-tavern-question-option {
    padding: 13px 12px !important;
  }
  .dsh-tavern-btn,
  .dsh-tavern-choice-trigger,
  .dsh-tavern-question-primary,
  .dsh-tavern-script-primary,
  .dsh-card-primary,
  .dsh-tavern-resource-at,
  .dsh-tavern-worldbook-add {
    min-height: 38px !important;
    font-size: 14px !important;
  }
  /* 输入注册 / 自由输入控件：留出更大编辑空间 */
  .dsh-tavern-regen-input,
  .dsh-tavern-guide-add textarea,
  .dsh-tavern-card-field textarea {
    min-height: 56px !important;
  }
  /* 卡片/资源/状态标签页正文：减少留白、确保可滚动 */
  .dsh-tavern-status-body,
  .dsh-tavern-resource-body,
  .dsh-tavern-card-fields {
    padding-left: 14px !important;
    padding-right: 14px !important;
  }
}
`;
		const tagId = "dsh-client-ui-mobile-adapt/client.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-client-ui-mobile-adapt";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		/** Locale namespace owned by this plugin. */
		const NS = "mobileAdapt";
		/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
		const inject = ["slots", "layout", "locale"];
		/**
		* Client plugin body: register the mobile nav (hamburger + scrim) into
		* `shell.overlay` and the stats pill into `conversation.composer.dock`.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-client-ui-mobile-adapt: dictionaries");
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-mobile-nav",
				priority: -1,
				locale: NS
			}, (props) => {
				const toggle = () => {
					ctx.layout.toggleSidebar();
				};
				return react.createElement("div", { className: "dsh-mobile-nav" },
					react.createElement("button", {
						type: "button",
						className: "dsh-mobile-hamburger",
						"aria-label": props.t("nav.open"),
						onClick: toggle
					}, "☰"),
					react.createElement("div", { className: "dsh-mobile-scrim", onClick: toggle })
				);
			})), "dsh-client-ui-mobile-adapt: nav overlay");
			/* 底部统计：替换 shipped 的 stats 行，胶囊 + 展开面板 */
			ctx.effect(() => ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "stats",
				priority: -1,
				locale: NS
			}, (props) => {
				const useSession = props.useSession;
				const useProjection = props.useProjection;
				const t = props.t;
				const [open, setOpen] = react.useState(false);
				const usage = useProjection("tokenUsage");
				const projected = useProjection("sessionStats");
				const settledNodes = useSession((s) => s.chat.legacy.nodes);
				const stats = react.useMemo(() => {
					if (projected !== undefined && projected !== null) return projected;
					const turns = new Set();
					let steps = 0;
					let llmMs = 0;
					let toolMs = 0;
					for (const node of settledNodes) {
						if (node.kind === "tool-result") {
							if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
							continue;
						}
						if (node.kind !== "assistant") continue;
						turns.add(node.turn);
						steps += 1;
						if (node.timing !== void 0 && node.timing.stepStartTime !== null) {
							llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
						}
					}
					return { turns: turns.size, steps, llmMs, toolMs, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
				}, [projected, settledNodes]);
				const billed = usage === void 0 ? 0 : (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
				const output = usage === void 0 ? 0 : (usage.outputTokens || 0);
				const cacheHit = usage !== void 0 && billed > 0 && (usage.cacheReadTokens || 0) > 0
					? Math.round((usage.cacheReadTokens || 0) / billed * 100)
					: null;
				const fmtN = (n) => {
					if (n === void 0 || n === null || n <= 0) return null;
					const scaled = (v) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
					if (n < 1000) return String(n);
					if (n < 1e6) return scaled(n / 1000) + "K";
					return scaled(n / 1e6) + "M";
				};
				const fmtD = (ms) => {
					if (ms === void 0 || ms === null || ms <= 0) return null;
					const s = ms / 1000;
					if (s < 60) return String(Math.round(s * 10) / 10) + "s";
					const whole = Math.round(s);
					return String(Math.floor(whole / 60)) + "m" + String(whole % 60) + "s";
				};
				const hasAny = (stats.steps > 0 || billed > 0 || output > 0);
				if (!hasAny) return null;
				const pillParts = [];
				if (stats.steps > 0) pillParts.push(t("stats.pillTurnsSteps", { turns: stats.turns, steps: stats.steps }));
				if (cacheHit !== null) pillParts.push(t("stats.pillCache", { percent: cacheHit }));
				if (billed > 0 || output > 0) pillParts.push(t("stats.pillTokens", { input: fmtN(billed), output: fmtN(output) }));
				const pillText = pillParts.join("  ·  ");
				const row = (label, value) => value === null || value === void 0 || value === ""
					? null
					: react.createElement("div", { className: "dsh-stats-row" },
						react.createElement("span", { className: "dsh-stats-label" }, label),
						react.createElement("span", { className: "dsh-stats-value" }, value));
				const ttftAvg = stats.ttftSteps > 0 ? fmtD(stats.ttftMs / stats.ttftSteps) : null;
				const tps = stats.decodeMs > 0 ? Math.round(stats.decodeTokens / (stats.decodeMs / 1000)) + " tok/s" : null;
				const tpsDecode = stats.decodeMs > 0 ? fmtN(stats.decodeTokens) : null;
				return react.createElement("div", { className: "dsh-stats" },
					react.createElement("button", {
						type: "button",
						className: "dsh-stats-pill",
						"aria-expanded": open || void 0,
						onClick: () => setOpen((v) => !v)
					}, pillText),
					open && react.createElement("div", { className: "dsh-stats-panel", role: "dialog" },
						react.createElement("div", { className: "dsh-stats-panel-title" },
							react.createElement("span", null, t("stats.title")),
							react.createElement("button", {
								type: "button",
								className: "dsh-stats-close",
								"aria-label": t("stats.close"),
								onClick: () => setOpen(false)
							}, "×")
						),
						row(t("stats.turns"), stats.steps > 0 ? String(stats.turns) : null),
						row(t("stats.steps"), stats.steps > 0 ? String(stats.steps) : null),
						row(t("stats.llm"), fmtD(stats.llmMs)),
						row(t("stats.tool"), fmtD(stats.toolMs)),
						row(t("stats.ttft"), ttftAvg),
						row(t("stats.tps"), tps),
						row(t("stats.decodeTokens"), tpsDecode),
						row(t("stats.cacheHit"), cacheHit === null ? null : cacheHit + "%"),
						row(t("stats.input"), fmtN(billed)),
						row(t("stats.output"), fmtN(output)),
						row(t("stats.inputDetail"), usage === void 0 ? null : [
							(usage.uncachedInputTokens || 0) + " " + t("stats.uncached"),
							(usage.cacheReadTokens || 0) + " " + t("stats.cacheRead"),
							(usage.cacheWriteTokens || 0) + " " + t("stats.cacheWrite")
						].join(" / "))
					)
				);
			})), "dsh-client-ui-mobile-adapt: stats dock");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
