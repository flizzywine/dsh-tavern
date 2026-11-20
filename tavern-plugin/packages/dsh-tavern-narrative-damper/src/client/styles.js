/* ------------------------------------------------------------------ *
 * styles.js —— 叙事阻尼器面板。
 *
 * 行的骨架、分组卡片、开关与按钮沿用宿主设置页的类（.dsh-tavern-global-settings /
 * .dsh-tavern-settings-row / .dsh-tavern-btn），面板长在侧栏里也和设置页同一副样子；
 * 这里只补输入框、下拉、密钥与测试结果这几处宿主没有的形状。
 * ------------------------------------------------------------------ */

const TND_STYLE_ID = 'dsh-tavern-narrative-damper-style'

const TND_CSS = `
.tnd-panel { display: flex; flex-direction: column; gap: 22px; box-sizing: border-box; min-width: 0; height: 100%; overflow-y: auto; padding: 12px 14px 24px; }
.tnd-panel .dsh-tavern-gs-group > .dsh-tavern-settings-group:last-child { padding-bottom: 4px; }
.tnd-help { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 15px; height: 15px; margin-left: 2px; border: 0; padding: 0; border-radius: 50%;
  background: var(--fork-hover, rgba(127,127,127,.14)); color: var(--fork-ink-3, #8a8a8a); font: inherit; font-size: 10px; font-weight: 700; line-height: 1; cursor: pointer; }
.tnd-help:hover { color: var(--fork-ink, inherit); }
.tnd-help.is-open { background: var(--fork-accent-soft, rgba(127,127,127,.22)); color: var(--fork-ink, inherit); }
.tnd-help:focus-visible { outline: var(--fork-focus, 2px solid currentColor); outline-offset: 1px; }
.tnd-help-pop { display: block; min-width: 0; align-self: stretch; margin: 6px 0 0; padding: 8px 10px; border-radius: 8px;
  background: var(--fork-hover, rgba(127, 127, 127, .10)); color: var(--fork-ink-2, inherit);
  font-size: var(--fork-fs-meta, 12px); line-height: 1.65; text-align: left; overflow-wrap: anywhere; white-space: normal; }
.tnd-help-pop.is-group { margin: 0 0 10px; }
.tnd-input, .tnd-select, .tnd-area {
  box-sizing: border-box; min-width: 0; max-width: 100%; padding: 4px 8px; border: 1px solid var(--fork-hairline, rgba(127,127,127,.28)); border-radius: 8px;
  background: var(--fork-raised, transparent); color: var(--fork-ink, inherit); font: inherit; font-size: var(--fork-fs-body, 13px); line-height: 1.5;
}
.tnd-input { width: 9.5em; }
.tnd-input.tnd-wide { width: 16em; }
.tnd-input:focus-visible, .tnd-select:focus-visible, .tnd-area:focus-visible { outline: var(--fork-focus, 2px solid currentColor); outline-offset: 1px; }
.tnd-input:disabled, .tnd-select:disabled, .tnd-area:disabled { opacity: .5; cursor: default; }
.tnd-select { width: 16em; cursor: pointer; }

/* 分段选择（判定模式 / 阻尼模式）：宿主的 .ap-segmented 按钮规则挂在 .ap-ui 下，插件面板不在那个
   作用域里，只有容器底色生效，按钮就退化成一排白底方框。这里按同一套 tokens 补全：选中项有底色、
   加粗和细描边，一眼看得出当前是哪个。 */
.tnd-panel .tnd-seg { display: inline-flex; flex: none; gap: 2px; max-width: 100%; padding: 2px; border-radius: 9px; background: var(--fork-hover, rgba(127, 127, 127, .12)); }
.tnd-panel .tnd-seg button { min-width: 0; height: 26px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: var(--fork-ink-2, inherit); font: inherit; font-size: var(--fork-fs-meta, 12px); line-height: 1.4; cursor: pointer; }
.tnd-panel .tnd-seg button:hover:not(:disabled) { background: transparent; color: var(--fork-ink, inherit); }
.tnd-panel .tnd-seg button[aria-pressed="true"] { background: var(--fork-surface, Canvas); color: var(--fork-ink, inherit); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, .12), 0 0 0 .5px var(--ap-border, var(--fork-hairline, rgba(127, 127, 127, .32))); }
.tnd-panel .tnd-seg button:disabled { opacity: .5; cursor: default; }
@media (max-width: 560px) { .tnd-panel .tnd-seg { flex: 1 1 100%; } .tnd-panel .tnd-seg button { flex: 1; height: 32px; } }

.tnd-area { flex: 1 1 100%; min-height: 4.5em; resize: vertical; }
.tnd-unit { color: var(--fork-ink-3, #8a8a8a); font-size: var(--fork-fs-meta, 12px); }
.tnd-actions { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.tnd-credential { color: var(--fork-ink-2, inherit); font-size: 13px; }
.tnd-badge { font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.tnd-badge.is-ok { color: var(--dsw-static-green-600, #238636); }
.tnd-badge.is-error { color: var(--fork-warn, #c64545); }
.tnd-notice { color: var(--fork-ink-3, #8a8a8a); font-size: var(--fork-fs-meta, 12px); }
.tnd-notice.is-alert { color: var(--fork-warn, #c64545); }
.tnd-loading { color: var(--fork-ink-3, #8a8a8a); font-size: var(--fork-fs-meta, 12px); padding: 12px 2px; }
`

function tndEnsureStyle() {
  if (typeof document === 'undefined' || document.getElementById(TND_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = TND_STYLE_ID
  style.textContent = TND_CSS
  document.head.appendChild(style)
}
