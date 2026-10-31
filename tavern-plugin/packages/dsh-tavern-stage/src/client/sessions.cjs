// Plugin activation owns session assembly, resources and debug registrations.
function createStageSessions({views,navigation,clock,window,document,startLifetime,textIndex}) {
let closed=false,stop=null;
const sessions = {
    owner: null,
    resourceOwner: null,
    get(sessionId) { return this.owner?.get(sessionId) || null; },
    start(inputs) {
        if(closed)throw new Error('Stage sessions disposed');
        if(stop)throw new Error('Stage sessions already started');
        const {native,io,assets,dialogue,preferences,text,performance,observation}=inputs;
        stop=startLifetime(({own}) => {
        const resourceOwner = assets.createOwner({service:assets.service,decode:assets.decode});
        this.resourceOwner = resourceOwner;
        own(() => { if (this.resourceOwner === resourceOwner) this.resourceOwner = null; });
        own(() => resourceOwner.dispose());
        const resourceDebug = {readiness:() => {
            const sessionId = native.selectedSessionId() || null;
            return {sessionId,viewPhase:sessionId ? native.views.getSnapshot(sessionId).phase : null};
        }, read:(method,args,signal) => {
            if (!['getStageDirection','getDialogueBubbles','getAssetPackPresentation'].includes(method)) throw new Error('Unsupported read-only probe method');
            return io.probe(method,{...args,readOnly:true},signal);
        }, firstPage:(config,body) => {
            const paragraph = body?.paragraphs.find(row => text.pageCards(row).length);
            if (!paragraph) return null;
            const character = dialogue.character(config,paragraph);
            return {page:{index:0,para:paragraph.para,offset:text.pageCards(paragraph)[0].offset,
                kind:paragraph.kind,speaker:character?.alias || null},
                portrait:dialogue.media(character,paragraph.mood,dialogue.moods(config,character?.alias))};
        }, bubbleResources:config => {
            const state = this.get(native.selectedSessionId())?.getSnapshot();
            return (state?.text.pages || []).filter(page => page.kind === 'line').map(page => {
                const character = dialogue.character(config,page);
                return dialogue.media(character,page.mood,dialogue.moods(config,character?.alias));
            }).filter(Boolean);
        }, snapshot:() => ({...resourceOwner.debug(), runtime: (() => {
            const state = this.get(native.selectedSessionId())?.getSnapshot();
            const pageIndex = state?.text.pages.findIndex(page => page.anchor?.para === state.cursor.anchor?.para && page.anchor?.offset === state.cursor.anchor?.offset);
            const page = pageIndex >= 0 ? state.text.pages[pageIndex] : null;
            return state ? {source:state.source, visible:state.visible, opened:state.opened, cursor:state.cursor,
                page:page ? {index:pageIndex,para:page.anchor.para,offset:page.anchor.offset,kind:page.kind,speaker:dialogue.character(state.settings?.config,page)?.alias || null,
                    portrait:dialogue.media(dialogue.character(state.settings?.config,page),page.mood,dialogue.moods(state.settings?.config,dialogue.character(state.settings?.config,page)?.alias))} : null,
                pending:state.pending, projection:state.projection, director:state.director, lookahead:resources.lookahead(state.source?.sessionId),
                // what the stage shows, for stage capture; a figure is drawn from local bytes.
                accepted:{background:!!state.accepted.scene?.background, skin:!!state.accepted.scene?.skin,
                    figures:(state.accepted.figures || []).map(figure => ({alias:figure.alias, form:figure.form, drawn:/"(?:blob|data):/.test(JSON.stringify(figure))}))},
                observation:state.observation, text:{revision:state.text.revision,
                    streaming:state.text.streaming, units:state.text.units?.length ?? 0, pages:state.text.pages.length}} : null;
        })()})};
        window.forkStageResourceDebug = resourceDebug;
        own(() => { if (window.forkStageResourceDebug === resourceDebug) delete window.forkStageResourceDebug; });
        const connection = views.sessionRuntime.createConnection({resources:{
            foreground:clock,
            resolveSpeaker:(state,page) => dialogue.character(state.settings?.config,page)?.alias,
            async idle(id,current) {
                // Speculation must not compete with model upload or the atomic entry reveal.
                while (current()) {
                    const root = document.querySelector('.fork-gal-stage');
                    if (!root || native.selectedSessionId() !== id) return false;
                    if (root.dataset.entry === 'ready') {
                        await new Promise(resolve => typeof requestIdleCallback === 'function' ? requestIdleCallback(resolve) : setTimeout(resolve,0));
                        return current();
                    }
                    await new Promise(resolve => setTimeout(resolve,100));
                }
                return false;
            },
            preparePerformance:performance.prepare,
            music:() => views.bgm,
            read:io.presentation,
            progress: views.progress.store,
            owner: resourceOwner
        },direction:{read:io.direction,watch:io.watch},notifications:io.notifications,session:{
            ...native, readBody:io.body, opened:false, visible:()=>!document.hidden, preferences,
            createIndex:()=>textIndex.createIndex({paginate:text.paginate,projectionForTurn:native.projectionForTurn,storyTurn:native.storyTurn,superseded:native.superseded})
        },observation:{...observation,document,resourceOwner,
            selection:{current:native.selectedSessionId,list:native.sessions.list},settings:native.settings,
            entry:{shown:views.admission.shown,hasDisplay:()=>!!document.querySelector('.fork-gal-stage'),entering:()=>!!navigation.galEntering.get()}
        },waitForEntry:(store,source)=>views.admission.shown.wait(store,()=>native.selectedSessionId()===source.sessionId&&!!document.querySelector('.fork-gal-stage'))});
        const {owner,resources}=connection;
        own(() => connection.dispose());
        this.owner = owner;
        own(() => { if (this.owner === owner) this.owner = null; });
        connection.start();

        });
    },
    dispose(){if(closed)return;closed=true;const release=stop;stop=null;release?.();}
};
return sessions;
}

if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSessions};
