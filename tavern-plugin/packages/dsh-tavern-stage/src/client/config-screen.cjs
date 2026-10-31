function createStageConfigScreen({React:react, window, document, matchMedia, rpc, sections:STAGE_CONFIG_SECTIONS, useSounds:useForkUiSfxControls, sounds:forkUiSfx, Icon, Sound:GalConfigSound, Text:GalConfigText, Appearance:GalConfigScreenTab}) {
let disposed=false;
const cleanups=new Set();
const React={...react,useEffect(setup,deps){react.useEffect(()=>{
    if(disposed)return;
    const cleanup=setup();if(typeof cleanup!=='function')return;
    let active=true;
    const release=()=>{if(!active)return;active=false;cleanups.delete(release);cleanup();};cleanups.add(release);return release;
},deps);},createElement(type,props,...children){
    const guarded=props&&Object.fromEntries(Object.entries(props).map(([name,value])=>[name,/^on[A-Z]/.test(name)&&typeof value==='function'?(...args)=>{if(!disposed)return value(...args);}:value]));
    return react.createElement(type,guarded,...children);
}};
function useStageMods(sessionId) {
    const [mods, setMods] = React.useState([]);
    React.useEffect(() => {
        let live = true, ticket = 0;
        const refresh = async () => {
            if(!live||disposed)return;
            const own = ++ticket;
            // The mod service rejects unknown fields: no sessionId here (global scope is what filters the tabs).
            try { const value = await rpc('listMods', {}); if (!disposed && live && own === ticket) setMods(value.mods); }
            catch (_) { if (!disposed && live && own === ticket) setMods([]); }
        };
        refresh(); window.addEventListener('dsh-tavern-mods-changed', refresh);
        return () => { live = false; window.removeEventListener('dsh-tavern-mods-changed', refresh); };
    }, [sessionId]);
    return mods;
}
const GAL_CONFIG_TABS = [["sound", "声音"], ["text", "文字"], ["screen", "画面"]];
const GAL_CONFIG_MODS_TAB = ["mods", "模组"];
// The last tab stays selected while the page lives (reopening returns to it; the top bar's 声音 sets it to sound).
let galConfigLastTab = "sound";

// phones get a dedicated compact layout: a full-bleed sheet, a one-line
// title with the ✕ inside the header, the tabs as a horizontal bar and the rows stacked (label above control). Narrow
// viewports, and short touch screens (a phone held sideways). Wide screens keep the two-column sheet unchanged.
const GAL_CONFIG_COMPACT = "(max-width: 640px), (max-height: 520px) and (pointer: coarse)";
function useGalConfigCompact() {
    const has = typeof matchMedia === "function";
    const [compact, setCompact] = React.useState(() => has && matchMedia(GAL_CONFIG_COMPACT).matches);
    React.useEffect(function () {
        if (!has) return undefined;
        let active=true;
        const list = matchMedia(GAL_CONFIG_COMPACT), changed = () => {if(active&&!disposed)setCompact(list.matches);};
        changed();
        if (list.addEventListener) list.addEventListener("change", changed);
        return () => { active=false; if (list.removeEventListener) list.removeEventListener("change", changed); };
    }, []);
    return compact;
}

// Full-screen Config. props: { sessionId, data, tests: { voice(), sfx() }, onClose() }.
// Esc, right click or the ✕ close it; focus stays inside while open and goes back to the opener afterwards (stage).
function GalConfigScreen(props) {
    const h = React.createElement;
    const compact = useGalConfigCompact();
    const mods = useStageMods(props.sessionId);
    // one 模组 tab with a section per enabled mod that has stage preferences.
    const sections = mods.filter(row => row.scope === 'global' && STAGE_CONFIG_SECTIONS[row.id]).map(row => STAGE_CONFIG_SECTIONS[row.id]);
    const tabs = sections.length ? [...GAL_CONFIG_TABS, GAL_CONFIG_MODS_TAB] : GAL_CONFIG_TABS;
    const [selected, setTab] = React.useState(() => galConfigLastTab);
    const tab = tabs.some(([id]) => id === selected) ? selected : 'sound';
    const root = React.useRef(null);
    const tabRefs = React.useRef({});
    // galgame UI cues (ui-sfx.js) for tabs, switches and slider releases; the stage cues open / close.
    useForkUiSfxControls(root);
    function choose(id, focus) { galConfigLastTab = id; setTab(id); if (focus && tabRefs.current[id]) tabRefs.current[id].focus(); }
    React.useEffect(function () {
        const active = tabRefs.current[tab];
        if (active) active.focus({ preventScroll: true });
        // Esc closes before the stage sees it; an open ? tip closes first.
        function onKey(event) {
            if(disposed)return;
            if (event.key !== "Escape") return;
            // A held Esc (auto-repeat) is not a new press: it must not close Config and then reach the stage.
            if (event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            if (event.target && event.target.closest && event.target.closest(".fork-help-tip.is-open")) return;
            // An open font picker or skin select (their lists are portaled to <body>) takes Esc first too.
            if (event.target && event.target.closest && event.target.closest(".fork-font-pick.is-open, .fork-font-pop, .fork-gal-skin-pick.is-open, .fork-gal-skin-pop")) return;
            event.preventDefault(); event.stopImmediatePropagation(); props.onClose();
        }
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);
    // Tab cycles inside the screen; the stage never sees keys typed here.
    function onKeyDown(event) {
        event.stopPropagation();
        if (event.key !== "Tab" || !root.current) return;
        const items = Array.from(root.current.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")).filter(node => node.offsetParent !== null || node === document.activeElement);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function onTabKey(event) {
        const at = tabs.findIndex(([id]) => id === tab);
        const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? at + 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        forkUiSfx.play("move");
        choose(tabs[(next + tabs.length) % tabs.length][0], true);
    }
    // Mount only the active tab: hidden font pickers/previews would still load fonts and run effects.
    const page = tab === "mods" ? sections.map(section => h(section.Component, { key: section.label, rpc, sessionId: props.sessionId, compact })) : tab === "sound" ? h(GalConfigSound, props) : tab === "text" ? h(GalConfigText, props) : h(GalConfigScreenTab, props);
    // one small, quiet ✕ at the end of the header row, inside the sheet, in both layouts.
    const close = h("button", { type: "button", className: "fork-gal-config-close", title: "关闭（Esc / 右键）", "aria-label": "关闭设置", onClick: props.onClose }, h(Icon, { name: "close", size: compact ? 22 : 20 }));
    return h("div", { ref: root, className: "fork-gal-config", "data-leaving": props.leaving || undefined, inert: props.leaving || undefined, "data-layout": compact ? "compact" : "wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "fork-gal-config-title",
        onClick: event => event.stopPropagation(), onWheel: event => event.stopPropagation(), onKeyDown,
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); props.onClose(); } },
        h("div", { className: "fork-gal-config-sheet" },
            h("i", { className: "fork-gal-config-ornament", "aria-hidden": true }),
            // no inner frame line (no box in box); this layer only carries the corner sparkles.
            h("i", { className: "fork-gal-config-frame", "aria-hidden": true }),
            h("header", { className: "fork-gal-config-head" },
                h("h2", { id: "fork-gal-config-title", className: "fork-gal-config-title" }, h("i", { className: "fork-gal-config-gem", "aria-hidden": true }), h("b", null, "设置")),
                close),
            h("nav", { className: "fork-gal-config-tabs", style:compact ? {gridTemplateColumns:'repeat(' + tabs.length + ', minmax(0, 1fr))'} : undefined, role: "tablist", "aria-orientation": compact ? "horizontal" : "vertical", "aria-label": "设置分类" },
                tabs.map(([id, label]) => h("button", { key: id, ref: node => { tabRefs.current[id] = node; }, type: "button", role: "tab", id: "fork-gal-config-tab-" + id,
                    "aria-selected": tab === id, "aria-controls": "fork-gal-config-page", tabIndex: tab === id ? 0 : -1, className: "fork-gal-config-tab" + (tab === id ? " is-on" : ""),
                    onClick: () => choose(id), onKeyDown: onTabKey },
                    h("i", { className: "fork-gal-config-gem", "aria-hidden": true }), h("b", null, label)))),
            h("section", { id: "fork-gal-config-page", className: "fork-gal-config-page", role: "tabpanel", "aria-labelledby": "fork-gal-config-tab-" + tab, "data-tab": tab }, page)));
}

return {Screen:GalConfigScreen, select(tab){if(!disposed)galConfigLastTab=tab;},dispose(){
    if(disposed)return;disposed=true;
    const errors=[];for(const cleanup of [...cleanups]){try{cleanup();}catch(error){errors.push(error);}}
    if(errors.length)throw new AggregateError(errors,'Stage config cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageConfigScreen};
