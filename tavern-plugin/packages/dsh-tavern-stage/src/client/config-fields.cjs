function createStageConfigFields({React:react, HelpTip, Segmented, Slider, ResetButton, FontPicker, InlineField, sounds:forkUiSfx, classify}) {
let disposed=false;
const React={...react,createElement(type,props,...children){
    const guarded=props&&Object.fromEntries(Object.entries(props).map(([name,value])=>[name,/^on[A-Z]/.test(name)&&typeof value==='function'?(...args)=>{if(!disposed)return value(...args);}:value]));
    return react.createElement(type,guarded,...children);
}};
// Building blocks: a titled group, a label / control row, segmented choices.
// A caption's or row's explanation sits behind the (?) after its name (ui-design §三.3), never as inline text.
function galConfigGroup(title, tip, ...children) {
    const h = React.createElement;
    const head = Array.isArray(title) ? title : [title];
    return h("div", { className: "fork-gal-config-group" },
        h("div", { className: "fork-gal-config-caption" }, h("b", null, head[0]), tip ? h(HelpTip, { label: head[0] + "说明" }, tip) : null, head[1] || null),
        ...children);
}
// every row names its control type (data-fk-control) so a skin's CONFIG surface
// draws it: segmented, toggle, slider, select, text, colour, picker; the engine's composite rows and every type the client
// does not know are `other` (the surface's fallback look). kind (optional) = the type the caller already knows.
const GAL_CONFIG_CONTROLS = Object.freeze(["segmented", "toggle", "slider", "select", "text", "colour", "picker"]);
function galConfigControlKind(control) {
    const props = control && control.props || {}, own = props["data-fk-control"];
    if (GAL_CONFIG_CONTROLS.includes(own)) return own;
    const type = control && control.type;
    if (type === GalConfigSwitch || classify?.(type) === "toggle") return "toggle";
    if (type === GalConfigChoice || typeof Segmented === "function" && type === Segmented) return "segmented";
    if (classify?.(type) === "select" || typeof FontPicker === "function" && type === FontPicker) return "select";
    return "other";
}
function galConfigRow(label, control, tip, extra, kind) {
    const h = React.createElement;
    return h("div", { className: "fork-gal-config-row" + (extra ? " " + extra : ""), "data-fk-control": GAL_CONFIG_CONTROLS.includes(kind) ? kind : galConfigControlKind(control) },
        h("div", { className: "fork-gal-config-label" }, h("b", null, label), tip ? h(HelpTip, { label: label + "说明" }, tip) : null),
        h("div", { className: "fork-gal-config-control" }, control));
}
// multi-way rows are the shared Segmented (inline-field.js) in the stage
// skin; ← → choose with the tabs' move cue. Sliders are the shared Slider in the stage skin (.fork-gal-slider).
function galConfigSegmented(props) {
    return React.createElement(GalConfigChoice, props);
}
// The drawn looks of the CONFIG surface the screen reads from its stage's marks (config-screen.cjs; skin-adapter.cjs
// stageSkinConfigSurface writes them): { segmented, toggle } - cycler draws one value at a time.
const GalConfigLooks = react.createContext(null);
function useGalConfigLook(type) { const looks = react.useContext(GalConfigLooks); return looks && looks[type] || ""; }
// cycler (skin-config-surface.md §三, §18 N32): one value in the control's box; ← → ↑ ↓ step (wrapping), Home / End jump, a
// click on its first third steps back and elsewhere on. A spinbutton naming its value (aria-valuetext).
function GalConfigCycler(props) {
    const h = React.createElement, options = props.options || [], n = options.length;
    const at = Math.max(0, options.findIndex(o => o[0] === props.value)), words = n ? options[at][1] : "";
    const go = to => { if (props.disabled || n < 2) return; const next = (to + n) % n; if (next === at) return; forkUiSfx.play("move"); props.onChange(options[next][0]); };
    const keys = event => {
        const to = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, Home: 0, End: n - 1 }[event.key];
        if (to === undefined) return;
        event.preventDefault(); go(to);
    };
    const click = event => { const box = event.currentTarget.getBoundingClientRect(); go(event.clientX < box.left + box.width / 3 ? at - 1 : at + 1); };
    return h("div", { className: "fork-gal-config-cycler", role: "spinbutton", tabIndex: props.disabled ? -1 : 0, "aria-label": props.label, "aria-valuemin": 1, "aria-valuemax": n,
        "aria-valuenow": at + 1, "aria-valuetext": words, "aria-disabled": props.disabled || undefined, onKeyDown: keys, onClick: click },
        h("i", { className: "fork-gal-config-cycler-step", "data-to": "prev", "aria-hidden": true }), h("b", null, words), h("i", { className: "fork-gal-config-cycler-step", "data-to": "next", "aria-hidden": true }));
}
// A multi-way choice: the shared Segmented (≤ 6 choices), a menu (more), or the cycler when the surface draws one.
function GalConfigChoice(props) {
    const cycler = useGalConfigLook("segmented") === "cycler";
    if (cycler) return React.createElement(GalConfigCycler, props);
    if (props.menu) return React.createElement(InlineField, { kind: "menu", label: props.label, hideLabel: true, value: props.value, disabled: props.disabled, options: props.options.map(([value, label]) => ({ value, label })), onCommit: props.onChange });
    const keys = event => { if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) forkUiSfx.play("move"); };
    const { menu, ...rest } = props;
    return React.createElement(Segmented, { ...rest, base: "fork-gal-config-seg", onKeyDown: keys });
}
// reset (optional): { label, onClick } or null - the shared ↺ after the value (ui-design §三.20), its room kept while hidden
// so the value does not move.
// numerals: the ends are only the rail's min / max numbers (a mod field without ends words): controls.slider.look value shows the
// reading in the box instead (theme.css).
function galConfigSlider(ends, slider, reset, numerals) {
    const h = React.createElement, { output, ...rest } = slider;
    const value = h("output", { className: "fork-gal-config-value" }, output);
    return h("div", { className: "fork-gal-config-slider" + (reset !== undefined ? " has-reset" : ""), "data-fk-control": "slider", "data-ends": numerals ? "numerals" : undefined },
        h("span", { className: "fork-gal-config-end" }, ends[0]),
        h(Slider, { skin: "fork-gal-slider", ...rest }),
        h("span", { className: "fork-gal-config-end" }, ends[1]),
        reset === undefined ? value : h("span", { className: "fork-gal-config-value-reset" }, value,
            reset ? h(ResetButton, { label: reset.label, onClick: event => {
                // The button goes away with the value at the default: focus stays on the slider.
                const row = event.currentTarget.closest(".fork-gal-config-slider");
                reset.onClick();
                const thumb = row && row.querySelector('[role="slider"]');
                if (thumb) thumb.focus();
            } }) : null));
}
function GalConfigSwitch(props) {
    const h = React.createElement;
    const on = Boolean(props.checked);
    if (useGalConfigLook("toggle") === "cycler") return h(GalConfigCycler, { label: props.label, value: on, disabled: props.disabled, options: [[true, "开"], [false, "关"]], onChange: props.onChange });
    return h("button", { type: "button", role: "switch", className: "fork-gal-config-switch", "aria-label": props.label, "aria-checked": on, "aria-busy": props.busy || undefined,
        disabled: Boolean(props.disabled), onClick: () => props.onChange(!on) },
        // the state word: a drawn toggle (a plate, the skin's images) has none of its own, so the track carries it (theme.css shows it there)
        h("span", { className: "fork-gal-config-switch-track", "aria-hidden": true }, h("i", null), h("b", { className: "fork-gal-config-switch-word" }, on ? "开" : "关")));
}

