/* ------------------------------------------------------------------ *
 * styles.js —— 剧情罗盘浏览器端样式（与「命运之骰」工作台完全一致的视觉体系）
 *
 * 统一基于 currentColor 与宿主强调色 --dsh-tavern-accent 的 color-mix 半透明层，
 * 在浅色暖白主题与深色主题下都保持对比度与柔和边框。
 * 输入框入口与状态页概览保留原有类名供宿主挂载位使用。
 * ------------------------------------------------------------------ */

const PC_STYLE_ID = 'dsh-tavern-plot-compass-styles'

const PC_CSS_TEXT = `
/* ---------- 工作台根节点与主题变量（与命运之骰完全一致） ---------- */
.pc-root {
  --pc-line: rgba(128, 128, 142, 0.24);
  --pc-line: color-mix(in oklab, currentColor 18%, transparent);
  --pc-line-soft: rgba(128, 128, 142, 0.14);
  --pc-line-soft: color-mix(in oklab, currentColor 11%, transparent);
  --pc-fill: rgba(128, 128, 142, 0.09);
  --pc-fill: color-mix(in oklab, currentColor 7%, transparent);
  --pc-fill-strong: rgba(128, 128, 142, 0.16);
  --pc-fill-strong: color-mix(in oklab, currentColor 13%, transparent);
  --pc-accent: var(--dsh-tavern-accent, #b9824a);
  --pc-accent-soft: rgba(185, 130, 74, 0.16);
  --pc-accent-soft: color-mix(in oklab, var(--pc-accent) 18%, transparent);
  --pc-ok: #2f8f66;
  --pc-warn: #b9772f;
  --pc-bad: #bb5044;
  --pc-shadow: 0 6px 20px rgba(30, 30, 40, 0.12);
  color: var(--dsh-ink, inherit);
  font-size: 13px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pc-root *, .pc-root *::before, .pc-root *::after { box-sizing: border-box; }

/* ---------- 右侧栏工作台：双层弹性滚动架构 ---------- */
.pc-root.pc-workbench {
  position: relative;
  width: 100%;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px 0;
  gap: 0;
}
.pc-wb-top {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}
.pc-wb-scroll {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 2px 48px;
}
.pc-wb-scroll > * { flex-shrink: 0; }
.pc-wb-scroll::-webkit-scrollbar { width: 8px; }
.pc-wb-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--pc-line);
}
.pc-wb-scroll::-webkit-scrollbar-track { background: transparent; }

.pc-wb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.pc-wb-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.pc-wb-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pc-wb-toggle {
  font-size: 12px;
}

/* ---------- 页签条与分段切换器（与命运之骰 .fd-tabbar 同款） ---------- */
.pc-tabbar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--pc-fill);
  border: 1px solid var(--pc-line-soft);
}
.pc-tabbar.is-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.pc-tab {
  min-width: 0;
  min-height: 34px;
  padding: 5px 10px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.78;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: background 0.15s ease, opacity 0.15s ease;
}
.pc-tab:hover:not(:disabled) { opacity: 0.96; }
.pc-tab.is-active {
  background: var(--pc-accent-soft);
  border-color: var(--pc-line);
  opacity: 1;
}
.pc-tab.is-strict.is-active {
  background: color-mix(in oklab, var(--pc-bad) 18%, transparent);
  border-color: color-mix(in oklab, var(--pc-bad) 52%, transparent);
  color: var(--pc-bad);
}
.pc-tab.has-pin .pc-tab-title { color: var(--pc-ok); }
.pc-tab:disabled { opacity: 0.45; cursor: not-allowed; }
.pc-tab-title { font-size: 12.5px; font-weight: 650; line-height: 1.25; }
.pc-tab small { font-size: 10.5px; opacity: 0.72; font-weight: 500; line-height: 1.2; }

/* ---------- 分组卡片与行 ---------- */
.pc-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  background: var(--pc-fill);
  border: 1px solid var(--pc-line-soft);
}
.pc-section.is-accent {
  border-color: color-mix(in oklab, var(--pc-ok) 40%, transparent);
  background: color-mix(in oklab, var(--pc-ok) 8%, var(--pc-fill));
}
.pc-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.pc-section-title {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.9;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pc-section-note { font-size: 11.5px; opacity: 0.62; }

.pc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border-radius: 9px;
  background: var(--pc-fill);
  border: 1px solid var(--pc-line-soft);
}
.pc-row.is-plain { background: transparent; border-color: transparent; padding: 4px 0; }
.pc-row-main { flex: 1 1 140px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pc-row-title { font-size: 12.5px; font-weight: 600; word-break: break-word; }
.pc-row-sub { font-size: 11.5px; opacity: 0.66; word-break: break-word; }
.pc-row-end { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* ---------- 徽章 / 按钮 / 芯片 / 开关 / 输入 ---------- */
.pc-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  border: 1px solid var(--pc-line);
  background: var(--pc-fill-strong);
  white-space: nowrap;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.pc-badge.is-ok { color: var(--pc-ok); border-color: color-mix(in oklab, var(--pc-ok) 45%, transparent); }
.pc-badge.is-warn { color: var(--pc-warn); border-color: color-mix(in oklab, var(--pc-warn) 45%, transparent); }
.pc-badge.is-bad { color: var(--pc-bad); border-color: color-mix(in oklab, var(--pc-bad) 45%, transparent); }
.pc-badge.is-accent { color: var(--pc-accent); background: var(--pc-accent-soft); border-color: color-mix(in oklab, var(--pc-accent) 45%, transparent); }
.pc-badge.is-off { opacity: 0.6; }
.pc-badge-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

.pc-btn {
  min-height: 34px;
  padding: 5px 12px;
  border-radius: 9px;
  border: 1px solid var(--pc-line);
  background: var(--pc-fill-strong);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  touch-action: manipulation;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  box-shadow: 0 1px 2px rgba(24, 24, 32, 0.08);
  transition: transform 0.14s ease, filter 0.15s ease, box-shadow 0.15s ease;
}
.pc-btn:hover:not(:disabled) {
  transform: translateY(-0.5px);
  filter: brightness(1.06);
  box-shadow: 0 2px 6px rgba(24, 24, 32, 0.13);
}
.pc-btn:active:not(:disabled) { transform: translateY(0.5px); }
.pc-btn.is-primary {
  background: color-mix(in oklab, var(--pc-accent) 26%, var(--pc-fill-strong));
  border-color: color-mix(in oklab, var(--pc-accent) 68%, transparent);
  color: inherit;
}
.pc-btn.is-danger {
  background: color-mix(in oklab, var(--pc-bad) 14%, var(--pc-fill-strong));
  color: var(--pc-bad);
  border-color: color-mix(in oklab, var(--pc-bad) 52%, transparent);
}
.pc-btn.is-sm { min-height: 29px; padding: 3px 10px; font-size: 11.5px; border-radius: 8px; }
.pc-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; transform: none; }
.pc-btn-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

.pc-chip {
  min-height: 28px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--pc-line);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  touch-action: manipulation;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pc-chip:hover:not(:disabled) { background: var(--pc-fill-strong); }
.pc-chip.is-active {
  background: var(--pc-accent-soft);
  border-color: color-mix(in oklab, var(--pc-accent) 60%, transparent);
  font-weight: 650;
}
.pc-chip.is-ok {
  border-color: color-mix(in oklab, var(--pc-ok) 45%, transparent);
  background: color-mix(in oklab, var(--pc-ok) 10%, transparent);
}
.pc-chip.is-goal {
  border-color: color-mix(in oklab, var(--pc-accent) 55%, transparent);
  background: var(--pc-accent-soft);
  font-weight: 650;
}
.pc-chip:disabled { opacity: 0.45; cursor: not-allowed; }
.pc-chip-x {
  appearance: none;
  border: 0;
  background: none;
  color: inherit;
  min-width: 0;
  min-height: 0;
  padding: 0 2px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.pc-chip-group { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }

.pc-input, .pc-select {
  width: 100%;
  border-radius: 9px;
  border: 1px solid var(--pc-line);
  background: var(--pc-fill);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  padding: 7px 10px;
  min-height: 34px;
}
.pc-input:focus-visible, .pc-select:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--pc-accent) 62%, transparent);
  outline-offset: 1px;
}
.pc-input:disabled, .pc-select:disabled { opacity: 0.5; cursor: default; }
.pc-select { cursor: pointer; }
.pc-input.is-inline { flex: 1 1 150px; width: auto; min-width: 0; min-height: 32px; padding: 5px 9px; }
.pc-input.is-num { width: 78px; min-height: 30px; padding: 3px 8px; text-align: center; }
.pc-field { display: flex; flex-direction: column; gap: 5px; }
.pc-field-label { font-size: 11.5px; font-weight: 650; opacity: 0.82; }

.pc-switch {
  position: relative;
  width: 44px;
  min-width: 44px;
  height: 26px;
  min-height: 26px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--pc-line);
  background: var(--pc-fill-strong);
  cursor: pointer;
  padding: 0;
  touch-action: manipulation;
}
.pc-switch::after {
  content: '';
  position: absolute;
  top: calc(50% - 10px);
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.55;
  transition: transform 0.16s ease, opacity 0.16s ease;
}
.pc-switch:disabled { opacity: 0.55; cursor: default; }
.pc-switch.is-on {
  background: var(--pc-accent-soft);
  border-color: color-mix(in oklab, var(--pc-accent) 55%, transparent);
}
.pc-switch.is-on::after {
  transform: translateX(18px);
  background: var(--pc-accent);
  opacity: 0.95;
}

.pc-hint { font-size: 11.5px; opacity: 0.66; margin: 0; line-height: 1.55; }
.pc-digest { margin: 0; font-size: 12.5px; line-height: 1.55; }
.pc-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px 12px;
  border-radius: 12px;
  border: 1px dashed var(--pc-line);
  background: var(--pc-fill);
}
.pc-empty p { margin: 0; }

/* ---------- 提示条 / 确认栏 / 底部浮动 toast ---------- */
.pc-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 11px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--pc-line);
  background: var(--pc-fill);
}
.pc-alert.is-info {
  border-color: color-mix(in oklab, var(--pc-ok) 45%, transparent);
  background: color-mix(in oklab, var(--pc-ok) 10%, transparent);
}
.pc-alert.is-warn {
  border-color: color-mix(in oklab, var(--pc-warn) 48%, transparent);
  background: color-mix(in oklab, var(--pc-warn) 12%, transparent);
  flex-direction: column;
  align-items: stretch;
}
.pc-alert.is-error {
  border-color: color-mix(in oklab, var(--pc-bad) 48%, transparent);
  background: color-mix(in oklab, var(--pc-bad) 12%, transparent);
  color: var(--pc-bad);
}
.pc-alert-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pc-toast {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  z-index: 5;
  font-size: 11.5px;
  padding: 6px 10px;
  border-radius: 9px;
  background: var(--pc-fill-strong);
  border: 1px solid var(--pc-line);
  box-shadow: var(--pc-shadow);
  backdrop-filter: blur(8px);
}
.pc-toast.is-alert {
  color: var(--pc-bad);
  border-color: color-mix(in oklab, var(--pc-bad) 52%, transparent);
}

/* ---------- 说明气泡（? / × 按钮 + 左侧强调竖条就地展开卡片，与命运之骰一致） ---------- */
.pc-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.pc-help-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 17px;
  min-width: 17px;
  height: 17px;
  min-height: 17px;
  aspect-ratio: 1 / 1;
  padding: 0;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--pc-accent) 48%, transparent);
  background: color-mix(in oklab, var(--pc-accent) 12%, transparent);
  color: color-mix(in oklab, var(--pc-accent) 86%, currentColor);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease;
}
.pc-help-btn:hover {
  transform: scale(1.1);
  background: color-mix(in oklab, var(--pc-accent) 24%, transparent);
}
.pc-help-btn:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--pc-accent) 62%, transparent);
  outline-offset: 1px;
}
.pc-help-btn.is-open {
  background: color-mix(in oklab, var(--pc-accent) 90%, transparent);
  border-color: color-mix(in oklab, var(--pc-accent) 90%, transparent);
  color: var(--pc-on-accent, #fff);
}
.pc-help-pop {
  flex: 1 1 100%;
  width: 100%;
  margin: 5px 0 2px;
  padding: 8px 10px 9px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--pc-accent) 30%, var(--pc-line-soft, transparent));
  border-left: 3px solid color-mix(in oklab, var(--pc-accent) 82%, transparent);
  background: color-mix(in oklab, var(--pc-accent) 7%, var(--pc-fill, transparent));
  color: inherit;
  box-shadow: 0 3px 12px color-mix(in oklab, var(--pc-accent) 12%, transparent);
  animation: pc-rise 0.16s ease-out both;
}
.pc-help-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}
.pc-help-pop-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: color-mix(in oklab, var(--pc-accent) 78%, currentColor);
  opacity: 0.96;
}
.pc-help-close {
  flex: 0 0 auto;
  min-width: 0;
  min-height: 0;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 10.5px;
  line-height: 1.6;
  opacity: 0.66;
  cursor: pointer;
  touch-action: manipulation;
}
.pc-help-close:hover {
  opacity: 1;
  background: color-mix(in oklab, currentColor 10%, transparent);
  border-color: color-mix(in oklab, currentColor 16%, transparent);
}
.pc-help-pop-body { display: flex; flex-direction: column; gap: 4px; }
.pc-help-line {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.72;
  word-break: break-word;
  opacity: 0.92;
}

/* ---------- 路线卡片 / 节拍 / 目标 / 脑暴对话 ---------- */
.pc-cards { display: flex; flex-direction: column; gap: 10px; }
.pc-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px;
  border-radius: 12px;
  border: 1px solid var(--pc-line-soft);
  background: var(--pc-fill);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.pc-card.is-pinned {
  border-color: color-mix(in oklab, var(--pc-ok) 58%, transparent);
  background: color-mix(in oklab, var(--pc-ok) 6%, var(--pc-fill));
  box-shadow: 0 2px 10px color-mix(in oklab, var(--pc-ok) 12%, transparent);
}
.pc-card-head { display: flex; flex-direction: column; gap: 5px; }
.pc-card-titles { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.pc-route-tag { font-size: 12px; font-weight: 700; color: var(--pc-ok); }
.pc-card-title { margin: 0; font-size: 13.5px; font-weight: 700; }
.pc-card-summary { margin: 0; font-size: 12.5px; line-height: 1.55; }
.pc-callout {
  font-size: 12px;
  line-height: 1.5;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--pc-fill-strong);
  border: 1px solid var(--pc-line-soft);
}
.pc-steps { display: flex; flex-direction: column; gap: 4px; }
.pc-steps-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 650;
  opacity: 0.68;
}
.pc-step-list, .pc-prereq-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pc-prereq-list li {
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.85;
  padding-left: 12px;
  position: relative;
}
.pc-prereq-list li::before {
  content: '•';
  position: absolute;
  left: 2px;
  color: var(--pc-accent);
}
.pc-step-btn {
  appearance: none;
  width: 100%;
  text-align: left;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  cursor: pointer;
}
.pc-step-btn:hover:not(:disabled) { background: var(--pc-fill-strong); }
.pc-step-list li.is-done .pc-step-text { text-decoration: line-through; opacity: 0.56; }
.pc-check { flex: none; color: var(--pc-ok); font-weight: 700; width: 14px; }
.pc-step-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.pc-step-note { font-size: 11px; line-height: 1.45; opacity: 0.66; }
.pc-phase-tag {
  flex: none;
  font-size: 10px;
  line-height: 1.25;
  padding: 1px 5px;
  border-radius: 5px;
  border: 1px solid var(--pc-line);
  opacity: 0.72;
}
.pc-meta-line { margin: 0; font-size: 11.5px; line-height: 1.55; opacity: 0.85; }
.pc-meta-line.is-subtle { opacity: 0.68; }
.pc-blindbox-mask {
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px dashed var(--pc-line);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.pc-goal-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--pc-accent) 45%, transparent);
  background: color-mix(in oklab, var(--pc-accent) 8%, transparent);
}
.pc-goal-box.is-paused {
  border-style: dashed;
  border-color: var(--pc-line);
  background: transparent;
  opacity: 0.82;
}
.pc-goal-text { margin: 0; font-size: 12.5px; line-height: 1.5; word-break: break-word; }

.pc-chat-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding: 8px 10px;
  border: 1px solid var(--pc-line-soft);
  border-radius: 10px;
  background: var(--pc-fill);
}
.pc-chat-msg { display: flex; flex-direction: column; gap: 4px; max-width: 92%; }
.pc-chat-msg.is-user { align-self: flex-end; align-items: flex-end; }
.pc-chat-msg.is-assistant { align-self: flex-start; align-items: flex-start; }
.pc-chat-bubble {
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 6px 10px;
  border-radius: 9px;
  border: 1px solid var(--pc-line-soft);
  background: var(--pc-fill-strong);
}
.pc-chat-msg.is-user .pc-chat-bubble {
  border-color: color-mix(in oklab, var(--pc-accent) 65%, transparent);
  background: color-mix(in oklab, var(--pc-accent) 24%, var(--pc-fill-strong));
}
.pc-archived {
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--pc-line-soft);
  background: var(--pc-fill);
}
.pc-archived summary { cursor: pointer; opacity: 0.72; font-weight: 600; }

.pc-divider {
  height: 1px;
  background: var(--pc-line-soft);
  margin: 2px 0;
}

@keyframes pc-rise {
  from { transform: translateY(4px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* ---------- 输入栏挂载入口与状态页概览（保留宿主兼容类名） ---------- */
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
.dsh-tavern-compass-dock-glyph { font-size: 12px; line-height: 1; }
@media (max-width: 1023px) {
  .dsh-tavern-compass-dock-btn {
    gap: 0; justify-content: flex-start; min-width: 30px; min-height: 30px; padding: 5px 0;
  }
  .dsh-tavern-compass-dock-btn.is-pinned {
    gap: 0; min-width: 30px; min-height: 30px; padding: 5px 8px;
  }
  .dsh-tavern-compass-dock-label { display: none; }
  .dsh-tavern-compass-dock-glyph { font-size: 15px; line-height: 1; }
  .dsh-tavern-compass-dock-btn .dsh-tavern-compass-spinner { width: 14px; height: 14px; }
}
.dsh-tavern-compass-tool-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, var(--dsh-ink, inherit));
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
}
.dsh-tavern-compass-tool-btn:hover,
.dsh-tavern-compass-tool-btn:active {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-tool-btn.is-pinned {
  color: #268265;
  border-color: rgba(38, 130, 101, 0.24);
  background: rgba(38, 130, 101, 0.1);
}
.dsh-tavern-compass-tool-glyph { font-size: 15px; line-height: 1; }
.dsh-tavern-compass-tool-dot {
  position: absolute; top: 3px; right: 3px; width: 5px; height: 5px;
  border-radius: 50%; background: currentColor;
}
.dsh-tavern-compass-tool-btn .dsh-tavern-compass-spinner { width: 13px; height: 13px; }
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
@keyframes dsh-pc-spin { to { transform: rotate(360deg); } }
.dsh-tavern-compass-status-box { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.dsh-tavern-compass-status-box p { margin: 0; }
.dsh-tavern-compass-desc { margin: 0; font-size: 12px; line-height: 1.5; opacity: 0.78; }
.dsh-tavern-compass-funnel-items { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-tavern-compass-funnel-chip {
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, transparent);
  border: 1px solid rgba(38, 130, 101, 0.28);
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-tavern-compass-funnel-chip.is-goal {
  border-color: var(--dsh-tavern-accent-border, var(--dsh-tavern-accent, #b9824a));
  background: var(--dsh-tavern-accent-soft, rgba(185, 130, 74, 0.14));
  font-weight: 600;
}

/* 宿主右侧栏移动端触控地板（min-height: 40px）不得撑坏罗盘内圆点、开关、胶囊与紧凑按钮 */
@media (max-width: 1023px), (pointer: coarse) {
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-help-btn {
    width: 17px;
    min-width: 17px;
    height: 17px;
    min-height: 17px;
    padding: 0;
  }
  .pc-root .pc-help-btn::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-switch {
    width: 44px;
    min-width: 44px;
    height: 26px;
    min-height: 26px;
    padding: 0;
  }
  .pc-root .pc-switch::before {
    content: '';
    position: absolute;
    inset: -7px -4px;
  }
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-help-close,
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-chip-x,
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-step-btn,
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root .pc-archived > summary {
    min-height: 0;
  }
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-chip {
    min-height: 28px;
  }
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-btn {
    min-height: 34px;
  }
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-btn.is-sm {
    min-height: 29px;
  }
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-tab {
    min-height: 34px;
  }
  .pc-wb-scroll {
    padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 720px) {
  .pc-wb-top { gap: 6px; padding-bottom: 6px; }
  .pc-tab,
  body.dsh-tavern-shell-active [data-sidebar-right-panel] .pc-root button.pc-tab { min-height: 30px; padding: 4px 6px; }
  .pc-row { align-items: flex-start; }
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
