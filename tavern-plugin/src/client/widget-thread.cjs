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
const phoneModProtocol=()=>typeof phoneModOwnership!=='undefined' ? {phoneModDirect,phoneModOwnership} : require('../../mods/phone/stage-phone.cjs');
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
    const resolver=typeof figureResolution!=='undefined' ? figureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs');
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
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={stageWidgetThread,stageWidgetTextPrefix,sourceMark,phoneModGroups,phoneModReadKey,phoneModReadOwner};
