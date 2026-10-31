'use strict';
function createStageTimer({React, rpc, window, crypto, performance, setInterval, clearInterval, timerClockRemaining}) {
let disposed = false;
const cleanups = new Set(), timerSeenEvents = new Set();
// mode: 'live' (writer) | 'history' (saved frame) | 'replay' (private clock); view: the stage's holds right now.
function useStageTimer({sessionId, mode, visit, turn, at, offset = 0, token, view, onEvent, onFallback}) {
    const [data,setData] = React.useState(null), [,tick] = React.useState(0);
    const clock = React.useRef(null);
    if (!clock.current || clock.current.sessionId !== sessionId) clock.current = {sessionId,lease:null,serial:0,applied:0,epoch:0,origin:null,alive:true,replay:new Map()};
    const owner = clock.current, key = JSON.stringify([sessionId,turn,at,offset,token,mode,visit]);
    const latest = React.useRef(null); latest.current = {mode,key,onEvent,onFallback,view,page:mode === 'live' && turn && at ? {turn,at,offset} : {}};
    const wallNow = () => owner.origin === null ? Date.now() : owner.origin + performance.now();
    function accept(value, requestedKey, serial, epoch) {
        if (disposed || !owner.alive || epoch !== owner.epoch) return value;
        if (owner.origin === null && Number.isFinite(value.now)) owner.origin = value.now - performance.now();
        if ((!requestedKey || latest.current.mode === 'live' && latest.current.key === requestedKey) && serial >= owner.applied) {
            owner.liveData = value; owner.applied = serial;
        }
        if (owner.alive && (requestedKey ? latest.current.key === requestedKey : latest.current.mode === 'live')) setData({...value,projectionKey:requestedKey});
        if (value.event && !timerSeenEvents.has(value.event.id)) {
            timerSeenEvents.add(value.event.id);
            if (owner.alive && latest.current.mode === 'live') {
                latest.current.onEvent?.(value.event);
                if (value.fallbackAction) latest.current.onFallback?.({eventId:value.event.id,action:value.fallbackAction,turn:value.event.turn,source:value.event.source});
            }
        }
        return value;
    }
    function update(action, extra = {}, requestedKey) {
        if (disposed || !owner.alive) return Promise.resolve(null);
        const serial = ++owner.serial, epoch = owner.epoch;
        const task = rpc('updateStageTimer', {action,lease:owner.lease,
            waitingForInput:latest.current.view.waitingForInput,inputStarted:latest.current.view.inputStarted,...latest.current.page,...extra}, sessionId).then(value=>accept(value,requestedKey,serial,epoch));
        task.catch(()=>{});
        return task;
    }
    // The lease follows the open stage, not the displayed floor, visibility or playback.
    React.useEffect(() => {
        if (disposed) return;
        owner.alive = true; owner.epoch++;
        if (mode === 'replay') return () => { owner.alive = false; };
        owner.lease = crypto.randomUUID?.() || 'timer-'+Date.now()+'-'+Math.random().toString(36).slice(2);
        update('open');
        const sample = setInterval(() => update('sample'), 10000);
        // Closing must not wait behind a slow page response; keepalive survives page teardown.
        const close = () => rpc('updateStageTimer',{action:'close',lease:owner.lease},sessionId,{keepalive:true}).catch(()=>{});
        window.addEventListener('pagehide', close);
        const stop = () => {
            if (!owner.alive) return;
            cleanups.delete(stop);
            owner.alive = false;
            clearInterval(sample);
            window.removeEventListener('pagehide', close);
            close();
        };
        cleanups.add(stop);
        return stop;
    }, [sessionId,mode === 'replay']);
    React.useEffect(() => {
        if (!token || !turn || !at) return;
        if (mode === 'live') update('visit', {turn,at,offset,mode:'live',expectedDirectionToken:token}, key);
        else { const epoch = owner.epoch; rpc('getStageTimer',{turn,at,offset,mode,expectedDirectionToken:token},sessionId).then(value=>accept(value,key,++owner.serial,epoch)).catch(()=>{}); }
    }, [key]);
    const display = mode === 'live' ? owner.liveData : data?.projectionKey === key ? data : null;
    const checkpoint = display?.checkpoint, timer = display?.timer;
    let remaining = checkpoint?.remainingMs || 0;
    if (mode === 'live' && checkpoint?.clock) remaining = timerClockRemaining(checkpoint,wallNow());
    // Clip export is a private playback clock, never a writer of the live deadline.
    if (mode === 'replay' && timer) {
        const id = JSON.stringify([visit,timer.instanceId]);
        if (!owner.replay.has(id)) owner.replay.set(id,wallNow());
        remaining = Math.max(0,remaining - (wallNow() - owner.replay.get(id)));
    }
    const runs = !!timer && mode !== 'history' && (mode === 'replay' || checkpoint?.clock?.open === true) && remaining > 0;
    React.useEffect(() => {
        if (!runs || disposed) return;
        const frame = setInterval(() => tick(n => n + 1), 40);
        const stop = () => {clearInterval(frame); cleanups.delete(stop);};
        cleanups.add(stop);
        return stop;
    }, [runs,owner]);
    React.useEffect(() => {
        if (mode === 'live' && timer && remaining <= 0 && checkpoint?.status !== 'expired') update('sample');
    }, [mode,timer?.instanceId,remaining <= 0,checkpoint?.status]);
    return {timer:timer || null,status:timer ? remaining <= 0 ? 'expired' : checkpoint.status : null,remaining,
        playerPaused:checkpoint?.playerPaused === true,runs,ticking:runs,live:mode === 'live',
        togglePause() { if (mode === 'live' && timer) update('pause',{playerPaused:checkpoint?.playerPaused !== true}); }};
}

return {useTimer:useStageTimer, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const stop of [...cleanups]) {try {stop();} catch (error) {errors.push(error);}}
    timerSeenEvents.clear();
    if (errors.length) throw new AggregateError(errors, 'Stage timer cleanup failed');
}};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageTimer};
