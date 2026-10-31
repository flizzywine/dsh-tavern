function createStageTextIndexModule({pageCards,character}) {

// Host paragraphs are the only text input. The client only lays out reading cards.
function createStageTextIndex({paginate, storyTurn, superseded, projectionForTurn}) {
    let snapshot = new Map(), bodies = new Map(), activeBranch, activeHistory, revision = 0;
    function rowFor(turn, nativeTurn, body, old, unloaded) {
        if (old && old.body === body && old.nativeTurn === nativeTurn && old.unloaded === unloaded) return old;
        const units = [], pages = [];
        for (const paragraph of body?.paragraphs || []) {
            const unit = {...paragraph, voiceLine:[nativeTurn,paragraph.para - 1]};
            units.push(unit);
            const before = old?.units[units.length - 1];
            const same = before && JSON.stringify(paragraph) === JSON.stringify(old.body.paragraphs[units.length - 1]);
            unit.cards = same ? before.cards : pageCards(unit,paginate).map(({text,offset},n,all) => ({
                kind:unit.kind,text,alias:unit.alias,name:unit.name,mood:unit.mood,thought:unit.thought,
                pending:unit.pending && n === all.length - 1,voice:stageVoiceDescriptor(unit,undefined,{text,offset}),
                anchor:{paragraphId:unit.paragraphId,para:unit.para,offset}}));
            pages.push(...unit.cards);
        }
        const parts = [{scope:JSON.stringify([activeBranch,turn]),turn,nativeTurn,index:0,order:0,projected:true,streaming:!!body?.streaming,
            units,segments:units.map(unit => unit.segment),localPages:pages}];
        return {turn,nativeTurn,body,unloaded,parts,units,text:{revision:++revision,streaming:!!body?.streaming,pages,
            hasReadableText:pages.some(page => page.text.length > 0),
            units:units.map(unit => ({...unit.source,para:unit.para,paragraphId:unit.paragraphId}))}};
    }
    function reconcile({chat,view,branchId}) {
        const history = JSON.stringify(view?.regeneratedDshTurns || null);
        if (activeBranch !== branchId || activeHistory !== history) {
            bodies.clear(); snapshot = new Map(); activeBranch = branchId; activeHistory = history;
        }
        const represented = new Map(), running = new Set();
        for (const node of chat?.nodes?.values() || []) {
            if (node.kind !== 'assistant-step' || /^tavern-seed-trajectory:v1:.+:2$/.test(String(node.data.finalNode?.messageId || ''))) continue;
            const nativeTurn = Number(node.location?.turn?.turn) || 0, turn = storyTurn(view,nativeTurn);
            if (!superseded(view,nativeTurn,turn)) {
                represented.set(turn,nativeTurn);
                if (node.data.status === 'running') running.add(turn);
            }
        }
        for (const projection of view?.replyProjections || []) {
            const turn = Number(projection.turn), nativeTurn = Number(view?.regeneratedDshTurns?.[turn]) || turn;
            if (!superseded(view,nativeTurn,turn)) represented.set(turn,nativeTurn);
        }
        const next = new Map();
        for (const [turn,nativeTurn] of represented) {
            const projected = projectionForTurn(view,turn)?.body;
            const body = running.has(turn) ? (bodies.get(turn) || (projected?.streaming ? projected : null)) : projected || bodies.get(turn);
            next.set(turn,rowFor(turn,nativeTurn,body,snapshot.get(turn),!body));
        }
        if (next.size !== snapshot.size || [...next].some(([turn,row]) => snapshot.get(turn) !== row)) snapshot = next;
        return snapshot;
    }
    function ingest(turn,body) {
        const row = snapshot.get(turn);
        if (!row || !body) return null;
        bodies.delete(turn); bodies.set(turn,body);
        while (bodies.size > 200) bodies.delete(bodies.keys().next().value);
        const value = rowFor(turn,row.nativeTurn,body,row,false);
        snapshot = new Map(snapshot).set(turn,value);
        return value;
    }
    return {reconcile,ingest,touch(turn) {const body=bodies.get(turn);if(body){bodies.delete(turn);bodies.set(turn,body);}},
        getSnapshot:()=>snapshot,clear() {bodies.clear();snapshot=new Map();activeBranch=undefined;}};
}

// 旁白配音: every host narration unit (not a bubble, so never a thought) reads card by card - the text the
// reader sees on that page, Markdown already stripped by the host. Whether it speaks is the handle's (config.narrator).
function stageVoiceDescriptor(unit, settings, card) {
    if (unit.kind === 'narration') return card && !unit.pending && /[\p{L}\p{N}]/u.test(card.text)
        ? {narration:true, paragraphId:unit.paragraphId, lineIdentity:[...unit.voiceLine, card.offset], text:card.text} : null;
    if (unit.kind !== 'line' || unit.pending || !unit.segment) return null;
    const segment = unit.segment;
    return {paragraphId: unit.paragraphId, lineIdentity:unit.voiceLine, alias: segment.alias, name: segment.name, mood: segment.mood,
        text: segment.text, speech: segment.speech, singleVoiceText: segment.singleVoiceText, thought: !!segment.thought,
        cardPath: settings?.cardPath || '', character: character(settings?.config,segment) || null};
}

return {createIndex:createStageTextIndex,voiceDescriptor:stageVoiceDescriptor};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageTextIndexModule};
