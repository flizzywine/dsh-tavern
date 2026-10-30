// the plugin-wide inline field — 「label value」 on one line, the value
// read as text and edited in place (no boxed inputs). Styles: `.fork-inline-*`
// in theme.css. main.js bundles this file at the outer client level next to Spinner, so every feature (素材库,
// settings pages, stage panels) can use it. It depends on nothing but the React global: its few glyphs are drawn here and
// it reads no closure of another module.
//
// <InlineField kind label value onCommit … />
//   kind     'text' | 'number' | 'menu' | 'color' | 'chips' | 'link'
//   label    visible label (string, or a node with `controlLabel` giving the accessible name); `help` is a node shown
//            right after it (e.g. a 「?」 tooltip button); `hideLabel` keeps the label for assistive tech only (table rows)
//   value    current value (text / number / option value / '#rrggbb' or '' for automatic / string[] / display text)
//   onCommit(next) called once per change: text / number on Enter or blur, the others on pick; never for an unchanged
//            value. Esc cancels a pending edit (it only reaches the dialog when nothing was being edited).
//   validate(next) → '' | message: shown under the value (role=alert); an invalid draft is kept and not committed
//   error    a message set from outside after a submit (same place and look as validate's); the owner clears it
//   placeholder, disabled, className, wide (spans both columns of a InlineGrid), title, controlRef, controlClassName,
//   trail (small nodes after the value: a 「已修改」 tag, a reset button)
//   text:   maxLength, trim (default true), multiline (wraps in the value column; one paragraph, Enter saves), lines (with
//           multiline: keeps line breaks — Shift+Enter starts a new line, Enter still saves), count (with multiline +
//           maxLength: a quiet 「n/max」 only near the limit)
//   number: unit (text after the value), min, max, step (↑ / ↓), integer, optional (empty commits null)
//   menu:   options [{value, label, title?, group?}] — consecutive options with the same `group` sit under that quiet heading
//   color:  auto (the automatic colour, shown when value is empty), palette only when data declares one (else shades of auto); commits null for 自动
//   chips:  split(text) → words, addLabel; validate receives the whole list; onPick(word, index) makes each word a button
//           (e.g. 标签: filter the list by that level), pickTitle its tooltip
//   link:   onOpen() (the value opens its own page), before / after (small nodes beside the text), ariaLabel (the
//           button's full accessible name when the text alone does not say enough, e.g. a warning)
// Hit area: the whole field. A click on the label, the gap or the empty part of the value cell acts as a click on the value
// (focus a text box with the caret at the end, open a menu / colour / link, focus the chips' ＋ field).
// <InlineGrid label columns? className?> — the container: two aligned columns on desktop, one on a phone.
// <InlineRow label help? multiline?> — the same row around any other control (switch, slider, text area).
const INLINE_GLYPHS = { chevDown: "M4.5 6.5 8 10l3.5-3.5", chevRight: "M6.5 4.5 10 8l-3.5 3.5", check: "M3.5 8.5l3 3 6-7", plus: "M8 3.5v9M3.5 8h9", close: "M5 5l6 6M11 5l-6 6",
    // the one rotate-arrow reset glyph (the panel's IconButton icon:'reset' reads this path too).
    reset: "M3.2 6.5A5 5 0 1 1 3.5 10M3 3v3.5h3.5", warning: "M8 2.5 14 13H2zM8 6.5v3M8 11.4v.1" };
