// Stage widget placement, reading projection, phone settings and avatar preparation.
function createStageSourceWidgets({React:react,window,document,views,sessions,storage:localStorage,foreground:forkForeground,rpc:hostRpc,signals:tavernSessionSignals,characters,avatarCache,phoneProtocol,figureResolution,sandbox,playerErrorText,fetch,createImageBitmap}) {
const {Image,FileReader,ResizeObserver,CustomEvent,crypto,performance,Blob,AbortController}=window;
const {character:bubbleCharacter,mood:bubbleMood,moods:bubbleMoodList,actor:stageActorCharacter}=characters || {};
const phoneModPrefs=views.phoneLayout.prefs,phoneModSizeMin=views.phoneLayout.min,phoneModRun=phoneProtocol?.run;
const matchMedia=(...args)=>window.matchMedia(...args),getComputedStyle=(...args)=>window.getComputedStyle(...args);
// Viewport reads must stay live across resize, not be captured at activation.
let closed=false;const owned=new Set(),timers=new Map(),frames=new Map(),idles=new Map();
const abort=()=>Object.assign(new Error('Stage widgets disposed'),{name:'AbortError'});
function invoke(call,method,args,id){if(closed&&!['invalidateWidgetVariables','widgetVariableStatus'].includes(method))return Promise.reject(abort());return call(method,args,id);}
const rpc=(method,args,id)=>invoke(hostRpc,method,args,id);
function clean(actions){const errors=[];for(const action of actions)try{action();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage widget cleanup failed');}
function scope(start){let active=true;const actions=[];const release=()=>{if(!active)return;active=false;owned.delete(release);clean(actions.reverse());};try{start(action=>actions.push(action));owned.add(release);return release;}catch(error){try{release();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage widget setup failed');}throw error;}}
function effect(hook,start,deps){hook(()=>{if(closed)return;return scope(register=>{const cleanup=start(register);if(typeof cleanup==='function')register(cleanup);});},deps);}
const React={...react,useEffect:(start,deps)=>effect(react.useEffect,start,deps),useLayoutEffect:(start,deps)=>effect(react.useLayoutEffect,start,deps),
useSyncExternalStore:(subscribe,get,...rest)=>react.useSyncExternalStore(react.useCallback(listener=>closed?()=>{}:scope(register=>register(subscribe(listener))),[subscribe]),get,...rest)};
function schedule(map,add,remove,fn,args){if(closed)return null;const id=add((...values)=>{map.delete(id);if(!closed)fn(...values);},...args);map.set(id,()=>remove(id));return id;}
const setTimeout=(fn,...args)=>schedule(timers,window.setTimeout.bind(window),window.clearTimeout.bind(window),fn,args);
const clearTimeout=id=>{timers.delete(id);window.clearTimeout(id);};
const requestAnimationFrame=fn=>schedule(frames,window.requestAnimationFrame.bind(window),window.cancelAnimationFrame.bind(window),fn,[]);
const requestIdleCallback=window.requestIdleCallback ? (fn,...args)=>schedule(idles,window.requestIdleCallback.bind(window),window.cancelIdleCallback.bind(window),fn,args) : undefined;
const cancelIdleCallback=id=>{idles.delete(id);window.cancelIdleCallback?.(id);};
// shared placement for the production widget presentation owner.
function stageWidgetSourcePlace({ width, height, size, figures = [], blocked = [], previous, anchor='center-card' }) {
    const w = size.width, h = size.height, padding = 16;
    const valid = r => r && !r.hidden && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
    const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2 });
    const obstacles = [...blocked.filter(valid).map(r => inflate(r, 12)), ...figures.flatMap(f => [valid(f.body) && inflate(f.body, 18), valid(f.head) && inflate(f.head, 24)]).filter(Boolean)];
    const safe = r => r.x >= padding && r.y >= padding && r.x + w <= width - padding + 1e-7 && r.y + h <= height - padding + 1e-7
        && !obstacles.some(b => r.x < b.x + b.width - 1e-7 && r.x + w > b.x + 1e-7 && r.y < b.y + b.height - 1e-7 && r.y + h > b.y + 1e-7);
    const box = (x, y) => ({ x, y, width: w, height: h });
    if (previous && previous.width === w && previous.height === h && safe(previous)) return box(previous.x, previous.y);
    const cx = (width - w) / 2, cy = (height - h) / 2, xs = new Set([cx, padding, width - w - padding]), ys = new Set([cy, padding, height - h - padding]);
    for (const r of obstacles) { xs.add(r.x - w); xs.add(r.x + r.width); ys.add(r.y - h); ys.add(r.y + r.height); }
    const candidates = [];
    for (const x of xs) for (const y of ys) { const r = box(x, y); if (safe(r)) candidates.push(r); }
    const target=anchor==='corner-left' ? [padding,height-h-padding] : anchor==='corner-right' ? [width-w-padding,height-h-padding] : anchor==='top-center' ? [cx,padding] : [cx,cy];
    candidates.sort((a, b) => ((a.x - target[0]) ** 2 + (a.y - target[1]) ** 2) - ((b.x - target[0]) ** 2 + (b.y - target[1]) ** 2) || a.y-b.y || a.x-b.x);
    return candidates[0] || null;
}
function stageWidgetAvatarSquare(width,height,crop={x:0,y:0,w:1,h:1}) {
    const w=crop.w*width,h=crop.h*height,side=Math.min(w,h);
    return {x:crop.x*width+(w-side)/2,y:crop.y*height+(h-side)*.15,width:side,height:side};
}
// the bounded thumbnail set handed to a source widget. Every listed
// person's face comes first (one per figure, so a long contact list never runs out after eight people); per-message mood
// variants only fill a small extra allowance, and a bubble without its own variant shows the sender's face instead.
// inputs: [[id, encodedUrl|null, kind:'person'|'message']] -> {urls, rows:{id:'a<n>'}} (ids without a thumbnail are absent).
const STAGE_WIDGET_AVATAR_PEOPLE=24,STAGE_WIDGET_AVATAR_VARIANTS=8;
function stageWidgetAvatarBudget(inputs) {
    const urls=[],rows={};
    const take=(kind,limit)=>{let added=0;for (const [id,url,type] of inputs) {
        if (type!==kind || !url) continue;
        let index=urls.indexOf(url);
        if (index<0 && added<limit) {index=urls.push(url)-1;added++;}
        if (index>=0) rows[id]='a'+index;
    }};
    take('person',STAGE_WIDGET_AVATAR_PEOPLE);take('message',STAGE_WIDGET_AVATAR_VARIANTS);
    return {urls,rows};
}
// the device pixels of the faces handed to the phone, from
// the phone's width on the stage (stage units: a docked stage is only scaled down, so this never asks for less than is shown)
// and the screen's pixel ratio. One iOS point of the phone is its width / 393 (style.css --pt, on the stage and on the sheet);
// a person's face is drawn for the largest place it appears, her 200 pt contact-card photo (the call's 132 / 55 pt photo and every list face are smaller); a message's own mood face is at most the 32 px
// bubble / banner face of the 280 px design, zoomed with the phone. Rounded up to 32 px so a small resize redraws nothing.
const PHONE_FACE_PT=200,PHONE_POINTS=393,PHONE_DESIGN_WIDTH=280,PHONE_MESSAGE_FACE=32;
function stageWidgetFacePx(width,dpr) {
    const device=css=>Math.ceil(css*dpr/32)*32;
    return {person:device(PHONE_FACE_PT*width/PHONE_POINTS),message:device(PHONE_MESSAGE_FACE*width/PHONE_DESIGN_WIDTH)};
}

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

// a bounded projection of canonical text + accepted marks, not a message store.
function stageWidgetTextPrefix(text, limit) {
    let bytes=0, result='';
    for (const char of text) {const size=new TextEncoder().encode(char).length;if (bytes+size>limit) break;bytes+=size;result+=char;}
    return result;
}
function sourceMark(op,ref) {
    if(ref.modId==='dsh.phone')return op.op==='mod.command' && op.modId==='dsh.phone' && op.commandId==='mark' ? op.params : null;
    return op.op==='widget.source' && op.ref.packId===ref.packId && op.ref.kind===ref.kind && op.ref.assetId===ref.assetId ? op : null;
}
const PHONE_PLAYER='$player';
// the shared protocol helpers (included once by the client
// build, required in Node) give a direct mark its sender, recipient and stable thread id and project owner phones.
const phoneModProtocol=()=>phoneProtocol;
// A group mark names {thread, sender}; a direct mark names its sender as contact (in) or the player (out), plus an optional
// NPC recipient `to`. The player's own persona named as a contact (never listed) keeps playing where it always did.
function phoneModRoute(mark,playerId) {
    if (mark.thread) return {threadId:mark.thread,sender:mark.sender===playerId ? PHONE_PLAYER : mark.sender,recipient:null};
    const direct=phoneModProtocol().phoneModDirect(mark,playerId);
    if (direct.sender===direct.recipient) return {threadId:mark.contact,sender:mark.side==='in' ? mark.contact : PHONE_PLAYER,recipient:mark.side==='in' ? PHONE_PLAYER : mark.contact};
    return {threadId:direct.threadId,sender:direct.sender,recipient:direct.recipient};
}
// Browser-local read marks are per phone: the player's phone keeps the plain thread ids it always used, other phones
// key [phoneId, threadId] (the same conversation reads in opposite directions on its two phones).
const phoneModReadKey=(phoneId,threadId)=>phoneId===PHONE_PLAYER ? threadId : JSON.stringify([phoneId,threadId]);
const phoneModReadOwner=key=>{if (!key.startsWith('[')) return PHONE_PLAYER;try {return JSON.parse(key)[0];} catch (_) {return PHONE_PLAYER;}};
// Sealed `group` definitions at or before the reading cursor, plus the group state the record started from.
function phoneModGroups(rows,cursor) {
    const groups=new Map();
    for (const row of [...rows].filter(row=>row.turn<=cursor.turn).sort((a,b)=>a.turn-b.turn)) {
        const record=row.record;if (!record?.token?.bindingKey) continue;
        for (const value of Object.values(record.baseline?.modState?.['dsh.phone']?.threads || {})) if (value?.id) groups.set(value.id,value);
        for (const entry of record.entries || []) {
            if (entry.at>record.through || row.turn===cursor.turn && entry.at>cursor.para) continue;
            for (const op of entry.ops || []) if (op.op==='mod.command' && op.modId==='dsh.phone' && op.commandId==='group' && op.params?.thread) groups.set(op.params.thread,{id:op.params.thread,name:op.params.name,participants:op.params.participants});
        }
    }
    return groups;
}
// A message's place in the story, comparable across refreshes: [turn, paragraph].
const phoneModOrder=message=>[Number(message.turn) || 0,Number(message.para) || 0];
// The phone a phone line is read on ({threadId, sender, recipient}, phoneModRoute): an NPC→NPC message on its recipient's
// phone (`hint`: the shared recipient hint for the latest line), a player conversation on the player's, a group on the first
// of `prefer` (then the player's) that holds it, else any phone that does. phones: [{id, threads:[{id}]}].
function phoneModOfLine(message,phones,prefer=[],hint=null) {
    const holds=id=>phones.some(row=>row.id===id && row.threads.some(item=>item.id===message.threadId));
    if (message.recipient && message.sender!==PHONE_PLAYER && message.recipient!==PHONE_PLAYER)
        return hint && hint!==PHONE_PLAYER ? hint : phones.some(row=>row.id===message.recipient) ? message.recipient : PHONE_PLAYER;
    if (message.recipient!==null) return PHONE_PLAYER;
    return [...prefer,PHONE_PLAYER].find(id=>id && holds(id)) || phones.find(row=>holds(row.id))?.id || PHONE_PLAYER;
}
const phoneModAfter=(order,mark)=>Array.isArray(mark) && (order[0]-(Number(mark[0]) || 0) || order[1]-(Number(mark[1]) || 0))>0;
function stageWidgetThread({rows, ref, cursor, characters=[], visibleText='', revealed=false, unavailable=false, limited=false, selected=null, directory=null, reads=null, limits=null, phoneView=null}) {
    const key=value=>value.modId ? JSON.stringify([value.modId,value.packId,value.kind,value.entryId]) : JSON.stringify([value.packId,value.kind,value.assetId]);
    const phone=ref.modId==='dsh.phone';
    // The phone reads every turn the stage has loaded for it (it loads earlier turns as the reader scrolls up); other source
    // widgets keep their 20-turn window.
    const wanted=key(ref), turns=[...rows].filter(row=>row.turn<=cursor.turn).sort((a,b)=>b.turn-a.turn).slice(0,phone ? rows.length : 20), playerId=phone && directory?.playerId || null;
    const candidates=[];
    for (const row of turns) {
        const record=row.record;
        if (!row.sourceKey || !record?.token?.bindingKey || !['partial','done'].includes(record.phase)) continue;
        const pages=row.turn === cursor.turn ? row.pages.slice(0,cursor.page+1) : row.pages;
        const marks=new Map(record.entries.filter(entry=>entry.at<=record.through).flatMap(entry=>entry.ops.flatMap(op=>{const mark=sourceMark(op,ref);return mark?[[entry.at,mark]]:[]})));
        const messages=new Map();
        for (const [i,line] of pages.entries()) {
            const para=line.para || line.anchor?.para, mark=marks.get(para);
            if (!mark || !(line.kind === 'line' || phone && line.kind === 'narration')) continue;
            const current=row.turn === cursor.turn && i === cursor.page;
            const text=current ? visibleText : line.text;
            const id=JSON.stringify([row.sourceKey,record.token.generation,row.turn,para]);
            const message=messages.get(para) || {id,turn:row.turn,para,alias:line.alias,name:line.name || '',contact:mark.contact,side:mark.side,
                ...(phone?{form:mark.form || 'text',...phoneModRoute(mark,playerId)}:{}),text:'',revealed:true};
            // Page offsets include the original whitespace; do not duplicate a paragraph at page boundaries.
            const offset=line.anchor?.offset ?? message.text.length;
            message.text=message.text.slice(0,offset)+text;
            message.revealed=current ? revealed && !row.pages.slice(cursor.page+1).some(next=>(next.para || next.anchor?.para)===para) : true;
            messages.set(para,message);
        }
        candidates.push(...[...messages.values()].reverse());
    }
    const currentCandidate=candidates.find(message=>message.turn===cursor.turn && message.para===cursor.para);
    if (!phone) {
        const contact=candidates[0]?.contact;
        return stageWidgetThreadBody({candidates:candidates.filter(message=>message.contact===contact),threadKey:contact ? JSON.stringify([wanted,contact]) : '',cursor,unavailable,limited});
    }
    // ---- phone: every conversation (direct + group), one of them shown ----------------------------------------------
    const resolver=figureResolution;
    const peers=[...characters,...turns.flatMap(row=>row.pages.filter(line=>line.kind==='line' && line.name))].map(row=>({...row,actorKey:row.alias}));
    const nameOf=id=>{
        if (id===PHONE_PLAYER) return '你';
        const known=directory?.contacts?.find(row=>row.id===id);if (known?.name) return known.name;
        const resolved=resolver.resolveFigureName(peers,id || '');
        return resolved.status==='resolved' && resolved.row.name?.trim() ? resolved.row.name : '未知联系人';
    };
    const groups=phoneModGroups(rows,cursor);
    const threads=new Map();
    const thread=message=>{
        const id=message.threadId;
        if (!threads.has(id)) {
            const listed=directory?.threads?.find(row=>row.id===id),group=groups.get(id);
            const groupKind=message.contact===undefined || listed?.kind==='group' || Boolean(group);
            // A direct conversation is its two people (sorted, as the shared helper orders them); a group its members.
            const participants=groupKind ? listed?.participants?.map(row=>({id:row.id,name:row.name || nameOf(row.id)})) || (group?.participants?.length ? group.participants : [PHONE_PLAYER]).map(person=>({id:person,name:nameOf(person)}))
                : [message.sender,message.recipient].sort().map(person=>({id:person,name:nameOf(person)}));
            threads.set(id,{id,kind:groupKind?'group':'direct',name:groupKind ? listed?.name || group?.name || '群聊' : nameOf(id),participants,messages:[],typing:null,unread:0,activity:-1});
        }
        return threads.get(id);
    };
    // only conversations that have messages are listed — never every chat
    // figure as an empty contact, and never the player's own persona figure (directory.playerId). The directory and the
    // sealed group definitions still supply names and members.
    for (const message of candidates) thread(message);
    const all=candidates;
    for (const message of all) {const row=threads.get(message.threadId);if (row && row.activity<0) {row.activity=all.length-all.indexOf(message);row.latest=phoneModOrder(message);row.messages=[{...message,text:stageWidgetTextPrefix(message.text,240)}];}}
    if (currentCandidate && currentCandidate.revealed===false) threads.get(currentCandidate.threadId).typing={sender:currentCandidate.sender,name:currentCandidate.name || nameOf(currentCandidate.sender),side:currentCandidate.side,messageId:currentCandidate.id};
    // Cursor-bounded threads (most recent first) → owner phones: the player's phone first, bubbles relative to the phone's
    // owner. The player's phone is always there (it is the reader's own); another person's phone is offered once it holds a
    // conversation the player is not in (an NPC→NPC thread or a group without the player) — a phone that only mirrors
    // the player's own conversations adds nothing to switch to.
    const protocol=phoneModProtocol();
    const listed=[...threads.values()].filter(row=>row.id!==playerId).sort((a,b)=>b.activity-a.activity).slice(0,64).map(({activity,...row})=>row);
    const owned=protocol.phoneModOwnership(listed,all[0] || null,playerId);
    const phones=owned.phones.filter(row=>row.id===PHONE_PLAYER || row.threads.some(item=>!item.participants.some(person=>person.id===PHONE_PLAYER))).slice(0,16);
    if (!phones.some(row=>row.id===PHONE_PLAYER)) phones.unshift({id:PHONE_PLAYER,name:'你',threads:[]});
    const phoneOf=id=>phones.find(row=>row.id===id) || null;
    // The phone a new line belongs to: an NPC→NPC message is read on its recipient's phone (the shared recipient hint), a
    // player conversation on the player's, a group on the phone already in hand when it is a member.
    const livePhone=currentCandidate ? phoneModOfLine(currentCandidate,phones,[phoneView?.choice?.id,phoneView?.follow],all[0]?.id===currentCandidate.id ? owned.latestRecipientPhoneId : null) : null;
    // The reader's phone choice holds until the story brings a new phone line in; without one the phone stays on the one
    // the last line took it to (within a run of phone lines), else the reader's own.
    const choice=phoneView?.choice;
    const chosenPhone=choice?.id && phoneOf(choice.id) && (!currentCandidate || currentCandidate.id===choice.after) ? choice.id : null;
    const phoneId=chosenPhone || livePhone || (phoneView?.follow && phoneOf(phoneView.follow) ? phoneView.follow : PHONE_PLAYER);
    const shownPhone=phoneOf(phoneId);
    const inPhone=threadId=>shownPhone.threads.some(row=>row.id===threadId);
    const carriesLine=Boolean(currentCandidate && (phoneId===livePhone || inPhone(currentCandidate.threadId)));
    const live=carriesLine ? currentCandidate.threadId : shownPhone.threads[0]?.id || '';
    // The reader's thread choice is per phone and, too, holds until a new phone line.
    const threadChoice=phoneView ? phoneView.threads?.[phoneId] : selected;
    const chosen=threadChoice?.id && inPhone(threadChoice.id) && (!currentCandidate || currentCandidate.id===threadChoice.after) ? threadChoice.id : null;
    const shown=chosen || live;
    // Unread: messages from others after this phone's persisted last-read place of that conversation; a phone with no read
    // marks yet has its first look still to come (it takes what is there as read).
    const own=id=>id===playerId ? PHONE_PLAYER : id;
    const looked=new Set(Object.keys(reads || {}).map(phoneModReadOwner));
    for (const row of phones) {
        let total=0;
        for (const item of row.threads) {
            const mark=reads?.[phoneModReadKey(row.id,item.id)];
            item.unread=looked.has(row.id) ? all.filter(message=>message.threadId===item.id && own(message.sender)!==row.id && message.revealed!==false && (!mark || phoneModAfter(phoneModOrder(message),mark))).length : 0;
            total+=item.unread;
        }
        row.unread=total;
    }
    const threadKey=shown ? JSON.stringify(phoneId===PHONE_PLAYER ? [wanted,shown] : [wanted,shown,phoneId]) : '';
    const body=stageWidgetThreadBody({candidates:all.filter(message=>message.threadId===shown),threadKey,cursor,unavailable,limited,current:currentCandidate,limit:limits?.[shown] || 80,phone:true});
    const shownThread=shown ? shownPhone.threads.find(row=>row.id===shown) || null : null;
    // The shown history is projected through the same owner helper, so its bubbles face this phone's owner.
    if (shownThread) body.messages=protocol.phoneModOwnership([{...shownThread,messages:body.messages,typing:null}],null,playerId).phones.find(row=>row.id===phoneId)?.threads[0]?.messages || body.messages;
    const playerName=(playerId && nameOf(playerId)!=='未知联系人' ? nameOf(playerId) : '') || all.find(message=>message.sender===PHONE_PLAYER && message.name)?.name || '';
    const contactName=(shownThread || (shown ? threads.get(shown) : null))?.name || '未知联系人';
    // Only the shown phone's threads carry previews and members; the other phones list their conversations' names and
    // unread counts, which bounds what reaches the view.
    return {...body,loadedTurns:turns.length,threadId:shown,liveThreadId:carriesLine || !currentCandidate ? live : '',threads:shownPhone.threads.map(row=>({...row,participants:row.participants.slice(0,16)})),
        phoneId,livePhoneId:livePhone,latestRecipientPhoneId:owned.latestRecipientPhoneId,playerName,contactName,
        phones:phones.map(row=>({id:row.id,name:row.name,unread:row.unread,threads:row.threads.map(item=>({id:item.id,kind:item.kind,name:item.name,unread:item.unread,...(item.latest?{latest:item.latest}:{})}))}))};
}
// The phone asks for earlier messages as the reader scrolls up: 80 more at a time, the byte budget growing with it, and
// once the loaded turns hold no more, the stage reads earlier turns (the whole conversation, as a real
// messaging app; the phone never points to 履历 or warns about what it has not loaded yet).
function stageWidgetThreadBody({candidates,threadKey,cursor,unavailable,limited,current:live=null,limit=80,phone=false}) {
    const count=phone ? Math.max(80,Number(limit) || 80) : 80,budget=count*65536/80;
    // Reserve the bounded thread/cursor metadata as well as JSON array separators.
    let bytes=new TextEncoder().encode(threadKey).length+512,hasEarlier=false;
    const messages=[];
    for (const candidate of candidates) {
        const message={...candidate};
        // The phone shows a long message in full; only text beyond 16 KiB (8 KiB in other widgets) is cut.
        const text=stageWidgetTextPrefix(message.text,phone ? 16384 : 8192);
        if (text!==message.text) {message.text=text;message.truncated=true;}
        const size=new TextEncoder().encode(JSON.stringify(message)).length+65; // Reserve a bounded host voice handle.
        if (messages.length>=count || bytes+size>budget) {hasEarlier=true;break;}
        bytes+=size;messages.push(message);
    }
    messages.reverse();
    const current=live || messages.findLast(message=>message.turn===cursor.turn && message.para===cursor.para);
    return {messages,threadKey,current:current ? {id:current.id,turn:current.turn,para:current.para,revealed:current.revealed,...(current.threadId?{threadId:current.threadId}:{})} : null,
        ...(phone ? {historyStatus:'ready',hasEarlier:hasEarlier || Boolean(limited),windowed:hasEarlier}
            : {historyStatus:unavailable ? 'unavailable' : limited || hasEarlier ? 'limited' : 'ready',hasEarlier})};
}

// Card figure faces for stage widgets and the live room (see useCardFaces).
const cardFaceJobs=new Set(),cardFaceNoSubscribe=()=>()=>{};
// the faces of card figures named by alias or name — the
// identity resolver's card figure (config.characters[] holds every enabled figure of the card's and the global packs;
// its avatarMedia.default is the face the transcript shows), prepared in the session avatar cache whether or not the
// figure is on stage (the stage only hands over its visible cast's faces). Shared by the phone's contacts and the live
// room's host bar. Returns Map name → ready face URL (cropped thumbnail); a name with no figure or no face is absent.
// px: the face's CSS size when it must be sharp at that size (the live-room bar asks 96 so a 1.5× screen gets 144 px);
// without it any prepared size of the face will do. A smaller one already prepared shows until the sharp one is ready.
function useCardFaces({config,sessionId,source,names,px}) {
    const faceCache=avatarCache;
    const cardFace=name=>{const descriptor=name ? bubbleCharacter(config,name)?.avatarMedia?.default : null;return descriptor ? {...descriptor,sessionId} : null;};
    const faces=React.useSyncExternalStore(faceCache?.subscribe || cardFaceNoSubscribe,()=>faceCache ? names.map(name=>{const face=cardFace(name);return face && (px && faceCache.get(face,px) || faceCache.ready(face)) || '';}).join('\n') : '');
    const urls=new Map(faces ? names.map((name,i)=>[name,faces.split('\n')[i]]).filter(([,url])=>url) : []);
    const missing=names.filter(name=>cardFace(name) && (!urls.has(name) || px && !faceCache.get(cardFace(name),px)));
    const missingKey=JSON.stringify([sessionId,source?.sessionId,source?.authorityEpoch,px,missing.map(name=>cardFace(name).identity)]);
    React.useEffect(()=>{
        const owner=sessions()?.resourceOwner;
        if (!faceCache || !owner || !source?.sessionId || !missing.length) return;
        const authority=JSON.stringify([source.sessionId,source.authorityEpoch]);
        for (const name of missing) {
            const face=cardFace(name),{sessionId:_session,...descriptor}=face,job=JSON.stringify([authority,face.identity,face.revision,face.crop,px]);
            if (cardFaceJobs.has(job)) continue;
            cardFaceJobs.add(job);
            // Widget faces are not the entry page's speakers: during a stage entry they lease once it is shown.
            const entering=!views.admission.shown.get() && !!document.querySelector('.fork-gal-stage');
            (entering ? views.admission.shown.settled().then(()=>{if(closed)throw abort();return owner.acquire(descriptor,authority);}) : Promise.resolve(owner.acquire(descriptor,authority))).then(async pin=>{try {if(!closed)await faceCache.prepare(face,pin.handle.url,px);} finally {pin.release();}}).catch(()=>{}).finally(()=>cardFaceJobs.delete(job));
        }
    },[missingKey]);
    return urls;
}

// Selected, host-authorized raster images only. No URL or file path comes from widget input.
const stageWidgetSettingImages = new Map();
const stageWidgetImageError = code => Object.assign(new Error(code),{code});
function stageWidgetRasterSize(bytes, mime) {
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), ascii=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
    if (mime==='image/png' && ascii(1,3)==='PNG') return [view.getUint32(16),view.getUint32(20)];
    if (mime==='image/jpeg' && bytes[0]===255 && bytes[1]===216) {
        for(let p=2;p+4<bytes.length;) {
            if(bytes[p++]!==255)break;while(bytes[p]===255)p++;
            const marker=bytes[p++],length=view.getUint16(p);
            if(length<2 || p+length>bytes.length)break;
            if([192,193,194].includes(marker))return [view.getUint16(p+5),view.getUint16(p+3)];
            p+=length;
        }
    }
    if (mime==='image/webp' && ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP') {
        const kind=ascii(12,4);
        if(kind==='VP8X')return [1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)];
        if(kind==='VP8L' && bytes[20]===47){const bits=view.getUint32(21,true);return [1+(bits&16383),1+((bits>>>14)&16383)];}
        if(kind==='VP8 ')return [view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
    }
    throw stageWidgetImageError('image-format');
}
async function stageWidgetRasterImage(asset,signal) {
    if (!['image/png','image/jpeg','image/webp'].includes(asset.mime)) throw stageWidgetImageError('image-format');
    if (asset.size>8388608) throw stageWidgetImageError('image-bytes');
    if (!/^\/api\/dsh-asset-library\/v2\/lease\//.test(asset.url)) throw stageWidgetImageError('asset-unavailable');
    const response=await fetch(asset.url,{signal});
    if(!response.ok)throw stageWidgetImageError('asset-unavailable');
    const reader=response.body.getReader(),chunks=[];let length=0;
    try { for (;;) { const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8388608 || length>asset.size)throw stageWidgetImageError('image-bytes');chunks.push(value); } }
    catch(error){await reader.cancel();throw error;}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const [width,height]=stageWidgetRasterSize(bytes,asset.mime);
    if(!width || !height || width>4096 || height>4096 || width*height>16000000)throw stageWidgetImageError('image-pixels');
    const bitmap=await createImageBitmap(new Blob([bytes],{type:asset.mime}));
    try {
        const ratio=Math.min(1,1536/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        for(const quality of [.85,.65,.45]) {const url=canvas.toDataURL('image/webp',quality);if(url.length<=1048576)return {kind:'image',url,identity:asset.identity};}
        throw stageWidgetImageError('image-projection');
    } finally {bitmap.close();}
}
function useWidgetSettingImages(items) {
    const [projection,setProjection]=React.useState({key:'',assets:{}});
    const selected=items.filter(item=>!item.presentation.suspended).map(item=>[item.identity,item.definition.settingAssets || {}]);
    // Renewed authorized leases do not discard an already decoded image of the same content.
    const key=JSON.stringify(selected.map(([identity,assets])=>[identity,Object.entries(assets).map(([field,asset])=>[field,asset?.identity || null])]));
    React.useEffect(()=>{
        let live=true;const held=[];
        const acquire=asset=>{
            if(!asset)return Promise.resolve({asset:null,status:'ready'});
            let entry=stageWidgetSettingImages.get(asset.identity);
            if(!entry){const controller=new AbortController();entry={refs:0,controller,promise:stageWidgetRasterImage(asset,controller.signal).then(asset=>({asset,status:'ready'})).catch(error=>({asset:null,status:['image-format','image-bytes','image-pixels','image-projection','asset-unavailable'].includes(error.code)?error.code:'image-decode'}))};stageWidgetSettingImages.set(asset.identity,entry);}
            entry.refs++;held.push([asset.identity,entry]);return entry.promise;
        };
        Promise.all(selected.map(async([identity,assets])=>[identity,Object.fromEntries(await Promise.all(Object.entries(assets).slice(0,4).map(async([field,asset])=>[field,await acquire(asset)])))])).then(rows=>{if(live)setProjection({key,assets:Object.fromEntries(rows)});});
        return()=>{live=false;for(const [hash,entry] of held)if(--entry.refs===0){entry.controller.abort();stageWidgetSettingImages.delete(hash);}};
    },[key]);
    for(const item of items){
        const results=projection.key===key ? projection.assets[item.identity] || {} : {};
        item.settingAssets={...item.definition.inlineSettingAssets,...Object.fromEntries(Object.entries(results).map(([field,result])=>[field,result.asset]))};
        item.settingsFeedback={...(item.settingsFeedback || item.definition.settingsFeedback)};
        for(const [field,asset] of Object.entries(item.definition.settingAssets || {}))if(asset){
            const status=item.presentation.suspended ? 'suspended' : results[field]?.status || 'loading';
            if(!item.settingAssets[field])item.settings[field]=null;
            item.settingsFeedback[field]={...item.settingsFeedback[field],value:item.settings[field],status};
        }
    }
}

// every phone customisation — colours,
// wallpaper, model, status bar, the message tone — is set in the phone's own Settings app (tavern-plugin/mods/phone/view). Each
// setting applies immediately to the selected scope (this card / every card's default); a card's value wins over the global
// one, which wins over the built-in default. Reset clears that scope's value. The store is the phone's two-layer mod config
// (全局 file + the card's private pack), the same one the right sidebar reads; contacts stay there.
// the phone's 照片 app is its one picture library — the `photos` setting of
// both layers (本卡 pictures, then 所有角色卡 pictures; each oldest first). The wallpaper is one of them (`wallpaper` {file} of
// the same layer; {} = the built-in wallpaper).
//
// usePhoneSettings({sessionId, call?}) → {view, request}
//   view: one frozen object per state (the sandbox posts it to the phone as `phone.config` when its identity changes):
//     {status: 'idle'|'loading'|'ready'|'error', error, fields: [{key, label, type, choices, min, max, auto}],
//      values: {[key]: {value, level: 'card'|'global'|'default', kind, card?, global?}}, autos: {[key]: colour},
//      photos: [{id, layer, file, name, url}] (url: a thumbnail), walls: [{id, layer, file, url, shown}] (each layer's
//      wallpaper picture), full: {[id]: url} (pictures opened in 照片, at most PHONE_FULL_KEEP)}
//   request(message) → Promise: the phone's `phone.settings` {op, key?, layer?, value?, choice?}:
//     load · save {key, layer, value: {fixed} | {auto: true}} · save {key: 'wallpaper', layer, choice: photo id | 'none'}
//     · clear {key, layer} · pick {layer} (a picture from this computer into 照片) · add {layer, value: {src, name?}} (a
//     picture another phone feature made, e.g. a FaceTime snapshot: a data: URL) · remove {choice: photo id} · open {choice}.
//   call(method, args) defaults to the host RPC; every write carries the last revision (CAS) and a conflict reloads.
const PHONE_SETTING_KEYS = ['wallpaper', 'accentColor', 'surfaceColor', 'bodyColor', 'cutout', 'statusBar', 'clockText', 'carrier', 'signal', 'battery', 'sound'];
const PHONE_PHOTO_BYTES = 480 * 1024, PHONE_THUMB = 320, PHONE_FULL_KEEP = 6;
// FORK-PHONE-SETTINGS-BEGIN (pure; tests/fork-phone-settings.test.mjs)
const phoneModOwn = (layer, key) => !!layer && Object.prototype.hasOwnProperty.call(layer, key);
const phoneModKind = stored => !stored ? null : phoneModOwn(stored, 'fixed') ? 'fixed' : phoneModOwn(stored, 'ref') ? 'ref' : phoneModOwn(stored, 'formula') ? 'formula' : 'auto';
// Where a setting is saved: 本卡 over 全局 over the built-in default.
const phoneModLevel = (data, key) => phoneModOwn(data.card, key) ? 'card' : phoneModOwn(data.global, key) ? 'global' : 'default';
// A layer's pictures in 照片, oldest first.
const phoneModPhotoRows = layer => layer && layer.photos && Array.isArray(layer.photos.fixed) ? layer.photos.fixed : [];
// A layer's wallpaper picture (a file of that layer), or '' for none / the built-in one.
const phoneModWallFile = layer => layer && layer.wallpaper && layer.wallpaper.fixed && typeof layer.wallpaper.fixed.file === 'string' ? layer.wallpaper.fixed.file : '';
// A picture id is '<layer>:<file>'; 'none' is the built-in wallpaper.
const phoneModChoice = choice => { const at = choice.indexOf(':'); return at < 0 ? { from: choice, file: '' } : { from: choice.slice(0, at), file: choice.slice(at + 1) }; };
const PHONE_PHOTOS_MAX = 30;
// 照片 after adding `file` to a layer (newest last); a full library refuses rather than dropping the player's pictures.
function phoneModPhotosAfterAdd(rows, file, name, anchor) {
    if (rows.length >= PHONE_PHOTOS_MAX) throw Object.assign(new Error('照片已满（最多 ' + PHONE_PHOTOS_MAX + ' 张），请先删除一些照片'), { code: 'PHOTOS_FULL' });
    return [...rows.map(row => ({ ...row })), { file, ...(name ? { name } : {}), ...(anchor ? { anchor: { ...anchor } } : {}) }];
}
function phoneModTakePhoto(snapshot, request, anchor) {
    // Capture the shutter position before frame rendering or the config write can yield.
    const captured = { ...anchor };
    return snapshot().then(src => request({ op: 'add', layer: 'card', value: { src, name: 'FaceTime', anchor: captured } }));
}
function phoneModSettingsView(data, { status, error, thumbs, full, autos }) {
    const schema = data && data.schema, list = Array.isArray(schema) ? schema : schema && schema.fields || [];
    const fields = PHONE_SETTING_KEYS.map(key => list.find(field => field.key === key)).filter(Boolean).map(field => ({
        key: field.key, label: String(field.label || field.key), type: field.ui && field.ui.control || field.valueType,
        choices: (field.ui && field.ui.choices || []).map(row => ({ value: row.value, label: String(row.label) })),
        min: field.min, max: field.max, auto: !!(field.autoRef || field.guessHints), unit: field.ui && field.ui.unit || '', default: field.default
    }));
    const values = {};
    if (data) for (const field of fields) {
        const resolved = data.resolved && data.resolved[field.key], level = phoneModLevel(data, field.key);
        values[field.key] = { value: resolved && !resolved.error ? resolved.value : field.key === 'wallpaper' ? {} : null, level,
            kind: phoneModKind(level === 'card' ? data.card[field.key] : level === 'global' ? data.global[field.key] : null) || 'auto',
            ...(phoneModOwn(data.card, field.key) ? { card: data.card[field.key] } : {}), ...(phoneModOwn(data.global, field.key) ? { global: data.global[field.key] } : {}) };
    }
    const photos = data ? ['card', 'global'].flatMap(layer => phoneModPhotoRows(data[layer]).map(row => ({
        id: layer + ':' + row.file, layer, file: row.file, name: row.name || '', ...(row.anchor ? { anchor: { ...row.anchor } } : {}), url: thumbs[layer + ':' + row.file] || '' }))) : [];
    const walls = data ? ['card', 'global'].map(layer => ({ layer, file: phoneModWallFile(data[layer]) })).filter(row => row.file)
        .map(row => ({ id: row.layer + ':' + row.file, layer: row.layer, file: row.file, url: thumbs[row.layer + ':' + row.file] || '', shown: true })) : [];
    return Object.freeze({ status, error: error || '', fields, values, autos: autos || {}, photos, walls, full: { ...full } });
}
// What saving a value to a layer writes. 自动 on 全局 is the default itself (clear); on 本卡 it is pinned ({auto: true}),
// so the card keeps following the automatic source even when 全局 is set.
function phoneModWriteOf(layer, value) {
    if (value.auto === true) return layer === 'global' ? { clear: true } : { set: { auto: true } };
    return { set: { fixed: value.fixed } };
}
// FORK-PHONE-SETTINGS-END
// Player wording through the one shared playerErrorText (asset-pack-ui.js): no code, no English.
const phoneModErrorText = error => playerErrorText(error || '出错了');
// The automatic colours (the stage source's values the colour fields follow when 自动), from listModConfigSources.
function phoneModAutoColours(sources, list) {
    const stage = (sources || []).find(row => row.id === 'stage'), find = (nodes, path) => {
        for (const node of nodes || []) { if (node.path === path) return node; if (path.startsWith(node.path + '/')) return find(node.children, path); }
        return null;
    };
    const out = {};
    for (const field of list) if (field.autoRef && field.autoRef.source === 'stage') {
        const node = stage && find(stage.tree, field.autoRef.path), value = node && typeof node.value === 'string' && /^#[0-9a-f]{6}$/i.test(node.value) ? node.value : field.default;
        if (typeof value === 'string') out[field.key] = value;
    }
    return out;
}
// A picture → a data URL no larger than `max` px on its long side, for the library's thumbnails.
async function phoneModScaled(src, max, type, quality) {
    const image = new Image(); image.src = src; await image.decode();
    const k = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * k)); canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, quality);
}
// A picture for 照片 (a data: URL from this computer or a phone feature), made to fit the phone and the upload limit: at
// most 2048 px on its long side, WebP, a lower quality / size until it is under the limit.
async function phoneModPhotoMedia(src) {
    for (const [max, quality] of [[2048, .86], [2048, .74], [1600, .72], [1280, .68]]) {
        const url = await phoneModScaled(src, max, 'image/webp', quality), data = url.replace(/^data:[^,]*,/, '');
        if (data.length * 3 / 4 <= PHONE_PHOTO_BYTES) return { mime: 'image/webp', data, url };
    }
    throw new Error('这张图片太大');
}
const phoneModConflict = e => !!e && /REVISION_CONFLICT$/.test(e.code || '');
function usePhoneSettings({ sessionId, call: callProp }) {
    const [state, setState] = React.useState({ status: 'idle', error: '', data: null, autos: {} });
    const [thumbs, setThumbs] = React.useState({}), [full, setFull] = React.useState({});
    const latest = React.useRef(null), queue = React.useRef(Promise.resolve()), life = React.useRef(0), asked = React.useRef(new Set()), picker = React.useRef(null);
    const activeSession=React.useRef(sessionId);activeSession.current=sessionId;
    const call = React.useCallback(async (method,args)=>{
        const mine=life.current;
        if(closed || activeSession.current!==sessionId)throw abort();
        const value=await invoke(callProp || rpc,method,args,sessionId);
        if(closed || mine!==life.current || activeSession.current!==sessionId)throw abort();
        return value;
    },[callProp,sessionId]);
    React.useEffect(() => { life.current++; latest.current = null; asked.current = new Set(); setState({ status: 'idle', error: '', data: null, autos: {} }); setThumbs({}); setFull({}); }, [sessionId]);
    React.useEffect(() => () => { life.current++; if (picker.current) {picker.current.oncancel?.();picker.current.remove();picker.current=null;} }, []);
    const accept = data => { if(closed)return;latest.current = data; setState(old => ({ ...old, status: 'ready', error: '', data })); };
    const load = async () => {
        const mine = life.current;
        setState(old => ({ ...old, status: old.data ? old.status : 'loading' }));
        try {
            const [data, sources] = await Promise.all([call('getModConfig', { modId: 'dsh.phone', sessionId }), call('listModConfigSources', { sessionId }).catch(() => null)]);
            if (mine !== life.current) return;
            const list = Array.isArray(data.schema) ? data.schema : data.schema && data.schema.fields || [];
            latest.current = data; setState({ status: 'ready', error: '', data, autos: phoneModAutoColours(sources && sources.sources, list) });
        } catch (e) { if (mine === life.current) setState(old => ({ ...old, status: old.data ? 'ready' : 'error', error: phoneModErrorText(e) })); }
    };
    // One write at a time with the newest revision; a conflict reloads, and the phone shows the reason.
    const write = task => {
        const mine = life.current;
        const run = queue.current.then(async () => {
            if (mine !== life.current) return;
            if (!latest.current) await load();
            if(closed || mine !== life.current)return;
            try { await task(); }
            catch (e) {
                if (mine !== life.current) return;
                if (phoneModConflict(e)) await load();
                setState(old => ({ ...old, error: phoneModConflict(e) ? '设置刚在别处改过，请再试一次' : phoneModErrorText(e) }));
                throw e;
            }
        });
        queue.current = run.catch(() => null);
        return run;
    };
    const set = async (key, layer, value) => accept(await call('setModConfig', { modId: 'dsh.phone', sessionId, key, layer, value, expectedRevision: latest.current.revision }));
    const clear = async (key, layer) => { if (phoneModOwn(latest.current[layer], key)) accept(await call('clearModConfig', { modId: 'dsh.phone', sessionId, key, layer, expectedRevision: latest.current.revision })); };
    const upload = async (layer, media) => {
        const done = await call('uploadModConfigFile', { modId: 'dsh.phone', layer, sessionId, mime: media.mime, data: media.data, expectedRevision: latest.current.revision });
        latest.current = { ...latest.current, revision: done.revision };
        return done.file.path;
    };
    // 照片's one write path: a picture (data: URL) into `layer`'s files/ and onto the end of that layer's library.
    const addPhoto = async (layer, src, name, anchor) => {
        const media = await phoneModPhotoMedia(src), rows = phoneModPhotoRows(latest.current[layer]);
        phoneModPhotosAfterAdd(rows, 'files/x', name);
        const file = await upload(layer, media), thumb = await phoneModScaled(media.url, PHONE_THUMB, 'image/jpeg', .82);
        asked.current.add(layer + ':' + file); setThumbs(old => ({ ...old, [layer + ':' + file]: thumb }));
        await set('photos', layer, { fixed: phoneModPhotosAfterAdd(phoneModPhotoRows(latest.current[layer]), file, String(name || '').trim().slice(0, 64), anchor) });
    };
    const wallpaper = async (layer, choice) => {
        // The built-in wallpaper: 全局 is the default itself; a card keeps {} so it shows it even when 全局 has a picture.
        if (choice === 'none') return layer === 'global' ? clear('wallpaper', 'global') : set('wallpaper', 'card', { fixed: {} });
        const { from, file } = phoneModChoice(choice);
        let own = file;
        if (from !== layer) {
            // Files belong to their layer: a picture of the other layer is uploaded again (not added to this layer's 照片).
            const read = await call('readModConfigFile', { modId: 'dsh.phone', layer: from, sessionId, path: file });
            own = await upload(layer, { mime: read.file.mime, data: read.data });
        }
        await set('wallpaper', layer, { fixed: { file: own } });
    };
    const pick = layer => new Promise((resolve, reject) => {
        // A file chooser of the stage page: the tap in the phone frame is the user activation it needs.
        if (!picker.current) { picker.current = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true }); picker.current.setAttribute('data-fork-phone-photos', ''); document.body.append(picker.current); }
        const input = picker.current;
        input.oncancel = () => resolve();
        input.onchange = () => {
            const file = input.files && input.files[0]; input.value = '';
            if (!file) { resolve(); return; }
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => write(() => addPhoto(layer, String(reader.result), String(file.name || '').replace(/\.[^.]+$/, ''))).then(resolve, reject);
            reader.readAsDataURL(file);
        };
        input.click();
    });
    const remove = choice => write(async () => {
        const { from: layer, file } = phoneModChoice(choice), rest = phoneModPhotoRows(latest.current[layer]).filter(row => row.file !== file).map(row => ({ ...row }));
        return rest.length ? set('photos', layer, { fixed: rest }) : clear('photos', layer);
    });
    // A picture opened in 照片, at full size (the newest few are kept).
    const open = async choice => {
        if (full[choice]) return;
        const { from, file } = phoneModChoice(choice), mine = life.current;
        const read = await call('readModConfigFile', { modId: 'dsh.phone', layer: from, sessionId, path: file });
        if (mine === life.current) setFull(old => Object.fromEntries([...Object.entries(old).filter(([id]) => id !== choice), [choice, 'data:' + read.file.mime + ';base64,' + read.data]].slice(-PHONE_FULL_KEEP)));
    };
    const request = React.useCallback(message => {
        if(closed)return Promise.reject(abort());
        const { op, key, layer, value, choice } = message || {};
        if (op === 'load') return load();
        if (op === 'open' && typeof choice === 'string') return open(choice);
        if (op === 'remove' && typeof choice === 'string') return remove(choice);
        if (!['card', 'global'].includes(layer)) return Promise.reject(new Error('未知的设置'));
        if (op === 'pick') return pick(layer);
        if (op === 'add' && value && typeof value.src === 'string' && value.src.startsWith('data:image/')) return write(() => addPhoto(layer, value.src, value.name, value.anchor ? { ...value.anchor } : undefined));
        if (!PHONE_SETTING_KEYS.includes(key)) return Promise.reject(new Error('未知的设置'));
        if (op === 'clear') return write(() => clear(key, layer));
        if (op === 'save' && key === 'wallpaper' && typeof choice === 'string') return write(() => wallpaper(layer, choice));
        if (op === 'save' && value && typeof value === 'object') return write(() => {
            const plan = phoneModWriteOf(layer, value);
            return plan.clear ? clear(key, layer) : set(key, layer, plan.set);
        });
        return Promise.reject(new Error('未知的设置'));
    }, [call, sessionId, full]);
    // Thumbnails of both layers' pictures and wallpapers, read once per file (readModConfigFile), scaled for the grid.
    React.useEffect(() => {
        const data = state.data, mine = life.current;
        if (!data) return;
        for (const layer of ['card', 'global']) for (const file of [...phoneModPhotoRows(data[layer]).map(row => row.file), phoneModWallFile(data[layer])].filter(Boolean)) {
            const id = layer + ':' + file;
            if (asked.current.has(id)) continue;
            asked.current.add(id);
            call('readModConfigFile', { modId: 'dsh.phone', layer, sessionId, path: file })
                .then(read => phoneModScaled('data:' + read.file.mime + ';base64,' + read.data, PHONE_THUMB, 'image/jpeg', .82))
                .then(url => { if (mine === life.current) setThumbs(old => ({ ...old, [id]: url })); }, () => { asked.current.delete(id); });
        }
    }, [state.data]);
    const view = React.useMemo(() => phoneModSettingsView(state.data, { status: state.status, error: state.error, thumbs, full, autos: state.autos }), [state, thumbs, full]);
    return React.useMemo(() => ({ view, request }), [view, request]);
}

