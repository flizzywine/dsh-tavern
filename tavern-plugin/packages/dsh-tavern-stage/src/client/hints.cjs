'use strict';
function createStageHints({React, window, document, storage:forkFrameStorage, music, setTimeout, clearTimeout}) {
let disposed = false;
const cleanups = new Set();
// A touch screen (GAL_TOUCH_QUERY: no hover, coarse pointer) has no keys: the key list is never rendered there, nor marked seen.
const GAL_TOUCH_QUERY = '(hover: none) and (pointer: coarse)';
const matchMedia = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
function galTouchOnly() { return Boolean(matchMedia && matchMedia(GAL_TOUCH_QUERY).matches); }
function galTouchSubscribe(changed) {
    if (!matchMedia) return () => {};
    const list = matchMedia(GAL_TOUCH_QUERY);
    list.addEventListener?.('change', changed);
    return () => list.removeEventListener?.('change', changed);
}
const GAL_KEYS_HINT = 'stage-shortcuts';
let galSoundHintShown = false;
function useGalFirstRunHints(visible, rootRef, position) {
    const store = typeof forkFrameStorage === 'object' && forkFrameStorage && typeof forkFrameStorage.seen === 'function' ? forkFrameStorage : null;
    const [keyList, setKeys] = React.useState(false), [soundGone, setSoundGone] = React.useState(galSoundHintShown);
    const touch = React.useSyncExternalStore(galTouchSubscribe, galTouchOnly, () => false), keys = keyList && !touch;
    const blocked = React.useSyncExternalStore(music.subscribeBlocked, music.blocked, () => false);
    React.useEffect(function () {
        if (!visible || !store) return undefined;
        let live = true;
        Promise.resolve(store.load()).then(() => { if (!disposed && live && store.loaded() && !store.seen(GAL_KEYS_HINT)) setKeys(true); }, () => {});
        return () => { live = false; };
    }, [visible]);
    const sound = Boolean(visible && blocked && !soundGone);
    if (sound) galSoundHintShown = true;
    React.useEffect(function () {
        if (!keys && !sound) return undefined;
        let timer = 0;
        const releaseClick = () => { clearTimeout(timer); document.removeEventListener('click', swallow, true); cleanups.delete(releaseClick); };
        const swallow = event => { event.stopPropagation(); event.preventDefault(); };
        function dismiss(event) {
            if (disposed) return;
            if (keys) store.markSeen(GAL_KEYS_HINT);
            setKeys(false); setSoundGone(true);
            const target = event.target, root = rootRef.current;
            if (event.type === 'pointerdown' && root && target && root.contains(target) && !(target.closest && target.closest('button, input, select, textarea, a'))) {
                document.addEventListener('click', swallow, { capture: true, once: true });
                cleanups.add(releaseClick);
                timer = setTimeout(releaseClick, 600);
            }
        }
        window.addEventListener('keydown', dismiss, true);
        window.addEventListener('pointerdown', dismiss, true);
        const stop = () => { window.removeEventListener('keydown', dismiss, true); window.removeEventListener('pointerdown', dismiss, true); cleanups.delete(stop); };
        cleanups.add(stop);
        return stop;
    }, [keys, sound]);
    const shownAt = React.useRef(null);
    React.useEffect(function () {
        if (!keys) { shownAt.current = null; return; }
        if (shownAt.current === null) { shownAt.current = position; return; }
        if (shownAt.current !== position) { if (store) store.markSeen(GAL_KEYS_HINT); setKeys(false); }
    }, [keys, position]);
    const showKeys = React.useCallback(() => setKeys(true), []);
    return React.useMemo(() => ({ keys, sound, touch, showKeys }), [keys, sound, touch, showKeys]);
}
return {useHints:useGalFirstRunHints, dispose() { if (disposed) return; disposed = true; const errors = []; for (const cleanup of [...cleanups]) { try {cleanup();} catch (error) {errors.push(error);} } cleanups.clear(); if (errors.length) throw new AggregateError(errors, 'Stage hint cleanup failed'); }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageHints};
