// ephemeral reading UI, never a director state or a persisted preference.
const stageWidgetRefKey = ref => ref.modId==='dsh.phone' ? JSON.stringify([ref.modId,'source']) : JSON.stringify([ref.packId,ref.kind,ref.assetId]);
function stageWidgetPresentationState() { return {entries:new Map(), cursor:null, serial:0, liveVisit:false}; }
function reduceWidgetPresentation(previous, action) {
    const state = {...previous, entries:new Map([...previous.entries].map(([key,item]) => [key,{...item,seen:[...item.seen],pending:[...item.pending]}]))};
    if (action.type === 'content') {
        const cursor = action.cursor, oldCursor = state.cursor;
        const moved = oldCursor && (cursor.turn !== oldCursor.turn || cursor.page !== oldCursor.page);
        const forward = oldCursor && (cursor.turn > oldCursor.turn || cursor.turn === oldCursor.turn && cursor.page > oldCursor.page);
        const eligible = Boolean(oldCursor && action.live && !action.suspended && !action.restoring && cursor.generation === oldCursor.generation);
        const fresh = Boolean(forward && eligible);
        // A sealed source mark may arrive after navigation. Hydration/resume never starts a live visit.
        state.liveVisit = eligible && (fresh || !moved && state.liveVisit);
        const available = new Set(action.items.map(item => item.key));
        // what was seen is read up to the page on screen. A move back (a 履历 jump,
        // paging back) forgets the events seen after that page, so reading on from there notifies them again (the phone's
        // incoming tone); a seen row keeps the page it was seen on, since a widget's own event position may lie elsewhere.
        const after = row => row.turn > cursor.turn || row.turn === cursor.turn && row.page > cursor.page;
        for (const [key,item] of state.entries) {
            if (moved && !forward) item.seen = item.seen.filter(row => !after(row));
            if (!available.has(key)) { item.active=false; item.pending=[]; item.changed=null; item.fingerprint=null; item.pinned=false; if(item.requestedState==='open')item.requestedState='compact'; }
            // a held source (the phone through its run of lines) stays open across narration.
            if (moved && item.requestedState === 'open' && !item.pinned && !(oldCursor.currentRef === key && cursor.currentRef === key) && cursor.holdRef !== key) item.requestedState='compact';
            if (oldCursor && (oldCursor.turn !== cursor.turn || oldCursor.generation !== cursor.generation)) item.pending=[];
            if (oldCursor && oldCursor.generation !== cursor.generation) { item.seen=[]; item.changed=null; item.fingerprint=null; }
        }
        for (const value of action.items) {
            let item = state.entries.get(value.key);
            if (!item) item={requestedState:'compact',pinned:false,pending:[],changed:null,seen:[],fingerprint:null,active:false};
            const wasActive=item.active;
            item.active=true; item.used=++state.serial;
            const event=value.event, unseen=event && !item.seen.some(row => row.token === event.token);
            if (unseen) {
                item.seen.push({token:event.token,turn:cursor.turn,page:cursor.page}); item.seen=item.seen.slice(-64);
                const stateFresh=fresh || wasActive && oldCursor && action.live && !action.suspended && !action.restoring && cursor.generation===oldCursor.generation && event.para===cursor.para;
                if (value.notifications === 'changes') {
                    if (state.liveVisit && event.para === cursor.para && value.source && event.side === 'in') item.pending.push({token:event.token,turn:cursor.turn,para:event.para});
                    else if (stateFresh && !value.source && !value.performance && (!wasActive || item.fingerprint !== value.fingerprint)) item.changed=event.token;
                }
            }
            item.pending=item.pending.filter((event,i,all) => all.findIndex(other => other.token === event.token) === i).slice(-40);
            if (!value.source) item.fingerprint=value.fingerprint;
            state.entries.set(value.key,item);
        }
        while (state.entries.size > 64) {
            const oldest=[...state.entries].filter(([,item]) => !item.active).sort((a,b) => a[1].used-b[1].used)[0];
            if (!oldest) break;
            state.entries.delete(oldest[0]);
        }
        state.cursor=cursor;
    } else {
        const item=state.entries.get(action.key);
        if (!item?.active) return previous;
        if (action.type === 'open') {
            for (const [key,other] of state.entries) if (key !== action.key && other.requestedState === 'open') {other.requestedState='compact';other.pinned=false;}
            item.requestedState='open';
        } else if (action.type === 'collapse' || action.type === 'hide') {item.requestedState=action.type === 'hide' ? 'hidden' : 'compact';item.pinned=false;}
        else if (action.type === 'pin' && item.requestedState === 'open') item.pinned=!item.pinned;
        else if (action.type === 'presented' && action.ready && !action.suspended && action.effectiveState === 'open') {
            const revealed=new Set(action.tokens || []);
            item.pending=item.pending.filter(event => !revealed.has(event.token));
            if (item.changed && action.version === item.changed) item.changed=null;
        }
    }
    return state;
}
function stageWidgetAttention(item, cursor) {
    return {count:Math.min(100,item.pending.filter(event => event.turn === cursor.turn && event.para <= cursor.para).length),changed:Boolean(item.changed)};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={stageWidgetRefKey,stageWidgetPresentationState,reduceWidgetPresentation,stageWidgetAttention};