// where the reader dragged a widget, per card and per view (open / compact). A browser UI preference only —
// never the chat, the card or the director — kept as fractions of the free stage so a resize always clamps it inside.
// face thumbnails handed to source widgets, per encoded [url,crop,px], page-session wide
// (LRU). A thumbnail made once is there at once on every later render, phone mount and chat return.
const STAGE_WIDGET_THUMBS=160,stageWidgetThumbs=new Map();
const STAGE_WIDGET_PLACE_PAD=8;
const stageWidgetPlaces=(()=>{
    const KEY='fork-widget-places',CARDS=48;let cache=null;
    const load=()=>{
        if (cache) return cache;
        try {const value=JSON.parse(localStorage.getItem(KEY) || 'null');cache=value && typeof value==='object' && !Array.isArray(value) ? value : {};} catch (_) {cache={};}
        return cache;
    };
    const valid=value=>Array.isArray(value) && value.length===2 && value.every(n=>Number.isFinite(n) && n>=0 && n<=1);
    return {
        get(scope,key,view) {const value=load()[scope]?.[key]?.[view];return valid(value) ? value : null;},
        // A null view forgets every view of that widget (reset); the most recently touched cards are kept.
        set(scope,key,view,value) {
            const all=load(),card={...(all[scope] || {})};
            if (view && value) card[key]={...(card[key] || {}),[view]:value}; else delete card[key];
            delete all[scope];if (Object.keys(card).length) all[scope]=card;
            for (const old of Object.keys(all).slice(0,Math.max(0,Object.keys(all).length-CARDS))) delete all[old];
            try {localStorage.setItem(KEY,JSON.stringify(all));} catch (_) {}
        }};
})();
// the last-read place of each phone conversation, per chat branch, in this browser, so unread
// counts survive a refresh or remount (refresh is not a reset). A browser reading mark, never chat or director state.
const phoneModReads=(()=>{
    const KEY='fork-phone-read',CHATS=48;let cache=null;
    const load=()=>{
        if (cache) return cache;
        try {const value=JSON.parse(localStorage.getItem(KEY) || 'null');cache=value && typeof value==='object' && !Array.isArray(value) ? value : {};} catch (_) {cache={};}
        return cache;
    };
    return {
        get(scope) {const value=load()[scope];return value && typeof value==='object' && !Array.isArray(value) ? value : {};},
        set(scope,marks) {
            const all=load();delete all[scope];all[scope]=marks;
            for (const old of Object.keys(all).slice(0,Math.max(0,Object.keys(all).length-CHATS))) delete all[old];
            try {localStorage.setItem(KEY,JSON.stringify(all));} catch (_) {}
        }};
})();
function stageWidgetPlaceFraction(viewport,size,point) {
    const free=[viewport.width-size.width,viewport.height-size.height].map(n=>n-2*STAGE_WIDGET_PLACE_PAD);
    return [point.x-viewport.x,point.y-viewport.y].map((n,i)=>free[i]>0 ? Math.min(1,Math.max(0,(n-STAGE_WIDGET_PLACE_PAD)/free[i])) : .5);
}
function stageWidgetPlacePoint(viewport,size,fraction) {
    return {x:viewport.x+STAGE_WIDGET_PLACE_PAD+Math.max(0,viewport.width-size.width-2*STAGE_WIDGET_PLACE_PAD)*fraction[0],
        y:viewport.y+STAGE_WIDGET_PLACE_PAD+Math.max(0,viewport.height-size.height-2*STAGE_WIDGET_PLACE_PAD)*fraction[1]};
}
// the phone is centred in the band between the top bar and the dialogue box and fills its
// height with minimal margins, never over the box (stage units),
// keeping its proportions; the
// incoming banner is exactly as wide as that phone's screen. The view zooms to match and is told the dialogue box's body
// size, so its message text reads at least as large as the box's at every window size.
const PHONE_KEY=JSON.stringify(['dsh.phone','source']),PHONE_BANNER_MS=3500,PHONE_GAP=4,PHONE_MIN_WIDTH=160;
const PHONE_BEZEL=15,PHONE_SCREEN=265,PHONE_BANNER_HEIGHT=78,PHONE_MAX_ZOOM=3;
// on a stage this narrow the open phone is the
// full-bleed sheet - the reader's own phone is the device - and the dialogue box stays hidden under it until it is put away.
// Wider stages keep the PC rule: the phone never covers the dialogue box.
// only a real phone - a touch screen (coarse pointer) AND this narrow, never a narrow desktop
// window - holds the phone mod as the device itself: the full-bleed sheet with no frame or Dynamic Island and without our status
// bar (the device shows its own); our home bar stays, lifted clear of the system's gesture zone by the safe-area insets
// (presentation.device). A desktop keeps the framed phone at any window size.
const PHONE_FULL_WIDTH=640;
const phoneModHandheld=viewport=>viewport.width<=PHONE_FULL_WIDTH && matchMedia('(pointer: coarse)').matches;
// The device's safe-area insets (CSS px) that still reach into the stage: the page around it (the play shell) may already stand
// clear of the status bar or the gesture zone, so only the overlap is the sheet's to keep free - never a second band (owner
// 2026-10-27 「灵动岛那一片儿…纯纯空白浪费空间」). A sandboxed frame reads none of its own.
let safeAreaProbe=null;
function safeAreaInsets(root) {
    if (!safeAreaProbe) {
        safeAreaProbe=document.createElement('div');
        safeAreaProbe.setAttribute('aria-hidden','true');
        safeAreaProbe.style.cssText='position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)';
        document.body.append(safeAreaProbe);
    }
    const style=getComputedStyle(safeAreaProbe),frame=root.getBoundingClientRect();
    return {top:Math.round(Math.max(0,(parseFloat(style.paddingTop) || 0)-Math.max(0,frame.top))),bottom:Math.round(Math.max(0,(parseFloat(style.paddingBottom) || 0)-Math.max(0,window.innerHeight-frame.bottom)))};
}
const phoneModStageScale=viewport=>Math.min(1.5,Math.max(.85,viewport.height/1080));
// the band is measured against the dialogue box as the skin
// draws it at its tallest, never against this page. A skin whose box height follows its lines (art.textbox.height fit lines:
// data-fit-lines and --art-fit-block on the box, --art-fit-max on the stage) is read at its max lines — the box and what rides
// its top edge (name tab, portrait, frame) lifted by the lines this page leaves out — and the band is held while that height
// eases. What a page adds or takes away (a narration page without the name tab, a hidden box, the name tab's entrance
// motion) never widens the band again: within one layout (viewport, letterbox, skin, text size: geometry.layoutKey) the
// band only narrows (memory), so the phone keeps one size while the story turns pages; a viewport or skin change starts
// afresh. The input page's label (13px over the box) is not part of the box.
function stageWidgetFitRise(box) {
    const count=parseInt(box.dataset.fitLines,10),block=parseFloat(box.style.getPropertyValue('--art-fit-block')),max=parseInt(getComputedStyle(box).getPropertyValue('--art-fit-max'),10);
    return count>0 && block>0 && max>count ? block/count*(max-count) : 0;
}
// The centred reading sheet's size: the declared open box within the stage, kept to its aspect ratio.
function stageWidgetSheetSize(viewport,box) {
    let width=Math.max(box.minWidth,Math.min(box.width,viewport.width-16)),height=Math.max(box.minHeight,Math.min(box.height,viewport.height-72));
    if (box.aspectRatio) {width=Math.max(box.minWidth,box.minHeight*box.aspectRatio,Math.min(width,height*box.aspectRatio));height=width/box.aspectRatio;}
    return {width,height};
}
function phoneModStageSize(geometry,box,memory) {
    const v=geometry.viewport,band=geometry.band || {top:v.y,bottom:v.y+v.height},ratio=box.aspectRatio || box.width/box.height;
    // Minimal margins: the free band is the phone. Its top is the bottom of the
    // top chrome actually drawn above the phone's column (a top bar whose controls sit in the corners reserves nothing), its
    // bottom the top of the dialogue box as the active skin draws it (name tab, frame) in that column; the letterbox bounds both.
    const gap=Math.max(PHONE_GAP,v.height*.004),stageTop=Math.max(v.y,band.top),stageBottom=Math.min(v.y+v.height,band.bottom);
    let top=stageTop+gap,bottom=stageBottom-gap,height=0,width=0,x=0;
    for (let pass=0;pass<4;pass++) {
        height=bottom-top;width=height*ratio;
        if (width>v.width-24) {width=v.width-24;height=width/ratio;}
        x=v.x+(v.width-width)/2;
        const over=r=>r.x<x+width+gap && r.x+r.width>x-gap;
        const nextTop=Math.max(top,Math.max(stageTop,...(geometry.chrome || []).filter(over).map(r=>r.y+r.height))+gap);
        const nextBottom=Math.min(bottom,Math.min(stageBottom,...(geometry.floor || []).filter(over).map(r=>r.y))-gap);
        if (nextTop===top && nextBottom===bottom) break;
        top=nextTop;bottom=nextBottom;
    }
    if (memory && memory.key===geometry.layoutKey) {top=Math.max(top,memory.top);bottom=Math.min(bottom,memory.bottom);}
    height=bottom-top;width=height*ratio;
    if (width>v.width-24) {width=v.width-24;height=width/ratio;}
    x=v.x+(v.width-width)/2;
    if (!(width>=PHONE_MIN_WIDTH) || !(height>0)) return null;
    if (memory) Object.assign(memory,{key:geometry.layoutKey,top,bottom});
    return {x,y:top+(bottom-top-height)/2,width,height,zoom:Math.min(PHONE_MAX_ZOOM,Math.max(.7,width/box.width))};
}
// The stage as the widgets see it (stage units), from the DOM: the viewport, the letterbox band, the top chrome and the dialogue
// box's floor (see phoneModStageSize), the figures, and the box text's reading size. previous: the last geometry, whose floor is
// kept while the box's height eases.
function stageWidgetStageGeometry(root,previous) {
    const frame=root.getBoundingClientRect(),rect=node=>{const r=node.getBoundingClientRect();return {x:r.left-frame.left,y:r.top-frame.top,width:r.width,height:r.height};};
    const blocked=[],caption=[],band={top:0,bottom:frame.height};
    for (const node of root.querySelectorAll('.fork-gal-topbar,.fork-gal-letterbox i,.fork-gal-box,.fork-gal-side,.fork-gal-controls')) {
        const r=rect(node);if (!r.width || !r.height) continue;
        if (node.matches('.fork-gal-box')) caption.push(r);else blocked.push(r);
        // The free reading band: inside the letterbox; the top chrome and the dialogue box are measured piece by piece below.
        if (node.matches('.fork-gal-letterbox i') && r.y+r.height/2<frame.height/2) band.top=Math.max(band.top,r.y+r.height);
        else if (node.matches('.fork-gal-letterbox i')) band.bottom=Math.min(band.bottom,r.y);
    }
    // what is actually drawn, so a skin without a top bar, or one whose controls sit in the
    // corners, gives the phone the whole height: the top bar's visible pieces, and the dialogue box with its visible parts
    // (a name tab or frame that rises above the box).
    const shown=node=>{const style=getComputedStyle(node);return style.visibility!=='hidden' && style.display!=='none' && Number(style.opacity)>.05;};
    const chrome=[],floor=[];
    for (const node of root.querySelectorAll('.fork-gal-topbar > *')) {const r=rect(node);if (r.width && r.height && r.y+r.height/2<frame.height/2 && shown(node)) chrome.push(r);}
    for (const node of root.querySelectorAll('.fork-gal-box:not(.is-hidden), .fork-gal-box:not(.is-hidden) > :not(.fork-gal-transition-label), .fork-gal-box:not(.is-hidden) :is(.fork-gal-name,.fork-skin-frame)')) {const r=rect(node);if (r.width && r.height && r.y+r.height/2>frame.height/2 && shown(node)) floor.push(r);}
    // The box at its max lines (stageWidgetFitRise), and held while its height eases to this page's lines.
    const box=root.querySelector('.fork-gal-box:not(.is-hidden)'),rise=box && box.hasAttribute('data-fit-lines') ? stageWidgetFitRise(box) : 0;
    const easing=Boolean(box && typeof box.getAnimations==='function' && box.getAnimations({subtree:true}).some(animation=>animation.transitionProperty==='height' || animation.transitionProperty==='bottom'));
    const visual=window.visualViewport,x=Math.max(0,(visual?.offsetLeft || 0)-frame.left),y=Math.max(0,(visual?.offsetTop || 0)-frame.top);
    const width=Math.max(0,Math.min(frame.width,(visual?.offsetLeft || 0)+(visual?.width || window.innerWidth)-frame.left)),height=Math.max(0,Math.min(frame.height,(visual?.offsetTop || 0)+(visual?.height || window.innerHeight)-frame.top));
    if (x) blocked.push({x:0,y:0,width:x,height});if (y) blocked.push({x:0,y:0,width,height:y});
    blocked.push({x:0,y:height-64,width,height:64});
    const figures=views.scene?.rects(root) || [];
    // Stage units: a docked stage is only scaled (createModStageDock); rounded so its move settles at once.
    const k=frame.width>0 && Math.abs(frame.width-root.offsetWidth)>=1 ? root.offsetWidth/frame.width : 1,u=v=>k===1 ? v : Math.round(v*k*100)/100;
    const local=r=>({x:u(r.x),y:u(r.y),width:u(r.width),height:u(r.height)});
    // The dialogue box's body size (computed style: already in stage units), which the phone's message text matches.
    const text=root.querySelector('.fork-gal-box .fork-gal-text'),reading=text ? Math.round(parseFloat(getComputedStyle(text).fontSize)*10)/10 : 0;
    // The layout the box is placed by: theme, skin marks, a skin's narration layout (screen / band), film.
    const marks=Object.entries(root.dataset).filter(([name])=>name==='theme' || name==='narrationLayout' || name.startsWith('fkSkin')).sort();
    const next={width:u(width),height:u(height),viewport:local({x,y,width:Math.max(0,width-x),height:Math.max(0,height-y)}),blocked:blocked.map(local),caption:caption.map(local),figures,band:{top:u(band.top),bottom:u(band.bottom)},chrome:chrome.map(local),
        floor:easing && previous ? previous.floor : floor.map(r=>{const l=local(r);return rise ? {...l,y:l.y-rise} : l;}),reading:reading>0 ? reading : null};
    next.layoutKey=JSON.stringify([next.width,next.height,next.viewport,next.band,next.reading,marks,root.classList.contains('is-film')]);
    return next;
}
// One stage owner measures and allocates all state/source/performance instances.
const NO_PHONE_CALL=Object.freeze({subscribe:()=>()=>{},get:()=>null,command:()=>{}});
function useWidgetStage(props) {
    const local=React.useRef({state:null,refs:new Map()}), context=props.context || sessions()?.owner?.getWidgetContext(props.sessionId) || local.current;
    context.transcripts ||= new Set();
    const [,redraw]=React.useState(0), [geometry,setGeometry]=React.useState(null), [ready,setReady]=React.useState({}), [failed,setFailed]=React.useState({});
    // The phone's band in this layout (phoneModStageSize memory) and the last measured geometry (held while the box eases).
    const phoneBand=React.useRef({key:'',top:0,bottom:0}),measured=React.useRef(null);
    // the reader's phone size and place on this device, and whether it may be dragged.
    const phonePrefs=React.useSyncExternalStore(typeof phoneModPrefs!=='undefined' ? phoneModPrefs.subscribe : ()=>()=>{},typeof phoneModPrefs!=='undefined' ? phoneModPrefs.get : ()=>null,typeof phoneModPrefs!=='undefined' ? phoneModPrefs.get : ()=>null);
    const [visible,setVisible]=React.useState({key:'',text:''}), [grants,setGrants]=React.useState({key:'',items:[]}), [history,setHistory]=React.useState(null), [sheet,setSheet]=React.useState(null);
    // the conversation directory (every contact and group) and
    // the reader's own choices in the phone: which phone (「谁的手机」) and, per phone, which conversation. The phone only reads
    // history; it never sends. `phoneFollow` is the phone the latest phone line took the reader to, kept through its run.
    const [phoneDirectory,setPhoneDirectory]=React.useState(null),[phoneView,setPhoneView]=React.useState({choice:null,threads:{}}),phoneFollow=React.useRef(null);
    // How many messages of each conversation the phone has scrolled back to (80 more per request, per chat branch).
    const [phoneLimits,setPhoneLimits]=React.useState({scope:'',values:{}});
    // the call lives in the page (the sandboxed phone has no
    // microphone); the phone draws its screen from this state and asks for start / mute / end.
    const calls=props.phoneCall || NO_PHONE_CALL,phoneCall=React.useSyncExternalStore(calls.subscribe,calls.get);
    React.useEffect(()=>{if (props.sessionId) calls.command({sessionId:props.sessionId,action:'threads'});},[calls,props.sessionId]);
    // How many earlier turns the stage reads for the phone (20 more each time its conversation scrolls past the loaded ones).
    const [historyDepth,setHistoryDepth]=React.useState({scope:'',value:19});
    const readScope=JSON.stringify([props.sessionId,props.source?.branchId || '']);
    const [phoneReads,setPhoneReads]=React.useState(()=>({scope:readScope,marks:phoneModReads.get(readScope)}));
    const reads=phoneReads.scope===readScope ? phoneReads.marks : phoneModReads.get(readScope);
    const markRead=(updates)=>{
        const next={...reads};let changed=false;
        for (const [id,order] of Object.entries(updates)) if (Array.isArray(order) && JSON.stringify(next[id])!==JSON.stringify(order)) {next[id]=order;changed=true;}
        if (!changed) return;
        while (Object.keys(next).length>128) delete next[Object.keys(next)[0]];
        phoneModReads.set(readScope,next);setPhoneReads({scope:readScope,marks:next});
    };
    const [foreground,setForeground]=React.useState(!document.hidden);
    const motionQuery=React.useMemo(()=>matchMedia('(prefers-reduced-motion: reduce)'),[]);
    React.useEffect(()=>{const change=()=>redraw(n=>n+1);motionQuery.addEventListener?.('change',change);return()=>motionQuery.removeEventListener?.('change',change);},[motionQuery]);
    const audioEvents=React.useRef(new Map());
    const lastPositions=React.useRef(new Map()), previousInput=React.useRef(''), focusReturn=React.useRef(null), enabledBefore=React.useRef(props.enabled);
    React.useEffect(()=>{const wake=()=>setForeground(!document.hidden);document.addEventListener('visibilitychange',wake);return()=>document.removeEventListener('visibilitychange',wake);},[]);
    const paused=props.paused || !foreground, cursor={turn:props.turn,page:props.page,para:props.pages[props.page]?.para || 0,generation:JSON.stringify([props.sessionId,props.source?.authorityEpoch,props.source?.branchId,props.source?.generation])};
    // the phone stays in hand across a mixed run of narration and phone lines.
    const phoneRun=props.enabled && props.record?.token?.bindingKey && typeof phoneModRun==='function' ? phoneModRun(props.record,cursor.para) : null;
    if (phoneRun) cursor.holdRef=PHONE_KEY;else phoneFollow.current=null;
    // The calls the phone's conversations show at this page (a call made later in the story is not there yet).
    const shownCall=React.useMemo(()=>typeof phoneModCallsAt==='function' ? phoneModCallsAt(phoneCall,cursor.turn,cursor.para) : phoneCall,[phoneCall,cursor.turn,cursor.para]);
    const phoneClosed=React.useRef(null);
    const readingKey=JSON.stringify([props.sessionId,props.source,props.turn,props.page,props.card]);
    const text=visible.key===readingKey ? visible.text : '';
    const currentRow={turn:props.turn,sourceKey:props.record?.binding?.stream?.operationId || props.record?.token?.sourceKey,record:props.record,pages:props.pages};
    const scope=JSON.stringify([props.sessionId,props.source?.authorityEpoch,props.source?.branchId,props.source?.generation]), held=React.useRef({scope,items:new Map()});
    const phoneDepth=historyDepth.scope===scope ? historyDepth.value : 19,historyKeyOf=(key,phone)=>JSON.stringify([scope,props.source,key,phone ? phoneDepth : 19]);
    if (held.current.scope!==scope || !props.enabled) held.current={scope,items:new Map()};
    const currentRefs=new Set((props.record?.token?.bindingKey && ['partial','done'].includes(props.record.phase) ? props.record.entries : []).filter(entry=>entry.at<=Math.min(cursor.para,props.record.through)).flatMap(entry=>entry.ops.filter(op=>op.op==='widget.source').map(op=>stageWidgetRefKey(op.ref))));
    // a first-party mod source (the phone) is a
    // built-in capability. Projected means globally on for this card, so it is in hand from the first page, before any
    // phone line; marks only add messages and attention, they no longer admit the device.
    const available=(props.enabled ? props.widgets : []).filter(item=>item.definition?.document?.presentation && (item.modSource || item.ref?.kind==='widgets' && (!item.sourceOnly || currentRefs.has(stageWidgetRefKey(item.ref)))));
    for (const widget of available) if (widget.sourceOnly) {const key=stageWidgetRefKey(widget.ref);context.refs.set(key,widget.ref);held.current.items.set(key,widget);}
    while (context.refs.size>64) context.refs.delete(context.refs.keys().next().value);
    for (const key of held.current.items.keys()) if (!context.refs.has(key)) held.current.items.delete(key);
    const known=[...context.refs.values()];
    const grantKey=JSON.stringify([scope,props.source,props.record?.token,props.record?.assetRevision,props.assetRevision,cursor.para,props.enabled,known,history?.key]);
    React.useEffect(()=>{
        let live=true;
        const missing=known.filter(ref=>!available.some(item=>stageWidgetRefKey(item.ref)===stageWidgetRefKey(ref)) || history?.scope===scope && history.rows.some(row=>row.turn<props.turn));
        if (!props.enabled || !props.record?.token || !missing.length) return;
        (async()=>{
            const items=[];
            for (const ref of missing) {
                const result=await (props.readWindow || ((args)=>rpc(ref.modId==='dsh.phone'?'getStagePhonePresentation':'getAssetPackPresentation',args,props.sessionId)))({sessionId:props.sessionId,turn:props.turn,at:cursor.para,expectedDirectionToken:props.record.token,...(ref.modId?{}:{widgetWindow:{ref}})}).catch(()=>null);
                if (!live) return;
                if (result?.status==='ready') items.push(...result.widgets);
            }
            if (live) {
                for (const ref of missing) held.current.items.delete(stageWidgetRefKey(ref));
                for (const widget of items) held.current.items.set(stageWidgetRefKey(widget.ref),widget);
                setGrants({key:grantKey,scope,items});
            }
        })();
        return()=>{live=false;};
    },[grantKey]);
    const byRef=new Map();
    // Keep only the mounted descriptor while checking a new window; it cannot authorize actions, claims or media.
    const checked=grants.scope===scope && grants.key===grantKey;
    const historical=props.enabled ? (checked ? grants.items : [...held.current.items.values()].map(item=>({...item,checking:true}))) : [];
    for (const widget of [...available,...historical]) {if (!byRef.has(stageWidgetRefKey(widget.ref))) byRef.set(stageWidgetRefKey(widget.ref),{...widget,historyAvatars:checked?grants.items.find(item=>stageWidgetRefKey(item.ref)===stageWidgetRefKey(widget.ref))?.historyAvatars:{}});}
    const rows=[...(history?.scope===scope ? history.rows.filter(row=>row.turn<props.turn) : []),currentRow];
    const hasPhone=[...byRef.values()].some(value=>value.ref?.modId==='dsh.phone' && value.sourceOnly);
    const directoryKey=JSON.stringify([scope,props.turn,props.record?.phase,hasPhone]);
    React.useEffect(()=>{
        if (!hasPhone || !props.sessionId) return;
        let live=true;
        // The thread directory is read when the phone is used, not by the entry page: it waits for the entry's connections.
        (views.admission.shown.settled()).then(()=>live ? (props.phoneThreadsRpc || (args=>rpc('getStagePhoneThreads',args,props.sessionId)))({sessionId:props.sessionId}) : null).then(value=>{if (live) setPhoneDirectory(value?.enabled ? {scope,value} : null);},()=>{});
        return()=>{live=false;};
    },[directoryKey]);
    const directory=phoneDirectory?.scope===scope ? phoneDirectory.value : null;
    const items=[...byRef].slice(0,64).map(([key,value])=>{
        const phone=value.ref?.modId==='dsh.phone';
        const source=value.sourceOnly ? stageWidgetThread({rows,ref:value.ref,cursor,characters:props.config?.characters,visibleText:text,revealed:props.revealed,limited:history?.limited,unavailable:history?.unavailable,
            ...(phone ? {phoneView:{...phoneView,follow:phoneFollow.current},directory,reads,limits:phoneLimits.scope===readScope ? phoneLimits.values : null} : {})}) : null;
        if (phone && source?.current && source.livePhoneId) phoneFollow.current=source.livePhoneId;
        // The player's phone contacts in the directory's (manifest) order, for the phone's 电话 app.
        // Every contact is listed: the phone's 通讯录 has no cap (the prompt's contacts are not read from here).
        if (phone && source && directory) source.contacts=directory.contacts.map(({id,name})=>({id,name}));
        if (source && context.state?.entries.get(key)?.requestedState==='open' && history?.key!==historyKeyOf(key,phone)) source.historyStatus='loading';
        const voiceHandles=new Map();
        if (source) source.messages=source.messages.map(row=>{
            const line=(row.turn===props.turn ? props.pages : rows.find(value=>value.turn===row.turn)?.pages)?.find(line=>line.para===row.para);
            const voice=(!value.modSource || row.form==='voice') && row.revealed
                ? row.turn===props.turn ? line?.voice : value.modSource && row.form==='voice' && line ? props.historyVoice?.(line) : null
                : null;
            const handle=voice ? 'voice:'+row.turn+':'+row.para : null;
            if (handle) voiceHandles.set(handle,()=>{props.onPause?.();voice.click?.();});
            return {...row,...(handle?{voice:handle}:{}),...(value.modSource?{transcript:context.transcripts.has(row.id)}:{})};
        });
        const mark=props.record?.entries?.find(entry=>entry.at===cursor.para)?.ops.map(op=>sourceMark(op,value.ref)).find(Boolean);
        const token=mark ? JSON.stringify([currentRow.sourceKey,props.record.token.generation,props.turn,cursor.para]) : value.eventToken;
        // phone.view {threadId|null, phoneId?}: a phone id switches phones (null: back to the reader's own phone, every choice
        // dropped, as when the phone is put away); without one the thread choice is for the phone on screen.
        const phoneHandlers=phone && source ? {onPhoneView:(threadId,phoneId)=>{
                const after=source.current?.id || null;
                setPhoneView(old=>{
                    if (phoneId===null) return {choice:null,threads:{}};
                    const target=typeof phoneId==='string' ? phoneId : source.phoneId,threads={...old.threads};
                    if (threadId) threads[target]={id:threadId,after};else delete threads[target];
                    return {choice:typeof phoneId==='string' ? {id:phoneId,after} : old.choice,threads};
                });
            },
            onPhoneEarlier:()=>{
                const id=source.threadId;if (!id || !source.hasEarlier) return;
                if (source.windowed) setPhoneLimits(old=>{const values=old.scope===readScope ? old.values : {};return {scope:readScope,values:{...values,[id]:(values[id] || 80)+80}};});
                else setHistoryDepth(old=>({scope,value:(old.scope===scope ? old.value : 19)+20}));
            },
            // The conversation on the open phone's screen is read up to its latest message.
            onPhoneRead:(threadId,phoneId)=>{if (phoneId && phoneId!==source.phoneId) return;const row=source.threads?.find(thread=>thread.id===threadId);if (row?.latest) markRead({[phoneModReadKey(source.phoneId || PHONE_PLAYER,threadId)]:row.latest});}} : {};
        // the phone's own Settings app reads and saves its settings through
        // the stage's adapter (phone-settings.js) — 保存到本卡 / 保存为全局, ↺ clears this card's value.
        const settingsBridge=phone && props.phoneSettings ? {phoneConfig:props.phoneSettings.view,onPhoneSettings:props.phoneSettings.request} : {};
        if (phone && props.phoneCall) {settingsBridge.phoneCall=shownCall;settingsBridge.onPhoneCall=data=>{
            // FaceTime's shutter: the frame the player sees goes into this phone's 照片 (本卡), through the one Photos write.
            if (data.action==='snapshot') {if (props.phoneSettings && calls.snapshot) void phoneModTakePhoto(()=>calls.snapshot(),props.phoneSettings.request,{chatId:props.chatId,branchId:props.source?.branchId || 'main',turn:cursor.turn,...(cursor.para>0?{para:cursor.para}:{})}).catch(error=>console.warn('[phone] FaceTime snapshot',error));return;}
            calls.command({...data,sessionId:props.sessionId,at:{turn:cursor.turn,para:cursor.para},name:source?.threads?.flatMap(thread=>thread.participants).find(person=>person.id===data.contactId)?.name});};
            settingsBridge.onPhoneVideo=(video,frame)=>calls.layout?.(video ? {...video,frame} : null);}
        return {...value,key,source,voiceHandles,...phoneHandlers,...settingsBridge,onTranscript:id=>{if(!source?.messages.some(row=>row.id===id && row.form==='voice'))return;if(context.transcripts.has(id))context.transcripts.delete(id);else context.transcripts.add(id);redraw(n=>n+1);},event:token ? {token,para:mark?cursor.para:value.eventAt,side:mark?.side} : null,
            identity:props.sessionId+':'+(props.source?.authorityEpoch || 0)+':'+(props.source?.branchId || '')+':'+key+':'+value.definition.contentIdentity,notifications:value.definition.document.presentation.notifications,
            fingerprint:JSON.stringify(value.state),performance:Boolean(value.performance)};
    });
    const avatarInputs=[...new Map(items.flatMap(item=>item.source?.messages.map(row=>{
        const id=row.turn+':'+row.para, avatar=item.historyAvatars?.[id];
        const line=row.turn===props.turn ? props.pages.find(line=>line.para===row.para) : null;
        const character=line && bubbleCharacter(props.config,line);
        const mood=character && bubbleMood(line.mood,bubbleMoodList(props.config,character.alias))?.id;
        return [id,[id,character?{alias:character.alias,mood}:null,avatar]];
    }).concat([...(item.source?.threads || []).flatMap(thread=>thread.participants),...(item.source?.phones || []),...(item.source?.contacts || [])].flatMap(person=>{
        // Every listed person's face, and each phone owner's, the player's own included (their persona figure): it is the
        // face on the phone's Settings account card.
        const alias=person.id==='$player' ? directory?.playerId : person.id;
        return alias ? [['p:'+person.id,['p:'+person.id,{alias},null]]] : [];
    })) || [])).values()];
    // a listed person's face is their card figure's own face — the identity
    // resolver's avatar of the card character (config.characters[].avatarMedia.default, the face the transcript shows),
    // prepared in the session avatar cache whether or not the figure is on stage. The stage only hands over the faces of
    // its visible cast and speaker until it is idle (stage-resource-runner visibleAvatars), so a contact who is not on
    // stage used to stay an initial while reading. The stage portrait remains the fallback for a person without a card face.
    // A contact id is a stage actor key (the mark's canonical contact); a carried key (chat copy, pack merge) is not its card
    // character's alias, so it names that character through the roster's figure ref (stageActorCharacter, the one
    // resolver the speaker tint uses; 2026-10-21: a three-glyph name showed as its initial).
    const actorFigures=React.useMemo(()=>Object.entries(props.actors || {}).flatMap(([alias,actor])=>actor?.figure?.figureId ? [{alias,ref:actor.figure}] : []),[props.actors]);
    const cardAlias=alias=>(typeof stageActorCharacter==='function' ? stageActorCharacter(props.config,actorFigures,alias)?.alias : null) || alias;
    const personAliases=[...new Set(avatarInputs.flatMap(([id,current])=>id.startsWith('p:') && current ? [cardAlias(current.alias)] : []))];
    // every face is drawn at the size the phone shows it
    // (stageWidgetFacePx: the phone's widest width so far on this stage x the screen's pixel ratio), and the card face is asked
    // of the session avatar cache at that size, so her 512 px library face reaches the 200 pt card and the 132 pt call
    // screen sharp instead of as a 64 px thumbnail scaled up four to six times.
    const phoneOpenWidth=items.find(item=>item.ref.modId==='dsh.phone')?.definition.document.presentation.open.width;
    const [phoneFaceWidth,setPhoneFaceWidth]=React.useState(0),dpr=window.devicePixelRatio || 1;
    const facePx=phoneOpenWidth ? stageWidgetFacePx(Math.max(phoneOpenWidth,phoneFaceWidth),dpr) : {person:64,message:64};
    const cardUrls=useCardFaces({config:props.config,sessionId:props.sessionId,source:props.source,names:personAliases,px:facePx.person/dpr});
    const avatarInputsResolved=avatarInputs.map(([id,current,history])=>{
        const card=id.startsWith('p:') && current ? cardUrls.get(cardAlias(current.alias)) : null;
        if (card) return [id,JSON.stringify([card,null,facePx.person]),'person'];
        const face=current?props.avatarOf?.(current.alias,current.mood):history;const url=current?face?.src:face?.url;
        const kind=id.startsWith('p:')?'person':'message';
        return [id,url?JSON.stringify([url,face?.crop || null,facePx[kind]]):null,kind];
    });
    // Independent image budget (stageWidgetAvatarBudget): every listed person's face, then a few mood variants (lossy
    // WebP at the shown size); missing decoration never delays reading. Thumbnails are kept per image (stageWidgetThumbs),
    // so a new message, page or history read never drops the faces already shown while the new set is prepared.
    const avatarBudget=stageWidgetAvatarBudget(avatarInputsResolved);
    const avatarKey=JSON.stringify(avatarBudget.urls);
    const [,thumbsLoaded]=React.useState(0),[avatarsFailed,setAvatarsFailed]=React.useState({key:'',urls:[]});
    React.useEffect(()=>{
        let live=true;const urls=avatarBudget.urls.filter(url=>!stageWidgetThumbs.has(url));
        if (!urls.length) return;
        const load=encoded=>new Promise(resolve=>{
            const [url,crop,px]=JSON.parse(encoded);
            const image=new Image();image.onerror=()=>resolve(null);
            image.onload=()=>{if(closed){resolve(null);return;}try {
                const canvas=document.createElement('canvas');canvas.width=canvas.height=px;
                const c=stageWidgetAvatarSquare(image.naturalWidth,image.naturalHeight,crop || undefined),context2d=canvas.getContext('2d');
                // Cover the square thumbnail before transfer; CSS cannot undo a stretched canvas.
                context2d.imageSmoothingQuality='high';context2d.drawImage(image,c.x,c.y,c.width,c.height,0,0,px,px);
                resolve(canvas.toDataURL('image/webp',.9));
            } catch {resolve(null);}};
            image.src=url;
        });
        Promise.all(urls.map(load)).then(values=>{
            if(closed)return;
            // A failed image is not remembered: the next set (or a later pack refresh) tries it again.
            values.forEach((value,i)=>{if (value) stageWidgetThumbs.set(urls[i],value);});
            while (stageWidgetThumbs.size>STAGE_WIDGET_THUMBS) stageWidgetThumbs.delete(stageWidgetThumbs.keys().next().value);
            // Even a superseded set repaints: the newer set may already be waiting for these very thumbnails.
            thumbsLoaded(n=>n+1);if (live) setAvatarsFailed({key:avatarKey,urls:urls.filter((url,i)=>!values[i])});
        });
        return()=>{live=false;};
    },[avatarKey]);
    const failedUrls=new Set(avatarsFailed.key===avatarKey ? avatarsFailed.urls : []);
    // A person whose face is known but still being prepared shows a quiet placeholder (no initial), and the face
    // arrives in place; an initial is only for a person without any face.
    // A person's face already shown stays while a sharper one of the same person is prepared (a wider phone, the card face
    // arriving at the phone's size).
    const shownFaces=React.useRef(new Map()).current;
    const pendingPerson=new Set(avatarInputsResolved.filter(([id,url])=>id.startsWith('p:') && url && !stageWidgetThumbs.has(url) && !failedUrls.has(url)).map(([id])=>id));
    for (const item of items) if (item.source) {
        item.source.avatars={};
        const face=(id,row)=>{
            const key=avatarBudget.rows[id];let value=key && stageWidgetThumbs.get(avatarBudget.urls[Number(key.slice(1))]);
            if (value && id.startsWith('p:')) shownFaces.set(id,value);
            else if (key && pendingPerson.has(id) && shownFaces.has(id)) value=shownFaces.get(id);
            if (!value) return pendingPerson.has(id) ? {...row,avatarPending:true} : row;
            item.source.avatars[key]=value;return {...row,avatar:key};
        };
        item.source.messages=item.source.messages.map(row=>face(row.turn+':'+row.para,row));
        if (item.source.threads) item.source.threads=item.source.threads.map(thread=>({...thread,participants:thread.participants.map(person=>face('p:'+person.id,person))}));
        if (item.source.phones) item.source.phones=item.source.phones.map(row=>face('p:'+row.id,row));
        if (item.source.contacts) item.source.contacts=item.source.contacts.map(row=>face('p:'+row.id,row));
    }
    cursor.currentRef=items.find(item=>item.source?.current)?.key || null;
    // A phone's first look (per chat branch) takes what is already there as read; later messages count as unread.
    const looked=new Set(Object.keys(reads).map(phoneModReadOwner));
    const unseen=(items.find(item=>item.ref?.modId==='dsh.phone')?.source?.phones || []).filter(row=>!looked.has(row.id) && row.threads.some(thread=>thread.latest));
    const firstLook=unseen.length ? JSON.stringify([readScope,unseen.map(row=>row.id)]) : '';
    React.useEffect(()=>{if (firstLook) markRead(Object.fromEntries(unseen.flatMap(row=>row.threads.filter(thread=>thread.latest).map(thread=>[phoneModReadKey(row.id,thread.id),thread.latest]))));},[firstLook]);
    const mountedIdentities=items.map(item=>item.identity).sort().join('|');
    React.useEffect(()=>{
        const active=new Set(items.map(item=>item.identity)),keep=values=>Object.fromEntries(Object.entries(values).filter(([identity])=>active.has(identity)));
        setReady(keep);setFailed(keep);
        for (const map of [audioEvents.current,lastPositions.current]) for (const key of map.keys()) if (!byRef.has(key)) map.delete(key);
    },[mountedIdentities]);
    const signature=JSON.stringify([cursor,items.map(item=>[item.key,item.identity,item.event,item.fingerprint]),props.enabled,paused,props.mode]);
    // The session owner can clear this state before the mounted hook unmounts.
    if (!context.state) {context.state=stageWidgetPresentationState();previousInput.current='';}
    // skip is silent - a widget SE event reached while skipping is consumed unplayed, and
    // one still sounding when it starts stops (widget music is persistent and plays on).
    for (const [key,event] of audioEvents.current) if (!byRef.has(key) || paused || props.skipping || props.mode!=='live' && !event.replay) event.fresh=false;
    React.useLayoutEffect(()=>{if (props.skipping) sandbox.stopSfx();},[props.skipping]);
    if (previousInput.current!==signature) {
        context.state=reduceWidgetPresentation(context.state,{type:'content',cursor,items:items.map(item=>({...item,source:item.sourceOnly})),live:props.mode==='live',suspended:paused,restoring:!enabledBefore.current && props.enabled});
        enabledBefore.current=props.enabled;
        previousInput.current=signature;
    }
    // a portrait phone reads the widget as the phone itself, so opening goes straight to the full-bleed sheet.
    const portrait=Boolean(geometry && geometry.viewport.width<700 && geometry.viewport.height>geometry.viewport.width);
    // The phone is the device only on a real phone; a narrow desktop window keeps the framed phone.
    const handheld=Boolean(geometry && phoneModHandheld(geometry.viewport));
    const action=(key,type)=>{
        if(closed)return;
        if (key===PHONE_KEY) phoneClosed.current=['collapse','hide'].includes(type) && phoneRun ? phoneRun.key : null;
        if (type==='open' && portrait && (key!==PHONE_KEY || handheld)) type='sheet';
        if (['open','sheet'].includes(type)) {focusReturn.current=document.activeElement;props.onPause?.();}
        if (['collapse','hide'].includes(type)) requestAnimationFrame(()=>{const panel=[...(props.rootRef.current?.querySelectorAll('.fork-widget-panel') || [])].find(node=>node.dataset.widgetRef===key && node.dataset.presentation!=='hidden');const target=focusReturn.current?.isConnected && focusReturn.current!==document.body ? focusReturn.current : (type==='collapse'?panel:null) || props.rootRef.current?.querySelector('.fork-widget-menu>button');target?.focus();});
        if (type==='sheet') {setSheet(key);type='open';} else if (['collapse','hide','open'].includes(type)) setSheet(null);
        context.state=reduceWidgetPresentation(context.state,{type,key});redraw(n=>n+1);
    };
    // the phone's earlier conversations (previous turns) are read while it
    // is still in the pocket, so the first open paints the finished list at once instead of 「还没有对话」 for a second and a
    // half. Other source widgets still read their history when opened. The read is shared and cached per session source.
    const opened=items.find(item=>item.sourceOnly && context.state.entries.get(item.key)?.requestedState==='open');
    const pocket=opened ? null : items.find(item=>item.sourceOnly && item.ref?.modId==='dsh.phone');
    const historyFor=opened || pocket;
    const depth=historyFor?.ref?.modId==='dsh.phone' ? phoneDepth : 19;
    const historyKey=historyFor ? historyKeyOf(historyFor.key,historyFor.ref?.modId==='dsh.phone') : '';
    React.useEffect(()=>{
        // Opening reads again (the session's cached read, rechecked against the turn index), as before.
        if (!historyFor) return;
        let live=true;
        const read=()=>(props.readHistory || ((source,turns)=>sessions()?.owner?.readWidgetHistory(props.sessionId,source,turns)))(props.source,depth)?.then(value=>{if (live && value) setHistory({...value,scope,key:historyKey});});
        // In the pocket it waits for a quiet moment, never ahead of the page the reader is on.
        if (opened || typeof requestIdleCallback!=='function') {read();return()=>{live=false;};}
        const task=requestIdleCallback(()=>{if (live) read();},{timeout:1500});
        return()=>{live=false;cancelIdleCallback(task);};
    },[historyKey,Boolean(opened)]);
    React.useLayoutEffect(register=>{
        const root=props.rootRef.current;if (!root) return;
        const measure=()=>{
            const next=stageWidgetStageGeometry(root,measured.current);
            measured.current=next;
            setGeometry(old=>JSON.stringify(old)===JSON.stringify(next) ? old : next);
        };
        let live=true;register(()=>{live=false;});
        const guardedMeasure=()=>{if(live&&!closed)measure();};
        guardedMeasure();const observer=new ResizeObserver(guardedMeasure);register(()=>observer.disconnect());observer.observe(root);
        const timer=forkForeground.setInterval(guardedMeasure,100);register(()=>forkForeground.clearInterval(timer));
        register(()=>window.visualViewport?.removeEventListener('resize',guardedMeasure));window.visualViewport?.addEventListener('resize',guardedMeasure);
    },[props.rootRef,props.film]);
    const phone=items.find(item=>item.ref.modId==='dsh.phone'),notice=phone?.source?.messages.find(row=>row.id===phone.source.current?.id && row.side==='in');
    const phoneEntry=phone && context.state.entries.get(phone.key),userClosed=Boolean(phoneRun && phoneClosed.current===phoneRun.key);
    // a real phone's banner — only for an incoming message that reaches a closed phone (the
    // first line of a run, or after the reader put the phone away). It slides down, stays ~3.5 s, slides back up and then
    // the phone is taken out, while skipping too. Every other line of a run goes straight into the open phone.
    const noticeId=notice && phoneEntry?.requestedState==='compact' && (!phoneRun || userClosed || phoneRun.start===cursor.para) ? notice.id : null;
    const [noticeClock,setNoticeClock]=React.useState({id:null,phase:null});
    const noticePhase=noticeClock.id===noticeId ? noticeClock.phase : null;
    const calmBanner=Boolean(props.reducedMotion);
    React.useEffect(()=>{
        if(!noticeId || paused || noticePhase==='done')return;
        const leave=setTimeout(()=>setNoticeClock({id:noticeId,phase:'leaving'}),noticePhase==='leaving'?0:PHONE_BANNER_MS);
        const done=setTimeout(()=>setNoticeClock({id:noticeId,phase:'done'}),(noticePhase==='leaving'?0:PHONE_BANNER_MS)+(calmBanner?140:300));
        return()=>{clearTimeout(leave);clearTimeout(done);};
    },[noticeId,paused]);
    // Taking the phone out never pauses AUTO or moves focus; only the reader's own open/close does. A sent line always
    // takes it out again (it has no banner), even after the reader put the phone away.
    const outgoing=phone?.source?.messages.some(row=>row.id===phone.source.current?.id && row.side==='out');
    // Leaving the run (or a sent line taking the phone out) forgets that the reader put it away.
    if (!phoneRun) phoneClosed.current=null;
    if (phone && phoneRun && phoneEntry?.requestedState==='compact' && (!userClosed || outgoing) && (!noticeId || noticePhase==='done') && phone.source?.messages.length) {
        context.state=reduceWidgetPresentation(context.state,{type:'open',key:phone.key});
        if (outgoing) phoneClosed.current=null;
    }
    const ordered=items.slice().sort((a,b)=>(context.state.entries.get(b.key)?.requestedState==='open')-(context.state.entries.get(a.key)?.requestedState==='open') || a.key.localeCompare(b.key));
    const placeScope=String(props.placeKey || props.sessionId || '');
    const occupied=[],layouts=new Map();let compacts=0;
    for (const item of ordered) {
        const entry=context.state.entries.get(item.key),declaration=item.definition.document.presentation;
        let state=entry.requestedState,bounds=null,surface='stage',fill=false,placed=false,phoneZoom=null,phoneBase=null,device=null;
        const headsUp=item.ref.modId==='dsh.phone' && state==='compact';
        // The reader's size and place for the phone on this device (phone-layout.js).
        const phoneLayout=item.ref.modId==='dsh.phone' && geometry && phonePrefs ? phonePrefs[phoneModPrefs.current(geometry.viewport.width)] : null;
        if(headsUp && (!noticeId || noticePhase==='done'))state='hidden';
        if (geometry && state!=='hidden') {
            const viewport=geometry.viewport;
            const fullPhone=item.ref.modId==='dsh.phone' && state==='open' && handheld;
            if (fullPhone) device={kind:'phone',safe:safeAreaInsets(props.rootRef.current)};
            // A phone the reader placed (long press or CONFIG) stays that stage phone even where the band above the box is too
            // small for it - then its 100% size is the sheet's (design: on a 1707x960 screen with a tall box the phone
            // only ever opened as the sheet, so the long press never reached adjust mode).
            if (state==='open' && (sheet===item.key && !(phoneLayout?.place && !fullPhone) || fullPhone)) {
                surface='sheet';const box=declaration.open;
                // Portrait or narrow phone: the view fills the reading area edge to edge (the bundle paints screen only). Elsewhere
                // the sheet keeps the declared proportions, centred on the dimmed stage.
                if (fullPhone || portrait && item.ref.modId!=='dsh.phone') {fill=true;bounds={x:viewport.x,y:viewport.y,width:Math.max(box.minWidth,viewport.width),height:Math.max(box.minHeight,viewport.height)};}
                else {
                    const size=stageWidgetSheetSize(viewport,box);
                    bounds={x:viewport.x+Math.max(8,(viewport.width-size.width)/2),y:viewport.y+Math.max(8,(viewport.height-size.height)/2),...size};
                    // The phone sheet is adjusted like the stage phone: its 100% is the sheet size, and the first gesture places it on stage.
                    if (phoneLayout) phoneBase={...size,size:phoneLayout.size,min:phoneModSizeMin(phoneModPrefs.current(viewport.width))};
                }
            }
            if(headsUp){
                // As wide as the phone's own screen at this stage size, at the top centre.
                const size=phoneModStageSize(geometry,declaration.open,phoneBand.current),zoom=size?.zoom || phoneModStageScale(viewport);
                const width=Math.min(viewport.width-24,size ? size.width-PHONE_BEZEL*zoom : PHONE_SCREEN*zoom),height=PHONE_BANNER_HEIGHT*zoom;
                bounds={x:viewport.x+(viewport.width-width)/2,y:viewport.y+10*zoom,width,height};phoneZoom=zoom;
            } else if (item.ref.modId==='dsh.phone' && state==='open' && !bounds) {
                // Centred between the top bar and the dialogue box, which stays readable underneath.
                const size=phoneModStageSize(geometry,declaration.open,phoneBand.current) || (phoneLayout?.place ? stageWidgetSheetSize(viewport,declaration.open) : null);
                if (size) {
                    // The reader's size (percent of that band size) and place on this device (phone-layout.js): a smaller phone
                    // stays centred in the band; one too tall for the band is centred on the stage; a dragged phone keeps its spot.
                    const layout=phoneLayout,scale=layout ? layout.size/100 : 1,ratio=declaration.open.aspectRatio || declaration.open.width/declaration.open.height;
                    let width=size.width*scale,height=size.height*scale;
                    if (width>viewport.width-2*STAGE_WIDGET_PLACE_PAD) {width=viewport.width-2*STAGE_WIDGET_PLACE_PAD;height=width/ratio;}
                    if (height>viewport.height-2*STAGE_WIDGET_PLACE_PAD) {height=viewport.height-2*STAGE_WIDGET_PLACE_PAD;width=height*ratio;}
                    let x=size.x+(size.width-width)/2,y=height>size.height ? viewport.y+(viewport.height-height)/2 : size.y+(size.height-height)/2;
                    if (layout?.place) {({x,y}=stageWidgetPlacePoint(viewport,{width,height},layout.place));placed=true;}
                    bounds={x,y,width,height};phoneZoom=Math.min(PHONE_MAX_ZOOM,Math.max(.7,width/declaration.open.width));phoneBase=layout ? {width:size.width,height:size.height,size:layout.size,min:phoneModSizeMin(phoneModPrefs.current(viewport.width))} : null;
                }
            }
            for (const candidate of state==='open' && !bounds ? (item.ref.modId==='dsh.phone' ? ['compact'] : ['open','compact']) : !bounds ? ['compact'] : []) {
                const box=declaration[candidate] || {width:220,height:44,minWidth:120,minHeight:44,anchor:'corner-right'};
                if (candidate==='compact' && compacts>=(viewport.width<700?1:3)) continue;
                const sizes=[false,true].map(small=>{
                    let width=small?box.minWidth:box.width,height=small?box.minHeight:box.height;
                    if (box.aspectRatio) {height=Math.max(height,width/box.aspectRatio);width=height*box.aspectRatio;}
                    return {width,height};
                });
                // The reader's own spot wins over automatic avoidance; it is only kept inside the stage.
                const saved=stageWidgetPlaces.get(placeScope,item.key,candidate),fits=sizes.find(size=>size.width+2*STAGE_WIDGET_PLACE_PAD<=viewport.width && size.height+2*STAGE_WIDGET_PLACE_PAD<=viewport.height);
                if (saved && fits) {bounds={...stageWidgetPlacePoint(viewport,fits,saved),...fits};state=candidate;placed=true;break;}
                const obstacles=[...geometry.blocked,...(candidate==='open' && item.source?.current ? [] : geometry.caption),...occupied];
                for (const size of sizes) {
                    bounds=stageWidgetSourcePlace({...geometry,blocked:obstacles,size,previous:lastPositions.current.get(item.key),anchor:box.anchor});
                    if (bounds) {state=candidate;break;}
                }
                if (bounds) break;
            }
            if (!bounds) state='hidden';
        } else state='hidden';
        const banner=headsUp && state==='compact' ? noticePhase==='leaving' ? 'leaving' : 'in' : null;
        if (state==='compact') compacts++;
        if (bounds) {if (surface==='stage') lastPositions.current.set(item.key,bounds);occupied.push({...bounds,height:bounds.height+8});}
        const suspended=paused || item.checking || state==='hidden' || state==='compact' && !declaration.compact;
        const reducedMotion=props.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
        const presentation={state,bounds:{width:bounds?.width || declaration.open.width,height:bounds?.height || declaration.open.height},surface,...(device ? {device} : {}),pinned:entry.pinned,attention:stageWidgetAttention(entry,cursor),suspended,
            reducedMotion,transitionMs:props.mode!=='live' || paused || state!==entry.requestedState ? 0 : reducedMotion ? 100 : 160};
        const isReady=ready[item.identity]===true && !failed[item.identity];
        // a settled history page replays the line its own mark puts on this page, when the
        // dwell replays a kind this widget's mod owns (props.replays, stageHistoryModPlays): the widget hears its current message
        // as a fresh event under the dwell's key, once (replay = that message id; the widget decides what sounds, e.g. the phone's
        // incoming tone).
        const replay=item.source?.current && item.ref.modId && item.event?.para===cursor.para ? (props.replays || []).find(row=>row.kind.startsWith(item.ref.modId+'.')) : null;
        const eventToken=replay ? replay.key : item.event?.token;
        // One audio event is one arrival of the event on the reader's page: reading the same line again later (after a 履历
        // jump or paging back) is a new arrival, which the widget and the media owner hear under its own playback token.
        let audio=audioEvents.current.get(item.key);
        if (!audio || audio.token!==eventToken) {context.arrival=(context.arrival || 0)+1;audio={token:eventToken,arrival:eventToken ? eventToken+'#'+context.arrival : eventToken,identity:item.identity,replay:replay ? item.source.current.id : null,fresh:Boolean(!suspended && (replay || entry.pending.some(event=>event.token===eventToken)))};audioEvents.current.set(item.key,audio);}
        if (suspended || props.skipping || audio.identity!==item.identity) audio.fresh=false;
        const playback={mode:props.mode,paused:suspended,eventToken:audio.arrival,fresh:audio.fresh,...(audio.replay ? {replay:audio.replay} : {})};
        // The open stage phone can be adjusted directly (phone-layout.js usePhoneAdjust): phoneBase is its 100% band size
        // and the reader's size percent; unlocked is the one adjust state (CONFIG 「解锁手机位置」 or a long press).
        const adjustable=Boolean(phoneBase && state==='open' && !fill);
        layouts.set(item.key,{...item,presentation,bounds,fill,placed,isReady,failed:failed[item.identity],requestedState:entry.requestedState,playback,banner,phoneZoom,
            phoneBase:adjustable ? phoneBase : null,unlocked:Boolean(adjustable && phonePrefs.unlocked)});
    }
    // The faces follow the open phone's widest width (stageWidgetFacePx): a larger phone or the full-bleed sheet redraws them.
    const phoneShownWidth=[...layouts.values()].find(layout=>layout.ref.modId==='dsh.phone' && layout.presentation.state==='open')?.presentation.bounds.width || 0;
    React.useEffect(()=>{if (phoneShownWidth>phoneFaceWidth) setPhoneFaceWidth(phoneShownWidth);},[phoneShownWidth]);
    // A drag or arrow key stores the reader's spot for this view; a null point forgets the widget's spots (reset).
    const place=(key,view,point)=>{
        const layout=layouts.get(key);
        // The phone's spot is a device preference per layout (phone-layout.js), not a card's.
        if (layout?.ref.modId==='dsh.phone' && phonePrefs) {
            if (!point) phoneModPrefs.update(phoneModPrefs.current(geometry?.viewport.width),{place:null});
            else if (geometry && layout.bounds && layout.presentation.surface==='stage') phoneModPrefs.update(phoneModPrefs.current(geometry.viewport.width),{place:stageWidgetPlaceFraction(geometry.viewport,layout.bounds,point)});
            return;
        }
        if (!point) {stageWidgetPlaces.set(placeScope,key,null,null);lastPositions.current.delete(key);}
        else if (geometry && layout?.bounds && layout.presentation.surface==='stage') stageWidgetPlaces.set(placeScope,key,view,stageWidgetPlaceFraction(geometry.viewport,layout.bounds,point));
        else return;
        redraw(n=>n+1);
    };
    const clampPlace=(key,point)=>{const box=layouts.get(key)?.bounds;return geometry && box ? stageWidgetPlacePoint(geometry.viewport,box,stageWidgetPlaceFraction(geometry.viewport,box,point)) : point;};
    // The phone's direct adjust (phone-layout.js): the one unlocked state, and a size percent with, when the phone moved,
    // its new rect (stage units) stored as the place for that size; without a rect an unplaced phone stays centred in its band.
    const adjust=on=>{if (phonePrefs && phonePrefs.unlocked!==on) phoneModPrefs.set({unlocked:on});};
    const resize=(key,size,rect)=>{
        if (!phonePrefs || !geometry || layouts.get(key)?.ref.modId!=='dsh.phone') return;
        phoneModPrefs.update(phoneModPrefs.current(geometry.viewport.width),{size,...(rect ? {place:stageWidgetPlaceFraction(geometry.viewport,rect,rect)} : {})});
    };
    // Moving an existing iframe DOM node reloads its browsing context; allocation priority must not reorder mounts.
    const projected=[...layouts.values()].sort((a,b)=>a.key.localeCompare(b.key));
    useWidgetVariables(props,projected);
    useWidgetSettingImages(projected);
    useWidgetSettingsFeedback(props,projected,context);
    const phoneBeat=projected.some(item=>item.ref.modId==='dsh.phone' && item.source?.current);
    // phone lines are read in the phone (or its banner) while the dialogue box stays up with
    // the last line from outside the phone; only a failed phone gives its line back to the box.
    const phoneLine=projected.some(item=>item.ref.modId==='dsh.phone' && item.source?.current && !item.failed);
    const phoneOpen=!paused && projected.some(item=>item.ref.modId==='dsh.phone' && item.presentation.state==='open' && item.presentation.surface==='stage' && !item.failed);
    // a phone the reader moved off its default spot is read
    // alongside the story, so the stage is not shaded behind it (gal-scene.js phoneShade); the default spot keeps the shade.
    const phoneShade=phoneOpen && !projected.some(item=>item.ref.modId==='dsh.phone' && item.phoneBase && item.placed);
    // The phone is in hand (asked open, before its place is measured): a skin's boxless narration then takes its image band
    // under the phone, as under a shown picture, instead of the centre the phone needs (2026-10-21 「阅读」 chip).
    const phoneHeld=!paused && projected.some(item=>item.ref.modId==='dsh.phone' && item.requestedState==='open' && !item.failed);
    const claimed=projected.find(item=>item.source?.current && item.ref.modId!=='dsh.phone' && item.presentation.state==='open' && !item.presentation.suspended && item.isReady && !item.checking);
    // an open overlay that owns scroll input — a sheet (modal reader)
    // or a held mod device (the phone, which dims the stage behind it). While one is open the stage's wheel gestures (up =
    // 履历, down = next page) stand down; a wheel that lands on the stage around it scrolls that overlay's view instead.
    const scrollOwner=paused ? null : projected.find(item=>item.presentation.state==='open' && !item.failed && (item.presentation.surface==='sheet' || item.modSource)) || null;
    React.useLayoutEffect(()=>{
        let changed=false;
        for (const item of projected) {
            if (!item.isReady || item.presentation.suspended || item.presentation.state!=='open') continue;
            const entry=context.state.entries.get(item.key);
            const tokens=item.source ? entry.pending.filter(event=>item.source.messages.some(row=>row.turn===event.turn && row.para===event.para && row.revealed)).map(event=>event.token) : [];
            if (!tokens.length && (!entry.changed || entry.changed!==item.event?.token)) continue;
            context.state=reduceWidgetPresentation(context.state,{type:'presented',key:item.key,ready:true,effectiveState:'open',tokens,version:item.event?.token});changed=true;
        }
        if (changed) redraw(n=>n+1);
    });
    return {items:projected,readingKey,claim:Boolean(claimed),phoneBeat,phoneLine,phoneOpen,phoneShade,phoneHeld,paused,scrollOwner:scrollOwner?.key || null,
        scroll:event=>{if (scrollOwner && !closed) sandbox.scroll(scrollOwner.identity,event.deltaY,event.deltaMode);},viewport:geometry?.viewport,narrow:geometry?.viewport.width<700,portrait,action,place,clampPlace,adjust,resize,openKey:projected.find(item=>item.requestedState==='open')?.key,
        onVisible:value=>setVisible(old=>old.key===readingKey && old.text===value ? old : {key:readingKey,text:value}),
        onReady:(identity,value)=>setReady(old=>old[identity]===value?old:{...old,[identity]:value}),onFailure:identity=>setFailed(old=>({...old,[identity]:true}))};
}

