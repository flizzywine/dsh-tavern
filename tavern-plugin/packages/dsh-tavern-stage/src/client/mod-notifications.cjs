// Presentation policy belongs to the session runtime, not the host transport.
function createStageModNotifications({getSnapshot,send,browseMs,now=Date.now,report=()=>{}}){
    let closed=false;
    const notifications={modNotifications:new Map(),modPlans:new Map(),
    // the visible page and up to three settled pages after it, so audience reactions are
    // prepared for what the reader sees or is about to see, not an older story window. The visible page follows the
    // text.available rule (16 characters or settled); an upcoming page must be settled, so its text is final. Bounded:
    // 4 pages x 2000 UTF-16 units (the host contract).
    modPages(pages,anchor) {
        const at=pages.findIndex(row=>row.anchor.paragraphId===anchor?.paragraphId && row.anchor.offset===anchor?.offset);
        const current=pages[at];
        if(!current?.text.trim() || current.pending && current.text.length<16)return undefined;
        const plan=[];
        for(let index=at;index<pages.length && plan.length<4;index++) {
            const page=pages[index];
            if(index>at && (page.pending || !page.text.trim()))break;
            const text=(page.kind!=='narration' && page.name ? page.name+'：' : '')+page.text;
            plan.push({index,anchor:{paragraph:index===at?anchor.para:page.anchor.para,charOffset:page.anchor.offset},text:text.slice(0,2000)});
        }
        return plan;
    },
    // when each page was reached and whether the page turn before it was under
    // browseMs earlier (wheel / quick paging through history). Measured when the stage reports the turn, not when the
    // queued notification is sent; the host plays such a page's recorded danmaku only once the reader settles (its
    // HISTORY_SETTLE_MS, tavern-plugin/mods/danmaku/controller.js).
    modBrowse: new Map(),
    browseMs,
    browseKey(state) {
        const anchor=state?.cursor.anchor;
        return state?.source && anchor ? JSON.stringify([state.source.turn,anchor.paragraphId,anchor.offset]) : null;
    },
    notifyMod(sessionId,event,state,detail={},planOnly=false) {
        if(closed || !state?.source)return;
        const browseKey=this.browseKey(state),browsed=this.modBrowse.get(sessionId);
        if(browseKey && browsed?.key!==browseKey) {
            const at=now();
            this.modBrowse.set(sessionId,{key:browseKey,at,rapid:!!browsed && at-browsed.at<this.browseMs});
        }
        const task=(this.modNotifications.get(sessionId) || Promise.resolve()).then(()=>{
            if(closed && event!=='session.disposed')return;
            const latest=getSnapshot(sessionId);
            // Entry is an intent to show the current page, not a receipt for the old text snapshot.
            if(event==='stage.entered' || event==='text.available' || planOnly) {if(!latest?.source || !latest.opened || !latest.visible || latest.disposed)return;state=latest;}
            else if(event!=='session.disposed' && state.source!==latest?.source)return;
            const anchor=state.cursor.anchor;
            // Entry, page movement and visible text carry the plan; streaming that settles another upcoming page refreshes
            // it (as activity.changed: no new stimulus). An unchanged plan is not re-sent.
            const plan=anchor && ['stage.entered','page.changed','text.available','activity.changed'].includes(event) ? this.modPages(state.text?.pages || [],anchor) : undefined;
            const planKey=plan && JSON.stringify([state.source.sourceKey,plan.map(row=>[row.index,row.anchor])]);
            const sendPlan=plan && (event!=='activity.changed' || this.modPlans.get(sessionId)!==planKey);
            if(planOnly && !sendPlan)return;
            if(sendPlan)this.modPlans.set(sessionId,planKey);
            if(event==='session.disposed'){this.modPlans.delete(sessionId);this.modBrowse.delete(sessionId);}
            if(event==='text.available') {
                const page=state.text.pages.find(row=>row.anchor.paragraphId===anchor?.paragraphId && row.anchor.offset===anchor?.offset);
                if(!page?.text.trim())return;
                detail={revealed:{id:JSON.stringify([state.source.turn,anchor.paragraphId,anchor.offset]),text:page.text.slice(0,8000)}};
            }
            const displayToken=JSON.stringify([state.source.sourceKey,state.source.generation,state.source.branchId,state.source.authorityEpoch]);
            // A replay reads the round's stored mod records like history (no model is called); its client layers play them.
            // visit: each clip-export replay shows its pages anew, also the page already on screen when it starts.
            const input={sessionId,event,displayToken,active:!state.disposed && state.opened && state.visible,mode:state.cursor.mode === 'live' ? 'live' : 'history',turn:state.source.turn,
                ...(state.cursor.mode === 'replay' ? {visit:String(state.cursor.visitId)} : {}),
                ...(state.cursor.mode === 'history' && this.modBrowse.get(sessionId)?.key===this.browseKey(state) && this.modBrowse.get(sessionId).rapid ? {rapid:true} : {}),
                ...(anchor?{anchor:{paragraph:anchor.para,charOffset:anchor.offset}}:{}),...detail,...(sendPlan?{pages:plan}:{})};
            return send(input);
        })
            .catch(error=>{try{report(error);}catch(_){}});
        this.modNotifications.set(sessionId,task);
        void task.then(()=>{if(this.modNotifications.get(sessionId)===task)this.modNotifications.delete(sessionId);});
    },
    // a mod switched on or off, a mod-config write or a reconnect
    // gives the host a fresh mod session with no page plan, and a routine activity.changed omits the plan it already
    // sent — the room opened with nothing to react to until the next page turn. Re-announcing sends the plan again.
    reannounceMod(sessionId) {
        this.modPlans.delete(sessionId);
        this.notifyMod(sessionId,'activity.changed',getSnapshot(sessionId));
    },
    observe(id,event,previous,state){
                if(event.type==='DISPOSE'){this.notifyMod(id,'session.disposed',state);return;}
                if(!state.source){if(previous.source)this.notifyMod(id,'stage.left',{...previous,opened:false});return;}
                if(!previous.source || previous.opened!==state.opened)this.notifyMod(id,state.opened?'stage.entered':'stage.left',state);
                if(!previous.source || previous.visible!==state.visible || previous.cursor.mode!==state.cursor.mode)this.notifyMod(id,'activity.changed',state);
                const anchor=state.cursor.anchor,prior=previous.cursor.anchor;
                if(anchor && (anchor.paragraphId!==prior?.paragraphId || anchor.offset!==prior?.offset))
                    this.notifyMod(id,'page.changed',state,{anchor:{paragraph:anchor.para,charOffset:anchor.offset}});
                const page=state.text.pages.find(row=>row.anchor.paragraphId===anchor?.paragraphId && row.anchor.offset===anchor?.offset);
                const end=page && page.anchor.offset+page.text.length;
                const oldPage=previous.text.pages.find(row=>row.anchor.paragraphId===anchor?.paragraphId && row.anchor.offset===anchor?.offset);
                if(state.opened && page && (page.text.length>=16 || !page.pending) && (!previous.opened || previous.source?.turn!==state.source.turn || anchor?.paragraphId!==prior?.paragraphId || anchor?.offset!==prior?.offset || !(oldPage?.text.length>=16 || oldPage && !oldPage.pending)))
                    this.notifyMod(id,'text.available',state);
                if(state.opened && anchor && state.text!==previous.text)this.notifyMod(id,'activity.changed',state,{},true);
                if(event.type==='READ_PROGRESS' && page && !page.pending && previous.cursor.readThrough<end && state.cursor.readThrough>=end)
                    this.notifyMod(id,'text.revealed',state,{anchor:{paragraph:anchor.para,charOffset:page.anchor.offset},revealed:{id:JSON.stringify([state.source.sourceKey,anchor.paragraphId,page.anchor.offset,end]),text:page.text}});
            },
    dispose(){closed=true;this.modPlans.clear();this.modBrowse.clear();this.modNotifications.clear();}
    };
    return {presented(sessionId,detail){
        const state=getSnapshot(sessionId);
        if(closed||!state?.source||!state.opened||!state.visible||state.disposed)return;
        notifications.notifyMod(sessionId,'performance.presented',state,{performanceId:detail.performanceId,phase:detail.phase});
    },observe:notifications.observe.bind(notifications),reannounce:notifications.reannounceMod.bind(notifications),dispose:notifications.dispose.bind(notifications)};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageModNotifications};
