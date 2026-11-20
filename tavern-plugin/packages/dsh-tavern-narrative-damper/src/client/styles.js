/* ------------------------------------------------------------------ *
 * styles.js —— 叙事阻尼器面板样式（与「命运之骰」工作台完全一致的视觉体系）
 *
 * 统一基于 currentColor 与宿主强调色 --dsh-tavern-accent 的 color-mix 半透明层，
 * 在浅色暖白主题与深色主题下都保持对比度与柔和边框；不依赖宿主设置页类名。
 * ------------------------------------------------------------------ */

const TND_STYLE_ID = 'dsh-tavern-narrative-damper-style'

const TND_CSS = `
.tnd-root {
  --tnd-line: rgba(128, 128, 142, 0.24);
  --tnd-line: color-mix(in oklab, currentColor 18%, transparent);
  --tnd-line-soft: rgba(128, 128, 142, 0.14);
  --tnd-line-soft: color-mix(in oklab, currentColor 11%, transparent);
  --tnd-fill: rgba(128, 128, 142, 0.09);
  --tnd-fill: color-mix(in oklab, currentColor 7%, transparent);
  --tnd-fill-strong: rgba(128, 128, 142, 0.16);
  --tnd-fill-strong: color-mix(in oklab, currentColor 13%, transparent);
  --tnd-accent: var(--dsh-tavern-accent, #b9824a);
  --tnd-accent-soft: rgba(185, 130, 74, 0.16);
  --tnd-accent-soft: color-mix(in oklab, var(--tnd-accent) 18%, transparent);
  --tnd-ok: #2f8f66;
  --tnd-warn: #b9772f;
  --tnd-bad: #bb5044;
  --tnd-shadow: 0 6px 20px rgba(30, 30, 40, 0.12);
  color: var(--dsh-ink, inherit);
  font-size: 13px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tnd-root *, .tnd-root *::before, .tnd-root *::after { box-sizing: border-box; }

/* ---------- 右侧栏工作台：双层弹性滚动架构（与命运之骰一致） ---------- */
.tnd-root.tnd-workbench {
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
.tnd-wb-top {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}
.tnd-wb-scroll {
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
.tnd-wb-scroll > * { flex-shrink: 0; }
.tnd-wb-scroll::-webkit-scrollbar { width: 8px; }
.tnd-wb-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--tnd-line);
}
.tnd-wb-scroll::-webkit-scrollbar-track { background: transparent; }

.tnd-wb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.tnd-wb-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tnd-wb-toggle {
  font-size: 12px;
}

/* ---------- 分组卡片与行 ---------- */
.tnd-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  background: var(--tnd-fill);
  border: 1px solid var(--tnd-line-soft);
}
.tnd-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.tnd-section-title {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.9;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tnd-section-note { font-size: 11.5px; opacity: 0.62; }

.tnd-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border-radius: 9px;
  background: var(--tnd-fill);
  border: 1px solid var(--tnd-line-soft);
}
.tnd-row.is-plain { background: transparent; border-color: transparent; padding: 4px 0; }
.tnd-row-main { flex: 1 1 140px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tnd-row-title { font-size: 12.5px; font-weight: 600; word-break: break-word; }
.tnd-row-sub { font-size: 11.5px; opacity: 0.66; word-break: break-word; }
.tnd-row-end { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* ---------- 分段切换器（与命运之骰 .fd-tabbar 同款） ---------- */
.tnd-segbar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--tnd-fill);
  border: 1px solid var(--tnd-line-soft);
}
.tnd-seg {
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
  transition: background 0.15s ease, opacity 0.15s ease;
}
.tnd-seg:hover:not(:disabled) { opacity: 0.96; }
.tnd-seg.is-active {
  background: var(--tnd-accent-soft);
  border-color: var(--tnd-line);
  opacity: 1;
}
.tnd-seg:disabled { opacity: 0.45; cursor: not-allowed; }

/* ---------- 按钮 / 徽章 / 开关 / 输入 ---------- */
.tnd-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  border: 1px solid var(--tnd-line);
  background: var(--tnd-fill-strong);
  white-space: nowrap;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.tnd-badge.is-ok { color: var(--tnd-ok); border-color: color-mix(in oklab, var(--tnd-ok) 45%, transparent); }
.tnd-badge.is-warn { color: var(--tnd-warn); border-color: color-mix(in oklab, var(--tnd-warn) 45%, transparent); }
.tnd-badge.is-bad { color: var(--tnd-bad); border-color: color-mix(in oklab, var(--tnd-bad) 45%, transparent); }
.tnd-badge.is-off { opacity: 0.6; }

.tnd-btn {
  min-height: 34px;
  padding: 5px 12px;
  border-radius: 9px;
  border: 1px solid var(--tnd-line);
  background: var(--tnd-fill-strong);
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
.tnd-btn:hover:not(:disabled) {
  transform: translateY(-0.5px);
  filter: brightness(1.06);
  box-shadow: 0 2px 6px rgba(24, 24, 32, 0.13);
}
.tnd-btn:active:not(:disabled) { transform: translateY(0.5px); }
.tnd-btn.is-primary {
  background: color-mix(in oklab, var(--tnd-accent) 26%, var(--tnd-fill-strong));
  border-color: color-mix(in oklab, var(--tnd-accent) 68%, transparent);
  color: inherit;
}
.tnd-btn.is-danger {
  background: color-mix(in oklab, var(--tnd-bad) 14%, var(--tnd-fill-strong));
  color: var(--tnd-bad);
  border-color: color-mix(in oklab, var(--tnd-bad) 52%, transparent);
}
.tnd-btn.is-sm { min-height: 29px; padding: 3px 10px; font-size: 11.5px; border-radius: 8px; }
.tnd-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; transform: none; }
.tnd-btn-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

.tnd-input, .tnd-select, .tnd-textarea {
  width: 100%;
  border-radius: 9px;
  border: 1px solid var(--tnd-line);
  background: var(--tnd-fill);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  padding: 7px 10px;
  min-height: 34px;
}
.tnd-input:focus-visible, .tnd-select:focus-visible, .tnd-textarea:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--tnd-accent) 62%, transparent);
  outline-offset: 1px;
}
.tnd-input:disabled, .tnd-select:disabled, .tnd-textarea:disabled { opacity: 0.5; cursor: default; }
.tnd-select { cursor: pointer; }
.tnd-textarea { min-height: 84px; line-height: 1.55; resize: vertical; }
.tnd-input.is-num { width: 110px; min-height: 32px; padding: 5px 9px; }
.tnd-input.is-inline { flex: 1 1 180px; width: auto; min-width: 0; }
.tnd-field { display: flex; flex-direction: column; gap: 4px; }
.tnd-field-label { font-size: 11.5px; font-weight: 650; opacity: 0.82; }
.tnd-unit { font-size: 11.5px; opacity: 0.66; }

.tnd-switch {
  position: relative;
  width: 44px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--tnd-line);
  background: var(--tnd-fill-strong);
  cursor: pointer;
  padding: 0;
  touch-action: manipulation;
}
.tnd-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.55;
  transition: transform 0.16s ease, opacity 0.16s ease;
}
.tnd-switch:disabled { opacity: 0.55; cursor: default; }
.tnd-switch.is-on {
  background: var(--tnd-accent-soft);
  border-color: color-mix(in oklab, var(--tnd-accent) 55%, transparent);
}
.tnd-switch.is-on::after {
  transform: translateX(18px);
  background: var(--tnd-accent);
  opacity: 0.95;
}

.tnd-hint { font-size: 11.5px; opacity: 0.66; }
.tnd-empty { font-size: 12px; opacity: 0.66; padding: 6px 2px; }
.tnd-empty.is-alert { color: var(--tnd-bad); opacity: 1; }

.tnd-toast {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  z-index: 5;
  font-size: 11.5px;
  padding: 6px 10px;
  border-radius: 9px;
  background: var(--tnd-fill-strong);
  border: 1px solid var(--tnd-line);
  box-shadow: var(--tnd-shadow);
  backdrop-filter: blur(8px);
}
.tnd-toast.is-alert {
  color: var(--tnd-bad);
  border-color: color-mix(in oklab, var(--tnd-bad) 52%, transparent);
}

/* ---------- 说明气泡（? / × 按钮 + 左侧强调竖条就地展开卡片，与命运之骰一致） ---------- */
.tnd-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.tnd-help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--tnd-accent) 48%, transparent);
  background: color-mix(in oklab, var(--tnd-accent) 12%, transparent);
  color: color-mix(in oklab, var(--tnd-accent) 86%, currentColor);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease;
}
.tnd-help-btn:hover {
  transform: scale(1.1);
  background: color-mix(in oklab, var(--tnd-accent) 24%, transparent);
}
.tnd-help-btn:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--tnd-accent) 62%, transparent);
  outline-offset: 1px;
}
.tnd-help-btn.is-open {
  background: color-mix(in oklab, var(--tnd-accent) 90%, transparent);
  border-color: color-mix(in oklab, var(--tnd-accent) 90%, transparent);
  color: var(--tnd-on-accent, #fff);
}
.tnd-help-pop {
  flex: 1 1 100%;
  width: 100%;
  margin: 5px 0 2px;
  padding: 8px 10px 9px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--tnd-accent) 30%, var(--tnd-line-soft, transparent));
  border-left: 3px solid color-mix(in oklab, var(--tnd-accent) 82%, transparent);
  background: color-mix(in oklab, var(--tnd-accent) 7%, var(--tnd-fill, transparent));
  color: inherit;
  box-shadow: 0 3px 12px color-mix(in oklab, var(--tnd-accent) 12%, transparent);
  animation: tnd-rise 0.16s ease-out both;
}
.tnd-help-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}
.tnd-help-pop-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: color-mix(in oklab, var(--tnd-accent) 78%, currentColor);
  opacity: 0.96;
}
.tnd-help-close {
  flex: 0 0 auto;
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
.tnd-help-close:hover {
  opacity: 1;
  background: color-mix(in oklab, currentColor 10%, transparent);
  border-color: color-mix(in oklab, currentColor 16%, transparent);
}
.tnd-help-pop-body { display: flex; flex-direction: column; gap: 4px; }
.tnd-help-line {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.72;
  word-break: break-word;
  opacity: 0.92;
}

@keyframes tnd-rise {
  from { transform: translateY(4px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 720px) {
  .tnd-wb-top { gap: 6px; padding-bottom: 6px; }
  .tnd-seg { min-height: 30px; padding: 4px 8px; }
  .tnd-row { align-items: flex-start; }
}
`

function tndEnsureStyle() {
  if (typeof document === 'undefined' || document.getElementById(TND_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = TND_STYLE_ID
  style.textContent = TND_CSS
  document.head.appendChild(style)
}
