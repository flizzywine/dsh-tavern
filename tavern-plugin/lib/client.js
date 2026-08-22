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
body.dsh-tavern-shell-active [data-ref-chip="file"] { max-width: calc(100% - 4px); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
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
.dsh-tavern-picker-overlay { position: fixed; z-index: 1000; inset: 0; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 24px; background: rgba(20,18,24,.42); backdrop-filter: blur(2px); }
.dsh-tavern-card-picker { width: min(860px, calc(100vw - 48px)); max-height: min(80vh, 760px); overflow: auto; box-sizing: border-box; padding: 20px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-specific-sidebar-fill); box-shadow: 0 22px 64px rgba(0,0,0,.30); }
.dsh-tavern-card-picker-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 700; }
.dsh-tavern-card-pick { width: 100%; padding: 9px; margin-top: 5px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-card-pick:hover { border-color: #a56d3c; background: rgba(145,92,44,.10); }
.dsh-tavern-card-pick.selected { border-color: #a56d3c; background: rgba(145,92,44,.14); }
.dsh-tavern-card-pick b { display: block; color: #a66b35; }
.dsh-tavern-card-pick span { display: block; margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; }
.dsh-tavern-card-pick-wrap { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 7px; align-items: stretch; }
.dsh-tavern-greeting-preview { max-height: 52vh; overflow: auto; margin: 8px 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1.65; white-space: pre-wrap; }
.dsh-tavern-greeting-nav { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; }
.dsh-tavern-greeting-count { color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
@media (max-width: 640px) {
  .dsh-tavern-picker-overlay { align-items: stretch; padding: 12px; }
  .dsh-tavern-card-picker { width: 100%; max-height: none; padding: 14px; border-radius: 14px; }
  .dsh-tavern-card-pick-wrap { grid-template-columns: minmax(0, 1fr) auto auto; }
  .dsh-tavern-greeting-preview { max-height: 60vh; }
}
.dsh-tavern-picker-group { margin-top: 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 700; }
.dsh-tavern-picker-foot { position: sticky; bottom: -10px; display: flex; justify-content: flex-end; margin: 10px -10px -10px; padding: 10px; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-sidebar-fill); }
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
.dsh-tavern-library-card-row { display: flex; align-items: center; gap: 6px; }
.dsh-tavern-library-card-row .dsh-tavern-library-card { flex: 1; min-width: 0; }
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
.dsh-tavern-presets { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-preset-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 20px; }
.dsh-tavern-preset-row { margin-bottom: 8px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-preset-row-head { display: flex; align-items: center; gap: 7px; }
.dsh-tavern-preset-row-main { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-preset-row-main b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-tavern-preset-row-main span { display: block; margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-preset-detail { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 24px; }
.dsh-tavern-preset-summary { margin-bottom: 10px; padding: 9px 10px; border: 1px solid rgba(166,107,53,.35); border-radius: 9px; background: rgba(166,107,53,.08); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.dsh-tavern-preset-section-title { margin: 14px 2px 7px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 800; letter-spacing: .04em; }
.dsh-tavern-prompt-row { margin-bottom: 7px; border: 1px solid var(--dsw-alias-border-l2); border-left: 4px solid #5b9cff; border-radius: 9px; background: var(--dsw-specific-input-major); overflow: hidden; }
.dsh-tavern-prompt-row.role-user { border-left-color: #35c76f; }
.dsh-tavern-prompt-row.role-assistant { border-left-color: #b47cff; }
.dsh-tavern-prompt-row.role-regex { border-left-color: #ed9714; }
.dsh-tavern-prompt-row.role-script { border-left-color: #8b69d4; }
.dsh-tavern-prompt-row.role-extension { border-left-color: #718096; }
.dsh-tavern-prompt-head { display: grid; grid-template-columns: 65px minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 9px 10px; cursor: pointer; list-style: none; }
.dsh-tavern-prompt-head::-webkit-details-marker { display: none; }
.dsh-tavern-prompt-role { color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 800; }
.dsh-tavern-prompt-title { min-width: 0; }
.dsh-tavern-prompt-title b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-tavern-prompt-title span { display: block; overflow: hidden; margin-top: 3px; color: var(--dsw-alias-label-tertiary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-prompt-state { display: flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 9px; white-space: nowrap; }
.dsh-tavern-prompt-state::before { width: 8px; height: 8px; border: 2px solid #23bd63; border-radius: 999px; content: ""; }
.dsh-tavern-prompt-state.off::before { border-color: #91a0b5; }
.dsh-tavern-prompt-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.dsh-tavern-prompt-tag { padding: 1px 5px; border-radius: 4px; background: rgba(237,151,20,.14); color: #c77800; font-size: 9px; }
.dsh-tavern-prompt-content { margin: 0; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font: 10px/1.55 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
.dsh-tavern-regex-body { border-top: 1px solid var(--dsw-alias-border-l2); padding: 10px 12px; }
.dsh-tavern-regex-label { margin: 8px 0 4px; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 750; }
.dsh-tavern-regex-label:first-child { margin-top: 0; }
.dsh-tavern-regex-code { max-height: 220px; overflow: auto; margin: 0; padding: 8px 9px; border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: 10px/1.55 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
.dsh-tavern-regex-meta { margin-top: 9px; color: var(--dsw-alias-label-tertiary); font: 9px/1.6 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
.dsh-tavern-extension-note { margin: 9px 0; padding: 8px 9px; border: 1px solid rgba(166,107,53,.3); border-radius: 8px; background: rgba(166,107,53,.07); color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.55; }
.dsh-tavern-mvu-list { display: grid; gap: 6px; }
.dsh-tavern-mvu-row { display: grid; grid-template-columns: 74px minmax(0,1fr) auto; gap: 7px; align-items: center; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-specific-input-major); font-size: 10px; }
.dsh-tavern-mvu-kind { color: #a66b35; font-weight: 750; }
.dsh-tavern-mvu-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-mvu-state { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dsh-tavern-boundary { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-boundary-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 24px; }
.dsh-tavern-boundary-current { margin-bottom: 14px; padding: 11px; border: 1px solid rgba(166,107,53,.35); border-radius: 10px; background: rgba(166,107,53,.08); }
.dsh-tavern-boundary-toggle { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; }
.dsh-tavern-boundary-current select { box-sizing: border-box; width: 100%; margin-top: 9px; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-specific-input-major); color: inherit; }
.dsh-tavern-boundary-status { margin-top: 7px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.dsh-tavern-boundary-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dsh-tavern-boundary-row { margin-bottom: 8px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-boundary-row.active { border-color: rgba(166,107,53,.65); }
.dsh-tavern-boundary-row-head { display: flex; align-items: center; gap: 7px; }
.dsh-tavern-boundary-row-head b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a66b35; font-size: 12px; }
.dsh-tavern-boundary-meta { margin-top: 5px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; white-space: pre-wrap; }
.dsh-tavern-boundary-preview { max-height: 220px; overflow: auto; margin: 8px 0; padding: 8px; border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: 10px/1.5 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
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
.dsh-tavern-worldbook-trigger { display: block; max-width: 100%; margin: 0 0 6px; padding: 1px 0; overflow: hidden; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 10px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-worldbook-trigger:hover { color: #a66b35; }
.dsh-tavern-worldbook-note { margin: -2px 0 8px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
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
			const [initialResources, setInitialResources] = React.useState([]);
			const [selectedInitialResources, setSelectedInitialResources] = React.useState({});
			const [history, setHistory] = React.useState([]);
			const [picking, setPicking] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [uiMode, setUiMode] = React.useState("play");
			const [cardEntry, setCardEntry] = React.useState("");
			const [openingPicker, setOpeningPicker] = React.useState(null);
			const [menuSession, setMenuSession] = React.useState(null);
			const lastModeSession = React.useRef(null);
			const fileRef = React.useRef(null);
			const currentSummary = current ? summaries[current] : null;
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
				if (!currentSummary || currentSummary.blank) return;
				notifyDataChanged();
			}, [current, currentSummary]);
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
				if (!readyCardSession) return;
				if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(readyCardSession);
				if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(readyCardSession);
				if (typeof props.openBoundaryLibraryTab === "function") props.openBoundaryLibraryTab(readyCardSession);
				if (typeof props.openResourcesTab === "function") props.openResourcesTab(readyCardSession);
			}, [readyCardSession]);
			function openPicker() {
				setMenuSession(null);
				setCardEntry("");
				setOpeningPicker(null);
				setPicking(true);
			}
			function closePicker() {
				setPicking(false);
				setCardEntry("");
				setOpeningPicker(null);
			}
			async function openResourcePicker(task) {
				setBusy(true); setError("");
				try {
					const response = await call(task === "boundary" ? "listPresets" : "listResources");
					const resources = task === "boundary" ? (response.presets || []) : (response.resources || []);
					setInitialResources(resources.map(function (item) { return Object.assign({}, item, { kind: task === "boundary" ? "preset" : "source" }); }));
					setSelectedInitialResources({});
					setCardEntry(task === "boundary" ? "boundary" : "extract");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function toggleInitialResource(item) {
				const key = item.kind + ":" + item.path;
				setSelectedInitialResources(function (current) {
					const next = Object.assign({}, current);
					if (next[key]) delete next[key];
					else next[key] = { kind: item.kind, path: item.path, title: item.title };
					return next;
				});
			}
			async function ensureTavernPreset(sessionId) {
				const summary = props.sessions.list.getSnapshot().byId[sessionId];
				if (summary && summary.agentPreset === "tavern") return;
				const presetResponse = await props.connection.api.agentPresets.select({ sessionId: sessionId, agentPreset: "tavern" });
				if (!presetResponse.result.ok) throw new Error(presetResponse.result.error && presetResponse.result.error.message ? presetResponse.result.error.message : "无法切换到酒馆模式");
				props.sessions.noteAgentPreset(sessionId, "tavern");
			}
			async function newConversation(card, requestedMode, openingId) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "card");
				if (!workspaceId) { setError("当前没有可用的 Workspace"); return; }
				setBusy(true); setError("");
				try {
					const currentSummary = current ? summaries[current] : null;
					if (current && currentSummary && currentSummary.blank) {
						await props.workspaces.archiveSession(current);
					}
					const sessionId = await props.workspaces.connectWorkspace(workspaceId);
					await ensureTavernPreset(sessionId);
					await call("startChat", { path: card.path, sessionId: sessionId, mode: targetMode, openingId: openingId || "" });
					setUiMode(groupOfMode(targetMode));
					publishSessionMode(sessionId, targetMode);
					props.sessions.open(sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: sessionId } }));
					setOpeningPicker(null); setPicking(false); await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function preparePlayConversation(card) {
				setBusy(true); setError("");
				try {
					const response = await call("getCardOpenings", { path: card.path });
					const openings = response.openings || [];
					if (openings.length <= 1) {
						setBusy(false);
						await newConversation(card, null, openings.length === 1 ? openings[0].id : "");
						return;
					}
					setOpeningPicker({ card: card, openings: openings, index: 0 });
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importCard(file) {
				setBusy(true); setError("");
				try { const payload = await parseCardFile(file); await call("importCard", { payload: payload }); notifyDataChanged(); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function newCardConversation(card, task, label, selectedResources) {
				setBusy(true); setError("");
				try {
					const currentSummary = current ? summaries[current] : null;
					if (current && currentSummary && currentSummary.blank) {
						await props.workspaces.archiveSession(current);
					}
					const resourceRoot = await call("getResourceWorkspace");
					const resourceWorkspace = await props.workspaces.create({ path: resourceRoot.path });
					const sessionId = await props.workspaces.connectWorkspace(resourceWorkspace.workspaceId);
					await ensureTavernPreset(sessionId);
					await call("startChat", { path: card && card.path ? card.path : "", sessionId: sessionId, mode: "card" });
					setUiMode("card");
					publishSessionMode(sessionId, "card");
					props.sessions.open(sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: sessionId } }));
					if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(sessionId);
					if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(sessionId);
					if (typeof props.openBoundaryLibraryTab === "function") props.openBoundaryLibraryTab(sessionId);
					if (typeof props.openResourcesTab === "function") props.openResourcesTab(sessionId);
					if (task === "boundary" && typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(sessionId);
					if (task) await props.injectTaskPrompt(sessionId, task, label, card, (selectedResources || []).length > 0);
					(selectedResources || []).forEach(function (resource) { props.appendMention(sessionId, resource.kind, resource.path, resource.title); });
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
			const selectedOpening = openingPicker && openingPicker.openings[openingPicker.index];
			const openingChoice = openingPicker ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setOpeningPicker(null); } }, "← 返回"), h("span", null, openingPicker.card.name + " · 选择开场白"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setOpeningPicker(null); setPicking(false); } }, "关闭")),
				h("div", { className: "dsh-tavern-greeting-nav" },
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "上一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index - 1 + openingPicker.openings.length) % openingPicker.openings.length })); } }, "←"),
					h("div", { className: "dsh-tavern-greeting-count" }, (openingPicker.index + 1) + " / " + openingPicker.openings.length),
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "下一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index + 1) % openingPicker.openings.length })); } }, "→")
				),
				h("div", { className: "dsh-tavern-greeting-preview" }, selectedOpening ? selectedOpening.text : ""),
				h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || !selectedOpening, onClick: function () { if (selectedOpening) newConversation(openingPicker.card, null, selectedOpening.id); } }, "以此开场"))
			) : null;
			const playPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": openingPicker ? "选择开场白" : "选择人物卡开始游玩" }, openingPicker ? openingChoice : h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "选择人物卡 · 开始游玩"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入人物卡"), h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				cards.length ? h(React.Fragment, null, h("div", { className: "dsh-tavern-side-empty", style: { padding: "4px 6px" } }, "已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。"), cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { preparePlayConversation(card); } }, h("b", null, card.name), h("span", null, card.script ? ("剧本：" + card.script.title + " · " + card.script.chunkCount + " 块") : "自由故事（未绑定剧本）")),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "删除人物卡及其所有对话", onClick: function () { if (window.confirm("删除人物卡“" + card.name + "”吗？\n工作版、原版及相关对话都会删除。")) call("deleteCard", { path: card.path }).then(refresh, function (err) { setError(String(err && err.message || err)); }); } }, "删除"),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "导出为 SillyTavern 兼容 JSON", onClick: function () { exportCard(card); } }, "导出")
				); })) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡。\n点“导入人物卡”添加 PNG/JSON 卡片。")
			));
			const cardEditRows = cards.length ? cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
				h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(card, "edit", "修改人物卡"); } }, h("b", null, card.name), h("span", null, "选择这张人物卡开始修改"))
			); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡，可先在空白工作台中创建。");
			const chosenInitialResources = Object.keys(selectedInitialResources).map(function (key) { return selectedInitialResources[key]; });
			function initialResourceGroup(title, items) {
				return h(React.Fragment, null,
					h("div", { className: "dsh-tavern-picker-group" }, title + " · " + items.length),
					items.length ? items.map(function (item) {
						const key = item.kind + ":" + item.path;
						const selected = !!selectedInitialResources[key];
						return h("button", { key: item.kind + ":" + item.path, className: "dsh-tavern-card-pick" + (selected ? " selected" : ""), "aria-pressed": selected ? "true" : "false", disabled: busy, onClick: function () { toggleInitialResource(item); } }, h("b", null, (selected ? "✓ " : "") + item.title), h("span", null, item.chunkCount ? item.chunkCount + " 块" : "可作为人物卡参考资料"));
					}) : h("div", { className: "dsh-tavern-side-empty", style: { padding: "8px" } }, "暂无")
				);
			}
			const initialResourcePicker = initialResources.length ? h(React.Fragment, null,
				initialResourceGroup(cardEntry === "boundary" ? "预设" : "资料", initialResources),
				h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || !chosenInitialResources.length, onClick: function () {
					if (cardEntry === "boundary") newCardConversation(null, "boundary", "从预设提取破甲", chosenInitialResources);
					else newCardConversation(null, "extract", "从资料新建人物卡", chosenInitialResources);
				} }, "用已选 " + chosenInitialResources.length + " 项开始"))
			) : h("div", { className: "dsh-tavern-empty" }, cardEntry === "boundary" ? "预设库暂无内容。请先从右侧预设库导入。" : "资料库暂无内容。请先空白开始，再从右侧资料库导入。");
			const cardPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": "选择卡片工作台起始任务" },
				h("div", { className: "dsh-tavern-card-picker-head" }, cardEntry ? h("button", { className: "dsh-tavern-btn", onClick: function () { setCardEntry(""); } }, "← 返回") : h("span", null, "选择起始任务"), cardEntry === "extract" || cardEntry === "boundary" ? h("span", null, cardEntry === "boundary" ? "选择初始预设（至少 1 项）" : "选择初始资料（至少 1 项）") : null, h("span", { className: "dsh-tavern-spacer" }), cardEntry === "edit" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入人物卡") : null, h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				cardEntry === "edit" ? cardEditRows : cardEntry === "extract" || cardEntry === "boundary" ? initialResourcePicker : h(React.Fragment, null,
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("edit"); } }, h("b", null, "修改人物卡"), h("span", null, "先选择人物卡，再追加修改任务提示词")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("extract"); } }, h("b", null, "从资料新建人物卡"), h("span", null, "先选择至少一项资料，再进入工作台")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("boundary"); } }, h("b", null, "从预设提取破甲"), h("span", null, "先选择至少一项预设，再进入工作台")),
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
				picking ? h("div", { className: "dsh-tavern-picker-overlay", onMouseDown: function (event) { if (event.target === event.currentTarget) closePicker(); } }, uiMode === "play" ? playPicker : cardPicker) : null
			);
		}

		function TavernResourcesTab(props) {
			const [resources, setResources] = React.useState({ resources: [] });
			const [view, setView] = React.useState(null);
			const [error, setError] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const sourceInput = React.useRef(null);
			function refresh() {
				return Promise.all([rpc("listResources", {}, props.sessionId), rpc("getSession", { sessionId: props.sessionId }, props.sessionId)]).then(function (all) {
					setResources(all[0] || { resources: [] });
					setView(all[1] && all[1].view ? all[1].view : null);
					setError("");
				}, function (err) { setError(String(err && err.message || err)); });
			}
			async function importSourceResource(file) {
				if (!file) return;
				setBusy(true); setError("");
				try { await rpc("importSource", { payload: await parseTextResourceFile(file) }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
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
			if (view && view.mode !== "card") return h("div", { className: "dsh-tavern-empty" }, "资料库只用于卡片工作台。");
			const mounted = view && view.workspace && Array.isArray(view.workspace.mountedResources) ? view.workspace.mountedResources : [];
			function isMounted(kind, path) {
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
			async function deleteResource(item) {
				if (!window.confirm("删除资料“" + item.title + "”吗？\n工作版和原版都会删除。")) return;
				setBusy(true); setError("");
				try { await rpc("deleteResource", { path: item.path }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function row(kind, item) {
				const path = item.path;
				const label = item.title;
				const bindings = kind === "source" && Array.isArray(item.boundCards) ? item.boundCards.map(function (card) { return card.name; }) : [];
				const meta = (item.chunkCount ? item.chunkCount + " 块 · " : "") + (bindings.length ? "已绑定：" + bindings.join("、") : "未绑定");
				const on = isMounted(kind, path);
				const name = h("button", { className: "dsh-tavern-resource-name dsh-tavern-resource-open", title: "查看工作版：" + label, onClick: function () { props.openResource(item.previewPath, label); } }, label);
				return h("div", { key: path, className: "dsh-tavern-resource-row" },
					name,
					meta ? h("span", { className: "dsh-tavern-resource-meta" }, meta) : null,
					h("button", { className: "dsh-tavern-resource-at", disabled: busy, title: "重命名真实文件", onClick: function () { renameResource(item, label); } }, "重命名"),
					h("button", { className: "dsh-tavern-resource-at", disabled: busy, title: "删除资料", onClick: function () { deleteResource(item); } }, "删除"),
					h("button", { className: "dsh-tavern-resource-at" + (on ? " mounted" : ""), title: on ? "再次在对话中引用" : "在对话中引用", onClick: function () { props.appendMention(kind, path, label); } }, "在对话中引用")
				);
			}
			function group(title, kind, items, actions) {
				return h("section", { className: "dsh-tavern-resource-group" },
					h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length), actions || null),
					items.length ? items.map(function (item) { return row(kind, item); }) : h("div", { className: "dsh-tavern-status-empty" }, "暂无")
				);
			}
			const sourceActions = h("div", { className: "dsh-tavern-resource-actions" }, h("button", { className: "dsh-tavern-resource-import", disabled: busy, onClick: function () { sourceInput.current && sourceInput.current.click(); } }, "导入资料"), h("input", { ref: sourceInput, type: "file", accept: ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importSourceResource(file); event.target.value = ""; } }));
			return h("div", { className: "dsh-tavern-resources" },
					h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "资料库"), h("div", { className: "dsh-tavern-question-sub" }, "素材、剧本和设定 · 可在对话中引用")),
				h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, group("资料", "source", resources.resources || [], sourceActions))
			);
		}

		function PresetLibraryTab(props) {
			const [presets, setPresets] = React.useState([]);
			const [preset, setPreset] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const importInput = React.useRef(null);
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			function refresh() {
				return rpc("listPresets", {}, props.scope.sessionId).then(function (result) { setPresets(result.presets || []); setError(""); return result.presets || []; }, function (err) { setError(String(err && err.message || err)); return []; });
			}
			function loadPreset(path) {
				setError("");
				return rpc("getPreset", { path: path }, props.scope.sessionId).then(function (result) { setPreset(result.preset || null); }, function (err) { setError(String(err && err.message || err)); setPreset(null); });
			}
			async function importPresetFile(file) {
				if (!file) return;
				setBusy(true); setError("");
				try {
					const result = await rpc("importPreset", { payload: await parseTextResourceFile(file) }, props.scope.sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
					await refresh(); await loadPreset(result.preset.path);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function renamePreset(item) {
				const current = item.path.split("/").pop();
				const name = window.prompt("重命名预设", current);
				if (name === null || !name.trim() || name.trim() === current) return;
				setBusy(true); setError("");
				try {
					const result = await rpc("renameResource", { path: item.path, name: name.trim() }, props.scope.sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh();
					if (preset && preset.path === item.path) await loadPreset(result.resource.path);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function deletePresetFile(item) {
				if (!window.confirm("删除预设“" + item.title + "”吗？\n工作版和原版都会删除。")) return;
				setBusy(true); setError("");
				try {
					await rpc("deletePreset", { path: item.path }, props.scope.sessionId);
					if (preset && preset.path === item.path) setPreset(null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			React.useEffect(function () {
				refresh();
				function onData() { refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, [props.scope.sessionId]);
			const h = React.createElement;
			if (preset) {
				const entries = preset.entries || [];
				const regexScripts = preset.regexScripts || [];
				return h("div", { className: "dsh-tavern-presets" },
					h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: function () { setPreset(null); } }, "← 返回预设库"), h("div", { className: "dsh-tavern-status-title" }, preset.title)),
					h("div", { className: "dsh-tavern-preset-detail" },
						error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
						h("div", { className: "dsh-tavern-preset-summary" }, preset.recognized ? (preset.promptCount + " 个提示词条目 · " + preset.enabledCount + " 个启用 · " + preset.regexCount + " 条正则脚本 · " + preset.enabledRegexCount + " 条启用 · 只读展示") : "暂未识别提示词结构 · 原始 JSON 已完整保留", preset.warning ? h("div", null, preset.warning) : null),
						regexScripts.length ? h("div", { className: "dsh-tavern-preset-section-title" }, "正则脚本 · " + regexScripts.length) : null,
						regexScripts.map(function (script, index) {
							const snippet = String(script.findRegex || "").replace(/\s+/g, " ").trim() || "空查找规则";
							const placement = script.placement && script.placement.length ? script.placement.join(", ") : "未设置";
							const metadata = [
								"placement: [" + placement + "]",
								"promptOnly: " + Boolean(script.promptOnly),
								"markdownOnly: " + Boolean(script.markdownOnly),
								"runOnEdit: " + Boolean(script.runOnEdit),
								"substituteRegex: " + String(script.substituteRegex === null ? "null" : script.substituteRegex),
								"minDepth: " + String(script.minDepth === null ? "null" : script.minDepth),
								"maxDepth: " + String(script.maxDepth === null ? "null" : script.maxDepth),
								"trimStrings: " + JSON.stringify(script.trimStrings || [])
							].join("\n");
							return h("details", { key: script.id + ":" + index, className: "dsh-tavern-prompt-row role-regex" },
								h("summary", { className: "dsh-tavern-prompt-head" },
									h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"),
									h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, script.name), h("span", null, snippet), h("span", { className: "dsh-tavern-prompt-tags" }, h("span", { className: "dsh-tavern-prompt-tag" }, "位置 " + placement), script.promptOnly ? h("span", { className: "dsh-tavern-prompt-tag" }, "仅提示词") : null, script.markdownOnly ? h("span", { className: "dsh-tavern-prompt-tag" }, "仅 Markdown") : null, script.runOnEdit ? h("span", { className: "dsh-tavern-prompt-tag" }, "编辑时运行") : null)),
									h("span", { className: "dsh-tavern-prompt-state" + (script.enabled ? "" : " off") }, script.enabled ? "已启用" : "已关闭")
								),
								h("div", { className: "dsh-tavern-regex-body" },
									h("div", { className: "dsh-tavern-regex-label" }, "查找正则"),
									h("pre", { className: "dsh-tavern-regex-code" }, script.findRegex || "（空）"),
									h("div", { className: "dsh-tavern-regex-label" }, "替换内容"),
									h("pre", { className: "dsh-tavern-regex-code" }, script.replaceString || "（空）"),
									h("div", { className: "dsh-tavern-regex-meta" }, metadata)
								)
							);
						}),
						entries.length ? h("div", { className: "dsh-tavern-preset-section-title" }, "提示词条目 · " + entries.length) : null,
						entries.map(function (entry) {
							const role = String(entry.role || "system");
							const snippet = String(entry.content || "").replace(/\s+/g, " ").trim() || (entry.marker ? "由 SillyTavern 在运行时注入内容" : "空条目");
							return h("details", { key: entry.identifier, className: "dsh-tavern-prompt-row role-" + role },
								h("summary", { className: "dsh-tavern-prompt-head" },
									h("span", { className: "dsh-tavern-prompt-role" }, role.toUpperCase()),
									h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, entry.name), h("span", null, snippet), h("span", { className: "dsh-tavern-prompt-tags" }, entry.marker ? h("span", { className: "dsh-tavern-prompt-tag" }, "占位") : null, entry.ordered === false ? h("span", { className: "dsh-tavern-prompt-tag" }, "未编排") : null)),
									h("span", { className: "dsh-tavern-prompt-state" + (entry.enabled ? "" : " off") }, entry.enabled ? "已启用" : "已关闭")
								),
								h("pre", { className: "dsh-tavern-prompt-content" }, entry.content || (entry.marker ? "[" + entry.name + "]" : "（空）"))
							);
						})
					)
				);
			}
			return h("div", { className: "dsh-tavern-presets" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "预设库"), h("div", { className: "dsh-tavern-question-sub" }, "SillyTavern 预设 · 点击查看条目"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入预设"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importPresetFile(file); event.target.value = ""; } })),
				h("div", { className: "dsh-tavern-preset-list" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
					presets.length ? presets.map(function (item) { return h("div", { key: item.path, className: "dsh-tavern-preset-row" }, h("div", { className: "dsh-tavern-preset-row-head" },
						h("button", { className: "dsh-tavern-preset-row-main", onClick: function () { loadPreset(item.path); } }, h("b", null, item.title), h("span", null, item.recognized ? (item.promptCount + " 个提示词 · " + item.enabledCount + " 个启用" + (item.regexCount ? " · " + item.regexCount + " 条正则" : "")) : "结构待识别")),
						h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: function () { renamePreset(item); } }, "重命名"),
						h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: function () { deletePresetFile(item); } }, "删除"),
						sessionMode === "card" ? h("button", { className: "dsh-tavern-resource-at", title: "在对话中引用", onClick: function () { props.appendMention("preset", item.path, item.title); } }, "在对话中引用") : null
					)); }) : h("div", { className: "dsh-tavern-status-empty" }, "还没有预设。导入 SillyTavern JSON 预设后即可阅读。")
				)
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
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
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
				return h(CardFieldsPanel, { view: { card: card }, library: true, busy: busy, onBack: clearCard, onAttach: sessionMode === "card" ? function () { props.appendMention(card.path, card.name); } : null, onRename: renameCard, onExport: exportCardFile, onDelete: deleteCardFile, onSaved: function (saved) { setCard(Object.assign({}, saved, { path: selectedPath })); refreshCards(); } });
			}
			const needle = query.trim().toLocaleLowerCase();
			const visible = cards.filter(function (item) { return !needle || (item.name + " " + item.path).toLocaleLowerCase().includes(needle); });
			return h("div", { className: "dsh-tavern-library" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "人物卡库"), h("div", { className: "dsh-tavern-question-sub" }, cards.length + " 张人物卡"), h("div", { className: "dsh-tavern-library-head-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入人物卡"), h("input", { ref: importInput, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importCardFile(file); event.target.value = ""; } }))),
				h("input", { className: "dsh-tavern-library-search", value: query, placeholder: "搜索名称或文件名", onChange: function (event) { setQuery(event.target.value); } }),
				h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, visible.length ? visible.map(function (item) { return h("div", { key: item.path, className: "dsh-tavern-library-card-row" },
					h("button", { className: "dsh-tavern-library-card", onClick: function () { loadCard(item.path); } }, h("b", null, item.name), h("span", null, item.path.split("/").pop()), item.script ? h("span", null, "已绑定剧本：" + item.script.title) : null),
					sessionMode === "card" ? h("button", { className: "dsh-tavern-resource-at", title: "在对话中引用", onClick: function () { props.appendMention(item.path, item.name); } }, "在对话中引用") : null
				); }) : h("div", { className: "dsh-tavern-empty" }, needle ? "没有匹配的人物卡" : "还没有人物卡") )
			);
		}

		function CardFieldsPanel(props) {
			const [draft, setDraft] = React.useState({});
			const [editingWorldBookKey, setEditingWorldBookKey] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const [script, setScript] = React.useState(null);
			const [availableResources, setAvailableResources] = React.useState([]);
			const [selectedScriptPath, setSelectedScriptPath] = React.useState("");
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
				Promise.all([call("getScriptInfo", { path: cardPath }), call("listResources")]).then(function (all) {
					const currentScript = all[0].script || null;
					setScript(currentScript);
					setAvailableResources(all[1].resources || []);
					setSelectedScriptPath(currentScript ? currentScript.path : "");
					setScriptError("");
				}, function (err) { setScriptError(String(err && err.message || err)); });
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
					const next = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean), character_book: buildWorldBook(draft.character_book) });
					const source = props.view.card || {};
					const baseline = {
						name: source.name || "", tags: source.tags || [], description: source.description || "", personality: source.personality || "", scenario: source.scenario || "",
						first_mes: source.first_mes || "", alternate_greetings: source.alternate_greetings || [], mes_example: source.mes_example || "", system_prompt: source.system_prompt || "",
						post_history_instructions: source.post_history_instructions || "", creator_notes: source.creator_notes || "", character_book: buildWorldBook(normalizeWorldBook(source.character_book))
					};
					const patch = {};
					Object.keys(next).forEach(function (key) { if (JSON.stringify(next[key]) !== JSON.stringify(baseline[key])) patch[key] = next[key]; });
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
					setSelectedScriptPath(res.script ? res.script.path : "");
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
					loadScript();
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function bindSelectedScript() {
				if (!cardPath || !selectedScriptPath) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("bindScript", { cardPath: cardPath, path: selectedScriptPath });
					setScript(res.script || null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function deleteScript() {
				if (!script || !window.confirm("解除剧本《" + (script.title || "未命名") + "》绑定？\n已有剧本会话保留，新会话将按自由故事推进。")) return;
				setScriptBusy(true); setScriptError("");
				try {
					await call("deleteScript", { cardPath: cardPath });
					setScript(null);
					setSelectedScriptPath("");
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
			}).sort(function (a, b) {
				const aValue = Number(a.entry.extensions && a.entry.extensions.display_index);
				const bValue = Number(b.entry.extensions && b.entry.extensions.display_index);
				const aIndex = Number.isFinite(aValue) ? aValue : a.index;
				const bIndex = Number.isFinite(bValue) ? bValue : b.index;
				return aIndex - bIndex || a.index - b.index;
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
							h("button", { className: "dsh-tavern-worldbook-kind", onClick: function () { setBookEntry(index, { constant: entry.constant !== true }); } }, entry.constant === true ? "常驻" : "非常驻"),
							h("button", { className: "dsh-tavern-worldbook-del", onClick: function () { removeBookEntry(index); } }, "删除")
						)
					),
					entry.constant === true ? null : editingWorldBookKey === index
						? h("div", { className: "dsh-tavern-card-field" },
							h("input", { autoFocus: true, value: entry.keysText || "", placeholder: "触发词，逗号分隔", onChange: function (e) { setBookEntry(index, { keysText: e.target.value }); }, onBlur: function () { setEditingWorldBookKey(null); }, onKeyDown: function (e) { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); } })
						)
						: h("button", { className: "dsh-tavern-worldbook-trigger", title: "点击编辑触发词", onClick: function () { setEditingWorldBookKey(index); } }, entry.keysText ? "触发：" + entry.keysText : "＋ 设置触发词（未设置不加载）"),
					h("div", { className: "dsh-tavern-card-field" },
						h("textarea", { value: entry.content || "", placeholder: "这条世界书的内容", onChange: function (e) { setBookEntry(index, { content: e.target.value }); } })
					)
				);
			}
			function worldBookGroup(title, entries, note) {
				return h("section", { className: "dsh-tavern-worldbook-group" },
					h("div", { className: "dsh-tavern-worldbook-group-title" }, title + " · " + entries.length + (note ? "（" + note + "）" : "")),
					entries.length ? entries.map(worldBookEntry) : h("div", { className: "dsh-tavern-worldbook-empty" }, "暂无")
				);
			}
			const worldBookPanel = h("div", { className: "dsh-tavern-worldbook" },
				h("div", { className: "dsh-tavern-worldbook-head" },
					h("span", { className: "dsh-tavern-worldbook-title" }, "世界书 · " + activeWorldBookEntries.length + " 个条目"),
					h("span", { className: "dsh-tavern-worldbook-actions" },
						h("button", { className: "dsh-tavern-worldbook-add", onClick: function () { addBookEntry(true); } }, "＋ 常驻"),
						h("button", { className: "dsh-tavern-worldbook-add", onClick: function () { addBookEntry(false); } }, "＋ 非常驻")
					)
				),
				h("div", { className: "dsh-tavern-worldbook-note" }, "常驻每轮自动加载，DSH 按展示顺序最多加载 10 条；非常驻命中触发词后加载，未设置触发词则不加载。"),
				worldBookGroup("常驻", constantEntries, constantEntries.length > 10 ? "按展示顺序加载前 10 条" : ""),
				worldBookGroup("非常驻", triggeredEntries)
			);
			const cardExtensions = props.view.card.extensions || {};
			const cardRegexScripts = cardExtensions.regexScripts || [];
			const helperScripts = cardExtensions.helperScripts || [];
			const mvuResources = cardExtensions.mvuResources || [];
			const otherExtensions = cardExtensions.otherExtensions || [];
			const extensionCount = Number(cardExtensions.extensionCount) || 0;
			function extensionSectionTitle(title, count) {
				return count ? h("div", { className: "dsh-tavern-preset-section-title" }, title + " · " + count) : null;
			}
			function extensionTags(items) {
				return h("span", { className: "dsh-tavern-prompt-tags" }, items.filter(Boolean).map(function (item, index) { return h("span", { key: index, className: "dsh-tavern-prompt-tag" }, item); }));
			}
			function regexExtensionRow(item, index) {
				const placement = item.placement && item.placement.length ? item.placement.join(", ") : "未设置";
				const snippet = String(item.findRegex || "").replace(/\s+/g, " ").trim() || "空查找规则";
				const metadata = [
					"placement: [" + placement + "]", "promptOnly: " + Boolean(item.promptOnly), "markdownOnly: " + Boolean(item.markdownOnly),
					"runOnEdit: " + Boolean(item.runOnEdit), "substituteRegex: " + String(item.substituteRegex === null ? "null" : item.substituteRegex),
					"minDepth: " + String(item.minDepth === null ? "null" : item.minDepth), "maxDepth: " + String(item.maxDepth === null ? "null" : item.maxDepth),
					"trimStrings: " + JSON.stringify(item.trimStrings || [])
				].join("\n");
				return h("details", { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-regex" },
					h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags(["位置 " + placement, item.promptOnly ? "仅提示词" : "", item.markdownOnly ? "仅 Markdown" : "", item.runOnEdit ? "编辑时运行" : ""])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					h("div", { className: "dsh-tavern-regex-body" },
						h("div", { className: "dsh-tavern-regex-label" }, "查找正则"), h("pre", { className: "dsh-tavern-regex-code" }, item.findRegex || "（空）"),
						h("div", { className: "dsh-tavern-regex-label" }, "替换内容"), h("pre", { className: "dsh-tavern-regex-code" }, item.replaceString || "（空）"),
						h("div", { className: "dsh-tavern-regex-meta" }, metadata)
					)
				);
			}
			function helperScriptRow(item, index) {
				const snippet = String(item.content || "").replace(/\s+/g, " ").trim() || "空脚本";
				return h("details", { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-script" },
					h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "SCRIPT"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags([item.type, item.buttonCount ? item.buttonCount + " 个按钮" : "", item.chars + " 字"])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					h("div", { className: "dsh-tavern-regex-body" },
						h("div", { className: "dsh-tavern-regex-label" }, "脚本内容"), h("pre", { className: "dsh-tavern-regex-code" }, item.content || "（空）"),
						item.dataText ? h("div", null, h("div", { className: "dsh-tavern-regex-label" }, "脚本配置"), h("pre", { className: "dsh-tavern-regex-code" }, item.dataText)) : null,
						item.info ? h("div", null, h("div", { className: "dsh-tavern-regex-label" }, "说明"), h("pre", { className: "dsh-tavern-regex-code" }, item.info)) : null,
						item.exportWith !== null ? h("div", { className: "dsh-tavern-regex-meta" }, "export_with: " + JSON.stringify(item.exportWith)) : null
					)
				);
			}
			function otherExtensionRow(item, index) {
				return h("details", { key: item.ref || item.name || index, className: "dsh-tavern-prompt-row role-extension" },
					h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "EXT"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, item.type + " · " + item.chars + " 字")), h("span", { className: "dsh-tavern-mvu-state" }, "只读")),
					h("pre", { className: "dsh-tavern-prompt-content" }, item.text || "（空）")
				);
			}
			const extensionPanel = h("div", { className: "dsh-tavern-card-extensions" },
				h("div", { className: "dsh-tavern-extension-note" }, "这里只读取人物卡工作区中的完整扩展数据，不执行任何卡内脚本。MVU 按名称和内容识别，用于帮助定位相关资源，不代表已经完整解析其运行逻辑。"),
				extensionSectionTitle("正则脚本", cardRegexScripts.length), cardRegexScripts.map(regexExtensionRow),
				extensionSectionTitle("Tavern Helper 脚本", helperScripts.length), helperScripts.map(helperScriptRow),
				extensionSectionTitle("MVU 相关资源", mvuResources.length),
				mvuResources.length ? h("div", { className: "dsh-tavern-mvu-list" }, mvuResources.map(function (item, index) { return h("div", { key: item.ref || index, className: "dsh-tavern-mvu-row" }, h("span", { className: "dsh-tavern-mvu-kind" }, item.kindLabel), h("span", { className: "dsh-tavern-mvu-name", title: item.name }, item.name), h("span", { className: "dsh-tavern-mvu-state" }, item.enabled ? "已启用" : "已关闭")); })) : null,
				extensionSectionTitle("其他扩展", otherExtensions.length), otherExtensions.map(otherExtensionRow),
				extensionCount === 0 && mvuResources.length === 0 ? h("div", { className: "dsh-tavern-worldbook-empty" }, "这张人物卡没有可展示的扩展内容") : null
			);
			const scriptPanel = h("div", { className: "dsh-tavern-script-row" },
				h("div", { className: "dsh-tavern-script-info" }, script ? h("span", null, h("b", null, "当前剧本："), script.title + " · " + script.chunkCount + " 块 · " + script.sourceChars + " 字") : h("span", null, "未绑定剧本；游玩时按自由故事推进")),
				h("select", { value: selectedScriptPath, disabled: scriptBusy || !availableResources.length, onChange: function (event) { setSelectedScriptPath(event.target.value); } }, h("option", { value: "" }, "选择已有资料"), availableResources.map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); })),
				h("button", { className: script ? "dsh-tavern-script-file" : "dsh-tavern-script-primary", disabled: scriptBusy || !selectedScriptPath || !!(script && script.path === selectedScriptPath), onClick: bindSelectedScript }, script ? "更换绑定" : "绑定"),
				h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
				h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: function () { scriptFileRef.current && scriptFileRef.current.click(); } }, "导入新资料并绑定"),
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
					props.library ? h("div", { className: "dsh-tavern-library-head-actions" }, props.onAttach ? h("button", { className: "dsh-tavern-btn", onClick: props.onAttach }, "在对话中引用") : null, h("button", { className: "dsh-tavern-btn", onClick: props.onRename }, "重命名文件"), h("button", { className: "dsh-tavern-btn", onClick: props.onExport }, "导出"), h("button", { className: "dsh-tavern-btn", onClick: props.onDelete }, "删除")) : null
				),
				scriptHero,
				h("div", { className: "dsh-tavern-card-fields" },
					h("details", { className: "dsh-tavern-card-advanced", open: true }, h("summary", null, "基本信息"), F("name", "角色名称"), F("tags", "标签"), F("description", "角色描述", true), F("personality", "性格"), F("scenario", "场景设定"), F("first_mes", "开场白", true), F("alternate_greetings", "备选开场白（--- 分隔）"), F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("mes_example", "对话示例", true), F("creator_notes", "创作者备注")),
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "世界书 · " + activeWorldBookEntries.length + " 条"), worldBookPanel),
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "扩展内容 · " + extensionCount + " 项"), extensionPanel),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存字段"))
				)
			);
		}

		function BoundaryPromptTab(props) {
			const h = React.createElement;
			const [files, setFiles] = React.useState([]);
			const [selection, setSelection] = React.useState({ enabled: false, filename: "", file: null, lastInjection: null });
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			async function load() {
				try {
					const result = await rpc("listBoundaryPrompts", {}, props.sessionId);
					setFiles(result.files || []);
					setSelection(result.selection || { enabled: false, filename: "", file: null, lastInjection: null });
					setError("");
				} catch (err) { setError(String(err && err.message || err)); }
			}
			React.useEffect(function () {
				load();
				const timer = window.setInterval(load, 3000);
				return function () { window.clearInterval(timer); };
			}, [props.sessionId]);
			async function choose(filename, enabled) {
				setBusy(true); setError("");
				try {
					const result = await rpc("selectBoundaryPrompt", { filename: filename, enabled: enabled }, props.sessionId);
					setSelection(result.selection);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function remove(file) {
				if (!window.confirm("删除破甲文件“" + file.filename + "”？其他会话若正在使用它，将自动停止注入。")) return;
				setBusy(true); setError("");
				try { await rpc("deleteBoundaryPrompt", { filename: file.filename }, props.sessionId); await load(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			const injected = selection.lastInjection && selection.lastInjection.filename === selection.filename;
			return h("aside", { className: "dsh-tavern-boundary" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "破甲库"),
					h("div", { className: "dsh-tavern-question-sub" }, "这里只负责当前会话的选择和开关；启用后注入当前会话的所有模型任务。制作、提取和修改请进入卡片工作台。")
				),
				h("div", { className: "dsh-tavern-boundary-body" },
					h("section", { className: "dsh-tavern-boundary-current" },
						h("label", { className: "dsh-tavern-boundary-toggle" }, h("input", { type: "checkbox", checked: selection.enabled === true, disabled: busy || !selection.filename, onChange: function (event) { choose(selection.filename, event.target.checked); } }), "为当前会话启用破甲"),
						h("select", { value: selection.filename || "", disabled: busy, onChange: function (event) { choose(event.target.value, selection.enabled); } },
							h("option", { value: "" }, "选择一个文件"),
							files.map(function (file) { return h("option", { key: file.filename, value: file.filename }, file.filename); })
						),
						h("div", { className: "dsh-tavern-boundary-status" }, selection.enabled ? (injected ? "已启用 · 最近一次模型任务已注入" : "已启用 · 将从下一次模型任务开始注入") : "当前关闭，不会注入任何破甲内容")
					),
					files.length ? files.map(function (file) { return h("details", { key: file.filename, className: "dsh-tavern-boundary-row" + (file.filename === selection.filename ? " active" : "") },
						h("summary", { className: "dsh-tavern-boundary-row-head" }, h("b", null, file.filename), h("span", { className: "dsh-tavern-boundary-meta" }, file.chars + " 字")),
						h("pre", { className: "dsh-tavern-boundary-preview" }, file.text),
						h("button", { className: "dsh-tavern-worldbook-del", disabled: busy, onClick: function () { remove(file); } }, "删除文件")
					); }) : h("div", { className: "dsh-tavern-status-empty" }, "还没有破甲文件。请在卡片工作台中制作。"),
					error ? h("div", { className: "dsh-card-error" }, error) : null
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
			function reconcileLibraryTabTitles() {
				if (!ctx.betterSidebar || typeof ctx.betterSidebar.getSnapshot !== "function" || typeof ctx.betterSidebar.updateTab !== "function") return;
				const state = ctx.betterSidebar.getSnapshot().state;
				if (!state) return;
				const expectedTitles = {
					"dsh-tavern:cards": "人物卡库",
					"dsh-tavern:presets": "预设库",
					"dsh-tavern:boundary-prompts": "破甲库",
					"dsh-tavern:resources": "资料库"
				};
				function visit(node) {
					if (!node) return;
					if (node.kind === "split") {
						(node.children || []).forEach(visit);
						return;
					}
					(node.tabs || []).forEach(function (tab) {
						const title = expectedTitles[tab.type];
						if (title && tab.title !== title) ctx.betterSidebar.updateTab(tab.id, { title: title });
					});
				}
				visit(state.splits);
				visit(state.bottomSplits);
			}
			function appendMention(sessionId, kind, path, label) {
				try {
					const actx = ctx.sessions.scope(sessionId);
					const conversation = ctx.get("conversation");
					if (!actx || !conversation) throw new Error("当前对话输入框不可用");
					const input = conversation.input.for(actx);
					const safePath = String(path || "").replace(/\\/g, "/").replace(/["\r\n]/g, "");
					const mention = "@\"" + safePath + "\"";
					const draft = input.state.getSnapshot().draft;
					input.setDraft(draft.trim() === "" ? mention : draft + (/\s$/.test(draft) ? "" : " ") + mention);
				} catch (err) {
					console.warn("dsh-tavern: resource mention failed", err);
				}
			}
			async function injectTaskPrompt(sessionId, task, label, card, hasInitialResources) {
				const result = await rpc("getCardTaskPrompt", { task: task }, sessionId);
				const actx = ctx.sessions.scope(sessionId);
				const conversation = ctx.get("conversation");
				if (!actx || !conversation) throw new Error("当前对话输入框不可用");
				const input = conversation.input.for(actx);
				const draft = String(input.state.getSnapshot().draft || "");
				const supplement = draft;
				const targetPath = card && card.path ? String(card.path).replace(/\\/g, "/").replace(/["\r\n]/g, "") : "";
				const targetSection = targetPath ? "\n\n【目标人物卡】\n@\"" + targetPath + "\"" : "";
				const materialSection = hasInitialResources ? (task === "boundary" ? "\n\n【初始预设】\n" : "\n\n【初始资料】\n") : "";
				const taskText = "【卡片任务：" + label + "】" + targetSection + "\n\n" + String(result && result.text || "").trim() + materialSection;
				input.setDraft(taskText + supplement);
			}
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:status",
				title: "酒馆状态",
				order: 7,
				single: true,
				component: function (props) {
					return React.createElement(TavernStatusTab, { sessions: ctx.sessions, sessionId: props.scope.sessionId });
				}
			}), "dsh-tavern: Better Sidebar status tab");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:boundary-prompts",
				title: "破甲库",
				order: 5,
				single: true,
				component: function (props) {
					return React.createElement(BoundaryPromptTab, { sessionId: props.scope.sessionId });
				}
			}), "dsh-tavern: Better Sidebar boundary prompt tab");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:presets",
				title: "预设库",
				order: 4,
				single: true,
				component: function (props) {
					return React.createElement(PresetLibraryTab, Object.assign({}, props, { appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); } }));
				}
			}), "dsh-tavern: Better Sidebar preset library tab");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:resources",
				title: "资料库",
				order: 6,
				single: true,
				component: function (props) {
					return React.createElement(TavernResourcesTab, { sessionId: props.scope.sessionId, appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); }, openResource: function (path, title) { if (path) ctx.betterSidebar.openFile({ sessionId: props.scope.sessionId }, path, title); } });
				}
			}), "dsh-tavern: Better Sidebar resources tab");
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:cards",
				title: "人物卡库",
				order: 3,
				single: true,
				component: function (props) { return React.createElement(CardLibraryTab, Object.assign({}, props, { appendMention: function (path, label) { appendMention(props.scope.sessionId, "card", path, label); } })); }
			}), "dsh-tavern: Better Sidebar card library tab");
			ctx.effect(function () {
				reconcileLibraryTabTitles();
				if (typeof ctx.betterSidebar.subscribeState !== "function") return;
				return ctx.betterSidebar.subscribeState(reconcileLibraryTabTitles);
			}, "dsh-tavern: reconcile persisted library tab titles");
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
					openCardLibraryTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:cards" }, { sessionId: sessionId }); ctx.betterSidebar.updateTab("dsh-tavern:cards", { meta: null }); },
					openPresetLibraryTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:presets" }, { sessionId: sessionId }); },
					openBoundaryLibraryTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:boundary-prompts" }, { sessionId: sessionId }); },
					openResourcesTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:resources" }, { sessionId: sessionId }); },
					appendMention: appendMention,
					injectTaskPrompt: injectTaskPrompt
				})); }
			)), "dsh-tavern: Tavern workspace browser");
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
