function createStageBacklogRows({voiceDescriptor:stageVoiceDescriptor, registry:createStagePerformanceRegistry, core:STAGE_PERFORMANCE_CORE, textcard:textcardHistory, pointer:stagePerformancePointer}) {
function galUserText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map(block => block && block.type === "text" ? String(block.text || "") : "").join("");
}
// The player's message of each turn from the Chat snapshot's nodes (legacy.nodes): a user node belongs
// to the next assistant reply (which carries the DSH turn). storyTurnOf maps a DSH turn to the story
// turn the stage uses; sourceOf(dshTurn) gives the host's edited / template source when there is one.
function galPlayerInputs(nodes, storyTurnOf, sourceOf) {
    const out = {};
    let pending = null;
    (Array.isArray(nodes) ? nodes : []).forEach(function (node) {
        if (!node) return;
        if (node.kind === "user") { pending = galUserText(node.content); return; }
        if (node.kind !== "assistant" || pending === null) return;
        const dsh = Number(node.turn) || 0;
        const text = pending;
        pending = null;
        if (!dsh || /^tavern-seed-trajectory:/.test(String(node.messageId || ""))) return;
        const source = sourceOf ? sourceOf(dsh) : null;
        const shown = String(source == null ? text : source).trim();
        if (shown) out[storyTurnOf ? storyTurnOf(dsh) : dsh] = shown;
    });
    return out;
}
// Prefix offsets include estimated heights for unvisited rows; measured rows replace them.
function galBacklogWindow(offsets, scrollTop, height, overscan) {
    const count = offsets.length - 1;
    if (count <= 0) return { start: 0, end: 0 };
    const top = Math.max(0, Math.min(scrollTop, Math.max(0, offsets[count] - height)));
    function at(value) {
        let lo = 0, hi = count;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (offsets[mid + 1] <= value) lo = mid + 1; else hi = mid; }
        return lo;
    }
    return { start: Math.max(0, at(top) - overscan), end: Math.min(count, at(Math.max(top, top + height - 0.001)) + 1 + overscan) };
}

// immutable session paragraphs, with voice handles built only for visible rows.
function stageHistoryEntries(index,turn,pages,page,inputs) {
    const entries = [], turns = [...(index?.keys() || [])].filter(value => value <= turn);
    if (!turns.includes(turn)) turns.push(turn);
    for (const number of turns.sort((a,b) => a-b)) {
        const current = number === turn;
        entries.push({type:'turn',key:'t'+number,turn:number,current});
        if (inputs[number]) entries.push({type:'input',key:'i'+number,turn:number,text:inputs[number]});
        const rows = current ? pages.slice(0,page+1) : index.get(number).units || index.get(number).text.pages;
        rows.forEach((row,i) => entries.push({...row,type:'page',key:'p'+number+':'+i,turn:number,page:i,current,
            targetPara:current ? undefined : row.para || row.anchor.para, here:current && i === page,
            descriptor:current ? null : row.segment ? stageVoiceDescriptor(row) : row.voice,
            // a narration unit's pages each carry their own narrator voice (stageVoiceDescriptor)
            descriptors:!current && row.kind === 'narration' && row.cards ? row.cards.map(card => card.voice).filter(Boolean) : undefined,
            voice:current ? row.voice : null}));
    }
    return entries;
}

// ---------- Performance rows ----------
// Every stage performance kind is registered with its 履历 projection and replay declaration (stage-performance-kinds.cjs);
// one path turns a stored record into a row. kinds: the managed mods' declarations ({owner, performances}) from the host.
function backlogPerformanceRegistry(kinds) {
    return createStagePerformanceRegistry([{owner:'core',performances:STAGE_PERFORMANCE_CORE},...(kinds || [])]);
}
// The host-shipped projections a declaration names ({renderer}): record -> {tag, text | parts | roll, place}.
// place: 'before' its paragraph's first page, 'after' its first page, 'end' after its last page, 'lead' ahead of the round's text.
const BACKLOG_RENDERERS = {
    item(performance) {
        const item = performance.payload;
        // 获得 / 失去 as on the stage card; a plain show needs no word there, the row says 展示.
        return {tag:{gain:'获得',lose:'失去'}[item.action] || '展示', place:'after',
            text:item.name + (item.variantName ? ' · ' + item.variantName : '') + (item.action !== 'show' && item.count != null ? ' ×' + item.count : '')};
    },
    textcard(performance) {
        const card = textcardHistory(performance.payload);
        // Explicit placement survives pagination; unmarked historical cards still precede their paragraph.
        return card && {tag:card.tag, parts:card.parts, place:performance.payload.placement === 'after' ? 'end' : 'before'};
    },
    title: event => ({tag:'报幕', text:String(event.value), place:'before'}),
    dice: roll => ({roll, place:'lead'}),
};
// declaration: the registry entry; record: what the stage played; target: {turn, id} - the row's identity in its round.
function backlogPerformanceEntry(declaration, record, target) {
    if (!declaration || declaration.backlog.none || declaration.backlog.line) return null;
    const backlog = declaration.backlog;
    let row;
    if (backlog.renderer) row = BACKLOG_RENDERERS[backlog.renderer](record);
    else {
        const text = stagePerformancePointer(record.payload, backlog.row.text);
        row = typeof text === 'string' && text.trim() ? {tag:backlog.row.label, text, place:'after'} : null;
    }
    if (!row) return null;
    return {...row, type:'performance', role:backlog.role, kind:declaration.kind, key:'perf:' + target.turn + ':' + JSON.stringify(target.id), turn:target.turn};
}
// Mod performances (and core items) of each turn, plus the director's titles of the visible turns (directions: turn -> projected
// direction), placed by their paragraph; removed performances never reach this list.
function stageModHistoryEntries(entries,history,registry,directions) {
    const records = [];
    for (const {turn,performances} of history || []) for (const performance of performances)
        records.push({turn,at:performance.at,row:backlogPerformanceEntry(registry.get(performance.kind),performance,{turn,id:{performance:performance.id}})});
    for (const [turn,direction] of directions || []) for (const entry of direction?.entries || []) {
        if (!(entry.at <= direction.through)) continue;
        for (const event of entry.events || []) if (event.kind === 'title')
            records.push({turn,at:entry.at,row:backlogPerformanceEntry(registry.get('core.event.title'),event,{turn,id:{event:[entry.ordinal,event.ordinal]}})});
    }
    if (!records.some(record => record.row)) return entries;
    const after=new Map(),before=new Map();
    for (const {turn,at,row} of records) {
        if (!row) continue;
        const matches=item=>item.type==='page' && item.turn===turn && (item.para || item.anchor?.para || item.targetPara || item.page+1)===at;
        const index=row.place==='end' ? entries.findLastIndex(matches) : entries.findIndex(matches);
        if(index<0)continue;
        const target=row.place==='before' ? before : after;
        if(!target.has(index))target.set(index,[]);
        target.get(index).push(row);
    }
    return entries.flatMap((row,index)=>[...(before.get(index) || []),row,...(after.get(index) || [])]);
}