function InlineGlyph(props) {
    const h = React.createElement;
    return h("svg", { className: "fork-inline-glyph", width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        h("path", { d: INLINE_GLYPHS[props.name], stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
}
// the one reset control — a quiet 30px rotate-arrow icon
// button, its name and tooltip the exact action (「恢复为全局」, 「全部恢复为自动…」). <ResetButton label onClick disabled className>.
function ResetButton(props) {
    const h = React.createElement, p = props || {};
    return h("button", { type: "button", className: "fork-cfg-icon fork-reset-button" + (p.className ? " " + p.className : ""), "aria-label": p.label, title: p.label, disabled: p.disabled || undefined, onClick: p.onClick },
        h(InlineGlyph, { name: "reset" }));
}
// One popup (menu / colour picker) anchored to its trigger. Outside pointer, Esc (focus returns to the trigger) or Tab
// closes it; opening focuses the checked item, else the first control.
// the popup floats in the top layer — a portal into <body> wrapped in
// `.ap-ui.ap-layer` (panel tokens, display: contents) with position: fixed, placed against the window: under the value,
// or above it when the window has more room there, kept inside the window edges (the same rule as the stage panel's
// popoverPlace). An overflow: hidden / scrolling panel or dialog therefore never clips it. It follows scrolling and
// closes when its value scrolls out of sight. Without a DOM portal (tests, SSR) it stays inline, absolutely positioned.
function inlinePlace(anchor, size, view) {
    const gap = 4, edge = 8, below = view.height - anchor.bottom - gap - edge, above = anchor.top - gap - edge, up = size.height > below && above > below;
    const maxHeight = Math.max(0, Math.floor(up ? above : below)), height = Math.min(size.height, maxHeight);
    const top = up ? Math.max(edge, anchor.top - gap - height) : Math.max(edge, Math.min(anchor.bottom + gap, view.height - edge - height));
    const left = Math.max(edge, Math.min(anchor.left - 6, view.width - edge - size.width));
    return { top: Math.round(top), left: Math.round(left), maxHeight: Math.min(320, maxHeight), up };
}
function inlineCanPortal() { return typeof ReactDOM !== "undefined" && !!ReactDOM && typeof ReactDOM.createPortal === "function" && typeof document !== "undefined" && !!document.body; }
// the one popup stack (ui-design §三.16). Every fork popup — dialogs (Modal, CatSheet,
// ConfirmDialog, LargeModal) and menus (the panel's anchored menus, the inline menus / colour picker) — registers while it is open, in opening
// order. A press outside the topmost popup closes only that popup; Esc does the same. A press while a text box inside the
// topmost popup holds an unsaved edit (data-fork-draft) closes nothing: it only ends the edit (the field saves on blur, or
// keeps an invalid draft with its message), so typed text is never lost. A press inside a layer mounted after the topmost
// popup (e.g. a 「?」 tip floating above a dialog) belongs to that popup.
const overlayStack = [];
let overlayInstalled = false;
function overlayLayer(node) { while (node && node.parentNode && node.parentNode !== document.body) node = node.parentNode; return node && node.parentNode === document.body ? node : null; }
function overlayOwns(entry, target) {
    const nodes = entry.nodes().filter(Boolean);
    if (nodes.some(node => node.contains && node.contains(target))) return true;
    const mine = nodes.length ? overlayLayer(nodes[0]) : null, theirs = overlayLayer(target);
    return !!(mine && theirs && mine !== theirs && mine.compareDocumentPosition && (mine.compareDocumentPosition(theirs) & 4));
}
function overlayEditing(entry) {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return !!(active && active.closest && active.closest("[data-fork-draft]") && entry.nodes().some(node => node && node.contains && node.contains(active)));
}
// Esc: closes the topmost popup. Returns false when no popup is open (the caller's own Esc behaviour applies).
function overlayEscape(event) {
    const top = overlayStack[overlayStack.length - 1];
    if (!top) return false;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    top.close("escape");
    return true;
}
function overlayInstall() {
    if (overlayInstalled || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    overlayInstalled = true;
    document.addEventListener("pointerdown", function (event) {
        const top = overlayStack[overlayStack.length - 1], target = event.target;
        if (!top || !target || target.isConnected === false || overlayOwns(top, target) || overlayEditing(top)) return;
        top.close("outside");
    }, true);
    // Bubble phase: a popup's own Esc handling (an inline edit being cancelled, a menu returning focus) runs first.
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !event.defaultPrevented) overlayEscape(event); });
}
function overlayPush(entry) {
    overlayInstall(); overlayStack.push(entry);
    return function () { const at = overlayStack.indexOf(entry); if (at >= 0) overlayStack.splice(at, 1); };
}
// useOverlay(open, nodes() → [elements that count as inside], close(reason)) — registers while `open`.
function useOverlay(open, nodes, close) {
    const latest = React.useRef(null);
    latest.current = { nodes, close };
    React.useEffect(function () {
        if (!open) return undefined;
        return overlayPush({ nodes: () => latest.current.nodes() || [], close: reason => latest.current.close(reason) });
    }, [open]);
}
function useInlinePopup() {
    const [open, setOpen] = React.useState(false), [place, setPlace] = React.useState(null), root = React.useRef(null), trigger = React.useRef(null), pop = React.useRef(null);
    const close = refocus => { setOpen(false); setPlace(null); if (refocus && trigger.current && trigger.current.focus) trigger.current.focus(); };
    const floating = inlineCanPortal();
    // outside press / Esc through the shared popup stack (only the topmost popup closes).
    useOverlay(open, () => [root.current, pop.current], reason => { setOpen(false); setPlace(null); if (reason === "escape" && trigger.current && trigger.current.focus) trigger.current.focus(); });
    (React.useLayoutEffect || React.useEffect)(function () {
        if (!open || !floating || typeof window === "undefined") return;
        const update = () => {
            const anchor = trigger.current && trigger.current.getBoundingClientRect ? trigger.current.getBoundingClientRect() : null, node = pop.current;
            if (!anchor || !node) return;
            if (anchor.bottom < 0 || anchor.top > window.innerHeight) { setOpen(false); setPlace(null); return; }
            const next = inlinePlace(anchor, { width: node.offsetWidth, height: Math.min(320, Math.max(node.offsetHeight, node.scrollHeight)) }, { width: window.innerWidth, height: window.innerHeight });
            setPlace(p => p && p.top === next.top && p.left === next.left && p.maxHeight === next.maxHeight ? p : next);
        };
        update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
        return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
    }, [open, floating]);
    React.useEffect(function () {
        // A portalled menu is hidden until measured; focusing it earlier silently fails.
        const node = pop.current; if (!open || (floating && !place) || !node || !node.querySelector) return;
        if (!floating && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
        const first = node.querySelector('[aria-checked="true"]:not(:disabled),[aria-pressed="true"]') || node.querySelector("button:not(:disabled),input");
        if (first && first.focus) first.focus({ preventScroll: true });
    }, [open, floating, Boolean(place)]);
    const keys = event => {
        if (!open) return;
        if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(true); }
        else if (event.key === "Tab") { if (floating && pop.current && pop.current.contains(event.target)) { event.preventDefault(); close(true); } else close(false); }
    };
    // The popup element: props of the .fork-inline-pop node and its children.
    const layer = (props, ...children) => {
        const style = floating ? { position: "fixed", top: place ? place.top : -9999, left: place ? place.left : -9999, maxHeight: place ? place.maxHeight : undefined, visibility: place ? undefined : "hidden" } : undefined;
        const node = React.createElement("div", { ...props, ref: pop, style, "data-floating": floating || undefined, "data-up": place && place.up || undefined }, ...children);
        return floating ? ReactDOM.createPortal(React.createElement("div", { className: "ap-ui ap-layer fork-inline-layer" }, node), document.body) : node;
    };
    return { open, setOpen: next => { if (!next) setPlace(null); setOpen(next); }, close, root, trigger, pop, keys, layer };
}
// ↑ ↓ Home End walk a menu's items.
function inlineMenuKeys(event) {
    const items = [...event.currentTarget.querySelectorAll('[role^="menuitem"]:not(:disabled)')], i = items.indexOf(document.activeElement), n = items.length;
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[event.key];
    if (next === undefined || !n) return;
    event.preventDefault(); items[(next + n) % n].focus();
}
function inlineNumberProblem(text, p, name) {
    if (!text.trim()) return p.optional ? "" : "请填写" + name;
    const n = Number(text);
    if (!Number.isFinite(n) || (p.integer && !Number.isInteger(n))) return name + "需为" + (p.integer ? "整数" : "数字");
    if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) return name + "需为 " + (p.min ?? "") + "–" + (p.max ?? "") + (p.unit ? " " + p.unit : "");
    return "";
}
// text / number: always a real text box, drawn as plain text; hover / focus / ✎ are the shared `fork-edit` look (theme.css
// 「fork inline edit」, ui-design.md R23). It grows with its text (a mirrored span sizes the grid cell), so the value sits
// right after the label.
function InlineText(p) {
    const h = React.createElement, number = p.kind === "number", shown = v => v === null || v === undefined ? "" : String(v);
    const [draft, setDraft] = React.useState(shown(p.value)), last = React.useRef(shown(p.value)), focused = React.useRef(false), cancelled = React.useRef(false);
    React.useEffect(function () { const next = shown(p.value); if (next !== last.current) { last.current = next; if (!focused.current) { setDraft(next); p.report(""); } } }, [p.value]);
    function commit() {
        const text = number || p.trim !== false ? draft.trim() : draft;
        if (text === last.current) { p.report(""); if (text !== draft) setDraft(text); return true; }
        const problem = (number ? inlineNumberProblem(text, p, p.name) : "") || "", value = number ? (text ? Number(text) : null) : text;
        const message = problem || (p.validate ? p.validate(value) || "" : "");
        p.report(message);
        if (message) return false;
        last.current = text; setDraft(text); p.onCommit(value); return true;
    }
    const step = dir => { const n = Number(draft); if (!Number.isFinite(n)) return; let v = n + dir * (p.step || 1); if (p.min !== undefined) v = Math.max(p.min, v); if (p.max !== undefined) v = Math.min(p.max, v); setDraft(String(+v.toFixed(6))); p.report(""); };
    const keys = event => {
        if (event.key === "Enter") { event.preventDefault(); if (commit() && event.currentTarget && event.currentTarget.blur) event.currentTarget.blur(); }
        else if (event.key === "Escape" && (draft !== last.current || p.error)) { event.stopPropagation(); event.preventDefault(); cancelled.current = true; setDraft(last.current); p.report(""); if (event.currentTarget && event.currentTarget.blur) event.currentTarget.blur(); }
        else if (number && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); step(event.key === "ArrowUp" ? 1 : -1); }
    };
    // `multiline` (text only) — a paragraph that wraps inside the value
    // column instead of scrolling sideways: a borderless text area that grows with its text (the same mirrored span sizes
    // it). It stays one paragraph: Enter saves like the one-line box, typed / pasted line breaks become spaces.
    // `lines` keeps line breaks (a 演出风格 text); Shift+Enter adds one.
    // `count` (with maxLength) shows a quiet 「n/max」 under the text only
    // once the draft reaches 90% of the limit.
    const count = p.count && p.maxLength && draft.length >= p.maxLength * 0.9 ? h("span", { className: "fork-inline-count", "aria-live": "polite", "data-full": draft.length >= p.maxLength || undefined }, draft.length + "/" + p.maxLength) : null;
    if (p.multiline && !number) return h(React.Fragment, null, h("span", { className: "fork-inline-edit is-multiline", "data-value": (draft || p.placeholder || "") + " " },
        h("textarea", { ref: p.controlRef, className: "fork-inline-input fork-edit" + (p.controlClassName ? " " + p.controlClassName : ""), rows: 1,
            value: draft, placeholder: p.placeholder, maxLength: p.maxLength, spellCheck: false, autoComplete: "off",
            disabled: p.disabled, title: p.title, "aria-label": p.name, "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? p.errorId : undefined, "data-fork-draft": draft !== last.current || undefined,
            onFocus: () => { focused.current = true; }, onChange: event => { setDraft(p.lines ? event.target.value.replace(/\r\n?/g, "\n") : event.target.value.replace(/\s*[\r\n]+\s*/g, " ")); p.report(""); },
            onKeyDown: event => { if (p.lines && event.key === "Enter" && event.shiftKey) return; keys(event); },
            onBlur: () => { focused.current = false; if (cancelled.current) { cancelled.current = false; return; } commit(); } })), count);
    // `secret` masks the value (a password box) and the sizing mirror only counts it.
    return h(React.Fragment, null,
        h("span", { className: "fork-inline-edit", "data-value": ((p.secret ? "•".repeat(draft.length) : draft) || p.placeholder || "") + " " },
            h("input", { ref: p.controlRef, className: "fork-inline-input fork-edit" + (p.controlClassName ? " " + p.controlClassName : ""), type: p.secret ? "password" : "text", size: 1, list: p.list,
                inputMode: number ? (p.integer ? "numeric" : "decimal") : undefined, value: draft, placeholder: p.placeholder, maxLength: p.maxLength, spellCheck: false, autoComplete: p.secret ? "new-password" : "off",
                disabled: p.disabled, title: p.title, "aria-label": p.name, "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? p.errorId : undefined, "data-fork-draft": draft !== last.current || undefined,
                onFocus: () => { focused.current = true; }, onChange: event => { setDraft(event.target.value); p.report(""); }, onKeyDown: keys,
                onBlur: () => { focused.current = false; if (cancelled.current) { cancelled.current = false; return; } commit(); } })),
        p.unit ? h("span", { className: "fork-inline-unit" }, p.unit) : null);
}
function InlineMenu(p) {
    const h = React.createElement, pop = useInlinePopup(), options = p.options || [], current = options.find(o => o.value === p.value);
    const pick = value => { pop.close(true); if (value !== p.value) p.onCommit(value); };
    return h("span", { className: "fork-inline-anchor", ref: pop.root, onKeyDown: pop.keys },
        h("button", { ref: node => { pop.trigger.current = node; if (p.controlRef) p.controlRef.current = node; }, type: "button", className: "fork-inline-trigger" + (p.controlClassName ? " " + p.controlClassName : ""),
            disabled: p.disabled, title: p.title, "aria-haspopup": "menu", "aria-expanded": pop.open, "aria-label": p.name + "：" + (current ? current.label : p.placeholder || "未设置"),
            "data-empty": current ? undefined : true, onClick: () => pop.setOpen(!pop.open),
            onKeyDown: event => { if (event.key === "ArrowDown" && !pop.open) { event.preventDefault(); pop.setOpen(true); } } },
            h("span", { className: "fork-inline-text" }, current ? current.label : p.placeholder || "—"), h(InlineGlyph, { name: "chevDown" })),
        pop.open ? pop.layer({ className: "fork-inline-pop", role: "menu", "aria-label": p.name, onKeyDown: inlineMenuKeys },
            options.flatMap((o, i) => [
                // a group heading (e.g. the provider above its models).
                o.group && (i === 0 || options[i - 1].group !== o.group) ? h("div", { key: "group:" + i, role: "presentation", className: "fork-inline-group" }, o.group) : null,
                // `disabled` greys an option out (↑ ↓ skip it); `note` is a short
                // reason after its label (「不支持工具调用」).
                h("button", { key: String(o.value), type: "button", role: "menuitemradio", "aria-checked": o.value === p.value, className: "fork-inline-option" + (o.group ? " is-grouped" : ""), title: o.title, disabled: o.disabled || undefined, onClick: () => pick(o.value) },
                    h("span", null, o.label), o.note ? h("span", { className: "fork-inline-option-note" }, o.note) : null, o.value === p.value ? h(InlineGlyph, { name: "check" }) : null)])) : null);
}
function InlineColor(p) {
    const h = React.createElement, pop = useInlinePopup(), value = p.value || "", effective = value || p.auto || "#808080", autoLabel = p.autoLabel || "自动", [hexError, setHexError] = React.useState("");
    const pick = next => { pop.close(true); if ((next || "") !== value) p.onCommit(next); };
    // no preset palettes; unless the caller's data declares one, the swatches are shades of
    // the automatic colour (else the current value), figureColorShades in shared/figure-auto-color.cjs.
    const palette = p.palette || (typeof figureColorShades === "function" ? figureColorShades(/^#[0-9a-f]{6}$/i.test(p.auto || "") ? p.auto : value) : []);
    return h("span", { className: "fork-inline-anchor", ref: pop.root, onKeyDown: pop.keys },
        h("button", { ref: node => { pop.trigger.current = node; if (p.controlRef) p.controlRef.current = node; }, type: "button", className: "fork-inline-trigger is-swatch" + (p.controlClassName ? " " + p.controlClassName : ""),
            disabled: p.disabled, title: p.title || (value ? p.name : p.name + "（" + autoLabel + "）"), "aria-haspopup": "dialog", "aria-expanded": pop.open, "aria-label": p.name + "：" + (value ? value : autoLabel),
            "data-auto": value ? undefined : true, onClick: () => pop.setOpen(!pop.open) },
            h("span", { className: "fork-inline-swatch", style: { "--swatch": effective } })),
        pop.open ? pop.layer({ className: "fork-inline-pop is-palette", role: "dialog", "aria-label": p.name },
            p.allowAuto !== false ? h("button", { type: "button", className: "fork-inline-option", "aria-label": autoLabel + p.name, "aria-pressed": !value, onClick: () => pick(null) },
                h("span", { className: "fork-inline-swatch", style: { "--swatch": p.auto || "#808080" } }), h("span", null, autoLabel), !value ? h(InlineGlyph, { name: "check" }) : null) : null,
            palette.length ? h("div", { className: "fork-inline-palette", role: "group", "aria-label": "常用颜色" }, palette.map(c => h("button", { key: c, type: "button", className: "fork-inline-palette-swatch",
                "aria-label": p.name + " " + c, "aria-pressed": c.toLowerCase() === value.toLowerCase(), style: { "--swatch": c }, onClick: () => pick(c) }))) : null,
            h(InlineField, { kind: "text", label: "色值", controlLabel: p.name + "色值", value, placeholder: "#RRGGBB", maxLength: 7,
                validate: v => /^#[0-9a-f]{6}$/i.test(v) ? "" : "请输入 #RRGGBB", onCommit: v => pick(v) })) : null);
}
// `suggest` (string[], best first) turns the ＋ field into a combobox. Focus shows
// the candidates not yet chosen; typing filters them live (case-insensitive substring, prefix matches first); ↑ ↓ move,
// Enter / click adds the highlighted one, and when nothing matches exactly the last row is 「新建“xxx”」. Comma, 、 and blur still
// add the typed text as it is. Esc closes the list first, then clears the draft.
const CHIP_SUGGEST_MAX = 30;
function chipSuggestions(candidates, words, draft) {
    const q = String(draft || "").trim().toLowerCase(), taken = new Set(words.map(w => String(w).toLowerCase())), seen = new Set(), head = [], rest = [];
    for (const word of candidates || []) {
        const low = String(word).toLowerCase();
        if (!low || taken.has(low) || seen.has(low)) continue;
        seen.add(low);
        if (!q) head.push(word); else if (low.startsWith(q)) head.push(word); else if (low.includes(q)) rest.push(word);
    }
    const matches = head.concat(rest).slice(0, CHIP_SUGGEST_MAX), raw = String(draft || "").trim();
    const create = !!q && !taken.has(q) && !matches.some(w => String(w).toLowerCase() === q);
    return create ? matches.concat([{ create: raw }]) : matches;
}
function InlineChips(p) {
    const h = React.createElement, words = p.value || [], [draft, setDraft] = React.useState(""), addLabel = p.addLabel || "添加" + p.name;
    const split = p.split || (text => [...new Set(String(text || "").split(/[,，、\n]/).map(w => w.trim()).filter(Boolean))]);
    const suggesting = Array.isArray(p.suggest), pop = useInlinePopup(), [listOpen, setListOpen] = React.useState(false), [active, setActive] = React.useState(0);
    const listId = (p.errorId || "fork-chips") + "-list", options = suggesting && listOpen ? chipSuggestions(p.suggest, words, draft) : [];
    const show = listOpen && options.length > 0, at = Math.min(active, options.length - 1);
    // The open add box is wider (96px) and can wrap the chips onto another line. A press elsewhere blurs it on mousedown;
    // collapsing then would move what was pressed before mouseup, so the click missed (375px: the rule's 「内容」 ＋ under a
    // focused 关键词 box). The box keeps its open width until that press ends (its click, or the keyup of a Tab).
    const [held, setHeld] = React.useState(false);
    const release = () => { const d = globalThis.document; if (!d || !d.addEventListener) { setHeld(false); return; }
        const done = () => { d.removeEventListener("click", done, true); d.removeEventListener("keyup", done, true); setHeld(false); };
        d.addEventListener("click", done, true); d.addEventListener("keyup", done, true); };
    React.useEffect(function () { if (suggesting && show !== pop.open) pop.setOpen(show); }, [show]);
    function add(text) {
        const typed = text === undefined ? draft : text;
        if (!typed.trim()) return true;
        const next = [...new Set([...words, ...split(typed)])], problem = p.validate ? p.validate(next) || "" : "";
        p.report(problem); if (problem) return false;
        setDraft(""); setActive(0); if (next.length !== words.length) p.onCommit(next); return true;
    }
    const choose = option => add(typeof option === "string" ? option : option.create);
    const optionId = i => listId + "-" + i;
    const list = show ? pop.layer({ id: listId, className: "fork-inline-pop fork-chip-suggest", role: "listbox", "aria-label": addLabel,
            onPointerDown: event => event.preventDefault(), onMouseDown: event => event.preventDefault() },
        options.map((o, i) => h("div", { key: typeof o === "string" ? "w:" + o : "new", id: optionId(i), role: "option", "aria-selected": i === at, className: "fork-chip-option" + (typeof o === "string" ? "" : " is-create"),
            onPointerEnter: () => setActive(i), onClick: () => choose(o) },
            typeof o === "string" ? o : h(React.Fragment, null, h(InlineGlyph, { name: "plus" }), h("span", null, "新建“" + o.create + "”"))))) : null;
    return h("span", { className: "fork-inline-chips", ref: suggesting ? pop.root : undefined },
        words.map((word, index) => h("span", { key: word, className: "fork-inline-chip" }, p.chipMenu
                ? h(InlineChipMenu, { word, index, p })
                : p.onPick
                ? h("button", { type: "button", className: "fork-inline-chip-pick", title: p.pickTitle || "只看「" + word + "」", "aria-label": (p.pickTitle || "筛选") + " " + word, onClick: () => p.onPick(word, index) }, word)
                : h("span", null, word),
            h("button", { type: "button", className: "fork-inline-chip-remove", disabled: p.disabled, "aria-label": "删除" + p.name + " " + word, title: "删除", onClick: () => p.onCommit(words.filter(w => w !== word)) }, h(InlineGlyph, { name: "close" })))),
        h("label", { className: "fork-inline-chip-add", ref: suggesting ? pop.trigger : undefined, "data-draft": draft ? true : undefined, "data-held": held || undefined, title: addLabel, onFocus: () => setHeld(true) }, h(InlineGlyph, { name: "plus" }),
            h("input", { ref: p.controlRef, className: "fork-inline-input", type: "text", size: 1, value: draft, disabled: p.disabled, spellCheck: false, autoComplete: "off", "aria-label": addLabel, "data-fork-draft": draft ? true : undefined,
                "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? p.errorId : undefined,
                ...(suggesting ? { role: "combobox", "aria-autocomplete": "list", "aria-expanded": show, "aria-controls": show ? listId : undefined, "aria-activedescendant": show ? optionId(at) : undefined,
                    onFocus: () => { setListOpen(true); setActive(0); }, onClick: () => setListOpen(true) } : {}),
                onChange: event => { setDraft(event.target.value); setActive(0); if (suggesting) setListOpen(true); p.report(""); },
                onKeyDown: event => {
                    if (suggesting && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                        event.preventDefault(); event.stopPropagation();
                        if (!show) { setListOpen(true); setActive(0); return; }
                        setActive((at + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
                    }
                    else if (suggesting && show && (event.key === "Home" || event.key === "End") && !draft) { event.preventDefault(); setActive(event.key === "Home" ? 0 : options.length - 1); }
                    else if (event.key === "Enter" && show && options[at] !== undefined) { event.preventDefault(); choose(options[at]); }
                    else if (event.key === "Enter" || event.key === "," || event.key === "，" || event.key === "、") { event.preventDefault(); add(); }
                    else if (event.key === "Escape" && show) { event.stopPropagation(); event.preventDefault(); setListOpen(false); }
                    else if (event.key === "Escape" && (draft || p.error)) { event.stopPropagation(); event.preventDefault(); setDraft(""); p.report(""); }
                    else if (event.key === "Tab") setListOpen(false);
                },
                onBlur: () => { setListOpen(false); add(); release(); } })),
        list);
}
// a chip with its own menu. chipMenu(word, index) → [{value, label, checked}] (read when
// it opens), onChipMenu(word, index, value) applies the pick, chipTag(word, index) → {text, tone} | null draws a short tag
// before the word (data-tone styles it). The word is the trigger: click / Enter / ↓ opens, ↑↓ Home End move, Esc closes.
function InlineChipMenu({ word, index, p }) {
    const h = React.createElement, pop = useInlinePopup(), tag = p.chipTag ? p.chipTag(word, index) : null, items = pop.open ? p.chipMenu(word, index) || [] : [];
    const pick = value => { pop.close(true); p.onChipMenu(word, index, value); };
    // The shared popup focuses the ticked item once the menu is placed; a second, frame-late focus here pulled a reader who
    // had already moved on (↓ End) back to it, so Enter picked the old kind. ↓ on the word returns into an open menu.
    const focusItem = () => { const node = pop.pop.current; const item = node && (node.querySelector('[aria-checked="true"]') || node.querySelector("button")); if (item) item.focus({ preventScroll: true }); };
    return h("span", { className: "fork-inline-anchor", ref: pop.root, onKeyDown: pop.keys },
        h("button", { ref: pop.trigger, type: "button", className: "fork-inline-chip-pick", disabled: p.disabled, title: p.chipMenuTitle || undefined, "aria-haspopup": "menu", "aria-expanded": pop.open,
            "aria-label": (tag ? tag.text + " " : "") + word, onClick: () => pop.setOpen(!pop.open),
            onKeyDown: event => { if (event.key === "ArrowDown") { event.preventDefault(); if (pop.open) focusItem(); else pop.setOpen(true); } } },
            tag ? h("span", { className: "fork-inline-chip-tag", "data-tone": tag.tone || undefined }, tag.text) : null, word),
        pop.open ? pop.layer({ className: "fork-inline-pop", role: "menu", "aria-label": p.name + " " + word, onKeyDown: inlineMenuKeys },
            items.map(o => h("button", { key: String(o.value), type: "button", role: "menuitemradio", "aria-checked": !!o.checked, className: "fork-inline-option", onClick: () => pick(o.value) },
                h("span", null, o.label), o.checked ? h(InlineGlyph, { name: "check" }) : null))) : null);
}
function InlineLink(p) {
    const h = React.createElement;
    return h("button", { ref: p.controlRef, type: "button", className: "fork-inline-trigger is-link" + (p.controlClassName ? " " + p.controlClassName : ""), disabled: p.disabled, title: p.title,
            "aria-label": p.ariaLabel || p.name + "：" + (p.value || p.placeholder || "未设置"), "data-empty": p.value ? undefined : true, onClick: p.onOpen },
        p.before || null, h("span", { className: "fork-inline-text" }, p.value || p.placeholder || "—"), p.after || null, h(InlineGlyph, { name: "chevRight" }));
}
const INLINE_KINDS = { text: InlineText, number: InlineText, menu: InlineMenu, color: InlineColor, chips: InlineChips, link: InlineLink };
function InlineField(props) {
    const h = React.createElement, p = props || {}, kind = INLINE_KINDS[p.kind] ? p.kind : "text", root = React.useRef(null);
    const [own, setError] = React.useState(""), id = React.useId ? React.useId() : "fork-inline", errorId = id + "-error";
    // `error`: a message the owner sets after its submit (the 新人物 page); the field's own validate message wins while typing.
    const error = own || p.error || "";
    const name = p.controlLabel || (typeof p.label === "string" ? p.label : "");
    // the hit area is the whole field, not the text's width. A click on the
    // label (not on its 「?」), the gap or the empty part of the value cell reaches the control as if it were clicked: a
    // text / number box takes focus with the caret at the end, a menu / colour / link opens, chips focus their ＋ field.
    // Clicks on a real control (the value itself, a trail button), in an open popup or from a portal are left alone.
    const activate = event => {
        const node = root.current, target = event.target;
        if (p.disabled || !node || !target || !target.closest || !node.contains(target)) return;
        const hit = target.closest("button, input, textarea, select, a, label, [role], [tabindex], .fork-inline-pop, .fork-inline-error");
        if ((hit && node.contains(hit)) || target.closest(".fork-inline-field") !== node) return;
        const control = node.querySelector(kind === "chips" ? ".fork-inline-chip-add input" : ".fork-inline-value input, .fork-inline-value textarea, .fork-inline-value button");
        if (!control || control.disabled) return;
        if (control.tagName === "INPUT" || control.tagName === "TEXTAREA") { control.focus(); const end = control.value.length; try { control.setSelectionRange(end, end); } catch (_) { /* not a text box */ } }
        else if (control.click) control.click();
    };
    // `autoEdit` (a row the grid just took out of its 「＋ 名称」 chip): focus the control once, like a click on the field.
    React.useEffect(function () {
        const node = root.current;
        if (!p.autoEdit || !node || !node.querySelector) return;
        const control = node.querySelector(kind === "chips" ? ".fork-inline-chip-add input" : ".fork-inline-value input, .fork-inline-value textarea, .fork-inline-value button");
        if (control && control.focus) control.focus();
    }, []);
    return h("div", { ref: root, className: "fork-inline-field" + (p.className ? " " + p.className : ""), "data-kind": kind, "data-add-key": p.addKey, "data-multiline": p.multiline && kind === "text" || undefined, "data-wide": p.wide || undefined, "data-bare": p.hideLabel || undefined, "data-invalid": error ? true : undefined, "data-disabled": p.disabled || undefined, onClick: activate },
        h("span", { className: "fork-inline-label" + (p.hideLabel ? " is-hidden" : "") }, h("span", { className: "fork-inline-label-text" }, p.label), p.help || null),
        h("span", { className: "fork-inline-value" }, h(INLINE_KINDS[kind], { ...p, kind, name, error, errorId, report: setError }), p.trail || null),
        error ? h("span", { className: "fork-inline-error", id: errorId, role: "alert" }, error) : null);
}
// <InlineRow label help? multiline? wide? className?>children</InlineRow>
// — the same 「label value」 row for a value that is not a text / menu / colour (a switch, a slider, a segmented choice,
// a multi-line text), so it lines up with the fields around it. `multiline` tops the label for a text area.
function InlineRow(props) {
    const h = React.createElement, p = props || {};
    return h("div", { className: "fork-inline-field" + (p.className ? " " + p.className : ""), "data-kind": p.multiline ? "multiline" : "custom", "data-wide": p.wide || undefined },
        h("span", { className: "fork-inline-label" }, h("span", { className: "fork-inline-label-text" }, p.label), p.help || null),
        h("span", { className: "fork-inline-value" }, p.children));
}
// a grid shows no empty rows. A field marked
// `hideEmpty` whose value is empty ('' / null / [] / 0) leaves its row and becomes a small dashed 「＋ 名称」 chip; the chips
// share one line at the grid's end. A click (Enter / Space) puts the row back in its place and focuses it; leaving it
// still empty (blur, or Esc) folds it back into its chip (Esc returns the focus to the chip). Rows with a value, menus,
// switches and InlineRow are never hidden. The one implementation for every 素材库 entry view (ui-design R4).
// An empty optional *section* (an entry's 变体 without a table, 观众群 预设弹幕 / 接话 without rules) is not shown
// at all: its owner puts <InlineSectionAdd key label onAdd /> among the grid's children and it becomes one more 「＋ 名称」 chip
// on the same line; the click is the section's own add (the section then appears with what was added). `render(chip)`
// replaces the plain button when the add needs a menu: chip = { props, children } for the trigger button.
function InlineSectionAdd() { return null; }
const inlineEmptyValue = v => v === null || v === undefined || v === "" || v === 0 || (Array.isArray(v) && !v.length);
const inlineDraftEmpty = node => !node.querySelector(".fork-inline-chip") && [...node.querySelectorAll("input, textarea")].every(input => !String(input.value || "").trim());
function InlineGrid(props) {
    const h = React.createElement, p = props || {}, root = React.useRef(null);
    const [opened, setOpened] = React.useState(() => new Set()), [refocus, setRefocus] = React.useState(null);
    const rows = [], adds = [];
    // A row's identity for its chip: its own key, else its position among the children as written.
    const clone = (child, extra) => React.cloneElement ? React.cloneElement(child, extra) : h(child.type, { ...child.props, ...extra });
    [].concat(p.children).flat(Infinity).forEach((child, index) => {
        if (child === null || child === undefined || child === false || child === true) return;
        const q = child.props, key = child.key ?? "i" + index;
        if (!q) { rows.push(child); return; }
        if (child.type === InlineSectionAdd) { adds.push({ key, name: q.label, control: q.label, onAdd: q.onAdd, render: q.render }); return; }
        if (!q.hideEmpty) { rows.push(child); return; }
        const empty = inlineEmptyValue(q.value), open = opened.has(key);
        if (empty && !open) adds.push({ key, name: typeof q.label === "string" ? q.label : q.controlLabel || "", control: q.controlLabel || (typeof q.label === "string" ? q.label : "") });
        else rows.push(clone(child, { addKey: key, autoEdit: open && empty }));
    });
    const fold = (key, chip) => { setOpened(s => { const next = new Set(s); next.delete(key); return next; }); if (chip) setRefocus(key); };
    const field = target => target && target.closest ? target.closest("[data-add-key]") : null;
    React.useEffect(function () {
        if (refocus === null || !root.current) return;
        const chip = [...root.current.querySelectorAll("[data-add-chip]")].find(node => node.getAttribute("data-add-chip") === refocus);
        if (chip && chip.focus) chip.focus();
        setRefocus(null);
    }, [refocus]);
    return h("div", { ref: root, className: "fork-inline-grid" + (p.className ? " " + p.className : ""), role: "group", "aria-label": p.label, "data-columns": p.columns || 2,
            onBlur: event => {
                const node = field(event.target);
                if (!node || node.contains(event.relatedTarget)) return;
                const key = node.getAttribute("data-add-key");
                // Next tick: an Esc that reverts a typed draft has updated the box by then.
                setTimeout(() => { if (opened.has(key) && !node.contains(document.activeElement) && inlineDraftEmpty(node)) fold(key, false); }, 0);
            },
            onKeyDown: event => {
                if (event.key !== "Escape" || event.defaultPrevented) return;
                const node = field(event.target), key = node && node.getAttribute("data-add-key");
                if (!node || !opened.has(key) || !inlineDraftEmpty(node)) return;
                event.preventDefault(); event.stopPropagation(); fold(key, true);
            } },
        ...rows,
        adds.length ? h("div", { className: "fork-inline-adds" }, adds.map(add => {
            const chip = { props: { type: "button", className: "fork-inline-add-field", "data-add-chip": add.key, "aria-label": "添加" + add.control, title: "添加" + add.control, disabled: p.disabled || undefined },
                children: [h(InlineGlyph, { key: "g", name: "plus" }), h("span", { key: "t" }, add.name)] };
            if (add.render) return h(React.Fragment, { key: add.key }, add.render(chip));
            return h("button", { key: add.key, ...chip.props, onClick: add.onAdd ? () => add.onAdd() : () => setOpened(s => new Set(s).add(add.key)) }, ...chip.children);
        })) : null);
}
// the one search box — the only boxed text input, here at the outer level
// so the panels' PackSearchBox, the BGM player and the bubble voice / portrait menu share it. <SearchBox value onChange(text)
// label placeholder className icon inputClassName inputRef autoFocus onKeyDown disabled spellCheck bare>: a <label.className>
// around `icon` (the caller's magnifier glyph, optional) and an <input type=search>; `bare` returns the input alone for a
// row that draws its own frame (the Fish voice finder, the voice menu filter).
// `inputProps` are extra attributes for the input (the data picker's combobox role, aria-*,
// focus / blur), so a filter field that opens a list stays this one input.
function SearchBox(props) {
    const h = React.createElement, p = props || {};
    const input = h("input", { ref: p.inputRef, type: "search", className: p.inputClassName || undefined, "aria-label": p.label, placeholder: p.placeholder === undefined ? p.label : p.placeholder,
        value: p.value, disabled: p.disabled || undefined, autoFocus: p.autoFocus || undefined, spellCheck: p.spellCheck, onKeyDown: p.onKeyDown, onChange: e => p.onChange(e.target.value), ...p.inputProps });
    if (p.bare) return input;
    return h("label", { className: p.className || "ap-search" }, p.icon || null, input);
}
// the one empty state of every list, grid,
// panel and picker in the client. Centred in its column with room around it: a quiet icon, one short line that says why,
// at most one action. A search that found nothing reads 「没有找到「xxx」」, an active filter 「没有「绿灯」人物」, and both offer
// 清除 (onClear); a truly empty list reads 「还没有<noun>」 with no action — its add control is already above it (R13) —
// unless the caller passes the view's own one (`action`, e.g. 添加文件 in an empty pack). Styles: `.fork-empty` (theme.css).
// props: { noun, query, filter, onClear, text (overrides the line), icon (glyph name or node for the truly empty case),
//   action (element), compact (menus and pickers), plain (a search that found nothing: only the muted line — no glyph, no 清除搜索,
//   the search box clears itself), className }.
const EMPTY_GLYPHS = { search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3 13.5 13.5", filter: "M2.5 4h11M4.5 8h7M6.5 12h3",
    empty: "M2.5 9 4.2 3.5h7.6L13.5 9v3.5h-11zM2.5 9h3l.8 1.5h3.4l.8-1.5h3", off: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM4.2 4.2l7.6 7.6" };
// the one per-panel error boundary inside 舞台设置 and the 素材库 editor. A panel
// (a StageSection body, the entry list, an entry's detail) that throws while rendering shows only ⚠ 「这一项暂时无法显示」 + 重试 in
// its own place — never the exception text — and every sibling panel keeps working; the error goes to the console for
// debugging. <PanelBoundary name resetKey lead>children</PanelBoundary>: `lead` (optional) stays above the line in
// the failed state (a phone detail pane's ‹ back, so the page is never a dead end); a new `resetKey` (another entry, a new pack
// revision) or 重试 renders the children again. The class is made on first use (React is the host's, absent at bundle load).
let panelBoundaryType = null;
function PanelBoundary(props) {
    const h = React.createElement;
    if (!panelBoundaryType) panelBoundaryType = class PanelBoundaryView extends React.Component {
        constructor(p) { super(p); this.state = { failed: false }; this.retry = () => this.setState({ failed: false }); }
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch(error, info) { console.error("[dsh-tavern] panel " + (this.props.name || "") + " failed to render:", error, info && info.componentStack || ""); }
        componentDidUpdate(prev) { if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false }); }
        render() {
            if (!this.state.failed) return this.props.children === undefined ? null : this.props.children;
            const line = h("p", { className: "ap-hint-line fork-panel-error", role: "alert", "data-panel": this.props.name || undefined },
                h("span", { className: "ap-hint-mark", "aria-hidden": true }, h(InlineGlyph, { name: "warning" })),
                h("span", null, "这一项暂时无法显示"),
                h("button", { type: "button", className: "ap-hint-chip", onClick: this.retry }, "重试"));
            return this.props.lead ? h(React.Fragment, null, this.props.lead, line) : line;
        }
    };
    return h(panelBoundaryType, props);
}
function EmptyState(props) {
    const h = React.createElement, p = props || {};
    const q = String(p.query || "").trim(), searching = !!q, filtered = !!p.filter, noun = p.noun || "条目";
    const line = p.text || (searching ? "没有找到「" + q + "」" : filtered ? "没有「" + p.filter + "」" + noun : "还没有" + noun);
    const quiet = !!p.plain && searching && !filtered;
    const clear = !quiet && (searching || filtered) && p.onClear ? (searching && filtered ? "清除搜索和筛选" : searching ? "清除搜索" : "清除筛选") : "";
    const name = searching ? "search" : filtered ? "filter" : !p.icon || typeof p.icon === "string" ? p.icon || "empty" : null;
    const icon = name ? h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" },
        h("path", { d: EMPTY_GLYPHS[name] || EMPTY_GLYPHS.empty, stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" })) : p.icon;
    return h("div", { className: "fork-empty" + (p.compact ? " is-compact" : "") + (quiet ? " is-plain" : "") + (p.className ? " " + p.className : ""), role: "status" },
        quiet ? null : h("span", { className: "fork-empty-icon", "aria-hidden": true }, icon),
        h("span", { className: "fork-empty-text" }, line),
        clear ? h("button", { type: "button", className: "fork-empty-action", onClick: e => { if (e && e.stopPropagation) e.stopPropagation(); p.onClear(); } }, clear) : (quiet ? null : (p.action || null)));
}
// the one switch — the only native checkbox (role=switch) in the client,
// here at the outer level so the panels' SwitchRow and the chat-side settings rows (调试视图, card scripts)
// share it. <Switch checked onChange(bool) label id title disabled className bare>: `bare` returns the input alone for a
// row that wraps it in its own <label> (SwitchRow); otherwise the chat skin, <label.dsh-tavern-settings-switch> input + track.
function Switch(props) {
    const h = React.createElement, p = props || {};
    const input = h("input", { id: p.id, type: "checkbox", role: "switch", "aria-label": p.label, checked: !!p.checked, disabled: !!p.disabled, onChange: e => p.onChange(e.target.checked) });
    if (p.bare) return input;
    return h("label", { className: "dsh-tavern-settings-switch" + (p.className ? " " + p.className : ""), title: p.title || undefined }, input, h("span", { className: "dsh-tavern-settings-track", "aria-hidden": true }));
}
// the one segmented choice, here at the outer level so the stage (CONFIG)
// uses the same component as the panels (asset-pack-ui.js `Segmented` is this). `options` are
// [value, text, disabled?, title?, extra button props?]. A radiogroup with a roving tab stop: ← → (↑ ↓) move and choose,
// Home / End jump; aria-pressed is kept for styling. `base` is the skin class (`ap-segmented` in panels,
// `fork-gal-config-seg` on the stage, drawn in --gal-ui-*).
function Segmented(props) {
    const h = React.createElement, p = props || {}, options = p.options || [], value = p.value;
    const live = options.filter(o => !(p.disabled || o[2])), stop = options.some(o => o[0] === value) ? value : live[0] && live[0][0];
    const keys = e => {
        if (p.onKeyDown) p.onKeyDown(e);
        const at = live.findIndex(o => o[0] === value), n = live.length;
        if (e.defaultPrevented || !n) return;
        const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const v = live[(next + n) % n][0];
        if (v !== value) p.onChange(v);
        const i = options.findIndex(o => o[0] === v), buttons = e.currentTarget && e.currentTarget.querySelectorAll ? e.currentTarget.querySelectorAll("button") : null;
        if (buttons && buttons[i] && buttons[i].focus) buttons[i].focus();
    };
    return h("div", { className: (p.base || "ap-segmented") + (p.className ? " " + p.className : ""), role: "radiogroup", "aria-label": p.label, onKeyDown: keys },
        options.map(([v, text, off, title, extra]) => h("button", { key: String(v), type: "button", role: "radio", "aria-checked": value === v, "aria-pressed": value === v,
            tabIndex: v === stop ? 0 : -1, disabled: p.disabled || off || undefined, title, ...extra, onClick: () => { if (value !== v) p.onChange(v); } }, text)));
}
// the one slider — a track (role=slider) with a fill and a thumb, the
// reading beside it. <Slider value min max step label valueText output onChange onCommit reset skin className disabled>
//   onChange(v) follows the drag and every key step (live preview / live setting); onCommit(v) once on release or per key
//   step, only when the value changed. A release also fires a bubbling DOM `change` on the track, like a native range, so
//   delegated listeners (the stage's UI sounds, ui-sfx.js) hear it.
//   Keys: ← ↓ / → ↑ one step, PageDown / PageUp ten, Home / End the ends. Double click goes to `reset` when given.
//   skin: the class prefix — `ap-slider` (panels, --fork-*), `fork-gal-slider` (stage, --gal-ui-*), `fork-bgm-slider` (BGM
//   player, --bgm-*): `<skin>` wraps, `<skin>-track` / `-fill` / `-thumb` draw it; `output` (a node, or shown => node) is the reading; `valueText` likewise.
function sliderSnap(v, min, max, step) { return +Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min)).toFixed(6); }
function Slider(props) {
    const h = React.createElement, p = props || {}, min = p.min ?? 0, max = p.max ?? 1, step = p.step || (max - min) / 100, skin = p.skin || "ap-slider";
    const [draft, setDraft] = React.useState(null), track = React.useRef(null), start = React.useRef(null);
    const value = Number(p.value) || 0, shown = draft ?? value, pct = max > min ? Math.max(0, Math.min(100, (shown - min) / (max - min) * 100)) : 0;
    const at = event => { const r = track.current && track.current.getBoundingClientRect ? track.current.getBoundingClientRect() : null; return r && r.width ? sliderSnap(min + (event.clientX - r.left) / r.width * (max - min), min, max, step) : shown; };
    const changed = () => { const node = track.current; if (node && node.dispatchEvent && typeof Event === "function") node.dispatchEvent(new Event("change", { bubbles: true })); };
    const move = v => { setDraft(v); if (v !== shown && p.onChange) p.onChange(v); };
    const done = (v, from) => { setDraft(null); if (p.onChange) p.onChange(v); if (Math.abs(v - from) > 1e-9) { if (p.onCommit) p.onCommit(v); changed(); } };
    const keys = event => {
        const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[event.key];
        const to = event.key === "Home" ? min : event.key === "End" ? max : by === undefined ? null : sliderSnap(value + by * step, min, max, step);
        if (to === null || p.disabled) return;
        event.preventDefault(); done(to, value);
    };
    return h("div", { className: skin + (p.className ? " " + p.className : ""), "data-disabled": p.disabled || undefined },
        h("div", { ref: track, className: skin + "-track", role: "slider", tabIndex: p.disabled ? -1 : 0, "aria-label": p.label, "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": shown,
            "aria-valuetext": typeof p.valueText === "function" ? p.valueText(shown) : p.valueText, "aria-disabled": p.disabled || undefined, style: { "--slider-fill": pct + "%" },
            onPointerDown: event => { if (p.disabled || event.button > 0) return; if (event.currentTarget && event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId); start.current = value; move(at(event)); },
            onPointerMove: event => { if (draft !== null) move(at(event)); },
            onPointerUp: event => { if (draft !== null) done(at(event), start.current ?? value); },
            onPointerCancel: () => { if (draft !== null) done(draft, start.current ?? value); },
            onDoubleClick: p.reset !== undefined ? () => done(p.reset, value) : undefined, onKeyDown: keys },
            h("span", { className: skin + "-fill", style: { width: pct + "%" } }), h("span", { className: skin + "-thumb", style: { left: pct + "%" } })),
        p.output !== undefined ? h("output", { className: p.outputClassName, "aria-hidden": p.outputHidden || undefined }, typeof p.output === "function" ? p.output(shown) : p.output) : null);
}
// the one draft text area — a paragraph typed before a separate
// 「生成 / 发送 / 保存」 action (unlike InlineField multiline, which saves on Enter). <TextArea value onChange(text, event)
// className inputRef rows maxLength placeholder label autoFocus disabled onKeyDown id …>: it grows with its text from `rows`
// lines up to the skin's max-height (then scrolls); no resize handle. Other props pass through to the <textarea>.
function TextArea(props) {
    const h = React.createElement, p = props || {}, own = React.useRef(null), ref = p.inputRef || own;
    const { inputRef, className, onChange, label, value, ...rest } = p;
    const fit = () => { const el = ref.current; if (!el || !el.style || typeof el.scrollHeight !== "number") return; el.style.height = "auto";
        const edge = (el.offsetHeight || 0) - (el.clientHeight || 0); el.style.height = el.scrollHeight + Math.max(0, edge) + "px"; };
    (React.useLayoutEffect || React.useEffect)(fit, [value]);
    return h("textarea", { ...rest, ref, value: value === null || value === undefined ? "" : value, "aria-label": label || p["aria-label"],
        className: "fork-textarea" + (className ? " " + className : ""), onChange: event => { if (onChange) onChange(event.target.value, event); } });
}
// the one "add a new one by name" control — a dashed ＋ tile that turns
// into a text box in place. Enter confirms (trimmed, not empty), Esc cancels (and does not close the dialog around it).
// <InlineAdd onConfirm(text) onCancel onOpen open? value? onChange? label addLabel placeholder busy disabled invalid
// maxLength type inputMode className inputClassName tileClassName tile bare inputRef children>:
// `open` / `value` make it controlled (the caller's own trigger or text); `tile` replaces the dashed tile (a menu item);
// `children` follow the box (the caller's 创建 / ✕ buttons); `bare` returns the box alone.
function InlineAdd(props) {
    const h = React.createElement, p = props || {};
    const [own, setOwn] = React.useState(false), [ownText, setOwnText] = React.useState(""), mine = React.useRef(null), ref = p.inputRef || mine;
    const open = p.open === undefined ? own : !!p.open, text = p.value === undefined ? ownText : p.value || "";
    const setText = v => { if (p.value === undefined) setOwnText(v); if (p.onChange) p.onChange(v); };
    React.useEffect(function () { if (open && ref.current && ref.current.focus) ref.current.focus(); }, [open]);
    const close = () => { if (p.open === undefined) { setOwn(false); setOwnText(""); } };
    const cancel = () => { close(); if (p.onCancel) p.onCancel(); };
    const accept = () => { const v = text.trim(); if (!v || p.busy || p.disabled) return; const r = p.onConfirm ? p.onConfirm(v) : true;
        Promise.resolve(r).then(ok => { if (ok !== false) close(); }); };
    const begin = () => { if (p.open === undefined) setOwn(true); if (p.onOpen) p.onOpen(); };
    if (!open) {
        if (p.tile === null) return null;
        if (p.tile) return h(p.tile.type, { ...p.tile.props, onClick: begin }, ...(Array.isArray(p.tile.children) ? p.tile.children : []));
        return h("button", { type: "button", className: "fork-inline-add" + (p.tileClassName ? " " + p.tileClassName : ""), "aria-label": p.addLabel || p.label, title: p.addLabel || p.label,
            disabled: p.disabled || undefined, onClick: begin }, h(InlineGlyph, { name: "plus" }));
    }
    const box = h("input", { ref, type: p.type || "text", inputMode: p.inputMode, className: (p.inputClassName || "fork-inline-add-input") + " fork-edit", "aria-label": p.label, placeholder: p.placeholder,
        value: text, maxLength: p.maxLength, spellCheck: p.spellCheck, autoComplete: "off", disabled: p.busy || undefined, "aria-invalid": p.invalid ? true : undefined,
        onChange: event => setText(event.target.value),
        onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); accept(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } } });
    if (p.bare) return box;
    return h("div", { className: p.className || "fork-inline-add-row" }, box, p.children);
}