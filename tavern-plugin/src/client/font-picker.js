// the font picker shared by the stage CONFIG screen (文字 → 舞台字体 /
// 字幕字体, gal-config.js) and the 外观 settings page (正文字体, appearance.js).
// A trigger shows the current choice in its own face. The list starts with 「跟随…（default）」, which clears
// the override (null); after it come all installed fonts grouped by category, each option drawn in its own face
// with a short sample and its name. Faces register lazily through tavernFonts.ensure when an option scrolls into
// view or is hovered / focused; a choice applies at once (tavernFonts notifies the stage and the story body).
// variant "stage": portaled popover that re-derives the stage tokens (.fork-gal-theme-scope + data-theme).
// variant "settings": inline popover in the regular settings style (the host settings dialog keeps focus inside).

const FONT_SAMPLE = "……你、你还有什么事。";
// Short Chinese names for the installed catalogue; anything else uses its index label.
const FONT_NAMES = Object.freeze({
    "neo-xihei-screen": "霞鹜新晰黑", "neo-zhisong-screen": "霞鹜新致宋", "resource-han-rounded": "源圆黑体",
    "wenkai-screen": "霞鹜文楷", zhuque: "朱雀仿宋", xiaolai: "小赖", "zcool-kuaile": "站酷快乐体"
});
const FONT_CATEGORIES = [["sans", "黑体"], ["rounded", "圆体"], ["serif", "宋体 · 仿宋"], ["hand", "楷体 · 手写"], ["display", "趣味"]];