// the line kinds a mod declares with a
// mark command ({line:{label, command, voice?, icon?}}, stage-performance-kinds.cjs) - [{kind, label, icon, modId, command, voice}].
function backlogLineKinds(registry) {
    return registry ? registry.list().filter(row => row.backlog.line?.command).map(row => ({kind:row.kind, label:row.backlog.line.label, icon:row.backlog.line.icon, modId:row.owner, command:row.backlog.line.command, voice:row.backlog.line.voice})) : [];
}
// The line kind a director entry's accepted mark gives its paragraph (admission validated the mark; it is not read again here).
function backlogLineMark(direction, para, kinds) {
    if (!kinds.length || !direction || !['partial','done'].includes(direction.phase) || !(para <= direction.through)) return null;
    for (const entry of direction.entries || []) {
        if (entry.at !== para) continue;
        for (const op of entry.ops || []) {
            const kind = op.op === 'mod.command' && kinds.find(row => row.modId === op.modId && row.command === op.commandId);
            if (kind) return {kind, params:op.params || {}};
        }
    }
    return null;
}
// A marked story line is one 履历 row (its pages joined), tagged with its kind; it keeps its voice button only as the kind says.
function backlogLineKindEntries(entries,directions,kinds) {
    if (!kinds.length) return entries;
    const out=[],seen=new Map();
    for (const entry of entries) {
        const para=entry.para || entry.anchor?.para || entry.targetPara || entry.page+1;
        const mark=entry.type==='page' && entry.kind==='line' ? backlogLineMark(directions.get(entry.turn),para,kinds) : null;
        if (!mark) {out.push(entry);continue;}
        const key=JSON.stringify([entry.turn,para]),previous=seen.get(key);
        if (previous) {
            previous.text=previous.text.slice(0,entry.anchor?.offset ?? previous.text.length)+entry.text;
            previous.here=previous.here || entry.here;
            continue;
        }
        const voiced=!mark.kind.voice || stagePerformancePointer(mark.params,mark.kind.voice.when)===mark.kind.voice.is;
        const row={...entry,lineKind:{kind:mark.kind.kind,label:mark.kind.label,icon:mark.kind.icon},...(voiced?{}:{voice:null,descriptor:null})};
        seen.set(key,row);out.push(row);
    }
    return out;
}

// ---------- Entry roles ----------
// Every 履历 entry has one role from a fixed set; skins style roles, never kinds (stageSkinBacklog in stage-skin-adapter.cjs):
// divider (the round separator), player (the player's input), speech (a story line: spoken, inner monologue, a phone
// message), narration (a narration paragraph), notice (a registered performance's row - item, check, text card, title, a
// mod's row - by the role its kind declares, stage-performance-kinds.cjs).
function backlogRole(entry) {
    if (entry.type === 'turn') return 'divider';
    if (entry.type === 'input') return 'player';
    if (entry.type === 'performance') return entry.role;
    return entry.kind === 'line' ? 'speech' : 'narration';
}
// Without a skin (built-in themes, film mode, isolated fixtures): the list with today's rows.
return {galPlayerInputs,galBacklogWindow,stageHistoryEntries,backlogPerformanceRegistry,backlogPerformanceEntry,stageModHistoryEntries,backlogLineKinds,backlogLineKindEntries,backlogRole};
}
if(typeof module!=="undefined"&&typeof window==="undefined")module.exports={createStageBacklogRows};