const GAL_CONFIG_ITEM_TYPES = Object.freeze({ text: "text", toggle: "toggle", slider: "slider", segmented: "segmented", select: "select", colour: "colour", "asset-picker": "picker", "sound-picker": "picker", picker: "picker" });
// More choices than fit a segmented groove read as a select (one row, any count).
const GAL_CONFIG_SEGMENTS = 6;
function galConfigItemKind(item) {
    const kind = GAL_CONFIG_ITEM_TYPES[item && item.type] || "other";
    return kind === "segmented" && (item.choices || []).length > GAL_CONFIG_SEGMENTS ? "select" : kind;
}
function galConfigItemWords(item) {
    if (item.display !== undefined && item.display !== null && item.display !== "") return String(item.display);
    const value = item.value;
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "开" : "关";
    if (Array.isArray(value)) return value.length + " 项";
    return typeof value === "object" ? "已设置" : String(value) + (item.unit ? " " + item.unit : "");
}
function galConfigItem(item) {
    const h = React.createElement, kind = galConfigItemKind(item), label = item.label, change = item.onChange || (() => {});
    const commit = item.onCommit || change, choices = item.choices || [], unit = item.unit ? " " + item.unit : "";
    let control;
    if (kind === "toggle") control = h(GalConfigSwitch, { label, checked: item.value === true, disabled: item.disabled, onChange: change });
    else if (kind === "segmented" || kind === "select") control = h(GalConfigChoice, { label, value: item.value, disabled: item.disabled, options: choices.map(c => [c.value, c.label]), onChange: change, menu: kind === "select" });
    else if (kind === "slider") {
        const value = Number(item.value), words = String(value) + unit;
        control = galConfigSlider(item.ends || [String(item.min), String(item.max)], { min: item.min, max: item.max, step: item.step, value, label, valueText: words, output: words, disabled: item.disabled, onChange: change, onCommit: commit }, undefined, !item.ends);
    }
    else if (kind === "text") control = h(InlineField, { kind: "text", label, hideLabel: true, value: item.value || "", disabled: item.disabled, maxLength: item.maxLength, placeholder: item.placeholder, onCommit: change });
    else if (kind === "colour") control = h(InlineField, { kind: "color", label, hideLabel: true, value: item.value === "auto" ? "" : item.value || "", disabled: item.disabled, palette: item.palette,
        allowAuto: item.auto !== undefined, auto: item.auto || undefined, onCommit: value => change(value || (item.auto !== undefined ? "auto" : value)) });
    else if (kind === "picker") control = h(InlineField, { kind: "link", label, hideLabel: true, value: item.display || "", placeholder: "未选择", disabled: item.disabled || !item.onOpen, onOpen: item.onOpen });
    else control = h("span", { className: "fork-gal-config-other" }, galConfigItemWords(item));
    return h(React.Fragment, { key: item.key }, galConfigRow(label, control, item.help || null, "is-item", kind === "other" ? undefined : kind));
}
// props: { sections [{ id, title, help?, items [item] }] } - every section a titled group; an empty section is left out.
function GalConfigItems(props) {
    const h = React.createElement;
    return h(React.Fragment, null, (props.sections || []).filter(section => section.items && section.items.length).map(section =>
        h(React.Fragment, { key: section.id }, galConfigGroup(section.title, section.help || null, ...section.items.map(galConfigItem)))));
}
// A mod's settingsSchema as CONFIG sections (its own sections and groups in order, else one section titled by the mod): the
// stored values over the defaults; a field whose dependsOn is not met is left out. set(patch) saves (the caller's write).
function galConfigFieldSections(manifest, values, set, title) {
    const schema = manifest && manifest.settingsSchema || { fields: [] }, fields = new Map(schema.fields.map(field => [field.key, field]));
    const valueOf = field => values && Object.hasOwn(values, field.key) ? values[field.key] : field.default;
    const shown = field => !field.dependsOn || (dependency => dependency && (Object.hasOwn(field.dependsOn, "equals") ? valueOf(dependency) === field.dependsOn.equals : Boolean(valueOf(dependency))))(fields.get(field.dependsOn.key));
    const item = field => ({ key: field.key, type: field.type, label: field.label, help: field.help, value: valueOf(field), choices: field.choices, min: field.min, max: field.max, step: field.step, ends: field.ends,
        unit: field.unit, maxLength: field.maxLength, placeholder: field.placeholder, palette: field.palette, auto: field.stageToken ? null : undefined, onChange: value => { if(!disposed)set({ [field.key]: value }); } });
    const items = keys => keys.map(key => fields.get(key)).filter(field => field && shown(field)).map(item);
    if (!schema.sections || !schema.sections.length) return [{ id: "settings", title: title || "设置", items: items(schema.fields.map(field => field.key)) }];
    return schema.sections.flatMap(section => section.groups ? section.groups.map(group => ({ id: section.id + "." + group.id, title: group.title, help: group.help, items: items(group.fields) }))
        : [{ id: section.id, title: section.title, help: section.help, items: items(section.fields) }]);
}
return {Looks:GalConfigLooks,group:galConfigGroup,row:galConfigRow,segmented:galConfigSegmented,slider:galConfigSlider,Switch:GalConfigSwitch,Items:GalConfigItems,sections:galConfigFieldSections,itemKind:galConfigItemKind,dispose(){disposed=true;}};
}
// The stage CONFIG font picker (文字 → 舞台字体 / 字幕字体): the stage's own list, so the dream skin's shared picker
// (dsh-dream-skin, its own package; it still draws the 外观 page's 正文字体) stays untouched. It keeps that picker's
// classes, behaviour and API (tavernFonts: list / get / resolve / setOverride / ensure / subscribe) and draws its own rows
// (theme.css 「stage font picker」, scoped by .is-rows): the trigger names the current font in its own face with no
// 「跟随」 tag; the list starts with 「跟随皮肤」 (the font it resolves to on a second line), then every installed font
// by category, one row each - a ✓ column, the name in the interface face, a short sample in the font's own face.
// Faces register lazily (the trigger's face; then visible, hovered or focused rows). Without the dream skin's font
// library (window.dshSkinFonts) there is no catalogue: 系统字体, as the core's adapter shows.
function createStageFontPicker({React, Icon, FloatingPanel, fonts:tavernFonts}) {
const FONT_SAMPLE = "……你、你还有什么事。";
const FONT_NAMES = Object.freeze({
    "neo-xihei-screen": "霞鹜新晰黑", "neo-zhisong-screen": "霞鹜新致宋", "resource-han-rounded": "源圆黑体",
    "wenkai-screen": "霞鹜文楷", zhuque: "朱雀仿宋", xiaolai: "小赖", "zcool-kuaile": "站酷快乐体"
});
const FONT_CATEGORIES = [["sans", "黑体"], ["rounded", "圆体"], ["serif", "宋体 · 仿宋"], ["hand", "楷体 · 手写"], ["display", "趣味"]];
const fontName = (font, builtin) => !font ? builtin || "内置字体" : FONT_NAMES[font.id] || String(font.label || font.id).replace(/\s*屏幕版$/, "");
const fontFace = font => font ? JSON.stringify(font.family) + ", " + (font.category === "serif" ? "serif" : "sans-serif") : undefined;
function fontGroups(fonts) {
    const known = FONT_CATEGORIES.map(([id, label]) => ({ id, label, fonts: fonts.filter(font => font.category === id) }));
    const rest = fonts.filter(font => !FONT_CATEGORIES.some(([id]) => id === font.category));
    return known.concat([{ id: "other", label: "其他", fonts: rest }]).filter(group => group.fonts.length);
}
const library = () => typeof window === "undefined" ? true : Boolean(window.dshSkinFonts);
// props: { role, label, follow ("跟随皮肤"), builtin (name when no default font is installed), context (resolve context;
//          omitted = the active stage's skin), theme (the popover's stage scope), api (tests) }
function StageFontPicker(props) {
    const h = React.createElement;
    const api = props.api || tavernFonts;
    const role = props.role, context = props.context || {};
    React.useSyncExternalStore(api.subscribe, api.getSnapshot);
    const [present, setPresent] = React.useState(library);
    const [fonts, setFonts] = React.useState([]);
    const [open, setOpen] = React.useState(false);
    const wrap = React.useRef(null), trigger = React.useRef(null), pop = React.useRef(null);
    React.useEffect(function () {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        const changed = () => setPresent(library());
        window.addEventListener("dsh-font-library-changed", changed); changed();
        return () => window.removeEventListener("dsh-font-library-changed", changed);
    }, []);
    const byId = id => fonts.find(font => font.id === id) || (id && typeof api.get === "function" ? api.get(id) : null) || null;
    const current = api.resolve(role, context);
    const chosen = current.source === "override" ? current.id : null;
    const currentFont = byId(current.id), defaultFont = byId(current.default);
    const currentName = fontName(currentFont, props.builtin);
    function ensure(id) { if (id) Promise.resolve(api.ensure(id)).catch(() => {}); }
    React.useEffect(function () {
        let live = true;
        Promise.resolve(api.list()).then(list => { if (live) setFonts(list || []); }, () => {});
        return () => { live = false; };
    }, [api, present]);
    React.useEffect(function () { ensure(current.id); }, [current.id]);
    function close(refocus) {
        setOpen(false);
        if (refocus && trigger.current && typeof trigger.current.focus === "function") trigger.current.focus({ preventScroll: true });
    }
    function choose(id) { api.setOverride(role, id); close(true); }
    // Open: focus the current option; Esc (window capture, before the CONFIG screen) and a press outside close it.
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
    function keepFocus(event) { if (!(event.target && event.target.closest && event.target.closest('[role="option"]'))) event.preventDefault(); }
    // One row per font: ✓ · its name in the interface face · the sample in its own face (the name always reads).
    function option(font, key, id, name, extra, note) {
        const selected = chosen === id;
        return h("button", { key, type: "button", role: "option", "aria-selected": selected, "aria-label": note ? name + "（" + note + "）" : name,
            className: "fork-font-option" + (selected ? " is-on" : "") + (extra ? " " + extra : ""), "data-font-id": font ? font.id : undefined,
            onPointerEnter: () => ensure(font && font.id), onFocus: () => ensure(font && font.id), onClick: () => choose(id) },
            h("span", { className: "fork-font-option-check", "aria-hidden": true }, selected ? h(Icon, { name: "check", size: 16 }) : null),
            h("span", { className: "fork-font-option-name" }, name, note ? h("small", null, note) : null),
            h("span", { className: "fork-font-option-sample", "aria-hidden": true, style: font ? { fontFamily: fontFace(font) } : undefined }, FONT_SAMPLE));
    }
    if (!present) return h("span", null, "系统字体");
    const list = h("div", { className: "fork-font-list", role: "listbox", "aria-label": props.label, onKeyDown: onListKey },
        option(defaultFont, "follow", null, props.follow, "is-follow", fontName(defaultFont, props.builtin)),
        fontGroups(fonts).map(group => h("div", { key: group.id, className: "fork-font-group", role: "group", "aria-label": group.label },
            h("div", { className: "fork-font-group-label", "aria-hidden": true }, group.label),
            group.fonts.map(font => option(font, font.id, font.id, fontName(font))))));
    // The list is portaled outside the stage: it carries the stage's tokens and its skin font declaration.
    const stageTokens = {};
    let skinFonts;
    if (open && trigger.current && typeof getComputedStyle === "function") {
        const style = getComputedStyle(trigger.current);
        for (const key of style) if (key.startsWith("--gal-")) stageTokens[key] = style.getPropertyValue(key);
        const stage = trigger.current.closest && trigger.current.closest("[data-fk-fonts]");
        skinFonts = stage ? stage.getAttribute("data-fk-fonts") : undefined;
    }
    const popover = !open ? null : h(FloatingPanel, { anchor: trigger, popRef: pop, className: "fork-font-pop is-stage is-rows fork-gal-theme-scope", style: stageTokens, "data-theme": props.theme || "",
        "data-fk-fonts": skinFonts, gap: 8, onMouseDown: keepFocus }, list);
    return h("div", { ref: wrap, className: "fork-font-pick is-stage" + (open ? " is-open" : ""), "data-role": role },
        h("button", { ref: trigger, type: "button", className: "fork-font-trigger", "aria-haspopup": "listbox", "aria-expanded": open,
            "aria-label": props.label + "：" + currentName + (chosen === null ? "，" + props.follow : ""),
            onClick: () => setOpen(value => !value),
            onKeyDown: event => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); } } },
            h("span", { className: "fork-font-trigger-name", style: currentFont ? { fontFamily: fontFace(currentFont) } : undefined }, currentName),
            h(Icon, { name: "chevron", size: 16 })),
        popover);
}
return StageFontPicker;
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageConfigFields,createStageFontPicker};
