function createStageDevice({React, matchMedia, window: host = null}) {
let disposed = false;
const subscriptions = new Set();
const qualityStops = new Set();
// the device presentation profile.
// Director commands and the persistent stage state are device-independent; how a presentation command LOOKS on this
// screen is a render-time projection of that state, so a resized window, a rotated phone or another device re-renders
// correctly without a new command and without rewriting anything.
//
// Profiles, from the stage's existing breakpoints (the compact CONFIG sheet, gal-config.js, and the stage's
// ≤ 640px and 641-1024px layouts in theme.css): a short touch screen is a phone held sideways; otherwise a narrow viewport
// is a phone held upright, a viewport up to 1024px a tablet (or a narrow window); everything else is desktop.
// The stage root carries the profile (data-fk-device): theme.css keys the reading minimums on it, and a skin's own
// per-device override (skin devices.mobile / devices.pc, galDeviceSkinSide) is picked by it - skin-interface.md §13.1.
const GAL_DEVICE_QUERIES = Object.freeze({
    "mobile-landscape": "(max-height: 520px) and (pointer: coarse)",
    "mobile-portrait": "(max-width: 640px)",
    "tablet": "(max-width: 1024px)"
});
// The one table: presentation command -> what it renders as, per profile. A command absent here looks the same everywhere.
//   camera.close: the close-up (gal-scene.js galCloseFrame), or the normal shot - on an upright phone the full
//   choice menu reserved under a close-up takes most of the screen, so the face cannot fit.
const GAL_DEVICE_RENDER = Object.freeze({
    "camera.close": Object.freeze({ desktop: "close", "mobile-landscape": "close", "mobile-portrait": "normal" })
});
function galDeviceProfile() {
    if (typeof matchMedia !== "function") return "desktop";
    for (const name of Object.keys(GAL_DEVICE_QUERIES)) if (matchMedia(GAL_DEVICE_QUERIES[name]).matches) return name;
    return "desktop";
}
// A phone in the hand, either way up: a mobile profile on a touch screen. Like the phone mod's handheld sheet
// (source-widgets.cjs phoneModHandheld), never a narrow desktop window. The scene draws lighter there (galFrameRate,
// galResolution) to spare a phone's battery.
function galDeviceHandheld() {
    return galDeviceProfile().startsWith("mobile") && matchMedia("(pointer: coarse)").matches;
}
// The skin's side of a profile: phones are mobile, tablets and desktops are pc (the wide stage's art).
function galDeviceSkinSide(profile) {
    return profile.startsWith("mobile") ? "mobile" : "pc";
}
function galDeviceSubscribe(changed) {
    if (disposed || typeof matchMedia !== "function") return () => {};
    const lists = Object.values(GAL_DEVICE_QUERIES).map(query => matchMedia(query));
    let active = true;
    const notify = () => { if (active && !disposed) changed(); };
    const release = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(release);
        const errors = [];
        for (const list of lists) { try { list.removeEventListener?.("change", notify); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'Stage device listener cleanup failed');
    };
    subscriptions.add(release);
    try { lists.forEach(list => list.addEventListener?.("change", notify)); }
    catch (error) {
        try { release(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Stage device subscription failed'); }
        throw error;
    }
    return release;
}
function useGalDeviceProfile() {
    return React.useSyncExternalStore(galDeviceSubscribe, galDeviceProfile, () => "desktop");
}
// What the command renders as on this profile ("" when the table does not know the command).
function galDeviceRender(command, profile) {
    const row = GAL_DEVICE_RENDER[command];
    return row ? row[profile] || row.desktop : "";
}
// The accepted stage state as this profile shows it: the same object when nothing differs, otherwise a shallow copy with
// the projected fields. Never stored or sent anywhere.
function galDeviceState(state, profile) {
    if (state?.camera?.mode === "close" && galDeviceRender("camera.close", profile) === "normal")
        return { ...state, camera: { mode: "reset", actor: null } };
    return state;
}

// 画质 (CONFIG 效果 › 画质): the reader's per-device setting - auto (the default) or a fixed tier - and the tier it
// resolves to here. Auto is the device's recommendation (galQualityRecommend): a desktop or a laptop with a touch screen
// (a fine primary pointer) draws high, as it always did; a phone or a tablet draws medium, or saver when it reports
// little power or speed. What each tier draws: scene-math.cjs galFrameRate (frame rates), canvas-resolution.cjs
// galResolution (pixel ratio), scene.cjs (multisampling, depth of field, effects), text.cjs (the typed glyphs' fade: high only).
const GAL_QUALITY_TIERS = Object.freeze(["high", "medium", "saver"]);
// A phone or tablet in the hand: a coarse primary pointer, or iPadOS's desktop-class Safari (a Mac user agent with a
// touch screen; a real Mac reports no touch points).
function galDevicePortable() {
    if (typeof matchMedia !== "function") return false;
    const nav = host?.navigator;
    return matchMedia("(pointer: coarse)").matches || (nav?.maxTouchPoints > 1 && /Macintosh/.test(nav.userAgent || ""));
}
// The recommendation from what the device tells (each signal only where the browser reports it): two cores or fewer
// (iOS Safari reports a clamped count, so only a truly small one counts), 3 GB of memory or less (Chromium only), a battery under 20% and not charging, data saver, or animation frames at half a 60 Hz display or slower in
// the stage's first seconds (iOS Low Power Mode holds them at 30 Hz; an overloaded device misses them).
function galQualityRecommend({portable, cores = 0, memory = 0, battery = null, saveData = false, frameMs = null}) {
    if (!portable) return { tier: "high", reason: "desktop" };
    if (cores > 0 && cores <= 2) return { tier: "saver", reason: "cores" };
    if (memory > 0 && memory <= 3) return { tier: "saver", reason: "memory" };
    if (battery && !battery.charging && battery.level <= 0.2) return { tier: "saver", reason: "battery" };
    if (saveData) return { tier: "saver", reason: "save-data" };
    if (frameMs !== null && frameMs >= 25) return { tier: "saver", reason: "frames" };
    return { tier: "medium", reason: "portable" };
}
// The stage's quality over the setting store ({get, set, subscribe} of "auto" | a tier): get() is the tier in force.
// On a phone or tablet the frame probe runs once (3 s of animation frames after the first read) and the battery is
// watched; either changing the recommendation notifies the subscribers.
function galDeviceQuality(store) {
    const listeners = new Set(), nav = host?.navigator;
    let probe = null, frameMs = null, battery = null;
    const notify = () => { if (!disposed) for (const fn of [...listeners]) fn(); };
    const signals = () => ({ portable: galDevicePortable(), cores: Number(nav?.hardwareConcurrency) || 0, memory: Number(nav?.deviceMemory) || 0,
        battery, saveData: nav?.connection?.saveData === true, frameMs });
    function startProbes() {
        if (probe || disposed || !host || !galDevicePortable()) return;
        probe = "running";
        const raf = host.requestAnimationFrame?.bind(host), gaps = [];
        let last = 0, until = 0, stopped = false;
        const start = host.setTimeout(() => {
            if (!raf) return;
            until = host.performance.now() + 3000;
            const step = now => {
                if (stopped) return;
                // A long task (loading) is not the display's pace.
                if (last && now - last < 100) gaps.push(now - last);
                last = now;
                if (now < until) { raf(step); return; }
                probe = "done";
                if (gaps.length < 30) return;
                const sorted = gaps.sort((a, b) => a - b);
                frameMs = sorted[Math.floor(sorted.length / 2)];
                notify();
            };
            raf(step);
        }, 1500);
        qualityStops.add(() => { stopped = true; host.clearTimeout(start); });
        nav?.getBattery?.().then(found => {
            if (disposed) return;
            const read = () => { battery = { charging: found.charging, level: found.level }; notify(); };
            read();
            found.addEventListener?.("levelchange", read); found.addEventListener?.("chargingchange", read);
            qualityStops.add(() => { found.removeEventListener?.("levelchange", read); found.removeEventListener?.("chargingchange", read); });
        }, () => {});
    }
    const setting = () => { const value = store.get(); return GAL_QUALITY_TIERS.includes(value) ? value : "auto"; };
    const recommendation = () => galQualityRecommend(signals());
    return {
        setting, recommendation, set: value => store.set(value),
        get() { const chosen = setting(); if (chosen !== "auto") return chosen; startProbes(); return recommendation().tier; },
        subscribe(fn) {
            listeners.add(fn);
            const off = store.subscribe(fn);
            // A rotated or resized window can cross from desktop to portable (a docked tablet).
            const offProfile = galDeviceSubscribe(fn);
            return () => { listeners.delete(fn); off(); offProfile(); };
        }
    };
}

return {useProfile:useGalDeviceProfile, state:galDeviceState, profile:galDeviceProfile, subscribe:galDeviceSubscribe, handheld:galDeviceHandheld, skinSide:galDeviceSkinSide, quality:galDeviceQuality, recommend:galQualityRecommend, tiers:GAL_QUALITY_TIERS, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const stop of [...qualityStops]) { try { stop(); } catch (error) { errors.push(error); } }
    for (const release of [...subscriptions]) { try { release(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Stage device cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageDevice};
