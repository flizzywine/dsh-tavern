'use strict';

const timerActivityOwner = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('./activity.cjs') : {timerIsActive:(timer, activity) => timerActivityRuns(timer, activity)};
const timerIsActive = (timer, activity) => timerActivityOwner.timerIsActive(timer, activity);
const TIMER_MOD_ID = 'dsh.timer';
const TIMER_MAX_MS = 86400000;
const timerFail = (path, message) => { throw Object.assign(new Error(message), {code:'ARG_INVALID',path}); };

function validateTimerCommand(id, params) {
    if (!['start','add','pause','resume','stop'].includes(id)) timerFail('$.set','Choose start, add, pause, resume or stop.');
    if (id === 'add' && params.sec === undefined) timerFail('$.sec','Provide seconds to add.');
    if (!['start','add'].includes(id)) return;
    const ms = (params.sec ?? 60) * 1000;
    if (params.sec !== undefined && typeof params.sec !== 'number' || !Number.isFinite(ms) || ms < 1 || ms > TIMER_MAX_MS) timerFail('$.sec','Use 0.001 to 86400 seconds; omit for asset default.');
    if (params.mode !== undefined && !['story','reply'].includes(params.mode)) timerFail('$.mode','Choose story or reply.');
    for (const [field,max] of [['label',80],['onTimeout',160]]) {
        const value=params[field];
        if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length>max || /[\r\n\u0000-\u001f]/u.test(value))) timerFail('$.'+field,'Use bounded nonblank single-line text, or omit.');
    }
    if (params.onTimeout && params.mode === 'story') timerFail('$.onTimeout','A fallback action requires reply mode.');
}

// Director commands carry story coordinates. The host timestamps their first live arrival; clock.cjs owns time.
function reduceTimerCommand(previous, id, params = {}, boundary = {}) {
    validateTimerCommand(id,params);
    if (id === 'stop') return null;
    if (id === 'start') {
        const durationMs = Math.round((params.sec ?? 60) * 1000);
        return {instanceId:JSON.stringify([boundary.sourceKey,boundary.generation ?? 0,boundary.turn,boundary.at,boundary.entryOrdinal ?? 0,boundary.opOrdinal ?? 0]),
            revision:0,durationMs,remainingMs:durationMs,status:'running',mode:params.mode ?? 'story',
            label:params.label ?? '',look:params.look ?? 'default',ref:structuredClone(params.ref || null),
            onTimeout:params.onTimeout ? {fallbackAction:params.onTimeout} : {},onTimeup:structuredClone(params.onTimeup || null),
            ...(params.pauseOnChoices === true ? {pauseOnChoices:true} : {})};
    }
    if (!previous) return previous;
    if (id === 'add') {
        const ms = Math.round(params.sec * 1000);
        if (previous.durationMs + ms > TIMER_MAX_MS) timerFail('$.sec','The total timer budget cannot exceed 86400 seconds.');
        return {...previous,durationMs:previous.durationMs + ms,remainingMs:previous.remainingMs + ms,
            status:previous.status === 'expired' ? 'running' : previous.status,revision:previous.revision + 1,command:{id:'add',ms}};
    }
    if (previous.status === 'expired') return previous;
    const status = id === 'pause' ? 'paused' : 'running';
    return previous.status === status ? previous : {...previous,status,revision:previous.revision + 1,command:{id}};
}

function timerTimeupFact(timer) {
    return timer.mode === 'reply' ? '\u73a9\u5bb6\u5728\u65f6\u9650\u5185\u6ca1\u6709\u56de\u5e94' : (timer.label || '\u5012\u8ba1\u65f6') + '\u65f6\u95f4\u8017\u5c3d';
}

function timerCheckpoint(timer, previous) {
    if (!timer) return null;
    if (previous?.instanceId === timer.instanceId) return {...previous,commandRevision:timer.revision,
        status:previous.status === 'expired' ? 'expired' : timer.status};
    return {instanceId:timer.instanceId,commandRevision:timer.revision,remainingMs:timer.remainingMs,
        status:timer.status,elapsedMs:0,event:null,playerPaused:false};
}

// Caller supplies measured active time. Refresh/replay never derives time from an epoch timestamp.
function advanceTimer(timer, checkpoint, elapsedMs, activity = {}) {
    const before = timerCheckpoint(timer,checkpoint);
    if (!before) return {checkpoint:null,event:null};
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > TIMER_MAX_MS) timerFail('$.elapsedMs','Provide elapsed active milliseconds from 0 to 86400000.');
    if (before.status === 'expired' || !timerActivityOwner.timerIsActive({...timer,status:before.status},{...activity,playerPaused:before.playerPaused || activity.playerPaused}) || !elapsedMs)
        return {checkpoint:before,event:null};
    const consumed = Math.min(before.remainingMs,elapsedMs), remainingMs = before.remainingMs - consumed;
    const event = remainingMs === 0 ? {type:'timer.timeup',id:'timer.timeup:'+timer.instanceId,instanceId:timer.instanceId,
        mode:timer.mode,label:timer.label,ref:timer.ref,look:timer.look,onTimeup:timer.onTimeup,fact:timerTimeupFact(timer)} : null;
    return {checkpoint:{...before,remainingMs,elapsedMs:before.elapsedMs+consumed,status:event?'expired':before.status,event:before.event || event},event};
}

function formatTimer(remainingMs) {
    const ms = Math.max(0,Math.floor(remainingMs));
    return String(Math.floor(ms/60000)).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+':'+String(ms%1000).padStart(3,'0');
}

if (typeof module !== 'undefined') module.exports = {TIMER_MOD_ID,TIMER_MAX_MS,validateTimerCommand,reduceTimerCommand,timerIsActive,timerTimeupFact,timerCheckpoint,advanceTimer,formatTimer};