function fontName(font, builtin) {
    if (!font) return builtin || "内置字体";
    return FONT_NAMES[font.id] || String(font.label || font.id).replace(/\s*屏幕版$/, "");
}
// CSS family for drawing an option in its own face (the generic tail shows until the face swaps in).
function fontFace(font) {
    if (!font) return undefined;
    return JSON.stringify(font.family) + ", " + (font.category === "serif" ? "serif" : "sans-serif");
}
function fontGroups(fonts) {
    const known = FONT_CATEGORIES.map(([id, label]) => ({ id, label, fonts: fonts.filter(font => font.category === id) }));
    const rest = fonts.filter(font => !FONT_CATEGORIES.some(([id]) => id === font.category));
    return known.concat([{ id: "other", label: "其他", fonts: rest }]).filter(group => group.fonts.length);
}
// props: { role, label, follow ("跟随样式" | "跟随皮肤"), builtin (name when no default font is installed),
//          context (tavernFonts.resolve context; omitted = the active stage's skin, e.g. { skinFont } for reading),
//          variant ("stage" | "settings"), theme (stage popover scope), api }
function FontPicker(props) {
    const h = React.createElement;
    const api = props.api || tavernFonts;
    const role = props.role, context = props.context || {};
    React.useSyncExternalStore(api.subscribe, api.getSnapshot);
    const [fonts, setFonts] = React.useState([]);
    const [open, setOpen] = React.useState(false);
    const wrap = React.useRef(null), trigger = React.useRef(null), pop = React.useRef(null);
    // A skin's own face (fonts.md) is not in the catalogue list; api.get still names it for 「跟随…」.
    const byId = id => fonts.find(font => font.id === id) || (id && typeof api.get === "function" ? api.get(id) : null) || null;
    const current = api.resolve(role, context);
    const chosen = current.source === "override" ? current.id : null;
    const currentFont = byId(current.id);
    // What 「跟随…」 resolves to: the resolver's skin layer for this skin and role, ignoring the override.
    const defaultFont = byId(current.default);
    const currentName = fontName(currentFont, props.builtin);
    function ensure(id) { if (id) Promise.resolve(api.ensure(id)).catch(() => {}); }
    React.useEffect(function () {
        let live = true;
        Promise.resolve(api.list()).then(list => { if (live) setFonts(list || []); }, () => {});
        return () => { live = false; };
    }, [api]);
    // The trigger is drawn in the current face.
    React.useEffect(function () { ensure(current.id); }, [current.id]);
    function close(refocus) {
        setOpen(false);
        if (refocus && trigger.current && typeof trigger.current.focus === "function") trigger.current.focus({ preventScroll: true });
    }
    function choose(id) { api.setOverride(role, id); close(true); }
    // Open: focus the current option; Esc (capture, before the CONFIG screen or a host dialog) and a press
    // outside close it.
    React.useEffect(function () {
        if (!open || typeof window === "undefined" || typeof document === "undefined") return undefined;
        const root = pop.current;
        const selected = root && root.querySelector ? root.querySelector('[role="option"][aria-selected="true"]') : null;
        if (selected && typeof selected.focus === "function") selected.focus({ preventScroll: false });
        function outside(event) {
            const target = event.target;
            if (wrap.current && wrap.current.contains(target) || pop.current && pop.current.contains(target)) return;
            setOpen(false);
        }
        function escape(event) {
            if (event.key !== "Escape") return;
            event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation();
            close(true);
        }
        document.addEventListener("pointerdown", outside, true);
        window.addEventListener("keydown", escape, true);
        return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape, true); };
    }, [open]);
    // Lazy faces: register a family when its option becomes visible in the list.
    React.useEffect(function () {
        const root = pop.current;
        if (!open || !root || !root.querySelectorAll || typeof IntersectionObserver !== "function") return undefined;
        const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) ensure(entry.target.getAttribute("data-font-id")); }), { root, rootMargin: "120px 0px" });
        root.querySelectorAll("[data-font-id]").forEach(node => observer.observe(node));
        return () => observer.disconnect();
    }, [open, fonts]);
    function onListKey(event) {
        event.stopPropagation();
        if (event.key === "Tab") { event.preventDefault(); close(true); return; }
        const items = pop.current && pop.current.querySelectorAll ? Array.from(pop.current.querySelectorAll('[role="option"]')) : [];
        if (!items.length) return;
        const at = items.indexOf(typeof document !== "undefined" ? document.activeElement : null);
        const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? (at < 0 ? items.length - 1 : at - 1) : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        items[(next + items.length) % items.length].focus();
    }
    // Presses on the list's padding or headings keep focus on the option (Esc then still reaches the picker).
    function keepFocus(event) { if (!(event.target && event.target.closest && event.target.closest('[role="option"]'))) event.preventDefault(); }
    function option(font, key, id, name, extra) {
        const selected = chosen === id;
        return h("button", { key, type: "button", role: "option", "aria-selected": selected, className: "fork-font-option" + (selected ? " is-on" : "") + (extra ? " " + extra : ""),
            "data-font-id": font ? font.id : undefined, style: font ? { fontFamily: fontFace(font) } : undefined,
            onPointerEnter: () => ensure(font && font.id), onFocus: () => ensure(font && font.id), onClick: () => choose(id) },
            h("span", { className: "fork-font-option-sample" }, FONT_SAMPLE),
            h("span", { className: "fork-font-option-name" }, name),
            selected ? h("span", { className: "fork-font-option-check", "aria-hidden": true }, h(Icon, { name: "check", size: 16 })) : null);
    }
    const followName = props.follow + "（" + fontName(defaultFont, props.builtin) + "）";
    const list = h("div", { className: "fork-font-list", role: "listbox", "aria-label": props.label, onKeyDown: onListKey },
        option(defaultFont, "follow", null, followName, "is-follow"),
        fontGroups(fonts).map(group => h("div", { key: group.id, className: "fork-font-group", role: "group", "aria-label": group.label },
            h("div", { className: "fork-font-group-label", "aria-hidden": true }, group.label),
            group.fonts.map(font => option(font, font.id, font.id, fontName(font))))));
    const variant = props.variant === "stage" ? "stage" : "settings";
    // the list is portaled outside the stage; retain its current skin tokens.
    // ...and the stage's skin font declaration, so fonts.js resolves the same faces on the portaled list.
    const stageTokens={};
    let skinFonts;
    if(open && variant==='stage' && trigger.current) {
        const style=getComputedStyle(trigger.current);
        for(const key of style)if(key.startsWith('--gal-'))stageTokens[key]=style.getPropertyValue(key);
        const stage=trigger.current.closest && trigger.current.closest('[data-fk-fonts]');
        skinFonts=stage ? stage.getAttribute('data-fk-fonts') : undefined;
    }
    const popover = !open ? null : variant === "stage"
        ? h(FloatingPanel, { anchor: trigger, popRef: pop, className: "fork-font-pop is-stage fork-gal-theme-scope", style:stageTokens, "data-theme": props.theme || "", "data-fk-fonts": skinFonts, gap: 8, onMouseDown: keepFocus }, list)
        : h("div", { ref: pop, className: "fork-font-pop is-inline", onMouseDown: keepFocus }, list);
    return h("div", { ref: wrap, className: "fork-font-pick is-" + variant + (open ? " is-open" : ""), "data-role": role },
        h("button", { ref: trigger, type: "button", className: "fork-font-trigger", "aria-haspopup": "listbox", "aria-expanded": open,
            "aria-label": props.label + "：" + currentName + (chosen === null ? "，" + props.follow : ""),
            onClick: () => setOpen(value => !value),
            onKeyDown: event => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); } } },
            h("span", { className: "fork-font-trigger-name", style: currentFont ? { fontFamily: fontFace(currentFont) } : undefined }, currentName),
            chosen === null ? h("span", { className: "fork-font-trigger-tag" }, props.follow) : null,
            h(Icon, { name: "chevron", size: 16 })),
        popover);
}
