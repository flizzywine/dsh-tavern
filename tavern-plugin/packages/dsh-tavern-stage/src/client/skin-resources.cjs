function createStageSkinResources({React,getSession,getResourceOwner,setTimeout,clearTimeout}) {
let disposed=false;const cleanups=new Set();
function own(cleanup) {
    let active=true;
    const release=()=>{if(!active)return;active=false;cleanups.delete(release);cleanup();};
    if(disposed)release();else cleanups.add(release);
    return release;
}
// the card's skin as the stage config resolves it (card-stage.js:
// document, ref and the bundle's resource descriptor) draws at once - CONFIG 本卡皮肤 needs no new projection. A pack skin's bundle
// is acquired from the shared resource owner under the stage authority (the projection's own pin then shares the entry, same
// identity). Until the new bundle is decoded the stage keeps drawing the skin it shows, with that skin's default key, so a
// switch never flashes an unskinned stage or moves the drawn buttons' actions into the Esc menu. A failed read of a new
// bundle draws the document alone (no art) until a retry reads it; of the bundle already shown (a pack revision moved), it keeps that art. -> { skin, defaultKey }.
function useStageConfigSkin(sessionId, skin, defaultKey) {
    const descriptor = !skin?.builtin && !skin?.url && skin?.resource?.kind === 'bundle' ? skin.resource : null;
    const session = descriptor ? getSession(sessionId) : null;
    const authority = React.useSyncExternalStore(React.useCallback(listener => disposed || !session ? () => {} : own(session.subscribe(listener)),[session]), () => {
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
        const owner = getResourceOwner();
        if (disposed || !key || !owner) return undefined;
        let live = true, timer = null;
        owner.acquire(descriptor,authority).then(pin => {
            if (!live || disposed) { pin.release(); return; }
            pins.current.held?.release(); pins.current.held = pins.current.current; pins.current.current = pin;
            setReady({key,skin:{...skin,url:pin.handle.url},defaultKey});
        }, error => {
            if (!live || disposed) return;
            console.warn('Stage skin bundle unavailable',error);
            // The same bundle content already on screen (only the pack revision moved) keeps its art.
            const held = pins.current.current;
            setReady(held?.handle.identity === descriptor.identity ? {key,skin:{...skin,url:held.handle.url},defaultKey} : {key,skin,defaultKey});
            timer = setTimeout(() => {if(live && !disposed)setAttempt({key,n:tries + 1});}, Math.min(30000, 1000 * 2 ** tries));
        });
        return own(() => { live = false; clearTimeout(timer); });
    },[key,tries]);
    React.useEffect(() => own(() => {
        const held=pins.current.held,current=pins.current.current;
        pins.current={current:null,held:null};
        try {held?.release();} finally {current?.release();}
    }),[]);
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
// CONFIG 本卡皮肤 warms a pack skin's bundle while the player points at its option (hover, focus,
// press), under the authority useStageConfigSkin acquires it with. The released entry stays in the resource owner's warm
// cache, so the switch then waits for the card save only, not for the bundle's transfer and decode.
function stageSkinPrefetch(sessionId, resource) {
    if(disposed)return;
    const owner = getResourceOwner(), source = resource?.kind === 'bundle' ? getSession(sessionId)?.getSnapshot().source : null;
    if (!owner || !source) return;
    owner.acquire(resource,JSON.stringify([source.sessionId,source.authorityEpoch]),{prefetch:true}).then(pin => pin.release(),() => {});
}

return {useConfig:useStageConfigSkin,prefetch:stageSkinPrefetch,dispose(){
    if(disposed)return;disposed=true;const errors=[];
    for(const cleanup of [...cleanups].reverse())try{cleanup();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Stage skin resources cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSkinResources};
