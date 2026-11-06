// where and how big the stage phone is, on this
// device. A browser preference (localStorage, never the chat, the card or the director), kept per layout - wide (a desktop
// window) and narrow (a phone, under 700px) each remember their own size (percent of the automatic band size, 50–150; narrow
// 70–150: smaller is too cramped on a phone, and a smaller stored value reads as 70) and
// place (fractions of the free stage, as stageWidgetPlaces, so a resize keeps the phone inside); `unlocked` lets the reader
// drag the phone by its edge (gal-widgets.js ring) and nudge it with the arrow keys. Without a place the phone sits
// centred in the band above the dialogue box as before, so by default it never covers the box; a moved phone stays where
// it was put. The stage CONFIG › 模组 › 手机 section edits it (ui-design R21: a per-play, often-adjusted setting).
function phoneModSizeMin(name) { return stageViews.phoneLayout.min(name); }
const phoneModPrefs = {
    get:()=>stageViews?.phoneLayout.prefs.get() || null,
    subscribe:fn=>stageViews?.phoneLayout.prefs.subscribe(fn) || (()=>{}),
    set:patch=>stageViews?.phoneLayout.prefs.set(patch),
    update:(...args)=>stageViews?.phoneLayout.prefs.update(...args),
    current:width=>stageViews.phoneLayout.prefs.current(width),
};

function usePhoneAdjust(...args) { return stageViews.phoneAdjust.useAdjust(...args); }
