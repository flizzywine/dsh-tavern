window.__ModuleLoader__.load({
	id: "dsh-tavern-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
			let React = require("react");
			let DshUi = require("@deepseek-ai/dsh-client-ui-primitives");

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
.dsh-tavern-picker-error { position: sticky; top: 0; z-index: 2; margin: 0 0 10px; padding: 10px 12px; border: 1px solid rgba(196,95,95,.45); border-radius: 10px; background: color-mix(in srgb, var(--dsw-specific-sidebar-fill) 88%, #c45f5f 12%); color: #c45f5f; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-tavern-error-center { position: fixed; z-index: 2200; top: 16px; right: 16px; width: min(480px, calc(100vw - 32px)); max-height: min(70vh, 640px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(196,95,95,.5); border-radius: 14px; background: var(--dsw-specific-sidebar-fill); box-shadow: 0 18px 54px rgba(0,0,0,.32); color: var(--dsw-alias-label-primary); }
.dsh-tavern-error-center-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(196,95,95,.25); font-size: 13px; font-weight: 700; }
.dsh-tavern-error-center-head span { flex: 1; }
.dsh-tavern-error-list { overflow: auto; padding: 8px; }
.dsh-tavern-error-item { padding: 10px; border: 1px solid rgba(196,95,95,.25); border-radius: 10px; background: rgba(196,95,95,.08); }
.dsh-tavern-error-item + .dsh-tavern-error-item { margin-top: 8px; }
.dsh-tavern-error-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: #c45f5f; font-size: 12px; font-weight: 700; }
.dsh-tavern-error-meta time { margin-left: auto; color: var(--dsw-alias-label-secondary); font-weight: 400; }
.dsh-tavern-error-message { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.55; }
.dsh-tavern-assistant { display: flex; flex-direction: column; gap: 16px; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 28px; }
.dsh-tavern-assistant-reasoning { color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dsh-tavern-assistant-reasoning summary { cursor: pointer; user-select: none; }
.dsh-tavern-assistant-reasoning pre { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.dsh-tavern-assistant-stopped { align-self: flex-start; border-radius: 6px; padding: 0 6px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 18px; }
.dsh-tavern-swipe-controls { align-self: center; display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 24px; }
.dsh-tavern-swipe-controls button { min-width: 28px; height: 26px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-tavern-swipe-controls button:disabled { opacity: .35; cursor: default; }
.dsh-tavern-message-frame { display: block; width: 100%; min-height: 48px; border: 0; background: transparent; overflow: hidden; }
.dsh-tavern-user-row { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.dsh-tavern-user-stack { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 0; max-width: min(525px, 82%); }
.dsh-tavern-user-bubble { max-width: 100%; padding: 10px 16px; border-radius: 22px; background: var(--dsw-specific-bubble); color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; overflow-wrap: anywhere; }
.dsh-tavern-user-extra { margin-top: 8px; }
.dsh-tavern-user-actions { display: flex; align-items: center; gap: 7px; min-height: 20px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-tavern-user-copy { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.dsh-tavern-user-copy:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
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
.dsh-tavern-mode-switch.compatibility-enabled { grid-template-columns: repeat(3, 1fr); }
.dsh-tavern-mode-switch button { height: 30px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; }
.dsh-tavern-mode-switch button.active { background: var(--dsw-specific-input-major); color: #9a622f; box-shadow: var(--dsw-shadow-lv1); font-weight: 700; }
.dsh-tavern-picker-tabs { display: flex; gap: 6px; margin: 2px 0 8px; }
.dsh-tavern-picker-tabs button { flex: 1; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 8px; cursor: pointer; font-size: 12px; }
.dsh-tavern-picker-tabs button.active { border-color: #a66b35; color: #a66b35; background: rgba(166,107,53,.10); font-weight: 700; }
.dsh-tavern-side-title { margin: 16px 4px 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-tavern-compatibility-notice { margin: 10px 2px 0; padding: 10px 11px; border: 1px solid rgba(166,107,53,.28); border-radius: 9px; background: rgba(166,107,53,.08); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.55; }
.dsh-tavern-compatibility-notice strong { color: var(--dsw-alias-label-primary); }
.dsh-tavern-side-list { min-height: 0; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.dsh-tavern-side-row { position: relative; display: flex; align-items: center; border: 0; border-radius: 8px; background: transparent; color: inherit; }
.dsh-tavern-side-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-side-row.active { background: var(--dsw-alias-interactive-bg-selected, rgba(120,90,60,.14)); }
.dsh-tavern-side-row-main { min-width: 0; flex: 1; border: 0; padding: 8px 5px 8px 9px; text-align: left; background: transparent; color: inherit; cursor: pointer; }
.dsh-tavern-side-row-more { width: 28px; height: 28px; flex: none; margin-right: 3px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; opacity: 0; }
.dsh-tavern-side-row:hover .dsh-tavern-side-row-more, .dsh-tavern-side-row-more[aria-expanded="true"] { opacity: 1; }
.dsh-tavern-side-row-more:hover { background: var(--dsw-alias-interactive-bg-hover); color: inherit; }
.dsh-tavern-side-row-menu { position: absolute; z-index: 30; top: 32px; right: 4px; min-width: 96px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-specific-sidebar-fill); box-shadow: 0 8px 24px rgba(0,0,0,.14); }
.dsh-tavern-side-row-menu button { display: block; width: 100%; border: 0; border-radius: 6px; padding: 7px 10px; text-align: left; background: transparent; color: inherit; cursor: pointer; }
.dsh-tavern-side-row-menu button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-side-row-menu button.danger { color: #c34f4f; }
.dsh-tavern-side-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dsh-tavern-side-row-meta { margin-top: 3px; display: flex; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-tavern-side-empty { padding: 18px 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; text-align: center; }
.dsh-tavern-update { flex: none; margin-top: 8px; padding-top: 9px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-tavern-update-identity { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.45; }
.dsh-tavern-update-actions { display: flex; gap: 6px; margin-top: 7px; }
.dsh-tavern-update-button { width: 100%; height: 32px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 11px; }
.dsh-tavern-update-button:hover { border-color: #a66b35; color: #a66b35; background: rgba(166,107,53,.08); }
.dsh-tavern-update-button.primary { border-color: #a66b35; color: #a66b35; background: rgba(166,107,53,.08); }
.dsh-tavern-update-button:disabled { opacity: .55; cursor: default; }
.dsh-tavern-update-status { margin-top: 5px; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1.45; white-space: pre-wrap; }
.dsh-tavern-update-status.error { color: #c45f5f; }
.dsh-tavern-settings-section { display: flex; flex-direction: column; gap: 18px; color: var(--dsw-alias-label-primary); }
.dsh-tavern-settings-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 1.6; }
.dsh-tavern-settings-group { overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-settings-row { display: flex; align-items: center; gap: 24px; padding: 18px 20px; cursor: pointer; }
.dsh-tavern-settings-copy { min-width: 0; flex: 1; }
.dsh-tavern-settings-title { display: block; font-size: 15px; font-weight: 650; }
.dsh-tavern-settings-desc { display: block; margin-top: 5px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.55; }
.dsh-tavern-settings-switch { position: relative; width: 42px; height: 24px; flex: none; }
.dsh-tavern-settings-switch input { position: absolute; opacity: 0; pointer-events: none; }
.dsh-tavern-settings-track { position: absolute; inset: 0; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); transition: background .18s ease; }
.dsh-tavern-settings-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform .18s ease, background .18s ease; }
.dsh-tavern-settings-switch input:checked + .dsh-tavern-settings-track { background: #9a622f; }
.dsh-tavern-settings-switch input:checked + .dsh-tavern-settings-track::after { transform: translateX(18px); background: #fff; }
.dsh-tavern-settings-switch input:focus-visible + .dsh-tavern-settings-track { outline: 2px solid #a66b35; outline-offset: 2px; }
.dsh-tavern-settings-error { color: #c45f5f; font-size: 13px; }
.dsh-tavern-player-action { border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; padding: 4px 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 11px; }
.dsh-tavern-player-action:hover { border-color: #a66b35; color: #a66b35; background: rgba(166,107,53,.08); }
.dsh-tavern-preset-status { max-width: min(260px, 28vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; padding: 4px 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-tavern-export-action { min-height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 7px 14px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 13px; white-space: nowrap; }
.dsh-tavern-export-action:hover { border-color: #a66b35; color: #a66b35; background: rgba(166,107,53,.08); }
.dsh-tavern-export-action:disabled { opacity: .55; cursor: default; }
.dsh-tavern-picker-overlay { position: fixed; z-index: 1000; inset: 0; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 24px; background: rgba(20,18,24,.42); backdrop-filter: blur(2px); }
.dsh-tavern-card-picker { width: min(860px, calc(100vw - 48px)); max-height: min(80vh, 760px); overflow: auto; box-sizing: border-box; padding: 20px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-specific-sidebar-fill); box-shadow: 0 22px 64px rgba(0,0,0,.30); }
.dsh-tavern-card-picker-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 700; }
.dsh-tavern-card-picker-help { margin: 4px 0 12px; color: var(--dsw-alias-text-l2); font-size: 13px; }
.dsh-tavern-card-pick { width: 100%; padding: 9px; margin-top: 5px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-card-pick:hover { border-color: #a56d3c; background: rgba(145,92,44,.10); }
.dsh-tavern-card-pick.selected { border-color: #a56d3c; background: rgba(145,92,44,.14); }
.dsh-tavern-card-pick b { display: block; color: #a66b35; }
.dsh-tavern-card-pick span { display: block; margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; }
.dsh-tavern-card-pick-wrap { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 7px; align-items: stretch; }
.dsh-tavern-greeting-preview { display: block; width: 100%; height: min(52vh, 560px); box-sizing: border-box; margin: 8px 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: #fff; }
.dsh-tavern-greeting-nav { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; }
.dsh-tavern-greeting-count { color: var(--dsw-alias-label-secondary); text-align: center; font-size: 12px; }
.dsh-tavern-player-name { display: grid; grid-template-columns: auto minmax(180px, 320px); gap: 10px; align-items: center; margin: 10px 0 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-tavern-player-name input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary); font: inherit; outline: none; }
.dsh-tavern-player-name input:focus { border-color: #a66b35; }
.dsh-tavern-player-name-help { margin: -3px 0 8px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.5; }
@media (max-width: 640px) {
  .dsh-tavern-picker-overlay { align-items: stretch; padding: 12px; }
  .dsh-tavern-card-picker { width: 100%; max-height: none; padding: 14px; border-radius: 14px; }
  .dsh-tavern-card-pick-wrap { grid-template-columns: minmax(0, 1fr) auto auto; }
  .dsh-tavern-greeting-preview { max-height: 60vh; }
  .dsh-tavern-player-name { grid-template-columns: 1fr; gap: 5px; }
  .dsh-tavern-preset-status { display: none; }
}
.dsh-tavern-picker-group { margin-top: 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 700; }
.dsh-tavern-picker-foot { position: sticky; bottom: -10px; display: flex; justify-content: flex-end; margin: 10px -10px -10px; padding: 10px; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-script-file { align-self: center; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 8px; cursor: pointer; font-size: 11px; }
.dsh-tavern-script-file:hover { border-color: #a56d3c; color: #a66b35; }
.dsh-tavern-choice-trigger { border: 1px solid rgba(166,107,53,.55); background: rgba(166,107,53,.10); color: #a66b35; cursor: pointer; padding: 3px 9px; border-radius: 7px; font-size: 12px; font-weight: 650; }
.dsh-tavern-choice-trigger:hover { background: rgba(166,107,53,.20); color: #8e5728; }
.dsh-tavern-dock-actions { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; max-width: var(--dsh-composer-card-max-width, 780px); box-sizing: border-box; margin: 0 auto; padding: 8px 12px 0; flex-wrap: wrap; }
.dsh-tavern-candidate-error-banner { width: 100%; max-width: var(--dsh-composer-card-max-width, 780px); box-sizing: border-box; margin: 0 auto; padding: 8px 12px; border: 1px solid rgba(196,95,95,.45); border-radius: 10px; background: rgba(196,95,95,.10); color: #c45f5f; font-size: 12px; line-height: 1.5; }
.dsh-tavern-timeout-banner { display: flex; align-items: center; gap: 8px; width: 100%; max-width: var(--dsh-composer-card-max-width, 780px); box-sizing: border-box; margin: 0 auto; padding: 8px 12px; border: 1px solid rgba(196,145,72,.45); border-radius: 10px; background: rgba(196,145,72,.10); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5; }
.dsh-tavern-timeout-banner span { flex: 1; }
.dsh-tavern-timeout-banner button { flex: none; border: 1px solid rgba(166,107,53,.55); border-radius: 7px; padding: 4px 8px; background: transparent; color: #a66b35; cursor: pointer; }
.dsh-tavern-choice-error { padding: 5px; color: #c45f5f; font-size: 12px; }
.dsh-tavern-question { width: 100%; max-width: var(--dsh-composer-card-max-width, 780px); box-sizing: border-box; margin: 0 auto; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-specific-tip, var(--dsw-specific-sidebar-fill)); box-shadow: var(--dsw-shadow-lv1); }
.dsh-tavern-candidate-question { max-width: 680px; }
.dsh-tavern-question.collapsed { padding: 9px 12px; box-shadow: none; }
.dsh-tavern-question-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; font-weight: 750; cursor: pointer; }
.dsh-tavern-question.collapsed .dsh-tavern-question-head { margin-bottom: 0; }
.dsh-tavern-question-close { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 16px; line-height: 1; }
.dsh-tavern-question-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; }
.dsh-tavern-question-body { max-height: min(360px, 45vh); overflow-y: auto; margin: 6px -4px 0; padding: 0 4px; }
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
.dsh-tavern-script-preview { margin: 0; padding: 14px 16px 24px; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.7; color: var(--dsw-alias-label-primary); }
.dsh-tavern-resource-group { margin-bottom: 16px; }
.dsh-tavern-resource-group-title { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 750; }
.dsh-tavern-resource-actions { display: flex; align-items: center; gap: 5px; }
.dsh-tavern-resource-actions select { min-width: 0; max-width: 120px; height: 25px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-specific-input-major); color: inherit; font-size: 10px; }
.dsh-tavern-resource-import { height: 25px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 10px; }
.dsh-tavern-resource-import:hover { border-color: #a66b35; color: #a66b35; }
.dsh-tavern-resource-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 8px; }
.dsh-tavern-resource-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-resource-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-tavern-resource-open { padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-resource-open:hover { color: #a66b35; text-decoration: underline; }
.dsh-tavern-resource-meta { color: var(--dsw-alias-label-tertiary); font-size: 10px; white-space: nowrap; }
.dsh-tavern-resource-at { flex: none; border: 1px solid rgba(166,107,53,.45); border-radius: 7px; padding: 3px 7px; background: rgba(166,107,53,.08); color: #a66b35; cursor: pointer; font-size: 11px; font-weight: 700; }
.dsh-tavern-resource-at:hover { background: rgba(166,107,53,.18); }
.dsh-tavern-resource-at.mounted { border-color: var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-tertiary); }
.dsh-tavern-resource-binding { flex: 0 0 100%; display: flex; align-items: center; gap: 6px; padding-left: 2px; }
.dsh-tavern-resource-binding select { flex: 1; min-width: 0; height: 25px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-specific-input-major); color: inherit; font-size: 10px; }
.dsh-tavern-presets { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-preset-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 20px; }
.dsh-tavern-preset-row { margin-bottom: 8px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-preset-row-head { display: block; }
.dsh-tavern-preset-row-main { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.dsh-tavern-preset-row-main b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-tavern-preset-row-main span { display: block; margin-top: 3px; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-preset-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; margin-top: 8px; }
.dsh-tavern-preset-detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.dsh-tavern-preset-detail { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 24px; }
.dsh-tavern-preset-summary { margin-bottom: 10px; padding: 9px 10px; border: 1px solid rgba(166,107,53,.35); border-radius: 9px; background: rgba(166,107,53,.08); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.dsh-tavern-external-preset-notice { padding: 14px 16px; font-size: 14px; line-height: 1.7; }
.dsh-tavern-external-preset-notice p { margin: 4px 0 0; }
.dsh-tavern-external-preset-notice strong { color: #a66b35; font-weight: 750; }
.dsh-tavern-external-preset-notice .dsh-tavern-preset-warning { color: #b4473a; }
.dsh-tavern-bypass-plan-notice { padding: 14px 16px; font-size: 14px; line-height: 1.7; }
.dsh-tavern-bypass-plan-notice p { margin: 4px 0 0; }
.dsh-tavern-bypass-plan-notice strong { color: #a66b35; font-weight: 750; }
.dsh-tavern-bypass-plan-notice .dsh-tavern-preset-warning { color: #b4473a; }
.dsh-tavern-preset-selector { display: grid; grid-template-columns: auto minmax(0,1fr); align-items: center; gap: 8px; margin-bottom: 10px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-specific-input-major); font-size: 11px; }
.dsh-tavern-preset-selector select { min-width: 0; width: 100%; height: 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 0 7px; background: var(--dsw-specific-input-major); color: inherit; }
.dsh-tavern-preset-section-title { margin: 14px 2px 7px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 800; letter-spacing: .04em; }
.dsh-tavern-plan-phase { margin-top: 12px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-plan-phase-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.dsh-tavern-plan-phase-title { font-size: 13px; font-weight: 800; }
.dsh-tavern-plan-phase-description { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.dsh-tavern-plan-phase-count { flex: none; color: var(--dsw-alias-label-secondary); font-size: 10px; white-space: nowrap; }
.dsh-tavern-plan-phase-empty { padding: 8px 2px 2px; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
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
.dsh-tavern-extract-state { gap: 8px; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 650; }
.dsh-tavern-extract-state::before { width: 11px; height: 11px; }
.dsh-tavern-extract-state input[type="checkbox"] { width: 18px; height: 18px; margin: 0; accent-color: #23bd63; }
.dsh-tavern-plan-name-field { display: grid; gap: 5px; margin-top: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 650; }
.dsh-tavern-plan-name-field input { box-sizing: border-box; width: 100%; min-width: 0; padding: 7px 9px; font: inherit; font-weight: 400; }
.dsh-tavern-plan-model-editor { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px; }
.dsh-tavern-plan-model-editor input { box-sizing: border-box; width: 100%; min-width: 0; padding: 7px 9px; font: inherit; font-weight: 400; }
.dsh-tavern-prompt-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.dsh-tavern-prompt-tag { padding: 1px 5px; border-radius: 4px; background: rgba(237,151,20,.14); color: #c77800; font-size: 9px; }
.dsh-tavern-prompt-content { margin: 0; padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font: 10px/1.55 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
.dsh-tavern-prompt-view-actions { display: flex; justify-content: flex-end; padding: 8px 10px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-tavern-prompt-editor { display: grid; grid-template-columns: minmax(0,1fr) 150px; gap: 10px; padding: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-tavern-prompt-editor-field { display: grid; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-prompt-editor-field.full { grid-column: 1 / -1; }
.dsh-tavern-prompt-editor-field input[type="text"], .dsh-tavern-prompt-editor-field select, .dsh-tavern-prompt-editor-field textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-specific-input-minor); color: var(--dsw-alias-label-primary); padding: 8px 9px; font: inherit; }
.dsh-tavern-prompt-editor-field textarea { min-height: 220px; resize: vertical; font: 10px/1.55 ui-monospace, monospace; }
.dsh-tavern-prompt-editor-toggle { display: flex; align-items: center; gap: 7px; min-height: 34px; }
.dsh-tavern-prompt-editor-note { grid-column: 1 / -1; color: var(--dsw-alias-label-secondary); font-size: 9px; }
.dsh-tavern-prompt-editor-actions { position: sticky; bottom: 0; grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; padding: 9px 0 0; background: var(--dsw-specific-input-major); z-index: 1; }
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
.dsh-tavern-dsh-preset { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 24px; }
.dsh-tavern-dsh-preset-controls { display: grid; grid-template-columns: auto minmax(0,1fr); align-items: center; gap: 8px; margin-bottom: 10px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-specific-input-major); font-size: 11px; }
.dsh-tavern-dsh-preset-controls select { min-width: 0; width: 100%; height: 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 0 7px; background: var(--dsw-specific-input-major); color: inherit; }
.dsh-tavern-dsh-preset-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.dsh-tavern-dsh-preset-badge { border-radius: 999px; padding: 3px 8px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-dsh-preset-badge.front { background: rgba(58,132,255,.13); color: #4f92ff; }
.dsh-tavern-dsh-preset-badge.middle { background: rgba(237,151,20,.15); color: #d27b00; }
.dsh-tavern-dsh-preset-badge.back { background: rgba(180,124,255,.14); color: #9c62ed; }
.dsh-tavern-dsh-preset-phase { margin-bottom: 15px; }
.dsh-tavern-dsh-preset-phase-title { margin: 2px 2px 7px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 800; }
.dsh-tavern-dsh-preset-row { margin-bottom: 6px; border: 1px solid var(--dsw-alias-border-l2); border-left: 4px solid #5b9cff; border-radius: 8px; background: var(--dsw-specific-input-major); overflow: hidden; }
.dsh-tavern-dsh-preset-row.front { border-left-color: #4f92ff; }
.dsh-tavern-dsh-preset-row.middle { border-left-color: #ed9714; }
.dsh-tavern-dsh-preset-row.back { border-left-color: #b47cff; }
.dsh-tavern-dsh-preset-row.off { opacity: .62; }
.dsh-tavern-dsh-preset-row.unconverted { border-left-color: #e06c75; }
.dsh-tavern-dsh-preset-row summary { display: grid; grid-template-columns: 36px minmax(0,1fr) auto; align-items: center; gap: 7px; padding: 8px 9px; cursor: pointer; list-style: none; }
.dsh-tavern-dsh-preset-row summary::-webkit-details-marker { display: none; }
.dsh-tavern-dsh-preset-index { color: var(--dsw-alias-label-tertiary); font: 9px/1 ui-monospace, monospace; }
.dsh-tavern-dsh-preset-name { min-width: 0; }
.dsh-tavern-dsh-preset-name b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.dsh-tavern-dsh-preset-name span { display: block; overflow: hidden; margin-top: 3px; color: var(--dsw-alias-label-tertiary); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-dsh-preset-meta { color: var(--dsw-alias-label-secondary); font-size: 9px; white-space: nowrap; }
.dsh-tavern-dsh-preset-content { margin: 0; padding: 9px 10px; border-top: 1px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); font: 10px/1.55 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
.dsh-tavern-dsh-preset-diagnostics { margin-top: 12px; padding: 8px 10px; border: 1px solid rgba(237,151,20,.35); border-radius: 8px; background: rgba(237,151,20,.07); color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.55; }
.dsh-tavern-dsh-preset-diagnostics summary { cursor: pointer; font-weight: 800; }
.dsh-tavern-dsh-preset-diagnostics ul { margin: 7px 0 0; padding-left: 18px; }
.dsh-tavern-dsh-preset-unconverted-group { margin-top: 9px; }
.dsh-tavern-dsh-preset-unconverted-title { margin: 8px 0 6px; font-weight: 800; }
.dsh-tavern-dsh-preset-raw { margin-top: 6px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 7px; overflow: hidden; }
.dsh-tavern-dsh-preset-raw summary { padding: 7px 8px; cursor: pointer; font-weight: 700; }
.dsh-tavern-status-head { flex: none; padding: 16px 16px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-tavern-status-title { font-size: 15px; font-weight: 800; }
.dsh-tavern-plan-head { display: flex; flex-direction: column; gap: 10px; }
.dsh-tavern-plan-head-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-tavern-plan-head-main .dsh-tavern-status-title { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dsh-tavern-plan-head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-tavern-status-role { margin-top: 5px; color: #a66b35; font-size: 13px; font-weight: 700; }
.dsh-tavern-status-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.dsh-tavern-status-tag { padding: 2px 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-status-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 20px; }
.dsh-tavern-status-section { margin-bottom: 16px; }
.dsh-tavern-script-buttons { display: flex; flex-wrap: wrap; gap: 7px; }
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
.dsh-tavern-debug-panel { display: flex; flex-direction: column; gap: 7px; }
.dsh-tavern-debug-panel select { width: 100%; box-sizing: border-box; padding: 7px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-specific-input-major); color: inherit; font: inherit; font-size: 12px; }
.dsh-tavern-debug-preview { padding: 7px 8px; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.dsh-tavern-debug-open { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid rgba(166,107,53,.4); border-radius: 8px; background: rgba(166,107,53,.08); color: #a66b35; cursor: pointer; font-size: 12px; font-weight: 650; }
.dsh-tavern-debug-open:hover { background: rgba(166,107,53,.16); }
.dsh-tavern-debug-open:disabled { cursor: wait; opacity: .6; }
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
.dsh-tavern-worldbook-add { border: 1px solid rgba(166,107,53,.55); border-radius: 7px; background: rgba(166,107,53,.10); color: #a66b35; padding: 4px 8px; cursor: pointer; font-size: 11px; font-weight: 650; }
.dsh-tavern-worldbook-add:hover { background: rgba(166,107,53,.20); }
.dsh-tavern-worldbook-empty { padding: 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dsh-tavern-worldbook-group + .dsh-tavern-worldbook-group { margin-top: 12px; }
.dsh-tavern-worldbook-entry { margin-bottom: 10px; padding: 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-tavern-worldbook-entry-head { color: #a66b35; cursor: pointer; font-size: 11px; font-weight: 700; }
.dsh-tavern-worldbook-entry-body { padding-top: 9px; }
.dsh-tavern-worldbook-entry-actions { display: flex; align-items: center; gap: 4px; }
.dsh-tavern-worldbook-danger-zone { display: flex; justify-content: flex-end; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-tavern-worldbook-kind { border: 1px solid rgba(166,107,53,.45); border-radius: 999px; background: rgba(166,107,53,.08); color: #a66b35; cursor: pointer; padding: 2px 7px; font-size: 10px; }
.dsh-tavern-worldbook-trigger { display: block; max-width: 100%; margin: 0 0 6px; padding: 1px 0; overflow: hidden; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 10px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tavern-worldbook-trigger:hover { color: #a66b35; }
.dsh-tavern-worldbook-note { margin: -2px 0 8px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.dsh-tavern-worldbook-del { border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 2px 6px; font-size: 11px; }
.dsh-tavern-worldbook-del:hover { color: #c45f5f; background: rgba(196,95,95,.12); }
.dsh-tavern-worldbook-entry .dsh-tavern-card-field { margin-bottom: 6px; }
.dsh-tavern-worldbook-entry .dsh-tavern-card-field:last-child { margin-bottom: 0; }
.dsh-tavern-worldbook-editor { padding: 10px 12px 24px; overflow-y: auto; }
.dsh-tavern-worldbook-summary { margin: 0 0 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dsh-tavern-worldbook-editor-actions { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 6px; padding: 10px 0; background: var(--dsw-specific-sidebar-fill); }
.dsh-tavern-worldbook-entry details { margin-top: 7px; }
.dsh-tavern-worldbook-entry summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-worldbook-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 7px; }
.dsh-tavern-worldbook-grid label { display: flex; flex-direction: column; gap: 3px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-worldbook-grid input,.dsh-tavern-worldbook-grid select { min-width: 0; padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-specific-input-major); color: inherit; }
.dsh-tavern-worldbook-checks { display: flex; flex-wrap: wrap; gap: 8px 12px; margin: 7px 0; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-tavern-worldbook-checks label { display: inline-flex; align-items: center; gap: 4px; }
.dsh-tavern-card-save { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: 10px 0 2px; background: linear-gradient(transparent, var(--dsw-specific-sidebar-fill) 28%); }
.dsh-tavern-script-row { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l3); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-tavern-script-info { flex: 1; min-width: 150px; line-height: 1.5; }
.dsh-tavern-script-info b { color: #a66b35; }
.dsh-tavern-script-hero { flex: none; margin: 10px 12px 0; padding: 12px; border: 1px solid rgba(166,107,53,.48); border-radius: 11px; background: rgba(166,107,53,.10); }
.dsh-tavern-script-hero-title { color: #9a622f; font-size: 13px; font-weight: 800; cursor: pointer; }
.dsh-tavern-script-hero-help { margin-top: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dsh-tavern-script-hero .dsh-tavern-script-row { border-top-color: rgba(166,107,53,.28); }
.dsh-tavern-script-primary { border: 0; border-radius: 8px; padding: 6px 10px; background: #a66b35; color: #fff; cursor: pointer; font-size: 11px; font-weight: 700; }
.dsh-tavern-script-primary:disabled { opacity: .5; cursor: default; }
@keyframes dsh-tavern-pulse { from { opacity: .35; } to { opacity: 1; } }
.dsh-card-primary { border: 0; border-radius: 8px; padding: 7px 14px; background: #9a622f; color: white; cursor: pointer; }
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

		function rpc(method, args, sessionId, requestOptions) {
			const payload = Object.assign({}, args || {});
			if (sessionId) payload.sessionId = sessionId;
			const request = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			};
			if (requestOptions && requestOptions.signal) request.signal = requestOptions.signal;
			return fetch("/api/dsh-tavern/" + method, request).then(function (response) { return response.json(); }).then(function (result) {
				if (!result || !result.ok) throw new Error(result && result.error ? result.error : "操作失败");
				return result;
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

		function createLiveTavernViewModule(options) {
			if (!options || typeof options.load !== "function") throw new Error("Live Tavern View 缺少 load adapter");
			const records = new Map();
			const shouldPoll = typeof options.shouldPoll === "function" ? options.shouldPoll : function (view) { return view && view.settleStatus === "running"; };
			const scheduleTimer = typeof options.schedule === "function" ? options.schedule : function (run, delay) { return window.setTimeout(run, delay); };
			const cancelTimer = typeof options.cancel === "function" ? options.cancel : function (timer) { window.clearTimeout(timer); };
			const startWatchdog = typeof options.startWatchdog === "function" ? options.startWatchdog : function (run, delay) { return window.setInterval(run, delay); };
			const stopWatchdog = typeof options.stopWatchdog === "function" ? options.stopWatchdog : function (timer) { window.clearInterval(timer); };
			const watchdogIntervalMs = Number(options.watchdogIntervalMs) > 0 ? Number(options.watchdogIntervalMs) : 1000;
			const loadTimeoutMs = Number(options.loadTimeoutMs) > 0 ? Number(options.loadTimeoutMs) : 0;
			const idlePollIntervalMs = Number(options.idlePollIntervalMs) > 0 ? Number(options.idlePollIntervalMs) : 0;
			function initialState() { return { phase: "idle", view: null, error: "", updatedAt: 0 }; }
			function recordFor(sessionId) {
				const id = String(sessionId || "");
				if (!records.has(id)) records.set(id, { id: id, state: initialState(), listeners: new Set(), timer: null, watchdog: null, loading: false, reloadRequested: false, optimisticBusy: false });
				return records.get(id);
			}
			function publish(record, state) {
				record.state = state;
				record.listeners.forEach(function (listener) { listener(state); });
			}
			function schedule(record, delay) {
				if (record.listeners.size === 0) return;
				if (record.timer !== null) cancelTimer(record.timer);
				record.timer = scheduleTimer(function () {
					record.timer = null;
					void refresh(record);
				}, delay);
			}
			async function refresh(record) {
				if (record.listeners.size === 0) return;
				if (record.loading) { record.reloadRequested = true; return; }
				record.loading = true;
				if (record.state.view === null) publish(record, Object.assign({}, record.state, { phase: "loading", error: "" }));
				let deadlineExpired = false;
				try {
					let deadlineTimer = null;
					let controller = null;
					let load = null;
					if (loadTimeoutMs > 0) {
						controller = new AbortController();
						load = Promise.race([
							Promise.resolve(options.load(record.id, { signal: controller.signal })),
							new Promise(function (_resolve, reject) {
								deadlineTimer = scheduleTimer(function () {
									deadlineExpired = true;
									controller.abort();
									reject(new Error("Tavern 状态同步超时"));
								}, loadTimeoutMs);
							})
						]);
					} else load = options.load(record.id, {});
					let result = null;
					try { result = await load; }
					finally { if (deadlineTimer !== null) cancelTimer(deadlineTimer); }
					const view = result && result.view ? result.view : null;
					if (record.optimisticBusy && !shouldPoll(view)) {
						schedule(record, 200);
						return;
					}
					if (shouldPoll(view)) record.optimisticBusy = false;
					publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
					if (shouldPoll(view)) schedule(record, 200);
					else if (idlePollIntervalMs > 0) schedule(record, idlePollIntervalMs);
				} catch (error) {
					publish(record, { phase: "retrying", view: record.state.view, error: deadlineExpired ? "" : String(error && error.message || error || ""), updatedAt: record.state.updatedAt });
					schedule(record, shouldPoll(record.state.view) ? 300 : (idlePollIntervalMs > 0 ? Math.min(1500, idlePollIntervalMs) : 1500));
				} finally {
					record.loading = false;
					if (record.reloadRequested) { record.reloadRequested = false; schedule(record, 0); }
				}
			}
			function invalidate(sessionId) {
				const targets = sessionId === undefined || sessionId === null || sessionId === "" ? Array.from(records.values()) : [recordFor(sessionId)];
				targets.forEach(function (record) {
					if (record.loading) record.reloadRequested = true;
					else schedule(record, 0);
				});
			}
			return {
				getSnapshot: function (sessionId) { return recordFor(sessionId).state; },
				setView: function (sessionId, view) {
					const record = recordFor(sessionId);
					record.optimisticBusy = shouldPoll(view);
					publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
					if (shouldPoll(view)) schedule(record, 0);
					let released = false;
					return function () {
						if (released) return;
						released = true;
						record.optimisticBusy = false;
						invalidate(sessionId);
					};
				},
				subscribe: function (sessionId, listener) {
					const record = recordFor(sessionId);
					record.listeners.add(listener);
					listener(record.state);
					schedule(record, 0);
					if (record.watchdog === null) {
						record.watchdog = startWatchdog(function () {
							if (record.listeners.size > 0 && (shouldPoll(record.state.view) || idlePollIntervalMs > 0)) void refresh(record);
						}, watchdogIntervalMs);
					}
					return function () {
						record.listeners.delete(listener);
						if (record.listeners.size === 0) {
							if (record.timer !== null) { cancelTimer(record.timer); record.timer = null; }
							if (record.watchdog !== null) { stopWatchdog(record.watchdog); record.watchdog = null; }
						}
					};
				},
				invalidate: invalidate
			};
		}

		const liveTavernView = createLiveTavernViewModule({
			loadTimeoutMs: 2000,
			load: function (sessionId, request) { return rpc("getSession", {}, sessionId, request); },
			shouldPoll: function (view) { return !!(view && view.activity && view.activity.busy); }
		});
		function coordinationView(result, sessionId) {
			const sync = result && result.sync ? result.sync : (result || {});
			const tasks = sync.tasks && typeof sync.tasks === "object" ? sync.tasks : {};
			const background = tasks.background || null;
			return {
				runtimeGeneration: String(sync.runtimeGeneration || ""),
				liveSession: sync.liveSession === true,
				requestMode: sync.requestMode === "sillytavern" ? "sillytavern" : "dsh",
				activity: background ? { phase: background.status === "queued" ? "pending" : (background.status === "succeeded" ? "idle" : background.status), busy: background.busy === true, role: background.kind, operationId: background.operationId, updatedAt: background.updatedAt } : (sync.activity || null),
				task: tasks.candidate || sync.task || null,
				tasks: tasks,
				mailboxVersion: Number(sync.mailboxVersion) || 0,
				projectionRevision: Number(sync.projectionRevision) || 0
			};
		}

		function createTavernCoordinationEventModule(options) {
			if (!options || typeof options.connect !== "function") throw new Error("Tavern Coordination Event 缺少 SSE adapter");
			const records = new Map();
			function initialState() { return { phase: "connecting", view: null, error: "", updatedAt: 0 }; }
			function recordFor(sessionId) {
				const id = String(sessionId || "");
				if (!records.has(id)) records.set(id, { id: id, state: initialState(), listeners: new Set(), connection: null });
				return records.get(id);
			}
			function publish(record, state) {
				record.state = state;
				record.listeners.forEach(function (listener) { listener(state); });
			}
			function disconnect(record) {
				if (record.connection && typeof record.connection.close === "function") record.connection.close();
				record.connection = null;
			}
			function connect(record) {
				if (record.listeners.size === 0 || record.connection !== null) return;
				record.connection = options.connect(record.id, {
					message: function (view) {
						publish(record, { phase: "ready", view: view || null, error: "", updatedAt: Date.now() });
						if (typeof options.onView === "function") options.onView(record.id, view || null);
					},
					error: function (error) {
						publish(record, { phase: "retrying", view: record.state.view, error: String(error && error.message || ""), updatedAt: record.state.updatedAt });
					}
				});
			}
			function invalidate(sessionId) {
				const targets = sessionId === undefined || sessionId === null || sessionId === "" ? Array.from(records.values()) : [recordFor(sessionId)];
				targets.forEach(function (record) {
					disconnect(record);
					if (record.listeners.size > 0) {
						publish(record, { phase: "connecting", view: record.state.view, error: "", updatedAt: record.state.updatedAt });
						connect(record);
					}
				});
			}
			return {
				getSnapshot: function (sessionId) { return recordFor(sessionId).state; },
				setView: function (sessionId, view) {
					const record = recordFor(sessionId);
					publish(record, { phase: "ready", view: view || null, error: "", updatedAt: Date.now() });
				},
				subscribe: function (sessionId, listener) {
					const record = recordFor(sessionId);
					record.listeners.add(listener);
					listener(record.state);
					connect(record);
					return function () {
						record.listeners.delete(listener);
						if (record.listeners.size === 0) disconnect(record);
					};
				},
				invalidate: invalidate
			};
		}

		const tavernCoordination = createTavernCoordinationEventModule({
			onView: function (sessionId) { liveTavernView.invalidate(sessionId); },
			connect: function (sessionId, handlers) {
				const target = "/api/dsh-tavern/events?sessionId=" + encodeURIComponent(sessionId) + "&kind=candidate";
				const source = new window.EventSource(target);
				source.onmessage = function (event) {
					try { handlers.message(coordinationView({ sync: JSON.parse(event.data) }, sessionId)); }
					catch (error) { handlers.error(error); }
				};
				source.onerror = function () { handlers.error(new Error("Tavern SSE 正在重连")); };
				return { close: function () { source.close(); } };
			}
		});

		function describeTavernActivity(value) {
			const activity = value && typeof value === "object" ? value : {};
			const busy = activity.busy === true;
			const role = String(activity.role || "");
			let label = "生成候选项";
			let blockReason = "";
			if (busy && role === "candidate") { label = "生成中…"; blockReason = "正在生成候选项，请稍候…"; }
			else if (busy) { label = "后台结算中…"; blockReason = "后台结算中，请稍候…"; }
			return { phase: String(activity.phase || "idle"), busy: busy, role: role, label: label, blockReason: blockReason };
		}

		function useLiveTavernView(sessionId, revision) {
			const [state, setState] = React.useState(function () { return liveTavernView.getSnapshot(sessionId); });
			React.useEffect(function () { return liveTavernView.subscribe(sessionId, setState); }, [sessionId]);
			React.useEffect(function () { liveTavernView.invalidate(sessionId); }, [sessionId, revision]);
			return state;
		}

		function useTavernCoordination(sessionId, revision) {
			const [state, setState] = React.useState(function () { return tavernCoordination.getSnapshot(sessionId); });
			React.useEffect(function () { return tavernCoordination.subscribe(sessionId, setState); }, [sessionId]);
			React.useEffect(function () { tavernCoordination.invalidate(sessionId); }, [sessionId, revision]);
			return state;
		}

		function createConversationLifecycleModule(options) {
			for (const method of ["archiveCurrent", "resolveWorkspace", "connectWorkspace", "waitForSession", "ensurePreset", "createChat", "rememberPending", "finishOpen"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Conversation Lifecycle 缺少 " + method + " adapter");
			}
			return {
				start: async function (request) {
					let phase = "清理当前空白对话";
					try {
						const preparedSessionId = typeof request.preparedSessionId === "string" ? request.preparedSessionId : "";
						await options.archiveCurrent(preparedSessionId);
						let sessionId = preparedSessionId;
						if (!sessionId) {
							phase = request.kind === "card" ? "准备卡片工作区" : "准备游玩工作区";
							const workspaceId = await options.resolveWorkspace(request);
							phase = "创建 DSH Session";
							sessionId = await options.connectWorkspace(workspaceId);
						}
						phase = "等待 DSH Session 就绪";
						await options.waitForSession(sessionId);
						phase = "切换到酒馆模式";
						await options.ensurePreset(sessionId);
						phase = request.kind === "card" ? "创建卡片工作台对话" : "写入人物卡开场白";
						await options.createChat(request, sessionId);
						phase = "同步并打开 DSH Session";
						const pending = Object.assign({}, request.pending || {}, { sessionId: sessionId, targetMode: request.targetMode });
						options.rememberPending(pending);
						await options.finishOpen(pending);
						return { sessionId: sessionId, pending: pending };
					} catch (error) {
						const failure = error instanceof Error ? error : new Error(String(error || "创建对话失败"));
						failure.phase = phase;
						throw failure;
					}
				}
			};
		}

		function createConversationPrewarmModule(options) {
			for (const method of ["sessionIds", "resolveWorkspace", "connectWorkspace", "archiveSession"]) {
				if (!options || typeof options[method] !== "function") throw new Error("Conversation Prewarm 缺少 " + method + " adapter");
			}
			const now = typeof options.now === "function" ? options.now : Date.now;
			const report = typeof options.report === "function" ? options.report : function () {};
			let active = null;

			function clean(record) {
				if (!record || record.cleanupScheduled) return;
				record.cleanupScheduled = true;
				record.promise.then(async function (lease) {
					if (!lease.created) return;
					try { await options.archiveSession(lease.sessionId); }
					catch (error) { report({ phase: "cleanup-failed", key: record.key, sessionId: lease.sessionId, error: error }); }
				}, function () {});
			}

			function cancel() {
				const record = active;
				active = null;
				clean(record);
			}

			function begin(request) {
				cancel();
				const key = String(request && request.key || "");
				const known = new Set(options.sessionIds());
				const startedAt = now();
				const record = { key: key, cleanupScheduled: false, promise: null };
				record.promise = (async function () {
					const workspaceId = await options.resolveWorkspace(request || {});
					const sessionId = await options.connectWorkspace(workspaceId);
					const lease = { sessionId: sessionId, created: !known.has(sessionId) };
					report({ phase: "ready", key: key, sessionId: sessionId, created: lease.created, elapsedMs: Math.max(0, now() - startedAt) });
					return lease;
				})();
				record.promise.catch(function (error) { report({ phase: "failed", key: key, elapsedMs: Math.max(0, now() - startedAt), error: error }); });
				active = record;
				return record.promise;
			}

			async function claim(key) {
				const record = active;
				if (!record || record.key !== String(key || "")) return "";
				active = null;
				return (await record.promise).sessionId;
			}

			return Object.freeze({ begin: begin, claim: claim, cancel: cancel });
		}

		function isIgnoredTavernError(value) {
			return /failed to fetch/i.test(String(value && value.message || value || "").trim());
		}

		const tavernErrorHub = (function () {
			const storageKey = "dsh-tavern:error-history:v1";
			function loadItems() {
				try {
					const value = JSON.parse(window.sessionStorage.getItem(storageKey) || "[]");
					return Array.isArray(value) ? value.filter(function (item) {
						return item && typeof item.id === "string" && typeof item.source === "string" && typeof item.message === "string";
					}).slice(0, 1) : [];
				} catch (_) { return []; }
			}
			let items = loadItems();
			let sequence = Date.now();
			const listeners = new Set();
			function emit() {
				try { window.sessionStorage.setItem(storageKey, JSON.stringify(items)); } catch (_) {}
				listeners.forEach(function (listener) { listener(items.slice()); });
			}
			return {
				getSnapshot: function () { return items.slice(); },
				subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
				report: function (source, error) {
					if (isIgnoredTavernError(error)) return;
					const message = String(error && error.message || error || "").trim();
					if (!message) return;
					const scope = String(source || "DSH Tavern");
					const now = Date.now();
					const existing = items[0] && items[0].source === scope && items[0].message === message ? items[0] : null;
					if (existing) {
						items = [{ id: existing.id, source: scope, message: message, firstAt: existing.firstAt, lastAt: now, count: existing.count + 1 }];
					} else {
						items = [{ id: "tavern-error-" + (++sequence), source: scope, message: message, firstAt: now, lastAt: now, count: 1 }];
					}
					emit();
				},
				dismiss: function (id) { items = items.filter(function (item) { return item.id !== id; }); emit(); },
				resolve: function (source) {
					if (!items[0] || items[0].source !== String(source || "")) return;
					items = [];
					emit();
				},
				clear: function () { items = []; emit(); }
			};
		})();

		function usePersistentError(source) {
			const [error, setLocalError] = React.useState("");
			const lastReported = React.useRef("");
			const setError = React.useCallback(function (value) {
				const message = String(value && value.message || value || "");
				const visible = isIgnoredTavernError(message) ? "" : message;
				setLocalError(visible);
				if (!visible) tavernErrorHub.resolve(source);
				else if (visible !== lastReported.current) tavernErrorHub.report(source, visible);
				lastReported.current = visible;
			}, [source]);
			return [error, setError];
		}

		function formatErrorTime(ts) {
			const date = new Date(ts);
			return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0");
		}

		function copyErrorText(text) {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				navigator.clipboard.writeText(text).catch(function () { window.prompt("复制错误信息", text); });
			} else window.prompt("复制错误信息", text);
		}

		function TavernErrorCenter() {
			const [items, setItems] = React.useState(tavernErrorHub.getSnapshot());
			React.useEffect(function () { return tavernErrorHub.subscribe(setItems); }, []);
			if (!items.length) return null;
			const h = React.createElement;
			const item = items[0];
			const text = "[" + formatErrorTime(item.lastAt) + "] " + item.source + (item.count > 1 ? "（重复 " + item.count + " 次）" : "") + "\n" + item.message;
			return h("section", { className: "dsh-tavern-error-center", role: "region", "aria-label": "DSH Tavern 错误记录" },
				h("div", { className: "dsh-tavern-error-center-head" }, h("span", null, "最新错误"), h("button", { className: "dsh-tavern-btn", onClick: function () { copyErrorText(text); } }, "复制"), h("button", { className: "dsh-tavern-btn", onClick: tavernErrorHub.clear }, "清除")),
				h("div", { className: "dsh-tavern-error-list" }, h("article", { className: "dsh-tavern-error-item", key: item.id },
					h("div", { className: "dsh-tavern-error-meta" }, h("span", null, item.source), item.count > 1 ? h("span", null, "重复 " + item.count + " 次") : null, h("time", { dateTime: new Date(item.lastAt).toISOString() }, formatErrorTime(item.lastAt))),
					h("div", { className: "dsh-tavern-error-message" }, item.message)
				))
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
			return values[sessionId] || "";
		}
		function escapeOpeningPreviewText(value) {
			return String(value || "")
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/\"/g, "&quot;")
				.replace(/'/g, "&#39;");
		}

		function isHtmlOpening(value) {
			return /<\/?[a-z][^>]*>/i.test(String(value || ""));
		}

		function buildOpeningPreviewDocument(value) {
			const source = String(value || "");
			const content = isHtmlOpening(source)
				? source
				: '<div class="dsh-tavern-greeting-text">' + escapeOpeningPreviewText(source) + '</div>';
			const preserveMixedTextLines = isHtmlOpening(source)
				? '<script data-dsh-preserve-lines>(function(){var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);nodes.forEach(function(node){if(node.nodeValue.indexOf("\\n")<0||!node.nodeValue.trim())return;var parent=node.parentElement;if(!parent||parent.closest("script,style,pre,textarea,code"))return;var span=document.createElement("span");span.className="dsh-tavern-preserve-lines";node.replaceWith(span);span.appendChild(node);});})();</script>'
				: '';
			return '<!doctype html><html><head><meta charset="utf-8">'
				+ '<meta name="viewport" content="width=device-width,initial-scale=1">'
				+ '<meta name="referrer" content="no-referrer">'
				+ '<meta http-equiv="Content-Security-Policy" content="default-src https: http: data: blob:; img-src https: http: data: blob:; media-src https: http: data: blob:; style-src \'unsafe-inline\' https: http:; font-src https: http: data:; script-src \'unsafe-inline\' \'unsafe-eval\' https: http: data: blob:; connect-src https: http: ws: wss: data: blob:; frame-src https: http: data: blob:; form-action https: http:">'
				+ '<base target="_blank">'
				+ '<style>html,body{margin:0;min-height:100%;background:#fff;color:#1f2328;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{box-sizing:border-box;padding:16px}.dsh-tavern-greeting-text,.dsh-tavern-preserve-lines{white-space:pre-wrap;overflow-wrap:anywhere}.dsh-tavern-greeting-text{font-size:14px;line-height:1.7}img,video{max-width:100%;height:auto}</style>'
				+ '</head><body>' + content + preserveMixedTextLines + '</body></html>';
		}

		function buildTavernFrameDocument(input) {
			const html = String(input && (input.content !== undefined ? input.content : input.html) || "");
			const token = JSON.stringify(String(input && input.token || "")).replace(/</g, "\\u003c");
			const helperContext = JSON.stringify(input && input.helperContext || null).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			const helperTurn = Math.max(0, Number(input && input.turn) || 0);
			const helperDependencies = input && input.helperContext
				? '<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"><\/script><script src="https://cdn.jsdelivr.net/npm/lodash@4.18.1/lodash.min.js"><\/script><script src="https://cdn.jsdelivr.net/npm/vue@3.5.41/dist/vue.global.prod.js"><\/script>'
				: '';
			const storageShim = '<script data-dsh-tavern-storage>(function(){try{void window.localStorage;return;}catch(e){}var values=Object.create(null),keys=[];var storage={getItem:function(key){key=String(key);return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null;},setItem:function(key,value){key=String(key);if(!Object.prototype.hasOwnProperty.call(values,key))keys.push(key);values[key]=String(value);},removeItem:function(key){key=String(key);if(!Object.prototype.hasOwnProperty.call(values,key))return;delete values[key];keys.splice(keys.indexOf(key),1);},clear:function(){values=Object.create(null);keys=[];},key:function(index){index=Number(index);return index>=0&&index<keys.length?keys[index]:null;}};Object.defineProperty(storage,"length",{enumerable:true,get:function(){return keys.length;}});try{Object.defineProperty(window,"localStorage",{configurable:true,enumerable:true,value:storage});}catch(e){}})();<\/script>';
			const helperShim = input && input.helperContext ? '<script data-dsh-tavern-helper>(function(){var token=' + token + ',state=' + helperContext + ',turn=' + helperTurn + ',nextId=1,pending=Object.create(null),listeners=Object.create(null);if(window.Vue)Object.assign(window,window.Vue);window.errorCatched=function(factory){return function(){try{return factory.apply(this,arguments);}catch(error){console.error(error);return {};}};};function copy(value){try{return structuredClone(value);}catch(e){return JSON.parse(JSON.stringify(value));}}function lastId(){return Math.max(-1,(state.messages||[]).length-1);}function normalizeId(value){var id=Number(value);if(!Number.isFinite(id))id=lastId();if(id<0)id=(state.messages||[]).length+id;return Math.max(0,Math.min(lastId(),id));}function currentId(){var mapped=state.turnMessageIds&&state.turnMessageIds[String(turn)];return mapped===undefined?lastId():normalizeId(mapped);}function selectedVariables(message){return copy(message&&message.variables&&typeof message.variables==="object"?message.variables:{});}function messagesFor(target,options){var all=state.messages||[],items=[];if(target===undefined||target===null)items=[all[currentId()]];else if(typeof target==="string"&&target.indexOf("-")>=0){var value=target.replace(/{{\\s*lastMessageId\\s*}}/gi,String(lastId())),parts=value.split("-"),from=normalizeId(parts[0]),to=normalizeId(parts[1]);for(var i=Math.min(from,to);i<=Math.max(from,to);i+=1)items.push(all[i]);}else items=[all[normalizeId(target)]];items=items.filter(Boolean);if(options&&options.role&&options.role!=="all")items=items.filter(function(item){return item.role===options.role;});return copy(items);}function call(method,args){return new Promise(function(resolve,reject){var requestId=String(nextId++);pending[requestId]={resolve:resolve,reject:reject};parent.postMessage({type:"dsh-tavern-helper-call",token:token,requestId:requestId,method:method,args:copy(args||{})},"*");});}function optionOf(option){var value=option&&typeof option==="object"?copy(option):{type:"message"};if(!value.type)value.type="message";if(value.type==="message"){if(value.message_id===undefined||value.message_id===null)value.message_id=currentId();else if(value.message_id==="latest")value.message_id=lastId();}return value;}function localReplace(variables,option){option=optionOf(option);if(option.type==="chat")state.chatVariables=copy(variables);else{var message=state.messages[normalizeId(option.message_id)];if(message){message.variables=copy(variables);if(Array.isArray(message.swipes_data))message.swipes_data[message.swipe_id||0]=copy(variables);}}}function localSetMessages(patches){(patches||[]).forEach(function(patch){var message=state.messages[normalizeId(patch.message_id)];if(!message)return;if(patch.swipe_id!==undefined){message.swipe_id=Math.max(0,Math.min((message.swipes||[]).length-1,Number(patch.swipe_id)||0));message.message=(message.swipes||[])[message.swipe_id]||message.message;}if(patch.message!==undefined){message.message=String(patch.message);if(Array.isArray(message.swipes))message.swipes[message.swipe_id||0]=message.message;}if(patch.data!==undefined){message.variables=copy(patch.data||{});if(Array.isArray(message.swipes_data))message.swipes_data[message.swipe_id||0]=copy(patch.data||{});}});}addEventListener("message",function(event){var data=event&&event.data;if(event.source!==parent||!data||data.type!=="dsh-tavern-helper-response"||data.token!==token)return;var task=pending[data.requestId];if(!task)return;delete pending[data.requestId];if(data.ok){if(data.result&&data.result.context)state=data.result.context;task.resolve(data.result);}else task.reject(new Error(String(data.error||"Helper 调用失败")));});window.getCurrentMessageId=currentId;window.getLastMessageId=lastId;window.getChatMessages=messagesFor;window.getVariables=function(option){option=optionOf(option);if(option.type==="chat")return copy(state.chatVariables||{});return selectedVariables((state.messages||[])[normalizeId(option.message_id)]);};window.replaceVariables=function(variables,option){option=optionOf(option);var plain=copy(variables||{});localReplace(plain,option);call("updateTavernHelperVariables",{option:option,variables:plain}).catch(function(error){console.error(error);});};window.updateVariablesWith=async function(updater,option){option=optionOf(option);var current=window.getVariables(option),next=typeof updater==="function"?await updater(copy(current)):current;if(next===undefined)next=current;next=copy(next);localReplace(next,option);await call("updateTavernHelperVariables",{option:option,variables:next});return copy(next);};window.setChatMessages=async function(patches){var plain=copy(patches||[]);localSetMessages(plain);var result=await call("updateTavernHelperMessages",{messages:plain});return result;};window.retrieveDisplayedMessage=function(messageId){return normalizeId(messageId)===currentId()?window.jQuery(document.body):window.jQuery();};window.toastr={success:function(message){console.info(String(message));},info:function(message){console.info(String(message));},warning:function(message){console.warn(String(message));},error:function(message){console.error(String(message));}};window.eventOn=function(name,handler){(listeners[name]||(listeners[name]=new Set())).add(handler);return handler;};window.eventOff=function(name,handler){if(listeners[name])listeners[name].delete(handler);};window.eventEmit=async function(name){var args=Array.prototype.slice.call(arguments,1),items=listeners[name]?Array.from(listeners[name]):[];for(var i=0;i<items.length;i+=1)await items[i].apply(null,args);};window.tavern_events={MESSAGE_SENT:"MESSAGE_SENT",MESSAGE_RECEIVED:"MESSAGE_RECEIVED",MESSAGE_UPDATED:"MESSAGE_UPDATED",MESSAGE_SWIPED:"MESSAGE_SWIPED",MESSAGE_DELETED:"MESSAGE_DELETED",MESSAGE_EDITED:"MESSAGE_EDITED"};window.Mvu={events:{VARIABLE_INITIALIZED:"mag_variable_initialized",VARIABLE_UPDATE_STARTED:"mag_variable_update_started",COMMAND_PARSED:"mag_command_parsed",VARIABLE_UPDATE_ENDED:"mag_variable_update_ended",BEFORE_MESSAGE_UPDATE:"mag_before_message_update"},getMvuData:function(option){return window.getVariables(option);},replaceMvuData:async function(value,option){await window.updateVariablesWith(function(){return value;},option);return copy(value);},parseMessage:async function(){throw new Error("当前兼容层尚未开放 iframe 内手动 MVU 重算");}};window.waitGlobalInitialized=async function(name){if(name==="Mvu")return window.Mvu;return window[name];};var ready=import("https://testingcf.jsdelivr.net/npm/zod@4.4.3/+esm").then(function(module){window.z=module;return true;});window.__dshTavernHelperReady=ready;if(window.jQuery&&window.jQuery.fn&&window.jQuery.fn.load&&!window.jQuery.fn.__dshDeferred){var original=window.jQuery.fn.load;var deferred=function(){var self=this,args=arguments;ready.then(function(){original.apply(self,args);});return self;};deferred.__dshDeferred=true;window.jQuery.fn.load=deferred;}})();<\/script>' : '';
			const runtimeReporter = '<script data-dsh-tavern-frame>(function(){var token=' + token + ';var logs=[],network=[],errors=[],timer=0;function trim(list){if(list.length>100)list.splice(0,list.length-100);}function value(input,depth){if(depth>3)return "[深度已截断]";if(input===null||input===undefined||typeof input==="boolean"||typeof input==="number"||typeof input==="string")return typeof input==="string"&&input.length>4000?input.slice(0,4000)+"…[已截断]":input;try{if(Array.isArray(input))return input.slice(0,30).map(function(item){return value(item,depth+1);});if(typeof input==="object"){var out={};Object.keys(input).slice(0,30).forEach(function(key){out[key]=value(input[key],depth+1);});return out;}}catch(e){}return String(input);}function cleanUrl(input){try{var parsed=new URL(String(input),location.href);return parsed.protocol+"//"+parsed.host+parsed.pathname;}catch(e){return String(input||"").split(/[?#]/)[0].slice(0,1000);}}function send(){timer=0;var dom="";try{if(document.body){var copy=document.body.cloneNode(true);Array.prototype.forEach.call(copy.querySelectorAll("script[data-dsh-tavern-frame],script[data-dsh-tavern-storage],script[data-dsh-tavern-layout]"),function(node){node.remove();});dom=copy.innerHTML;}}catch(e){}if(dom.length>100000)dom=dom.slice(0,100000)+"<!-- 已截断 -->";parent.postMessage({type:"dsh-tavern-frame-runtime",token:token,runtime:{capturedAt:Date.now(),dom:dom,console:logs.slice(),network:network.slice(),errors:errors.slice()}} ,"*");}function schedule(){if(timer)return;timer=setTimeout(send,350);}["log","info","warn","error"].forEach(function(level){var original=console[level];console[level]=function(){logs.push({at:Date.now(),level:level,args:Array.prototype.map.call(arguments,function(item){return value(item,0);})});trim(logs);schedule();return original&&original.apply(console,arguments);};});addEventListener("error",function(event){var target=event.target;if(target&&target!==window){errors.push({at:Date.now(),kind:"resource",tag:String(target.tagName||""),url:cleanUrl(target.src||target.href||"")});}else errors.push({at:Date.now(),kind:"error",message:String(event.message||""),source:cleanUrl(event.filename||""),line:Number(event.lineno)||0,column:Number(event.colno)||0});trim(errors);schedule();},true);addEventListener("unhandledrejection",function(event){errors.push({at:Date.now(),kind:"unhandledrejection",message:String(event.reason&&event.reason.message||event.reason||"")});trim(errors);schedule();});if(typeof window.fetch==="function"){var nativeFetch=window.fetch;window.fetch=function(input,init){var started=Date.now(),method=String(init&&init.method||"GET").toUpperCase(),url=cleanUrl(input&&input.url||input);return nativeFetch.apply(this,arguments).then(function(response){network.push({at:started,kind:"fetch",method:method,url:url,status:Number(response.status)||0,durationMs:Date.now()-started});trim(network);schedule();return response;},function(error){network.push({at:started,kind:"fetch",method:method,url:url,failed:true,durationMs:Date.now()-started,error:String(error&&error.message||error)});trim(network);schedule();throw error;});};}if(typeof XMLHttpRequest==="function"){var nativeOpen=XMLHttpRequest.prototype.open,nativeSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(method,url){this.__dshRequest={started:0,method:String(method||"GET").toUpperCase(),url:cleanUrl(url)};return nativeOpen.apply(this,arguments);};XMLHttpRequest.prototype.send=function(){var request=this.__dshRequest||{method:"GET",url:""};request.started=Date.now();this.addEventListener("loadend",function(){network.push({at:request.started,kind:"xhr",method:request.method,url:request.url,status:Number(this.status)||0,durationMs:Date.now()-request.started});trim(network);schedule();});return nativeSend.apply(this,arguments);};}addEventListener("load",schedule);new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});schedule();})();<\/script>';
			const reporter = '<script data-dsh-tavern-frame>(function(){var token=' + token + ';var last=0;var queued=false;function nodeBottom(node){if(!node||typeof node.getBoundingClientRect!=="function")return 0;var style;try{style=getComputedStyle(node);}catch(e){return 0;}if(style.display==="none"||style.visibility==="hidden"||style.position==="fixed")return 0;var rect=node.getBoundingClientRect();if(rect.width===0&&rect.height===0)return 0;var top=rect.top,bottom=rect.bottom;var ancestor=node.parentElement;while(ancestor&&ancestor!==document.documentElement){var ancestorStyle;try{ancestorStyle=getComputedStyle(ancestor);}catch(e){ancestorStyle=null;}var overflow=String(ancestorStyle&&(ancestorStyle.overflowY||ancestorStyle.overflow)||"visible");if(overflow!=="visible"){var ancestorRect=ancestor.getBoundingClientRect();top=Math.max(top,ancestorRect.top);bottom=Math.min(bottom,ancestorRect.bottom);if(bottom<=top)return 0;}ancestor=ancestor.parentElement;}return Math.ceil(bottom+(window.scrollY||0));}function measure(){var body=document.body;if(!body)return 48;var bodyRect=body.getBoundingClientRect();var height=Math.max(body.scrollHeight||0,Math.ceil(bodyRect.bottom+(window.scrollY||0)),48);var nodes=[body].concat(Array.prototype.slice.call(body.querySelectorAll("*")));for(var i=0;i<nodes.length;i+=1)height=Math.max(height,nodeBottom(nodes[i]));return height;}function report(){queued=false;var height=measure();if(height===last)return;last=height;parent.postMessage({type:"dsh-tavern-frame-height",token:token,height:height},"*");}function schedule(){if(queued)return;queued=true;if(typeof requestAnimationFrame==="function")requestAnimationFrame(report);else setTimeout(report,0);}if(typeof ResizeObserver==="function"){var observer=new ResizeObserver(schedule);observer.observe(document.documentElement);if(document.body)observer.observe(document.body);}addEventListener("load",schedule);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});schedule();})();<\/script>';
			const layoutNormalizer = '<script data-dsh-tavern-layout>(function(){if(!document.body)return;Array.prototype.slice.call(document.body.childNodes).forEach(function(node){if(node.nodeType===3&&!/\\S/.test(String(node.nodeValue||"")))node.nodeValue=" ";});})();<\/script>';
			return '<!doctype html><html><head><meta charset="utf-8">'
				+ '<meta name="viewport" content="width=device-width,initial-scale=1">'
				+ '<meta name="referrer" content="no-referrer">'
				+ '<meta http-equiv="Content-Security-Policy" content="default-src https: http: data: blob:; img-src https: http: data: blob:; media-src https: http: data: blob:; font-src https: http: data:; style-src \'unsafe-inline\' https: http:; script-src \'unsafe-inline\' \'unsafe-eval\' https: http: data: blob:; connect-src https: http: wss: data: blob:; frame-src https: http: data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
				+ '<style>:root{color-scheme:light dark}html,body{box-sizing:border-box;margin:0;min-height:0;background:transparent;color:CanvasText;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.75}body{padding:0 1px;overflow-wrap:anywhere;white-space:pre-wrap}body>*{white-space:normal}maintext{display:block;white-space:pre-wrap;overflow-wrap:anywhere}.dsh-tavern-plain-text{white-space:pre-wrap;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}img,video,svg,canvas{max-width:100%;height:auto}pre{max-width:100%;overflow:auto;white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}a{color:LinkText}</style>' + helperDependencies + storageShim + helperShim + runtimeReporter
				+ '</head><body>' + html + layoutNormalizer + reporter + '</body></html>';
		}

		function encodeTavernScriptSource(value) {
			const binary = encodeURIComponent(String(value || "")).replace(/%([0-9A-F]{2})/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
			if (typeof btoa === "function") return btoa(binary);
			const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
			let result = "";
			for (let index = 0; index < binary.length; index += 3) {
				const a = binary.charCodeAt(index);
				const b = index + 1 < binary.length ? binary.charCodeAt(index + 1) : 0;
				const c = index + 2 < binary.length ? binary.charCodeAt(index + 2) : 0;
				result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)]
					+ (index + 1 < binary.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=")
					+ (index + 2 < binary.length ? alphabet[c & 63] : "=");
			}
			return result;
		}

		function tavernHelperScriptBootstrap(metadata, initialContext) {
			try { void window.localStorage; }
			catch (_) {
				let values = Object.create(null);
				let keys = [];
				const storage = {
					getItem: function (key) { key = String(key); return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
					setItem: function (key, value) { key = String(key); if (!Object.prototype.hasOwnProperty.call(values, key)) keys.push(key); values[key] = String(value); },
					removeItem: function (key) { key = String(key); if (!Object.prototype.hasOwnProperty.call(values, key)) return; delete values[key]; keys.splice(keys.indexOf(key), 1); },
					clear: function () { values = Object.create(null); keys = []; },
					key: function (index) { return index >= 0 && index < keys.length ? keys[index] : null; }
				};
				Object.defineProperty(storage, "length", { get: function () { return keys.length; } });
				try { Object.defineProperty(window, "localStorage", { configurable: true, value: storage }); } catch (_) {}
			}
			let state = initialContext && typeof initialContext === "object" ? initialContext : {};
			const token = String(metadata.token || "");
			const scriptId = String(metadata.id || "");
			const scriptName = String(metadata.name || scriptId);
			let scriptInfo = String(metadata.info || "");
			let scriptButtons = Array.isArray(metadata.buttons) ? metadata.buttons : [];
			let nextId = 1;
			const pending = Object.create(null);
			const listeners = Object.create(null);
			function copy(value) {
				try { return structuredClone(value); }
				catch (_) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			}
			function stringHash(value, seed) {
				if (typeof value !== "string") return 0;
				let h1 = 0xdeadbeef ^ (Number(seed) || 0), h2 = 0x41c6ce57 ^ (Number(seed) || 0);
				for (let index = 0; index < value.length; index += 1) {
					const code = value.charCodeAt(index);
					h1 = Math.imul(h1 ^ code, 2654435761);
					h2 = Math.imul(h2 ^ code, 1597334677);
				}
				h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
				h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
				return 4294967296 * (2097151 & h2) + (h1 >>> 0);
			}
			function buttonEvent(name) { return scriptId + "_" + stringHash(String(name || "")); }
			function lastId() { return Math.max(-1, (state.messages || []).length - 1); }
			function normalizeId(value) {
				let id = Number(value);
				if (!Number.isFinite(id)) id = lastId();
				if (id < 0) id = (state.messages || []).length + id;
				return Math.max(0, Math.min(lastId(), id));
			}
			function currentId() { return lastId(); }
			function optionOf(option) {
				const value = option && typeof option === "object" ? copy(option) : { type: "message" };
				if (!value.type) value.type = "message";
				if (value.type === "message") {
					if (value.message_id === undefined || value.message_id === null || value.message_id === "latest") value.message_id = currentId();
				} else if (value.type === "script" && !value.script_id) value.script_id = scriptId;
				return value;
			}
			function messagesFor(target, options) {
				const all = state.messages || [];
				let items = [];
				if (target === undefined || target === null) items = [all[currentId()]];
				else if (typeof target === "string" && target.includes("-")) {
					const value = target.replace(/{{\s*lastMessageId\s*}}/gi, String(lastId()));
					const parts = value.split("-");
					const from = normalizeId(parts[0]);
					const to = normalizeId(parts[1]);
					for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) items.push(all[index]);
				} else items = [all[normalizeId(target)]];
				items = items.filter(Boolean);
				if (options && options.role && options.role !== "all") items = items.filter(function (item) { return item.role === options.role; });
				return copy(items);
			}
			function call(method, args) {
				return new Promise(function (resolve, reject) {
					const requestId = String(nextId++);
					pending[requestId] = { resolve: resolve, reject: reject };
					parent.postMessage({ type: "dsh-tavern-helper-call", token: token, requestId: requestId, method: method, args: copy(args || {}) }, "*");
				});
			}
			function getVariables(option) {
				const resolved = optionOf(option);
				if (resolved.type === "chat") return copy(state.chatVariables || {});
				if (resolved.type === "script") return copy(state.scriptVariables && state.scriptVariables[resolved.script_id] || {});
				const message = (state.messages || [])[normalizeId(resolved.message_id)];
				return copy(message && message.variables && typeof message.variables === "object" ? message.variables : {});
			}
			function localReplace(variables, option) {
				const resolved = optionOf(option);
				if (resolved.type === "chat") state.chatVariables = copy(variables);
				else if (resolved.type === "script") {
					if (!state.scriptVariables || typeof state.scriptVariables !== "object") state.scriptVariables = {};
					state.scriptVariables[resolved.script_id] = copy(variables);
				} else {
					const message = (state.messages || [])[normalizeId(resolved.message_id)];
					if (message) {
						message.variables = copy(variables);
						if (Array.isArray(message.swipes_data)) message.swipes_data[message.swipe_id || 0] = copy(variables);
					}
				}
				return resolved;
			}
			function localSetMessages(patches) {
				(patches || []).forEach(function (patch) {
					const message = (state.messages || [])[normalizeId(patch.message_id)];
					if (!message) return;
					if (patch.swipe_id !== undefined) {
						message.swipe_id = Math.max(0, Math.min((message.swipes || []).length - 1, Number(patch.swipe_id) || 0));
						message.message = (message.swipes || [])[message.swipe_id] || message.message;
					}
					if (patch.message !== undefined) {
						message.message = String(patch.message);
						if (Array.isArray(message.swipes)) message.swipes[message.swipe_id || 0] = message.message;
					}
					if (patch.data !== undefined) {
						message.variables = copy(patch.data || {});
						if (Array.isArray(message.swipes_data)) message.swipes_data[message.swipe_id || 0] = copy(patch.data || {});
					}
				});
			}
			async function eventEmit(name) {
				const args = Array.prototype.slice.call(arguments, 1);
				const items = listeners[name] ? Array.from(listeners[name]) : [];
				for (const listener of items) await listener.apply(null, args);
			}
			addEventListener("message", function (event) {
				const data = event && event.data;
				if (event.source !== parent || !data || data.token !== token) return;
				if (data.type === "dsh-tavern-helper-context") {
					state = Object.assign({}, state, copy(data.context || {}));
					return;
				}
				if (data.type === "dsh-tavern-helper-event") {
					const suppliedArgs = copy(data.args || []);
					let task;
					if (data.name === "mag_variable_update_ended" && suppliedArgs.length === 0) {
						const option = { type: "message", message_id: currentId() };
						const variables = getVariables(option);
						const before = JSON.stringify(variables);
						task = Promise.resolve(eventEmit(data.name, variables)).then(function () {
							if (JSON.stringify(variables) === before) return;
							localReplace(variables, option);
							return call("updateTavernHelperVariables", { option: option, variables: variables });
						}).then(function () { return [variables]; });
					} else task = Promise.resolve(eventEmit.apply(null, [data.name].concat(suppliedArgs))).then(function () { return suppliedArgs; });
					task.then(function (args) {
						if (data.eventId) parent.postMessage({ type: "dsh-tavern-helper-event-complete", token: token, eventId: data.eventId, args: copy(args || []) }, "*");
					}).catch(function (error) {
						console.error(error);
						if (data.eventId) parent.postMessage({ type: "dsh-tavern-helper-event-complete", token: token, eventId: data.eventId, error: String(error && error.message || error), args: suppliedArgs }, "*");
					});
					return;
				}
				if (data.type !== "dsh-tavern-helper-response") return;
				const task = pending[data.requestId];
				if (!task) return;
				delete pending[data.requestId];
				if (data.ok) {
					if (data.result && data.result.context) state = Object.assign({}, state, copy(data.result.context));
					if (data.result && data.result.worldbook) state.worldbook = copy(data.result.worldbook);
					task.resolve(data.result);
				} else task.reject(new Error(String(data.error || "Helper 调用失败")));
			});
			window.getScriptId = function () { return scriptId; };
			window.getScriptName = function () { return scriptName; };
			window.getScriptInfo = function () { return scriptInfo; };
			window.replaceScriptInfo = function (value) { scriptInfo = String(value || ""); };
			window.getScriptButtons = function () { return copy(scriptButtons); };
			window.replaceScriptButtons = function (buttons) { scriptButtons = copy(Array.isArray(buttons) ? buttons : []); };
			window.updateScriptButtonsWith = async function (updater) { const next = await updater(copy(scriptButtons)); window.replaceScriptButtons(next); return copy(scriptButtons); };
			window.appendInexistentScriptButtons = function (buttons) {
				const next = copy(scriptButtons);
				for (const button of Array.isArray(buttons) ? buttons : []) if (!next.some(function (item) { return item && item.name === button.name; })) next.push(copy(button));
				window.replaceScriptButtons(next);
				return copy(next);
			};
			window.getButtonEvent = buttonEvent;
			window.getCharData = function () { return copy(state.character || null); };
			window.getCurrentMessageId = currentId;
			window.getLastMessageId = lastId;
			window.getChatMessages = messagesFor;
			window.getVariables = getVariables;
			window.getAllVariables = function () {
				const merged = Object.assign({}, copy(state.chatVariables || {}), getVariables({ type: "script" }));
				for (const message of state.messages || []) Object.assign(merged, copy(message.variables || {}));
				return merged;
			};
			window.replaceVariables = function (variables, option) {
				const resolved = localReplace(copy(variables || {}), option);
				call("updateTavernHelperVariables", { option: resolved, variables: copy(variables || {}) }).catch(console.error);
			};
			window.insertOrAssignVariables = function (variables, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				const next = window._.mergeWith(current, copy(variables || {}), function (_left, right) {
					return Array.isArray(right) ? right : undefined;
				});
				localReplace(next, resolved);
				call("updateTavernHelperVariables", { option: resolved, variables: copy(next) }).catch(console.error);
				return copy(next);
			};
			window.insertVariables = function (variables, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				const next = window._.mergeWith({}, copy(variables || {}), current, function (_left, right) {
					return Array.isArray(right) ? right : undefined;
				});
				localReplace(next, resolved);
				call("updateTavernHelperVariables", { option: resolved, variables: copy(next) }).catch(console.error);
				return copy(next);
			};
			window.updateVariablesWith = async function (updater, option) {
				const resolved = optionOf(option);
				const current = getVariables(resolved);
				let next = typeof updater === "function" ? await updater(copy(current)) : current;
				if (next === undefined) next = current;
				next = copy(next);
				localReplace(next, resolved);
				await call("updateTavernHelperVariables", { option: resolved, variables: next });
				return copy(next);
			};
			window.setChatMessages = async function (patches) {
				const plain = copy(patches || []);
				localSetMessages(plain);
				return await call("updateTavernHelperMessages", { messages: plain });
			};
			window.getWorldbookNames = function () { return state.worldbook && state.worldbook.name ? [state.worldbook.name] : []; };
			window.getCharWorldbookNames = function () { return { primary: state.worldbook && state.worldbook.name || null, additional: [] }; };
			window.getWorldbook = async function (name) {
				if (state.worldbook && (name === "current" || name === state.worldbook.name)) return copy(state.worldbook.entries || []);
				const result = await call("getTavernHelperWorldbook", { name: name });
				state.worldbook = copy(result.worldbook);
				return copy(state.worldbook.entries || []);
			};
			window.updateWorldbookWith = async function (name, updater) {
				const current = await window.getWorldbook(name);
				let next = typeof updater === "function" ? await updater(copy(current)) : current;
				if (next === undefined) next = current;
				const result = await call("replaceTavernHelperWorldbook", { name: name, entries: copy(next) });
				state.worldbook = copy(result.worldbook);
				return copy(state.worldbook.entries || []);
			};
			window.eventOn = function (name, handler) { (listeners[name] || (listeners[name] = new Set())).add(handler); return handler; };
			window.eventMakeFirst = window.eventOn;
			window.eventOff = function (name, handler) { if (listeners[name]) listeners[name].delete(handler); };
			window.eventEmit = eventEmit;
			window.tavern_events = {
				MESSAGE_SENT: "MESSAGE_SENT", MESSAGE_RECEIVED: "MESSAGE_RECEIVED", MESSAGE_UPDATED: "MESSAGE_UPDATED",
				MESSAGE_SWIPED: "MESSAGE_SWIPED", MESSAGE_DELETED: "MESSAGE_DELETED", MESSAGE_EDITED: "MESSAGE_EDITED",
				CHAT_CHANGED: "CHAT_CHANGED", CHAT_CREATED: "CHAT_CREATED", CHARACTER_PAGE_LOADED: "CHARACTER_PAGE_LOADED",
				GENERATE_BEFORE_COMBINE_PROMPTS: "GENERATE_BEFORE_COMBINE_PROMPTS"
			};
			window.Mvu = {
				events: { VARIABLE_INITIALIZED: "mag_variable_initialized", VARIABLE_UPDATE_STARTED: "mag_variable_update_started", COMMAND_PARSED: "mag_command_parsed", VARIABLE_UPDATE_ENDED: "mag_variable_update_ended", BEFORE_MESSAGE_UPDATE: "mag_before_message_update" },
				getMvuData: function (option) { return getVariables(option); },
				replaceMvuData: async function (value, option) { await window.updateVariablesWith(function () { return value; }, option); return copy(value); },
				parseMessage: async function () { throw new Error("当前兼容层尚未开放脚本内手动 MVU 重算"); }
			};
			window.waitGlobalInitialized = async function (name) { if (name === "Mvu") return window.Mvu; return window[name]; };
			function HelperPopup(content, _type, title, options) {
				const popup = this;
				popup.content = content;
				popup.options = options && typeof options === "object" ? options : {};
				popup.root = null;
				popup.resolve = null;
				popup.completeAffirmative = async function () {
					if (popup.root) popup.root.remove();
					popup.root = null;
					parent.postMessage({ type: "dsh-tavern-helper-ui-close", token: token }, "*");
					if (popup.resolve) { const resolve = popup.resolve; popup.resolve = null; resolve(true); }
					return true;
				};
				popup.show = function () {
					if (popup.root) return Promise.resolve(false);
					const overlay = document.createElement("div");
					overlay.setAttribute("data-dsh-helper-popup", "");
					overlay.style.cssText = "position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.64);box-sizing:border-box";
					const panel = document.createElement("section");
					panel.style.cssText = "width:min(920px,100%);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:16px;background:#15191f;color:#eef4fb;box-shadow:0 24px 80px rgba(0,0,0,.5);box-sizing:border-box";
					if (title) { const heading = document.createElement("h2"); heading.textContent = String(title); panel.appendChild(heading); }
					const node = content && content.jquery ? content[0] : content;
					if (node && typeof node.nodeType === "number") panel.appendChild(node);
					else if (node !== undefined && node !== null) { const text = document.createElement("div"); text.textContent = String(node); panel.appendChild(text); }
					const actions = document.createElement("div");
					actions.style.cssText = "display:flex;justify-content:flex-end;margin-top:14px";
					const close = document.createElement("button");
					close.type = "button"; close.textContent = String(popup.options.okButton || "关闭");
					close.style.cssText = "border:1px solid rgba(255,255,255,.24);border-radius:9px;padding:7px 14px;background:#273241;color:#fff;cursor:pointer";
					close.addEventListener("click", popup.completeAffirmative);
					actions.appendChild(close); panel.appendChild(actions); overlay.appendChild(panel); document.body.appendChild(overlay);
					popup.root = overlay;
					parent.postMessage({ type: "dsh-tavern-helper-ui-open", token: token }, "*");
					return new Promise(function (resolve) { popup.resolve = resolve; });
				};
			}
			window.SillyTavern = Object.freeze({ Popup: HelperPopup, POPUP_TYPE: Object.freeze({ DISPLAY: "display" }) });
			window.errorCatched = function (factory) { return function () { try { return factory.apply(this, arguments); } catch (error) { console.error(error); return {}; } }; };
			window.retrieveDisplayedMessage = function () { return window.jQuery ? window.jQuery() : []; };
			window.toastr = { success: console.info, info: console.info, warning: console.warn, error: console.error };
			const ready = import("https://testingcf.jsdelivr.net/npm/zod@4.4.3/+esm").then(function (module) { window.z = module; return true; });
			window.__dshTavernHelperReady = ready;
			addEventListener("error", function (event) {
				const target = event && event.target;
				const resource = target && target !== window ? String(target.src || target.href || "") : "";
				const message = event && event.message ? String(event.message) : (resource ? "资源加载失败: " + resource : "人物卡脚本加载失败");
				parent.postMessage({ type: "dsh-tavern-helper-script-runtime", token: token, level: "error", message: message }, "*");
			});
			addEventListener("unhandledrejection", function (event) {
				parent.postMessage({ type: "dsh-tavern-helper-script-runtime", token: token, level: "error", message: String(event.reason && event.reason.message || event.reason || "人物卡脚本 Promise 失败") }, "*");
			});
			parent.postMessage({ type: "dsh-tavern-helper-script-ready", token: token }, "*");
		}

		function buildTavernHelperScriptDocument(input) {
			const metadata = {
				token: String(input && input.token || ""),
				id: String(input && input.script && input.script.id || ""),
				name: String(input && input.script && input.script.name || ""),
				info: String(input && input.script && input.script.info || ""),
				buttons: Array.isArray(input && input.script && input.script.buttons) ? input.script.buttons : []
			};
			const context = input && input.context && typeof input.context === "object" ? input.context : {};
			const safeMetadata = JSON.stringify(metadata).replace(/</g, "\\u003c");
			const safeContext = JSON.stringify(context).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			const bootstrap = '(' + tavernHelperScriptBootstrap.toString() + ')(' + safeMetadata + ',' + safeContext + ');';
			const cardSource = String(input && input.script && input.script.content || "");
			const deferredSource = cardSource.replace(/(^|[\r\n])([ \t]*)import\s+(["'])((?:https:\/\/|\/api\/dsh-tavern\/remote-assets\/)[^"']+)\3\s*;?/g, function (_match, line, indent, quote, url) {
				const target = url.startsWith("/") ? "new URL(" + quote + url + quote + ", document.baseURI).href" : quote + url + quote;
				return line + indent + "await import(" + target + ");";
			});
			const moduleSource = 'await window.__dshTavernHelperReady;\n' + deferredSource;
			const moduleUrl = "data:text/javascript;base64," + encodeTavernScriptSource(moduleSource);
			return '<!doctype html><html><head><meta charset="utf-8">'
				+ '<meta name="referrer" content="no-referrer">'
				+ '<meta http-equiv="Content-Security-Policy" content="default-src https: http: data: blob:; script-src \'unsafe-inline\' \'unsafe-eval\' https: http: data: blob:; connect-src https: http: wss: data: blob:; img-src https: http: data: blob:; style-src \'unsafe-inline\' https: http:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
				+ '<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"><\/script>'
				+ '<script src="https://cdn.jsdelivr.net/npm/lodash@4.18.1/lodash.min.js"><\/script>'
				+ '<script src="https://cdn.jsdelivr.net/npm/vue@3.5.41/dist/vue.global.prod.js"><\/script>'
				+ '<script data-dsh-tavern-helper-script>' + bootstrap + '<\/script>'
				+ '</head><body><script type="module" src="' + moduleUrl + '"><\/script></body></html>';
		}

		function createTavernHelperScriptRuntime(options) {
			const hostWindow = options && options.window || window;
			const hostDocument = options && options.document || document;
			const invoke = options && options.rpc || rpc;
			const reportError = options && options.reportError || function (source, error) { tavernErrorHub.report(source, error); };
			const reportMutation = options && options.onMutation || function (sessionId) { liveTavernView.invalidate(sessionId); };
			const records = new Map();
			const pendingEvents = new Map();
			const allowedMethods = new Set(["updateTavernHelperVariables", "updateTavernHelperMessages", "getTavernHelperWorldbook", "replaceTavernHelperWorldbook"]);
			let activeSessionId = "";
			let root = null;
			let previous = null;
			let eventSequence = 0;
			function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
			function token() { return hostWindow.crypto && typeof hostWindow.crypto.randomUUID === "function" ? hostWindow.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random()); }
			function stringHash(value, seed) {
				if (typeof value !== "string") return 0;
				let h1 = 0xdeadbeef ^ (Number(seed) || 0), h2 = 0x41c6ce57 ^ (Number(seed) || 0);
				for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677); }
				h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
				h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
				return 4294967296 * (2097151 & h2) + (h1 >>> 0);
			}
			function buttonEvent(scriptId, name) { return String(scriptId) + "_" + stringHash(String(name || "")); }
			function ensureRoot() {
				if (root && root.isConnected !== false) return root;
				root = hostDocument.createElement("div");
				root.id = "dsh-tavern-helper-script-host";
				root.hidden = true;
				(hostDocument.body || hostDocument.documentElement).appendChild(root);
				return root;
			}
			function helperContext(view, script) {
				const context = clone(view && view.tavernHelper || {});
				if (!context.scriptVariables || typeof context.scriptVariables !== "object") context.scriptVariables = {};
				if (!Object.prototype.hasOwnProperty.call(context.scriptVariables, script.id)) context.scriptVariables[script.id] = clone(script.data || {});
				const character = clone(view && view.card || null);
				if (character && typeof character === "object" && (!character.data || typeof character.data !== "object")) character.data = clone(character);
				context.character = character;
				context.worldbook = clone(view && view.tavernHelperWorldbook || null);
				return context;
			}
			function post(record, message) {
				if (!record.loaded || !record.frame.contentWindow) return;
				record.frame.contentWindow.postMessage(Object.assign({ token: record.token }, message), "*");
			}
			function snapshot(context) {
				const messages = Array.isArray(context && context.messages) ? context.messages : [];
				const latest = messages[messages.length - 1] || null;
				return {
					lifecycleRevision: Math.max(0, Number(context && context.lifecycleRevision) || 0),
					count: messages.length,
					latestId: latest ? Number(latest.message_id) : -1,
					latestRole: latest && latest.role || "",
					latestMessage: latest && latest.message || "",
					latestSwipe: latest ? Number(latest.swipe_id) || 0 : 0,
					latestVariables: JSON.stringify(latest && latest.variables || {})
				};
			}
			function eventsBetween(before, after) {
				if (!before) return [];
				if (after.lifecycleRevision !== before.lifecycleRevision) return [];
				if (after.count < before.count) return [{ name: "MESSAGE_DELETED", args: [before.latestId] }];
				if (after.count > before.count) {
					if (after.latestRole === "assistant") return [{ name: "MESSAGE_RECEIVED", args: [after.latestId] }];
					return [{ name: "MESSAGE_SENT", args: [after.latestId] }];
				}
				if (after.latestSwipe !== before.latestSwipe) return [{ name: "MESSAGE_SWIPED", args: [after.latestId] }];
				if (after.latestMessage !== before.latestMessage) return [{ name: "MESSAGE_EDITED", args: [after.latestId] }];
				if (after.latestVariables !== before.latestVariables) return [{ name: "mag_variable_update_ended", args: [] }];
				return [];
			}
			function removeRecord(id) {
				const record = records.get(id);
				if (!record) return;
				record.frame.remove();
				records.delete(id);
			}
			function closeRecordUi() {
				if (!root) return;
				root.hidden = true;
				for (const record of records.values()) record.frame.hidden = false;
			}
			function openRecordUi(record) {
				const container = ensureRoot();
				container.hidden = false;
				container.style.cssText = "position:fixed;inset:0;z-index:2300";
				for (const item of records.values()) item.frame.hidden = item !== record;
				record.frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent";
			}
			function emitToRecord(record, name, args, context) {
				if (!record.loaded) return Promise.resolve(args);
				if (context && typeof context === "object") {
					record.context = clone(context);
					post(record, { type: "dsh-tavern-helper-context", context: record.context });
				}
				const eventId = "host-event-" + (++eventSequence);
				return new Promise(function (resolve) {
					const timer = hostWindow.setTimeout(function () {
						pendingEvents.delete(eventId);
						resolve(args);
					}, 2000);
					pendingEvents.set(eventId, { resolve: resolve, timer: timer });
					post(record, { type: "dsh-tavern-helper-event", eventId: eventId, name: name, args: clone(args) });
				});
			}
			async function emit(name, args, context) {
				let current = clone(Array.isArray(args) ? args : []);
				for (const record of records.values()) current = await emitToRecord(record, name, current, context);
				return current;
			}
			function clear() {
				Array.from(records.keys()).forEach(removeRecord);
				if (root) root.remove();
				root = null;
				previous = null;
			}
			function createRecord(sessionId, script, context, trustedCardMode) {
				const frame = hostDocument.createElement("iframe");
				const record = { id: script.id, name: script.name, fingerprint: script.id + "\n" + script.content + "\ntrusted=" + String(trustedCardMode), token: token(), frame: frame, loaded: false, context: context, lastRuntimeError: "" };
				frame.title = "人物卡脚本：" + script.name;
				frame.sandbox = trustedCardMode ? "allow-scripts allow-same-origin" : "allow-scripts";
				frame.referrerPolicy = "no-referrer";
				frame.srcdoc = buildTavernHelperScriptDocument({ token: record.token, script: script, context: context });
				frame.addEventListener("load", function () {
					record.loaded = true;
					post(record, { type: "dsh-tavern-helper-context", context: record.context });
					post(record, { type: "dsh-tavern-helper-event", name: "CHAT_CHANGED", args: [] });
				});
				ensureRoot().appendChild(frame);
				records.set(script.id, record);
				return record;
			}
			function sync(sessionId, view) {
				const nextSessionId = String(sessionId || "");
				if (activeSessionId && activeSessionId !== nextSessionId) clear();
				activeSessionId = nextSessionId;
				const scripts = Array.isArray(view && view.tavernHelperScripts) ? view.tavernHelperScripts : [];
				const trustedCardMode = Boolean(view && view.tavernRuntimePolicy && view.tavernRuntimePolicy.trustedCardMode);
				const activeIds = new Set(scripts.map(function (script) { return String(script.id); }));
				Array.from(records.keys()).forEach(function (id) { if (!activeIds.has(id)) removeRecord(id); });
				let nextSnapshot = null;
				let queuedEvents = [];
				for (const script of scripts) {
					const context = helperContext(view, script);
					if (!nextSnapshot) { nextSnapshot = snapshot(context); queuedEvents = eventsBetween(previous, nextSnapshot); }
					const fingerprint = script.id + "\n" + script.content + "\ntrusted=" + String(trustedCardMode);
					let record = records.get(script.id);
					if (record && record.fingerprint !== fingerprint) { removeRecord(script.id); record = null; }
					if (!record) record = createRecord(nextSessionId, script, context, trustedCardMode);
					else {
						record.context = context;
						post(record, { type: "dsh-tavern-helper-context", context: context });
						queuedEvents.forEach(function (event) { post(record, { type: "dsh-tavern-helper-event", name: event.name, args: event.args }); });
					}
				}
				previous = nextSnapshot;
			}
			function receive(event) {
				const data = event && event.data;
				if (!data || !data.token) return;
				const record = Array.from(records.values()).find(function (item) { return item.token === data.token && event.source === item.frame.contentWindow; });
				if (!record) return;
				if (data.type === "dsh-tavern-helper-ui-open") { openRecordUi(record); return; }
				if (data.type === "dsh-tavern-helper-ui-close") { closeRecordUi(); return; }
				if (data.type === "dsh-tavern-helper-event-complete") {
					const pending = pendingEvents.get(String(data.eventId || ""));
					if (!pending) return;
					pendingEvents.delete(String(data.eventId || ""));
					hostWindow.clearTimeout(pending.timer);
					pending.resolve(clone(Array.isArray(data.args) ? data.args : []));
					return;
				}
				if (data.type === "dsh-tavern-helper-script-runtime") {
					const message = String(data.message || "人物卡脚本运行失败");
					if (message !== record.lastRuntimeError) { record.lastRuntimeError = message; reportError("人物卡脚本「" + record.name + "」", new Error(message)); }
					return;
				}
				if (data.type !== "dsh-tavern-helper-call" || !allowedMethods.has(data.method)) return;
				let mutationArgs = data.args || {};
				if (data.method === "updateTavernHelperVariables" || data.method === "updateTavernHelperMessages") {
					mutationArgs = Object.assign({}, mutationArgs, { expectedLifecycleRevision: Math.max(0, Number(record.context && record.context.lifecycleRevision) || 0) });
				}
				invoke(data.method, mutationArgs, activeSessionId).then(function (result) {
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: true, result: result });
					if ((data.method === "updateTavernHelperVariables" || data.method === "updateTavernHelperMessages" || data.method === "replaceTavernHelperWorldbook") && result && result.updated !== false && result.stale !== true) reportMutation(activeSessionId, data.method, result);
				}, function (error) {
					post(record, { type: "dsh-tavern-helper-response", requestId: data.requestId, ok: false, error: String(error && error.message || error) });
				});
			}
			hostWindow.addEventListener("message", receive);
			return Object.freeze({
				sync: sync,
				emit: emit,
				triggerButton: function (scriptId, name) {
					const record = records.get(String(scriptId));
					if (!record) return Promise.reject(new Error("人物卡脚本尚未运行"));
					return emitToRecord(record, buttonEvent(scriptId, name), [], record.context);
				},
				dispose: function () { hostWindow.removeEventListener("message", receive); clear(); },
				inspect: function () { return { sessionId: activeSessionId, scriptIds: Array.from(records.keys()) }; }
			});
		}

		let tavernHelperScriptRuntime = null;
		let tavernHelperEventPollTimer = null;
		let tavernHelperEventPollBusy = false;
		let tavernHelperRuntimeActive = false;
		let tavernHelperRuntimeInput = null;
		const tavernHelperRuntimeId = window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random());
		function inactiveTavernHelperView(view) {
			return Object.assign({}, view || {}, { tavernHelperScripts: [] });
		}
		function scheduleTavernHelperEventPoll() {
			if (tavernHelperEventPollTimer !== null) return;
			tavernHelperEventPollTimer = window.setTimeout(async function poll() {
				tavernHelperEventPollTimer = null;
				const runtime = tavernHelperScriptRuntime;
				const input = tavernHelperRuntimeInput;
				if (!runtime || !input || !input.sessionId || !Array.isArray(input.view && input.view.tavernHelperScripts) || input.view.tavernHelperScripts.length === 0) return;
				if (!tavernHelperEventPollBusy) {
					tavernHelperEventPollBusy = true;
					try {
						const result = await rpc("pollTavernHelperEvent", { runtimeId: tavernHelperRuntimeId }, input.sessionId);
						if (!tavernHelperRuntimeInput || tavernHelperRuntimeInput.sessionId !== input.sessionId) return;
						if (Boolean(result && result.active) !== tavernHelperRuntimeActive) {
							tavernHelperRuntimeActive = Boolean(result && result.active);
							runtime.sync(input.sessionId, tavernHelperRuntimeActive ? input.view : inactiveTavernHelperView(input.view));
						}
						const event = result && result.event;
						if (tavernHelperRuntimeActive && event) {
							const args = await runtime.emit(event.name, event.args, event.context);
							await rpc("completeTavernHelperEvent", { eventId: event.id, args: args, runtimeId: tavernHelperRuntimeId }, input.sessionId);
						}
					} catch (error) { console.warn("Tavern Helper 生命周期同步失败", error); }
					finally { tavernHelperEventPollBusy = false; }
				}
				scheduleTavernHelperEventPoll();
			}, tavernHelperRuntimeActive ? 100 : 500);
		}
		function syncTavernHelperScripts(sessionId, view) {
			if (!tavernHelperScriptRuntime) tavernHelperScriptRuntime = createTavernHelperScriptRuntime();
			const nextSessionId = String(sessionId || "");
			const previousSessionId = tavernHelperRuntimeInput && tavernHelperRuntimeInput.sessionId || "";
			if (previousSessionId && previousSessionId !== nextSessionId) {
				rpc("releaseTavernHelperRuntime", { runtimeId: tavernHelperRuntimeId }, previousSessionId).catch(function () {});
				tavernHelperRuntimeActive = false;
			}
			tavernHelperRuntimeInput = { sessionId: nextSessionId, view: view };
			tavernHelperScriptRuntime.sync(nextSessionId, tavernHelperRuntimeActive ? view : inactiveTavernHelperView(view));
			scheduleTavernHelperEventPoll();
		}

		const TAVERN_FRAME_MAX_HEIGHT = 12000;
		function clampTavernFrameHeight(value) {
			return Math.max(48, Math.min(TAVERN_FRAME_MAX_HEIGHT, Math.ceil(Number(value) || 48)));
		}

		function TavernMessageFrame(props) {
			const frameRef = React.useRef(null);
			const tokenRef = React.useRef("");
			if (tokenRef.current === "") tokenRef.current = window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random());
			const [height, setHeight] = React.useState(80);
			const runtimeTimer = React.useRef(0);
			const pendingRuntime = React.useRef(null);
			const documentHtml = React.useMemo(function () {
				return buildTavernFrameDocument({ content: props.content, token: tokenRef.current, helperContext: props.helperContext, turn: props.turn });
			}, [props.content, props.helperContext, props.turn]);
			React.useEffect(function () {
				function receive(event) {
					const frame = frameRef.current;
					const data = event && event.data;
					if (!frame || event.source !== frame.contentWindow || !data || data.token !== tokenRef.current) return;
					if (data.type === "dsh-tavern-frame-height") {
						const next = clampTavernFrameHeight(data.height);
						setHeight(next);
					} else if (data.type === "dsh-tavern-frame-runtime" && props.sessionId && props.turn > 0) {
						pendingRuntime.current = data.runtime;
						if (!runtimeTimer.current) runtimeTimer.current = window.setTimeout(function () {
							runtimeTimer.current = 0;
							const runtime = pendingRuntime.current; pendingRuntime.current = null;
							rpc("captureDisplayRuntime", { turn: props.turn, partIndex: props.partIndex, runtime: runtime }, props.sessionId).catch(function () {});
						}, 1000);
					} else if (data.type === "dsh-tavern-helper-call" && props.sessionId) {
						if (data.method !== "updateTavernHelperVariables" && data.method !== "updateTavernHelperMessages") return;
						const args = Object.assign({}, data.args || {}, { sessionId: props.sessionId, expectedLifecycleRevision: Math.max(0, Number(props.helperContext && props.helperContext.lifecycleRevision) || 0) });
						rpc(data.method, args, props.sessionId).then(function (result) {
							frame.contentWindow.postMessage({ type: "dsh-tavern-helper-response", token: tokenRef.current, requestId: data.requestId, ok: true, result: result }, "*");
						}, function (error) {
							frame.contentWindow.postMessage({ type: "dsh-tavern-helper-response", token: tokenRef.current, requestId: data.requestId, ok: false, error: String(error && error.message || error) }, "*");
						});
					}
				}
				window.addEventListener("message", receive);
				return function () { window.removeEventListener("message", receive); if (runtimeTimer.current) window.clearTimeout(runtimeTimer.current); };
			}, [props.sessionId, props.turn, props.partIndex]);
			return React.createElement("iframe", {
				ref: frameRef,
				className: "dsh-tavern-message-frame",
				title: "人物卡消息界面",
				sandbox: props.trustedCardMode ? "allow-scripts allow-same-origin" : "allow-scripts",
				referrerPolicy: "no-referrer",
				srcDoc: documentHtml,
				style: { height: height + "px", overflow: height >= TAVERN_FRAME_MAX_HEIGHT ? "auto" : "hidden" }
			});
		}

		function tavernProjectionForTurn(view, turn) {
			if (!view || !isPlayMode(view.mode) || !Array.isArray(view.replyProjections)) return null;
			for (let index = view.replyProjections.length - 1; index >= 0; index -= 1) {
				const projection = view.replyProjections[index];
				if (Number(projection && projection.turn) === Number(turn)) return Number(projection.version) === 1 || Number(projection.version) === 2 ? projection : null;
			}
			return null;
		}

		function projectionPartsOf(projection) {
			if (!projection) return [];
			if (Array.isArray(projection.parts)) return projection.parts.filter(function (part) {
				return part && (part.kind === "markdown" || part.kind === "html");
			});
			if (projection.mode === "html" || projection.mode === "rich") return [{ kind: "html", content: String(projection.html || projection.text || "") }];
			return [{ kind: "markdown", text: String(projection.text || "") }];
		}

		function renderTavernProjection(projection, options) {
			const h = React.createElement;
			return projectionPartsOf(projection).map(function (part, index) {
				if (part.kind === "markdown") return h(DshUi.MarkdownText, { key: index, text: String(part.text || ""), streaming: options.streaming, codeLabels: options.codeLabels, fileMentions: options.mentions });
				const content = String(part.content !== undefined ? part.content : part.html || "");
				return h(TavernMessageFrame, { key: index, content: content, sessionId: options.sessionId, turn: options.turn, partIndex: index, helperContext: options.helperContext, trustedCardMode: options.trustedCardMode });
			});
		}

		function renderTavernAssistantBlocks(input) {
			const h = React.createElement;
			const blocks = Array.isArray(input.blocks) ? input.blocks : [];
			const translate = typeof input.t === "function" ? input.t : function (key, values) {
				if (key === "copy") return "复制";
				if (key === "copied") return "已复制";
				if (key === "message.stopped") return "已停止";
				if (key === "message.unknownBlock") return "未知消息块";
				if (key === "json.truncated") return "内容过长（共 " + String(values && values.total || 0) + " 项）";
				return key;
			};
			const codeLabels = { copyLabel: translate("copy"), copiedLabel: translate("copied") };
			const rendered = [];
			let projected = false;
			for (let index = 0; index < blocks.length; index += 1) {
				const block = blocks[index];
				if (!block) continue;
				if (block.kind === "text") {
					if (input.projection && projected) continue;
					const projection = input.projection;
					if (projection) rendered.push(h(React.Fragment, { key: index }, renderTavernProjection(projection, { streaming: input.streaming, codeLabels: codeLabels, mentions: input.mentions, sessionId: input.sessionId, turn: input.turn, helperContext: input.helperContext, trustedCardMode: input.trustedCardMode })));
					else rendered.push(h(DshUi.MarkdownText, { key: index, text: String(block.text || ""), streaming: input.streaming, codeLabels: codeLabels, fileMentions: input.mentions }));
					projected = true;
					continue;
				}
				if (block.kind === "reasoning") {
					rendered.push(h("details", { key: index, className: "dsh-tavern-assistant-reasoning", open: input.streaming && index === blocks.length - 1 }, h("summary", null, input.streaming && index === blocks.length - 1 ? "思考中…" : "思考过程"), h("pre", null, String(block.text || ""))));
					continue;
				}
				if (block.kind === "image") {
					const start = index;
					const group = [block];
					while (index + 1 < blocks.length && blocks[index + 1] && blocks[index + 1].kind === "image") { group.push(blocks[index + 1]); index += 1; }
					rendered.push(h(React.Fragment, { key: start }, input.renderMessageImages({ images: group.map(function (item) { return { attachment: item.attachment }; }), align: "start" })));
					continue;
				}
				if (block.kind !== "tool-call") rendered.push(h(DshUi.JsonBlock, { key: index, label: translate("message.unknownBlock"), payload: block.block || block, truncatedLabel: function (total) { return translate("json.truncated", { total: total }); } }));
			}
			if (input.projection && !projected) {
				rendered.push(h(React.Fragment, { key: "projection" }, renderTavernProjection(input.projection, { streaming: false, codeLabels: codeLabels, mentions: input.mentions, sessionId: input.sessionId, turn: input.turn, helperContext: input.helperContext, trustedCardMode: input.trustedCardMode })));
			}
			if (input.interrupted) rendered.push(h("span", { key: "stopped", className: "dsh-tavern-assistant-stopped" }, translate("message.stopped")));
			return rendered;
		}

		function userContentParts(content) {
			const texts = [];
			const images = [];
			const rest = [];
			for (const block of Array.isArray(content) ? content : []) {
				if (block && block.type === "text" && typeof block.text === "string") texts.push(block.text);
				else if (block && block.type === "image" && block.attachment !== undefined) images.push({ attachment: block.attachment });
				else if (block) rest.push(block);
			}
			return { text: texts.join(""), images: images, rest: rest };
		}

		function tavernUserTextForTurn(view, turn, content) {
			const fallback = userContentParts(content).text;
			const sources = view && view.inputSources;
			const key = String(Number(turn) || 0);
			if (!sources || !Object.prototype.hasOwnProperty.call(sources, key)) return fallback;
			return String(sources[key] === undefined || sources[key] === null ? "" : sources[key]);
		}

		function createTavernAssistantRendererFeatureModule() {
			function TavernUserNodeView(props) {
				const data = props.node.data;
				const location = props.node.location;
				const turnRef = location && (location.kind === "turn" || location.kind === "step") ? location.turn : null;
				const turn = turnRef ? Number(turnRef.turn) : 0;
				const liveState = useLiveTavernView(props.sessionId, String(data.time || ""));
				const parts = userContentParts(data.content);
				const text = tavernUserTextForTurn(liveState.view, turn, data.content);
				const [copied, setCopied] = React.useState(false);
				const copyTimer = React.useRef(null);
				React.useEffect(function () { return function () { if (copyTimer.current !== null) window.clearTimeout(copyTimer.current); }; }, []);
				function copy() {
					DshUi.writeClipboard(text).then(function (ok) {
						if (!ok) return;
						setCopied(true);
						if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
						copyTimer.current = window.setTimeout(function () { copyTimer.current = null; setCopied(false); }, 1000);
					});
				}
				const renderedImages = parts.images.length > 0 ? props.renderMessageImages({ images: parts.images, align: "end" }) : null;
				const extras = parts.rest.map(function (block, index) {
					return React.createElement("div", { key: index, className: "dsh-tavern-user-extra" }, React.createElement(DshUi.JsonBlock, { label: typeof props.t === "function" ? props.t("message.extraBlock") : "附加内容", payload: block, truncatedLabel: function (total) { return "内容过长（共 " + String(total) + " 项）"; } }));
				});
				const time = Number.isFinite(Number(data.time)) ? new Date(Number(data.time)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
				return React.createElement("div", { className: "dsh-tavern-user-row" },
					React.createElement("div", { className: "dsh-tavern-user-stack" }, renderedImages, (text !== "" || extras.length > 0) ? React.createElement("div", { className: "dsh-tavern-user-bubble" }, React.createElement(DshUi.MessageText, { text: text }), extras) : null),
					React.createElement("div", { className: "dsh-tavern-user-actions" }, time ? React.createElement("span", null, time) : null, React.createElement(DshUi.Tooltip, { label: copied ? "已复制" : "复制", side: "bottom" }, React.createElement("button", { type: "button", className: "dsh-tavern-user-copy", "aria-label": copied ? "已复制" : "复制", onClick: copy }, React.createElement(copied ? DshUi.IconCheckOutline16 : DshUi.IconCopyOutline16, null))))
				);
			}
			function TavernAssistantNodeView(props) {
				const data = props.node.data;
				const turnRef = props.node.location.kind === "turn" || props.node.location.kind === "step" ? props.node.location.turn : null;
				const turn = turnRef ? Number(turnRef.turn) : 0;
				const settled = data.status !== "running";
				const revision = String(data.status || "") + ":" + String(data.finalNode && data.finalNode.seq || "");
				const liveState = useLiveTavernView(props.sessionId, revision);
				const [swipeBusy, setSwipeBusy] = React.useState(false);
				React.useEffect(function () {
					if (liveState.view) syncTavernHelperScripts(props.sessionId, liveState.view);
				}, [props.sessionId, liveState.view]);
				const projection = settled ? tavernProjectionForTurn(liveState.view, turn) : null;
				const swipe = liveState.view && Array.isArray(liveState.view.tavernSwipes) ? liveState.view.tavernSwipes.find(function (item) { return Number(item.turn) === turn; }) : null;
				async function switchSwipe(nextSwipeId) {
					if (!swipe || swipeBusy || nextSwipeId < 0 || nextSwipeId >= swipe.count || nextSwipeId === swipe.swipeId) return;
					setSwipeBusy(true);
					try {
						await rpc("switchTavernSwipe", { messageId: swipe.messageId, swipeId: nextSwipeId }, props.sessionId);
						liveTavernView.invalidate(props.sessionId);
					} catch (error) { tavernErrorHub.report("切换 Swipe", error); }
					finally { setSwipeBusy(false); }
				}
				const tail = props.useTurnData("turn-tail");
				const owner = React.useMemo(function () {
					if (!turnRef || turnRef.status !== "closed" || !data.finalNode || !tail || !tail.closing || tail.closing.finalNode.seq !== data.finalNode.seq) return undefined;
					return { turn: turnRef, seq: data.finalNode.seq, openFile: props.openFile };
				}, [turnRef, data.finalNode, tail, props.openFile]);
				const mentions = React.useMemo(function () { return owner === undefined ? undefined : props.fileMentions(owner); }, [owner, props.fileMentions]);
				const rendered = renderTavernAssistantBlocks({
					blocks: data.blocks,
					streaming: data.status === "running",
					interrupted: data.status === "interrupted",
					projection: projection,
					helperContext: liveState.view && liveState.view.tavernHelper,
					trustedCardMode: Boolean(liveState.view && liveState.view.tavernRuntimePolicy && liveState.view.tavernRuntimePolicy.trustedCardMode),
					sessionId: props.sessionId,
					turn: turn,
					renderMessageImages: props.renderMessageImages,
					mentions: mentions,
					t: props.t
				});
				if (!(data.status === "running" || data.status === "interrupted" || rendered.length > 0)) return null;
				const swipeControls = swipe && swipe.count > 1 && settled ? React.createElement("div", { className: "dsh-tavern-swipe-controls" },
					React.createElement("button", { type: "button", disabled: swipeBusy || swipe.swipeId <= 0, "aria-label": "上一个 Swipe", onClick: function () { switchSwipe(swipe.swipeId - 1); } }, "‹"),
					React.createElement("span", null, String(swipe.swipeId + 1) + " / " + String(swipe.count)),
					React.createElement("button", { type: "button", disabled: swipeBusy || swipe.swipeId >= swipe.count - 1, "aria-label": "下一个 Swipe", onClick: function () { switchSwipe(swipe.swipeId + 1); } }, "›")
				) : null;
				return React.createElement("div", { className: "dsh-tavern-assistant", "data-streaming": data.status === "running" || undefined }, rendered, swipeControls);
			}
			function register(input) {
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.node", function () { return input.slots.register({
						name: "conversation.chat.node",
						key: "assistant-step",
						priority: -1
					}, TavernAssistantNodeView); });
				}, "dsh-tavern: inline assistant renderer");
				input.ctx.effect(function () {
					return input.slots.inject("conversation.chat.node", function () { return input.slots.register({
						name: "conversation.chat.node",
						key: "user",
						priority: -1
					}, TavernUserNodeView); });
				}, "dsh-tavern: raw user message renderer");
			}
			return Object.freeze({ register: register });
		}

		function createTavernShellFeatureModule() {
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
			const [error, setError] = usePersistentError("左侧栏操作");
			const [uiMode, setUiMode] = React.useState("play");
			const [requestMode, setRequestMode] = React.useState("dsh");
			const [compatibilityAvailable, setCompatibilityAvailable] = React.useState(false);
			const [cardEntry, setCardEntry] = React.useState("");
			const [openingPicker, setOpeningPicker] = React.useState(null);
			const [pendingOpen, setPendingOpen] = React.useState(null);
			const [menuSession, setMenuSession] = React.useState(null);
			const [updateStatus, setUpdateStatus] = React.useState({ phase: "loading", host: "cli" });
			const updateStartedAtRef = React.useRef(0);
			const updateRecoveryRef = React.useRef({ sawOffline: false, reloading: false });
			const lastModeSession = React.useRef(null);
			const fileRef = React.useRef(null);
			const initialImportRef = React.useRef(null);
			const playWorkspaceIdRef = React.useRef(workspaceId);
			const playPrewarmRef = React.useRef(null);
			playWorkspaceIdRef.current = workspaceId;
			if (playPrewarmRef.current === null) {
				playPrewarmRef.current = createConversationPrewarmModule({
					sessionIds: function () { return Object.keys(props.sessions.list.getSnapshot().byId || {}); },
					resolveWorkspace: async function () {
						if (!playWorkspaceIdRef.current) throw new Error("当前没有可用的 Workspace");
						return playWorkspaceIdRef.current;
					},
					connectWorkspace: function (targetWorkspaceId) { return props.workspaces.connectWorkspace(targetWorkspaceId); },
					archiveSession: async function (sessionId) {
						try { await props.workspaces.archiveSession(sessionId); }
						catch (error) { if (!isMissingSessionArchiveError(error)) throw error; }
					},
					report: function (timing) {
						if (timing.phase === "ready") console.info("dsh-tavern: 游戏 Session 预热完成", timing.elapsedMs + "ms", timing.created ? "新建" : "复用");
						else if (timing.phase === "failed") console.warn("dsh-tavern: 游戏 Session 预热失败，将在开始时重试", timing.error);
						else if (timing.phase === "cleanup-failed") console.warn("dsh-tavern: 未使用的预热 Session 清理失败", timing.error);
					}
				});
			}
			const currentSummary = current ? summaries[current] : null;
			const readyTavernSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && isPlayMode(entry.mode); }) ? current : "";
			const readyCardSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && entry.mode === "card"; }) ? current : "";
			function call(method, args) { return rpc(method, args); }
			function isMissingUpdateApiError(error) {
				return String(error && error.message || error || "").indexOf("未知方法: getUpdateStatus") >= 0;
			}
			function notifyDataChanged() {
				window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
			}
			function refresh() {
				return Promise.all([call("listCards"), call("listSessions")]).then(function (all) {
					const sessions = all[1].sessions || [];
					const compatibilityMode = Boolean(all[1].capabilities && all[1].capabilities.compatibilityMode);
					setCards(all[0].cards || []); setHistory(sessions); setCompatibilityAvailable(compatibilityMode); publishSessionModes(sessions);
					if (!compatibilityMode) {
						setRequestMode("dsh");
						window.localStorage.removeItem("dsh-tavern-request-mode");
					} else if (!sessions.some(function (entry) { return entry.sessionId === current && isPlayMode(entry.mode); })) {
						setRequestMode(window.localStorage.getItem("dsh-tavern-request-mode") === "sillytavern" ? "sillytavern" : "dsh");
					}
					tavernErrorHub.resolve("左侧栏");
				}, function (err) { tavernErrorHub.report("左侧栏", err); });
			}
			React.useEffect(function () {
				function refreshSettings() { void refresh(); }
				window.addEventListener("dsh-tavern-settings-changed", refreshSettings);
				return function () { window.removeEventListener("dsh-tavern-settings-changed", refreshSettings); };
			}, []);
			React.useEffect(function () {
				refresh();
				function onData() { refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				const timer = window.setInterval(refresh, 4000);
				return function () { window.clearInterval(timer); window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, []);
			React.useEffect(function () {
				return function () { playPrewarmRef.current.cancel(); };
			}, []);
			React.useEffect(function () {
				let stopped = false;
				let received = false;
				async function refreshUpdateStatus() {
					try {
						const result = await call("getUpdateStatus");
						if (!stopped && result && result.status) {
							received = true;
							const status = result.status;
							const completedInThisPage = status.phase === "completed" && updateStartedAtRef.current > 0 && Number(status.completedAt || 0) >= updateStartedAtRef.current;
							setUpdateStatus(status.phase === "completed" && !completedInThisPage ? { ...status, phase: "idle", host: status.host || "cli" } : status);
						}
					} catch (err) {
							if (!stopped && !received) {
								if (isMissingUpdateApiError(err)) setUpdateStatus({ phase: "restart-required", host: "desktop" });
								else { setUpdateStatus({ phase: "failed", host: "cli", error: String(err && err.message || err) }); tavernErrorHub.report("插件更新", err); }
						}
					}
				}
				refreshUpdateStatus();
				const timer = window.setInterval(refreshUpdateStatus, 2500);
				return function () { stopped = true; window.clearInterval(timer); };
			}, []);
			React.useEffect(function () {
				if (updateStatus.phase !== "running" || updateStatus.host === "desktop") return;
				let stopped = false;
				const recovery = updateRecoveryRef.current;
				async function probeRestartedService() {
					try {
						const response = await window.fetch(window.location.origin + "/?tavern-update-probe=" + Date.now(), { cache: "no-store" });
						if (!stopped && response.ok && recovery.sawOffline && !recovery.reloading) {
							recovery.reloading = true;
							window.location.reload();
						}
					} catch (error) {
						if (!stopped) recovery.sawOffline = true;
					}
				}
				probeRestartedService();
				const timer = window.setInterval(probeRestartedService, 400);
				return function () { stopped = true; window.clearInterval(timer); };
			}, [updateStatus.phase, updateStatus.host]);
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
				if (isPlayMode(item.mode)) setRequestMode(compatibilityAvailable && item.requestMode === "sillytavern" ? "sillytavern" : "dsh");
			}, [current, history, compatibilityAvailable]);
			React.useEffect(function () {
				if (!openingPicker || !openingPicker.card) return;
				let stopped = false;
				const cardPath = openingPicker.card.path;
				const userName = String(openingPicker.userName || "你").trim() || "你";
				const timer = window.setTimeout(async function () {
					try {
						const response = await call("getCardOpenings", { path: cardPath, userName: userName });
						if (stopped) return;
						setOpeningPicker(function (current) {
							if (!current || current.card.path !== cardPath || (String(current.userName || "你").trim() || "你") !== userName) return current;
							const openings = response.openings || [];
							const selected = current.openings && current.openings[current.index];
							const selectedIndex = selected ? openings.findIndex(function (item) { return item.id === selected.id; }) : -1;
							return Object.assign({}, current, { openings: openings, index: selectedIndex >= 0 ? selectedIndex : 0 });
						});
					} catch (err) { if (!stopped) setError(String(err && err.message || err)); }
				}, 250);
				return function () { stopped = true; window.clearTimeout(timer); };
			}, [openingPicker && openingPicker.card && openingPicker.card.path, openingPicker && openingPicker.userName]);
			React.useEffect(function () {
				if (!readyTavernSession || typeof props.openStatusTab !== "function") return;
				props.openStatusTab(readyTavernSession);
			}, [readyTavernSession]);
			React.useEffect(function () {
				if (!readyCardSession) return;
				if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(readyCardSession);
				if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(readyCardSession);
				if (typeof props.openWorldBookLibraryTab === "function") props.openWorldBookLibraryTab(readyCardSession);
				if (typeof props.openResourcesTab === "function") props.openResourcesTab(readyCardSession);
			}, [readyCardSession]);
			function openPicker() {
				playPrewarmRef.current.cancel();
				setMenuSession(null);
				setCardEntry("");
				setOpeningPicker(null);
				setError("");
				setPicking(true);
			}
			function closePicker() {
				playPrewarmRef.current.cancel();
				setPicking(false);
				setCardEntry("");
				setOpeningPicker(null);
			}
			async function loadInitialResources(task) {
				let resources = [];
					if (task === "worldbook") {
						const response = await call("listWorldBooks");
						resources = (response.standalone || []).concat(response.embedded || []).map(function (item) {
							return { kind: "worldbook", path: item.kind === "card" ? item.cardPath : item.path, title: item.name, detail: item.kind === "card" ? "人物卡内置 · " + item.cardName : "独立世界书" };
						});
					} else if (task === "preset") {
						const response = await call("listPresets");
						resources = (response.presets || []).map(function (item) { return { kind: "preset", path: item.path, title: item.title, detail: "作为编辑目标引用，不会在当前 Agent 中运行" }; });
					} else {
						const response = await call("listResources");
						resources = (response.resources || []).map(function (item) { return Object.assign({}, item, { kind: "source" }); });
					}
				return resources;
			}
			async function openResourcePicker(task) {
				setBusy(true); setError("");
				try {
					setInitialResources(await loadInitialResources(task));
					setSelectedInitialResources({});
					setCardEntry(task);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importInitialResource(file, task) {
				if (!file || !task) return;
				setBusy(true); setError("");
				try {
					const payload = await parseTextResourceFile(file);
					if (task === "worldbook") await call("importWorldBook", { payload: payload });
					else if (task === "preset") await call("importPreset", { payload: payload });
					else await call("importSource", { payload: payload });
					notifyDataChanged();
					setInitialResources(await loadInitialResources(task));
					setSelectedInitialResources({});
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function toggleInitialResource(item) {
				const key = item.kind + ":" + item.path;
				setSelectedInitialResources(function (current) {
					const next = cardEntry === "script" || cardEntry === "worldbook" || cardEntry === "preset" ? {} : Object.assign({}, current);
					if (next[key]) delete next[key];
					else next[key] = { kind: item.kind, path: item.path, title: item.title };
					return next;
				});
			}
			async function ensureTavernPreset(sessionId) {
				// DSH may reuse a persisted blank Session whose Agent has not been resumed yet.
				// Confirming the preset through the Host restores that Agent before Tavern writes the opening.
				const presetResponse = await props.connection.api.agentPresets.select({ sessionId: sessionId, agentPreset: "tavern" });
				if (!presetResponse.result.ok) throw new Error(presetResponse.result.error && presetResponse.result.error.message ? presetResponse.result.error.message : "无法切换到酒馆模式");
				props.sessions.noteAgentPreset(sessionId, "tavern");
			}
			async function archiveCurrentBlankSession(protectedSessionId) {
				const currentSummary = current ? summaries[current] : null;
				if (!current || !currentSummary || !currentSummary.blank) return;
				if (current === protectedSessionId) return;
				try { await props.workspaces.archiveSession(current); }
				catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) throw archiveError; }
			}
			async function waitForSessionSummary(sessionId) {
				const expiresAt = Date.now() + 8000;
				while (!props.sessions.list.getSnapshot().byId[sessionId] || !props.sessions.binding(sessionId)) {
					if (Date.now() >= expiresAt) throw new Error("DSH Session 列表同步超时，请刷新页面后重试：" + sessionId);
					await new Promise(function (resolve) { window.setTimeout(resolve, 50); });
				}
			}
			function isUnknownSessionSelectError(error) {
				return /sessions\.select: unknown session/i.test(String(error && error.message || error || ""));
			}
			async function openSessionWhenReady(sessionId) {
				try { props.sessions.open(sessionId); }
				catch (error) {
					if (!isUnknownSessionSelectError(error)) throw error;
					if (typeof props.sessions.refresh === "function") await props.sessions.refresh();
					await waitForSessionSummary(sessionId);
					props.sessions.open(sessionId);
				}
			}
			async function finishPendingOpen(pending) {
				await openSessionWhenReady(pending.sessionId);
				setPendingOpen(null);
				setUiMode(groupOfMode(pending.targetMode));
				publishSessionMode(pending.sessionId, pending.targetMode);
				window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: pending.sessionId } }));
				if (pending.targetMode === "card") {
					if (pending.debugSource) await call("attachPlayChatDebug", { targetSessionId: pending.sessionId, sourceSessionId: pending.debugSource.sourceSessionId, turn: pending.debugSource.turn });
					if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(pending.sessionId);
					if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(pending.sessionId);
					if (typeof props.openWorldBookLibraryTab === "function") props.openWorldBookLibraryTab(pending.sessionId);
					if (typeof props.openResourcesTab === "function") props.openResourcesTab(pending.sessionId);
					if (pending.task) await props.injectTaskPrompt(pending.sessionId, pending.task, pending.label, pending.card, (pending.selectedResources || []).length > 0);
					(pending.selectedResources || []).forEach(function (resource) { props.appendMention(pending.sessionId, resource.kind, resource.path, resource.title); });
				} else if (typeof props.openStatusTab === "function") props.openStatusTab(pending.sessionId);
				setOpeningPicker(null); setPicking(false); setCardEntry("");
				await refresh();
			}
			const conversationLifecycle = createConversationLifecycleModule({
				archiveCurrent: archiveCurrentBlankSession,
				resolveWorkspace: async function (request) {
					if (request.kind !== "card") {
						if (!workspaceId) throw new Error("当前没有可用的 Workspace");
						return workspaceId;
					}
					const resourceRoot = await call("getResourceWorkspace");
					const resourceWorkspace = await props.workspaces.create({ path: resourceRoot.path });
					return resourceWorkspace.workspaceId;
				},
				connectWorkspace: function (targetWorkspaceId) { return props.workspaces.connectWorkspace(targetWorkspaceId); },
				waitForSession: waitForSessionSummary,
				ensurePreset: ensureTavernPreset,
				createChat: function (request, sessionId) {
					return call("startChat", {
						path: request.card && request.card.path ? request.card.path : "",
						sessionId: sessionId,
						mode: request.targetMode,
						openingId: request.openingId || "",
						userName: request.userName || "你",
						requestMode: compatibilityAvailable && request.requestMode === "sillytavern" ? "sillytavern" : "dsh"
					});
				},
				rememberPending: setPendingOpen,
				finishOpen: finishPendingOpen
			});
			async function retryPendingOpen() {
				if (!pendingOpen) return;
				setBusy(true); setError("");
				try { await finishPendingOpen(pendingOpen); }
				catch (err) { setError("重新连接 Session 失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function newConversation(card, requestedMode, openingId, userName) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "card");
				const startedAt = Date.now();
				setBusy(true); setError("");
				try {
					const resolvedUserName = String(userName || "你").trim() || "你";
					let preparedSessionId = "";
					try { preparedSessionId = await playPrewarmRef.current.claim(card && card.path); }
					catch (prewarmError) { console.warn("dsh-tavern: 预热 Session 不可用，改为正常创建", prewarmError); }
					await conversationLifecycle.start({ kind: "play", targetMode: targetMode, card: card, openingId: openingId || "", userName: resolvedUserName, requestMode: compatibilityAvailable && requestMode === "sillytavern" ? "sillytavern" : "dsh", preparedSessionId: preparedSessionId });
					if (targetMode !== "card") window.localStorage.setItem("dsh-tavern-player-name", resolvedUserName);
					console.info("dsh-tavern: 开始游戏完成", (Date.now() - startedAt) + "ms", preparedSessionId ? "预热命中" : "即时创建");
				} catch (err) { setError(String(err && err.phase || "创建对话") + "失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function preparePlayConversation(card) {
				setBusy(true); setError("");
				playPrewarmRef.current.begin({ key: card.path, kind: "play" });
				try {
					const userName = window.localStorage.getItem("dsh-tavern-player-name") || "你";
					const response = await call("getCardOpenings", { path: card.path, userName: userName });
					const openings = response.openings || [];
					setOpeningPicker({ card: card, openings: openings, index: 0, userName: userName });
				} catch (err) { playPrewarmRef.current.cancel(); setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importCard(file) {
				setBusy(true); setError("");
				try { const payload = await parseCardFile(file); await call("importCard", { payload: payload }); notifyDataChanged(); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function newCardConversation(card, task, label, selectedResources, debugSource) {
				setBusy(true); setError("");
				try {
					await conversationLifecycle.start({
						kind: "card", targetMode: "card", card: card,
						pending: { task: task, label: label, card: card, selectedResources: selectedResources || [], debugSource: debugSource || null }
					});
				} catch (err) { setError(String(err && err.phase || "创建对话") + "失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			React.useEffect(function () {
				function onDebugPlayChat(event) {
					const detail = event && event.detail ? event.detail : {};
					Promise.resolve().then(async function () {
						const target = await call("getPlayChatDebugTarget", { sessionId: detail.sourceSessionId });
						await newCardConversation(target.card, "debug-play", "调试游玩对话", [], { sourceSessionId: detail.sourceSessionId, turn: detail.turn });
						if (typeof detail.resolve === "function") detail.resolve();
					}).catch(function (error) {
						setError("打开卡片调试失败：" + String(error && error.message || error));
						if (typeof detail.reject === "function") detail.reject(error);
					});
				}
				window.addEventListener("dsh-tavern-debug-play-chat", onDebugPlayChat);
				return function () { window.removeEventListener("dsh-tavern-debug-play-chat", onDebugPlayChat); };
			});
			React.useEffect(function () {
				function onEditPreset(event) {
					const detail = event && event.detail ? event.detail : {};
					if (!detail.path) return;
					newCardConversation(null, "preset", "修改预设", [{ kind: "preset", path: detail.path, title: detail.title || detail.path }]);
				}
				window.addEventListener("dsh-tavern-edit-preset", onEditPreset);
				return function () { window.removeEventListener("dsh-tavern-edit-preset", onEditPreset); };
			});
			function formatTime(ts) {
				if (!ts) return "";
				const d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
			}
			async function switchMode(nextMode) {
				playPrewarmRef.current.cancel();
				setUiMode(nextMode); setPicking(false); setMenuSession(null);
				const first = history.filter(function (item) {
					if (groupOfMode(item.mode) !== nextMode) return false;
					if (nextMode !== "play") return true;
					return (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
				})[0];
				if (first) {
					try { await openSessionWhenReady(first.sessionId); }
					catch (err) { setError("打开 Session 失败：" + String(err && err.message || err)); }
				}
				else if (nextMode === "card") openPicker();
				else openPicker();
			}
			async function switchPlayRequestMode(nextRequestMode) {
				if (!compatibilityAvailable && nextRequestMode === "sillytavern") return;
				playPrewarmRef.current.cancel();
				setUiMode("play"); setPicking(false); setMenuSession(null); setBusy(true); setError("");
				setRequestMode(nextRequestMode);
				window.localStorage.setItem("dsh-tavern-request-mode", nextRequestMode);
				try {
					const target = history.filter(function (item) {
						return isPlayMode(item.mode) && (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === nextRequestMode;
					})[0];
					if (!target) { props.sessions.clear(); openPicker(); return; }
					if (target.sessionId !== current) await openSessionWhenReady(target.sessionId);
				} catch (err) { setError("切换对话列表失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
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
			function isMissingSessionArchiveError(error) {
				const message = String(error && error.message || error || "").toLowerCase();
				return message.indexOf("session-not-found") >= 0 || (message.indexOf("cannot archive session") >= 0 && message.indexOf("no such session") >= 0);
			}
			async function deleteConversation(item, currentTitle) {
				setMenuSession(null);
				if (!window.confirm("确定删除对话“" + (currentTitle || item.cardName + "的新对话") + "”吗？\n删除后将从酒馆历史中移除。")) return;
				setBusy(true); setError("");
				try {
					try { await props.archiveSession(item.sessionId); }
					catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) throw archiveError; }
					await call("deleteChat", { chatId: item.chatId });
					if (current === item.sessionId) {
						const next = history.filter(function (entry) {
							if (entry.sessionId === item.sessionId || groupOfMode(entry.mode) !== uiMode) return false;
							if (uiMode !== "play") return true;
							return (entry.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
						})[0];
						if (next) await openSessionWhenReady(next.sessionId);
						else { props.sessions.clear(); openPicker("cards"); }
					}
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
			async function checkUpdate() {
				if (updateStatus.phase === "checking" || updateStatus.phase === "running") return;
				setUpdateStatus({ ...updateStatus, phase: "checking", host: updateStatus.host || "cli", checkedAt: Date.now(), error: "" });
				try {
					const result = await call("checkUpdate");
					if (result && result.status) setUpdateStatus(result.status);
				} catch (err) {
					setUpdateStatus({ ...updateStatus, phase: "check-failed", host: updateStatus.host || "cli", error: String(err && err.message || err) });
					tavernErrorHub.report("检查更新", err);
				}
			}
			async function performUpdate() {
				if (updateStatus.phase !== "update-available") return;
				if (!window.confirm("更新期间会短暂断开，人物卡、资料和对话数据不会受到影响。\n确定更新到 GitHub 最新版吗？")) return;
				updateStartedAtRef.current = Date.now();
				setUpdateStatus({ ...updateStatus, phase: "running", host: updateStatus.host || "cli", startedAt: updateStartedAtRef.current });
				try {
					const result = await call("startUpdate");
					if (result && result.status) setUpdateStatus(result.status);
				} catch (err) {
					setUpdateStatus({ phase: "failed", host: updateStatus.host || "cli", error: String(err && err.message || err) });
					tavernErrorHub.report("插件更新", err);
				}
			}
			const h = React.createElement;
			if (collapsed) return h(React.Fragment, null,
				h(TavernErrorCenter),
				h("div", { className: "dsh-tavern-sidebar collapsed" },
					h("button", { className: "dsh-tavern-side-icon", title: "展开侧栏", onClick: props.toggleSidebar }, "🍺"),
					h("button", { className: "dsh-tavern-side-icon", title: "新建对话（跟随当前模式）", onClick: function () { props.toggleSidebar(); window.setTimeout(function () { openPicker("cards"); }, 180); } }, "＋")
				)
			);
			const visibleHistory = history.filter(function (item) {
				if (groupOfMode(item.mode) !== uiMode) return false;
				if (uiMode !== "play") return true;
				return (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
			});
			const rows = visibleHistory.map(function (item) {
				const summary = summaries[item.sessionId];
				const title = item.title || (summary && summary.displayTitle ? summary.displayTitle : (item.cardName + "的新对话"));
				return h("div", { key: item.sessionId, className: "dsh-tavern-side-row" + (current === item.sessionId ? " active" : "") },
					h("button", { className: "dsh-tavern-side-row-main", onClick: async function () {
					try {
						if (summary && summary.blank) await call("ensureOpening", { sessionId: item.sessionId });
						await openSessionWhenReady(item.sessionId);
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
			const pickerError = error ? h("div", { className: "dsh-tavern-picker-error", role: "alert" },
				h("div", null, error),
				pendingOpen ? h("button", { className: "dsh-tavern-btn", disabled: busy, style: { marginTop: "8px" }, onClick: retryPendingOpen }, "重新连接已创建的 Session") : null
			) : null;
			const openingChoice = openingPicker ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { playPrewarmRef.current.cancel(); setOpeningPicker(null); } }, "← 返回"), h("span", null, openingPicker.card.name + " · 游戏准备"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: closePicker }, "关闭")),
					selectedOpening && selectedOpening.usesUser ? h(React.Fragment, null,
						h("label", { className: "dsh-tavern-player-name" }, h("span", null, "故事中的玩家称呼（可选）"), h("input", { value: openingPicker.userName || "你", maxLength: 80, autoFocus: true, placeholder: "你", disabled: busy, onChange: function (event) { setOpeningPicker(Object.assign({}, openingPicker, { userName: event.target.value })); } })),
						h("div", { className: "dsh-tavern-player-name-help" }, "可以填写姓名、昵称或身份；不填则使用“你”。开场白预览会随之更新。")
					) : null,
				openingPicker.openings.length > 1 ? h("div", { className: "dsh-tavern-greeting-nav" },
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "上一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index - 1 + openingPicker.openings.length) % openingPicker.openings.length })); } }, "←"),
					h("div", { className: "dsh-tavern-greeting-count" }, (openingPicker.index + 1) + " / " + openingPicker.openings.length),
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "下一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index + 1) % openingPicker.openings.length })); } }, "→")
				) : (openingPicker.openings.length === 0 ? h("div", { className: "dsh-tavern-side-empty" }, "这张人物卡没有开场白，将从空白场景开始。") : null),
				selectedOpening && openingPicker.openings.length > 1 ? h("iframe", {
					className: "dsh-tavern-greeting-preview",
					title: selectedOpening ? openingPicker.card.name + "开场白预览" : "开场白预览",
					sandbox: "allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox",
					referrerPolicy: "no-referrer",
					srcDoc: buildOpeningPreviewDocument(selectedOpening.text)
				}) : null,
				h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || (openingPicker.openings.length > 0 && !selectedOpening), onClick: function () { newConversation(openingPicker.card, null, selectedOpening ? selectedOpening.id : "", openingPicker.userName || "你"); } }, selectedOpening && openingPicker.openings.length > 1 ? "以此开场" : "开始游戏"))
			) : null;
			const playPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": openingPicker ? "游戏准备" : "选择人物卡开始游玩" }, pickerError, openingPicker ? openingChoice : h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "选择人物卡 · 开始游玩"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入人物卡"), h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				cards.length ? h(React.Fragment, null, h("div", { className: "dsh-tavern-side-empty", style: { padding: "4px 6px" } }, "已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。"), cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { preparePlayConversation(card); } }, h("b", null, card.name), h("span", null, card.script ? ("剧本：" + card.script.title + " · " + card.script.chunkCount + " 块") : "自由故事（未绑定剧本）")),
					h("button", { className: "dsh-tavern-script-file", disabled: busy, title: "从人物卡库删除", onClick: function () { if (window.confirm("从人物卡库删除“" + card.name + "”吗？\n人物卡工作版和原版都会删除，已有对话会保留。")) call("deleteCard", { path: card.path }).then(refresh, function (err) { setError(String(err && err.message || err)); }); } }, "删除"),
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
						return h("button", { key: item.kind + ":" + item.path, className: "dsh-tavern-card-pick" + (selected ? " selected" : ""), "aria-pressed": selected ? "true" : "false", disabled: busy, onClick: function () { toggleInitialResource(item); } }, h("b", null, (selected ? "✓ " : "") + item.title), h("span", null, item.detail || (item.chunkCount ? item.chunkCount + " 块" : "可作为人物卡参考资料")));
					}) : h("div", { className: "dsh-tavern-side-empty", style: { padding: "8px" } }, "暂无")
				);
			}
				const initialResourceTitle = cardEntry === "worldbook" ? "世界书" : cardEntry === "preset" ? "预设" : "剧本";
			const initialResourcePicker = initialResources.length ? h(React.Fragment, null,
				initialResourceGroup(initialResourceTitle, initialResources),
				h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || !chosenInitialResources.length, onClick: function () {
						if (cardEntry === "script") newCardConversation(null, "script", "修改剧本", chosenInitialResources);
					else if (cardEntry === "worldbook") newCardConversation(null, "worldbook", "修改世界书", chosenInitialResources);
					else if (cardEntry === "preset") newCardConversation(null, "preset", "修改预设", chosenInitialResources);
						else newCardConversation(null, "extract", "从剧本新建人物卡", chosenInitialResources);
				} }, "用已选 " + chosenInitialResources.length + (cardEntry === "script" || cardEntry === "extract" ? " 份剧本开始" : " 项开始")))
			) : h("div", { className: "dsh-tavern-empty" }, "暂无可选" + initialResourceTitle + "，可点击右上角导入。");
			const initialImportLabel = cardEntry === "worldbook" ? "导入世界书" : cardEntry === "preset" ? "导入预设" : cardEntry === "extract" || cardEntry === "script" ? "导入剧本" : "";
			const initialImportAccept = cardEntry === "worldbook" || cardEntry === "preset" ? ".json,application/json" : ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip";
			const cardPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": "选择卡片工作台起始任务" }, pickerError,
				h("div", { className: "dsh-tavern-card-picker-head" }, cardEntry ? h("button", { className: "dsh-tavern-btn", onClick: function () { setCardEntry(""); } }, "← 返回") : h("span", null, "选择起始任务"), cardEntry === "extract" ? h("span", null, "选择初始剧本（至少 1 份）") : cardEntry === "script" || cardEntry === "worldbook" || cardEntry === "preset" ? h("span", null, "选择一个编辑目标") : null, h("span", { className: "dsh-tavern-spacer" }), cardEntry === "edit" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入人物卡") : null, initialImportLabel ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { initialImportRef.current && initialImportRef.current.click(); } }, initialImportLabel) : null, h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				h("input", { ref: initialImportRef, type: "file", accept: initialImportAccept, style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importInitialResource(f, cardEntry); e.target.value = ""; } }),
					cardEntry === "edit" ? cardEditRows : cardEntry === "extract" || cardEntry === "script" || cardEntry === "worldbook" || cardEntry === "preset" ? initialResourcePicker : h(React.Fragment, null,
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("edit"); } }, h("b", null, "修改人物卡"), h("span", null, "先选择人物卡，再追加修改任务提示词")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("extract"); } }, h("b", null, "从剧本新建人物卡"), h("span", null, "先选择至少一份剧本，再进入工作台")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("script"); } }, h("b", null, "修改剧本"), h("span", null, "先选择一份剧本，再进入工作台修改工作版")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("worldbook"); } }, h("b", null, "修改世界书"), h("span", null, "先选择一本世界书，再进入工作台按条目修改")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("preset"); } }, h("b", null, "修改预设"), h("span", null, "先选择一个预设，交给卡片 Agent 阅读和修改")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(null); } }, h("b", null, "空白开始"), h("span", null, "不追加任务提示词，自由使用完整卡片 Agent"))
				)
			);
			const updateMessage = updateStatus.phase === "checking"
				? "正在检查 GitHub 最新提交；GitHub 不可达时会自动尝试备用源…"
				: updateStatus.phase === "up-to-date"
					? (updateStatus.checkSource === "jsdelivr"
						? "GitHub 不可达；jsDelivr 备用源显示运行代码一致（可能有缓存延迟），无需下载。"
						: "✓ 已是最新构建")
				: updateStatus.phase === "update-available"
					? "发现新构建 " + ((updateStatus.latestCommit || "").slice(0, 7) || updateStatus.latestVersion || "")
				: updateStatus.phase === "running"
				? (updateStatus.checkSource === "jsdelivr" ? "GitHub 不可达，正在尝试通过 jsDelivr 备用源更新运行代码…" : "正在下载并安装，期间页面可能暂时断开… 如果较长时间仍未更新完成，建议重新安装一次；检测到 Git 时只会下载运行所需代码。")
				: updateStatus.phase === "installed-restart-required"
					? (updateStatus.error || "程序文件已更新，但自动重启失败。请手动重启 DSH Tavern。")
				: updateStatus.phase === "restart-required"
					? "请重启 DSH Desktop 以加载新版插件。"
				: updateStatus.phase === "completed"
					? (updateStatus.host === "desktop"
						? "更新完成，请重启 DSH Desktop。"
						: updateStatus.host === "android"
							? "Android 更新完成，3088 服务已重启；如移动端界面未更新，请重启 DSHA。"
							: "更新完成，请刷新页面。")
					: updateStatus.phase === "failed" || updateStatus.phase === "check-failed"
						? (updateStatus.error || "更新失败，请稍后重试。")
						: "尚未检查更新";
			const currentVersionLabel = updateStatus.currentVersion && updateStatus.currentVersion !== "unknown" ? "v" + updateStatus.currentVersion : "版本未知";
			const currentCommitLabel = (updateStatus.currentCommit || "").slice(0, 7) || "构建未知";
			const updateHostLabel = updateStatus.host === "desktop" ? "Desktop 版" : (updateStatus.host === "android" ? "Android 版" : "命令行版");
			const checkingOrRunning = updateStatus.phase === "checking" || updateStatus.phase === "running" || updateStatus.phase === "loading";
			const updateActions = updateStatus.phase === "update-available"
				? h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", onClick: checkUpdate }, "检查更新"),
					h("button", { className: "dsh-tavern-update-button primary", onClick: performUpdate }, "进行更新"))
				: h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", disabled: checkingOrRunning || updateStatus.phase === "restart-required" || updateStatus.phase === "installed-restart-required", onClick: checkUpdate }, updateStatus.phase === "checking" ? "正在检查…" : (updateStatus.phase === "running" ? "正在更新…" : (updateStatus.phase === "installed-restart-required" ? "请手动重启" : (updateStatus.phase === "restart-required" ? "重启 Desktop 后可用" : "检查更新")))));
			return h(React.Fragment, null, h(TavernErrorCenter), h("div", { className: "dsh-tavern-sidebar", style: { position: "relative", width: props.embedded ? "100%" : props.width + "px" } },
				h("div", { className: "dsh-tavern-side-head" }, h("div", { className: "dsh-tavern-side-brand" }, "🍺 DSH Tavern"), props.embedded ? null : h("button", { className: "dsh-tavern-side-icon", title: "收起侧栏", onClick: props.toggleSidebar }, "◧")),
				h("div", { className: "dsh-tavern-mode-switch" + (compatibilityAvailable ? " compatibility-enabled" : "") },
					h("button", { className: uiMode === "play" && requestMode === "dsh" ? "active" : "", disabled: busy, onClick: function () { switchPlayRequestMode("dsh"); } }, "游玩"),
					h("button", { className: uiMode === "card" ? "active" : "", disabled: busy, onClick: function () { switchMode("card"); } }, "卡片"),
					compatibilityAvailable ? h("button", { className: uiMode === "play" && requestMode === "sillytavern" ? "active" : "", disabled: busy, title: "按 SillyTavern 语义构造请求；不运行游玩模式的后台状态结算，候选项可按需手动生成", onClick: function () { switchPlayRequestMode("sillytavern"); } }, "兼容（实验性）") : null
				),
				h("button", { className: "dsh-tavern-side-new", disabled: busy, onClick: function () { openPicker(); } }, uiMode === "play" ? (requestMode === "sillytavern" ? "＋ 选择人物卡 · 新开兼容对话" : "＋ 选择人物卡 · 新开游玩") : "＋ 新建卡片工作台对话"),
				uiMode === "play" && requestMode === "sillytavern" ? h("div", { className: "dsh-tavern-compatibility-notice" },
					h("strong", null, "什么是兼容模式？"),
					h("div", null, "兼容模式会尽可能复刻 SillyTavern（酒馆）的行为，与游玩模式存在很大差异。它会使用预设库中当前选择的整份预设，并遵循预设原有的提示词顺序、启用状态和正则设置。预设库可从右侧面板打开。")
				) : null,
				h("div", { className: "dsh-tavern-side-title" }, uiMode === "play" ? (requestMode === "sillytavern" ? "兼容对话" : "游玩历史") : "卡片历史"),
				h("div", { className: "dsh-tavern-side-list" }, rows.length ? rows : h("div", { className: "dsh-tavern-side-empty" }, uiMode === "play" ? (requestMode === "sillytavern" ? "还没有兼容对话。\n选择人物卡开始；兼容效果可能因预设、模型和供应商而异。" : "还没有游玩对话。\n选择人物卡开始；绑定剧本的卡会按剧本推进。") : "还没有卡片工作台对话。\n可以空白开始，再按需添加人物卡和剧本。")),
				!picking && error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
				h("div", { className: "dsh-tavern-update" },
					h("div", { className: "dsh-tavern-update-identity" }, "DSH Tavern " + currentVersionLabel + " · " + currentCommitLabel + " · " + updateHostLabel),
					updateActions,
					h("div", { className: "dsh-tavern-update-status" + (updateStatus.phase === "failed" || updateStatus.phase === "check-failed" ? " error" : "") }, updateMessage)
				),
				picking ? h("div", { className: "dsh-tavern-picker-overlay", onMouseDown: function (event) { if (event.target === event.currentTarget) closePicker(); } }, uiMode === "play" ? playPicker : cardPicker) : null
			));
		}

		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
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
					openWorldBookLibraryTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:worldbooks" }, { sessionId: sessionId }); },
					openResourcesTab: function (sessionId) { ctx.betterSidebar.openTab({ type: "dsh-tavern:resources" }, { sessionId: sessionId }); },
					appendMention: input.appendMention,
					injectTaskPrompt: input.injectTaskPrompt
				})); }
			)), "dsh-tavern: Tavern workspace browser");
		}
		return Object.freeze({ register: register });
		}
		const tavernShellFeature = createTavernShellFeatureModule();

		function TavernSettingsSection() {
			const [state, setState] = React.useState({ loading: true, busy: false, compatibilityMode: false, trustedCardMode: false, error: "" });
			React.useEffect(function () {
				let active = true;
				rpc("getTavernSettings").then(function (result) {
					if (active) setState({ loading: false, busy: false, compatibilityMode: Boolean(result.settings && result.settings.compatibilityMode), trustedCardMode: Boolean(result.settings && result.settings.trustedCardMode), error: "" });
				}, function (error) {
					if (active) setState({ loading: false, busy: false, compatibilityMode: false, trustedCardMode: false, error: String(error && error.message || error) });
				});
				return function () { active = false; };
			}, []);
			async function setCompatibilityMode(enabled) {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "" }); });
				try {
					const result = await rpc("updateTavernSettings", { patch: { compatibilityMode: enabled } });
					setState({ loading: false, busy: false, compatibilityMode: Boolean(result.settings && result.settings.compatibilityMode), trustedCardMode: Boolean(result.settings && result.settings.trustedCardMode), error: "" });
					window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (error) {
					setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); });
				}
			}
			async function setTrustedCardMode(enabled) {
				if (enabled && !window.confirm("开启受信任人物卡模式？\n\n人物卡 HTML 与 Helper 脚本将能直接访问 DSH Tavern 页面、读取页面内容并以你的浏览器权限发起请求。只对你信任且已检查来源的人物卡开启。")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "" }); });
				try {
					const result = await rpc("updateTavernSettings", { patch: { trustedCardMode: enabled } });
					setState({ loading: false, busy: false, compatibilityMode: Boolean(result.settings && result.settings.compatibilityMode), trustedCardMode: Boolean(result.settings && result.settings.trustedCardMode), error: "" });
					window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (error) {
					setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); });
				}
			}
			return React.createElement("div", { className: "dsh-tavern-settings-section" },
				React.createElement("p", { className: "dsh-tavern-settings-intro" }, "管理 DSH Tavern 的可选实验功能。"),
				React.createElement("div", { className: "dsh-tavern-settings-group" },
					React.createElement("label", { className: "dsh-tavern-settings-row" },
						React.createElement("span", { className: "dsh-tavern-settings-copy" },
							React.createElement("span", { className: "dsh-tavern-settings-title" }, "启用兼容模式（实验性）"),
							React.createElement("span", { className: "dsh-tavern-settings-desc" }, "开启后，侧栏最右侧会显示兼容模式。该模式按 SillyTavern 语义构造请求，不运行游玩模式的后台状态结算；候选项可按需手动生成。兼容效果可能因预设、模型和供应商而异。兼容模式可用于测试外部预设条目的兼容效果，但不保证游戏体验良好。")
						),
						React.createElement("span", { className: "dsh-tavern-settings-switch" },
							React.createElement("input", { type: "checkbox", checked: state.compatibilityMode, disabled: state.loading || state.busy, onChange: function (event) { void setCompatibilityMode(event.target.checked); }, "aria-label": "启用兼容模式（实验性）" }),
							React.createElement("span", { className: "dsh-tavern-settings-track", "aria-hidden": "true" })
						)
					),
					React.createElement("label", { className: "dsh-tavern-settings-row" },
						React.createElement("span", { className: "dsh-tavern-settings-copy" },
							React.createElement("span", { className: "dsh-tavern-settings-title" }, "受信任人物卡模式"),
							React.createElement("span", { className: "dsh-tavern-settings-desc" }, "默认关闭。开启后，人物卡界面与 Helper 脚本可直接访问父页面，以兼容依赖同源 DOM 的旧卡；这也等于允许人物卡代码以当前页面权限运行，请只对可信来源使用。")
						),
						React.createElement("span", { className: "dsh-tavern-settings-switch" },
							React.createElement("input", { type: "checkbox", checked: state.trustedCardMode, disabled: state.loading || state.busy, onChange: function (event) { void setTrustedCardMode(event.target.checked); }, "aria-label": "启用受信任人物卡模式" }),
							React.createElement("span", { className: "dsh-tavern-settings-track", "aria-hidden": "true" })
						)
					)
				),
				state.error ? React.createElement("div", { className: "dsh-tavern-settings-error", role: "alert" }, "保存失败：" + state.error) : null
			);
		}

		function createResourcesLibraryFeatureModule() {
			function TavernResourcesTab(props) {
				const [resources, setResources] = React.useState({ resources: [] });
				const [cards, setCards] = React.useState([]);
				const [selectedCardPaths, setSelectedCardPaths] = React.useState({});
				const [view, setView] = React.useState(null);
				const [openedScript, setOpenedScript] = React.useState(null);
				const [error, setError] = usePersistentError("剧本库");
			const [busy, setBusy] = React.useState(false);
			const sourceInput = React.useRef(null);
			function refresh() {
					return Promise.all([rpc("listResources", {}, props.sessionId), rpc("getSession", { sessionId: props.sessionId }, props.sessionId), rpc("listCards", {}, props.sessionId)]).then(function (all) {
						setResources(all[0] || { resources: [] });
						setView(all[1] && all[1].view ? all[1].view : null);
						setCards(all[2] && all[2].cards || []);
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
				async function openScript(item) {
					setBusy(true); setError("");
					try {
						const result = await rpc("getResource", { path: item.path }, props.sessionId);
						setOpenedScript({ path: item.path, title: item.title, text: result.text || "" });
					} catch (err) { setError(String(err && err.message || err)); }
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
				if (view && view.mode !== "card") return h("div", { className: "dsh-tavern-empty" }, "剧本库只用于卡片工作台。");
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
					if (!window.confirm("删除剧本“" + item.title + "”吗？\n工作版和原版都会删除。")) return;
				setBusy(true); setError("");
				try { await rpc("deleteResource", { path: item.path }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				async function bindScriptToCard(item) {
					const cardPath = selectedCardPaths[item.path] || "";
					if (!cardPath) return;
					setBusy(true); setError("");
					try { await rpc("bindScript", { cardPath: cardPath, path: item.path }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				async function unbindScriptFromCard(item, boundCard) {
					if (!window.confirm("解除剧本《" + item.title + "》与人物卡“" + boundCard.name + "”的绑定吗？")) return;
					setBusy(true); setError("");
					try { await rpc("deleteScript", { cardPath: boundCard.path }, props.sessionId); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); await refresh(); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				function row(kind, item) {
					const path = item.path;
					const label = item.title;
					const boundCard = kind === "source" && Array.isArray(item.boundCards) ? item.boundCards[0] : null;
					const availableCards = cards.filter(function (card) { return card.script == null; });
					const meta = (item.chunkCount ? item.chunkCount + " 块 · " : "") + (boundCard ? "已绑定：" + boundCard.name : "未绑定");
					const on = isMounted(kind, path);
					const name = h("button", { className: "dsh-tavern-resource-name dsh-tavern-resource-open", title: "查看工作版：" + label, onClick: function () { openScript(item); } }, label);
					const binding = boundCard
						? h("div", { className: "dsh-tavern-resource-binding" }, h("span", { className: "dsh-tavern-resource-meta" }, "专属人物卡：" + boundCard.name), h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: function () { unbindScriptFromCard(item, boundCard); } }, "解绑"))
						: h("div", { className: "dsh-tavern-resource-binding" }, h("select", { value: selectedCardPaths[item.path] || "", disabled: busy || !availableCards.length, onChange: function (event) { const cardPath = event.target.value; setSelectedCardPaths(function (current) { return Object.assign({}, current, { [item.path]: cardPath }); }); } }, h("option", { value: "" }, availableCards.length ? "选择未绑定人物卡" : "暂无未绑定人物卡"), availableCards.map(function (card) { return h("option", { key: card.path, value: card.path }, card.name); })), h("button", { className: "dsh-tavern-resource-at", disabled: busy || !selectedCardPaths[item.path], onClick: function () { bindScriptToCard(item); } }, "绑定人物卡"));
					return h("div", { key: path, className: "dsh-tavern-resource-row" },
					name,
					meta ? h("span", { className: "dsh-tavern-resource-meta" }, meta) : null,
					h("button", { className: "dsh-tavern-resource-at", disabled: busy, title: "重命名真实文件", onClick: function () { renameResource(item, label); } }, "重命名"),
						h("button", { className: "dsh-tavern-resource-at", disabled: busy, title: "删除剧本", onClick: function () { deleteResource(item); } }, "删除"),
						h("button", { className: "dsh-tavern-resource-at" + (on ? " mounted" : ""), title: on ? "再次在对话中引用" : "在对话中引用", onClick: function () { props.appendMention(kind, path, label); } }, "在对话中引用"),
						binding
				);
			}
			function group(title, kind, items, actions) {
				return h("section", { className: "dsh-tavern-resource-group" },
					h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length), actions || null),
					items.length ? items.map(function (item) { return row(kind, item); }) : h("div", { className: "dsh-tavern-status-empty" }, "暂无")
				);
			}
				if (openedScript) return h("div", { className: "dsh-tavern-resources" },
					h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: function () { setOpenedScript(null); } }, "← 返回剧本库"), h("div", { className: "dsh-tavern-status-title" }, openedScript.title)),
					error ? h("div", { className: "dsh-tavern-dock-error" }, error) : h("pre", { className: "dsh-tavern-resource-body dsh-tavern-script-preview" }, openedScript.text)
				);
				const sourceActions = h("div", { className: "dsh-tavern-resource-actions" }, h("button", { className: "dsh-tavern-resource-import", disabled: busy, onClick: function () { sourceInput.current && sourceInput.current.click(); } }, "导入剧本"), h("input", { ref: sourceInput, type: "file", accept: ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importSourceResource(file); event.target.value = ""; } }));
				return h("div", { className: "dsh-tavern-resources" },
						h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "剧本库"), h("div", { className: "dsh-tavern-question-sub" }, "查看、修改并绑定人物卡")),
					h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, group("剧本", "source", resources.resources || [], sourceActions))
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:resources",
					title: "剧本库",
				order: 7,
				single: true,
				component: function (props) {
					return React.createElement(TavernResourcesTab, {
						sessionId: props.scope.sessionId,
						appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); },
					});
				}
			}), "dsh-tavern: Better Sidebar resources tab");
		}
		return Object.freeze({ register: register });
		}
		const resourcesLibraryFeature = createResourcesLibraryFeatureModule();


			function createExternalPresetAndBypassPlanFeatureModule() {
			function usePresetCatalog(sessionId, errorSink) {
				const [catalog, setCatalog] = React.useState({ presets: [], activePresetPath: "", activePresetTitle: "", sessionMode: "" });
				function refresh() {
					return Promise.all([rpc("listPresets", {}, sessionId), rpc("getSession", { sessionId: sessionId }, sessionId)]).then(function (all) {
						const result = all[0] || {}; const view = all[1] && all[1].view;
						const next = { presets: result.presets || [], activePresetPath: result.activePresetPath || "", activePresetTitle: result.activePresetTitle || "", sessionMode: view && view.mode || "" };
						setCatalog(next); if (errorSink) errorSink(""); return next;
					}, function (err) { if (errorSink) errorSink(String(err && err.message || err)); return null; });
				}
				React.useEffect(function () {
					refresh(); function onData() { refresh(); }
					window.addEventListener("dsh-tavern-data-changed", onData);
					return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
				}, [sessionId]);
				return [catalog, refresh];
			}

			function ExternalPresetLibraryTab(props) {
				const [error, setError] = usePersistentError("预设库");
				const [catalog, refresh] = usePresetCatalog(props.scope.sessionId, setError);
				const [detailPath, setDetailPath] = React.useState("");
				const [preset, setPreset] = React.useState(null);
				const [entryDrafts, setEntryDrafts] = React.useState({});
				const [regexDrafts, setRegexDrafts] = React.useState({});
				const [busy, setBusy] = React.useState(false);
				const importInput = React.useRef(null);
				const h = React.createElement;
				async function importFile(file) {
					if (!file) return; setBusy(true); setError("");
					try { await rpc("importPreset", { payload: await parseTextResourceFile(file) }, props.scope.sessionId); await refresh(); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function selectPreset(path) {
					setBusy(true); setError("");
					try { await rpc("selectPreset", { path: path }, props.scope.sessionId); await refresh(); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function loadPreset(path) {
					setBusy(true); setError("");
					try { const result = await rpc("getPreset", { path: path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts({}); setRegexDrafts({}); setDetailPath(path); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				function entryValue(entry) { return { name: String(entry.name || ""), role: String(entry.role || "system"), content: String(entry.content || ""), enabled: entry.enabled === true }; }
				function regexValue(script) { return { name: String(script.name || ""), findRegex: String(script.findRegex || ""), replaceString: String(script.replaceString || ""), enabled: script.enabled === true }; }
				function entryDraft(entry) { return Object.assign({}, entryValue(entry), entryDrafts[entry.entryKey] || {}); }
				function regexDraft(script) { return Object.assign({}, regexValue(script), regexDrafts[script.regexKey] || {}); }
				function updateEntryDraft(entry, patch) { setEntryDrafts(function (current) { return Object.assign({}, current, { [entry.entryKey]: Object.assign({}, entryValue(entry), current[entry.entryKey] || {}, patch) }); }); }
				function updateRegexDraft(script, patch) { setRegexDrafts(function (current) { return Object.assign({}, current, { [script.regexKey]: Object.assign({}, regexValue(script), current[script.regexKey] || {}, patch) }); }); }
				async function savePresetEntry(entry) {
					if (!preset) return; setBusy(true); setError("");
					const draft = entryDraft(entry);
					try { await rpc("updatePresetEntry", { path: preset.path, entryKey: entry.entryKey, patch: { name: draft.name, role: draft.role, content: draft.content, enabled: draft.enabled } }, props.scope.sessionId); const result = await rpc("getPreset", { path: preset.path }, props.scope.sessionId); setPreset(result.preset || null); setEntryDrafts(function (current) { const next = Object.assign({}, current); delete next[entry.entryKey]; return next; }); await refresh(); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function savePresetRegex(script) {
					if (!preset) return; setBusy(true); setError("");
					const draft = regexDraft(script);
					try { const result = await rpc("updatePresetRegex", { path: preset.path, regexKey: script.regexKey, patch: { name: draft.name, findRegex: draft.findRegex, replaceString: draft.replaceString, enabled: draft.enabled } }, props.scope.sessionId); setPreset(result.preset || null); setRegexDrafts(function (current) { const next = Object.assign({}, current); delete next[script.regexKey]; return next; }); await refresh(); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); }
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function rename(item) {
					const current = item.path.split("/").pop(); const name = window.prompt("重命名外部预设", current);
					if (name === null || !name.trim() || name.trim() === current) return;
					setBusy(true); setError("");
					try {
						const result = await rpc("renameResource", { path: item.path, name: name.trim() }, props.scope.sessionId);
						if (item.path === catalog.activePresetPath) await rpc("selectPreset", { path: result.resource.path }, props.scope.sessionId);
						await refresh(); if (detailPath === item.path) await loadPreset(result.resource.path); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
					}
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function exportFile(item) {
					setBusy(true); setError("");
					try {
						const result = await rpc("exportPreset", { path: item.path }, props.scope.sessionId);
						const blob = new Blob([result.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
						link.href = url; link.download = result.name || "preset.json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
					} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				async function remove(item) {
					if (!window.confirm("删除外部预设“" + item.title + "”吗？\n工作版和原版都会删除；已有对话保留。")) return;
					setBusy(true); setError("");
					try {
						if (item.path === catalog.activePresetPath) await rpc("selectPreset", { path: "" }, props.scope.sessionId);
						await rpc("deletePreset", { path: item.path }, props.scope.sessionId); setDetailPath(""); setPreset(null); await refresh(); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
					}
					catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
				}
				const inCardMode = catalog.sessionMode === "card";
				function entryRow(entry) {
					const role = String(entry.role || "system").toUpperCase();
					const draft = entryDraft(entry); const editable = entry.marker !== true && entry.edit && entry.edit.promptPath; const dirty = JSON.stringify(draft) !== JSON.stringify(entryValue(entry));
					const state = h("span", { className: "dsh-tavern-prompt-state " + (entry.enabled ? "on" : "off") }, entry.enabled ? "启用" : "停用");
					return h("details", { key: entry.entryKey, className: "dsh-tavern-prompt-row role-" + String(entry.role || "system") },
						h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, role), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, entry.name), h("span", null, String(entry.content || "").replace(/\s+/g, " ").trim() || (entry.marker ? "系统占位" : "空条目"))), state),
						editable ? h("div", { className: "dsh-tavern-prompt-editor" },
							h("label", { className: "dsh-tavern-prompt-editor-field" }, "名称", h("input", { type: "text", value: draft.name, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { name: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field" }, "角色", h("select", { value: draft.role, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { role: event.target.value }); } }, h("option", { value: "system" }, "system"), h("option", { value: "user" }, "user"), h("option", { value: "assistant" }, "assistant"))),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "内容", h("textarea", { value: draft.content, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { content: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-toggle" }, h("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: function (event) { updateEntryDraft(entry, { enabled: event.target.checked }); } }), "启用此条目"),
							h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy || !dirty, onClick: function () { savePresetEntry(entry); } }, "保存此条目")))
						: h("div", null, h("div", { className: "dsh-tavern-extension-note" }, "这是由兼容运行时填充的系统占位，不能在这里编辑。"), h("pre", { className: "dsh-tavern-prompt-content" }, entry.content || "[由运行时提供的占位]")));
				}
				function regexRow(script) {
					const draft = regexDraft(script); const dirty = JSON.stringify(draft) !== JSON.stringify(regexValue(script));
					const state = h("span", { className: "dsh-tavern-prompt-state " + (script.enabled ? "on" : "off") }, script.enabled ? "启用" : "停用");
					return h("details", { key: script.regexKey, className: "dsh-tavern-prompt-row role-regex" },
						h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, script.name), h("span", null, script.findRegex || "空查找规则")), state),
						h("div", { className: "dsh-tavern-prompt-editor" },
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "名称", h("input", { type: "text", value: draft.name, disabled: busy, onChange: function (event) { updateRegexDraft(script, { name: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "查找规则", h("textarea", { value: draft.findRegex, disabled: busy, onChange: function (event) { updateRegexDraft(script, { findRegex: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-field full" }, "替换内容", h("textarea", { value: draft.replaceString, disabled: busy, onChange: function (event) { updateRegexDraft(script, { replaceString: event.target.value }); } })),
							h("label", { className: "dsh-tavern-prompt-editor-toggle" }, h("input", { type: "checkbox", checked: draft.enabled, disabled: busy, onChange: function (event) { updateRegexDraft(script, { enabled: event.target.checked }); } }), "启用此正则"),
							h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy || !dirty, onClick: function () { savePresetRegex(script); } }, "保存此正则"))));
				}
				if (preset && preset.path === detailPath) return h("div", { className: "dsh-tavern-presets" },
					h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setDetailPath(""); setPreset(null); } }, "← 返回预设库"), h("div", { className: "dsh-tavern-status-title" }, preset.title)),
					h("div", { className: "dsh-tavern-preset-detail" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
						h("div", { className: "dsh-tavern-preset-summary" }, h("b", null, "编辑预设提示词和正则"), h("p", null, "点击条目展开编辑，保存后会直接写回预设文件。当前预设仅在兼容模式中生效，下一轮兼容请求会使用修改后的内容。"), h("p", null, "卡片模式中的引用只供 Agent 阅读和编辑，不会运行预设。")),
						h("div", { className: "dsh-tavern-preset-section-title" }, "提示词条目 · " + (preset.entries || []).length), (preset.entries || []).map(entryRow),
						h("div", { className: "dsh-tavern-preset-section-title" }, "正则脚本 · " + (preset.extractableRegexScripts || []).length), (preset.extractableRegexScripts || []).map(regexRow),
						h("div", { className: "dsh-tavern-preset-detail-actions" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { exportFile(preset); } }, "导出"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { rename(preset); } }, "重命名"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { remove(preset); } }, "删除"))));
				return h("div", { className: "dsh-tavern-presets" },
					h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "预设库（实验性）"), h("div", { className: "dsh-tavern-question-sub" }, "选择兼容模式使用的预设，或交给卡片 Agent 编辑"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入外部预设"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importFile(file); event.target.value = ""; } })),
					h("div", { className: "dsh-tavern-preset-list" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
						h("div", { className: "dsh-tavern-preset-summary dsh-tavern-external-preset-notice" },
						h("strong", null, catalog.activePresetPath ? "当前预设：" + catalog.activePresetTitle : "当前未选择预设"),
							h("p", null, "只有兼容模式会使用当前预设。游玩模式和卡片模式不会运行外部预设。"),
							h("p", null, h("strong", null, "开启方法："), "进入“设置 → DSH Tavern”，开启“兼容模式（实验性）”。开启后，侧栏最右侧会显示“兼容（实验性）”。"),
							h("p", null, "修改预设后，下一轮兼容请求直接生效；卡片模式中的引用仅供 Agent 阅读和编辑。")),
					catalog.presets.length ? catalog.presets.map(function (item) { const selected = item.path === catalog.activePresetPath; const runnable = item.valid === true && item.recognized === true; return h("div", { key: item.path, className: "dsh-tavern-preset-row" }, h("div", { className: "dsh-tavern-preset-row-head" }, h("button", { className: "dsh-tavern-preset-row-main", disabled: busy, title: "查看并编辑预设", onClick: function () { loadPreset(item.path); } }, h("b", null, (selected ? "✓ " : "") + item.title), h("span", null, item.promptCount + " 个提示词 · " + item.regexCount + " 条正则")), h("div", { className: "dsh-tavern-preset-row-actions" }, h("button", { className: "dsh-tavern-resource-at" + (selected ? " mounted" : ""), disabled: busy || selected || !runnable, title: runnable ? "在兼容模式中使用整份预设" : "该文件没有可运行的 SillyTavern prompts 结构", onClick: function () { selectPreset(item.path); } }, selected ? "使用中" : runnable ? "使用预设" : "无法使用"), inCardMode ? h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: function () { props.appendMention("preset", item.path, item.title); } }, "在对话中引用") : null))); }) : h("div", { className: "dsh-tavern-status-empty" }, "还没有外部预设。请先导入。")));
			}

			function register(input) {
				const ctx = input.ctx;
				const appendMention = input.appendMention;
				return ctx.effect(function () {
					const dispose = ctx.betterSidebar.registerTab({ id: "dsh-tavern:presets", title: "预设库（实验性）", order: 4, single: true, component: function (props) { return React.createElement(ExternalPresetLibraryTab, { scope: props.scope, appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); } }); } });
					return function () { if (typeof dispose === "function") dispose(); };
				}, "dsh-tavern: preset library");
			}
			return Object.freeze({ register: register });
			}
			const presetLibraryFeature = createExternalPresetAndBypassPlanFeatureModule();

		function createWorldBookLibraryFeatureModule() {
		function WorldBookEditor(props) {
			const initial = props.record && props.record.view ? props.record.view : { displayName: "", description: "", entries: [], diagnostics: [] };
			const [draft, setDraft] = React.useState(function () { return JSON.parse(JSON.stringify(initial)); });
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("世界书编辑");
			React.useEffect(function () { setDraft(JSON.parse(JSON.stringify(initial))); }, [props.record]);
			const h = React.createElement;
			function updateEntry(index, patch) {
				const entries = (draft.entries || []).slice();
				entries[index] = Object.assign({}, entries[index], patch);
				setDraft(Object.assign({}, draft, { entries: entries }));
			}
			function addEntry() {
				const entries = (draft.entries || []).concat([{
					ref: "new:" + Date.now() + ":" + Math.random(), comment: "新条目", title: "新条目", content: "", enabled: true,
					primaryKeys: [], secondaryKeys: [], constant: false, selective: false, selectiveLogic: 0, order: 100,
					position: initial.format === "sillytavern-worldbook" ? 0 : "after_char", depth: 4, role: 0,
					probabilityEnabled: true, probability: 100, caseSensitive: false, matchWholeWords: false,
				}]);
				setDraft(Object.assign({}, draft, { entries: entries }));
			}
			function removeEntry(index) {
				const entry = (draft.entries || [])[index];
				const title = entry && (entry.comment || entry.title) || "未命名条目";
				if (!window.confirm("删除世界书条目“" + title + "”？\n保存世界书后才会正式删除。")) return;
				setDraft(Object.assign({}, draft, { entries: (draft.entries || []).filter(function (_entry, itemIndex) { return itemIndex !== index; }) }));
			}
			function entryPatch(entry) {
				return {
					comment: entry.comment, content: entry.content, enabled: entry.enabled, primaryKeys: entry.primaryKeys,
					secondaryKeys: entry.secondaryKeys, constant: entry.constant, selective: entry.selective,
					selectiveLogic: entry.selectiveLogic, vectorized: entry.vectorized, order: entry.order,
					displayIndex: entry.displayIndex, position: entry.position, depth: entry.depth, role: entry.role,
					probabilityEnabled: entry.probabilityEnabled, probability: entry.probability, scanDepth: entry.scanDepth,
					caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords,
					excludeRecursion: entry.excludeRecursion, preventRecursion: entry.preventRecursion, group: entry.group,
				};
			}
			async function save() {
				setBusy(true); setError("");
				try {
					const before = new Map((initial.entries || []).map(function (entry) { return [entry.ref, entry]; }));
					const after = new Map((draft.entries || []).filter(function (entry) { return !String(entry.ref).startsWith("new:"); }).map(function (entry) { return [entry.ref, entry]; }));
					const operations = [];
					before.forEach(function (_entry, ref) { if (!after.has(ref)) operations.push({ op: "delete", ref: ref }); });
					(draft.entries || []).forEach(function (entry) {
						const patch = entryPatch(entry);
						if (String(entry.ref).startsWith("new:")) operations.push({ op: "add", entry: patch });
						else if (JSON.stringify(patch) !== JSON.stringify(entryPatch(before.get(entry.ref)))) operations.push({ op: "update", ref: entry.ref, patch: patch });
					});
					const update = { operations: operations };
					if (draft.displayName !== initial.displayName) update.name = draft.displayName;
					if (draft.description !== initial.description) update.description = draft.description;
					const result = await rpc("updateWorldBook", { source: props.record.source, update: update }, props.sessionId);
					props.onSaved(result); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function textList(value) { return (value || []).join(", "); }
			function parseList(value) { return String(value || "").split(/[,，\n]/).map(function (item) { return item.trim(); }).filter(Boolean); }
			function numeric(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
			function entryRow(entry, index) {
				return h("details", { key: entry.ref, className: "dsh-tavern-worldbook-entry", defaultOpen: String(entry.ref).startsWith("new:") },
					h("summary", { className: "dsh-tavern-worldbook-entry-head" }, entry.comment || entry.title || "未命名条目"),
					h("div", { className: "dsh-tavern-worldbook-entry-body" },
						h("div", { className: "dsh-tavern-worldbook-entry-actions" },
							h("button", { className: "dsh-tavern-worldbook-kind", onClick: function () { updateEntry(index, { constant: !entry.constant }); } }, entry.constant ? "常驻" : "非常驻")
						),
						h("div", { className: "dsh-tavern-card-field" }, h("label", null, "标题 / 备注"), h("input", { value: entry.comment || "", onChange: function (event) { updateEntry(index, { comment: event.target.value, title: event.target.value }); } })),
						entry.constant ? null : h("div", { className: "dsh-tavern-card-field" }, h("label", null, "主触发词"), h("input", { value: textList(entry.primaryKeys), placeholder: "逗号分隔；支持 /pattern/flags", onChange: function (event) { updateEntry(index, { primaryKeys: parseList(event.target.value) }); } })),
						h("div", { className: "dsh-tavern-card-field" }, h("label", null, "内容"), h("textarea", { className: "large", value: entry.content || "", onChange: function (event) { updateEntry(index, { content: event.target.value }); } })),
						h("details", null, h("summary", null, "兼容字段"),
							entry.constant ? null : h("div", { className: "dsh-tavern-card-field" }, h("label", null, "二级触发词"), h("input", { value: textList(entry.secondaryKeys), placeholder: "逗号分隔", onChange: function (event) { updateEntry(index, { secondaryKeys: parseList(event.target.value) }); } })),
							h("div", { className: "dsh-tavern-worldbook-checks" },
							h("label", null, h("input", { type: "checkbox", checked: entry.enabled !== false, onChange: function (event) { updateEntry(index, { enabled: event.target.checked }); } }), "启用"),
							h("label", null, h("input", { type: "checkbox", checked: entry.selective === true, onChange: function (event) { updateEntry(index, { selective: event.target.checked }); } }), "使用二级条件"),
							h("label", null, h("input", { type: "checkbox", checked: entry.caseSensitive === true, onChange: function (event) { updateEntry(index, { caseSensitive: event.target.checked }); } }), "区分大小写"),
							h("label", null, h("input", { type: "checkbox", checked: entry.matchWholeWords === true, onChange: function (event) { updateEntry(index, { matchWholeWords: event.target.checked }); } }), "整词匹配")
						),
						h("div", { className: "dsh-tavern-worldbook-grid" },
							h("label", null, "排序", h("input", { type: "number", value: entry.order, onChange: function (event) { updateEntry(index, { order: numeric(event.target.value, 100) }); } })),
							h("label", null, "展示顺序", h("input", { type: "number", value: entry.displayIndex, onChange: function (event) { updateEntry(index, { displayIndex: numeric(event.target.value, index) }); } })),
							h("label", null, "注入位置", h("input", { value: entry.position, onChange: function (event) { updateEntry(index, { position: initial.format === "sillytavern-worldbook" ? numeric(event.target.value, 0) : event.target.value }); } })),
							h("label", null, "深度", h("input", { type: "number", value: entry.depth, onChange: function (event) { updateEntry(index, { depth: numeric(event.target.value, 4) }); } })),
							h("label", null, "概率 %", h("input", { type: "number", min: 0, max: 100, value: entry.probability, onChange: function (event) { updateEntry(index, { probability: numeric(event.target.value, 100) }); } })),
							h("label", null, "包含组", h("input", { value: entry.group || "", onChange: function (event) { updateEntry(index, { group: event.target.value }); } }))
						),
						h("div", { className: "dsh-tavern-worldbook-checks" },
							h("label", null, h("input", { type: "checkbox", checked: entry.probabilityEnabled !== false, onChange: function (event) { updateEntry(index, { probabilityEnabled: event.target.checked }); } }), "启用概率"),
							h("label", null, h("input", { type: "checkbox", checked: entry.vectorized === true, onChange: function (event) { updateEntry(index, { vectorized: event.target.checked }); } }), "向量候选"),
							h("label", null, h("input", { type: "checkbox", checked: entry.excludeRecursion === true, onChange: function (event) { updateEntry(index, { excludeRecursion: event.target.checked }); } }), "不被递归触发"),
							h("label", null, h("input", { type: "checkbox", checked: entry.preventRecursion === true, onChange: function (event) { updateEntry(index, { preventRecursion: event.target.checked }); } }), "不触发递归")
						)
						),
						h("div", { className: "dsh-tavern-worldbook-danger-zone" },
							h("button", { className: "dsh-tavern-worldbook-del", onClick: function () { removeEntry(index); } }, "删除条目")
						)
					)
				);
			}
			return h("div", { className: "dsh-tavern-library" },
				h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: props.onBack }, "← 返回世界书库"), h("div", { className: "dsh-tavern-status-title" }, draft.displayName || "未命名世界书"), h("div", { className: "dsh-tavern-question-sub" }, props.record.source.kind === "card" ? "人物卡内置 · " + props.record.source.cardName : "独立世界书"), props.actions),
				h("div", { className: "dsh-tavern-worldbook-editor" },
					props.bindingPanel,
					h("div", { className: "dsh-tavern-card-field" }, h("label", null, "世界书名称"), h("input", { value: draft.displayName || "", onChange: function (event) { setDraft(Object.assign({}, draft, { displayName: event.target.value })); } })),
					h("div", { className: "dsh-tavern-card-field" }, h("label", null, "说明"), h("textarea", { value: draft.description || "", onChange: function (event) { setDraft(Object.assign({}, draft, { description: event.target.value })); } })),
					h("div", { className: "dsh-tavern-worldbook-summary" }, draft.entries.length + " 个条目 · " + draft.entries.filter(function (entry) { return entry.enabled !== false; }).length + " 个启用。未知字段与 extensions 会原样保留；尚未实现的酒馆运行语义不会在这里伪装成已支持。"),
					(initial.diagnostics || []).map(function (item, index) { return h("div", { key: index, className: "dsh-tavern-dock-error" }, item.message); }),
					h("div", { className: "dsh-tavern-worldbook-head" }, h("span", { className: "dsh-tavern-worldbook-title" }, "条目"), h("button", { className: "dsh-tavern-worldbook-add", onClick: addEntry }, "＋ 新增条目")),
					(draft.entries || []).length ? draft.entries.map(entryRow) : h("div", { className: "dsh-tavern-worldbook-empty" }, "暂无条目"),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-worldbook-editor-actions" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存世界书"))
				)
			);
		}

		function WorldBookLibraryTab(props) {
			const [catalog, setCatalog] = React.useState(null);
			const [record, setRecord] = React.useState(null);
			const [associations, setAssociations] = React.useState(null);
			const [selectedCardPath, setSelectedCardPath] = React.useState("");
			const [loading, setLoading] = React.useState(true);
			const [recordLoading, setRecordLoading] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [bindingBusy, setBindingBusy] = React.useState(false);
			const [error, setError] = usePersistentError("世界书库");
			const importInput = React.useRef(null);
			const requestedSource = props.tab && props.tab.meta && props.tab.meta.worldBookSource ? props.tab.meta.worldBookSource : null;
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const h = React.createElement;
			function refresh() {
				setLoading(true); setError("");
				return rpcWithTimeout("listWorldBooks", {}, props.scope.sessionId).then(function (result) {
					setCatalog(result || { standalone: [], embedded: [] }); return result;
				}, function (err) { setError(String(err && err.message || err)); }).finally(function () { setLoading(false); });
			}
			function load(source) {
				if (!source) { setRecord(null); setAssociations(null); setSelectedCardPath(""); return Promise.resolve(); }
				setRecordLoading(true); setError("");
				return Promise.all([
					rpcWithTimeout("getWorldBook", { source: source }, props.scope.sessionId),
					rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId)
				]).then(function (results) {
					const relations = results[1] && results[1].associations ? results[1].associations : { cards: [], boundCards: [], conflict: false };
					setRecord(results[0]); setAssociations(relations);
					setSelectedCardPath(relations.boundCards && relations.boundCards[0] ? relations.boundCards[0].path : relations.cards && relations.cards[0] ? relations.cards[0].path : "");
				}, function (err) {
					setRecord(null); setAssociations(null); setSelectedCardPath(""); setError(String(err && err.message || err));
				}).finally(function () { setRecordLoading(false); });
			}
			function reloadAssociations(source) {
				return rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId).then(function (result) {
					const relations = result && result.associations ? result.associations : { cards: [], boundCards: [], conflict: false };
					setAssociations(relations);
					setSelectedCardPath(relations.boundCards && relations.boundCards[0] ? relations.boundCards[0].path : relations.cards && relations.cards[0] ? relations.cards[0].path : "");
					return relations;
				});
			}
			React.useEffect(function () {
				refresh();
				function onData() { refresh(); }
				function onActivate() { refresh(); }
				function onVisibility() { if (document.visibilityState === "visible") refresh(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				window.addEventListener("focus", onActivate);
				document.addEventListener("visibilitychange", onVisibility);
				return function () {
					window.removeEventListener("dsh-tavern-data-changed", onData);
					window.removeEventListener("focus", onActivate);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);
			React.useEffect(function () { if (requestedSource) load(requestedSource); }, [JSON.stringify(requestedSource)]);
			function clear() { setRecord(null); setAssociations(null); setSelectedCardPath(""); props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null }); }
			async function importFile(file) { if (!file) return; setBusy(true); setError(""); try { const result = await rpc("importWorldBook", { payload: await parseTextResourceFile(file) }, props.scope.sessionId); await refresh(); await load({ kind: "standalone", path: result.worldBook.path }); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function rename() { if (!record || record.source.kind !== "standalone") return; const current = record.source.path.split("/").pop(); const name = window.prompt("重命名世界书文件", current); if (name === null || !name.trim() || name.trim() === current) return; setBusy(true); try { const result = await rpc("renameResource", { path: record.source.path, name: name.trim() }, props.scope.sessionId); await refresh(); await load({ kind: "standalone", path: result.resource.path }); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function remove() { if (!record || record.source.kind !== "standalone" || !window.confirm("删除世界书“" + record.view.displayName + "”吗？\n工作版和原版都会删除。")) return; setBusy(true); try { await rpc("deleteWorldBook", { path: record.source.path }, props.scope.sessionId); clear(); await refresh(); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed")); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function exportFile() { if (!record) return; try { const result = await rpc("exportWorldBook", { source: record.source }, props.scope.sessionId); const item = result.worldBook; const blob = new Blob([JSON.stringify(item.document, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = (item.name || "世界书") + ".json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); } catch (err) { setError(String(err && err.message || err)); } }
			async function bindCard() {
				if (!record || !selectedCardPath || !associations) return;
				const target = (associations.cards || []).find(function (card) { return card.path === selectedCardPath; });
				if (!target) return;
				if (target.binding && target.binding.kind !== "none" && !target.bound) {
					const oldName = target.binding.name || (target.binding.kind === "embedded" ? "人物卡自带世界书" : "原世界书");
					if (!window.confirm("人物卡“" + target.name + "”当前绑定“" + oldName + "”。\n要替换为当前世界书吗？")) return;
				}
				setBindingBusy(true); setError("");
				try {
					await rpc("bindWorldBook", { cardPath: selectedCardPath, source: record.source }, props.scope.sessionId);
					await reloadAssociations(record.source); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBindingBusy(false); }
			}
			async function unbindCard(cardPath) {
				if (!record || !cardPath) return;
				setBindingBusy(true); setError("");
				try {
					await rpc("unbindWorldBook", { cardPath: cardPath }, props.scope.sessionId);
					await reloadAssociations(record.source); window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBindingBusy(false); }
			}
			function bindingPanel() {
				if (!associations) return h("div", { className: "dsh-tavern-worldbook-note" }, "正在读取人物卡绑定关系…");
				const boundCards = associations.boundCards || [];
				const cards = associations.cards || [];
				return h("section", { className: "dsh-tavern-worldbook-note" },
					h("div", { className: "dsh-tavern-worldbook-title" }, "绑定人物卡"),
					associations.conflict ? h("div", { className: "dsh-tavern-dock-error" }, "该世界书已经绑定人物卡：" + boundCards.map(function (card) { return card.name; }).join("、") + "。这是旧数据冲突，请逐一解绑后重新绑定。") : null,
					boundCards.length ? boundCards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-script-row" }, h("span", null, "当前绑定：" + (card.name || card.path)), h("button", { className: "dsh-tavern-btn", disabled: bindingBusy, onClick: function () { unbindCard(card.path); } }, bindingBusy ? "处理中…" : "解绑")); }) : h("div", { className: "dsh-tavern-question-sub" }, "尚未绑定人物卡。"),
					boundCards.length ? null : cards.length ? h("div", { className: "dsh-tavern-script-row" },
						h("select", { value: selectedCardPath, disabled: bindingBusy, onChange: function (event) { setSelectedCardPath(event.target.value); } }, cards.map(function (card) { const suffix = card.binding && card.binding.kind !== "none" ? "（将替换：" + (card.binding.name || "人物卡自带世界书") + "）" : ""; return h("option", { key: card.path, value: card.path }, (card.name || card.path) + suffix); })),
						h("button", { className: "dsh-card-primary", disabled: bindingBusy || !selectedCardPath, onClick: bindCard }, bindingBusy ? "绑定中…" : "绑定人物卡")
					) : h("div", { className: "dsh-tavern-question-sub" }, "暂无可绑定的人物卡。")
				);
			}
			if (recordLoading) return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-empty" }, "正在读取世界书…"));
			if (record) {
				const actions = h("div", { className: "dsh-tavern-library-head-actions" }, h("button", { className: "dsh-tavern-btn", onClick: exportFile }, "导出"), record.source.kind === "standalone" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: rename }, "重命名文件") : null, record.source.kind === "standalone" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: remove }, "删除") : null);
				return h(WorldBookEditor, { record: record, sessionId: props.scope.sessionId, onBack: clear, actions: actions, bindingPanel: bindingPanel(), onSaved: function (result) { setRecord(result); refresh(); } });
			}
			function row(item) { const source = item.kind === "card" ? { kind: "card", cardPath: item.cardPath } : { kind: "standalone", path: item.path }; const resourcePath = item.kind === "card" ? item.cardPath : item.path; return h("div", { key: resourcePath, className: "dsh-tavern-card-pick-wrap" }, h("button", { className: "dsh-tavern-library-card", onClick: function () { load(source); } }, h("b", null, item.name), h("span", null, item.entryCount + " 条 · " + item.enabledCount + " 条启用" + (item.diagnostics ? " · " + item.diagnostics + " 个诊断" : "")), item.cardName ? h("span", null, "来自人物卡：" + item.cardName) : null), sessionMode === "card" ? h("button", { className: "dsh-tavern-resource-at", title: "在对话中引用", onClick: function () { props.appendMention("worldbook", resourcePath, item.name); } }, "在对话中引用") : null); }
			function group(title, items) { return h("section", { className: "dsh-tavern-resource-group" }, h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length)), items.length ? items.map(row) : h("div", { className: "dsh-tavern-status-empty" }, "暂无")); }
			return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "世界书库"), h("div", { className: "dsh-tavern-question-sub" }, "独立世界书与人物卡内置世界书共用编辑界面"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入世界书"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importFile(file); event.target.value = ""; } })), h("div", { className: "dsh-tavern-resource-body" },
				h("div", { className: "dsh-tavern-worldbook-note" }, "常驻条目随人物卡进入稳定前缀；非常驻条目按关键词确定性匹配，每轮最多注入 3 条，实际注入后冷却 10 个剧情回合。世界书不再调用后台 Agent。尚未支持的酒馆字段仍会原样保留。"),
				loading && !catalog ? h("div", { className: "dsh-tavern-empty" }, "正在读取世界书…") : null,
				error ? h("div", { className: "dsh-tavern-dock-error" }, error, h("button", { className: "dsh-tavern-btn", onClick: refresh }, "重新读取")) : null,
				catalog ? group("独立世界书", catalog.standalone || []) : null,
				catalog ? group("人物卡内置世界书", catalog.embedded || []) : null));
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:worldbooks",
				title: "世界书库",
				order: 6,
				single: true,
				component: function (props) { return React.createElement(WorldBookLibraryTab, Object.assign({}, props, { appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); } })); }
			}), "dsh-tavern: Better Sidebar worldbook library tab");
		}
		return Object.freeze({ register: register });
		}
		const worldBookLibraryFeature = createWorldBookLibraryFeatureModule();

		function createCardLibraryFeatureModule() {
		function CardLibraryTab(props) {
			const [cards, setCards] = React.useState([]);
			const [selectedPath, setSelectedPath] = React.useState("");
			const [card, setCard] = React.useState(null);
			const [loading, setLoading] = React.useState(false);
			const [query, setQuery] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("人物卡库");
			const importInput = React.useRef(null);
			const cardRequest = React.useRef(0);
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const requestedPath = props.tab && props.tab.meta && typeof props.tab.meta.cardPath === "string" ? props.tab.meta.cardPath : "";
			function refreshCards() {
				return rpcWithTimeout("listCards", {}).then(function (result) { setCards(result.cards || []); setError(""); return result.cards || []; }, function (err) { setError(String(err && err.message || err)); return []; });
			}
			function loadCard(path) {
				const request = ++cardRequest.current;
				if (!path) { setSelectedPath(""); setCard(null); setLoading(false); return Promise.resolve(); }
				if (path !== selectedPath) setCard(null);
				setSelectedPath(path); setLoading(true); setError("");
				return rpcWithTimeout("getCard", { path: path }).then(function (result) {
					if (request !== cardRequest.current) return;
					const next = result.card || null;
					setCard(function (current) { return JSON.stringify(current) === JSON.stringify(next) ? current : next; });
				}, function (err) {
					if (request !== cardRequest.current) return;
					setError(String(err && err.message || err)); setCard(null);
				}).finally(function () { if (request === cardRequest.current) setLoading(false); });
			}
			React.useEffect(function () {
				refreshCards();
				function onData() {
					refreshCards().then(function (items) {
						if (!selectedPath) return;
						if (!items.some(function (item) { return item.path === selectedPath; })) { setSelectedPath(""); setCard(null); return; }
						loadCard(selectedPath);
					});
				}
				function onActivate() { if (selectedPath) loadCard(selectedPath); else refreshCards(); }
				function onVisibility() { if (document.visibilityState === "visible") onActivate(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				window.addEventListener("focus", onActivate);
				document.addEventListener("visibilitychange", onVisibility);
				return function () {
					window.removeEventListener("dsh-tavern-data-changed", onData);
					window.removeEventListener("focus", onActivate);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, [selectedPath]);
			React.useEffect(function () {
				if (requestedPath && requestedPath !== selectedPath) loadCard(requestedPath);
			}, [requestedPath, selectedPath]);
			function clearCard() {
				cardRequest.current += 1;
				setSelectedPath("");
				setCard(null);
				setLoading(false);
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
				if (!card || !window.confirm("从人物卡库删除“" + card.name + "”吗？\n人物卡工作版和原版都会删除，已有对话会保留。")) return;
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
				if (!card) return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: clearCard }, "← 返回人物卡库")), loading ? h("div", { className: "dsh-tavern-empty" }, "正在读取人物卡…") : error ? h("div", { className: "dsh-tavern-dock-error" }, error, h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")) : h("div", { className: "dsh-tavern-empty" }, "人物卡读取失败", h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")));
				return h(CardFieldsPanel, { view: { card: card }, library: true, busy: busy, onBack: clearCard, onAttach: sessionMode === "card" ? function () { props.appendMention(card.path, card.name); } : null, onOpenWorldBook: props.openWorldBook, onRename: renameCard, onExport: exportCardFile, onDelete: deleteCardFile, onSaved: function (saved) { setCard(Object.assign({}, saved, { path: selectedPath })); refreshCards(); } });
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
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("人物卡详情");
			const [script, setScript] = React.useState(null);
			const [availableResources, setAvailableResources] = React.useState([]);
			const [selectedScriptPath, setSelectedScriptPath] = React.useState("");
			const [scriptBusy, setScriptBusy] = React.useState(false);
			const [scriptError, setScriptError] = usePersistentError("剧本管理");
			const [worldBookBinding, setWorldBookBinding] = React.useState(null);
			const [availableWorldBooks, setAvailableWorldBooks] = React.useState([]);
			const [selectedWorldBook, setSelectedWorldBook] = React.useState("");
			const [worldBookBusy, setWorldBookBusy] = React.useState(false);
			const [worldBookError, setWorldBookError] = usePersistentError("世界书绑定");
			const scriptFileRef = React.useRef(null);
			const cardPath = props.view.card.path;
			function call(method, args) { return rpc(method, args); }
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
			function loadWorldBookBinding() {
				if (!cardPath) return;
				Promise.all([call("getWorldBookBinding", { cardPath: cardPath }), call("listWorldBooks")]).then(function (all) {
					const binding = all[0].binding || { kind: "none", source: null, name: "" };
					setWorldBookBinding(binding);
					setAvailableWorldBooks(all[1].standalone || []);
					setSelectedWorldBook(binding.kind === "embedded" ? "__embedded__" : (binding.kind === "standalone" && binding.source ? binding.source.path : ""));
					setWorldBookError("");
				}, function (err) { setWorldBookError(String(err && err.message || err)); });
			}
			React.useEffect(function () {
				const card = props.view.card;
				setDraft({
					name: card.name || "", tags: (card.tags || []).join(", "), description: card.description || "", personality: card.personality || "", scenario: card.scenario || "",
					first_mes: card.first_mes || "", alternate_greetings: (card.alternate_greetings || []).join("\n---\n"), mes_example: card.mes_example || "", system_prompt: card.system_prompt || "",
					post_history_instructions: card.post_history_instructions || "", creator_notes: card.creator_notes || ""
				});
				loadScript();
				loadWorldBookBinding();
			}, [cardPath, props.view.card]);
			function field(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				setBusy(true); setError("");
				try {
					const next = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean) });
					const source = props.view.card || {};
					const baseline = {
						name: source.name || "", tags: source.tags || [], description: source.description || "", personality: source.personality || "", scenario: source.scenario || "",
						first_mes: source.first_mes || "", alternate_greetings: source.alternate_greetings || [], mes_example: source.mes_example || "", system_prompt: source.system_prompt || "",
						post_history_instructions: source.post_history_instructions || "", creator_notes: source.creator_notes || ""
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
			async function bindSelectedWorldBook() {
				if (!cardPath || !selectedWorldBook) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const source = selectedWorldBook === "__embedded__" ? { kind: "card", cardPath: cardPath } : { kind: "standalone", path: selectedWorldBook };
					const result = await call("bindWorldBook", { cardPath: cardPath, source: source });
					setWorldBookBinding(result.binding || null);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			async function unbindWorldBook() {
				if (!cardPath) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const result = await call("unbindWorldBook", { cardPath: cardPath });
					setWorldBookBinding(result.binding || null); setSelectedWorldBook("");
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			function F(name, label, large) { return React.createElement("div", { className: "dsh-tavern-card-field" }, React.createElement("label", null, label), name === "name" || name === "tags" ? React.createElement("input", { value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } }) : React.createElement("textarea", { className: large ? "large" : "", value: draft[name] || "", onChange: function (e) { field(name, e.target.value); } })); }
			const h = React.createElement;
			const worldBookEntries = props.view.card.character_book && Array.isArray(props.view.card.character_book.entries) ? props.view.card.character_book.entries : [];
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
			const selectableResources = availableResources.filter(function (item) { return !Array.isArray(item.boundCards) || item.boundCards.length === 0 || item.boundCards.some(function (boundCard) { return boundCard.path === cardPath; }); });
			const scriptPanel = h("div", { className: "dsh-tavern-script-row" },
				h("div", { className: "dsh-tavern-script-info" }, script ? h("span", null, h("b", null, "当前剧本："), script.title + " · " + script.chunkCount + " 块 · " + script.sourceChars + " 字") : h("span", null, "未绑定剧本；游玩时按自由故事推进")),
				h("select", { value: selectedScriptPath, disabled: scriptBusy || !selectableResources.length, onChange: function (event) { setSelectedScriptPath(event.target.value); } }, h("option", { value: "" }, "选择已有剧本"), selectableResources.map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); })),
				h("button", { className: script ? "dsh-tavern-script-file" : "dsh-tavern-script-primary", disabled: scriptBusy || !selectedScriptPath || !!(script && script.path === selectedScriptPath), onClick: bindSelectedScript }, script ? "更换绑定" : "绑定"),
				h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
				h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: function () { scriptFileRef.current && scriptFileRef.current.click(); } }, "导入新剧本并绑定"),
				script ? h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: deleteScript }, "解绑") : null
			);
			const scriptHero = h("details", { className: "dsh-tavern-script-hero" },
				h("summary", { className: "dsh-tavern-script-hero-title" }, script ? ("剧本模式 · " + script.title) : "剧本模式 · 未绑定"),
				h("div", { className: "dsh-tavern-script-hero-help" }, "绑定剧本后，新开的游玩对话会自动进入剧本模式。Agent 按剧情进度分段读取当前片段并围绕它续写，每轮完成后推进阅读位置；不会一次载入整本剧本，也不要求玩家照原文行动。更换或解绑会影响所有使用这张人物卡的剧本对话。"),
				scriptPanel,
				scriptError ? h("div", { className: "dsh-card-error" }, scriptError) : null
			);
			const hasWorldBookBinding = Boolean(worldBookBinding && worldBookBinding.kind !== "none");
			const worldBookPanel = h("div", { className: "dsh-tavern-worldbook" },
				h("div", { className: "dsh-tavern-worldbook-note" }, hasWorldBookBinding ? "当前绑定：" + (worldBookBinding.name || "世界书不可用") : "当前未绑定世界书。人物卡有自带世界书时默认绑定自带内容。"),
				h("div", { className: "dsh-tavern-script-row" },
					hasWorldBookBinding ? null : h("select", { value: selectedWorldBook, disabled: worldBookBusy, onChange: function (event) { setSelectedWorldBook(event.target.value); } },
						h("option", { value: "" }, "选择世界书"),
						worldBookEntries.length ? h("option", { value: "__embedded__" }, "人物卡自带世界书") : null,
						availableWorldBooks.map(function (item) { return h("option", { key: item.path, value: item.path }, item.name); })
					),
					hasWorldBookBinding ? null : h("button", { className: "dsh-tavern-script-primary", disabled: worldBookBusy || !selectedWorldBook, onClick: bindSelectedWorldBook }, worldBookBusy ? "处理中…" : "绑定"),
					hasWorldBookBinding ? h("button", { className: "dsh-tavern-script-file", disabled: worldBookBusy, onClick: unbindWorldBook }, "解绑") : null,
					hasWorldBookBinding ? h("button", { className: "dsh-tavern-worldbook-add", disabled: worldBookBusy, onClick: function () { if (typeof props.onOpenWorldBook === "function") props.onOpenWorldBook(worldBookBinding.source); } }, "打开世界书") : null
				),
				worldBookError ? h("div", { className: "dsh-card-error" }, worldBookError) : null
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
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "世界书 · " + worldBookEntries.length + " 条"), worldBookPanel),
					h("details", { className: "dsh-tavern-card-advanced" }, h("summary", null, "扩展内容 · " + extensionCount + " 项"), extensionPanel),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存字段"))
				)
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:cards",
				title: "人物卡库",
				order: 3,
				single: true,
				component: function (props) {
					return React.createElement(CardLibraryTab, Object.assign({}, props, {
						appendMention: function (path, label) { appendMention(props.scope.sessionId, "card", path, label); },
						openWorldBook: function (source) {
							ctx.betterSidebar.openTab({ type: "dsh-tavern:worldbooks" }, { sessionId: props.scope.sessionId });
							ctx.betterSidebar.updateTab("dsh-tavern:worldbooks", { meta: { worldBookSource: source } });
						}
					}));
				}
			}), "dsh-tavern: Better Sidebar card library tab");
		}
		return Object.freeze({ register: register });
		}
		const cardLibraryFeature = createCardLibraryFeatureModule();

		function createPlayControlsFeatureModule() {
			function TavernConversationExportAction(props) {
				const [available, setAvailable] = React.useState(false);
				const [busy, setBusy] = React.useState(false);
				React.useEffect(function () {
					let stopped = false;
					rpc("getSession", {}, props.sessionId).then(function (result) {
						if (!stopped) setAvailable(Boolean(result && result.view));
					}, function () { if (!stopped) setAvailable(false); });
					return function () { stopped = true; };
				}, [props.sessionId]);
				if (!available) return null;
				async function exportText() {
					setBusy(true);
					try {
						const snapshot = props.sessions.list.getSnapshot();
						const summary = snapshot.byId && snapshot.byId[props.sessionId];
						const result = await rpc("exportConversation", { title: summary && summary.displayTitle || "" }, props.sessionId);
						const blob = new Blob(["\uFEFF", result.text], { type: "text/plain;charset=utf-8" });
						const url = URL.createObjectURL(blob);
						const link = document.createElement("a");
						link.href = url; link.download = result.filename || "对话记录.txt";
						document.body.appendChild(link); link.click(); link.remove();
						URL.revokeObjectURL(url);
					} catch (err) { tavernErrorHub.report("导出纯对话", err); }
					finally { setBusy(false); }
				}
				return React.createElement("button", { className: "dsh-tavern-export-action", disabled: busy, title: "导出只包含玩家与角色正文的 TXT", onClick: exportText }, busy ? "导出中…" : "纯对话 TXT ↓");
			}

			function TavernCompactionAction(props) {
				const [busy, setBusy] = React.useState(false);
				const [resultLabel, setResultLabel] = React.useState("");
				const [resultTitle, setResultTitle] = React.useState("");
				const running = props.useSession(function (snapshot) { return snapshot.running; });
				async function executeTarget(sessionId, missingMessage) {
					if (!sessionId) return { status: "skipped", message: missingMessage };
					try {
						const result = await props.executeCompact(sessionId);
						if (!result.ok) throw new Error(result.error && result.error.message ? result.error.message : "无法执行上下文压缩");
						if (result.value === undefined) throw new Error("当前会话不支持 /compact");
						if (result.value.result && result.value.result.kind === "error") throw new Error(result.value.result.text || "上下文压缩失败");
						return { status: "succeeded", message: result.value.result && result.value.result.text || "压缩完成" };
					} catch (error) {
						return { status: "failed", message: String(error && error.message || error) };
					}
				}
				async function compactContext() {
					setBusy(true);
					setResultLabel("");
					setResultTitle("");
					try {
						const prepared = await rpc("prepareCompaction", {}, props.sessionId);
						const plan = prepared.plan;
						const foreground = await executeTarget(plan.foregroundSessionId, "没有前台 Session");
						const background = plan.backgroundSessionId
							? (await rpc("compactBackground", { operationId: plan.operationId }, props.sessionId)).result
							: { status: "skipped", message: "没有后台 Session" };
						const completed = await rpc("completeCompaction", { operationId: plan.operationId, foreground: foreground, background: background }, props.sessionId);
						setResultTitle("前台：" + foreground.message + "；后台：" + background.message);
						if (completed.result.status === "completed") setResultLabel(plan.backgroundSessionId ? "前台和后台已压缩" : "前台已压缩");
						else if (completed.result.status === "partial") {
							setResultLabel("部分成功");
							throw new Error("上下文压缩部分成功。前台：" + foreground.message + "；后台：" + background.message);
						} else throw new Error("上下文压缩失败。前台：" + foreground.message + "；后台：" + background.message);
					} catch (err) { tavernErrorHub.report("压缩上下文", err); }
					finally { setBusy(false); }
				}
				return React.createElement("button", { className: "dsh-tavern-choice-trigger", disabled: busy || running, title: resultTitle || "前台使用剧情提示词、后台使用 DSH 内置提示词并联合压缩", onClick: compactContext }, busy ? "压缩中…" : (resultLabel || "压缩上下文"));
			}

			function TavernPlayerNameAction(props) {
				const [view, setView] = React.useState(null);
				const [busy, setBusy] = React.useState(false);
				React.useEffect(function () {
					let stopped = false;
					rpc("getSession", {}, props.sessionId).then(function (result) {
						if (!stopped) setView(result.view || null);
					}, function () { if (!stopped) setView(null); });
					return function () { stopped = true; };
				}, [props.sessionId]);
				if (!view || view.mode === "card") return null;
				async function renamePlayer() {
					const next = window.prompt("修改故事中的玩家称呼\n仅影响之后生成的内容，不会重写历史消息。", view.playerName || "你");
					if (next === null) return;
					setBusy(true);
					try {
						const result = await rpc("setPlayerName", { userName: next }, props.sessionId);
						setView(Object.assign({}, view, { playerName: result.playerName || "你" }));
						window.localStorage.setItem("dsh-tavern-player-name", result.playerName || "你");
						window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
					} catch (err) { tavernErrorHub.report("玩家称呼", err); }
					finally { setBusy(false); }
				}
				const presetName = view.runtimePreset && view.runtimePreset.name ? view.runtimePreset.name : "无";
				return React.createElement(React.Fragment, null,
					React.createElement("button", { className: "dsh-tavern-player-action", disabled: busy, title: "修改之后内容中的玩家称呼", onClick: renamePlayer }, "玩家：" + (view.playerName || "你")),
					React.createElement("span", { className: "dsh-tavern-preset-status", title: view.runtimePreset && view.runtimePreset.id ? view.runtimePreset.id : "当前没有选择外部预设" }, "当前预设：" + presetName)
				);
			}

			function TavernStatusPanel(props) {
			const [error, setError] = usePersistentError("酒馆状态");
			const [guideDraft, setGuideDraft] = React.useState("");
			const [guideBusy, setGuideBusy] = React.useState(false);
			const [guideError, setGuideError] = usePersistentError("Guide");
			const [debugBusy, setDebugBusy] = React.useState(false);
			const stateKey = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				let latest = "";
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					if (nodes[index].kind === "assistant" && nodes[index].messageId) { latest = nodes[index].messageId; break; }
				}
				return String(snapshot.running) + ":" + latest;
			});
			const liveState = useLiveTavernView(props.sessionId, stateKey);
			const view = liveState.view;
			const loadState = liveState.phase;
			const debugTurns = view && Array.isArray(view.debugTurns) ? view.debugTurns : [];
			const helperDiagnostics = view && Array.isArray(view.tavernHelperScriptDiagnostics) ? view.tavernHelperScriptDiagnostics : [];
			const helperFailures = helperDiagnostics.filter(function (item) { return item && item.status !== "host-owned"; });
			const helperButtons = [];
			for (const script of view && Array.isArray(view.tavernHelperScripts) ? view.tavernHelperScripts : []) {
				for (const button of Array.isArray(script && script.buttons) ? script.buttons : []) {
					if (button && button.visible === true) helperButtons.push({ scriptId: String(script.id || ""), scriptName: String(script.name || script.id || "脚本"), name: String(button.name || "") });
				}
			}
			const latestDebugTurn = Number(debugTurns[0] && debugTurns[0].turn) || 0;
			React.useEffect(function () {
				setError(liveState.error || "");
			}, [liveState.error]);
			async function openDebugger() {
				if (!latestDebugTurn || debugBusy) return;
				setDebugBusy(true);
				try { await openPlayChatDebugWorkspace(props.sessionId, latestDebugTurn); }
				catch (error) { tavernErrorHub.report("交给卡片 Agent 调试", error); }
				finally { setDebugBusy(false); }
			}
			async function addGuide() {
				const text = guideDraft.trim();
				if (!text) return;
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("addGuide", { text: text }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
					setGuideDraft("");
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			async function removeGuide(index) {
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("deleteGuide", { index: index }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			async function triggerHelperButton(button) {
				try {
					if (!tavernHelperScriptRuntime || !tavernHelperRuntimeActive) throw new Error("人物卡脚本正在其他窗口运行，或尚未加载完成");
					await tavernHelperScriptRuntime.triggerButton(button.scriptId, button.name);
				} catch (error) { tavernErrorHub.report("人物卡脚本按钮「" + button.name + "」", error); }
			}
			const h = React.createElement;
			if (!view) return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "状态栏")),
				h("div", { className: "dsh-tavern-status-body" },
					h("div", { className: "dsh-tavern-status-empty" }, loadState === "retrying" ? "正在重新连接酒馆状态…" : (error || (loadState === "loading" ? "正在加载酒馆状态…" : "选择人物卡后，这里会显示持续状态。"))),
					loadState === "retrying" ? h("button", { className: "dsh-tavern-btn", onClick: function () { liveTavernView.invalidate(props.sessionId); } }, "重新加载") : null
				)
			);
			if (view.mode === "card") return null;
			const statusText = view.settleStatus === "running" ? "正在执行后台结算" : (view.settleStatus === "error" ? "后台结算失败" : "后台结算已完成");
			return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" },
					h("div", { className: "dsh-tavern-status-title" }, "酒馆状态"),
					h("div", { className: "dsh-tavern-status-role" }, view.card.name),
					(view.card.tags || []).length ? h("div", { className: "dsh-tavern-status-tags" }, (view.card.tags || []).slice(0, 8).map(function (tag) { return h("span", { key: tag, className: "dsh-tavern-status-tag" }, tag); })) : null,
					h("div", { className: "dsh-tavern-status-settle" }, h("span", { className: "dsh-tavern-status-dot " + (view.settleStatus || "idle") }), statusText)
				),
					h("div", { className: "dsh-tavern-status-body" },
					view.worldBookError ? h("div", { className: "dsh-card-error" }, "世界书召回失败：" + view.worldBookError) : null,
					helperButtons.length ? h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "人物卡脚本按钮"),
						h("div", { className: "dsh-tavern-script-buttons" }, helperButtons.map(function (button) {
							return h("button", { key: button.scriptId + ":" + button.name, className: "dsh-tavern-btn", title: button.scriptName, onClick: function () { triggerHelperButton(button); } }, button.name);
						}))
					) : null,
					(view.presentationWarnings || []).map(function (warning, index) {
						return h("div", { className: "dsh-card-error", key: "presentation-warning-" + index }, warning);
					}),
					helperDiagnostics.length ? h("details", { className: "dsh-tavern-dsh-preset-diagnostics", open: helperFailures.length > 0 },
						h("summary", null, helperFailures.length > 0 ? "人物卡脚本有 " + helperFailures.length + " 项未运行" : "人物卡脚本兼容状态"),
						h("ul", null, helperDiagnostics.map(function (item, index) {
							const name = String(item && (item.name || item.asset) || "脚本");
							const message = String(item && item.message || item && item.status || "未知状态");
							return h("li", { key: name + ":" + index }, name + "：" + message);
						}))
					) : null,
					h("section", { className: "dsh-tavern-status-section" },
						h("div", { className: "dsh-tavern-status-label" }, "正则加载不对？前端美化不对？内容生成不对？"),
						h("div", { className: "dsh-tavern-debug-panel" },
							h("button", { className: "dsh-tavern-debug-open", disabled: debugBusy || !latestDebugTurn, onClick: openDebugger }, debugBusy ? "正在打开卡片 Agent…" : "交给卡片 Agent 调试")
						)
					),
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
		function candidateRequestId() { return "candidate-request-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
		async function submitCandidateTask(sessionId, messageId, guidance) {
			const requestId = candidateRequestId();
			let lastError = null;
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const controller = new AbortController();
				const timer = window.setTimeout(function () { controller.abort(); }, 2000);
				try {
					const result = await rpc("submitTask", { kind: "candidate", requestId: requestId, messageId: messageId, guidance: guidance || "" }, sessionId, { signal: controller.signal });
					const view = coordinationView(result, sessionId);
					tavernCoordination.setView(sessionId, view);
					return view.task;
				} catch (error) {
					lastError = error;
					const message = String(error && error.message || "");
					if (!(error && error.name === "AbortError") && !/failed to fetch|networkerror|signal timed out/i.test(message)) throw error;
				} finally { window.clearTimeout(timer); }
				await new Promise(function (resolve) { window.setTimeout(resolve, 250); });
			}
			tavernCoordination.invalidate(sessionId);
			throw lastError || new Error("持久任务提交失败");
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
		function forgetHiddenTurn(storageKey, sessionId, turn) {
			try {
				const all = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
				const list = Array.isArray(all[sessionId]) ? all[sessionId].filter(function (item) { return Number(item) !== Number(turn); }) : [];
				if (list.length) all[sessionId] = list;
				else delete all[sessionId];
				window.localStorage.setItem(storageKey, JSON.stringify(all));
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
		function showTurnTail(el) {
			if (!el) return;
			el.style.display = "";
			let sib = el.previousElementSibling;
			while (sib) {
				const kind = sib.getAttribute("data-chat-flow-kind");
				if (kind === "user" || kind === "turn-tail") break;
				sib.style.display = "";
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
		function applySuppressedDshTurns(turns) {
			const set = new Set((Array.isArray(turns) ? turns : []).map(String));
			if (set.size === 0) return;
			const tails = document.querySelectorAll('[data-chat-flow-kind="turn-tail"]');
			for (let i = 0; i < tails.length; i++) {
				const tail = tails[i];
				if (!set.has(tailTurnOf(tail))) continue;
				hideTurnTailWithUser(tail);
			}
		}
		async function submitBodyRegeneration(sessionId, panel, guidance) {
			const res = await rpc("regenBody", { guidance: String(guidance || "").trim() }, sessionId);
			const adopted = res.view && res.view.adopted ? res.view.adopted : null;
			if (adopted && Number(adopted.hiddenTurn) > 0) forgetHiddenTurn(HIDDEN_TURNS_KEY, sessionId, Number(adopted.hiddenTurn));
			if (adopted && Number(adopted.syntheticTurn) > 0) forgetHiddenTurn(HIDDEN_REGEN_USER_TURNS_KEY, sessionId, Number(adopted.syntheticTurn));
			showTurnTail(panel.tail);
			applySuppressedDshTurns(res.view && res.view.suppressedDshTurns);
			applyHiddenTurns(sessionId);
			applyHiddenRegenUserTurns(sessionId);
			setCandidatePanel(null);
		}

		function CandidateAction(props) {
			const [busy, setBusy] = React.useState(false);
			const [rolling, setRolling] = React.useState(false);
			const candidatePanelState = useCandidatePanel();
			const regenPanelState = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const frontRunning = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useSession(function (snapshot) {
				const nodes = snapshot.nodes || [];
				for (let index = nodes.length - 1; index >= 0; index -= 1) {
					if (nodes[index].kind === "assistant" && nodes[index].messageId) return nodes[index].messageId;
				}
				return null;
			});
			const rollbackViewState = useLiveTavernView(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activityState = useTavernCoordination(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activity = describeTavernActivity(activityState.view && activityState.view.activity);
			const canRollback = rollbackViewState.view && rollbackViewState.view.canRollback === true;
			const candidateTask = activityState.view && activityState.view.task;
			const taskForMessage = candidateTask && candidateTask.kind === "candidate" && candidateTask.input && String(candidateTask.input.messageId || "") === String(props.messageId || "") ? candidateTask : null;
			const taskBusy = !!(taskForMessage && taskForMessage.busy);
			const regenBusy = regenPanelState !== null && regenPanelState.sessionId === props.sessionId && regenPanelState.phase === "loading";
			const projectedTaskRef = React.useRef("");
			React.useEffect(function () {
				if (!taskForMessage) return;
				const projection = String(taskForMessage.taskId || "") + ":" + String(taskForMessage.version || 0) + ":" + String(taskForMessage.status || "");
				if (projectedTaskRef.current === projection) return;
				projectedTaskRef.current = projection;
				if (taskForMessage.busy) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
					return;
				}
				if (taskForMessage.status === "succeeded" && taskForMessage.result && taskForMessage.result.candidates) {
					setCandidatePanel(readyCandidatePanel(props.sessionId, props.messageId, taskForMessage.result.candidates));
					setCandidateGuidePanel(null);
					return;
				}
				if (taskForMessage.terminal) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(taskForMessage.error || "候选生成未完成") });
				}
			}, [props.sessionId, props.messageId, taskForMessage && taskForMessage.taskId, taskForMessage && taskForMessage.version, taskForMessage && taskForMessage.status]);
			const reconciledActivityRef = React.useRef("");
			React.useEffect(function () {
				if (!activityState.view || activity.busy) return;
				const revision = activity.phase + ":" + String(activityState.view.updatedAt || 0);
				if (reconciledActivityRef.current === revision) return;
				reconciledActivityRef.current = revision;
				liveTavernView.invalidate(props.sessionId);
				if (typeof props.refreshSessions === "function") Promise.resolve(props.refreshSessions()).catch(function () {});
			}, [props.sessionId, props.refreshSessions, activity.phase, activity.busy, activityState.view && activityState.view.updatedAt]);
			async function generate(force, guidance) {
				if (busy || activity.busy) return;
				setBusy(true);
				setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
				try {
					await submitCandidateTask(props.sessionId, props.messageId, guidance);
				} catch (err) { tavernErrorHub.report("候选项生成", err); setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: String(err && err.message || err) }); }
				finally { setBusy(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
			}
			async function rollback() {
				if (rolling) return;
				if (!window.confirm("回退本轮？\n将删除你最近一次输入和这段 LLM 输出，并同步回退故事状态与剧本游标。")) return;
				setRolling(true);
				try {
					const result = await rpc("rollbackTurn", {}, props.sessionId);
					applySuppressedDshTurns(result && result.view && result.view.suppressedDshTurns);
					applyRolledBackTurns(props.sessionId);
					setCandidatePanel(null);
					setRegenPanel(null);
					setCandidateGuidePanel(null);
					liveTavernView.invalidate(props.sessionId);
					tavernCoordination.invalidate(props.sessionId);
					window.dispatchEvent(new CustomEvent("dsh-tavern-data-changed"));
				} catch (err) {
					tavernErrorHub.report("回退本轮", err);
				} finally { setRolling(false); }
			}
			function regenerationPanelFor(event, phase) {
				const tail = event && event.currentTarget ? event.currentTarget.closest('[data-chat-flow-kind="turn-tail"]') : null;
				return { sessionId: props.sessionId, phase: phase, guidance: "", text: "", error: "", tail: tail };
			}
			function openGuidedRegeneration(event) {
				if (regenBusy || rolling) return;
				setCandidatePanel(null);
				setRegenPanel(regenerationPanelFor(event, "input"));
			}
			async function regenerateImmediately(event) {
				if (regenBusy || rolling) return;
				const panel = regenerationPanelFor(event, "loading");
				setCandidatePanel(null);
				setRegenPanel(panel);
				try {
					await submitBodyRegeneration(props.sessionId, panel, "");
					setRegenPanel(null);
				} catch (err) {
					tavernErrorHub.report("正文重新生成", err);
					setRegenPanel(Object.assign({}, panel, { phase: "error", error: String(err && err.message || err) }));
				}
			}
			const h = React.createElement;
			const isScript = sessionMode === "script";
			const hasReadyPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "ready";
			const hasLoadingPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "loading";
			if (!isPlayMode(sessionMode) || latestMessageId !== props.messageId) return null;
			return h(React.Fragment, null,
				h("button", { className: "dsh-tavern-choice-trigger", disabled: busy || rolling || taskBusy || activity.busy || regenBusy, title: activity.busy ? activity.blockReason : (hasReadyPanel ? "重新生成候选项（可先填写意见）" : (isScript ? "手动生成候选项；由于跟随剧本，只有一个推荐候选项" : "手动生成候选项")), onClick: function () {
					setRegenPanel(null);
					if (hasReadyPanel) {
						const previous = candidatePanelState;
						setCandidatePanel(null);
						setCandidateGuidePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "input", error: "", previous: previous });
					} else {
						generate(false);
					}
				} }, activity.busy ? activity.label : ((busy || taskBusy) ? "生成中…" : (hasReadyPanel ? "重新生成候选项" : "生成候选项"))),
				h("button", { className: "dsh-tavern-choice-trigger", disabled: regenBusy || rolling, title: "不填写意见，立即重新生成正文", onClick: regenerateImmediately }, regenBusy ? "重生成中…" : "一键重新生成正文"),
				h("button", { className: "dsh-tavern-choice-trigger", disabled: regenBusy || rolling, title: "填写指导意见后重新生成正文", onClick: openGuidedRegeneration }, "带意见重新生成正文"),
				canRollback ? h("button", { className: "dsh-tavern-choice-trigger", disabled: rolling, title: "删除最近一次用户输入和这段 LLM 输出", onClick: rollback }, rolling ? "回退中…" : "回退本轮") : null
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
			const h = React.createElement;
			if (!sessionMode) return null;
			return h("div", { className: "dsh-tavern-dock-actions" },
				isPlayMode(sessionMode) && latestMessageId ? React.createElement(CandidateAction, Object.assign({}, props, { messageId: latestMessageId })) : null,
				React.createElement(TavernCompactionAction, props)
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
			const suppressionState = useLiveTavernView(props.sessionId, "suppression:" + String(latestMessageId || "") + ":" + String(running));
			const suppressedDshTurns = suppressionState.view && Array.isArray(suppressionState.view.suppressedDshTurns) ? suppressionState.view.suppressedDshTurns : [];
			const suppressedDshTurnsRevision = suppressedDshTurns.join(",");
			const [selected, setSelected] = React.useState(-1);
			const [expanded, setExpanded] = React.useState(false);
			React.useEffect(function () {
				setSelected(sessionMode === "script" && panel && Array.isArray(panel.choices) && panel.choices.length === 1 ? 0 : -1);
				setExpanded(panel !== null && panel.phase === "error");
			}, [panel, sessionMode]);
			React.useEffect(function () {
				let frame = null;
				function applyProjectionState() {
					frame = null;
					applySuppressedDshTurns(suppressedDshTurns);
					applyHiddenTurns(props.sessionId);
					applyRolledBackTurns(props.sessionId);
					applyHiddenRegenUserTurns(props.sessionId);
				}
				function scheduleProjection() {
					if (frame === null) frame = window.requestAnimationFrame(applyProjectionState);
				}
				scheduleProjection();
				const observer = new window.MutationObserver(scheduleProjection);
				observer.observe(document.body, { childList: true, subtree: true });
				return function () { observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame); };
			}, [props.sessionId, latestMessageId, running, suppressedDshTurnsRevision]);
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
			return h("div", { className: "dsh-tavern-question dsh-tavern-candidate-question" + (expanded ? "" : " collapsed") },
				h("div", { className: "dsh-tavern-question-head", onClick: function () { setExpanded(!expanded); } }, h("span", null, heading), h("span", { className: "dsh-tavern-question-sub" }, summary), h("button", { className: "dsh-tavern-question-close", title: expanded ? "收起" : "展开", onClick: function (event) { event.stopPropagation(); setExpanded(!expanded); } }, expanded ? "⌃" : "⌄")),
				expanded && panel.phase === "loading" ? h("div", { className: "dsh-tavern-question-sub" }, "正在生成候选项…") : null,
				expanded && panel.error ? h("div", { className: "dsh-tavern-choice-error" }, "候选项生成失败，请点回复下方的“生成候选项”重试") : null,
				expanded ? h("div", { className: "dsh-tavern-question-body" }, (panel.choices || []).map(function (choice, index) {
					const item = choice !== null && typeof choice === "object" ? choice : { type: "action", text: String(choice) };
					const label = item.type === "scene" ? "场景变化" : "人物行为";
					return h("button", { key: index, className: "dsh-tavern-question-option" + (selected === index ? " selected" : ""), onClick: function () { setSelected(index); } },
						h("span", { className: "dsh-tavern-question-radio" }),
						h("span", { className: "dsh-tavern-question-text" },
							h("span", { className: "dsh-tavern-question-tag dsh-tavern-question-tag-" + item.type }, label),
							h("span", null, item.text)
						)
					);
				})) : null,
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
						tavernErrorHub.report("后台 Agent 轨迹", "无法打开后台 Agent 轨迹：" + String(err && err.message || err));
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
					setCandidatePanel({ sessionId: props.sessionId, messageId: messageId, phase: "loading", choices: [], error: "" });
					await submitCandidateTask(props.sessionId, messageId, guide);
					setCandidateGuidePanel(null);
				} catch (err) {
					tavernErrorHub.report("候选项重新生成", err);
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
			async function generate() {
				const guide = guidance.trim();
				setRegenPanel(Object.assign({}, panel, { phase: "loading", error: "" }));
				try {
					await submitBodyRegeneration(props.sessionId, panel, guide);
					setRegenPanel(null);
				} catch (err) {
					tavernErrorHub.report("正文重新生成", err);
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
		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "dsh-tavern:status",
				title: "酒馆状态",
				order: 7,
				single: true,
				createTab: function () {
					return { tab: { id: "dsh-tavern:status", type: "dsh-tavern:status", title: "酒馆状态" }, patch: { panelOpen: true } };
				},
				component: function (props) {
					return React.createElement(TavernStatusTab, { sessions: ctx.sessions, sessionId: props.scope.sessionId });
				}
			}), "dsh-tavern: Better Sidebar status tab");
			ctx.effect(() => slots.inject("conversation.session.header.actions", () => slots.register(
				{ name: "conversation.session.header.actions", id: "dsh-tavern-player-name", order: 15 },
				TavernPlayerNameAction
			)), "dsh-tavern: player name header action");
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
				{ name: "conversation.session.header.utilities", id: "dsh-tavern-conversation-export", order: 90 },
				function (props) { return React.createElement(TavernConversationExportAction, Object.assign({}, props, { sessions: ctx.sessions })); }
			)), "dsh-tavern: conversation text export utility");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-actions", order: -130, label: "候选项操作" },
				function (props) { return React.createElement(CandidateDockActions, Object.assign({}, props, {
					refreshSessions: function () { return typeof ctx.sessions.refresh === "function" ? ctx.sessions.refresh() : Promise.resolve(); },
					executeCompact: function (sessionId) { return ctx.remote.commands.execute(sessionId, "/compact", []); }
				})); }
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
		return Object.freeze({ register: register });
		}
		const playControlsFeature = createPlayControlsFeatureModule();
		const assistantRendererFeature = createTavernAssistantRendererFeatureModule();

		const inject = ["slots", "sessions", "workspaces", "layout", "connection", "conversation", "betterSidebar", "remote", "remote.commands"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;
			function reconcileLibraryTabTitles() {
				if (!ctx.betterSidebar || typeof ctx.betterSidebar.getSnapshot !== "function" || typeof ctx.betterSidebar.updateTab !== "function") return;
				const snapshot = ctx.betterSidebar.getSnapshot();
				const state = snapshot.state;
				if (!state) return;
				const retiredTabs = [];
				const expectedTitles = {
					"dsh-tavern:cards": "人物卡库",
					"dsh-tavern:presets": "预设库（实验性）",
					"dsh-tavern:worldbooks": "世界书库",
					"dsh-tavern:resources": "剧本库"
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
				const resourceSection = hasInitialResources ? (task === "worldbook" || task === "preset" || task === "script" ? "\n\n【编辑目标】\n" : "\n\n【初始剧本】\n") : "";
				const taskText = "【卡片任务：" + label + "】" + targetSection + "\n\n" + String(result && result.text || "").trim() + resourceSection;
				input.setDraft(taskText + supplement);
			}
			playControlsFeature.register({ ctx: ctx, slots: slots });
			assistantRendererFeature.register({ ctx: ctx, slots: slots });
			ctx.effect(function () {
				return slots.inject("settings.section", function () { return slots.register({
					name: "settings.section",
					id: "dsh-tavern",
					order: 110,
					label: function () { return "DSH Tavern"; }
				}, TavernSettingsSection); });
			}, "dsh-tavern: settings section");
			presetLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			resourcesLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			worldBookLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			cardLibraryFeature.register({ ctx: ctx, appendMention: appendMention });
			ctx.effect(function () {
				reconcileLibraryTabTitles();
				if (typeof ctx.betterSidebar.subscribeState !== "function") return;
				return ctx.betterSidebar.subscribeState(reconcileLibraryTabTitles);
			}, "dsh-tavern: reconcile persisted library tab titles");
			ctx.effect(function () {
				function invalidateLiveView() { liveTavernView.invalidate(); }
				window.addEventListener("dsh-tavern-data-changed", invalidateLiveView);
				return function () { window.removeEventListener("dsh-tavern-data-changed", invalidateLiveView); };
			}, "dsh-tavern: live Tavern view invalidation");
			tavernShellFeature.register({ ctx: ctx, slots: slots, appendMention: appendMention, injectTaskPrompt: injectTaskPrompt });
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.buildOpeningPreviewDocument = buildOpeningPreviewDocument;
		exports.buildTavernFrameDocument = buildTavernFrameDocument;
		exports.buildTavernHelperScriptDocument = buildTavernHelperScriptDocument;
		exports.createTavernHelperScriptRuntime = createTavernHelperScriptRuntime;
		exports.clampTavernFrameHeight = clampTavernFrameHeight;
		exports.projectionPartsOf = projectionPartsOf;
		exports.tavernUserTextForTurn = tavernUserTextForTurn;
		exports.createLiveTavernViewModule = createLiveTavernViewModule;
		exports.createTavernCoordinationEventModule = createTavernCoordinationEventModule;
		exports.describeTavernActivity = describeTavernActivity;
		exports.createConversationLifecycleModule = createConversationLifecycleModule;
		exports.createConversationPrewarmModule = createConversationPrewarmModule;
		exports.createResourcesLibraryFeatureModule = createResourcesLibraryFeatureModule;
		exports.createPresetLibraryFeatureModule = createExternalPresetAndBypassPlanFeatureModule;
		exports.createWorldBookLibraryFeatureModule = createWorldBookLibraryFeatureModule;
		exports.createCardLibraryFeatureModule = createCardLibraryFeatureModule;
		exports.createPlayControlsFeatureModule = createPlayControlsFeatureModule;
		exports.createTavernAssistantRendererFeatureModule = createTavernAssistantRendererFeatureModule;
		exports.createTavernShellFeatureModule = createTavernShellFeatureModule;
		return module.exports;
	}
});
