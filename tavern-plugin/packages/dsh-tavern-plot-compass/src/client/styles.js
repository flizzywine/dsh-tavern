/* ------------------------------------------------------------------ *
 * styles.js —— 剧情罗盘浏览器端样式（基于宿主 CSS 变量自适应深浅主题）
 * ------------------------------------------------------------------ */

const PC_STYLE_ID = 'dsh-tavern-plot-compass-styles'

const PC_CSS_TEXT = `
.dsh-tavern-status.dsh-tavern-compass-panel {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--dsw-alias-label-primary, var(--dsh-ink, inherit));
}
.dsh-tavern-status.dsh-tavern-compass-panel > .dsh-tavern-status-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  flex: none;
}
.dsh-tavern-status.dsh-tavern-compass-panel > .dsh-tavern-status-head > .dsh-tavern-status-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}
.dsh-tavern-compass-composer-wrap {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-tavern-compass-dock-btn,
.dsh-tavern-compass-dock-btn.is-pinned {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.dsh-tavern-compass-dock-btn:hover,
.dsh-tavern-compass-dock-btn.is-pinned:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-dock-btn.is-pinned {
  color: #268265;
  border-color: rgba(38, 130, 101, 0.28);
  background: rgba(38, 130, 101, 0.08);
}
.dsh-tavern-compass-dock-glyph {
  font-size: 12px;
  line-height: 1;
}
/* 窄屏（与宿主手机布局断点一致）：入口默认只留图标，文字改成可访问名称。
   图标靠左贴住输入条边缘，和上方的楼层药丸同一左边界；触摸目标用 min-width 撑住。 */
@media (max-width: 1023px) {
  .dsh-tavern-compass-dock-btn {
    gap: 0;
    justify-content: flex-start;
    min-width: 30px;
    min-height: 30px;
    padding: 5px 0;
  }
  /* 钉住路线时按钮变成可见胶囊，贴边会把图标顶住边框，留出内边距。 */
  .dsh-tavern-compass-dock-btn.is-pinned {
    gap: 0;
    min-width: 30px;
    min-height: 30px;
    padding: 5px 8px;
  }
  .dsh-tavern-compass-dock-label {
    display: none;
  }
  .dsh-tavern-compass-dock-glyph {
    font-size: 15px;
    line-height: 1;
  }
  .dsh-tavern-compass-dock-btn .dsh-tavern-compass-spinner {
    width: 14px;
    height: 14px;
  }
}
.dsh-tavern-compass-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: dsh-pc-spin 0.8s linear infinite;
  flex: none;
}
@keyframes dsh-pc-spin {
  to { transform: rotate(360deg); }
}
.dsh-tavern-compass-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-tavern-compass-switch-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dsh-tavern-compass-switch-text {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.85));
  user-select: none;
}
.dsh-tavern-compass-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 34px;
  height: 19px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3));
  border-radius: 999px;
  background: var(--dsw-alias-fill-l1, rgba(127, 127, 127, 0.2));
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease;
}
.dsh-tavern-compass-switch.is-checked {
  background: var(--dsh-tavern-accent, #b9824a);
  border-color: var(--dsh-tavern-accent, #b9824a);
}
.dsh-tavern-compass-switch:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-tavern-compass-switch-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  transform: translateX(0);
  transition: transform 140ms ease;
}
.dsh-tavern-compass-switch.is-checked .dsh-tavern-compass-switch-thumb {
  transform: translateX(15px);
}
.dsh-tavern-compass-disabled-card {
  margin-top: 6px;
  padding: 16px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.dsh-tavern-compass-turn-badge {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.85));
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
}
.dsh-tavern-compass-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dsh-tavern-compass-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, rgba(127, 127, 127, 0.85));
}
.dsh-tavern-compass-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(181, 106, 44, 0.45);
  background: rgba(181, 106, 44, 0.1);
  font-size: 12px;
  line-height: 1.5;
}
.dsh-tavern-compass-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dsh-tavern-compass-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 11px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.45;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
}
.dsh-tavern-compass-alert.is-info {
  border-color: rgba(38, 130, 101, 0.35);
  background: rgba(38, 130, 101, 0.08);
}
.dsh-tavern-compass-alert.is-error {
  border-color: rgba(192, 72, 62, 0.42);
  background: rgba(192, 72, 62, 0.1);
  color: #d0584e;
}
.dsh-tavern-compass-alert-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dsh-tavern-compass-top {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.22));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.dsh-tavern-compass-archetypes-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.dsh-tavern-compass-label {
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-tavern-compass-muted {
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.8));
  font-size: 12px;
}
.dsh-tavern-compass-archetype-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsh-tavern-accent, #b9824a);
  background: var(--dsh-tavern-accent-soft, rgba(185, 130, 74, 0.16));
}
.dsh-tavern-compass-archetype-chip.is-removable button {
  appearance: none;
  border: 0;
  background: none;
  color: inherit;
  padding: 0 2px;
  cursor: pointer;
  font-size: 12px;
}
.dsh-tavern-compass-link-btn {
  appearance: none;
  border: 0;
  background: none;
  color: var(--dsh-tavern-accent, #b9824a);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  margin-left: auto;
}
.dsh-tavern-compass-link-btn:hover:not(:disabled) {
  text-decoration: underline;
}
.dsh-tavern-compass-link-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh-tavern-compass-archetype-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
}
.dsh-tavern-compass-preset-tags,
.dsh-tavern-compass-selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.dsh-tavern-compass-preset-tag {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  border-radius: 999px;
  padding: 2px 8px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.dsh-tavern-compass-preset-tag.is-selected {
  border-color: var(--dsh-tavern-accent-border, var(--dsh-tavern-accent, #b9824a));
  background: var(--dsh-tavern-accent-soft, rgba(185, 130, 74, 0.16));
  color: var(--dsh-tavern-accent, #b9824a);
  font-weight: 600;
}
.dsh-tavern-compass-custom-row,
.dsh-tavern-compass-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-tavern-compass-guidance-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.dsh-tavern-compass-input,
.dsh-tavern-compass-select {
  box-sizing: border-box;
  padding: 6px 9px;
  font: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-base, transparent));
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-radius: 8px;
}
.dsh-tavern-compass-input {
  width: 100%;
  flex: 1 1 160px;
  min-width: 0;
}
.dsh-tavern-compass-select {
  max-width: 100%;
  min-width: 120px;
}
.dsh-tavern-compass-input:focus,
.dsh-tavern-compass-select:focus {
  outline: none;
  border-color: var(--dsh-tavern-accent, #b9824a);
}
.dsh-tavern-compass-digest {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-funnel {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid rgba(38, 130, 101, 0.35);
  background: color-mix(in srgb, #268265 9%, transparent);
}
.dsh-tavern-compass-funnel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.dsh-tavern-compass-funnel-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-tavern-compass-funnel-chip {
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, transparent);
  border: 1px solid rgba(38, 130, 101, 0.28);
  color: var(--dsw-alias-label-primary, inherit);
  cursor: pointer;
}
.dsh-tavern-compass-notice {
  margin: 0;
  font-size: 12px;
  color: #268265;
}
.dsh-tavern-compass-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.dsh-tavern-compass-tab {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 6px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
  font: inherit;
}
.dsh-tavern-compass-tab.is-active {
  border-color: var(--dsh-tavern-accent-border, var(--dsh-tavern-accent, #b9824a));
  background: var(--dsh-tavern-accent-soft, rgba(185, 130, 74, 0.16));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-tab.has-pin .dsh-tavern-compass-tab-title {
  color: #268265;
}
.dsh-tavern-compass-tab-title {
  font-size: 12.5px;
  font-weight: 600;
}
.dsh-tavern-compass-tab small {
  font-size: 10.5px;
  opacity: 0.8;
}
.dsh-tavern-compass-section-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dsh-tavern-compass-section-bar p {
  margin: 0;
}
.dsh-tavern-compass-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dsh-tavern-compass-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 11px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  background: var(--dsw-alias-bg-base, transparent);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.dsh-tavern-compass-card.is-pinned {
  border-color: rgba(38, 130, 101, 0.55);
  box-shadow: 0 2px 10px rgba(38, 130, 101, 0.09);
}
.dsh-tavern-compass-card-head {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dsh-tavern-compass-card-titles {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
}
.dsh-tavern-compass-route-tag {
  font-size: 12px;
  font-weight: 700;
  color: #268265;
}
.dsh-tavern-compass-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.dsh-tavern-compass-pill {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.1));
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-tavern-compass-pill.is-hook {
  color: #b56a2c;
  background: rgba(181, 106, 44, 0.14);
}
.dsh-tavern-compass-pill.is-active {
  color: #268265;
  background: rgba(38, 130, 101, 0.15);
  font-weight: 600;
}
.dsh-tavern-compass-card-summary {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-callout {
  font-size: 12px;
  line-height: 1.5;
  padding: 7px 9px;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.07));
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-tavern-compass-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-tavern-compass-steps-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.8));
}
.dsh-tavern-compass-step-list,
.dsh-tavern-compass-prereq-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-tavern-compass-prereq-list li {
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary, inherit);
  padding-left: 12px;
  position: relative;
}
.dsh-tavern-compass-prereq-list li::before {
  content: "•";
  position: absolute;
  left: 2px;
  color: var(--dsh-tavern-accent, #b9824a);
}
.dsh-tavern-compass-step-btn {
  appearance: none;
  width: 100%;
  text-align: left;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  cursor: pointer;
}
.dsh-tavern-compass-step-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.08));
}
.dsh-tavern-compass-step-list li.is-done .dsh-tavern-compass-step-text {
  text-decoration: line-through;
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.7));
}
.dsh-tavern-compass-check {
  flex: none;
  color: #268265;
  font-weight: 700;
  width: 14px;
}
.dsh-tavern-compass-meta-line {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-tavern-compass-meta-line.is-subtle {
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.8));
}
.dsh-tavern-compass-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 4px;
}
.dsh-tavern-compass-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px 14px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  border-radius: 10px;
}
.dsh-tavern-compass-empty p {
  margin: 0;
}
.dsh-tavern-compass-archived {
  font-size: 12px;
  padding-top: 6px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.22));
}
.dsh-tavern-compass-archived summary {
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.85));
}
.dsh-tavern-compass-prefs-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dsh-tavern-compass-pace-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-tavern-compass-pace-pills {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  border-radius: 999px;
  overflow: hidden;
  background: var(--dsw-alias-fill-l1, transparent);
}
.dsh-tavern-compass-pace-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
}
.dsh-tavern-compass-pace-btn.is-active {
  background: var(--dsh-tavern-accent, #b9824a);
  color: #fff;
  font-weight: 600;
}
.dsh-tavern-compass-interval-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dsh-tavern-compass-interval-custom {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dsh-tavern-compass-interval-input {
  width: 68px;
  flex: none;
  padding: 2px 6px;
  font-size: 12px;
}
.dsh-tavern-compass-interval-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.85));
}
.dsh-tavern-compass-model-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh-tavern-compass-model-pickers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dsh-tavern-compass-blindbox-toggle {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
}
.dsh-tavern-compass-blindbox-toggle.is-active {
  border-color: var(--dsh-tavern-accent, #b9824a);
  color: var(--dsh-tavern-accent, #b9824a);
  font-weight: 600;
}
.dsh-tavern-compass-funnel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-tavern-compass-directive-box {
  margin-top: 6px;
}
.dsh-tavern-compass-directive-edit {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.dsh-tavern-compass-directive-edit .dsh-tavern-compass-input {
  flex: 1 1 200px;
}
.dsh-tavern-compass-blindbox-mask {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.dsh-tavern-compass-blindbox-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-tavern-compass-peek-bar {
  display: flex;
  justify-content: flex-end;
}
.dsh-tavern-compass-phase-tag {
  flex: none;
  font-size: 10px;
  line-height: 1.2;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.85));
}
.dsh-tavern-compass-chat-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh-tavern-compass-chat-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dsh-tavern-compass-chat-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, transparent);
}
.dsh-tavern-compass-chat-msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 92%;
}
.dsh-tavern-compass-chat-msg.is-user {
  align-self: flex-end;
  align-items: flex-end;
}
.dsh-tavern-compass-chat-msg.is-assistant {
  align-self: flex-start;
  align-items: flex-start;
}
.dsh-tavern-compass-chat-bubble {
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  background: var(--dsw-alias-fill-l1, rgba(127, 127, 127, 0.06));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-chat-msg.is-user .dsh-tavern-compass-chat-bubble {
  border-color: var(--dsh-tavern-accent, #b9824a);
  background: var(--dsh-tavern-accent, #b9824a);
  color: var(--dsw-alias-brand-text, #fff);
}
.dsh-tavern-compass-chat-msg-foot,
.dsh-tavern-compass-chat-apply-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dsh-tavern-compass-apply-btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.25));
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
}
.dsh-tavern-compass-apply-btn:hover:not(:disabled) {
  border-color: var(--dsh-tavern-accent, #b9824a);
  color: var(--dsh-tavern-accent, #b9824a);
}
.dsh-tavern-compass-guidance-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.dsh-tavern-compass-status-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}
.dsh-tavern-compass-status-box p {
  margin: 0;
}
`

function pcEnsureStyleInjected() {
  if (typeof document === 'undefined' || !document.head) return
  if (document.getElementById(PC_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = PC_STYLE_ID
  el.textContent = PC_CSS_TEXT
  document.head.appendChild(el)
}
