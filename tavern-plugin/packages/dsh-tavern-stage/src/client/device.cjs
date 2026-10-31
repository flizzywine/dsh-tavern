function createStageDevice({React, matchMedia}) {
let disposed = false;
const subscriptions = new Set();
// the device presentation profile.
// Director commands and the persistent stage state are device-independent; how a presentation command LOOKS on this
// screen is a render-time projection of that state, so a resized window, a rotated phone or another device re-renders
// correctly without a new command and without rewriting anything.
//
// Profiles, from the stage's existing breakpoints (the compact CONFIG sheet, gal-config.js, and the stage's
// ≤ 640px layout in theme.css): a short touch screen is a phone held sideways; otherwise a narrow viewport is a
// phone held upright; everything else is desktop.
const GAL_DEVICE_QUERIES = Object.freeze({
    "mobile-landscape": "(max-height: 520px) and (pointer: coarse)",
    "mobile-portrait": "(max-width: 640px)"
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

return {useProfile:useGalDeviceProfile, state:galDeviceState, profile:galDeviceProfile, subscribe:galDeviceSubscribe, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const release of [...subscriptions]) { try { release(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Stage device cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageDevice};
