window.__ModuleLoader__.load({
	id: "dsh-tavern-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			let React = require("react");
			let { createPortal } = require("react-dom");

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
.dsh-tavern-opening-switch-host { display: flex; flex-direction: column; align-items: stretch; width: 100%; box-sizing: border-box; padding: 0 12px 8px; }
.dsh-tavern-opening-copy { white-space: pre-wrap; color: inherit; font: inherit; line-height: 1.75; }
.dsh-tavern-opening-switch { display: inline-flex; align-items: center; gap: 7px; padding: 3px 7px; border: 1px solid rgba(166,107,53,.38); border-radius: 999px; background: rgba(166,107,53,.08); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-tavern-opening-switch-wrap { display: flex; justify-content: center; padding-top: 6px; }
.dsh-tavern-opening-switch button { width: 24px; height: 24px; border: 0; border-radius: 50%; background: transparent; color: #a66b35; cursor: pointer; font-size: 17px; line-height: 1; }
.dsh-tavern-opening-switch button:hover { background: rgba(166,107,53,.16); }
.dsh-tavern-opening-switch button:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; opacity: .45; }
.dsh-tavern-opening-switch-error { margin-left: 4px; color: #c45f5f; }
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
.dsh-tavern-resources { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-library { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-library-search { box-sizing: border-box; width: calc(100% - 24px); margin: 10px 12px 2px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-specific-input-major); color: inherit; }
.dsh-tavern-library-card { width: 100%; padding: 9px 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-library-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-library-card b,.dsh-tavern-library-card span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-library-card span { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-library-head-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.dsh-tavern-resource-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 20px; }
.dsh-tavern-resource-group { margin-bottom: 16px; }
.dsh-tavern-resource-group-title { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 750; }
.dsh-tavern-resource-actions { display: flex; align-items: center; gap: 5px; }
.dsh-tavern-resource-actions select { min-width: 0; max-width: 120px; height: 25px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-specific-input-major); color: inherit; font-size: 10px; }
.dsh-tavern-resource-import { height: 25px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 10px; }
.dsh-tavern-resource-import:hover { border-color: #a66b35; color: #a66b35; }
.dsh-tavern-resource-row { display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 8px; }
.dsh-tavern-resource-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-resource-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-tavern-resource-open { padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-resource-open:hover { color: #a66b35; text-decoration: underline; }
.dsh-tavern-resource-meta { color: var(--dsw-alias-label-tertiary); font-size: 10px; white-space: nowrap; }
.dsh-tavern-resource-at { flex: none; border: 1px solid rgba(166,107,53,.45); border-radius: 7px; padding: 3px 7px; background: rgba(166,107,53,.08); color: #a66b35; cursor: pointer; font-size: 11px; font-weight: 700; }
.dsh-tavern-resource-at:hover { background: rgba(166,107,53,.18); }
.dsh-tavern-resource-at.mounted { border-color: var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-tertiary); }
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
.dsh-tavern-worldbook { margin-bottom: 14px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }
.dsh-tavern-worldbook-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.dsh-tavern-worldbook-title { color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 700; }
.dsh-tavern-worldbook-actions { display: flex; gap: 5px; }
.dsh-tavern-worldbook-add { border: 1px solid rgba(166,107,53,.55); border-radius: 7px; background: rgba(166,107,53,.10); color: #a66b35; padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: 650; }
.dsh-tavern-worldbook-add:hover { background: rgba(166,107,53,.20); }
.dsh-tavern-worldbook-empty { padding: 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dsh-tavern-worldbook-group + .dsh-tavern-worldbook-group { margin-top: 12px; }
.dsh-tavern-worldbook-group-title { margin-bottom: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 750; }
.dsh-tavern-worldbook-entry { margin-bottom: 10px; padding: 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-worldbook-entry-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; color: #a66b35; font-size: 11px; font-weight: 700; }
.dsh-tavern-worldbook-entry-actions { display: flex; align-items: center; gap: 4px; }
.dsh-tavern-worldbook-kind { border: 1px solid rgba(166,107,53,.45); border-radius: 999px; background: rgba(166,107,53,.08); color: #a66b35; cursor: pointer; padding: 2px 7px; font-size: 10px; }
.dsh-tavern-worldbook-del { border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 2px 6px; font-size: 11px; }
.dsh-tavern-worldbook-del:hover { color: #c45f5f; background: rgba(196,95,95,.12); }
.dsh-tavern-worldbook-entry .dsh-tavern-card-field { margin-bottom: 6px; }
.dsh-tavern-worldbook-entry .dsh-tavern-card-field:last-child { margin-bottom: 0; }
.dsh-tavern-card-save { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: 10px 0 2px; background: linear-gradient(transparent, var(--dsw-specific-sidebar-fill) 28%); }
.dsh-tavern-script-row { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l3); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-tavern-script-info { flex: 1; min-width: 150px; line-height: 1.5; }
.dsh-tavern-script-info b { color: #a66b35; }
.dsh-tavern-script-hero { flex: none; margin: 10px 12px 0; padding: 12px; border: 1px solid rgba(166,107,53,.48); border-radius: 11px; background: rgba(166,107,53,.10); }
.dsh-tavern-script-hero-title { color: #9a622f; font-size: 13px; font-weight: 800; }
.dsh-tavern-script-hero-help { margin-top: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dsh-tavern-script-hero .dsh-tavern-script-row { border-top-color: rgba(166,107,53,.28); }
.dsh-tavern-script-primary { border: 0; border-radius: 8px; padding: 6px 10px; background: #a66b35; color: #fff; cursor: pointer; font-size: 11px; font-weight: 700; }
.dsh-tavern-script-primary:disabled { opacity: .5; cursor: default; }
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

		function parseTextResourceFile(file) {
			const name = String(file && file.name || "");
			if (!name.toLowerCase().endsWith(".epub")) {
				return file.text().then(function (text) { return { name: name, type: file.type || "", text: text, chunkSize: 500 }; });
			}
			if (Number(file.size) > 50 * 1024 * 1024) return Promise.reject(new Error("EPUB 文件不能超过 50 MB"));
			return file.arrayBuffer().then(function (buffer) {
				return { name: name, type: file.type || "application/epub+zip", fileB64: bytesToBase64(new Uint8Array(buffer)), chunkSize: 500 };
			});
		}

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
			return values[sessionId] || "";
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
			const [cardEntry, setCardEntry] = React.useState("");
			const [menuSession, setMenuSession] = React.useState(null);
			const lastModeSession = React.useRef(null);
			const fileRef = React.useRef(null);
			const readyTavernSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && isPlayMode(entry.mode); }) ? current : "";
			const readyCardSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && entry.mode === "card"; }) ? current : "";
			function call(method, args) { return rpc(method, args); }
			function notifyDataChanged() {
				window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
			}
			function refresh() {
				return Promise.all([call("listCards"), call("listSessions")]).then(function (all) {
					setCards(all[0].cards || []); setHistory(all[1].sessions || []); publishSessionModes(all[1].sessions || []); setError("");
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
				if (!readyTavernSession || typeof props.openStatusTab !== "function") return;
				props.openStatusTab(readyTavernSession);
			}, [readyTavernSession]);
			React.useEffect(function () {
				if (!readyCardSession || typeof props.openResourcesTab !== "function") return;
				props.openResourcesTab(readyCardSession);
			}, [readyCardSession]);
			function openPicker() {
				setMenuSession(null);
				setCardEntry("");
				setPicking(true);
			}
			async function newConversation(card, requestedMode) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "card");
				if (!workspaceId) { setError("当前没有可用的 Workspace"); return; }
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
					await call("startChat", { path: card.path, sessionId: sessionId, mode: targetMode });
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
			async function newCardConversation(card, task, label) {
				if (!workspaceId) { setError("当前没有可用的 Workspace"); return; }
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
					await call("startChat", { path: card && card.path ? card.path : "", sessionId: sessionId, mode: "card" });
					setUiMode("card");
					publishSessionMode(sessionId, "card");
					props.sessions.open(sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: sessionId } }));
					if (task) await props.injectTaskPrompt(sessionId, task, label);
					setPicking(false); setCardEntry("");
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
				else if (nextMode === "card") openPicker();
				else openPicker();
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
					const res = await call("exportCard", { path: card.path });
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
				const title = item.title || (summary && summary.displayTitle ? summary.displayTitle : (item.cardName + "的新对话"));
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
				cards.length ? h(React.Fragment, null, h("div", { className: "dsh-tavern-side-empty", style: { padding: "4px 6px" } }, "已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。"), cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newConversation(card); } }, h("b", null, card.name), h("span", null, card.script ? ("剧本：" + card.script.title + " · " + card.script.chunkCount + " 块") : "自由故事（未绑定剧本）")),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "删除人物卡及其所有对话", onClick: function () { if (window.confirm("删除人物卡“" + card.name + "”吗？\n工作版、原版及相关对话都会删除。")) call("deleteCard", { path: card.path }).then(refresh, function (err) { setError(String(err && err.message || err)); }); } }, "删除"),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "导出为 SillyTavern 兼容 JSON", onClick: function () { exportCard(card); } }, "导出")
				); })) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡。\n点“导入人物卡”添加 PNG/JSON 卡片。")
			);
			const cardEditRows = cards.length ? cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
				h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(card, "edit", "修改人物卡"); } }, h("b", null, card.name), h("span", null, "选择这张人物卡开始修改"))
			); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡，可先在空白工作台中创建。");
			const cardPicker = h("div", { className: "dsh-tavern-card-picker" },
				h("div", { className: "dsh-tavern-card-picker-head" }, cardEntry === "edit" ? h("button", { className: "dsh-tavern-btn", onClick: function () { setCardEntry(""); } }, "← 返回") : h("span", null, "选择起始任务"), h("span", { className: "dsh-tavern-spacer" }), cardEntry === "edit" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入人物卡") : null, h("button", { className: "dsh-tavern-btn", onClick: function () { setPicking(false); setCardEntry(""); } }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				cardEntry === "edit" ? cardEditRows : h(React.Fragment, null,
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("edit"); } }, h("b", null, "修改人物卡"), h("span", null, "先选择人物卡，再追加修改任务提示词")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(null, "extract", "从素材新建人物卡"); } }, h("b", null, "从素材新建人物卡"), h("span", null, "从空白工作台开始，并追加素材抽取提示词")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(null); } }, h("b", null, "空白开始"), h("span", null, "不追加任务提示词，自由使用完整卡片 Agent"))
				)
			);
			return h("div", { className: "dsh-tavern-sidebar", style: { position: "relative", width: props.embedded ? "100%" : props.width + "px" } },
				h("div", { className: "dsh-tavern-side-head" }, h("div", { className: "dsh-tavern-side-brand" }, "🍺 DSH Tavern"), props.embedded ? null : h("button", { className: "dsh-tavern-side-icon", title: "收起侧栏", onClick: props.toggleSidebar }, "◧")),
				h("div", { className: "dsh-tavern-mode-switch" }, h("button", { className: uiMode === "play" ? "active" : "", onClick: function () { switchMode("play"); } }, "游玩"), h("button", { className: uiMode === "card" ? "active" : "", onClick: function () { switchMode("card"); } }, "卡片")),
				h("button", { className: "dsh-tavern-side-new", disabled: busy, onClick: function () { openPicker(); } }, uiMode === "play" ? "＋ 选择人物卡 · 新开游玩" : "＋ 新建卡片工作台对话"),
				h("div", { className: "dsh-tavern-side-title" }, uiMode === "play" ? "游玩历史" : "卡片历史"),
				h("div", { className: "dsh-tavern-side-list" }, rows.length ? rows : h("div", { className: "dsh-tavern-side-empty" }, uiMode === "play" ? "还没有游玩对话。\n选择人物卡开始；绑定剧本的卡会按剧本推进。" : "还没有卡片工作台对话。\n可以空白开始，再按需添加人物卡和资料。")),
				error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
				picking ? (uiMode === "play" ? playPicker : cardPicker) : null
			);
		}

		function TavernResourcesTab(props) {
			const [resources, setResources] = React.useState({ cards: [], sources: [], scripts: [] });
			const [view, setView] = React.useState(null);
			const [error, setError] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [scriptCardPath, setScriptCardPath] = React.useState("");
			const cardInput = React.useRef(null);
			const sourceInput = React.useRef(null);
			const scriptInput = React.useRef(null);
			function refresh() {
				return Promise.all([rpc("listResources", {}, props.sessionId), rpc("getSession", { sessionId: props.sessionId }, props.sessionId)]).then(function (all) {
					setResources(all[0] || { cards: [], sources: [], scripts: [] });
					setView(all[1] && all[1].view ? all[1].view : null);
					setError("");
				}, function (err) { setError(String(err && err.message || err)); });
			}
			async function importCardResource(file) {
				if (!file) return;
				setBusy(true); setError("");
				try { await rpc("importCard", { payload: await parseCardFile(file) }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importSourceResource(file) {
				if (!file) return;
				setBusy(true); setError("");
				try { await rpc("importSource", { payload: await parseTextResourceFile(file) }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importScriptResource(file) {
				if (!file || !scriptCardPath) return;
				setBusy(true); setError("");
				try { await rpc("importScript", { cardPath: scriptCardPath, payload: await parseTextResourceFile(file) }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			React.useEffect(function () {
				refresh();
				function onData() { refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				const timer = window.setInterval(refresh, 4000);
				return function () { window.clearInterval(timer); window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [props.sessionId]);
			const h = React.createElement;
			if (view && view.mode !== "card") return h("div", { className: "dsh-tavern-empty" }, "资源库只用于卡片工作台。");
			const mounted = view && view.workspace && Array.isArray(view.workspace.mountedResources) ? view.workspace.mountedResources : [];
			function isMounted(kind, path) {
				if (kind === "card" && view && view.card && view.card.path === path) return true;
				return mounted.some(function (item) { return item && item.kind === kind && item.path === path; });
			}
			async function renameResource(item, label) {
				const current = item.path.split("/").pop();
				const name = window.prompt("重命名文件", current);
				if (name === null || !name.trim() || name.trim() === current) return;
				setBusy(true); setError("");
				try { await rpc("renameResource", { path: item.path, name: name.trim() }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function row(kind, item) {
				const path = item.path;
				const label = kind === "card" ? item.name : item.title;
				const meta = kind === "card" ? "" : (item.chunkCount ? item.chunkCount + " 块" : "");
				const on = isMounted(kind, path);
				const name = kind === "card" ? h("button", { className: "dsh-tavern-resource-name dsh-tavern-resource-open", title: "查看人物卡详情：" + label, onClick: function () { props.openCard(path); } }, label) : h("button", { className: "dsh-tavern-resource-name dsh-tavern-resource-open", title: "查看工作版：" + label, onClick: function () { props.openResource(item.previewPath, label); } }, label);
				return h("div", { key: path, className: "dsh-tavern-resource-row" },
					name,
					meta ? h("span", { className: "dsh-tavern-resource-meta" }, meta) : null,
					h("button", { className: "dsh-tavern-resource-at", disabled: busy, title: "重命名真实文件", onClick: function () { renameResource(item, label); } }, "重命名"),
					h("button", { className: "dsh-tavern-resource-at" + (on ? " mounted" : ""), title: on ? "再次引用到对话" : "引用到对话并挂载", onClick: function () { props.appendMention(kind, path, label); } }, on ? "已挂载" : "@")
				);
			}
			function group(title, kind, items, actions) {
				return h("section", { className: "dsh-tavern-resource-group" },
					h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length), actions || null),
					items.length ? items.map(function (item) { return row(kind, item); }) : h("div", { className: "dsh-tavern-status-empty" }, "暂无")
				);
			}
			const cardActions = h("div", { className: "dsh-tavern-resource-actions" }, h("button", { className: "dsh-tavern-resource-import", disabled: busy, onClick: function () { cardInput.current && cardInput.current.click(); } }, "导入"), h("input", { ref: cardInput, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importCardResource(file); event.target.value = ""; } }));
			const sourceActions = h("div", { className: "dsh-tavern-resource-actions" }, h("button", { className: "dsh-tavern-resource-import", disabled: busy, onClick: function () { sourceInput.current && sourceInput.current.click(); } }, "导入"), h("input", { ref: sourceInput, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importSourceResource(file); event.target.value = ""; } }));
			const scriptActions = h("div", { className: "dsh-tavern-resource-actions" }, h("select", { value: scriptCardPath, disabled: busy || !(resources.cards || []).length, title: "选择剧本绑定的人物卡", onChange: function (event) { setScriptCardPath(event.target.value); } }, h("option", { value: "" }, "选择人物卡"), (resources.cards || []).map(function (card) { return h("option", { key: card.path, value: card.path }, card.name); })), h("button", { className: "dsh-tavern-resource-import", disabled: busy || !scriptCardPath, onClick: function () { scriptInput.current && scriptInput.current.click(); } }, "导入"), h("input", { ref: scriptInput, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importScriptResource(file); event.target.value = ""; } }));
			return h("div", { className: "dsh-tavern-resources" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "资源库"), h("div", { className: "dsh-tavern-question-sub" }, "点击素材或剧本查看 · 点击 @ 放入对话")),
				h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, group("人物卡", "card", resources.cards || [], cardActions), group("素材", "source", resources.sources || [], sourceActions), group("剧本", "script", resources.scripts || [], scriptActions))
			);
		}

		function CardLibraryTab(props) {
			const [cards, setCards] = React.useState([]);
			const [selectedPath, setSelectedPath] = React.useState("");
			const [card, setCard] = React.useState(null);
			const [query, setQuery] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const importInput = React.useRef(null);
			const requestedPath = props.tab && props.tab.meta && typeof props.tab.meta.cardPath === "string" ? props.tab.meta.cardPath : "";
			function refreshCards() {
				return rpc("listCards", {}).then(function (result) { setCards(result.cards || []); setError(""); return result.cards || []; }, function (err) { setError(String(err && err.message || err)); return []; });
			}
			function loadCard(path) {
				if (!path) { setSelectedPath(""); setCard(null); return Promise.resolve(); }
				setSelectedPath(path); setError("");
				return rpc("getCard", { path: path }).then(function (result) { setCard(result.card || null); }, function (err) { setError(String(err && err.message || err)); setCard(null); });
			}
			React.useEffect(function () {
				refreshCards();
				function onData() { refreshCards().then(function (items) { if (selectedPath && !items.some(function (item) { return item.path === selectedPath; })) { setSelectedPath(""); setCard(null); } }); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [selectedPath]);
			React.useEffect(function () {
				if (requestedPath && requestedPath !== selectedPath) loadCard(requestedPath);
			}, [requestedPath, selectedPath]);
			function clearCard() {
				setSelectedPath("");
				setCard(null);
				props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null });
			}
			async function importCardFile(file) {
				if (!file) return;
				setBusy(true); setError("");
				try { const result = await rpc("importCard", { payload: await parseCardFile(file) }); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refreshCards(); await loadCard(result.card.path); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function renameCard() {
				if (!card) return;
				const current = card.path.split("/").pop();
				const name = window.prompt("重命名人物卡文件", current);
				if (name === null || !name.trim() || name.trim() === current) return;
				setBusy(true); setError("");
				try { const result = await rpc("renameResource", { path: card.path, name: name.trim() }); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refreshCards(); await loadCard(result.resource.path); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function deleteCardFile() {
				if (!card || !window.confirm("删除人物卡“" + card.name + "”吗？\n工作版、原版及相关对话都会删除。")) return;
				setBusy(true); setError("");
				try { await rpc("deleteCard", { path: card.path }); setSelectedPath(""); setCard(null); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refreshCards(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function exportCardFile() {
				if (!card) return;
				try {
					const result = await rpc("exportCard", { path: card.path });
					const blob = new Blob([JSON.stringify(result.document, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob); const link = document.createElement("a");
					link.href = url; link.download = (card.name || "人物卡") + ".json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
				} catch (err) { setError(String(err && err.message || err)); }
			}
			const h = React.createElement;
			if (selectedPath) {
				if (!card) return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: clearCard }, "← 返回人物卡库")), error ? h("div", { className: "dsh-tavern-dock-error" }, error) : h("div", { className: "dsh-tavern-empty" }, "正在读取人物卡…"));
				return h(CardFieldsPanel, { view: { card: card }, library: true, busy: busy, onBack: clearCard, onRename: renameCard, onExport: exportCardFile, onDelete: deleteCardFile, onSaved: function (saved) { setCard(Object.assign({}, saved, { path: selectedPath })); refreshCards(); } });
			}
			const needle = query.trim().toLocaleLowerCase();
			const visible = cards.filter(function (item) { return !needle || (item.name + " " + item.path).toLocaleLowerCase().includes(needle); });
			return h("div", { className: "dsh-tavern-library" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "人物卡库"), h("div", { className: "dsh-tavern-question-sub" }, cards.length + " 张人物卡"), h("div", { className: "dsh-tavern-library-head-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入人物卡"), h("input", { ref: importInput, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importCardFile(file); event.target.value = ""; } }))),
				h("input", { className: "dsh-tavern-library-search", value: query, placeholder: "搜索名称或文件名", onChange: function (event) { setQuery(event.target.value); } }),
				h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, visible.length ? visible.map(function (item) { return h("button", { key: item.path, className: "dsh-tavern-library-card", onClick: function () { loadCard(item.path); } }, h("b", null, item.name), h("span", null, item.path.split("/").pop()), item.script ? h("span", null, "已绑定剧本：" + item.script.title) : null); }) : h("div", { className: "dsh-tavern-empty" }, needle ? "没有匹配的人物卡" : "还没有人物卡") )
			);
		}

		function CardFieldsPanel(props) {
			const [draft, setDraft] = React.useState({});
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [script, setScript] = React.useState(null);
			const [scriptBusy, setScriptBusy] = React.useState(false);
			const [scriptError, setScriptError] = React.useState("");
			const scriptFileRef = React.useRef(null);
			const cardPath = props.view.card.path;
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
			function addBookEntry(constant) {
				const book = draft.character_book || { meta: {}, entries: [] };
				setBook(Object.assign({}, book, { entries: (book.entries || []).concat([{ keysText: "", content: "", comment: "", enabled: true, constant: constant === true, position: "after_char", insertion_order: (book.entries || []).length, extensions: {} }]) }));
			}
			function removeBookEntry(index) {
				const book = draft.character_book;
				if (!book || !Array.isArray(book.entries)) return;
				setBook(Object.assign({}, book, { entries: book.entries.filter(function (_entry, i) { return i !== index; }) }));
			}
			function loadScript() {
				if (!cardPath) return;
				call("getScriptInfo", { path: cardPath }).then(function (res) { setScript(res.script || null); setScriptError(""); }, function (err) { setScriptError(String(err && err.message || err)); });
			}
			React.useEffect(function () {
				const card = props.view.card;
				setDraft({
					name: card.name || "", tags: (card.tags || []).join(", "), description: card.description || "", personality: card.personality || "", scenario: card.scenario || "",
					first_mes: card.first_mes || "", alternate_greetings: (card.alternate_greetings || []).join("\n---\n"), mes_example: card.mes_example || "", system_prompt: card.system_prompt || "",
					post_history_instructions: card.post_history_instructions || "", creator_notes: card.creator_notes || "", character_book: normalizeWorldBook(card.character_book)
				});
				loadScript();
			}, [cardPath, props.view.card]);
			function field(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				setBusy(true); setError("");
				try {
					const patch = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean), character_book: buildWorldBook(draft.character_book) });
					const res = await call("updateCard", { path: cardPath, patch: patch });
					props.onSaved(res.card);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function importScriptFile(file) {
				if (!cardPath || !file) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("importScript", { cardPath: cardPath, payload: await parseTextResourceFile(file) });
					setScript(res.script || null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function deleteScript() {
				if (!script || !window.confirm("解除剧本《" + (script.title || "未命名") + "》绑定？\n已有剧本会话保留，新会话将按自由故事推进。")) return;
				setScriptBusy(true); setScriptError("");
				try {
					await call("deleteScript", { path: script.path });
					setScript(null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			function F(name, label, large) { return React.createElement("div", { className: "dsh-tavern-card-field" }, React.createElement("label", null, label), name === "name" || name === "tags" ? React.createElement("input", { value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } }) : React.createElement("textarea", { className: large ? "large" : "", value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } })); }
			const h = React.createElement;
			const rawWorldBookEntries = draft.character_book && Array.isArray(draft.character_book.entries) ? draft.character_book.entries : [];
			const activeWorldBookEntries = rawWorldBookEntries.map(function (entry, index) { return { entry: entry, index: index }; }).filter(function (item) {
				const entry = item.entry;
				return entry && typeof entry === "object" && entry.enabled !== false;
			});
			const constantEntries = activeWorldBookEntries.filter(function (item) { return item.entry.constant === true; });
			const triggeredEntries = activeWorldBookEntries.filter(function (item) { return item.entry.constant !== true; });
			function worldBookEntry(item) {
				const entry = item.entry;
				const index = item.index;
				const title = entry.comment || entry.keysText || "无触发词";
				return h("div", { key: index, className: "dsh-tavern-worldbook-entry" },
					h("div", { className: "dsh-tavern-worldbook-entry-head" },
						h("span", null, title),
						h("span", { className: "dsh-tavern-worldbook-entry-actions" },
							h("button", { className: "dsh-tavern-worldbook-kind", onClick: function () { setBookEntry(index, { constant: entry.constant !== true }); } }, entry.constant === true ? "常驻" : "关键词触发"),
							h("button", { className: "dsh-tavern-worldbook-del", onClick: function () { removeBookEntry(index); } }, "删除")
						)
					),
					h("div", { className: "dsh-tavern-card-field" },
						h("label", null, entry.constant === true ? "名称（常驻条目）" : "触发词（逗号分隔）"),
						h("input", { value: entry.keysText || "", placeholder: "例如：宝玉、贾府、宝二爷", onChange: function (e) { setBookEntry(index, { keysText: e.target.value }); } })
					),
					h("div", { className: "dsh-tavern-card-field" },
						h("label", null, "内容"),
						h("textarea", { value: entry.content || "", placeholder: "这条世界书的内容", onChange: function (e) { setBookEntry(index, { content: e.target.value }); } })
					)
				);
			}
			function worldBookGroup(title, entries) {
				return h("section", { className: "dsh-tavern-worldbook-group" },
					h("div", { className: "dsh-tavern-worldbook-group-title" }, title + " · " + entries.length),
					entries.length ? entries.map(worldBookEntry) : h("div", { className: "dsh-tavern-worldbook-empty" }, "暂无")
				);
			}
			const worldBookPanel = h("div", { className: "dsh-tavern-worldbook" },
				h("div", { className: "dsh-tavern-worldbook-head" },
					h("span", { className: "dsh-tavern-worldbook-title" }, "世界书 · " + activeWorldBookEntries.length + " 个条目"),
					h("span", { className: "dsh-tavern-worldbook-actions" },
						h("button", { className: "dsh-tavern-worldbook-add", onClick: function () { addBookEntry(true); } }, "＋ 常驻"),
						h("button", { className: "dsh-tavern-worldbook-add", onClick: function () { addBookEntry(false); } }, "＋ 关键词触发")
					)
				),
				worldBookGroup("常驻", constantEntries),
				worldBookGroup("关键词触发", triggeredEntries)
			);
			const scriptPanel = h("div", { className: "dsh-tavern-script-row" },
				h("div", { className: "dsh-tavern-script-info" }, script ? h("span", null, h("b", null, "当前剧本："), script.title + " · " + script.chunkCount + " 块 · " + script.sourceChars + " 字") : h("span", null, "未绑定剧本；游玩时按自由故事推进")),
				h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
				h("button", { className: script ? "dsh-tavern-script-file" : "dsh-tavern-script-primary", disabled: scriptBusy, onClick: function () { scriptFileRef.current && scriptFileRef.current.click(); } }, script ? "更换剧本" : "绑定剧本"),
				script ? h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: deleteScript }, "解绑") : null
			);
			const scriptHero = h("section", { className: "dsh-tavern-script-hero" },
				h("div", { className: "dsh-tavern-script-hero-title" }, "剧本模式"),
				h("div", { className: "dsh-tavern-script-hero-help" }, "绑定剧本后，新开的游玩对话会自动进入剧本模式。Agent 按剧情进度分段读取当前片段并围绕它续写，每轮完成后推进阅读位置；不会一次载入整本剧本，也不要求玩家照原文行动。更换或解绑会影响所有使用这张人物卡的剧本对话。"),
				scriptPanel,
				scriptError ? h("div", { className: "dsh-card-error" }, scriptError) : null
			);
			return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" },
					props.onBack ? h("button", { className: "dsh-tavern-btn", onClick: props.onBack }, "← 返回人物卡库") : null,
					h("div", { className: "dsh-tavern-status-role" }, props.view.card.name),
					h("div", { className: "dsh-tavern-question-sub" }, props.view.card.path ? props.view.card.path.split("/").pop() : ""),
					props.library ? h("div", { className: "dsh-tavern-library-head-actions" }, h("button", { className: "dsh-tavern-btn", onClick: props.onRename }, "重命名文件"), h("button", { className: "dsh-tavern-btn", onClick: props.onExport }, "导出"), h("button", { className: "dsh-tavern-btn", onClick: props.onDelete }, "删除")) : null
				),
				scriptHero,
				h("div", { className: "dsh-tavern-card-fields" },
					h("details", { className: "dsh-tavern-card-advanced", open: true }, h("summary", null, "基本信息"), F("name", "角色名称"), F("tags", "标签"), F("description", "角色描述", true), F("personality", "性格"), F("scenario", "场景设定"), F("first_mes", "开场白", true), F("alternate_greetings", "备选开场白（--- 分隔）"), F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("mes_example", "对话示例", true), F("creator_notes", "创作者备注")),
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "世界书 · " + activeWorldBookEntries.length + " 条"), worldBookPanel),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存字段"))
				)
			);
		}

		function CardDraftPanel(props) {
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [done, setDone] = React.useState(null);
			const view = props.view;
			const workspace = view.workspace || { sources: [], cursor: 0, totalChunks: 0, done: false, draft: {} };
			const draft = workspace.draft || {};
			const h = React.createElement;
			async function finalize() {
				setBusy(true); setError("");
				try {
					const result = await rpc("finalizeCard", { chatId: view.chatId });
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
					h("div", { className: "dsh-tavern-status-title" }, "卡片工作台"),
					h("div", { className: "dsh-tavern-status-role" }, draft.name || "未命名角色"),
					h("div", { className: "dsh-card-hint" }, workspace.totalChunks ? ("资料阅读进度 " + Math.min(workspace.totalChunks, Math.max(workspace.cursor, 1)) + " / " + workspace.totalChunks + " 块 · 确认后的修改进入新卡草稿") : "空白工作台：直接说明目标，或从左侧添加人物卡和参考资料")
				),
				h("div", { className: "dsh-tavern-status-body" },
					h("div", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "素材"),
						(workspace.sources || []).map(function (s) { return h("div", { key: s.id, className: "dsh-tavern-status-item" }, s.title + "（" + s.chunkCount + " 块）"); })
					),
					line("玩家（{{user}}）", workspace.player || "未确认：制作新卡前请在对话里告诉助手谁是玩家"),
					line("角色名", draft.name),
					line("标签", (draft.tags || []).length ? draft.tags.join("、") : ""),
					line("角色描述", draft.description),
					line("性格", draft.personality),
					line("开场情境", draft.scenario),
					line("开场白", draft.first_mes),
					line("对话示例", draft.mes_example),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					done ? h("div", { className: "dsh-tavern-status-now" }, "已保存为新人物卡：" + done.name + "。去“游玩”模式选卡开始新故事。") : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy || !draft.name || (!workspace.player && !workspace.done), onClick: finalize }, busy ? "保存中…" : "保存为新人物卡"))
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
			if (view.mode === "card") return null;
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

		function TavernStatusTab(props) {
			const binding = React.useSyncExternalStore(
				function (listener) { return props.sessions.list.subscribe(listener); },
				function () { return props.sessions.binding(props.sessionId); },
				function () { return props.sessions.binding(props.sessionId); }
			);
			const h = React.createElement;
			if (!binding) return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "酒馆状态")),
				h("div", { className: "dsh-tavern-status-body" }, h("div", { className: "dsh-tavern-status-empty" }, "正在连接当前会话…"))
			);
			function useSession(selector) {
				return React.useSyncExternalStore(
					function (listener) { return binding.session.subscribe(listener); },
					function () { return selector(binding.session.getSnapshot()); },
					function () { return selector(binding.session.getSnapshot()); }
				);
			}
			return h(TavernStatusPanel, { sessionId: props.sessionId, useSession: useSession });
		}

		function OpeningSwitcher(props) {
			const [view, setView] = React.useState(null);
			const [host, setHost] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const sessionState = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				const latest = nodes.length > 0 ? nodes[nodes.length - 1] : null;
				return String(snapshot.running === true) + ":" + String(latest && (latest.messageId || latest.id) || nodes.length);
			});
			React.useEffect(function () {
				let stopped = false;
				rpc("getSession", {}, props.sessionId).then(function (result) {
					if (!stopped) { setView(result.view || null); setError(""); }
				}, function (err) { if (!stopped) setError(String(err && err.message || err)); });
				return function () { stopped = true; };
			}, [props.sessionId, sessionState]);
			const opening = view && view.opening;
			const visible = opening && opening.total > 1;
			const canSwitch = visible && opening.switchable === true && !sessionState.startsWith("true:");
			React.useEffect(function () {
				if (!visible) { setHost(null); return; }
				let container = null;
				let owner = null;
				let previousDisplay = "";
				function restoreOwner() {
					if (owner) owner.style.display = previousDisplay;
					owner = null;
				}
				function attach() {
					if (container && container.isConnected && owner && owner.isConnected) return;
					if (container) container.remove();
					restoreOwner();
					owner = document.querySelector('[data-chat-flow-kind="assistant-step"]');
					if (!owner) return;
					previousDisplay = owner.style.display;
					owner.style.display = "none";
					container = document.createElement("div");
					container.className = "dsh-tavern-opening-switch-host";
					container.dataset.tavernOpeningSwitch = props.sessionId;
					owner.insertAdjacentElement("afterend", container);
					setHost(container);
				}
				attach();
				const observer = new MutationObserver(attach);
				observer.observe(document.body, { childList: true, subtree: true });
				return function () { observer.disconnect(); if (container) container.remove(); restoreOwner(); };
			}, [props.sessionId, !!visible]);
			async function switchChoice(direction) {
				if (busy) return;
				setBusy(true); setError("");
				try {
					const result = await rpc("switchOpening", { direction: direction }, props.sessionId);
					setView(result.view || null);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			if (!host || !visible) return null;
			const h = React.createElement;
			return createPortal(h(React.Fragment, null,
				h("div", { className: "dsh-tavern-opening-copy" }, opening.text || ""),
				canSwitch ? h("div", { className: "dsh-tavern-opening-switch-wrap" }, h("div", { className: "dsh-tavern-opening-switch" },
					h("button", { type: "button", title: "上一条开场白", disabled: busy || !opening.canPrevious, onClick: function () { switchChoice("previous"); } }, "‹"),
					h("span", null, "开场白：" + opening.index + "/" + opening.total),
					h("button", { type: "button", title: "下一条开场白", disabled: busy || !opening.canNext, onClick: function () { switchChoice("next"); } }, "›"),
					error ? h("span", { className: "dsh-tavern-opening-switch-error" }, error) : null
				)) : null
			), host);
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

		const inject = ["slots", "sessions", "workspaces", "layout", "connection", "betterSidebar"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;
			function appendMention(sessionId, kind, path, label) {
				try {
					const actx = ctx.sessions.scope(sessionId);
					const conversation = ctx.get("conversation");
					if (!actx || !conversation) throw new Error("当前对话输入框不可用");
					const input = conversation.input.for(actx);
					const safeLabel = String(label || path).replace(/[\[\]\r\n]/g, " ").trim() || path;
					const mention = "@[" + safeLabel + "](tavern-file:" + encodeURIComponent(path) + ")";
					const draft = input.state.getSnapshot().draft;
					input.setDraft(draft.trim() === "" ? mention : draft + " " + mention);
				} catch (err) {
					console.warn("dsh-tavern: resource mention failed", err);
				}
			}
			async function injectTaskPrompt(sessionId, task, label) {
				const result = await rpc("getCardTaskPrompt", { task: task }, sessionId);
				const actx = ctx.sessions.scope(sessionId);
				const conversation = ctx.get("conversation");
				if (!actx || !conversation) throw new Error("当前对话输入框不可用");
				const input = conversation.input.for(actx);
				const draft = String(input.state.getSnapshot().draft || "");
				const previous = draft.match(/^【卡片任务：[^\n]+】\n[\s\S]*?\n\n【补充要求】\n?/);
				const supplement = previous ? draft.slice(previous[0].length) : draft;
				const taskText = "【卡片任务：" + label + "】\n" + String(result && result.text || "").trim() + "\n\n【补充要求】\n";
				input.setDraft(taskText + supplement);
			}
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:status",
				title: "酒馆状态",
				order: 5,
				single: true,
				component: function (props) {
					return React.createElement(TavernStatusTab, { sessions: ctx.sessions, sessionId: props.scope.sessionId });
				}
			}), "dsh-tavern: Better Sidebar status tab");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:resources",
				title: "资源库",
				order: 4,
				single: true,
				component: function (props) {
					return React.createElement(TavernResourcesTab, { sessionId: props.scope.sessionId, appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); }, openCard: function (path) { ctx.betterSidebar.openTab({ type: "dsh-tavern:cards", meta: { cardPath: path } }, { sessionId: props.scope.sessionId }); ctx.betterSidebar.updateTab("dsh-tavern:cards", { meta: { cardPath: path } }); }, openResource: function (path, title) { if (path) ctx.betterSidebar.openFile({ sessionId: props.scope.sessionId }, path, title); } });
				}
			}), "dsh-tavern: Better Sidebar resources tab");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:cards",
				title: "人物卡库",
				order: 3,
				single: true,
				component: function (props) { return React.createElement(CardLibraryTab, props); }
			}), "dsh-tavern: Better Sidebar card library tab");
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
					openStatusTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:status" }, { sessionId: sessionId }); },
					openResourcesTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:resources" }, { sessionId: sessionId }); },
					injectTaskPrompt: injectTaskPrompt
				})); }
			)), "dsh-tavern: Tavern workspace browser");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-opening-switch", order: -140, label: "切换开场白" },
				function (props) { return React.createElement(OpeningSwitcher, props); }
			)), "dsh-tavern: opening switch");
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
