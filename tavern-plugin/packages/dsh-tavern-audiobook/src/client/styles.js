/* ------------------------------------------------------------------ *
 * styles.js — the panel wears Tavern's BGM panel (its fork-bgm classes and --bgm-* tokens); the chip lights while
 * reading; the sentence read is lit in the story (CSS Custom Highlight 'dsh-audiobook').
 * ------------------------------------------------------------------ */
const AB_STYLE_ID = 'dsh-tavern-audiobook-style'
const AB_CSS = `
.fork-audiobook-chip.is-reading { color: var(--fork-accent); }
.fork-audiobook-where { flex: none; color: var(--bgm-ink-2); font-size: var(--fork-fs-meta); }
.fork-audiobook-now { margin: -2px 2px 0; overflow: hidden; color: var(--bgm-ink-2); white-space: nowrap; text-overflow: ellipsis; }
.fork-audiobook-now > b { margin-right: .6em; color: var(--bgm-ink); font-weight: 600; }
.fork-audiobook-row { display: flex; align-items: center; gap: 10px; min-height: 30px; }
.fork-audiobook-row > span:first-child { flex: none; width: 4.5em; color: var(--bgm-ink-2); }
.fork-audiobook-row > .ap-slider { flex: 1; min-width: 0; }
.fork-audiobook-row > .ap-slider output { color: var(--bgm-ink-2); }
.fork-bgm .fork-audiobook-pick { display: flex; flex: 1; align-items: center; justify-content: space-between; min-width: 0; height: 30px; margin: 0; padding: 0 4px 0 0; border: 0; background: transparent; color: var(--bgm-ink); font: inherit; text-align: left; cursor: pointer; }
.fork-audiobook-pick > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fork-audiobook-pick > svg { flex: none; color: var(--bgm-ink-2); transform: rotate(-90deg); }
.fork-audiobook-seg { display: flex; flex: 1; padding: 2px; border-radius: 8px; background: var(--bgm-hover); }
.fork-bgm .fork-audiobook-seg button { flex: 1; min-width: 0; height: 26px; margin: 0; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: var(--bgm-ink-2); font: inherit; cursor: pointer; }
.fork-bgm .fork-audiobook-seg button[aria-pressed=true] { background: var(--bgm-active); color: var(--bgm-ink); font-weight: 600; }
.fork-audiobook-back { padding-bottom: 6px; }
.fork-audiobook-back > .fork-bgm-button { width: 28px; height: 28px; color: var(--bgm-ink-2); }
.fork-audiobook-back > .fork-bgm-button > svg { transform: rotate(90deg); }
.fork-audiobook-group { padding: 10px 14px 2px; color: var(--bgm-ink-off); font-size: var(--fork-fs-meta); }
.fork-bgm .fork-audiobook-end { display: flex; align-items: center; gap: 8px; height: 32px; margin: 0 0 0 auto; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--bgm-ink-2); font: inherit; cursor: pointer; }
.fork-bgm .fork-audiobook-end:hover { background: var(--bgm-hover); color: var(--bgm-ink); }
.fork-audiobook-end > i { width: 8px; height: 8px; border-radius: 1px; background: currentColor; }
.fork-audiobook-return { position: fixed; z-index: var(--fk-z-host-menu, 40); display: flex; align-items: center; gap: 6px; height: 32px; margin: 0; padding: 0 14px; border: 0; border-radius: 999px;
  background: var(--fork-raised, var(--fork-surface)); color: var(--fork-ink); font: inherit; cursor: pointer; visibility: hidden; transform: translate(-50%, 8px);
  box-shadow: 0 0 0 1px var(--fork-hairline), 0 4px 14px color-mix(in srgb, var(--fork-ink) 14%, transparent); transition: transform .18s, visibility 0s .18s; }
.fork-audiobook-return[data-shown] { visibility: visible; transform: translate(-50%, 0); transition: transform .18s, visibility 0s; }
.fork-audiobook-return > i { width: 7px; height: 7px; border-radius: 50%; background: var(--fork-accent); }
.fork-audiobook-return:focus-visible { outline: var(--fork-focus); outline-offset: 2px; }
::highlight(dsh-audiobook) { background-color: var(--fork-accent-soft); }
@media (max-width: 640px), (pointer: coarse) { .fork-audiobook-row { min-height: 36px; } .fork-bgm .fork-audiobook-seg button { height: 32px; } .fork-audiobook-return { height: 36px; } }
`
function abEnsureStyle() {
  if (typeof document === 'undefined' || document.getElementById(AB_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = AB_STYLE_ID
  style.textContent = AB_CSS
  document.head.appendChild(style)
}
