window.__ModuleLoader__.load({
	id: "dsh-tavern-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			let React = require("react");

			const TAVERN_CSS = `
.dsh-tavern-spacer { flex: 1 1 auto; }
.dsh-tavern-btn {
  background: #2a2a36; color: #e8e6e3; border: 1px solid #3f3f4d;
  border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px;
}
.dsh-tavern-btn:hover { background: #34343f; }
.dsh-tavern-btn:disabled { opacity: .45; cursor: default; }
.dsh-tavern-empty { margin: auto; text-align: center; color: #6b6878; padding: 24px; line-height: 1.8; white-space: pre-wrap; }
.dsh-tavern-dock-error { color: #ef8f8f; padding: 0 10px 7px; font-size: 12px; }
.dsh-tavern-sidebar { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; padding: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-sidebar.collapsed { padding: 12px 10px; align-items: center; }
body.dsh-tavern-shell-active button[aria-label="新建会话"], body.dsh-tavern-shell-active button[aria-label="New session"] { display: none !important; }
.dsh-tavern-side-head { height: 48px; display: flex; align-items: center; gap: 8px; flex: none; }
.dsh-tavern-side-brand { flex: 1; min-width: 0; font-size: 16px; font-weight: 800; color: #9a622f; white-space: nowrap; overflow: hidden; }
.dsh-tavern-side-icon { width: 34px; height: 34px; border: 0; border-radius: 9px; background: transparent; color: inherit; cursor: pointer; font-size: 17px; }
.dsh-tavern-side-icon:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-side-new { height: 40px; flex: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-button-elevated-fill); color: inherit; cursor: pointer; font-weight: 650; }
.dsh-tavern-side-new:hover { background: var(--dsw-alias-button-floating-hover); }
.dsh-tavern-mode-switch { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; margin-bottom: 8px; padding: 3px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-mode-switch button { height: 30px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; }
.dsh-tavern-mode-switch button.active { background: var(--dsw-specific-input-major); color: #9a622f; box-shadow: var(--dsw-shadow-lv1); font-weight: 700; }
.dsh-tavern-picker-tabs { display: flex; gap: 6px; margin: 2px 0 8px; }
.dsh-tavern-picker-tabs button { flex: 1; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 8px; cursor: pointer; font-size: 12px; }
.dsh-tavern-picker-tabs button.active { border-color: #a66b35; color: #a66b35; background: rgba(166,107,53,.10); font-weight: 700; }
.dsh-tavern-source-on { border-color: #a66b35 !important; background: rgba(166,107,53,.10) !important; }
.dsh-tavern-side-title { margin: 16px 4px 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-tavern-side-list { min-height: 0; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.dsh-tavern-side-row { position: relative; display: flex; align-items: center; border: 0; border-radius: 8px; background: transparent; color: inherit; }
.dsh-tavern-side-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-side-row.active { background: var(--dsw-alias-interactive-bg-selected, rgba(120,90,60,.14)); }
.dsh-tavern-side-row-main { min-width: 0; flex: 1; border: 0; padding: 8px 5px 8px 9px; text-align: left; background: transparent; color: inherit; cursor: pointer; }
.dsh-tavern-side-row-more { width: 28px; height: 28px; flex: none; margin-right: 3px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; opacity: 0; }
.dsh-tavern-side-row:hover .dsh-tavern-side-row-more, .dsh-tavern-side-row-more[aria-expanded="true"] { opacity: 1; }
.dsh-tavern-side-row-more:hover { background: var(--dsw-alias-interactive-bg-hover); color: inherit; }
.dsh-tavern-side-row-menu { position: absolute; z-index: 30; top: 32px; right: 4px; min-width: 96px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-elevated, #fff); box-shadow: 0 8px 24px rgba(0,0,0,.14); }
.dsh-tavern-side-row-menu button { display: block; width: 100%; border: 0; border-radius: 6px; padding: 7px 10px; text-align: left; background: transparent; color: inherit; cursor: pointer; }
.dsh-tavern-side-row-menu button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-side-row-menu button.danger { color: #c34f4f; }
.dsh-tavern-side-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dsh-tavern-side-row-meta { margin-top: 3px; display: flex; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-tavern-side-empty { padding: 18px 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; text-align: center; }
.dsh-tavern-card-picker { position: absolute; z-index: 80; inset: 70px 10px auto 10px; max-height: calc(100% - 90px); overflow: auto; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-specific-sidebar-fill); box-shadow: 0 14px 36px rgba(0,0,0,.24); }
.dsh-tavern-card-picker-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 700; }
.dsh-tavern-card-pick { width: 100%; padding: 9px; margin-top: 5px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-card-pick:hover { border-color: #a56d3c; background: rgba(145,92,44,.10); }
.dsh-tavern-card-pick b { display: block; color: #a66b35; }
.dsh-tavern-card-pick span { display: block; margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; }
.dsh-tavern-card-pick-wrap { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; align-items: stretch; }
.dsh-tavern-script-file { align-self: center; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 8px; cursor: pointer; font-size: 11px; }
.dsh-tavern-script-file:hover { border-color: #a56d3c; color: #a66b35; }
.dsh-tavern-choice-trigger { border: 1px solid rgba(166,107,53,.55); background: rgba(166,107,53,.10); color: #a66b35; cursor: pointer; padding: 3px 9px; border-radius: 7px; font-size: 12px; font-weight: 650; }
.dsh-tavern-choice-trigger:hover { background: rgba(166,107,53,.20); color: #8e5728; }
.dsh-tavern-dock-actions { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; max-width: var(--dsh-composer-card-max-width, 780px); box-sizing: border-box; margin: 0 auto; padding: 8px 12px 0; flex-wrap: wrap; }
.dsh-tavern-candidate-error-banner { width: 100%; max-width: var(--dsh-composer-card-max-width, 780px); box-sizing: border-box; margin: 0 auto; padding: 8px 12px; border: 1px solid rgba(196,95,95,.45); border-radius: 10px; background: rgba(196,95,95,.10); color: #c45f5f; font-size: 12px; line-height: 1.5; }
.dsh-tavern-choice-error { padding: 5px; color: #c45f5f; font-size: 12px; }
.dsh-tavern-question { width: 100%; max-width: var(--dsh-composer-card-max-width, 780px); box-sizing: border-box; margin: 0 auto; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-specific-tip, var(--dsw-specific-sidebar-fill)); box-shadow: var(--dsw-shadow-lv1); }
.dsh-tavern-question.collapsed { padding: 9px 12px; box-shadow: none; }
.dsh-tavern-question-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; font-weight: 750; cursor: pointer; }
.dsh-tavern-question.collapsed .dsh-tavern-question-head { margin-bottom: 0; }
.dsh-tavern-question-close { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 16px; line-height: 1; }
.dsh-tavern-question-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; }
.dsh-tavern-question-option { width: 100%; box-sizing: border-box; display: flex; align-items: flex-start; gap: 9px; margin-top: 6px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); text-align: left; line-height: 1.5; cursor: pointer; }
.dsh-tavern-question-option:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-question-option.selected { border-color: #a66b35; background: rgba(166,107,53,.10); }
.dsh-tavern-question-radio { flex: none; width: 14px; height: 14px; margin-top: 3px; border: 1.5px solid var(--dsw-alias-label-tertiary); border-radius: 50%; }
.dsh-tavern-question-option.selected .dsh-tavern-question-radio { border: 4px solid #a66b35; }
.dsh-tavern-question-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsh-tavern-question-tag { align-self: flex-start; font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; color: #a66b35; background: rgba(166,107,53,.12); }
.dsh-tavern-question-tag-scene { color: #6b7fa3; background: rgba(107,127,163,.16); }
.dsh-tavern-question-free { width: 100%; margin-top: 6px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary); text-align: left; cursor: pointer; }
.dsh-tavern-question-free:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-question-foot { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
.dsh-tavern-question-primary { border: 0; border-radius: 8px; padding: 6px 12px; background: var(--dsw-alias-button-info-fill); color: #fff; cursor: pointer; }
.dsh-tavern-question-primary:disabled { opacity: .45; cursor: default; }
.dsh-tavern-regen-input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; resize: vertical; }
.dsh-tavern-status { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-status-head { flex: none; padding: 16px 16px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-tavern-status-title { font-size: 15px; font-weight: 800; }
.dsh-tavern-status-role { margin-top: 5px; color: #a66b35; font-size: 13px; font-weight: 700; }
.dsh-tavern-status-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.dsh-tavern-status-tag { padding: 2px 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-status-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 20px; }
.dsh-tavern-status-section { margin-bottom: 16px; }
.dsh-tavern-status-label { margin-bottom: 7px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 700; letter-spacing: .06em; }
.dsh-tavern-status-now { padding: 9px 10px; border: 1px solid rgba(166,107,53,.30); border-radius: 9px; background: rgba(166,107,53,.08); font-size: 12px; line-height: 1.55; }
.dsh-tavern-guide-list { display: flex; flex-direction: column; gap: 6px; }
.dsh-tavern-guide-item { display: flex; align-items: flex-start; gap: 6px; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-guide-text { flex: 1; min-width: 0; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.dsh-tavern-guide-add { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.dsh-tavern-guide-add textarea { box-sizing: border-box; width: 100%; resize: vertical; min-height: 54px; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-specific-input-major); color: inherit; font: inherit; font-size: 12px; line-height: 1.5; }
.dsh-tavern-script-preview { display: flex; flex-direction: column; gap: 7px; }
.dsh-tavern-script-chunk { border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); padding: 7px 9px; font-size: 11px; line-height: 1.55; }
.dsh-tavern-script-chunk-label { display: block; margin-bottom: 3px; color: #a66b35; font-size: 10px; font-weight: 700; }
.dsh-tavern-script-chunk-text { color: var(--dsw-alias-label-secondary); white-space: pre-wrap; max-height: 160px; overflow-y: auto; }
.dsh-tavern-status-item { padding: 7px 0; border-bottom: 1px solid var(--dsw-alias-border-l3); font-size: 12px; line-height: 1.5; }
.dsh-tavern-status-item:last-child { border-bottom: 0; }
.dsh-tavern-status-empty { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.6; }
.dsh-tavern-status-settle { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-tavern-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #6ea676; }
.dsh-tavern-status-dot.running { background: #c68a3a; animation: dsh-tavern-pulse 1s infinite alternate; }
.dsh-tavern-status-dot.error { background: #c45f5f; }
.dsh-tavern-card-fields { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
.dsh-tavern-card-field { margin-bottom: 10px; }
.dsh-tavern-card-field label { display: block; margin-bottom: 4px; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 700; }
.dsh-tavern-card-field input,.dsh-tavern-card-field textarea { box-sizing: border-box; width: 100%; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-specific-input-major); color: inherit; font: inherit; font-size: 11px; line-height: 1.45; resize: vertical; }
.dsh-tavern-card-field textarea { min-height: 76px; }
.dsh-tavern-card-field textarea.large { min-height: 130px; }
.dsh-tavern-card-advanced { margin: 10px 0; }
.dsh-tavern-card-advanced summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 700; }
.dsh-tavern-worldbook { margin-top: 4px; }
.dsh-tavern-worldbook-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.dsh-tavern-worldbook-title { color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 700; }
.dsh-tavern-worldbook-add { border: 1px solid rgba(166,107,53,.55); border-radius: 7px; background: rgba(166,107,53,.10); color: #a66b35; padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: 650; }
.dsh-tavern-worldbook-add:hover { background: rgba(166,107,53,.20); }
.dsh-tavern-worldbook-empty { padding: 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dsh-tavern-worldbook-entry { margin-bottom: 10px; padding: 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-worldbook-entry-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; color: #a66b35; font-size: 11px; font-weight: 700; }
.dsh-tavern-worldbook-del { border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 2px 6px; font-size: 11px; }
.dsh-tavern-worldbook-del:hover { color: #c45f5f; background: rgba(196,95,95,.12); }
.dsh-tavern-worldbook-entry .dsh-tavern-card-field { margin-bottom: 6px; }
.dsh-tavern-worldbook-entry .dsh-tavern-card-field:last-child { margin-bottom: 0; }
.dsh-tavern-card-save { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: 10px 0 2px; background: linear-gradient(transparent, var(--dsw-specific-sidebar-fill) 28%); }
.dsh-tavern-script-row { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l3); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-tavern-script-info { flex: 1; min-width: 150px; line-height: 1.5; }
.dsh-tavern-script-info b { color: #a66b35; }
@keyframes dsh-tavern-pulse { from { opacity: .35; } to { opacity: 1; } }
.dsh-card-primary { border: 0; border-radius: 8px; padding: 7px 14px; background: #9a622f; color: white; cursor: pointer; }
.dsh-card-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.65; }
.dsh-card-error { color: #c45f5f; font-size: 12px; }
@media (max-width: 820px) {
  .dsh-tavern-question { width: calc(100% - 24px); }
}
`;
		const tagId = "dsh-tavern-plugin/tavern.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-tavern-plugin";
			tag.dataset.pluginCss = tagId;
			tag.textContent = TAVERN_CSS;
			document.head.appendChild(tag);
		}


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
			return mode === "script" ? "剧本" : mode === "extract" ? "抽取" : mode === "revision" ? "设定" : "故事";
		}

		function ascii(bytes, off, len) {
			let s = "";
			for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[off + i]);
			return s;
		}

		function parseCardFile(file) {
			const name = String(file.name || "");
			if (name.toLowerCase().endsWith(".json")) {
				return file.text().then(function (text) { return { kind: "text", text: text }; });
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
							if (keyword === "chara" || keyword === "ccv3") return { kind: "png", b64: value };
						}
					}
					if (type === "IEND") break;
					off += 12 + len;
				}
				throw new Error("PNG 中未找到角色卡数据（chara/ccv3 文本块）");
			});
		}

		function rpc(method, args, sessionId) {
			const payload = Object.assign({}, args || {});
			if (sessionId) payload.sessionId = sessionId;
			return fetch("/api/dsh-tavern/" + method, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			}).then(function (response) { return response.json(); }).then(function (result) {
				if (!result || !result.ok) throw new Error(result && result.error ? result.error : "操作失败");
				return result;
			});
		}


		const tavernSessionModes = { values: {}, listeners: new Set() };
		function publishSessionModes(items) {
			const next = {};
			(items || []).forEach(function (item) { next[item.sessionId] = item.mode || "story"; });
			tavernSessionModes.values = next;
			tavernSessionModes.listeners.forEach(function (listener) { listener(next); });
		}
		function publishSessionMode(sessionId, mode) {
			const next = Object.assign({}, tavernSessionModes.values, { [sessionId]: mode });
			tavernSessionModes.values = next;
			tavernSessionModes.listeners.forEach(function (listener) { listener(next); });
		}
		function useTavernSessionMode(sessionId) {
			const [values, setValues] = React.useState(tavernSessionModes.values);
			React.useEffect(function () { tavernSessionModes.listeners.add(setValues); return function () { tavernSessionModes.listeners.delete(setValues); }; }, []);
			return values[sessionId] || "story";
		}

		function TavernSidebar(props) {
			const collapsed = props.collapsed;
			const previewOnly = new URLSearchParams(window.location.search).get("fixture") === "empty";
			const current = props.useSessions(function (state) { return state.current; });
			const summaries = props.useSessions(function (state) { return state.byId; });
			const workspaceId = props.useWorkspaces(function (state) { return state.recentWorkspaceId || (state.items[0] && state.items[0].id); });
			const [cards, setCards] = React.useState([]);
			const [history, setHistory] = React.useState([]);
			const [picking, setPicking] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [uiMode, setUiMode] = React.useState("play");
			const [pickerSub, setPickerSub] = React.useState("cards");
			const [menuSession, setMenuSession] = React.useState(null);
			const lastModeSession = React.useRef(null);
			const fileRef = React.useRef(null);
			const scriptFileRef = React.useRef(null);
			const scriptTargetRef = React.useRef("");
			const extractFileRef = React.useRef(null);
			const [sources, setSources] = React.useState([]);
			const [selectedSourceIds, setSelectedSourceIds] = React.useState([]);
			const readyTavernSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current; }) ? current : "";
			function call(method, args) { return rpc(method, args); }
			function notifyDataChanged() {
				window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
			}
			function refresh() {
				return Promise.all([call("listCards"), call("listSessions"), call("listSources")]).then(function (all) {
					setCards(all[0].cards || []); setHistory(all[1].sessions || []); setSources(all[2].sources || []); publishSessionModes(all[1].sessions || []); setError("");
				}, function (err) { setError(String(err && err.message || err)); });
			}
			React.useEffect(function () {
				refresh();
				function onData() { refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				const timer = window.setInterval(refresh, 4000);
				return function () { window.clearInterval(timer); window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, []);
			React.useEffect(function () {
				if (!current || lastModeSession.current === current) return;
				const item = history.filter(function (entry) { return entry.sessionId === current; })[0];
				if (!item) return;
				lastModeSession.current = current;
				setUiMode(groupOfMode(item.mode));
			}, [current, history]);
			React.useEffect(function () {
				if (!readyTavernSession || typeof props.openDetails !== "function") return;
				props.openDetails();
			}, [readyTavernSession]);
			function openPicker(sub) {
				setMenuSession(null);
				setPickerSub(sub === "sources" ? "sources" : (cards.length ? "cards" : "sources"));
				setPicking(true);
			}
			async function newConversation(card, requestedMode) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "revision");
				if (!workspaceId) {
					setError(previewOnly ? "没有模型配置，无法回复" : "当前没有可用的 Workspace");
					return;
				}
				setBusy(true); setError("");
				try {
					const currentSummary = current ? summaries[current] : null;
					if (current && currentSummary && currentSummary.blank) {
						await props.workspaces.archiveSession(current);
					}
					const sessionId = await props.workspaces.connectWorkspace(workspaceId);
					const presetResponse = await props.connection.api.agentPresets.select({ sessionId: sessionId, agentPreset: "tavern" });
					if (!presetResponse.result.ok) throw new Error(presetResponse.result.error && presetResponse.result.error.message ? presetResponse.result.error.message : "无法切换到酒馆模式");
					props.sessions.noteAgentPreset(sessionId, "tavern");
					await call("startChat", { cardId: card.id, sessionId: sessionId, mode: targetMode });
					setUiMode(groupOfMode(targetMode));
					publishSessionMode(sessionId, targetMode);
					props.sessions.open(sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: sessionId } }));
					setPicking(false); await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importCard(file) {
				setBusy(true); setError("");
				try { const payload = await parseCardFile(file); await call("importCard", { payload: payload }); notifyDataChanged(); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function chooseScriptFile(cardId) {
				scriptTargetRef.current = cardId;
				if (scriptFileRef.current) scriptFileRef.current.click();
			}
			async function importScriptFile(file) {
				const cardId = scriptTargetRef.current;
				if (!cardId || !file) return;
				setBusy(true); setError("");
				try {
					const text = await file.text();
					await call("importScript", { cardId: cardId, payload: { name: file.name, text: text, chunkSize: 500 } });
					notifyDataChanged(); await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); scriptTargetRef.current = ""; }
			}
			async function deleteScriptFor(cardId, title) {
				if (!window.confirm("解除“" + (title || "剧本") + "”的绑定？\n已有剧本会话会保留，新会话将按自由故事推进。")) return;
				setBusy(true); setError("");
				try { await call("deleteScript", { cardId: cardId }); notifyDataChanged(); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importExtractFile(file) {
				if (!file) return;
				setBusy(true); setError("");
				try {
					const text = await file.text();
					await call("importSource", { payload: { name: file.name, text: text, chunkSize: 500 } });
					notifyDataChanged(); await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function newExtractSession(sourceIds) {
				if (!workspaceId) { setError("当前没有可用的 Workspace"); return; }
				if (!sourceIds.length) { setError("请先勾选至少一个素材"); return; }
				setBusy(true); setError("");
				try {
					const currentSummary = current ? summaries[current] : null;
					if (current && currentSummary && currentSummary.blank) {
						await props.workspaces.archiveSession(current);
					}
					const sessionId = await props.workspaces.connectWorkspace(workspaceId);
					const presetResponse = await props.connection.api.agentPresets.select({ sessionId: sessionId, agentPreset: "tavern" });
					if (!presetResponse.result.ok) throw new Error(presetResponse.result.error && presetResponse.result.error.message ? presetResponse.result.error.message : "无法切换到酒馆模式");
					props.sessions.noteAgentPreset(sessionId, "tavern");
					await call("startExtract", { sourceIds: sourceIds, sessionId: sessionId, player: "" });
					setPicking(false); setSelectedSourceIds([]);
					setUiMode("card"); setPickerSub("sources");
					publishSessionMode(sessionId, "extract");
					props.sessions.open(sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: sessionId } }));
					await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function formatTime(ts) {
				if (!ts) return "";
				const d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
			}
			function switchMode(nextMode) {
				setUiMode(nextMode); setPicking(false); setMenuSession(null);
				const first = history.filter(function (item) { return groupOfMode(item.mode) === nextMode; })[0];
				if (first) props.sessions.open(first.sessionId);
				else openPicker("cards");
			}
			async function renameConversation(item, currentTitle) {
				setMenuSession(null);
				const title = window.prompt("重命名对话", currentTitle || item.cardName + "的新对话");
				if (title === null || !title.trim() || title.trim() === currentTitle) return;
				setBusy(true); setError("");
				try { await props.renameSession(item.sessionId, title.trim()); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function deleteConversation(item, currentTitle) {
				setMenuSession(null);
				if (!window.confirm("确定删除对话“" + (currentTitle || item.cardName + "的新对话") + "”吗？\n删除后将从酒馆历史中移除。")) return;
				setBusy(true); setError("");
				try {
					await props.archiveSession(item.sessionId);
					await call("deleteChat", { chatId: item.chatId });
					const next = history.filter(function (entry) { return entry.sessionId !== item.sessionId && groupOfMode(entry.mode) === uiMode; })[0];
					if (next) props.sessions.open(next.sessionId);
					else { props.sessions.clear(); openPicker("cards"); }
					await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function exportCard(card) {
				try {
					const res = await call("exportCard", { cardId: card.id });
					const blob = new Blob([JSON.stringify(res.document, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url; a.download = (card.name || "人物卡") + ".json";
					document.body.appendChild(a); a.click(); a.remove();
					URL.revokeObjectURL(url);
				} catch (err) { setError(String(err && err.message || err)); }
			}
			const h = React.createElement;
			if (collapsed) return h("div", { className: "dsh-tavern-sidebar collapsed" },
				h("button", { className: "dsh-tavern-side-icon", title: "展开侧栏", onClick: props.toggleSidebar }, "🍺"),
				h("button", { className: "dsh-tavern-side-icon", title: "新建对话（跟随当前模式）", onClick: function () { props.toggleSidebar(); window.setTimeout(function () { openPicker("cards"); }, 180); } }, "＋")
			);
			const visibleHistory = history.filter(function (item) { return groupOfMode(item.mode) === uiMode; });
			const rows = visibleHistory.map(function (item) {
				const summary = summaries[item.sessionId];
				const title = summary && summary.displayTitle ? summary.displayTitle : (item.cardName + "的新对话");
				return h("div", { key: item.sessionId, className: "dsh-tavern-side-row" + (current === item.sessionId ? " active" : "") },
					h("button", { className: "dsh-tavern-side-row-main", onClick: async function () {
					try {
						if (summary && summary.blank) await call("ensureOpening", { sessionId: item.sessionId });
						props.sessions.open(item.sessionId);
					} catch (err) { setError(String(err && err.message || err)); }
				} },
					h("div", { className: "dsh-tavern-side-row-name" }, title),
					h("div", { className: "dsh-tavern-side-row-meta" }, h("span", null, modeLabel(item.mode || "story") + " · " + item.cardName), h("span", null, formatTime(summary ? summary.updatedAt : item.updatedAt)))
					),
					h("button", { className: "dsh-tavern-side-row-more", title: "对话操作", "aria-expanded": menuSession === item.sessionId ? "true" : "false", onClick: function () { setMenuSession(menuSession === item.sessionId ? null : item.sessionId); } }, "⋯"),
					menuSession === item.sessionId ? h("div", { className: "dsh-tavern-side-row-menu" },
						h("button", { disabled: busy, onClick: function () { renameConversation(item, title); } }, "重命名"),
						h("button", { className: "danger", disabled: busy, onClick: function () { deleteConversation(item, title); } }, "删除")
					) : null
				);
			});
			const playPicker = h("div", { className: "dsh-tavern-card-picker" },
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "选择人物卡 · 开始游玩"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入人物卡"), h("button", { className: "dsh-tavern-btn", onClick: function () { setPicking(false); } }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				previewOnly ? h("div", { className: "dsh-tavern-dock-error" }, "没有模型配置，无法回复") : null,
				cards.length ? h("div", { className: "dsh-tavern-side-empty", style: { padding: "4px 6px" } }, "已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。") : null,
				cards.length ? cards.map(function (card) { return h("div", { key: card.id, className: "dsh-tavern-card-pick-wrap" },
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newConversation(card); } }, h("b", null, card.name), h("span", null, card.script ? ("剧本：" + card.script.title + " · " + card.script.chunkCount + " 块") : "自由故事（未绑定剧本）")),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "删除人物卡及其所有对话", onClick: function () { if (window.confirm("删除人物卡“" + card.name + "”吗？\n其相关游玩/卡片会话也会一并删除。")) call("deleteCard", { cardId: card.id }).then(refresh, function (err) { setError(String(err && err.message || err)); }); } }, "删除"),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "导出为 SillyTavern 兼容 JSON", onClick: function () { exportCard(card); } }, "导出")
				); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡。\n点“导入人物卡”添加 PNG/JSON 卡片。")
			);
			const cardEditorRows = cards.length ? cards.map(function (card) { return h("div", { key: card.id, className: "dsh-tavern-card-pick-wrap" },
				h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newConversation(card, "revision"); } }, h("b", null, card.name), h("span", null, "进入设定对话，在右侧编辑人物卡字段")),
				h("button", { className: "dsh-tavern-script-file", disabled: busy, title: card.script ? "替换独立剧本文件" : "导入独立剧本文件", onClick: function () { chooseScriptFile(card.id); } }, card.script ? "替换剧本" : "绑定剧本"),
				card.script ? h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "解除剧本绑定", onClick: function () { deleteScriptFor(card.id, card.script.title); } }, "解绑") : null,
				h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "删除人物卡及其所有对话", onClick: function () { if (window.confirm("删除人物卡“" + card.name + "”吗？\n其相关游玩/卡片会话也会一并删除。")) call("deleteCard", { cardId: card.id }).then(refresh, function (err) { setError(String(err && err.message || err)); }); } }, "删除"),
				h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "导出为 SillyTavern 兼容 JSON", onClick: function () { exportCard(card); } }, "导出")
			); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡。\n导入 PNG/JSON 人物卡，或切到“从素材新建”抽取新卡。");
			const sourcePickerRows = sources.length ? sources.map(function (src) {
				const on = selectedSourceIds.indexOf(src.id) >= 0;
				return h("div", { key: src.id, className: "dsh-tavern-card-pick-wrap" },
					h("button", { className: "dsh-tavern-card-pick" + (on ? " dsh-tavern-source-on" : ""), disabled: busy, onClick: function () { setSelectedSourceIds(on ? selectedSourceIds.filter(function (id) { return id !== src.id; }) : selectedSourceIds.concat([src.id])); } }, h("b", null, (on ? "☑ " : "☐ ") + src.title), h("span", null, "约 " + src.sourceChars + " 字 · " + src.chunkCount + " 块")),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, onClick: function () { if (window.confirm("删除素材《" + src.title + "》？")) call("deleteSource", { sourceId: src.id }).then(function () { notifyDataChanged(); return refresh(); }, function (err) { setError(String(err && err.message || err)); }); } }, "删除")
				);
			}) : h("div", { className: "dsh-tavern-empty" }, "还没有素材。\n点“导入素材”添加 txt/md 小说或剧本。");
			const cardPicker = h("div", { className: "dsh-tavern-card-picker" },
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "卡片模式"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", onClick: function () { setPicking(false); } }, "关闭")),
				h("div", { className: "dsh-tavern-picker-tabs" },
					h("button", { className: pickerSub === "cards" ? "active" : "", onClick: function () { setPickerSub("cards"); } }, "编辑人物卡"),
					h("button", { className: pickerSub === "sources" ? "active" : "", onClick: function () { setPickerSub("sources"); } }, "＋ 从素材新建")
				),
				pickerSub === "sources" ? h(React.Fragment, null,
					h("div", { className: "dsh-tavern-card-picker-head", style: { marginTop: "2px" } }, h("span", null, "选择抽取素材"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { extractFileRef.current && extractFileRef.current.click(); } }, "导入素材 (.txt/.md)")),
					h("input", { ref: extractFileRef, type: "file", accept: ".txt,.md,text/plain,text/markdown", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importExtractFile(f); e.target.value = ""; } }),
					sourcePickerRows,
					sources.length ? h("button", { className: "dsh-tavern-side-new", disabled: busy || selectedSourceIds.length === 0, onClick: function () { newExtractSession(selectedSourceIds); } }, "开始抽取（已选 " + selectedSourceIds.length + " 份素材）") : null
				) : h(React.Fragment, null,
					h("div", { className: "dsh-tavern-card-picker-head", style: { marginTop: "2px" } }, h("span", null, "选择人物卡编辑"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入人物卡")),
					h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
					h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,text/plain,text/markdown", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
					cardEditorRows
				)
			);
			return h("div", { className: "dsh-tavern-sidebar", style: { position: "relative", width: props.embedded ? "100%" : props.width + "px" } },
				h("div", { className: "dsh-tavern-side-head" }, h("div", { className: "dsh-tavern-side-brand" }, "🍺 DSH Tavern"), props.embedded ? null : h("button", { className: "dsh-tavern-side-icon", title: "收起侧栏", onClick: props.toggleSidebar }, "◧")),
				h("div", { className: "dsh-tavern-mode-switch" }, h("button", { className: uiMode === "play" ? "active" : "", onClick: function () { switchMode("play"); } }, "游玩"), h("button", { className: uiMode === "card" ? "active" : "", onClick: function () { switchMode("card"); } }, "卡片")),
				h("button", { className: "dsh-tavern-side-new", onClick: function () { openPicker("cards"); } }, uiMode === "play" ? "＋ 选择人物卡 · 新开游玩" : "＋ 新建 / 编辑人物卡"),
				h("div", { className: "dsh-tavern-side-title" }, uiMode === "play" ? "游玩历史" : "卡片历史"),
				h("div", { className: "dsh-tavern-side-list" }, rows.length ? rows : h("div", { className: "dsh-tavern-side-empty" }, uiMode === "play" ? "还没有游玩对话。\n选择人物卡开始；绑定剧本的卡会按剧本推进。" : "还没有卡片会话。\n选择人物卡编辑设定，或从素材抽取新人物卡。")),
				error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
				picking ? (uiMode === "play" ? playPicker : cardPicker) : null
			);
		}

		function RevisionFieldsPanel(props) {
			const [draft, setDraft] = React.useState({});
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [script, setScript] = React.useState(null);
			const [scriptBusy, setScriptBusy] = React.useState(false);
			const [scriptError, setScriptError] = React.useState("");
			const scriptFileRef = React.useRef(null);
			const cardId = props.view.card.id;
			function call(method, args) { return rpc(method, args); }
			function worldBookContentText(entry) {
				const content = entry && typeof entry === "object" ? entry.content : "";
				if (Array.isArray(content)) {
					return content.map(function (part) {
						if (part === null || part === undefined) return "";
						if (typeof part === "object") return String(part.content || "");
						return String(part);
					}).filter(function (text) { return text !== ""; }).join("\n");
				}
				return content === null || content === undefined ? "" : String(content);
			}
			function normalizeWorldBook(book) {
				if (!book || typeof book !== "object") return null;
				const meta = Object.assign({}, book);
				delete meta.entries;
				const entries = Array.isArray(book.entries) ? book.entries.map(function (entry) {
					const source = entry && typeof entry === "object" ? Object.assign({}, entry) : {};
					const keys = Array.isArray(source.keys) ? source.keys : String(source.keys || "").split(/[,，\n]/);
					return Object.assign({}, source, {
						keysText: keys.map(function (key) { return String(key).trim(); }).filter(function (key) { return key !== ""; }).join(", "),
						content: worldBookContentText(source)
					});
				}) : [];
				return { meta: meta, entries: entries };
			}
			function buildWorldBook(book) {
				if (!book || typeof book !== "object" || !Array.isArray(book.entries) || book.entries.length === 0) return null;
				const entries = book.entries.map(function (entry) {
					const out = Object.assign({}, entry && typeof entry === "object" ? entry : {});
					const keysText = out.keysText === undefined ? "" : String(out.keysText);
					delete out.keysText;
					out.keys = keysText.split(/[,，\n]/).map(function (key) { return String(key).trim(); }).filter(function (key) { return key !== ""; });
					out.content = typeof out.content === "string" ? out.content : String(out.content || "");
					return out;
				});
				return Object.assign({}, book.meta || {}, { entries: entries });
			}
			function setBook(nextBook) { setDraft(Object.assign({}, draft, { character_book: nextBook })); }
			function setBookEntry(index, patch) {
				const book = draft.character_book || { meta: {}, entries: [] };
				const entries = (book.entries || []).slice();
				entries[index] = Object.assign({}, entries[index] || {}, patch);
				setBook(Object.assign({}, book, { entries: entries }));
			}
			function addBookEntry() {
				const book = draft.character_book || { meta: {}, entries: [] };
				setBook(Object.assign({}, book, { entries: (book.entries || []).concat([{ keysText: "", content: "", comment: "", enabled: true, constant: false, position: "after_char", insertion_order: (book.entries || []).length, extensions: {} }]) }));
			}
			function removeBookEntry(index) {
				const book = draft.character_book;
				if (!book || !Array.isArray(book.entries)) return;
				setBook(Object.assign({}, book, { entries: book.entries.filter(function (_entry, i) { return i !== index; }) }));
			}
			function loadScript() {
				if (!cardId) return;
				call("getScriptInfo", { cardId: cardId }).then(function (res) { setScript(res.script || null); setScriptError(""); }, function (err) { setScriptError(String(err && err.message || err)); });
			}
			React.useEffect(function () {
				const card = props.view.card;
				setDraft({
					name: card.name || "", tags: (card.tags || []).join(", "), description: card.description || "", personality: card.personality || "", scenario: card.scenario || "",
					first_mes: card.first_mes || "", alternate_greetings: (card.alternate_greetings || []).join("\n---\n"), mes_example: card.mes_example || "", system_prompt: card.system_prompt || "",
					post_history_instructions: card.post_history_instructions || "", creator_notes: card.creator_notes || "", character_book: normalizeWorldBook(card.character_book)
				});
				loadScript();
			}, [cardId, props.view.card]);
			function field(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				setBusy(true); setError("");
				try {
					const patch = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean), character_book: buildWorldBook(draft.character_book) });
					const res = await call("updateCard", { cardId: cardId, patch: patch });
					props.onSaved(res.card);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function importScriptFile(file) {
				if (!cardId || !file) return;
				setScriptBusy(true); setScriptError("");
				try {
					const text = await file.text();
					const res = await call("importScript", { cardId: cardId, payload: { name: file.name, text: text, chunkSize: 500 } });
					setScript(res.script || null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function deleteScript() {
				if (!script || !window.confirm("解除剧本《" + (script.title || "未命名") + "》绑定？\n已有剧本会话保留，新会话将按自由故事推进。")) return;
				setScriptBusy(true); setScriptError("");
				try {
					await call("deleteScript", { cardId: cardId });
					setScript(null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			function F(name, label, large) { return React.createElement("div", { className: "dsh-tavern-card-field" }, React.createElement("label", null, label), name === "name" || name === "tags" ? React.createElement("input", { value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } }) : React.createElement("textarea", { className: large ? "large" : "", value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } })); }
			const h = React.createElement;
			return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "卡片模式 · 字段编辑"), h("div", { className: "dsh-tavern-status-role" }, props.view.card.name), h("div", { className: "dsh-card-hint" }, "设定对话与手动编辑实时写回同一张卡"),
					h("div", { className: "dsh-tavern-script-row" },
						h("div", { className: "dsh-tavern-script-info" }, script ? h("span", null, h("b", null, "剧本："), script.title + " · " + script.chunkCount + " 块 · " + script.sourceChars + " 字") : h("span", null, "剧本：未绑定（游玩时按自由故事推进）")),
						h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,text/plain,text/markdown", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
						h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: function () { scriptFileRef.current && scriptFileRef.current.click(); } }, script ? "替换剧本" : "绑定剧本"),
						script ? h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: deleteScript }, "解绑") : null
					),
					scriptError ? h("div", { className: "dsh-card-error" }, scriptError) : null
				),
				h("div", { className: "dsh-tavern-card-fields" }, F("name", "名称"), F("tags", "标签"), F("description", "角色描述", true), F("personality", "性格"), F("scenario", "场景设定"), F("first_mes", "开场白", true),
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "高级字段"), F("alternate_greetings", "备选开场白（--- 分隔）"), F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("mes_example", "对话示例", true), F("creator_notes", "创作者备注"),
						h("div", { className: "dsh-tavern-worldbook" },
							h("div", { className: "dsh-tavern-worldbook-head" },
								h("span", { className: "dsh-tavern-worldbook-title" }, "世界书 · " + (draft.character_book && Array.isArray(draft.character_book.entries) ? draft.character_book.entries.length : 0) + " 个条目"),
								h("button", { className: "dsh-tavern-worldbook-add", onClick: addBookEntry }, "＋ 添加条目")
							),
							(draft.character_book && draft.character_book.entries && draft.character_book.entries.length)
								? draft.character_book.entries.map(function (entry, index) {
									return h("div", { key: index, className: "dsh-tavern-worldbook-entry" },
										h("div", { className: "dsh-tavern-worldbook-entry-head" },
											h("span", null, "条目 " + (index + 1)),
											h("button", { className: "dsh-tavern-worldbook-del", onClick: function () { removeBookEntry(index); } }, "删除")
										),
										h("div", { className: "dsh-tavern-card-field" },
											h("label", null, "名称（触发词，逗号分隔）"),
											h("input", { value: entry.keysText || "", placeholder: "例如：宝玉、贾府、宝二爷", onChange: function (e) { setBookEntry(index, { keysText: e.target.value }); } })
										),
										h("div", { className: "dsh-tavern-card-field" },
											h("label", null, "内容"),
											h("textarea", { value: entry.content || "", placeholder: "这条世界书的内容", onChange: function (e) { setBookEntry(index, { content: e.target.value }); } })
										)
									);
								})
								: h("div", { className: "dsh-tavern-worldbook-empty" }, "暂无世界书条目。点击“＋ 添加条目”后，可分别编辑每条的名称与内容；未展示的字段会原样保留。")
						)),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存字段"))
				)
			);
		}

		function ExtractPanel(props) {
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [done, setDone] = React.useState(null);
			const view = props.view;
			const extract = view.extract || { sources: [], cursor: 0, totalChunks: 0, done: false, draft: {} };
			const draft = extract.draft || {};
			const h = React.createElement;
			async function finalize() {
				setBusy(true); setError("");
				try {
					const result = await rpc("finalizeExtract", { chatId: view.chatId });
					setDone(result.view && result.view.finalizedCard ? result.view.finalizedCard : { name: draft.name || "新人物" });
					window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: props.sessionId || "" } }));
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function line(label, value) {
				return value ? h("div", { className: "dsh-tavern-status-section" }, h("div", { className: "dsh-tavern-status-label" }, label), h("div", { className: "dsh-tavern-status-item" }, value)) : null;
			}
			return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "卡片模式 · 素材抽取"),
					h("div", { className: "dsh-tavern-status-role" }, draft.name || "未命名角色"),
					h("div", { className: "dsh-card-hint" }, "素材进度 " + Math.min(extract.totalChunks, Math.max(extract.cursor, 1)) + " / " + extract.totalChunks + " 块 · 对话中确认的修改自动更新草稿")
				),
				h("div", { className: "dsh-tavern-status-body" },
					h("div", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "素材"),
						(extract.sources || []).map(function (s) { return h("div", { key: s.id, className: "dsh-tavern-status-item" }, s.title + "（" + s.chunkCount + " 块）"); })
					),
					line("玩家（{{user}}）", extract.player || "未确认：请先在对话里告诉助手谁是玩家"),
					line("角色名", draft.name),
					line("标签", (draft.tags || []).length ? draft.tags.join("、") : ""),
					line("角色描述", draft.description),
					line("性格", draft.personality),
					line("开场情境", draft.scenario),
					line("开场白", draft.first_mes),
					line("对话示例", draft.mes_example),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					done ? h("div", { className: "dsh-tavern-status-now" }, "已保存为新人物卡：" + done.name + "。去“游玩”模式选卡开始新故事。") : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy || !draft.name || (!extract.player && !extract.done), onClick: finalize }, busy ? "保存中…" : (extract.done ? "重新保存人物卡" : "保存为新人物卡")))
				)
			);
		}

		function TavernStatusPanel(props) {
			const [view, setView] = React.useState(null);
			const [error, setError] = React.useState("");
			const [guideDraft, setGuideDraft] = React.useState("");
			const [guideBusy, setGuideBusy] = React.useState(false);
			const [guideError, setGuideError] = React.useState("");
			const stateKey = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				let latest = "";
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					if (nodes[index].kind === "assistant" && nodes[index].messageId) { latest = nodes[index].messageId; break; }
				}
				return String(snapshot.running) + ":" + latest;
			});
			React.useEffect(function () {
				let stopped = false;
				let timer = null;
				async function load() {
					try {
						const result = await rpc("getSession", {}, props.sessionId);
						if (stopped) return;
						setView(result.view || null); setError("");
						if (result.view && result.view.settleStatus === "running") timer = window.setTimeout(load, 1400);
					} catch (err) { if (!stopped) setError(String(err && err.message || err)); }
				}
				load();
				return function () { stopped = true; if (timer) window.clearTimeout(timer); };
			}, [props.sessionId, stateKey]);
			async function addGuide() {
				const text = guideDraft.trim();
				if (!text) return;
				setGuideBusy(true); setGuideError("");
				try {
					const result = await rpc("addGuide", { text: text }, props.sessionId);
					setView(Object.assign({}, view, { guides: result.guides || [] }));
					setGuideDraft("");
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			async function removeGuide(index) {
				setGuideBusy(true); setGuideError("");
				try {
					const result = await rpc("deleteGuide", { index: index }, props.sessionId);
					setView(Object.assign({}, view, { guides: result.guides || [] }));
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			const h = React.createElement;
			if (!view) return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "状态栏")),
				h("div", { className: "dsh-tavern-status-body" }, h("div", { className: "dsh-tavern-status-empty" }, error || "选择人物卡后，这里会显示持续状态。"))
			);
			if (view.mode === "extract") return h(ExtractPanel, { view: view, sessionId: props.sessionId });
			if (view.mode === "revision") return h(RevisionFieldsPanel, { view: view, sessionId: props.sessionId, onSaved: function (next) { setView(Object.assign({}, view, { card: next })); } });
			const statusText = view.settleStatus === "running" ? "正在整理本轮姿势" : (view.settleStatus === "error" ? "状态整理失败" : "姿势已同步");
			return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "酒馆状态"),
					h("div", { className: "dsh-tavern-status-role" }, view.card.name),
					(view.card.tags || []).length ? h("div", { className: "dsh-tavern-status-tags" }, (view.card.tags || []).slice(0, 8).map(function (tag) { return h("span", { key: tag, className: "dsh-tavern-status-tag" }, tag); })) : null,
					h("div", { className: "dsh-tavern-status-settle" }, h("span", { className: "dsh-tavern-status-dot " + (view.settleStatus || "idle") }), statusText)
				),
				h("div", { className: "dsh-tavern-status-body" },
					view.mode === "script" && view.scriptProgress ? h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "剧本进度"),
						h("div", { className: "dsh-tavern-status-now" }, (view.scriptProgress.title || "剧本") + " · 游标 " + Math.min(view.scriptProgress.cursor + 1, view.scriptProgress.totalChunks) + "/" + view.scriptProgress.totalChunks + " · 已召回 " + view.scriptProgress.recalledCount + " 块")
					) : null,
					view.mode === "script" && view.scriptPreview ? h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "剧本预览"),
						h("div", { className: "dsh-tavern-script-preview" },
							(view.scriptPreview.upcoming || []).map(function (chunk, index) {
								return h("div", { key: chunk.id || index, className: "dsh-tavern-script-chunk" },
									h("span", { className: "dsh-tavern-script-chunk-label" }, (index === 0 ? "当前召回" : "后续") + " · 第 " + (chunk.order + 1) + " 块"),
									h("div", { className: "dsh-tavern-script-chunk-text" }, chunk.text)
								);
							})
						)
					) : null,
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "Guide（注入上下文）"),
						h("div", { className: "dsh-tavern-guide-list" },
							(view.guides || []).length ? (view.guides || []).map(function (guide, index) {
								return h("div", { key: guide.id || index, className: "dsh-tavern-guide-item" },
									h("div", { className: "dsh-tavern-guide-text" }, guide.text),
									h("button", { className: "dsh-tavern-worldbook-del", disabled: guideBusy, onClick: function () { removeGuide(index); } }, "删除")
								);
							}) : h("div", { className: "dsh-tavern-status-empty" }, "暂无 Guide。添加后会自动注入正文和候选项生成。")
						),
						h("div", { className: "dsh-tavern-guide-add" },
							h("textarea", { className: "dsh-tavern-regen-input", rows: 2, value: guideDraft, placeholder: "例如：多用短句，多写心理活动，对话不要超过三句", onChange: function (e) { setGuideDraft(e.target.value); } }),
							h("button", { className: "dsh-card-primary", disabled: guideBusy || guideDraft.trim() === "", onClick: addGuide }, guideBusy ? "保存中…" : "添加 Guide")
						),
						guideError ? h("div", { className: "dsh-card-error" }, guideError) : null
					),
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "人物姿势"),
						view.posture ? h("div", { className: "dsh-tavern-status-now" }, view.posture) : h("div", { className: "dsh-tavern-status-empty" }, "等待第一轮状态结算")
					)
				)
			);
		}

		const candidatePanel = { value: null, listeners: new Set() };
		function setCandidatePanel(value) {
			candidatePanel.value = value;
			candidatePanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useCandidatePanel() {
			const [value, setValue] = React.useState(candidatePanel.value);
			React.useEffect(function () { candidatePanel.listeners.add(setValue); return function () { candidatePanel.listeners.delete(setValue); }; }, []);
			return value;
		}
		function readyCandidatePanel(sessionId, messageId, candidates) {
			const value = candidates && typeof candidates === "object" ? candidates : {};
			return {
				sessionId: sessionId,
				messageId: messageId,
				phase: "ready",
				choices: Array.isArray(value.choices) ? value.choices : [],
				traceSessionId: String(value.traceSessionId || ""),
				traceMode: value.traceMode === "continuable" ? "continuable" : "one-shot",
				error: ""
			};
		}

		const regenPanel = { value: null, listeners: new Set() };
		function setRegenPanel(value) {
			regenPanel.value = value;
			regenPanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useRegenPanel() {
			const [value, setValue] = React.useState(regenPanel.value);
			React.useEffect(function () { regenPanel.listeners.add(setValue); return function () { regenPanel.listeners.delete(setValue); }; }, []);
			return value;
		}

		const candidateGuidePanel = { value: null, listeners: new Set() };
		function setCandidateGuidePanel(value) {
			candidateGuidePanel.value = value;
			candidateGuidePanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useCandidateGuidePanel() {
			const [value, setValue] = React.useState(candidateGuidePanel.value);
			React.useEffect(function () { candidateGuidePanel.listeners.add(setValue); return function () { candidateGuidePanel.listeners.delete(setValue); }; }, []);
			return value;
		}

		const HIDDEN_TURNS_KEY = "dsh-tavern-hidden-turns";
		const ROLLED_BACK_TURNS_KEY = "dsh-tavern-rolled-back-turns";
		const HIDDEN_REGEN_USER_TURNS_KEY = "dsh-tavern-hidden-regen-user-turns";
		function recordHiddenTurn(sessionId, turn) {
			try {
				const all = JSON.parse(window.localStorage.getItem(HIDDEN_TURNS_KEY) || "{}");
				const list = all[sessionId] || [];
				if (list.indexOf(turn) < 0) list.push(turn);
				all[sessionId] = list;
				window.localStorage.setItem(HIDDEN_TURNS_KEY, JSON.stringify(all));
			} catch (err) {}
		}
		function recordRolledBackTurn(sessionId, turn) {
			try {
				const all = JSON.parse(window.localStorage.getItem(ROLLED_BACK_TURNS_KEY) || "{}");
				const list = all[sessionId] || [];
				if (list.indexOf(turn) < 0) list.push(turn);
				all[sessionId] = list;
				window.localStorage.setItem(ROLLED_BACK_TURNS_KEY, JSON.stringify(all));
			} catch (err) {}
		}
		function recordHiddenRegenUserTurn(sessionId, turn) {
			try {
				const all = JSON.parse(window.localStorage.getItem(HIDDEN_REGEN_USER_TURNS_KEY) || "{}");
				const list = all[sessionId] || [];
				if (list.indexOf(turn) < 0) list.push(turn);
				all[sessionId] = list;
				window.localStorage.setItem(HIDDEN_REGEN_USER_TURNS_KEY, JSON.stringify(all));
			} catch (err) {}
		}
		function hideUserForTurnTail(tail) {
			if (!tail) return;
			let sib = tail.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "user") {
					sib.style.display = "none";
					break;
				}
				if (kind === "turn-tail") break;
				sib = sib.previousElementSibling;
			}
		}
		function applyHiddenRegenUserTurns(sessionId) {
			try {
				const all = JSON.parse(window.localStorage.getItem(HIDDEN_REGEN_USER_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = document.querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideUserForTurnTail(tail);
				}
			} catch (err) {}
		}
		function hideTurnTail(el) {
			if (!el) return;
			el.style.display = "none";
			let sib = el.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "user" || kind === "turn-tail") break;
				sib.style.display = "none";
				sib = sib.previousElementSibling;
			}
		}
		function hideTurnTailWithUser(el) {
			hideTurnTail(el);
			let sib = el.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "user") {
					sib.style.display = "none";
					break;
				}
				if (kind === "turn-tail") break;
				sib = sib.previousElementSibling;
			}
		}
		function tailTurnOf(el) {
			if (!el) return "";
			if (el.getAttribute("data-turn-tail")) return el.getAttribute("data-turn-tail");
			const inner = el.querySelector("[data-turn-tail]");
			return inner ? inner.getAttribute("data-turn-tail") : "";
		}
		function applyHiddenTurns(sessionId) {
			try {
				const all = JSON.parse(window.localStorage.getItem(HIDDEN_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = document.querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTail(tail);
				}
			} catch (err) {}
		}
		function applyRolledBackTurns(sessionId) {
			try {
				const all = JSON.parse(window.localStorage.getItem(ROLLED_BACK_TURNS_KEY) || "{}");
				const turns = all[sessionId];
				if (!Array.isArray(turns) || turns.length === 0) return;
				const set = new Set(turns.map(String));
				const tails = document.querySelectorAll('[data-chat-flow-kind="turn-tail"]');
				for (let i = 0; i < tails.length; i++) {
					const tail = tails[i];
					if (!set.has(tailTurnOf(tail))) continue;
					hideTurnTailWithUser(tail);
				}
			} catch (err) {}
		}

		function CandidateAction(props) {
			const [busy, setBusy] = React.useState(false);
			const [rolling, setRolling] = React.useState(false);
			const candidatePanelState = useCandidatePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const latestMessageId = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
				}
				return null;
			});
			async function generate(force, guidance) {
				if (busy) return;
				setBusy(true);
				setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
				try {
					if (!force) {
						const saved = await rpc("getChoices", { messageId: props.messageId }, props.sessionId);
						if (saved && saved.ok && saved.candidates && saved.candidates.messageId === props.messageId) {
							setCandidatePanel(readyCandidatePanel(props.sessionId, props.messageId, saved.candidates));
							return;
						}
					}
					const result = await rpc("generateChoices", { messageId: props.messageId, guidance: guidance || "" }, props.sessionId);
					setCandidatePanel(readyCandidatePanel(props.sessionId, props.messageId, result.candidates));
				} catch (err) { setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(err && err.message || err) }); }
				finally { setBusy(false); }
			}
			async function rollback() {
				if (rolling) return;
				if (!window.confirm("回退本轮？\n将删除你最近一次输入和这段 LLM 输出，并同步回退故事状态与剧本游标。")) return;
				setRolling(true);
				try {
					const result = await rpc("rollbackTurn", {}, props.sessionId);
					const rolledBack = result && result.view && result.view.rolledBack ? result.view.rolledBack : null;
					if (rolledBack && Number(rolledBack.hiddenTurn) > 0) recordRolledBackTurn(props.sessionId, Number(rolledBack.hiddenTurn));
					applyRolledBackTurns(props.sessionId);
					setCandidatePanel(null);
					setRegenPanel(null);
					setCandidateGuidePanel(null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) {
					window.alert(String(err && err.message || err));
				} finally { setRolling(false); }
			}
			const h = React.createElement;
			const isScript = sessionMode === "script";
			const hasReadyPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "ready";
			const hasLoadingPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "loading";
			if (!isPlayMode(sessionMode) || latestMessageId !== props.messageId) return null;
			return h(React.Fragment, null,
				h("button", { className: "dsh-tavern-choice-trigger", disabled: busy || rolling || hasLoadingPanel, title: hasReadyPanel ? "重新生成候选项（可先填写意见）" : (isScript ? "手动生成候选项；由于跟随剧本，只有一个推荐候选项" : "手动生成候选项"), onClick: function () {
					setRegenPanel(null);
					if (hasReadyPanel) {
						const previous = candidatePanelState;
						setCandidatePanel(null);
						setCandidateGuidePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "input", error: "", previous: previous });
					} else {
						generate(false);
					}
				} }, (busy || hasLoadingPanel) ? "生成中…" : (hasReadyPanel ? "重新生成候选项" : "生成候选项")),
				h("button", { className: "dsh-tavern-choice-trigger", title: "重新生成正文（可填指导意见，生成后直接替换）", onClick: function (event) {
					const tail = event && event.currentTarget ? event.currentTarget.closest('[data-chat-flow-kind="turn-tail"]') : null;
					setCandidatePanel(null);
					setRegenPanel({ sessionId: props.sessionId, phase: "input", guidance: "", text: "", error: "", tail: tail });
				} }, "重新生成正文"),
				h("button", { className: "dsh-tavern-choice-trigger", disabled: rolling, title: "删除最近一次用户输入和这段 LLM 输出", onClick: rollback }, rolling ? "回退中…" : "回退本轮")
			);
		}

		function CandidateDockActions(props) {
			const sessionMode = useTavernSessionMode(props.sessionId);
			const latestMessageId = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
				}
				return null;
			});
			if (!isPlayMode(sessionMode) || !latestMessageId) return null;
			const h = React.createElement;
			return h("div", { className: "dsh-tavern-dock-actions" },
				React.createElement(CandidateAction, Object.assign({}, props, { messageId: latestMessageId }))
			);
		}

		function CandidateQuestion(props) {
			const panel = useCandidatePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
				}
				return null;
			});
			const [selected, setSelected] = React.useState(-1);
			const [expanded, setExpanded] = React.useState(false);
			React.useEffect(function () {
				setSelected(sessionMode === "script" && panel && Array.isArray(panel.choices) && panel.choices.length === 1 ? 0 : -1);
				setExpanded(panel !== null && panel.phase === "error");
			}, [panel, sessionMode]);
			React.useEffect(function () {
				applyHiddenTurns(props.sessionId);
				applyRolledBackTurns(props.sessionId);
				applyHiddenRegenUserTurns(props.sessionId);
				const timer = window.setInterval(function () { applyHiddenTurns(props.sessionId); applyRolledBackTurns(props.sessionId); applyHiddenRegenUserTurns(props.sessionId); }, 1500);
				return function () { window.clearInterval(timer); };
			}, [props.sessionId]);
			if (panel && panel.sessionId === props.sessionId && panel.phase === "error") {
				return React.createElement("div", { className: "dsh-tavern-choice-error dsh-tavern-candidate-error-banner" },
					"候选项生成失败：" + (panel.error || "未知错误") + "。请点上方“生成候选项”重试。"
				);
			}
			if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId || running) {
				return null;
			}
			const h = React.createElement;
			const count = (panel.choices || []).length;
			const isScript = sessionMode === "script";
			const heading = "接下来的行动";
			const summary = panel.phase === "loading" ? "正在生成…" : (panel.error ? "生成失败" : (isScript ? "1 个候选 · 跟随剧本，只有一个推荐候选项" : count + " 个候选项"));
			return h("div", { className: "dsh-tavern-question" + (expanded ? "" : " collapsed") },
				h("div", { className: "dsh-tavern-question-head", onClick: function () { setExpanded(!expanded); } }, h("span", null, heading), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { className: "dsh-tavern-question-close", title: expanded ? "收起" : "展开", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
				expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
				expanded && panel.error ? h("div", { className: "dsh-tavern-choice-error" }, "候选项生成失败，请点回复下方的“生成候选项”重试") : null,
				expanded ? (panel.choices || []).map(function (choice, index) {
					const item = choice !== null && typeof choice === "object" ? choice : { type: "action", text: String(choice) };
					const label = item.type === "scene" ? "场景变化" : "人物行为";
					return h("button", { key: index, className: "dsh-tavern-question-option" + (selected === index ? " selected" : ""), onClick: function () { setSelected(index); } },
						h("span", { className: "dsh-tavern-question-radio" }),
						h("span", { className: "dsh-tavern-question-text" },
							h("span", { className: "dsh-tavern-question-tag dsh-tavern-question-tag-" + item.type }, label),
							h("span", null, item.text)
						)
					);
				}) : null,
				expanded && panel.phase === "ready" ? h("button", { className: "dsh-tavern-question-free", onClick: function () {
					setCandidatePanel(null);
					window.requestAnimationFrame(function () {
						const input = document.querySelector("[data-composer-card] textarea");
						if (input) input.focus();
					});
				} }, "✎ 自由行动（直接在下方输入）") : null,
				expanded && panel.phase === "ready" && panel.traceSessionId ? h("button", { className: "dsh-tavern-question-free", title: panel.traceMode === "continuable" ? "打开持续存在的后台 Agent" : "打开后台候选任务的推理与工具调用记录", onClick: async function () {
					try {
						await props.sessions.refreshSubagents(panel.sessionId);
						props.sessions.openSubagent({ parentSessionId: panel.sessionId, childSessionId: panel.traceSessionId, mode: panel.traceMode });
					} catch (err) {
						window.alert("无法打开后台 Agent 轨迹：" + String(err && err.message || err));
					}
				} }, panel.traceMode === "continuable" ? "查看后台 Agent" : "查看后台候选任务轨迹") : null,
				expanded && panel.phase === "ready" && panel.choices && panel.choices.length ? h("div", { className: "dsh-tavern-question-foot" },
					h("button", { className: "dsh-tavern-question-primary", disabled: selected < 0, onClick: function () {
						if (selected < 0) return;
						const item = panel.choices[selected];
						const choice = item !== null && typeof item === "object" ? item : { type: "action", text: String(item) };
						const marked = choice.type === "scene" ? "【场景变化】" + choice.text : choice.text;
						props.inputActions.setDraft(marked);
						setCandidatePanel(null);
					} }, "填入输入框")
				) : null
			);
		}

		function CandidateGuidePanel(props) {
			const panel = useCandidateGuidePanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
				}
				return null;
			});
			const [guidance, setGuidance] = React.useState("");
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId) {
				return null;
			}
			const isScript = sessionMode === "script";
			async function generateGuided() {
				const guide = guidance.trim();
				const messageId = panel.messageId;
				setCandidateGuidePanel({ sessionId: props.sessionId, messageId: messageId, phase: "loading", error: "", previous: panel.previous });
				try {
					const result = await rpc("generateChoices", { messageId: messageId, guidance: guide }, props.sessionId);
					setCandidatePanel(readyCandidatePanel(props.sessionId, messageId, result.candidates));
					setCandidateGuidePanel(null);
				} catch (err) {
					setCandidateGuidePanel({ sessionId: props.sessionId, messageId: messageId, phase: "input", error: String(err && err.message || err), previous: panel.previous });
				}
			}
			function cancel() {
				setCandidateGuidePanel(null);
				if (panel.previous) setCandidatePanel(panel.previous);
			}
			const body = panel.phase === "loading"
				? h("div", { className: "dsh-tavern-question-sub" }, "正在重新生成候选项…")
				: h(React.Fragment, null,
					panel.error ? h("div", { className: "dsh-tavern-choice-error" }, panel.error) : null,
					h("textarea", {
						className: "dsh-tavern-regen-input",
						rows: 2,
						value: guidance,
						placeholder: isScript ? "对候选的要求（可选）：例如“侧重角色行动”“直接开新场景”" : "对候选的要求（可选）：例如“多点暧昧动作”“场景换到白天户外”“新场景换一批人物”",
						onChange: function (e) { setGuidance(e.target.value); }
					}),
					h("div", { className: "dsh-tavern-question-foot" },
						h("button", { className: "dsh-tavern-question-primary", disabled: panel.phase === "loading", onClick: generateGuided }, "按此意见重新生成"),
						h("button", { className: "dsh-tavern-question-free", onClick: cancel }, "取消")
					)
				);
			return h("div", { className: "dsh-tavern-question" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "重新生成候选项"), h("span", { className: "dsh-tavern-question-sub" }, isScript ? "可填写意见；由于跟随剧本，只会重新生成一个推荐候选项" : "可填写意见，行动候选与场景候选通用")),
				body
			);
		}

		function RegenPanel(props) {
			const panel = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const [guidance, setGuidance] = React.useState("");
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || running || !panel || panel.sessionId !== props.sessionId) return null;
			function call(method, args) { return rpc(method, args, props.sessionId); }
			async function generate() {
				const guide = guidance.trim();
				setRegenPanel(Object.assign({}, panel, { phase: "loading", error: "" }));
				try {
					const res = await call("regenBody", { guidance: guide });
					const adopted = res.view && res.view.adopted ? res.view.adopted : null;
					if (adopted && Number(adopted.hiddenTurn) > 0) recordHiddenTurn(props.sessionId, Number(adopted.hiddenTurn));
					if (adopted && Number(adopted.syntheticTurn) > 0) recordHiddenRegenUserTurn(props.sessionId, Number(adopted.syntheticTurn));
					hideTurnTail(panel.tail);
					applyHiddenTurns(props.sessionId);
					applyHiddenRegenUserTurns(props.sessionId);
					setRegenPanel(null);
					setCandidatePanel(null);
				} catch (err) {
					setRegenPanel(Object.assign({}, panel, { phase: "error", error: String(err && err.message || err) }));
				}
			}
			const body = panel.phase === "loading"
				? h("div", { className: "dsh-tavern-question-sub" }, "正在重新生成正文…")
				: h(React.Fragment, null,
						panel.error ? h("div", { className: "dsh-tavern-choice-error" }, panel.error) : null,
						h("textarea", {
							className: "dsh-tavern-regen-input",
							rows: 2,
							value: guidance,
							placeholder: "指导意见（可选）：例如“写得更长，侧重心理描写”",
							onChange: function (e) { setGuidance(e.target.value); }
						}),
						h("div", { className: "dsh-tavern-question-foot" },
							h("button", { className: "dsh-tavern-question-primary", disabled: panel.phase === "loading", onClick: generate }, "生成并替换正文"),
							h("button", { className: "dsh-tavern-question-free", onClick: function () { setRegenPanel(null); } }, "取消")
						)
					);
			return h("div", { className: "dsh-tavern-question" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "重新生成正文"), h("span", { className: "dsh-tavern-question-sub" }, "生成后直接替换当前正文")),
				body
			);
		}

		const inject = ["slots", "sessions", "workspaces", "layout", "connection"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;
			ctx.effect(function () {
				document.body.classList.add("dsh-tavern-shell-active");
				return function () { document.body.classList.remove("dsh-tavern-shell-active"); };
			}, "dsh-tavern: shell marker");
			ctx.effect(() => slots.inject("sidebar.workspaces", () => slots.register(
				{ name: "sidebar.workspaces", priority: -1 },
				function (props) { return React.createElement(TavernSidebar, Object.assign({}, props, {
					collapsed: !props.wide,
					embedded: true,
					sessions: ctx.sessions,
					workspaces: ctx.workspaces,
					connection: ctx.get("connection"),
					renameSession: async function (sessionId, title) {
						const session = ctx.sessions.binding(sessionId)?.session;
						if (session === undefined) throw new Error("找不到该对话");
						const result = await session.rename(title);
						if (!result.ok) throw new Error(result.error.message);
					},
					archiveSession: function (sessionId) { return ctx.workspaces.archiveSession(sessionId); },
					toggleSidebar: function () { if (props.wide) ctx.layout.toggleSidebar(); else props.expandSidebar(); },
					openDetails: function () { ctx.layout.openDetails(); }
				})); }
			)), "dsh-tavern: Tavern workspace browser");
			ctx.effect(() => slots.inject("details", () => slots.register(
				{ name: "details", priority: -1 },
				function (props) { return React.createElement(TavernStatusPanel, props); }
			)), "dsh-tavern: persistent status panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-actions", order: -130, label: "候选项操作" },
				function (props) { return React.createElement(CandidateDockActions, props); }
			)), "dsh-tavern: candidate dock actions");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-question", order: -120, label: "下一步行动" },
				function (props) { return React.createElement(CandidateQuestion, Object.assign({}, props, { sessions: ctx.sessions })); }
			)), "dsh-tavern: candidate question panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-guide", order: -115, label: "重新生成候选项" },
				function (props) { return React.createElement(CandidateGuidePanel, props); }
			)), "dsh-tavern: candidate guide panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-regen", order: -110, label: "重新生成正文" },
				function (props) { return React.createElement(RegenPanel, props); }
			)), "dsh-tavern: regen body panel");

		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