// One ephemeral snapshot on the existing session owner, shared by the card renderer; never persisted.
function useWidgetSettingsFeedback(props,items,context) {
    const snapshot={sessionId:props.sessionId,turn:props.turn,page:props.page,items:items.map(item=>({ref:item.ref,
        signature:JSON.stringify([item.definition.settingsDefaults || {},item.definition.settingsOverride?.settings || {},item.definition.settingsOverride?.bindings || {}]),
        fields:item.settingsFeedback, snapshot:item.settingsSnapshot, suspended:item.presentation.suspended}))};
    React.useLayoutEffect(()=>{
        const root=props.rootRef.current;
        const publish=()=>{context.settingsFeedback={...snapshot,theme:sandbox.theme(root)};document.dispatchEvent(new CustomEvent('widget-settings-feedback',{detail:{sessionId:props.sessionId}}));};
        publish();root?.addEventListener('widget-theme',publish);
        return()=>{root?.removeEventListener('widget-theme',publish);context.settingsFeedback=null;document.dispatchEvent(new CustomEvent('widget-settings-feedback',{detail:{sessionId:props.sessionId}}));};
    },[context,props.rootRef,JSON.stringify(snapshot)]);
}
// Committed signals wake bounded reads; navigation clears values synchronously, never by polling.
function useWidgetVariables(props,items) {
    const owner=React.useRef(null), [values,setValues]=React.useState({key:'',items:{}});
    if (!owner.current) owner.current={id:crypto.randomUUID(),epoch:0,key:'',busy:new Map(),requests:new Map(),proposals:new Map()};
    const state=owner.current, hasReads=item=>item.definition.document.variables || Object.keys(item.definition.settingsOverride?.bindings || {}).length,
        active=items.filter(item=>hasReads(item) && !item.presentation.suspended);
    const key=JSON.stringify([props.sessionId,props.source,props.turn,props.page,props.revealed,props.mode,active.map(item=>[item.identity,item.presentation.state,item.definition.settingsOverride,item.definition.settingsDefaults])]);
    if (state.key!==key) {state.key=key;state.epoch++;}
    const epoch=state.epoch, view={sessionId:props.sessionId,viewId:state.id,viewEpoch:epoch};
    const call=(method,args)=>invoke(props.variableRpc || rpc,method,args,args.sessionId || props.sessionId);
    React.useLayoutEffect(()=>{
        if (!active.length) return;
        let live=true,timer=null,dirty=false,last=0;
        const busy=()=>[...state.busy.values()].some(work=>work.sessionId===props.sessionId);
        const refresh=()=>{
            dirty=true;
            if (!live || busy() || timer) return;
            timer=setTimeout(async()=>{
                timer=null;if(!live || busy())return;dirty=false;last=performance.now();
                const next={};
                const coordinate=props.record?.pageIndex?.pages?.[props.page];
                for (const item of active) {
                    const input={...view,turn:props.turn,at:props.pages[props.page]?.para,expectedDirectionToken:props.record?.token,
                        page:coordinate ? {version:1,index:coordinate.page,para:coordinate.para,offset:coordinate.offset} : undefined,
                        ref:item.ref,identity:item.definition.contentIdentity,revealed:props.revealed===true,live:props.mode==='live'};
                    const result=await call('readWidgetVariables',input).catch(()=>null);
                    if (!live || state.epoch!==epoch)return;
                    next[item.identity]=result || {status:'unavailable',reason:'unavailable'};
                }
                if(live && !busy())setValues({key,items:next});
                if(dirty)refresh();
            },Math.max(0,200-(performance.now()-last)));
        };
        state.refresh=refresh;refresh();
        const stop=typeof tavernSessionSignals!=='undefined' ? tavernSessionSignals.subscribe(props.sessionId,'tavern-state',refresh,refresh,refresh) : ()=>{};
        return()=>{live=false;clearTimeout(timer);stop();if(state.refresh===refresh)state.refresh=null;
            void call('invalidateWidgetVariables',{...view,active:false}).then(async()=>{
                for(const [operationId,input] of state.busy) if(input.sessionId===view.sessionId) {
                    const result=await call('widgetVariableStatus',{...input,operationId}).catch(()=>({status:'unknown'}));
                    if(!['running','unknown'].includes(result.status))state.busy.delete(operationId);
                }
            }).catch(()=>{});};
    },[key]);
    for (const item of items) {
        item.settings={...(item.definition.settings || {})};
        item.settingsFeedback={...item.definition.settingsFeedback};
        const response=values.key===key ? values.items[item.identity] : null;
        item.settingsSnapshot=response?.snapshot || {kind:'unavailable',turn:null};
        for (const field of Object.keys(item.definition.settingsOverride?.bindings || {})) {
            if (response?.settings && Object.hasOwn(response.settings,field)) item.settings[field]=response.settings[field];
            item.settingsFeedback[field]=response?.settingsFeedback?.[field] || {value:item.settings[field],source:'binding',status:item.presentation.suspended?'suspended':response?.reason || 'loading'};
        }
        if (!item.definition.document.variables)continue;
        const projection=response?.contextKey && Object.fromEntries(Object.entries(response).filter(([name])=>!['settings','settingsDiagnostics','settingsFeedback'].includes(name)));
        item.variables=projection || {
            contextKey:'loading:'+state.id+':'+epoch,revision:'',sequence:0,position:{turn:props.turn,swipeId:0},snapshot:{kind:'unavailable',turn:null},
            settlement:'idle',writable:{allowed:false,reason:'loading'},values:Object.fromEntries(Object.keys(item.definition.document.variables.reads || {}).map(id=>[id,{status:'unavailable'}]))};
        item.onVariableRequest=async request=>{
            const input={sessionId:props.sessionId,ref:item.ref,identity:item.definition.contentIdentity};
            if(state.epoch!==epoch || item.presentation.suspended)return {status:'cancelled',reason:'position-changed'};
            if(request.type==='variables.status') {
                const previous=state.requests.get(request.operationId);
                if(previous?.mount!==item.identity)return {status:'unknown'};
                const result=await call('widgetVariableStatus',{...previous.input,operationId:request.operationId});
                if(!['running','unknown'].includes(result.status)){state.busy.delete(request.operationId);state.refresh?.();}
                return result;
            }
            const requestKey=item.identity+':'+request.requestId,digest=JSON.stringify([request.contextKey,request.revision,request.operations]),previous=state.proposals.get(requestKey);
            if(previous)return previous.digest===digest ? call('widgetVariableStatus',{...state.requests.get(previous.operationId)?.input,operationId:previous.operationId}) : {status:'rejected',reason:'request-id-reused'};
            if([...state.busy.values()].some(work=>work.sessionId===props.sessionId))return {status:'rejected',reason:'operation-pending'};
            const operationId=crypto.randomUUID(),query={...input,contextKey:request.contextKey,revision:request.revision};
            state.requests.set(operationId,{mount:item.identity,input:query});state.busy.set(operationId,query);
            state.proposals.set(requestKey,{digest,operationId});while(state.proposals.size>16)state.proposals.delete(state.proposals.keys().next().value);
            while(state.requests.size>16)state.requests.delete(state.requests.keys().next().value);
            let result;
            try { result=await call('proposeWidgetVariables',{...input,operationId,contextKey:request.contextKey,revision:request.revision,operations:request.operations}); }
            catch { result=await call('widgetVariableStatus',{...query,operationId}).catch(()=>({status:'unknown',operationId})); }
            if(!['running','unknown'].includes(result.status))state.busy.delete(operationId);
            // Let the bridge publish the receipt before the committed projection replaces its revision.
            setTimeout(()=>state.refresh?.(),0);
            return result;
        };
    }
}

return {useStage:useWidgetStage,usePhoneSettings,useFaces:useCardFaces,dispose(){if(closed)return;closed=true;clean([...owned].reverse().concat([...timers.values(),...frames.values(),...idles.values()],()=>{timers.clear();frames.clear();idles.clear();safeAreaProbe?.remove();safeAreaProbe=null;stageWidgetThumbs.clear();cardFaceJobs.clear();}));}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSourceWidgets};
