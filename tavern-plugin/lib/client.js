window.__ModuleLoader__.load({
	id: "dsh-tavern-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		let ReactDOM = require("react-dom");

		const TAVERN_CSS = `
.dsh-tavern-root {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 50% -20%, rgba(151, 96, 42, .28), transparent 42%),
    linear-gradient(180deg, #17120f 0%, #100d0c 100%);
  color: #eee6da;
  font-size: 14px;
  pointer-events: auto;
  overflow: hidden;
}
html[data-dsh-tavern-profile="true"] [data-conversation-scroll] {
  position: relative;
  overflow: hidden;
}
html[data-dsh-tavern-profile="true"] [data-composer-seat] {
  position: relative;
  z-index: 30;
}
.dsh-tavern-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 0 20px;
  background: linear-gradient(180deg, rgba(49,35,27,.98), rgba(31,24,20,.98));
  border-bottom: 1px solid #5a402a;
  box-shadow: 0 3px 18px rgba(0,0,0,.3);
  user-select: none;
}
.dsh-tavern-title { font-size: 17px; font-weight: 800; letter-spacing: .08em; color: #efc879; white-space: nowrap; }
.dsh-tavern-subtitle { color: #c8ad89; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
.dsh-tavern-spacer { flex: 1 1 auto; }
.dsh-tavern-chip {
  font-size: 12px; padding: 2px 8px; border-radius: 999px;
  background: #262631; color: #9a97a5; white-space: nowrap;
}
.dsh-tavern-chip.running { color: #f0c060; }
.dsh-tavern-chip.done { color: #7fd08a; }
.dsh-tavern-chip.error { color: #e07b7b; }
.dsh-tavern-btn {
  background: #2a2a36; color: #e8e6e3; border: 1px solid #3f3f4d;
  border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px;
}
.dsh-tavern-btn:hover { background: #34343f; }
.dsh-tavern-btn:disabled { opacity: .45; cursor: default; }
.dsh-tavern-body { flex: 1 1 auto; display: flex; min-height: 0; }
.dsh-tavern-cards {
  width: 216px; min-width: 216px; border-right: 1px solid #3b2b23;
  background: #171310; overflow-y: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 8px;
}
.dsh-tavern-panel-title { font-size: 12px; color: #9a97a5; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
.dsh-tavern-card-item {
  background: #241d18; border: 1px solid #4b392d; border-radius: 8px;
  padding: 8px; cursor: pointer;
}
.dsh-tavern-card-item:hover { border-color: #b98245; }
.dsh-tavern-card-item.active { border-color: #b98245; background: #26283a; }
.dsh-tavern-card-name { font-weight: 700; color: #f0c060; display: flex; justify-content: space-between; }
.dsh-tavern-card-desc {
  font-size: 12px; color: #9a97a5; margin-top: 4px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.dsh-tavern-x {
  background: none; border: none; color: #6b6878; cursor: pointer; font-size: 12px; padding: 0 2px;
}
.dsh-tavern-x:hover { color: #e07b7b; }
.dsh-tavern-chat { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.dsh-tavern-scroll { flex: 1 1 auto; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.dsh-tavern-msg { max-width: 82%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; }
.dsh-tavern-msg.user { align-self: flex-end; background: #2a3f5f; border-bottom-right-radius: 2px; }
.dsh-tavern-msg.assistant { align-self: flex-start; background: #272733; border: 1px solid #35354a; border-bottom-left-radius: 2px; }
.dsh-tavern-msg-name { font-size: 11px; color: #8d8aa0; margin-bottom: 3px; }
.dsh-tavern-msg.user .dsh-tavern-msg-name { color: #7fa7d8; text-align: right; }
.dsh-tavern-candidates { border-top: 1px dashed #3a3a46; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; max-height: 42%; overflow-y: auto; background: #15110f; }
.dsh-tavern-cand-head { font-size: 12px; color: #9a97a5; display: flex; justify-content: space-between; align-items: center; }
.dsh-tavern-cand {
  background: #241d18; border: 1px solid #4b392d; border-radius: 8px; padding: 8px 10px;
  cursor: pointer; white-space: pre-wrap; font-size: 13px; line-height: 1.5;
}
.dsh-tavern-cand:hover { border-color: #b98245; }
.dsh-tavern-cand-badge { color: #b98245; font-size: 11px; margin-right: 6px; }
.dsh-tavern-cand-error { color: #e07b7b; }
.dsh-tavern-empty { margin: auto; text-align: center; color: #6b6878; padding: 24px; line-height: 1.8; white-space: pre-wrap; }
.dsh-tavern-error { background: #3a2226; color: #e07b7b; border: 1px solid #5a3038; border-radius: 6px; padding: 6px 10px; margin: 8px 12px; font-size: 12px; }
.dsh-tavern-lore {
  width: 252px; min-width: 252px; border-left: 1px solid #3b2b23;
  background: #171310; overflow-y: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 8px;
}
.dsh-tavern-lore-item {
  background: #241d18; border: 1px solid #4b392d; border-radius: 8px; padding: 7px 9px; font-size: 12px;
}
.dsh-tavern-lore-item.dsh-tavern-posture { border-color: #b98245; }
.dsh-tavern-lore-type { color: #f0c060; font-size: 11px; margin-bottom: 3px; display: flex; justify-content: space-between; }
.dsh-tavern-lore-content { line-height: 1.5; color: #cfccd8; white-space: pre-wrap; word-break: break-word; }
.dsh-tavern-input { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #3b2b23; background: #171310; }
.dsh-tavern-input textarea {
  flex: 1 1 auto; resize: none; height: 44px; background: #241d18; color: #e8e6e3;
  border: 1px solid #3f3f4d; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit;
}
.dsh-tavern-input textarea:focus { outline: none; border-color: #b98245; }
.dsh-tavern-send { background: #b98245; color: #fff; border: none; border-radius: 8px; padding: 0 18px; font-weight: 600; cursor: pointer; }
.dsh-tavern-send:hover { background: #7d9aff; }
.dsh-tavern-send:disabled { opacity: .5; cursor: default; }
.dsh-tavern-settings {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px; border-top: 1px solid #3b2b23; background: #15110f; font-size: 12px; color: #9a97a5;
}
.dsh-tavern-settings input { width: 64px; background: #241d18; color: #e8e6e3; border: 1px solid #3f3f4d; border-radius: 6px; padding: 3px 6px; }
.dsh-tavern-dock {
  width: 100%; box-sizing: border-box; color: #d8c9b7;
  background: linear-gradient(180deg, rgba(54,39,29,.96), rgba(35,27,22,.96));
  border: 1px solid #684b32; border-radius: 10px; overflow: hidden;
}
.dsh-tavern-dockbar { min-height: 36px; padding: 6px 10px; display: flex; align-items: center; gap: 8px; }
.dsh-tavern-dockbar strong { color: #efc879; white-space: nowrap; }
.dsh-tavern-dockbar select {
  min-width: 120px; max-width: 240px; color: #eee6da; background: #241d18;
  border: 1px solid #5c4433; border-radius: 6px; padding: 4px 7px;
}
.dsh-tavern-dock-note { color: #a99580; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-dock-detail { border-top: 1px solid #513a29; padding: 8px 10px; max-height: 180px; overflow: auto; font-size: 12px; line-height: 1.55; }
.dsh-tavern-dock-lore { margin-top: 5px; padding-left: 18px; }
.dsh-tavern-dock-error { color: #ef8f8f; padding: 0 10px 7px; font-size: 12px; }
.dsh-tavern-opening { padding: 10px 12px; border-top: 1px solid #513a29; color: #e6d8c7; line-height: 1.65; white-space: pre-wrap; }
.dsh-tavern-opening-label { margin-bottom: 4px; color: #b98550; font-size: 11px; font-weight: 700; }
.dsh-tavern-sidebar { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; padding: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-sidebar.collapsed { padding: 12px 10px; align-items: center; }
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
.dsh-tavern-choice-wrap { position: relative; display: inline-flex; }
.dsh-tavern-choice-trigger { border: 1px solid rgba(166,107,53,.55); background: rgba(166,107,53,.10); color: #a66b35; cursor: pointer; padding: 3px 9px; border-radius: 7px; font-size: 12px; font-weight: 650; }
.dsh-tavern-choice-trigger:hover { background: rgba(166,107,53,.20); color: #8e5728; }
.dsh-tavern-choice-pop { position: absolute; z-index: 120; left: 0; bottom: calc(100% + 7px); width: 340px; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-specific-popover-fill, var(--dsw-specific-sidebar-fill)); box-shadow: 0 12px 30px rgba(0,0,0,.22); }
.dsh-tavern-choice-item { width: 100%; display: block; margin-top: 5px; padding: 8px 9px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary); text-align: left; line-height: 1.45; cursor: pointer; }
.dsh-tavern-choice-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
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
.dsh-tavern-question-tag-npc { color: #7a8c5c; background: rgba(122,140,92,.15); }
.dsh-tavern-question-tag-scene { color: #6b7fa3; background: rgba(107,127,163,.16); }
.dsh-tavern-question-tag-scene2 { color: #8b6f9e; background: rgba(139,111,158,.16); }
.dsh-tavern-question-free { width: 100%; margin-top: 6px; padding: 8px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary); text-align: left; cursor: pointer; }
.dsh-tavern-question-free:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-question-foot { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
.dsh-tavern-question-primary { border: 0; border-radius: 8px; padding: 6px 12px; background: var(--dsw-alias-button-info-fill); color: #fff; cursor: pointer; }
.dsh-tavern-question-primary:disabled { opacity: .45; cursor: default; }
.dsh-tavern-regen-input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; resize: vertical; }
.dsh-tavern-regen-text { margin-top: 6px; padding: 9px 10px; border: 1px solid rgba(166,107,53,.30); border-radius: 9px; background: rgba(166,107,53,.08); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.dsh-tavern-regen-guide-note { margin-top: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
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
.dsh-tavern-card-save { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: 10px 0 2px; background: linear-gradient(transparent, var(--dsw-specific-sidebar-fill) 28%); }
.dsh-tavern-script-row { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l3); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-tavern-script-info { flex: 1; min-width: 150px; line-height: 1.5; }
.dsh-tavern-script-info b { color: #a66b35; }
@keyframes dsh-tavern-pulse { from { opacity: .35; } to { opacity: 1; } }
.dsh-card-studio { position: fixed; z-index: 500; inset: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dsh-card-studio-head { height: 58px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 18px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-card-studio-title { font-size: 17px; font-weight: 800; color: #9a622f; }
.dsh-card-studio-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 260px minmax(0,1fr); }
.dsh-card-library { min-height: 0; overflow-y: auto; padding: 12px; border-right: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-sidebar-fill); }
.dsh-card-library-tools { display: flex; gap: 6px; margin-bottom: 10px; }
.dsh-card-library-item { width: 100%; margin-bottom: 5px; padding: 9px 10px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-card-library-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-card-library-item.active { border-color: rgba(166,107,53,.45); background: rgba(166,107,53,.10); }
.dsh-card-library-name { font-weight: 700; }
.dsh-card-library-meta { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-card-workspace { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dsh-card-tabs { height: 46px; flex: none; display: flex; align-items: end; gap: 22px; padding: 0 22px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-card-tab { height: 38px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-card-tab.active { color: #9a622f; border-bottom-color: #9a622f; font-weight: 700; }
.dsh-card-editor { flex: 1; min-height: 0; overflow-y: auto; padding: 20px max(24px, calc((100% - 900px)/2)); }
.dsh-card-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.dsh-card-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.dsh-card-field.wide { grid-column: 1 / -1; }
.dsh-card-field label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 700; }
.dsh-card-field input,.dsh-card-field textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); padding: 9px 10px; font: inherit; line-height: 1.5; outline: none; }
.dsh-card-field textarea { min-height: 110px; resize: vertical; }
.dsh-card-field textarea.tall { min-height: 190px; }
.dsh-card-field input:focus,.dsh-card-field textarea:focus { border-color: #a66b35; }
.dsh-card-editor-actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 0; background: linear-gradient(transparent, var(--dsw-alias-bg-base) 25%); }
.dsh-card-primary { border: 0; border-radius: 8px; padding: 7px 14px; background: #9a622f; color: white; cursor: pointer; }
.dsh-card-reviser { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0,1fr) 360px; }
.dsh-card-revise-info { overflow-y: auto; padding: 26px max(24px, calc((100% - 720px)/2)); }
.dsh-card-revise-chat { min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-sidebar-fill); }
.dsh-card-revise-log { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; }
.dsh-card-revise-entry { margin-bottom: 10px; padding: 9px 10px; border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); font-size: 12px; line-height: 1.55; white-space: pre-wrap; }
.dsh-card-revise-entry.user { margin-left: 28px; background: rgba(97,135,216,.14); }
.dsh-card-revise-entry.assistant { margin-right: 28px; }
.dsh-card-revise-speaker { display: block; margin-bottom: 3px; color: #a66b35; font-size: 10px; font-weight: 700; }
.dsh-card-revise-applied { margin-top: 6px; color: #6d9a68; font-size: 11px; }
.dsh-card-revise-compose { flex: none; padding: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-card-revise-compose textarea { box-sizing: border-box; width: 100%; min-height: 100px; resize: vertical; padding: 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-specific-input-major); color: inherit; font: inherit; }
.dsh-card-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.65; }
.dsh-card-error { color: #c45f5f; font-size: 12px; }
@media (max-width: 820px) {
  .dsh-tavern-head { padding: 0 10px; gap: 6px; }
  .dsh-tavern-subtitle { display: none; }
  .dsh-tavern-cards { width: 150px; min-width: 150px; }
  .dsh-tavern-lore { position: absolute; z-index: 2; right: 0; top: 54px; bottom: 66px; box-shadow: -12px 0 28px rgba(0,0,0,.45); }
  .dsh-tavern-question { width: calc(100% - 24px); }
  .dsh-card-studio-body { grid-template-columns: 180px minmax(0,1fr); }
  .dsh-card-form-grid,.dsh-card-reviser { grid-template-columns: 1fr; }
  .dsh-card-revise-chat { border-left: 0; border-top: 1px solid var(--dsw-alias-border-l2); }
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
		function isCardMode(mode) {
			return mode === "revision" || mode === "extract";
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


		function settleChip(view) {
			if (view === null) return null;
			let text = "就绪";
			if (view.settleStatus === "running") text = "结算中…";
			else if (view.settleStatus === "error") text = "结算失败";
			else if (view.settleStatus === "done") {
				const s = view.lastSettle;
				text = "结算完成";
				if (s !== null && s !== undefined && typeof s.facts === "number") text += " (" + s.facts + " 条 · " + (s.chars || 0) + " 字)";
			}
			return React.createElement("span", { className: "dsh-tavern-chip " + (view.settleStatus || "idle") }, text);
		}

		function TavernWindow(props) {
			const sessionId = props.sessionId;
			const onExit = props.onExit;
			function call(method, args) {
				const payload = Object.assign({}, args === undefined ? {} : args);
				if (sessionId !== undefined && sessionId !== null && sessionId !== "") payload.sessionId = sessionId;
				return fetch("/api/dsh-tavern/" + method, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				}).then(function (r) { return r.json(); });
			}
			const [cards, setCards] = React.useState([]);
			const [view, setView] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [input, setInput] = React.useState("");
			const [showLore, setShowLore] = React.useState(true);
			const [showSettings, setShowSettings] = React.useState(false);
			const [settings, setSettings] = React.useState(null);
			const [importing, setImporting] = React.useState(false);
			const fileRef = React.useRef(null);
			const bottomRef = React.useRef(null);

			function fail(err) {
				setError(String(err && err.message || err));
			}
			function applyRes(res) {
				if (res !== null && res !== undefined && res.ok) return res;
				throw new Error(res && res.error ? res.error : "操作失败");
			}
			async function refreshCards() {
				try {
					const res = await call("listCards");
					if (res !== null && res !== undefined && res.ok) setCards(res.cards || []);
				} catch (err) { fail(err); }
			}
			async function openCard(cardId) {
				setBusy(true); setError("");
				try {
					const res = await call("startChat", { cardId: cardId });
					setView(applyRes(res).view);
				} catch (err) { fail(err); } finally { setBusy(false); }
			}
			async function doImport(file) {
				setImporting(true); setError("");
				try {
					const payload = await parseCardFile(file);
					const res = await call("importCard", { payload: payload });
					const card = applyRes(res).card;
					await refreshCards();
					await openCard(card.id);
				} catch (err) { fail(err); } finally { setImporting(false); }
			}
			async function doSend() {
				const text = input.trim();
				if (text === "" || view === null || busy) return;
				setInput(""); setBusy(true); setError("");
				try {
					const res = await call("generate", { chatId: view.chatId, text: text });
					setView(applyRes(res).view);
				} catch (err) { fail(err); } finally { setBusy(false); }
			}
			async function doChoose(index) {
				if (view === null || busy) return;
				setBusy(true); setError("");
				try {
					const res = await call("choose", { chatId: view.chatId, index: index });
					setView(applyRes(res).view);
				} catch (err) { fail(err); } finally { setBusy(false); }
			}
			async function doReroll() {
				if (view === null || busy) return;
				setBusy(true); setError("");
				try {
					const res = await call("reroll", { chatId: view.chatId });
					setView(applyRes(res).view);
				} catch (err) { fail(err); } finally { setBusy(false); }
			}
			async function doSettleNow() {
				if (view === null || busy) return;
				setBusy(true); setError("");
				try {
					const res = await call("settleNow", { chatId: view.chatId });
					setView(applyRes(res).view);
				} catch (err) { fail(err); } finally { setBusy(false); }
			}
			async function doDeleteLore(loreId) {
				if (view === null) return;
				try {
					const res = await call("deleteLore", { chatId: view.chatId, loreId: loreId });
					setView(applyRes(res).view);
				} catch (err) { fail(err); }
			}
			async function doDeleteCard(cardId, e) {
				e.stopPropagation();
				try {
					await call("deleteCard", { cardId: cardId });
					if (view !== null && view.card.id === cardId) setView(null);
					await refreshCards();
				} catch (err) { fail(err); }
			}
			async function doResetChat() {
				if (view === null || busy) return;
				setBusy(true); setError("");
				try {
					await call("deleteChat", { chatId: view.chatId });
					const res = await call("startChat", { cardId: view.card.id });
					setView(applyRes(res).view);
				} catch (err) { fail(err); } finally { setBusy(false); }
			}
			async function doSaveSettings() {
				try {
					const res = await call("setSettings", {
						candidates: Number(settings.candidates),
						temperature: Number(settings.temperature)
					});
					setSettings(applyRes(res).settings);
				} catch (err) { fail(err); }
			}

			React.useEffect(function () {
				refreshCards();
				call("getSettings").then(function (res) {
					if (res !== null && res !== undefined && res.ok) setSettings(res.settings);
				}, function () {});
			}, []);

			React.useEffect(function () {
				if (view === null || view.settleStatus !== "running") return;
				const chatId = view.chatId;
				const timer = window.setInterval(function () {
					call("getChat", { chatId: chatId }).then(function (res) {
						if (res !== null && res !== undefined && res.ok && res.view) setView(res.view);
					}, function () {});
				}, 2000);
				return function () { window.clearInterval(timer); };
			}, [view === null ? "" : view.settleStatus + "|" + view.chatId]);

			React.useEffect(function () {
				if (bottomRef.current !== null && typeof bottomRef.current.scrollIntoView === "function") {
					bottomRef.current.scrollIntoView({ block: "end" });
				}
			}, [view === null ? "" : view.messages.length + "|" + (view.pending !== null && view.pending !== undefined ? view.pending.candidates.length : 0)]);

			const h = React.createElement;
			const header = h("div", { className: "dsh-tavern-head" },
				h("span", { className: "dsh-tavern-title" }, "🍺 DSH 酒馆"),
				view !== null ? h("span", { className: "dsh-tavern-subtitle" }, "正在游玩 · " + view.card.name) : h("span", { className: "dsh-tavern-subtitle" }, "选择人物卡，进入故事"),
				h("div", { className: "dsh-tavern-spacer" }),
				h("button", { className: "dsh-tavern-btn", onClick: onExit, title: "退出酒馆并返回普通 DSH 会话" }, "退出酒馆"),
				settleChip(view),
				view !== null ? h("button", { className: "dsh-tavern-btn", onClick: doResetChat, disabled: busy, title: "重新开始当前故事" }, "重新开始") : null,
				h("button", { className: "dsh-tavern-btn", onClick: function () { setShowLore(!showLore); }, title: "显示或隐藏世界状态" }, showLore ? "隐藏记忆" : "显示记忆"),
				h("button", { className: "dsh-tavern-btn", onClick: function () { setShowSettings(!showSettings); }, title: "游戏生成设置" }, "游戏设置")
			);

			const cardItems = cards.map(function (c) {
				const active = view !== null && view.card.id === c.id;
				return h("div", {
					key: c.id,
					className: "dsh-tavern-card-item" + (active ? " active" : ""),
					onClick: function () { openCard(c.id); }
				},
					h("div", { className: "dsh-tavern-card-name" },
						h("span", null, c.name),
						h("button", { className: "dsh-tavern-x", title: "删除卡片", onClick: function (e) { doDeleteCard(c.id, e); } }, "✕")
					),
					c.description ? h("div", { className: "dsh-tavern-card-desc" }, c.description) : null
				);
			});
			const cardsPanel = h("div", { className: "dsh-tavern-cards" },
				h("div", { className: "dsh-tavern-panel-title" },
					h("span", null, "人物卡 (" + cards.length + ")"),
					h("button", {
						className: "dsh-tavern-btn",
						disabled: importing,
						onClick: function () { if (fileRef.current !== null) fileRef.current.click(); }
					}, importing ? "导入中…" : "导入")
				),
				h("input", {
					ref: fileRef,
					type: "file",
					accept: ".png,.json",
					style: { display: "none" },
					onChange: function (e) {
						const f = e.target.files && e.target.files[0];
						if (f !== undefined && f !== null) doImport(f);
						e.target.value = "";
					}
				}),
				cardItems.length > 0 ? cardItems : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡。\n点击“导入”选择 PNG 或 JSON 人物卡。")
			);

			let chatBody;
			if (view === null) {
				chatBody = h("div", { className: "dsh-tavern-empty" },
					"欢迎来到 dsh-tavern 🍺\n\n人物卡即小说的开头与隐藏设定：选择或导入一张卡（PNG/JSON），开始续写小说。\n每轮生成多段候选正文，点击即可采纳；采纳后自动结算重要信息并持续注入，防止遗忘。"
				);
			} else {
				const msgs = (view.messages || []).map(function (m, i) {
					const isUser = m.role === "user";
					return h("div", { key: i, className: "dsh-tavern-msg " + (isUser ? "user" : "assistant") },
						h("div", { className: "dsh-tavern-msg-name" }, isUser ? "玩家" : "正文"),
						h("div", null, m.text)
					);
				});
				let candidates = null;
				if (view.pending !== null && view.pending !== undefined) {
					const cands = view.pending.candidates.map(function (c) {
						return h("div", {
							key: c.index,
							className: "dsh-tavern-cand" + (c.error ? " dsh-tavern-cand-error" : ""),
							onClick: c.error ? undefined : function () { doChoose(c.index); }
						},
							c.error
								? h("span", null, h("b", null, "候选 " + (c.index + 1) + " 生成失败: "), c.error)
								: h("span", null, h("span", { className: "dsh-tavern-cand-badge" }, "候选 " + (c.index + 1)), c.text)
						);
					});
					candidates = h("div", { className: "dsh-tavern-candidates" },
						h("div", { className: "dsh-tavern-cand-head" },
							h("span", null, "选择一段正文（点击候选即采纳）"),
							h("button", { className: "dsh-tavern-btn", onClick: doReroll, disabled: busy }, busy ? "生成中…" : "重新生成")
						),
						cands
					);
				}
				chatBody = h(React.Fragment, null,
					h("div", { className: "dsh-tavern-scroll" }, msgs, h("div", { ref: bottomRef })),
					candidates
				);
			}
			const chatPanel = h("div", { className: "dsh-tavern-chat" },
				error !== "" ? h("div", { className: "dsh-tavern-error" }, error) : null,
				chatBody
			);

			let lorePanel = null;
			if (showLore && view !== null) {
				let chars = 0;
				for (let i = 0; i < (view.lore || []).length; i++) chars += String(view.lore[i].content || "").length;
				const items = (view.lore || []).map(function (e) {
					return h("div", { key: e.id, className: "dsh-tavern-lore-item" },
						h("div", { className: "dsh-tavern-lore-type" },
							h("span", null, "[" + (e.type || "其他") + "]"),
							h("button", { className: "dsh-tavern-x", title: "删除记忆", onClick: function () { doDeleteLore(e.id); } }, "✕")
						),
						h("div", { className: "dsh-tavern-lore-content" }, e.content)
					);
				});
				lorePanel = h("div", { className: "dsh-tavern-lore" },
					h("div", { className: "dsh-tavern-panel-title" },
						h("span", null, "重要信息 (" + (view.lore || []).length + " 条 · " + chars + " 字)"),
						h("button", { className: "dsh-tavern-btn", onClick: doSettleNow, disabled: busy || view.settleStatus === "running", title: "立即结算最新一轮" }, "立即结算")
					),
					(view.posture !== undefined && view.posture !== null && String(view.posture) !== "") ? h("div", { className: "dsh-tavern-lore-item dsh-tavern-posture" },
						h("div", { className: "dsh-tavern-lore-type" }, h("span", null, "【现场 · 姿势】")),
						h("div", { className: "dsh-tavern-lore-content" }, view.posture)
					) : null,
					items.length > 0 ? items : h("div", { className: "dsh-tavern-empty" }, "暂无结算信息。\n选择回复后会自动结算。"),
					view.settleStatus === "error" && view.settleError ? h("div", { className: "dsh-tavern-error" }, "结算失败: " + view.settleError) : null
				);
			}

			const inputRow = h("div", { className: "dsh-tavern-input" },
				h("textarea", {
					value: input,
					placeholder: view === null ? "先选择一张人物卡…" : "输入消息，Enter 发送，Shift+Enter 换行",
					disabled: view === null || busy,
					onChange: function (e) { setInput(e.target.value); },
					onKeyDown: function (e) {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							doSend();
						}
					}
				}),
				h("button", { className: "dsh-tavern-send", disabled: view === null || busy, onClick: doSend }, busy ? "生成中…" : "发送")
			);

			let settingsRow = null;
			if (showSettings && settings !== null && settings !== undefined) {
				settingsRow = h("div", { className: "dsh-tavern-settings" },
					h("span", null, "候选数"),
					h("input", {
						type: "number", min: 1, max: 6, value: settings.candidates,
						onChange: function (e) { setSettings(Object.assign({}, settings, { candidates: e.target.value })); }
					}),
					h("span", null, "温度"),
					h("input", {
						type: "number", min: 0, max: 1.5, step: 0.1, value: settings.temperature,
						onChange: function (e) { setSettings(Object.assign({}, settings, { temperature: e.target.value })); }
					}),
					h("button", { className: "dsh-tavern-btn", onClick: doSaveSettings }, "保存"),
					h("span", null, "数据目录: 工作区 /dsh-tavern")
				);
			}

			return h("div", { className: "dsh-tavern-root" },
				header,
				h("div", { className: "dsh-tavern-body" }, cardsPanel, chatPanel, lorePanel),
				inputRow,
				settingsRow
			);
		}

		function TavernContent(props) {
			const [target, setTarget] = React.useState(null);
			React.useLayoutEffect(function () {
				if (typeof document === "undefined") return;
				document.documentElement.dataset.dshTavernProfile = "true";
				let cancelled = false;
				function findTarget() {
					if (cancelled) return;
					const next = document.querySelector("[data-conversation-scroll]");
					if (next !== null) setTarget(next);
					else window.requestAnimationFrame(findTarget);
				}
				findTarget();
				return function () {
					cancelled = true;
					delete document.documentElement.dataset.dshTavernProfile;
				};
			}, []);
			if (target === null) return null;
			return ReactDOM.createPortal(React.createElement(TavernWindow, props), target);
		}

		function TavernDock(props) {
			const sessionId = props.sessionId;
			const [cards, setCards] = React.useState([]);
			const [view, setView] = React.useState(null);
			const [expanded, setExpanded] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const fileRef = React.useRef(null);
			function call(method, args) {
				return fetch("/api/dsh-tavern/" + method, {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify(Object.assign({}, args || {}, { sessionId: sessionId }))
				}).then(function (r) { return r.json(); }).then(function (res) {
					if (!res || !res.ok) throw new Error(res && res.error ? res.error : "操作失败");
					return res;
				});
			}
			function refresh() {
				return Promise.all([call("listCards"), call("getSession")]).then(function (all) {
					setCards(all[0].cards || []); setView(all[1].view || null); setError("");
				}, function (err) { setError(String(err && err.message || err)); });
			}
			React.useEffect(function () {
				refresh();
				function changed(e) { if (!e.detail || e.detail.sessionId === sessionId) refresh(); }
				window.addEventListener("dsh-tavern-session-changed", changed);
				return function () { window.removeEventListener("dsh-tavern-session-changed", changed); };
			}, [sessionId]);
			React.useEffect(function () {
				if (!view || view.settleStatus !== "running") return;
				const timer = window.setInterval(refresh, 1800);
				return function () { window.clearInterval(timer); };
			}, [view ? view.settleStatus + "|" + view.chatId : ""]);
			async function chooseCard(cardId) {
				if (!cardId) return;
				setBusy(true); setError("");
				try { const res = await call("startChat", { cardId: cardId }); setView(res.view); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importCard(file) {
				setBusy(true); setError("");
				try {
					const payload = await parseCardFile(file);
					const imported = await call("importCard", { payload: payload });
					await refresh(); await chooseCard(imported.card.id);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function chooseGreeting(index) {
				if (!view || busy) return;
				setBusy(true); setError("");
				try { const res = await call("chooseGreeting", { chatId: view.chatId, index: index }); setView(res.view); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			const h = React.createElement;
			const selected = view ? view.card.id : "";
			const status = view && view.settleStatus === "running" ? "正在整理记忆…" : (view ? ((view.lore || []).length + " 条记忆") : "先选择人物卡");
			const greeting = view && (view.messages || []).length === 1 && view.messages[0].greeting === true ? view.messages[0].text : "";
			const greetingOptions = view ? [view.card.opening].concat(view.card.alternateGreetings || []).filter(function (text) { return text; }) : [];
			return h("div", { className: "dsh-tavern-dock" },
				h("div", { className: "dsh-tavern-dockbar" },
					h("strong", null, view ? "🍺 " + view.card.name : "🍺 尚未选择人物卡"),
					h("span", { className: "dsh-tavern-dock-note" }, status),
					h("span", { className: "dsh-tavern-spacer" }),
					h("button", { className: "dsh-tavern-btn", disabled: !view, onClick: function () { setExpanded(!expanded); } }, expanded ? "收起" : "记忆")
				),
				error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
				greeting ? h("div", { className: "dsh-tavern-opening" },
					h("div", { className: "dsh-tavern-opening-label" }, "开场白"),
					h("div", null, greeting),
					greetingOptions.length > 1 ? h("div", { style: { marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" } }, greetingOptions.map(function (text, index) {
						return h("button", { key: index, className: "dsh-tavern-btn", disabled: busy || text === greeting, onClick: function () { chooseGreeting(index); } }, "候选 " + (index + 1));
					})) : null
				) : null,
				expanded && view ? h("div", { className: "dsh-tavern-dock-detail" },
					view.card.description ? h("div", null, view.card.description) : null,
					view.posture ? h("div", null, h("b", null, "当前状态："), view.posture) : null,
					(view.lore || []).length ? h("ul", { className: "dsh-tavern-dock-lore" }, (view.lore || []).map(function (item) { return h("li", { key: item.id }, "[" + (item.type || "其他") + "] " + item.content); })) : h("div", null, "暂无长期记忆")
				) : null
			);
		}

		function CardStudio(props) {
			const [cards, setCards] = React.useState([]);
			const [selectedId, setSelectedId] = React.useState("");
			const [card, setCard] = React.useState(null);
			const [draft, setDraft] = React.useState(null);
			const [mode, setMode] = React.useState("edit");
			const [instruction, setInstruction] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const fileRef = React.useRef(null);
			function call(method, args) {
				return fetch("/api/dsh-tavern/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args || {}) })
					.then(function (r) { return r.json(); }).then(function (res) { if (!res || !res.ok) throw new Error(res && res.error ? res.error : "操作失败"); return res; });
			}
			function cardDraft(value) {
				return {
					name: value.name || "", tags: (value.tags || []).join(", "), description: value.description || "", personality: value.personality || "",
					scenario: value.scenario || "", first_mes: value.first_mes || "", alternate_greetings: (value.alternate_greetings || []).join("\n---\n"),
					mes_example: value.mes_example || "", system_prompt: value.system_prompt || "", post_history_instructions: value.post_history_instructions || "",
					creator_notes: value.creator_notes || "", character_book: value.character_book ? JSON.stringify(value.character_book, null, 2) : ""
				};
			}
			async function loadCards(preferred) {
				const res = await call("listCards");
				const list = res.cards || []; setCards(list);
				const next = preferred || selectedId || (list[0] && list[0].id) || "";
				if (next) await loadCard(next); else { setSelectedId(""); setCard(null); setDraft(null); }
			}
			async function loadCard(id) {
				const res = await call("getCard", { cardId: id });
				setSelectedId(id); setCard(res.card); setDraft(cardDraft(res.card)); setError("");
			}
			React.useEffect(function () { loadCards().catch(function (err) { setError(String(err && err.message || err)); }); }, []);
			function setField(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				if (!card || !draft || busy) return;
				setBusy(true); setError("");
				try {
					let book = null;
					if (draft.character_book.trim()) book = JSON.parse(draft.character_book);
					const patch = Object.assign({}, draft, {
						tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean),
						alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean),
						character_book: book
					});
					const res = await call("updateCard", { cardId: card.id, patch: patch });
					setCard(res.card); setDraft(cardDraft(res.card)); await loadCards(res.card.id);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function revise() {
				if (!card || !instruction.trim() || busy) return;
				setBusy(true); setError("");
				try {
					const res = await call("reviseCard", { cardId: card.id, instruction: instruction, sessionId: props.sessionId });
					setInstruction(""); setCard(res.card); setDraft(cardDraft(res.card)); await loadCards(res.card.id);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function clearRevision() {
				if (!card || busy) return;
				setBusy(true); setError("");
				try { const res = await call("clearRevisionChat", { cardId: card.id }); setCard(res.card); setDraft(cardDraft(res.card)); }
				catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function createNew() {
				setBusy(true);
				try { const res = await call("createCard", { source: { name: "新人物" } }); await loadCards(res.card.id); setMode("edit"); }
				catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function importFile(file) {
				setBusy(true);
				try { const payload = await parseCardFile(file); const res = await call("importCard", { payload: payload }); await loadCards(res.card.id); }
				catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function duplicate() {
				if (!card) return; setBusy(true);
				try { const res = await call("duplicateCard", { cardId: card.id }); await loadCards(res.card.id); }
				catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function removeCard() {
				if (!card || busy) return;
				if (!window.confirm("确定删除“" + card.name + "”吗？该人物卡关联的酒馆历史也会一并删除。")) return;
				setBusy(true); setError("");
				try { await call("deleteCard", { cardId: card.id }); setSelectedId(""); await loadCards(""); }
				catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			function exportCard() {
				if (!card) return;
				const blob = new Blob([JSON.stringify({ spec: "chara_card_v3", spec_version: "3.0", data: card }, null, 2)], { type: "application/json" });
				const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = (card.name || "character") + ".json"; a.click(); URL.revokeObjectURL(url);
			}
			function Field(name, label, wide, tall) {
				return React.createElement("div", { className: "dsh-card-field" + (wide ? " wide" : "") },
					React.createElement("label", null, label),
					tall === false ? React.createElement("input", { value: draft[name], onChange: function (e) { setField(name, e.target.value); } }) : React.createElement("textarea", { className: tall === "tall" ? "tall" : "", value: draft[name], onChange: function (e) { setField(name, e.target.value); } })
				);
			}
			const h = React.createElement;
			const revisionMessages = card && Array.isArray(card.revision_chat) ? card.revision_chat : [];
			return h("div", { className: "dsh-card-studio" },
				h("header", { className: "dsh-card-studio-head" }, h("div", { className: "dsh-card-studio-title" }, "人物卡工作室"), h("span", { className: "dsh-card-hint" }, "管理设定 · 不进入游戏"), h("span", { className: "dsh-tavern-spacer" }), error ? h("span", { className: "dsh-card-error" }, error) : null, h("button", { className: "dsh-tavern-btn", onClick: props.onClose }, "返回酒馆")),
				h("div", { className: "dsh-card-studio-body" },
					h("aside", { className: "dsh-card-library" },
						h("div", { className: "dsh-card-library-tools" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: createNew }, "＋ 新建"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入")),
						h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importFile(f); e.target.value = ""; } }),
						cards.map(function (item) { return h("button", { key: item.id, className: "dsh-card-library-item" + (item.id === selectedId ? " active" : ""), onClick: function () { loadCard(item.id).catch(function (err) { setError(String(err && err.message || err)); }); } }, h("div", { className: "dsh-card-library-name" }, item.name), h("div", { className: "dsh-card-library-meta" }, (item.tags || []).join(" · ") || "未分类")); })
					),
					h("main", { className: "dsh-card-workspace" }, card && draft ? h(React.Fragment, null,
						h("div", { className: "dsh-card-tabs" }, h("button", { className: "dsh-card-tab active", onClick: function () { setMode("edit"); } }, "编辑人物卡"), h("button", { className: "dsh-card-tab", onClick: function () { props.onEnterRevision(card.id); } }, "进入设定模式")),
						mode === "edit" ? h("div", { className: "dsh-card-editor" },
							h("div", { className: "dsh-card-form-grid" }, Field("name", "名称", false, false), Field("tags", "标签（逗号分隔）", false, false), Field("description", "角色描述", true, "tall"), Field("personality", "性格", true), Field("scenario", "场景设定", true), Field("first_mes", "开场白", true, "tall"), Field("alternate_greetings", "备选开场白（用 --- 分隔）", true), Field("system_prompt", "系统提示", true), Field("post_history_instructions", "历史后指令", true), Field("mes_example", "对话示例", true, "tall"), Field("creator_notes", "创作者备注", true), Field("character_book", "世界书 JSON", true, "tall")),
							h("div", { className: "dsh-card-editor-actions" }, h("button", { className: "dsh-tavern-btn", style: { color: "#c45f5f" }, disabled: busy, onClick: removeCard }, "删除"), h("button", { className: "dsh-tavern-btn", onClick: exportCard }, "导出"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: duplicate }, "复制人物卡"), h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存修改"))
						) : h("div", { className: "dsh-card-reviser" },
							h("div", { className: "dsh-card-revise-info" }, h("h2", null, card.name), h("p", { className: "dsh-card-hint" }, "这是一条独立的设定讨论。你可以先讨论、让模型追问或比较方案；只有明确要求修改时，模型才会把变更写入人物卡。不会推进酒馆剧情。"), h("h3", null, "当前核心设定"), h("div", { className: "dsh-tavern-status-now" }, card.description || "暂无角色描述"), h("h3", null, "场景"), h("div", { className: "dsh-card-hint" }, card.scenario || "暂无场景设定")),
							h("div", { className: "dsh-card-revise-chat" }, h("div", { className: "dsh-card-revise-log" }, revisionMessages.length ? revisionMessages.map(function (item, index) { return h("div", { key: index, className: "dsh-card-revise-entry " + item.role }, h("span", { className: "dsh-card-revise-speaker" }, item.role === "assistant" ? "人物卡编辑助手" : "你"), h("span", null, item.text), item.changed ? h("div", { className: "dsh-card-revise-applied" }, "✓ 已写入人物卡" + (item.summary ? "：" + item.summary : "")) : null); }) : h("div", { className: "dsh-card-hint" }, "开始讨论这张人物卡。可以先问：这张卡目前有哪些矛盾？性格是否足以稳定驱动模型？开场白和场景是否匹配？")), h("div", { className: "dsh-card-revise-compose" }, h("textarea", { value: instruction, placeholder: "与人物卡编辑助手讨论…", onChange: function (e) { setInstruction(e.target.value); } }), h("div", { style: { display: "flex", justifyContent: "space-between", marginTop: "8px" } }, h("button", { className: "dsh-tavern-btn", disabled: busy || revisionMessages.length === 0, onClick: clearRevision }, "新建修正对话"), h("button", { className: "dsh-card-primary", disabled: busy || !instruction.trim(), onClick: revise }, busy ? "回复中…" : "发送"))))
						)
					) : h("div", { className: "dsh-tavern-status-empty", style: { margin: "auto" } }, "新建或导入一张人物卡开始编辑。"))
				)
			);
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
			function call(method, args) {
				return fetch("/api/dsh-tavern/" + method, {
					method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args || {})
				}).then(function (r) { return r.json(); }).then(function (res) {
					if (!res || !res.ok) throw new Error(res && res.error ? res.error : "操作失败");
					return res;
				});
			}
			function ensureDetailsOpen() {
				for (let i = 1; i <= 10; i++) window.setTimeout(props.openDetails, 120 * i);
			}
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
			function openPicker(sub) {
				setMenuSession(null);
				setPickerSub(sub === "sources" ? "sources" : (cards.length ? "cards" : "sources"));
				setPicking(true);
			}
			async function newConversation(card, requestedMode) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "revision");
				if (!workspaceId) { setError("当前没有可用的 Workspace"); return; }
				setBusy(true); setError("");
				try {
					const currentSummary = current ? summaries[current] : null;
					const currentIsTavern = current ? history.some(function (item) { return item.sessionId === current; }) : false;
					if (currentSummary && currentSummary.blank && currentIsTavern) {
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
					ensureDetailsOpen();
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
					const currentIsTavern = current ? history.some(function (item) { return item.sessionId === current; }) : false;
					if (currentSummary && currentSummary.blank && currentIsTavern) {
						await props.workspaces.archiveSession(current);
					}
					const sessionId = await props.workspaces.connectWorkspace(workspaceId);
					const presetResponse = await props.connection.api.agentPresets.select({ sessionId: sessionId, agentPreset: "tavern" });
					if (!presetResponse.result.ok) throw new Error(presetResponse.result.error && presetResponse.result.error.message ? presetResponse.result.error.message : "无法切换到酒馆模式");
					props.sessions.noteAgentPreset(sessionId, "tavern");
					await call("startExtract", { sourceIds: sourceIds, sessionId: sessionId });
					setUiMode("card"); setPickerSub("sources");
					publishSessionMode(sessionId, "extract");
					props.sessions.open(sessionId);
					ensureDetailsOpen();
					window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: sessionId } }));
					setPicking(false); setSelectedSourceIds([]); await refresh();
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
				if (first) { props.sessions.open(first.sessionId); ensureDetailsOpen(); }
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
					if (next) { props.sessions.open(next.sessionId); ensureDetailsOpen(); }
					else { props.sessions.clear(); openPicker("cards"); }
					await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function exportCard(card) {
				try {
					const res = await call("getCard", { cardId: card.id });
					const raw = res.card;
					const exported = { spec: "chara_card_v3", spec_version: "3.0", data: {
						name: raw.name, description: raw.description || "", personality: raw.personality || "", scenario: raw.scenario || "",
						first_mes: raw.first_mes || "", mes_example: raw.mes_example || "", creator_notes: raw.creator_notes || "",
						system_prompt: raw.system_prompt || "", post_history_instructions: raw.post_history_instructions || "",
						tags: raw.tags || [], alternate_greetings: raw.alternate_greetings || [], character_book: raw.character_book || null
					} };
					const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url; a.download = (raw.name || "人物卡") + ".json";
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
						ensureDetailsOpen();
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
			return h("div", { className: "dsh-tavern-sidebar", style: { position: "relative", width: props.width + "px" } },
				h("div", { className: "dsh-tavern-side-head" }, h("div", { className: "dsh-tavern-side-brand" }, "🍺 DSH Tavern"), h("button", { className: "dsh-tavern-side-icon", title: "收起侧栏", onClick: props.toggleSidebar }, "◧")),
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
			function call(method, args) {
				return fetch("/api/dsh-tavern/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args || {}) })
					.then(function (r) { return r.json(); }).then(function (res) { if (!res || !res.ok) throw new Error(res && res.error ? res.error : "操作失败"); return res; });
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
					post_history_instructions: card.post_history_instructions || "", creator_notes: card.creator_notes || "", character_book: card.character_book ? JSON.stringify(card.character_book, null, 2) : ""
				});
				loadScript();
			}, [cardId, props.view.card]);
			function field(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				setBusy(true); setError("");
				try {
					const book = draft.character_book.trim() ? JSON.parse(draft.character_book) : null;
					const patch = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean), character_book: book });
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
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "高级字段"), F("alternate_greetings", "备选开场白（--- 分隔）"), F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("mes_example", "对话示例", true), F("creator_notes", "创作者备注"), F("character_book", "世界书 JSON", true)),
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
					const response = await fetch("/api/dsh-tavern/finalizeExtract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: view.chatId }) });
					const result = await response.json();
					if (!result || !result.ok) throw new Error(result && result.error ? result.error : "保存失败");
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
					line("角色名", draft.name),
					line("标签", (draft.tags || []).length ? draft.tags.join("、") : ""),
					line("角色描述", draft.description),
					line("性格", draft.personality),
					line("开场情境", draft.scenario),
					line("开场白", draft.first_mes),
					line("对话示例", draft.mes_example),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					done ? h("div", { className: "dsh-tavern-status-now" }, "已保存为新人物卡：" + done.name + "。去“游玩”模式选卡开始新故事。") : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy || !draft.name, onClick: finalize }, busy ? "保存中…" : (extract.done ? "重新保存人物卡" : "保存为新人物卡")))
				)
			);
		}

		function TavernStatusPanel(props) {
			const [view, setView] = React.useState(null);
			const [error, setError] = React.useState("");
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
						const response = await fetch("/api/dsh-tavern/getSession", {
							method: "POST", headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ sessionId: props.sessionId })
						});
						const result = await response.json();
						if (!result || !result.ok) throw new Error(result && result.error ? result.error : "状态读取失败");
						if (stopped) return;
						setView(result.view || null); setError("");
						if (result.view && result.view.settleStatus === "running") timer = window.setTimeout(load, 1400);
					} catch (err) { if (!stopped) setError(String(err && err.message || err)); }
				}
				load();
				return function () { stopped = true; if (timer) window.clearTimeout(timer); };
			}, [props.sessionId, stateKey]);
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
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "人物姿势"),
						view.posture ? h("div", { className: "dsh-tavern-status-now" }, view.posture) : h("div", { className: "dsh-tavern-status-empty" }, "等待第一轮状态结算")
					)
				)
			);
		}

		const candidatePanel = { value: null, listeners: new Set() };
		const candidateRequests = new Set();
		function setCandidatePanel(value) {
			candidatePanel.value = value;
			candidatePanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useCandidatePanel() {
			const [value, setValue] = React.useState(candidatePanel.value);
			React.useEffect(function () { candidatePanel.listeners.add(setValue); return function () { candidatePanel.listeners.delete(setValue); }; }, []);
			return value;
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
		function recordHiddenTurn(sessionId, turn) {
			try {
				const all = JSON.parse(window.localStorage.getItem(HIDDEN_TURNS_KEY) || "{}");
				const list = all[sessionId] || [];
				if (list.indexOf(turn) < 0) list.push(turn);
				all[sessionId] = list;
				window.localStorage.setItem(HIDDEN_TURNS_KEY, JSON.stringify(all));
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

		function CandidateAction(props) {
			const [busy, setBusy] = React.useState(false);
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
						const savedResponse = await fetch("/api/dsh-tavern/getChoices", {
							method: "POST", headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ sessionId: props.sessionId })
						});
						const saved = await savedResponse.json();
						if (saved && saved.ok && saved.candidates && saved.candidates.messageId === props.messageId) {
							setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "ready", choices: saved.candidates.choices || [], error: "" });
							return;
						}
					}
					const response = await fetch("/api/dsh-tavern/generateChoices", {
						method: "POST", headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ sessionId: props.sessionId, messageId: props.messageId, guidance: guidance || "" })
					});
					const result = await response.json();
					if (!result || !result.ok) throw new Error(result && result.error ? result.error : "生成失败");
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "ready", choices: result.choices || [], error: "" });
				} catch (err) { setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(err && err.message || err) }); }
				finally { setBusy(false); }
			}
			React.useEffect(function () {
				if (!isPlayMode(sessionMode)) return;
				if (latestMessageId !== props.messageId) return;
				const key = props.sessionId + ":" + props.messageId;
				if (candidateRequests.has(key)) return;
				candidateRequests.add(key);
				generate(false);
			}, [latestMessageId, props.messageId, props.sessionId, sessionMode]);
			const h = React.createElement;
			if (!isPlayMode(sessionMode) || latestMessageId !== props.messageId) return null;
			return h(React.Fragment, null,
				h("button", { className: "dsh-tavern-choice-trigger", disabled: busy, title: "重新生成候选项（可先填写意见）", onClick: function () {
					const previous = candidatePanel.value;
					setCandidatePanel(null);
					setRegenPanel(null);
					setCandidateGuidePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "input", error: "", previous: previous });
				} }, busy ? "生成中…" : "重新生成候选项"),
				h("button", { className: "dsh-tavern-choice-trigger", title: "重新生成正文（可填指导意见，生成后直接替换）", onClick: function (event) {
					const tail = event && event.currentTarget ? event.currentTarget.closest('[data-chat-flow-kind="turn-tail"]') : null;
					setCandidatePanel(null);
					setRegenPanel({ sessionId: props.sessionId, phase: "input", guidance: "", text: "", error: "", tail: tail });
				} }, "重新生成正文")
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
			React.useEffect(function () { setSelected(-1); setExpanded(false); }, [panel]);
			React.useEffect(function () {
				applyHiddenTurns(props.sessionId);
				const timer = window.setInterval(function () { applyHiddenTurns(props.sessionId); }, 1500);
				return function () { window.clearInterval(timer); };
			}, [props.sessionId]);
			if (!isPlayMode(sessionMode) || !panel || panel.sessionId !== props.sessionId || panel.messageId !== latestMessageId || running) {
				return null;
			}
			const h = React.createElement;
			const count = (panel.choices || []).length;
			const isScenePick = count > 0 && (panel.choices || []).every(function (choice) { return choice !== null && typeof choice === "object" && choice.type === "scene2"; });
			const summary = panel.phase === "loading" ? "正在生成…" : (panel.error ? "生成失败" : count + " 个候选项");
			return h("div", { className: "dsh-tavern-question" + (expanded ? "" : " collapsed") },
				h("div", { className: "dsh-tavern-question-head", onClick: function () { setExpanded(!expanded); } }, h("span", null, isScenePick ? "选择新场景开头" : "接下来的行动"), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { className: "dsh-tavern-question-close", title: expanded ? "收起" : "展开", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
				expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
				expanded && panel.error ? h("div", { className: "dsh-tavern-choice-error" }, "候选项生成失败，请点回复下方的“重新生成候选项”") : null,
				expanded ? (panel.choices || []).map(function (choice, index) {
					const item = choice !== null && typeof choice === "object" ? choice : { type: "player", text: String(choice) };
					const label = item.type === "npc" ? "角色行动" : item.type === "scene" ? "场景结束" : item.type === "scene2" ? "新场景" : "玩家行动";
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
				expanded && panel.phase === "ready" && panel.choices && panel.choices.length ? h("div", { className: "dsh-tavern-question-foot" },
					h("button", { className: "dsh-tavern-question-primary", disabled: selected < 0, onClick: function () {
						if (selected < 0) return;
						const item = panel.choices[selected];
						const choice = item !== null && typeof item === "object" ? item : { type: "player", text: String(item) };
						const marked = choice.type === "npc" ? "【角色行动】" + choice.text : choice.type === "scene" ? "【场景结束】" + choice.text : choice.type === "scene2" ? "【新场景】" + choice.text : choice.text;
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
			async function generateGuided() {
				const guide = guidance.trim();
				const messageId = panel.messageId;
				setCandidateGuidePanel({ sessionId: props.sessionId, messageId: messageId, phase: "loading", error: "", previous: panel.previous });
				try {
					const response = await fetch("/api/dsh-tavern/generateChoices", {
						method: "POST", headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ sessionId: props.sessionId, messageId: messageId, guidance: guide })
					});
					const result = await response.json();
					if (!result || !result.ok) throw new Error(result && result.error ? result.error : "生成失败");
					setCandidatePanel({ sessionId: props.sessionId, messageId: messageId, phase: "ready", choices: result.choices || [], error: "" });
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
				? h("div", { className: "dsh-tavern-question-sub" }, "正在按意见重新生成候选项…")
				: h(React.Fragment, null,
					panel.error ? h("div", { className: "dsh-tavern-choice-error" }, panel.error) : null,
					h("textarea", {
						className: "dsh-tavern-regen-input",
						rows: 2,
						value: guidance,
						placeholder: "对候选的要求（可选）：例如“多点暧昧动作”“场景换到白天户外”“新场景换一批人物”",
						onChange: function (e) { setGuidance(e.target.value); }
					}),
					h("div", { className: "dsh-tavern-question-foot" },
						h("button", { className: "dsh-tavern-question-primary", disabled: panel.phase === "loading", onClick: generateGuided }, "按此意见重新生成"),
						h("button", { className: "dsh-tavern-question-free", onClick: cancel }, "取消")
					)
				);
			return h("div", { className: "dsh-tavern-question" },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, "重新生成候选项"), h("span", { className: "dsh-tavern-question-sub" }, "可填写意见，行动候选与场景候选通用")),
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
			function call(method, args) {
				return fetch("/api/dsh-tavern/" + method, {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify(Object.assign({}, args || {}, { sessionId: props.sessionId }))
				}).then(function (r) { return r.json(); }).then(function (res) {
					if (!res || !res.ok) throw new Error(res && res.error ? res.error : "操作失败");
					return res;
				});
			}
			async function generate() {
				const guide = guidance.trim();
				setRegenPanel(Object.assign({}, panel, { phase: "loading", error: "" }));
				try {
					const res = await call("regenBody", { guidance: guide });
					const adopted = res.view && res.view.adopted ? res.view.adopted : null;
					if (adopted && Number(adopted.hiddenTurn) > 0) recordHiddenTurn(props.sessionId, Number(adopted.hiddenTurn));
					hideTurnTail(panel.tail);
					applyHiddenTurns(props.sessionId);
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
			ctx.effect(() => slots.inject("sidebar", () => slots.register(
				{ name: "sidebar", priority: -1 },
				function (props) { return React.createElement(TavernSidebar, Object.assign({}, props, {
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
					toggleSidebar: function () { ctx.layout.toggleSidebar(); },
					openDetails: function () { ctx.layout.openDetails(); }
				})); }
			)), "dsh-tavern: dedicated Tavern sidebar");
			ctx.effect(() => slots.inject("details", () => slots.register(
				{ name: "details", priority: -1 },
				function (props) { return React.createElement(TavernStatusPanel, props); }
			)), "dsh-tavern: persistent status panel");
			ctx.effect(function () {
				const timers = [];
				for (let i = 1; i <= 6; i++) timers.push(window.setTimeout(function () { ctx.layout.openDetails(); }, 200 * i));
				return function () { timers.forEach(function (t) { window.clearTimeout(t); }); };
			});
			ctx.effect(() => slots.inject("conversation.chat.assistant-actions", () => slots.register(
				{ name: "conversation.chat.assistant-actions", id: "dsh-tavern-candidates", order: 80, label: "候选项" },
				function (props) { return React.createElement(CandidateAction, props); }
			)), "dsh-tavern: candidate action button");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-question", order: -120, label: "下一步行动" },
				function (props) { return React.createElement(CandidateQuestion, props); }
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
