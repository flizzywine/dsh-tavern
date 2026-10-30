// the one
// client adapter to a mod's resolved options on the stage. A mod is a pure capability with a built-in preset; the active
// skin may set option values, turn features on or off and lock options; the player adjusts the user-adjustable ones in two
// layers (舞台设置 › 模组 › 设置). The host resolves - skin lock > 本卡 > 全局 > skin value > preset, a missing piece back
// to its preset (resolveModOptions) - and answers getStageModOptions({modId}) for the open chat:
//   {revision, values:{key:value}, options:{key:{value, source, locked, userAdjustable}}, skin:{name}|null,
//    media:{<skin asset name>: url}}
// Renderers read only `values` (and `media` for x-skin-asset options); nothing here re-resolves or validates.
// A settings write (useModConfig) or a skin change asks again; switching skins is not a reset of the player's values.
const modOptionReads = new Map();
function modOptionsRead(sessionId, modId) {
    const key = JSON.stringify([sessionId, modId]);
    if (!modOptionReads.has(key)) modOptionReads.set(key, rpc('getStageModOptions', {modId}, sessionId).catch(error => { modOptionReads.delete(key); throw error; }));
    return modOptionReads.get(key);
}
// The answer for one mod while `enabled` (the capability is on the stage); `skinKey` is the drawn skin's identity.
function useModOptions(sessionId, modId, {enabled = true, skinKey = ''} = {}) {
    const [answer, setAnswer] = React.useState(null), [epoch, setEpoch] = React.useState(0);
    React.useEffect(() => {
        const changed = event => { if (!event.detail?.modId || event.detail.modId === modId) { modOptionReads.clear(); setEpoch(n => n + 1); } };
        window.addEventListener('dsh-tavern-mod-options-changed', changed);
        return () => window.removeEventListener('dsh-tavern-mod-options-changed', changed);
    }, [modId]);
    const shownSkin = React.useRef(skinKey);
    React.useEffect(() => {
        if (shownSkin.current !== skinKey) { shownSkin.current = skinKey; modOptionReads.delete(JSON.stringify([sessionId, modId])); }
        if (!enabled || !sessionId) return undefined;
        let live = true;
        modOptionsRead(sessionId, modId).then(value => { if (live) setAnswer(value); }, error => console.warn('Mod options unavailable', modId, error));
        return () => { live = false; };
    }, [sessionId, modId, enabled, skinKey, epoch]);
    return answer;
}
