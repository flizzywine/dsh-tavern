// (mod settings): the data picker and the formula box of the mod settings editor. Outer level next to InlineField
// (main.js bundles it right after inline-field.js); it reads only React / ReactDOM, SearchBox, useOverlay,
// Spinner and InlineGlyph. Styles: `.fork-cfg-*` in lib/client-assets/mod-config.css.
//
// Sources are the list DTO of listModConfigSources: [{id, label, tree:[{name, path, type, value?, children?,
// description?, settingKey?, settingsKeys?}]}]. A node with `children` is a branch (object / array); `path` is its JSON Pointer inside
// the source; `description` is the MVU [value, description] hint; `settingKey` marks a published value computed from a
// setting in that source mod (only the same mod/key is a self-reference). A reference is {source, path}; in a formula it is written `{source:path}`.
//
// <DataPicker sources value want selfKey selfModId onPick inline insert label placeholder inputRef autoOpen>
//   One combobox: focus opens the list. Without text it browses level by level (› drills into an object or array,
//   the breadcrumb goes back up); typed text filters every full path fuzzily, matches highlighted, the path shown as a
//   breadcrumb. ↑ ↓ move, → drills in, ← goes up, Enter chooses (a branch drills), Esc closes the list only (the popup
//   stack: the list is the topmost popup while open). Rows are windowed, so trees of thousands of nodes stay fast.
//   want 'number' | 'colour' | 'text' | 'boolean' | 'list' | 'any' — leaves (or, for 'list', array/object branches) of another type are shown but cannot be chosen.
//   insert: the field holds no value (the formula box's 「插入引用…」); inline: the list opens in the flow under the
//   field (inside the value editor) instead of floating over the page.
// <FormulaInput value onChange sources evaluate unit min max label pickerRef>
//   A one-line formula; references are chips (the picker inserts one at the caret, typing 「{」 jumps to the picker).
//   evaluate(text) → Promise<{value?, error?:{message, position?}}> gives the live result or the error, whose zero-based
//   UTF-16 position (in the stored text) is marked in the box.
const CFG_HEX = /^#[0-9a-f]{6}$/i;
const cfgRefText = ref => "{" + ref.source + ":" + ref.path + "}";
const cfgRefKey = (source, path) => source + "\n" + path;
function cfgFormat(value) {
    if (value === null || value === undefined) return "—";
    if (Array.isArray(value)) return value.map(cfgFormat).join("、");
    if (typeof value === "number") return String(Math.round(value * 100) / 100);
    if (typeof value === "boolean") return value ? "开" : "关";
    if (typeof value === "object") return "{…}";
    return String(value);
}
function cfgTypeName(entry) {
    if (entry.branch) return entry.children.length + " 项";
    const v = entry.node.value, t = entry.node.type;
    if (t === "number" || typeof v === "number") return "数字";
    if (t === "boolean" || typeof v === "boolean") return "开关";
    if (typeof v === "string") return CFG_HEX.test(v) ? "颜色" : "文字";
    return "";
}
function cfgAccepts(want, entry, selfKey, selfModId) {
    const node = entry.node, v = node.value, t = node.type;
    if (selfKey && entry.source === 'mod:' + selfModId && (node.settingKey === selfKey || (node.settingsKeys || []).includes(selfKey))) return false;
    // want 'list' (a record list such as 背包): the array / object branch itself is the choice; › still drills in.
    if (entry.branch) return want === "list" && (t === "array" || t === "object");
    if (want === "list") return false;
    if (!want || want === "any") return true;
    if (want === "number") return t === "number" || typeof v === "number";
    if (want === "colour") return typeof v === "string" && CFG_HEX.test(v);
    if (want === "text") return typeof v === "string" || typeof v === "number";
    if (want === "boolean") return t === "boolean" || typeof v === "boolean";
    return true;
}
// One pass over the source trees: a flat entry per node (display segments, full path text for the fuzzy filter), the
// children of each branch and the top level of each source. Built once per sources object.
function cfgIndex(sources) {
    const list = [], byKey = new Map(), roots = [], labels = {};
    for (const source of sources || []) {
        labels[source.id] = source.label || source.id;
        const walk = (nodes, parent, isArray) => (nodes || []).map(node => {
            const shown = isArray ? "[" + node.name + "]" : String(node.name);
            const segs = parent ? [...parent.segs, shown] : [shown];
            const entry = { source: source.id, label: labels[source.id], path: node.path, name: shown, node, parent, segs, branch: Array.isArray(node.children), children: [] };
            entry.full = entry.label + "/" + segs.join("/");
            list.push(entry); byKey.set(cfgRefKey(source.id, node.path), entry);
            if (entry.branch) entry.children = walk(node.children, entry, node.type === "array");
            return entry;
        });
        roots.push({ id: source.id, label: labels[source.id], children: walk(source.tree, null, false) });
    }
    return { list, byKey, roots, labels };
}
// Fuzzy match of `query` in `text`: a contiguous hit scores highest (more at a segment start or the end), otherwise the
// characters in order (runs and segment starts score more). → {score, idx} or null.
function cfgFuzzy(query, text) {
    const t = text.toLowerCase(), s = query.toLowerCase().replace(/\s+/g, "");
    if (!s) return null;
    const at = t.indexOf(s);
    if (at >= 0) return { score: 1000 + (t[at - 1] === "/" ? 50 : 0) + (at + s.length === t.length ? 40 : 0) - t.length, idx: Array.from({ length: s.length }, (_, i) => at + i) };
    let i = 0, prev = -2, score = 0; const idx = [];
    for (let j = 0; j < t.length && i < s.length; j++) if (t[j] === s[i]) { idx.push(j); score += (j === prev + 1 ? 6 : 1) + (t[j - 1] === "/" ? 4 : 0); prev = j; i++; }
    return i === s.length ? { score: score - t.length * .1, idx } : null;
}
// Text with matched characters marked; 「/」 drawn as a quiet 「›」.
function cfgMarked(text, hits, offset) {
    const h = React.createElement, out = [];
    let run = "", runHit = false;
    const flush = key => { if (run) out.push(runHit ? h("mark", { key }, run) : run); run = ""; };
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "/") { flush("m" + i); out.push(h("i", { key: "s" + i, className: "fork-cfg-sep", "aria-hidden": true }, "›")); continue; }
        const hit = !!hits && hits.has(i + offset);
        if (hit !== runHit) { flush("m" + i); runHit = hit; }
        run += text[i];
    }
    flush("end");
    return out;
}
function CfgChip(props) {
    const h = React.createElement, p = props || {};
    return h("span", { className: "fork-cfg-chip", title: p.label + " " + p.path }, h("b", null, p.label), p.path);
}
const CFG_NEED = { number: "只能选数字", colour: "只能选颜色", boolean: "只能选开关" };
function DataPicker(props) {
    const h = React.createElement, p = props || {};
    const index = React.useMemo(() => cfgIndex(p.sources), [p.sources]);
    const [open, setOpen] = React.useState(false), [q, setQ] = React.useState(""), [at, setAt] = React.useState(null), [active, setActive] = React.useState(0);
    // Re-read sources (live values): keep browsing the same level of the new tree.
    React.useEffect(function () { if (at) setAt(index.byKey.get(cfgRefKey(at.source, at.path)) || null); }, [index]);
    const [sizes, setSizes] = React.useState({ opt: 40, group: 28 }), [scroll, setScroll] = React.useState(0), [viewH, setViewH] = React.useState(288);
    const root = React.useRef(null), list = React.useRef(null), own = React.useRef(null), input = p.inputRef || own, focusKey = React.useRef(null), quiet = React.useRef(false);
    const id = (React.useId ? React.useId() : "fork-cfg-pick").replace(/:/g, ""), listId = id + "-list";
    const value = p.insert ? null : p.value, chosen = value ? cfgRefKey(value.source, value.path) : "";
    const ok = entry => cfgAccepts(p.want, entry, p.selfKey, p.selfModId);
    const query = q.trim();
    // Rows of the list: group headings (top level only) and options.
    const rows = React.useMemo(() => {
        const out = [];
        if (query) {
            const hits = [];
            for (const entry of index.list) { const m = cfgFuzzy(query, entry.full); if (m) hits.push({ entry, m }); }
            hits.sort((a, b) => (ok(b.entry) - ok(a.entry)) || (b.m.score - a.m.score) || a.entry.full.localeCompare(b.entry.full));
            for (const hit of hits) out.push({ kind: "opt", entry: hit.entry, hits: new Set(hit.m.idx) });
        } else if (!at) {
            for (const source of index.roots) { out.push({ kind: "group", label: source.label }); for (const entry of source.children) out.push({ kind: "opt", entry }); }
        } else for (const entry of at.children) out.push({ kind: "opt", entry });
        return out;
    }, [index, query, at, p.want, p.selfKey, p.selfModId]);
    const options = React.useMemo(() => rows.map((row, i) => row.kind === "opt" ? i : -1).filter(i => i >= 0), [rows]);
    const tops = React.useMemo(() => { const out = []; let y = 0; for (const row of rows) { out.push(y); y += row.kind === "group" ? sizes.group : sizes.opt; } out.push(y); return out; }, [rows, sizes]);
    const activeRow = options.length ? options[Math.max(0, Math.min(active, options.length - 1))] : -1;
    const close = () => { setOpen(false); setQ(""); };
    useOverlay(open, () => [root.current], () => close());
    // Opening: browse the level of the chosen value, with it active.
    function openList() {
        if (open) return;
        const picked = chosen && index.byKey.get(chosen);
        if (picked && !q) { setAt(picked.parent); focusKey.current = chosen; } else setActive(0);
        setOpen(true);
    }
    // After a drill / up / filter change: put the remembered row (the level we came from, the chosen value) first.
    React.useLayoutEffect(function () {
        if (!open) return;
        const want = focusKey.current; focusKey.current = null;
        if (want) { const i = options.findIndex(r => cfgRefKey(rows[r].entry.source, rows[r].entry.path) === want); setActive(i >= 0 ? i : 0); }
    }, [open, rows]);
    // Measure the row heights once the list shows (they follow the UI size tokens), and the visible height.
    React.useLayoutEffect(function () {
        const node = list.current; if (!open || !node || !node.querySelector) return;
        const opt = node.querySelector(".fork-cfg-opt"), group = node.querySelector(".fork-cfg-group");
        const next = { opt: opt ? opt.offsetHeight || sizes.opt : sizes.opt, group: group ? group.offsetHeight || sizes.group : sizes.group };
        if (next.opt !== sizes.opt || next.group !== sizes.group) setSizes(next);
        if (node.clientHeight && node.clientHeight !== viewH) setViewH(node.clientHeight);
    });
    // Keep the active row in view (the list scrolls, never the page).
    React.useLayoutEffect(function () {
        const node = list.current; if (!open || !node || activeRow < 0) return;
        const top = tops[activeRow], bottom = tops[activeRow + 1], first = activeRow === options[0] && rows[0] && rows[0].kind === "group" ? 0 : top;
        if (first < node.scrollTop) node.scrollTop = first; else if (bottom > node.scrollTop + node.clientHeight) node.scrollTop = bottom - node.clientHeight;
    }, [open, activeRow, tops]);
    React.useEffect(function () { if (list.current) list.current.scrollTop = 0; setScroll(0); }, [query, at]);
    function drill(entry) { setAt(entry); setQ(""); setActive(0); if (list.current) list.current.scrollTop = 0; }
    function up() { if (!at) return; focusKey.current = cfgRefKey(at.source, at.path); setAt(at.parent); }
    function choose(entry) {
        if (!entry) return;
        if (entry.branch && !ok(entry)) { drill(entry); return; }
        if (!ok(entry)) return;
        quiet.current = true; close();
        if (p.onPick) p.onPick({ source: entry.source, path: entry.path }, entry.node);
    }
    function crumb(level) {
        if (!at) return;
        let target = at; const chain = []; while (target) { chain.unshift(target); target = target.parent; }
        if (level < 0) { focusKey.current = cfgRefKey(chain[0].source, chain[0].path); setAt(null); return; }
        focusKey.current = level + 1 < chain.length ? cfgRefKey(chain[level + 1].source, chain[level + 1].path) : null;
        setAt(chain[level] || null);
    }
    function crumbSource() { if (!at) return; let top = at; while (top.parent) top = top.parent; focusKey.current = cfgRefKey(top.source, top.path); setAt(null); }
    const keys = event => {
        const k = event.key;
        if (k === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); close(); } return; }
        if (k === "Tab") { if (open) close(); return; }
        if (!open) { if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter") { event.preventDefault(); openList(); } return; }
        const n = options.length, at0 = Math.max(0, Math.min(active, n - 1)), entry = n ? rows[options[at0]].entry : null;
        if (k === "ArrowDown") { event.preventDefault(); if (n) setActive((at0 + 1) % n); }
        else if (k === "ArrowUp") { event.preventDefault(); if (n) setActive((at0 - 1 + n) % n); }
        else if (k === "Home" && !q) { event.preventDefault(); setActive(0); }
        else if (k === "End" && !q) { event.preventDefault(); setActive(Math.max(0, n - 1)); }
        else if (k === "ArrowRight") { const caretEnd = !q || (event.target && event.target.selectionStart === event.target.value.length); if (entry && entry.branch && caretEnd) { event.preventDefault(); drill(entry); } }
        else if (k === "ArrowLeft") { if (!q && at) { event.preventDefault(); up(); } }
        else if (k === "Enter") { event.preventDefault(); choose(entry); }
    };
    // Crumbs: 「匹配 N 项」 while filtering, 「全部」 at the top, else 全部 › source › … (buttons that jump back up).
    let crumbs;
    if (query) crumbs = [h("span", { key: "n", className: "fork-cfg-crumb is-current" }, "匹配 " + options.length + " 项")];
    else if (!at) crumbs = [h("span", { key: "all", className: "fork-cfg-crumb is-current" }, "全部")];
    else {
        const chain = []; let node = at; while (node) { chain.unshift(node); node = node.parent; }
        const crumbButton = (key, text, onClick, current) => h("button", { key, type: "button", tabIndex: -1, className: "fork-cfg-crumb" + (current ? " is-current" : ""), onClick }, text);
        crumbs = [crumbButton("all", "全部", () => crumb(-1)), h("i", { key: "s0", className: "fork-cfg-sep", "aria-hidden": true }, "›"), crumbButton("src", at.label, crumbSource, false)];
        chain.forEach((entry, i) => crumbs.push(h("i", { key: "s" + (i + 1), className: "fork-cfg-sep", "aria-hidden": true }, "›"), crumbButton("c" + i, entry.name, () => crumb(i), i === chain.length - 1)));
    }
    const need = CFG_NEED[p.want];
    // Windowed rows: only those within (or just around) the visible height are rendered.
    const total = tops[rows.length] || 0, overscan = 6;
    let first = 0, lo = 0, hi = rows.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (tops[mid + 1] <= scroll) lo = mid + 1; else { first = mid; hi = mid - 1; } }
    first = Math.max(0, first - overscan);
    let last = first; while (last < rows.length && tops[last] < scroll + viewH) last++;
    last = Math.min(rows.length, last + overscan);
    const optionId = r => id + "-o" + r;
    const renderRow = r => {
        const row = rows[r], style = { top: tops[r] };
        if (row.kind === "group") return h("div", { key: "g" + r, className: "fork-cfg-group", role: "presentation", style }, row.label);
        const entry = row.entry, accepted = ok(entry), selected = cfgRefKey(entry.source, entry.path) === chosen, isActive = r === activeRow;
        const v = entry.node.value, self = !!p.selfKey && entry.source === 'mod:' + p.selfModId && (entry.node.settingKey === p.selfKey || (entry.node.settingsKeys || []).includes(p.selfKey));
        let name, pre = null;
        if (query) {
            const cut = entry.full.lastIndexOf("/") + 1;
            name = cfgMarked(entry.full.slice(cut), row.hits, cut); pre = cfgMarked(entry.full.slice(0, cut - 1), row.hits, 0);
        } else name = entry.name;
        return h("div", { key: "o" + r, id: optionId(r), role: "option", className: "fork-cfg-opt" + (entry.branch ? " is-branch" : "") + (isActive ? " is-active" : ""), style,
                "aria-selected": selected, "aria-disabled": !entry.branch && !accepted || undefined,
                onPointerDown: event => event.preventDefault(),
                onClick: event => { setActive(options.indexOf(r)); if (event.target.closest && event.target.closest(".fork-cfg-drill")) drill(entry); else choose(entry); } },
            h("span", { className: "fork-cfg-check", "aria-hidden": true }, selected ? "✓" : ""),
            h("span", { className: "fork-cfg-opt-name" },
                pre ? h("span", { className: "fork-cfg-opt-pre" }, pre) : null,
                h("span", { className: "fork-cfg-opt-label" }, name),
                !pre && entry.node.description ? h("span", { className: "fork-cfg-opt-hint" }, entry.node.description) : null),
            entry.branch ? null : h("span", { className: "fork-cfg-opt-value" }, typeof v === "string" && CFG_HEX.test(v) ? h("span", { className: "fork-inline-swatch", style: { "--swatch": v } }) : null, cfgFormat(v)),
            h("span", { className: "fork-cfg-opt-type" }, self ? "自身" : cfgTypeName(entry)),
            entry.branch ? h("span", { className: "fork-cfg-drill", title: "展开", "aria-hidden": true }, "›") : null);
    };
    let body;
    if (!p.sources) body = p.error ? h("div", { className: "fork-cfg-empty", role: "alert" }, "⚠ ", p.error) : h(PanelLoading, { count: 4 });
    else if (!rows.length || !options.length && query) body = h(EmptyState, { compact: true, query, text: query ? "" : "没有数据" });
    else body = h("div", { className: "fork-cfg-rows", style: { height: total } }, Array.from({ length: last - first }, (_, i) => renderRow(first + i)));
    const field = h("div", { className: "fork-cfg-pick-field" },
        value ? h(CfgChip, { label: index.labels[value.source] || value.source, path: value.path }) : null,
        h(SearchBox, { bare: true, inputRef: input, inputClassName: "fork-cfg-pick-input", label: p.label || (p.insert ? "插入引用" : "选择数据"),
            placeholder: p.placeholder || (p.insert ? "插入引用…" : value ? "换一个…" : "搜索或浏览…"), value: q, spellCheck: false,
            onChange: text => { setQ(text); setActive(0); if (!open) setOpen(true); }, onKeyDown: keys,
            inputProps: { id: id + "-input", role: "combobox", autoComplete: "off", "aria-expanded": open, "aria-controls": listId, "aria-autocomplete": "list",
                "aria-activedescendant": open && activeRow >= 0 ? optionId(activeRow) : undefined,
                onFocus: () => { if (quiet.current) { quiet.current = false; return; } openList(); },
                onBlur: () => { if (open) close(); }, onClick: () => openList() } }));
    return h("div", { ref: root, className: "fork-cfg-pick" + (p.inline ? " is-inline" : "") + (p.className ? " " + p.className : ""), "data-open": open || undefined },
        field,
        open ? h("div", { className: "fork-cfg-drop" + (p.inline ? "" : " fk-surface"), "data-level": p.inline ? undefined : "popover", onPointerDown: event => { if (!(event.target.closest && event.target.closest("input"))) event.preventDefault(); } },
            h("div", { className: "fork-cfg-crumbs" }, crumbs, need ? h("span", { className: "fork-cfg-need" }, need) : null),
            h("div", { ref: list, id: listId, role: "listbox", "aria-label": p.label || "数据", className: "fork-cfg-list", onScroll: event => setScroll(event.currentTarget.scrollTop) }, body)) : null);
}

