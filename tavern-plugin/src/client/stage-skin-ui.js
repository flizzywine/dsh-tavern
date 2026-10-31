// changes are accepted at page boundaries; never persist font overrides.
// A skin other than the card's default skin was applied by the director (performance / skin command).
function stageSkinPerformed(skin, defaultKey) {
    if (!skin) return false;
    let value = null;
    try { value = defaultKey ? JSON.parse(defaultKey) : null; } catch (_) { value = null; }
    if (skin.builtin) return skin.document?.id !== (typeof value === 'string' ? value : 'classic');
    return !(skin.ref && value && typeof value === 'object' && skin.ref.packId === value.packId && skin.ref.assetId === value.assetId);
}
// the card's skin as the stage config resolves it (card-stage.js:
// document, ref and the bundle's resource descriptor) draws at once - CONFIG 本卡皮肤 needs no new projection. A pack skin's bundle
// is acquired from the shared resource owner under the stage authority (the projection's own pin then shares the entry, same
// identity). Until the new bundle is decoded the stage keeps drawing the skin it shows, with that skin's default key, so a
// switch never flashes an unskinned stage or moves the drawn buttons' actions into the Esc menu. A failed read of a new
// bundle draws the document alone (no art) until a retry reads it; of the bundle already shown (a pack revision moved), it keeps that art. -> { skin, defaultKey }.
function useStageConfigSkin(sessionId, skin, defaultKey) {
    const descriptor = !skin?.builtin && !skin?.url && skin?.resource?.kind === 'bundle' ? skin.resource : null;
    const session = descriptor ? stageSessions.get(sessionId) : null;
    const authority = React.useSyncExternalStore(session?.subscribe || stageConfigSkinIdle, () => {
        const source = session?.getSnapshot().source;
        return source ? JSON.stringify([source.sessionId,source.authorityEpoch]) : null;
    });
    const key = descriptor && authority ? JSON.stringify([authority,descriptor.identity,descriptor.revision]) : '';
    const [ready, setReady] = React.useState(null);
    // A failed read is asked again (1 s, doubling to 30 s) while this key stands: one transient host read failure at stage
    // open must not leave the stage without its art until a refresh (2026-10-23 live).
    const [attempt, setAttempt] = React.useState({key:'',n:0});
    const tries = attempt.key === key ? attempt.n : 0;
    const pins = React.useRef({current:null,held:null});
    React.useEffect(() => {
        const owner = stageSessions.resourceOwner;
        if (!key || !owner) return undefined;
        let live = true, timer = null;
        owner.acquire(descriptor,authority).then(pin => {
            if (!live) { pin.release(); return; }
            pins.current.held?.release(); pins.current.held = pins.current.current; pins.current.current = pin;
            setReady({key,skin:{...skin,url:pin.handle.url},defaultKey});
        }, error => {
            if (!live) return;
            console.warn('Stage skin bundle unavailable',error);
            // The same bundle content already on screen (only the pack revision moved) keeps its art.
            const held = pins.current.current;
            setReady(held?.handle.identity === descriptor.identity ? {key,skin:{...skin,url:held.handle.url},defaultKey} : {key,skin,defaultKey});
            timer = setTimeout(() => setAttempt({key,n:tries + 1}), Math.min(30000, 1000 * 2 ** tries));
        });
        return () => { live = false; clearTimeout(timer); };
    },[key,tries]);
    React.useEffect(() => () => { pins.current.held?.release(); pins.current.current?.release(); },[]);
    // The skin on screen until a newer one is ready (its bundle pin is released one switch later, never under it).
    // loading: no bundle of this skin has been read yet (its first read, or the stage authority it waits for, is still on its
    // way) and no earlier skin is on screen - the stage entry keeps its veil up (useGalEntry held) rather than reveal the
    // unskinned chrome (e.g. the engine's quick menu and box under the loader). A failed read settles it.
    // pending: a newer skin's bundle is still being read while the stage keeps drawing the one it shows (CONFIG 本卡皮肤 shows
    // the choice busy until then).
    const shown = React.useRef(null);
    const value = !key ? descriptor ? {skin,defaultKey,loading:true} : {skin,defaultKey}
        : ready?.key === key ? ready : shown.current && !shown.current.loading ? shown.current : {skin,defaultKey,loading:true};
    shown.current = value;
    return descriptor && ready?.key !== key && !value.loading ? {...value,pending:true} : value;
}
const stageConfigSkinIdle = () => () => {};
// CONFIG 本卡皮肤 warms a pack skin's bundle while the player points at its option (hover, focus,
// press), under the authority useStageConfigSkin acquires it with. The released entry stays in the resource owner's warm
// cache, so the switch then waits for the card save only, not for the bundle's transfer and decode.
function stageSkinPrefetch(sessionId, resource) {
    const owner = stageSessions.resourceOwner, source = resource?.kind === 'bundle' ? stageSessions.get(sessionId)?.getSnapshot().source : null;
    if (!owner || !source) return;
    owner.acquire(resource,JSON.stringify([source.sessionId,source.authorityEpoch]),{prefetch:true}).then(pin => pin.release(),() => {});
}
// shown (optional ref): filled with { id, label } of the skin on screen, also in film mode - a pack skin's document id and
// label, else the built-in theme (its look keys on data-theme; label null = the theme's own name). CONFIG 文字大小 stores its value under this id.
// controls (optional): the stage's own skin (the card's, or the director's skin command) - the one control authority
// (「进入 cg 以后…丑陋的粉色按钮」): while a mode's skin is shown (a performance's: a territory, a
// barrier) that draws no buttons of its own (no art.buttons), the on-stage controls stay the stage skin's - its drawn buttons
// and decor, its folded menu control (quickMenu) and its top bar reveal (hud). A mode changes the box and the scene, never the
// control set, unless its skin declares one. The root then carries data-fk-skin-controls = the owning skin's id.
const STAGE_SKIN_CONTROL_MARKS = ['data-fk-skin-buttons','data-fk-skin-menu','data-fk-skin-decor'];
// The drawn buttons' placement tokens (stageSkinArt): the menu control's and the notices' place, wide and on phones, and the phone unit's floor.
const STAGE_SKIN_HUD_TOKENS = ['--art-hud-top','--art-hud-right','--art-hud-ntop','--art-hud-nright','--art-btn-min','--art-bar-l','--art-bar-r'];
// A stage skin whose controls are only its folded menu control (quickMenu orb / capsule, no art.buttons) lends that control's
// paint and its top bar reveal; the drawn skin's art stays its own (buttons: none).
function stageSkinControls(appearance, source, controls) {
    if (!appearance || appearance.art?.buttons || appearance.quickMenu?.icons || !controls?.document) return null;
    if (controls === source || source && controls.url === source.url && (controls.entry || '') === (source.entry || '')) return null;
    const own = stageSkinAppearance(controls.document,controls.level);
    const files = controls.url && typeof getStageBundleFiles === 'function' ? getStageBundleFiles(controls.url) : null;
    const {timer:_timer,...hud} = own?.hud || {};
    if (!own?.art?.buttons) {
        if (own?.quickMenu?.layout !== 'orb' && own?.quickMenu?.layout !== 'capsule') return null;
        return {id:own.id,quickMenu:own.quickMenu,icons:files ? stageSkinControlIcons(own,files,controls.entry || '') : null,hud:Object.keys(hud).length ? hud : undefined,declared:[],buttons:[],marks:{'data-fk-skin-controls':own.id},tokens:{}};
    }
    const art = files && stageSkinArt(own,files,controls.entry || '');
    if (!art?.buttons.length) return null;
    const marks = {'data-fk-skin-controls':own.id};
    for (const name of STAGE_SKIN_CONTROL_MARKS) if (name in art.marks) marks[name] = art.marks[name];
    const tokens = {};
    for (const name of ['--art-screen','--art-screen-w',...STAGE_SKIN_HUD_TOKENS]) tokens[name] = art.tokens[name];
    // hud.timer.hide names drawn buttons: it travels with the borrowed buttons (art.timerHide), not on the drawn skin's document,
    // which draws none of them.
    return {id:own.id,quickMenu:own.quickMenu,icons:stageSkinControlIcons(own,files,controls.entry || ''),hud:Object.keys(hud).length ? hud : undefined,declared:Object.keys(own.art.buttons),buttons:art.buttons,decor:art.decor,timerHide:art.timerHide,marks,tokens};
}
function useStageSkin(rootRef, candidate, pageKey, film, theme, {ready = true, snap = false, defaultKey = '', fallback = null, shown = null, deferFonts = false, controls = null} = {}) {
    const selected = React.useRef({page:null,value:null,hydrated:false});
    const previousDefault=React.useRef(defaultKey);
    if(previousDefault.current!==defaultKey) {selected.current={page:null,value:null,hydrated:false};previousDefault.current=defaultKey;}
    // Every page projects a new skin object with the same content: keep the one on screen, so the skin is not taken off and
    // put back (372 root tokens for one skin, the whole stage restyled) on every page turn.
    // The skin on screen drawn without its bundle (its read failed) takes the same skin's bundle the moment it arrives.
    const shownBare = selected.current.value, gainsArt = !!shownBare && !shownBare.url && !!candidate?.url && shownBare.document?.id === candidate.document?.id
        && JSON.stringify(shownBare.ref ?? null) === JSON.stringify(candidate.ref ?? null);
    if (selected.current.page !== pageKey || snap || !selected.current.hydrated && ready || gainsArt) {
        const shownValue = selected.current.value, same = shownValue && candidate && (shownValue === candidate || JSON.stringify(shownValue) === JSON.stringify(candidate));
        selected.current = {page:pageKey,value:same ? shownValue : candidate || null,hydrated:ready};
    }
    // Explicit withdrawal/revocation is immediate; a late replacement waits for the next page.
    if (!candidate) selected.current.value = null;
    const skin = selected.current.value;
    // source: the skin whose appearance is drawn - the selected one, or the fallback when there is none or its level keeps the
    // stage's look (look "theme"); its bundle supplies the art, faces and effects of that appearance.
    const chosen = React.useMemo(() => {
        const own=skin?.document ? stageSkinAppearance(skin.document,skin.level) : null;
        const source=own ? skin : fallback?.document ? fallback : null;
        const drawn=own || (source ? stageSkinAppearance(source.document,source.level) : null);
        const borrowed=drawn && source?.builtin!==true ? stageSkinControls(drawn,source,controls) : null;
        if (!borrowed) return {appearance:drawn,builtin:source?.builtin===true,source,borrowed:null};
        const appearance={...drawn};
        for (const key of ['quickMenu','hud']) if (borrowed[key]) appearance[key]=borrowed[key]; else delete appearance[key];
        return {appearance,builtin:false,source,borrowed};
    },[skin,fallback,controls]);
    const {appearance,builtin,source,borrowed}=chosen, lead=stageSkinPerformed(skin,defaultKey);
    if (shown) shown.current = appearance && !builtin ? {id:appearance.id,label:appearance.label || appearance.id} : {id:theme,label:null};
    // the art images are decoded files of the prepared skin bundle (stage-resources.cjs).
    // Borrowed controls join the drawn skin's art: their buttons, decor, marks and placement tokens (the design screen only when
    // the drawn skin has no art of its own to measure its box by).
    const art = React.useMemo(() => {
        const own = !builtin && source?.document?.art && source.url && typeof getStageBundleFiles === 'function'
            ? stageSkinArt(appearance,getStageBundleFiles(source.url),source.entry || '') : null;
        if (!borrowed) return own;
        // Only the folded menu control is lent (its paint is on the appearance): the drawn skin's art is unchanged but for the owner mark.
        if (!borrowed.buttons.length) return own && {...own,marks:{...own.marks,...borrowed.marks}};
        const tokens = {...borrowed.tokens,...own?.tokens,...Object.fromEntries(STAGE_SKIN_HUD_TOKENS.map(name => [name,borrowed.tokens[name]]))};
        return {cast:{},tintCue:false,bust:null,...own,marks:{...own?.marks,...borrowed.marks},tokens,buttons:borrowed.buttons,decor:borrowed.decor,timerHide:borrowed.timerHide,controls:{from:borrowed.id,declared:borrowed.declared}};
    },[appearance,builtin,source,borrowed]);
    // the CONFIG surface's images, decoded from the same bundle.
    const configArt = React.useMemo(() => !builtin && appearance?.config && source?.url && typeof getStageBundleFiles === 'function'
        ? stageSkinConfigArt(appearance,getStageBundleFiles(source.url),source.entry || '') : null,[appearance,builtin,source]);
    const revision = React.useSyncExternalStore(tavernFonts.subscribe,tavernFonts.getSnapshot);
    // the skin's own faces load from its bundle; resolving to them waits for the load.
    const faces = React.useMemo(() => !builtin && appearance?.font?.faces && source?.url && typeof getStageBundleFiles === 'function'
        ? stageSkinFontFaces(appearance,getStageBundleFiles(source.url),source.entry || '') : [],[appearance,builtin,source]);
    React.useEffect(() => {
        // FontFace construction for a bundled CJK face can block a frame; the existing swap fallback is readable first.
        if (deferFonts) return;
        let live = true;
        for (const face of faces) {
            const provide = face.load ? Promise.resolve().then(() => face.load()).then(blob => {if (live) return tavernFonts.provide(face.id,{...face,blob});}) : tavernFonts.provide(face.id,face);
            provide.catch(error => {if (live) console.warn('Stage skin font rejected',error);});
        }
        return () => {live = false;};
    },[faces,deferFonts]);
    // a re-applied skin replaces its tokens in one step. React runs
    // every layout-effect cleanup of a commit before any new layout effect, so restoring in the cleanup left the root without
    // skin tokens while the text box measured its cards (classic size and line count: a whole line on one card) and started the
    // box's frame transition from the classic geometry; the next frame painted that card overflowing the skin's box.
    const applied = React.useRef(null);
    React.useLayoutEffect(() => () => { if (!applied.current) return; applied.current(); applied.current = null; rootRef.current?.dispatchEvent(new Event('stage-layout')); }, []);
    React.useLayoutEffect(() => {
        const root = rootRef.current, restored = Boolean(applied.current);
        applied.current?.(); applied.current = null;
        if (!root || !appearance) { if (restored) root?.dispatchEvent(new Event('stage-layout')); return; }
        let restore;
        try {
            // A pack skin's font declaration on the root: fonts.js resolves --gal-ui-font / --gal-film-font from it
            // and the CONFIG pickers read it as the current skin. Built-ins carry none: fonts.js
            // reads the client's own BUILTIN_STAGE_SKINS by data-theme (as before, independent of the host's copy).
            const attributes=[['data-fk-fonts',builtin ? null : JSON.stringify(appearance.font || {})],['data-fk-fonts-lead',lead && !builtin ? 'skin' : null]].map(([name,value]) => {
                const old=root.getAttribute(name);
                if (value === null) root.removeAttribute(name); else root.setAttribute(name,value);
                return [name,old];
            });
            if (builtin || film) {
                const tokens=stageSkinPanelTokens(appearance,tavernFonts,theme,builtin,lead), previous=new Map();
                for (const [key,value] of Object.entries(tokens)) {previous.set(key,root.style.getPropertyValue(key));root.style.setProperty(key,value);}
                restore=()=>{for(const [key,value] of previous) {if(value)root.style.setProperty(key,value);else root.style.removeProperty(key);}};
            } else restore = applyStageSkin(root,appearance,tavernFonts,theme,lead,art,configArt);
            const undo=restore;
            restore=()=>{undo();for (const [name,old] of attributes) {if (old === null) root.removeAttribute(name); else root.setAttribute(name,old);}};
            // Only the faces this view uses; film/reading register through fonts.js when they are shown.
            if (!builtin) for (const part of [undefined,'name','ui']) {const id=tavernFonts.resolve('stage',{theme,skin:appearance.font || {},part,skinWins:lead}).id;if (id) tavernFonts.ensure(id).catch(() => {});}
            if (appearance.ui?.titleFont) tavernFonts.ensure(appearance.ui.titleFont).catch(() => {});
        } catch (error) { console.warn('Stage skin rejected',error); }
        applied.current = restore || null;
        root.dispatchEvent(new Event('stage-layout'));
    },[appearance,builtin,film,theme,revision,lead,art,configArt]);
    // the skin's effects table, its thinking image decoded from the same bundle.
    const effects = React.useMemo(() => !builtin && appearance?.effects ? stageSkinEffects(appearance,source?.url && typeof getStageBundleFiles === 'function' ? getStageBundleFiles(source.url) : null,source?.entry || '') : null,[appearance,builtin,source]);
    const icons = React.useMemo(() => borrowed?.icons || (!builtin && appearance?.quickMenu?.icons && source?.url && typeof getStageBundleFiles === 'function'
        ? stageSkinControlIcons(appearance,getStageBundleFiles(source.url),source.entry || '') : null),[appearance,builtin,source,borrowed]);
    // §18 E5: the skin's sound palette, from the same bundle (forkUiSfx.useSkin, set by the stage while the skin shows).
    const sfx = React.useMemo(() => !builtin && appearance?.sfx && source?.url && typeof getStageBundleFiles === 'function' ? stageSkinSfx(appearance,getStageBundleFiles(source.url),source.entry || '') : null,[appearance,builtin,source]);
    const active = React.useMemo(() => art || effects || icons || sfx ? {...appearance,...(art ? {resolvedArt:art} : {}),...(effects ? {resolvedEffects:effects} : {}),...(icons ? {resolvedControlIcons:icons} : {}),...(sfx ? {resolvedSfx:sfx} : {})} : appearance,[appearance,art,effects,icons,sfx]);
    // Film mode only takes the skin's chrome off the root (above); the caller still reads the skin's stage projection
    // (stageSkinFigures: figure slots, cap, framing, listener dim) in every display mode.
    return builtin ? null : active;
}

function skinTxLeaveMs(...args) { return stageViews.transitions.leaveMs(...args); }
// Transitional call sites; the optional stage package owns all transition work.
function useSkinLeave(...args) { return stageViews.transitions.useLeave(...args); }
function useSkinSweep(...args) { return stageViews.transitions.useSweep(...args); }
function useSkinParts(...args) { return stageViews.transitions.useParts(...args); }
function SkinSweep(props) { return stageViews ? React.createElement(stageViews.transitions.Sweep, props) : null; }
