function createStagePhoneLayout({React, storage:localStorage, width, group:galConfigGroup, row:galConfigRow, slider:galConfigSlider, Switch:GalConfigSwitch, ResetButton, sections:STAGE_CONFIG_SECTIONS}) {
let disposed = false;
const viewportWidth=()=>width?.() ?? 1024;
const PHONE_SIZE = Object.freeze({ min: 50, narrowMin: 70, max: 150, step: 5, default: 100 });
// The smallest size percent of a layout ("wide" / "narrow").
function phoneModSizeMin(name) { return name === "narrow" ? PHONE_SIZE.narrowMin : PHONE_SIZE.min; }
const phoneModPrefs = (function () {
    const KEY = "fork-phone-layout", listeners = new Set(); let cached = null;
    const layout = (saved, name) => ({ size: Number.isFinite(saved?.size) ? Math.min(PHONE_SIZE.max, Math.max(phoneModSizeMin(name), Math.round(saved.size))) : PHONE_SIZE.default,
        place: Array.isArray(saved?.place) && saved.place.length === 2 && saved.place.every(n => Number.isFinite(n) && n >= 0 && n <= 1) ? saved.place : null });
    const normalize = saved => ({ unlocked: saved?.unlocked === true, wide: layout(saved?.wide, "wide"), narrow: layout(saved?.narrow, "narrow") });
    function get() {
        if (!cached) { let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {} cached = normalize(saved); }
        return cached;
    }
    function set(patch) {
        if (disposed) return;
        cached = normalize({ ...get(), ...patch });
        try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch (_) {}
        for (const listener of listeners) listener();
    }
    return { clear:()=>listeners.clear(), get, set, subscribe(listener) { if(disposed)return()=>{}; listeners.add(listener); return () => listeners.delete(listener); },
        // The layout the stage is in: narrow under 700px (the widget owner's own narrow test).
        current(width) { return (width ?? viewportWidth()) < 700 ? "narrow" : "wide"; },
        // One layout's entry changed (size / place); null place forgets the reader's spot.
        update(name, patch) { set({ [name]: { ...get()[name], ...patch } }); } };
})();
function usePhonePrefs() { return React.useSyncExternalStore(phoneModPrefs.subscribe, phoneModPrefs.get, phoneModPrefs.get); }

// The stage CONFIG › 模组 › 手机 section (gal-config.js building blocks; include after it). props: { compact }.
function PhoneStageConfig() {
    const h = React.createElement, prefs = usePhonePrefs(), name = phoneModPrefs.current(), layout = prefs[name];
    const [draft, setDraft] = React.useState(null), size = draft ?? layout.size;
    return galConfigGroup("手机", null,
        galConfigRow("解锁手机位置", h("span", { className: "fork-gal-config-inline" },
                h(GalConfigSwitch, { label: "解锁手机位置", checked: prefs.unlocked, onChange: value => phoneModPrefs.set({ unlocked: value }) }),
                layout.place ? h(ResetButton, { label: "恢复默认位置", onClick: () => phoneModPrefs.update(name, { place: null }) }) : null),
            "打开后在舞台上拖动手机移动，拖右下角、滚轮或双指缩放；也可以直接长按手机边框或顶部状态栏。松手几秒后或点手机外面即锁定；双击手机回到默认位置。", null, "toggle"),
        galConfigRow("手机大小", galConfigSlider(["小", "大"], { min: phoneModSizeMin(name), max: PHONE_SIZE.max, step: PHONE_SIZE.step, value: size, label: "手机大小",
                valueText: size + "%", output: size + "%", onChange: value => setDraft(value), onCommit: value => { setDraft(null); phoneModPrefs.update(name, { size: value }); } },
                size === PHONE_SIZE.default ? null : { label: "恢复为 100%", onClick: () => { setDraft(null); phoneModPrefs.update(name, { size: PHONE_SIZE.default }); } }),
            "100% 是手机自动填满文本框上方空间的大小；缩小后可以一边读故事一边看手机。电脑和手机各自记住。"));
}
const PHONE_STAGE_CONFIG = Object.freeze({ label: "手机", en: "PHONE", Component: PhoneStageConfig });

const previous=STAGE_CONFIG_SECTIONS?.['dsh.phone'];
if(STAGE_CONFIG_SECTIONS)STAGE_CONFIG_SECTIONS['dsh.phone']=PHONE_STAGE_CONFIG;
return {prefs:phoneModPrefs, sizes:PHONE_SIZE, min:phoneModSizeMin, dispose() {
    if(disposed)return;disposed=true;phoneModPrefs.clear();
    if(STAGE_CONFIG_SECTIONS?.['dsh.phone']===PHONE_STAGE_CONFIG) {
        if(previous===undefined)delete STAGE_CONFIG_SECTIONS['dsh.phone'];else STAGE_CONFIG_SECTIONS['dsh.phone']=previous;
    }
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStagePhoneLayout};
