'use strict';

const {reduceTimerCommand, timerCheckpoint} = require('./state.cjs');
const countdownFail = (path, message) => { throw Object.assign(new Error(message), {code:'ARG_INVALID', path}); };
const sameRef = (a, b) => ['packId','kind','assetId'].every(key => a?.[key] === b?.[key]);

// The provider owns budgets. The host supplies a caller key and an explicit start/resume intent;
// neither a new turn nor a new performance instance implies a new budget.
function countdownBudget(state, budgetKey) {
    return state?.timer?.budgetKey === budgetKey ? state.timer : state?.budgets?.find(timer => timer.budgetKey === budgetKey) || null;
}
function countdownWithProgress(timer, checkpoint) {
    if (!timer || checkpoint?.instanceId !== timer.instanceId) return timer;
    const saved = timerCheckpoint(timer, checkpoint);
    return {...timer, remainingMs:saved.remainingMs, status:saved.status};
}
function reduceCountdown(state = {}, intent, boundary = {}, checkpoint = null) {
    const {operation, budgetKey} = intent;
    if (!['start','resume','release'].includes(operation)) countdownFail('$.operation', 'Choose start, resume or release.');
    if (typeof budgetKey !== 'string' || !budgetKey.trim() || budgetKey.length > 160 || /[\u0000-\u001f]/u.test(budgetKey))
        countdownFail('$.budgetKey', 'Provide a bounded, nonblank topic key. Reuse it to resume the same topic.');
    const current = countdownWithProgress(state.timer, checkpoint);
    const budgets = (state.budgets || []).map(timer => countdownWithProgress(timer, checkpoint));
    const previous = countdownBudget({timer:current, budgets}, budgetKey);
    if (operation === 'release') {
        if (!['stop','freeze'].includes(intent.policy)) countdownFail('$.policy', 'Choose stop or freeze.');
        if (!current || current.budgetKey !== budgetKey) return state;
        if (intent.policy === 'freeze') return {...state, timer:{...current, suspended:true}, budgets};
        return {...state, timer:null, budgets:[...budgets, {...current, suspended:true}]};
    }
    if (operation === 'start' && previous) countdownFail('$.budgetKey', 'This topic already has a budget. Resume it; use a new topic key only for a new topic.');
    if (operation === 'resume' && !previous) countdownFail('$.budgetKey', 'This topic has no budget. Start it with the timer entry duration or an explicit duration.');
    if (operation === 'resume' && intent.params?.sec !== undefined) countdownFail('$.sec', 'A duration override is only valid for a new topic; resuming preserves its remaining time.');
    if (previous && intent.params?.ref && !sameRef(previous.ref, intent.params.ref)) countdownFail('$.ref', 'Resume this topic with its original timer entry.');
    if (current && !sameRef(current.ref, intent.params?.ref || previous?.ref)) countdownFail('$.ref', 'The main timer has another entry. Release it before acquiring this entry.');
    // Inactive budgets are moved, not copied: the active timer remains in the existing timer slot.
    const archived = budgets.filter(timer => timer.budgetKey !== budgetKey);
    if (current && current.budgetKey !== budgetKey) {
        if (!current.budgetKey) countdownFail('$.budgetKey', 'Stop the independent timer before starting a topic budget.');
        archived.push({...current, suspended:true});
    }
    const timer = previous ? {...previous, suspended:false} : {...reduceTimerCommand(null, 'start', intent.params, boundary), budgetKey, suspended:false};
    return {...state, timer, budgets:archived};
}

module.exports = {countdownBudget, countdownWithProgress, reduceCountdown};
