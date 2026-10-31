// Display-owned reading clocks. Session state stays authoritative; this scope only schedules actions.
function createStagePlayback({React,clock,player,subtitles:subtitlesApi,timing,handoffDelay,now=()=>Date.now(),historySettleMs=1000}) {
let disposed=false;
const scopes=new Set();
const STAGE_HISTORY_SETTLE_MS=historySettleMs,GAL_SKIP_PAGE_MS=150;
function schedule(callback,ms,repeating){
    if(disposed)return ()=>{};
    let active=true;
    const cancel=()=>{if(!active)return;active=false;scopes.delete(cancel);if(repeating)clock.clearInterval(id);else clock.clearTimeout(id);};
    const run=()=>{if(!active||disposed)return;if(!repeating){active=false;scopes.delete(cancel);}callback();};
    const id=repeating?clock.setInterval(run,ms):clock.setTimeout(run,ms);
    scopes.add(cancel);return cancel;
}
const timeout=(callback,ms)=>schedule(callback,ms,false),interval=(callback,ms)=>schedule(callback,ms,true);
function subscribeAudio(listener){
    if(disposed)return ()=>{};
    const stop=clock.subscribeAudio(()=>{if(!disposed)listener();});let active=true;
    const release=()=>{if(!active)return;active=false;scopes.delete(release);stop();};
    scopes.add(release);return release;
}
function useEffect(setup,deps){React.useEffect(()=>disposed?undefined:setup(),deps);}
function usePlayback(frame,{advance,finishSkip,finishTyping}){
    const {sessionId,runtime,reading,auto,skipping,hidden,overlay,typed,current,atEnd,awaiting,sceneHolding,line,performance}=frame;
    const {turn,page,card,inputCard,transitioning,subtitles,inputSubtitles,lastCard,voice,audioBusy,heldMs,film,pageCount}=line;
    const dialogueHeld=performance.dialogueHeld,presentationBusy=performance.busy;
    const pages={length:pageCount};
    // a history page the reader settles on plays its own
    // one-shots (the runtime's HISTORY_DWELL: projection only, no write, no consumption) - shortly after a jump or a single
    // page turn, and only 1 s after the last turn while paging continuously (the danmaku history rule, danmaku-streaming.md
    // 生命周期). A page left earlier plays nothing; what plays is cut with its page. Overlays (the text-only 履历 included),
    // skip and a restored page (still) never play.
    const replayableKinds = performance.replayable;
    const dwellPageKey = runtime.cursor.anchor ? JSON.stringify([sessionId,runtime.cursor.visitId, runtime.cursor.anchor.paragraphId, runtime.cursor.anchor.offset]) : '';
    const pageTurned = React.useRef({key: '', at: 0, rapid: false});
    React.useLayoutEffect(() => {
        if (!dwellPageKey || pageTurned.current.key === dwellPageKey) return;
        const at = now();
        pageTurned.current = {key: dwellPageKey, at, rapid: at - pageTurned.current.at < STAGE_HISTORY_SETTLE_MS};
    }, [dwellPageKey]);
    const dwellBlocked = runtime.cursor.mode !== 'history' || runtime.cursor.still || !!runtime.cursor.dwell || !replayableKinds ||
        skipping || overlay || hidden;
    useEffect(() => {
        if (dwellBlocked) return;
        // A landing waits a moment for the closing overlay and the page's projection; continuous paging waits the full dwell.
        const {visitId, anchor} = runtime.cursor, turned = pageTurned.current;
        const delay = Math.max(0, turned.at + (turned.rapid ? STAGE_HISTORY_SETTLE_MS : 250) - now());
        return timeout(() => runtime.store.dispatch({type: 'HISTORY_DWELL', visitId, anchor, kinds: replayableKinds}), delay);
    }, [dwellPageKey, dwellBlocked, runtime.store, replayableKinds]);
    // The round's checks are thrown again when its first page is the settled history page (core.dice.roll replays).
    const historyRolls = runtime.cursor.dwell?.kinds.includes('core.dice.roll') && runtime.text.pages[0] && runtime.cursor.anchor &&
        runtime.text.pages[0].anchor.paragraphId === runtime.cursor.anchor.paragraphId && runtime.cursor.anchor.offset === 0 ? 'history:' + dwellPageKey : null;
    // auto and skip wait for this paragraph's director prefix and say so; manual paging stays immediate.
    const awaitingDirection = runtime.indicators.awaitingDirection;
    // Intermediate voiced cards follow the paragraph audio clock, not a new playback lease.
    const autoDeadline=React.useRef(null);
    // auto waits while DSH Tavern is not in front - a voiced line is held by its paused
    // audio; a silent page keeps the rest of its wait for the return.
    const audible = React.useSyncExternalStore(subscribeAudio, clock.isAudible);
    useEffect(function () {
        if (!auto || skipping || hidden || overlay || !typed || !current || current.pending) {autoDeadline.current=null;return;}
        if (atEnd || awaitingDirection) return;
        if (!audible) { if (autoDeadline.current && autoDeadline.current.left === undefined) autoDeadline.current.left = autoDeadline.current.at - now(); return; }
        if (autoDeadline.current?.left !== undefined) { autoDeadline.current.at = now() + autoDeadline.current.left; delete autoDeadline.current.left; }
        const holds=[...performance.holds,{pending:performance.blocking || dialogueHeld}];
        if (!lastCard && voice && audioBusy) {
            if(timing.remaining(0,holds)===Infinity)return;
            return interval(function () {
                const now = player.get();
                const audio = now && now.owner === voice.owner && now.id === voice.id && now.audio;
                const target = audio && subtitlesApi.voiceTime(subtitles.cards, card, audio.duration);
                if (audio && !audio.paused && target !== null && audio.currentTime >= target) advance();
            }, 80);
        }
        if (audioBusy) {autoDeadline.current=null;return;}
        const key=JSON.stringify([sessionId,turn,page,card,inputCard,transitioning ? inputSubtitles.text : subtitles.text,Boolean(voice) && lastCard,reading.autoWait,reading.autoSpeed]);
        if(autoDeadline.current?.key!==key)autoDeadline.current={key,at:now()+handoffDelay(timing.delay(reading.autoWait,reading.autoSpeed,Boolean(voice) && lastCard,!transitioning ? subtitles.text : inputSubtitles.text),heldMs)};
        const remaining=timing.remaining(autoDeadline.current.at-now(),holds);
        if(remaining===Infinity)return;
        return timeout(() => advance(), remaining);
    }, [sessionId, auto, skipping, hidden, overlay, typed, turn, transitioning, page, card, inputCard, inputSubtitles.text, film, subtitles.text, lastCard, audioBusy, current && current.text, current?.pending, awaiting, reading.autoWait, reading.autoSpeed, atEnd, sceneHolding, presentationBusy, dialogueHeld, awaitingDirection, audible]);
    // skip turns a page every GAL_SKIP_PAGE_MS and never waits for a performance (a
    // text card, title or anything still sounding is cut by the next turn); staging snaps and nothing sounds. Only data
    // holds it: a streaming page's text and a paragraph's director prefix. Input, the round's end, its choices or
    // toggling skip off stop it.
    useEffect(function () {
        if (!skipping || awaiting || sceneHolding) return;
        if (atEnd) { finishSkip(); return; }
        // like AUTO, skip does not turn pages while DSH Tavern is not in front; it resumes on return.
        if (!audible) return;
        if (overlay || (current && current.pending) || awaitingDirection) return;
        return timeout(() => {
            advance(); finishTyping();
        }, GAL_SKIP_PAGE_MS);
    }, [sessionId, skipping, turn, transitioning, page, card, inputCard, subtitles.text, pages.length, current && current.pending, overlay, awaiting, atEnd, sceneHolding, awaitingDirection, audible]);
    return historyRolls;
}
return {usePlayback,dispose(){
    if(disposed)return;disposed=true;const errors=[];
    for(const cancel of [...scopes])try{cancel();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Stage playback clock cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStagePlayback};