// ---- formula box ----
function cfgChipNode(ref, labels) {
    const chip = document.createElement("span");
    chip.className = "fork-cfg-chip"; chip.contentEditable = "false"; chip.dataset.ref = cfgRefText(ref);
    const b = document.createElement("b"); b.textContent = labels[ref.source] || ref.source; chip.append(b, ref.path);
    return chip;
}
const CFG_REF = /\{([^{}]+?):(\/[^{}]*)\}/g;
function cfgFormulaFill(box, text, labels) {
    box.textContent = "";
    let last = 0;
    for (const m of String(text || "").matchAll(CFG_REF)) {
        if (m.index > last) box.append(text.slice(last, m.index));
        box.append(cfgChipNode({ source: m[1], path: m[2] }, labels));
        last = m.index + m[0].length;
    }
    if (last < String(text || "").length) box.append(text.slice(last));
}
function cfgFormulaText(box) {
    let s = "";
    box.childNodes.forEach(n => { if (n.nodeType === 3) s += n.data; else if (n.dataset && n.dataset.ref) s += n.dataset.ref; else s += n.textContent || ""; });
    return s.replace(/\u00a0/g, " ");
}
// The DOM range of the character at `position` of the stored text (a whole chip when it falls inside one).
function cfgFormulaRange(box, position) {
    const nodes = [...box.childNodes]; let acc = 0;
    const range = document.createRange();
    for (const n of nodes) {
        const len = n.nodeType === 3 ? n.data.length : n.dataset && n.dataset.ref ? n.dataset.ref.length : (n.textContent || "").length;
        if (position < acc + len) {
            if (n.nodeType === 3) { range.setStart(n, position - acc); range.setEnd(n, position - acc + 1); } else range.selectNode(n);
            return range;
        }
        acc += len;
    }
    const tail = nodes[nodes.length - 1];
    if (!tail) return null;
    if (tail.nodeType === 3 && tail.data.length) { range.setStart(tail, tail.data.length - 1); range.setEnd(tail, tail.data.length); } else range.selectNode(tail);
    return range;
}
// The caret as an offset in the stored text (a caret after a chip counts the chip's whole `{source:path}`).
function cfgCaret(box) {
    const s = document.getSelection(); if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0); if (!box.contains(r.startContainer)) return null;
    let acc = 0;
    for (const n of box.childNodes) {
        const len = n.nodeType === 3 ? n.data.length : n.dataset && n.dataset.ref ? n.dataset.ref.length : (n.textContent || "").length;
        if (r.startContainer === n) return acc + r.startOffset;
        if (r.startContainer === box && box.childNodes[r.startOffset] === n) return acc;
        acc += len;
    }
    return acc;
}
const CFG_HIGHLIGHT = "fork-formula-error";
function FormulaInput(props) {
    const h = React.createElement, p = props || {};
    const box = React.useRef(null), last = React.useRef(null), range = React.useRef(null), ownPicker = React.useRef(null), picker = p.pickerRef || ownPicker;
    // Sources are re-read after every write (live values); the chips only follow their labels, compared by content, and a
    // refill keeps the caret where it was.
    const labelKey = (p.sources || []).map(s => s.id + "=" + (s.label || s.id)).join("\n");
    const labels = React.useMemo(() => Object.fromEntries((p.sources || []).map(s => [s.id, s.label || s.id])), [labelKey]);
    const [result, setResult] = React.useState(null), ticket = React.useRef(0);
    const text = p.value || "";
    // The box owns its DOM while typing; it is refilled only when the value changes from outside (or labels arrive).
    React.useLayoutEffect(function () { if (box.current && (text !== last.current || !box.current.childNodes.length && text)) { cfgFormulaFill(box.current, text, labels); last.current = text; } }, [text]);
    React.useLayoutEffect(function () {
        const node = box.current; if (!node || last.current === null) return;
        const caret = document.activeElement === node ? cfgCaret(node) : null;
        cfgFormulaFill(node, last.current, labels);
        if (caret !== null) { const r = cfgFormulaRange(node, caret), s = document.getSelection(); if (r) { r.collapse(caret < last.current.length); s.removeAllRanges(); s.addRange(r); } }
    }, [labels]);
    // Live result: evaluated a moment after the last change; a stale answer is dropped.
    React.useEffect(function () {
        if (!p.evaluate) return undefined;
        const mine = ++ticket.current;
        if (!text.trim()) { setResult({ error: { message: "公式是空的" } }); return undefined; }
        const timer = setTimeout(() => {
            Promise.resolve(p.evaluate(text)).then(r => { if (mine === ticket.current) setResult(r || {}); }, e => { if (mine === ticket.current) setResult({ error: { message: e && e.message || String(e) } }); });
        }, 160);
        return () => clearTimeout(timer);
    }, [text, p.evaluate]);
    // The error position is marked with a CSS highlight (no DOM change inside the editable box).
    const position = result && result.error && Number.isInteger(result.error.position) ? result.error.position : null;
    React.useEffect(function () {
        const registry = typeof CSS !== "undefined" && CSS.highlights, node = box.current;
        if (!registry || typeof Highlight === "undefined") return undefined;
        if (position === null || !node) { registry.delete(CFG_HIGHLIGHT); return undefined; }
        const r = cfgFormulaRange(node, position);
        if (r) registry.set(CFG_HIGHLIGHT, new Highlight(r)); else registry.delete(CFG_HIGHLIGHT);
        return () => registry.delete(CFG_HIGHLIGHT);
    }, [position, result]);
    React.useEffect(function () {
        const track = () => { const node = box.current, s = document.getSelection(); if (node && s && s.rangeCount && node.contains(s.getRangeAt(0).startContainer)) range.current = s.getRangeAt(0).cloneRange(); };
        document.addEventListener("selectionchange", track);
        return () => document.removeEventListener("selectionchange", track);
    }, []);
    const changed = () => { const s = cfgFormulaText(box.current); last.current = s; if (p.onChange) p.onChange(s); };
    const caretAfter = node => { const s = document.getSelection(), r = document.createRange(); r.setStartAfter(node); r.collapse(true); s.removeAllRanges(); s.addRange(r); range.current = r.cloneRange(); };
    function insert(ref) {
        const node = box.current; if (!node) return;
        const chip = cfgChipNode(ref, labels), space = document.createTextNode(" ");
        const r = range.current && node.contains(range.current.startContainer) ? range.current : null;
        if (r) { r.deleteContents(); r.insertNode(space); r.insertNode(chip); }
        else { if (node.textContent.trim() && !/\s$/.test(cfgFormulaText(node))) node.append(" "); node.append(chip, space); }
        changed(); node.focus(); caretAfter(space);
    }
    function placeCaret(at) {
        const node = box.current; if (!node) return;
        const r = cfgFormulaRange(node, at); node.focus();
        if (r) { const s = document.getSelection(); r.collapse(true); s.removeAllRanges(); s.addRange(r); }
    }
    const keys = event => {
        if (event.key === "Enter") { event.preventDefault(); return; }
        if (event.key === "{") { event.preventDefault(); if (picker.current) picker.current.focus(); }
    };
    const paste = event => {
        event.preventDefault();
        const plain = (event.clipboardData && event.clipboardData.getData("text/plain") || "").replace(/[\r\n]+/g, " ");
        if (!plain) return;
        const s = document.getSelection(); if (!s || !s.rangeCount) return;
        const r = s.getRangeAt(0); r.deleteContents(); const t = document.createTextNode(plain); r.insertNode(t); caretAfter(t); changed();
    };
    const unit = p.unit ? (p.unit === "%" ? "%" : " " + p.unit) : "";
    let line = null;
    if (result && result.error) {
        line = h("div", { className: "fork-cfg-result is-warn", role: "alert" }, "⚠ ", result.error.message,
            position !== null ? h("button", { type: "button", className: "fork-cfg-link fork-cfg-at", onClick: () => placeCaret(position) }, "第 " + (position + 1) + " 个字") : null);
    } else if (result && "value" in result) {
        const v = result.value, low = typeof p.min === "number" ? p.min : null, high = typeof p.max === "number" ? p.max : null;
        const clamped = typeof v === "number" && ((low !== null && v < low) || (high !== null && v > high)) ? Math.min(Math.max(v, low ?? v), high ?? v) : null;
        line = h("div", { className: "fork-cfg-result", "aria-live": "polite" }, "= ", h("b", null, cfgFormat(v) + (typeof v === "number" ? unit : "")),
            clamped !== null ? h("span", { className: "fork-cfg-meta" }, " 超出 " + low + "–" + high + "，按 " + cfgFormat(clamped)) : null);
    }
    return h("div", { className: "fork-cfg-formula" },
        h("div", { ref: box, className: "fork-cfg-formula-box", contentEditable: true, suppressContentEditableWarning: true, role: "textbox", "aria-label": p.label || "公式", "aria-multiline": false,
            spellCheck: false, "data-placeholder": p.placeholder || "例：{变量:/hp} / {变量:/hp_max} * 100", "aria-invalid": position !== null || undefined,
            onInput: changed, onKeyDown: keys, onPaste: paste }),
        line,
        h(DataPicker, { sources: p.sources, error: p.sourcesError, want: "number", selfKey: p.selfKey, selfModId: p.selfModId, insert: true, inline: p.inline, inputRef: picker, onPick: insert }),
        h("div", { className: "fork-cfg-meta" }, "+ − × ÷ ( ) min max round clamp abs · 输入 { 插入引用"));
}
