'use strict';

// Temporary UI delegates; the browser state machine is owned by the stage package.
const stageRuntimeNode = typeof module !== 'undefined' && typeof window === 'undefined' ? (() => {
const stageRuntimeFactory = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('../../packages/dsh-tavern-stage/lib/client/runtime-kernel.cjs').createStageRuntimeKernel : createStageRuntimeKernel;
const performanceStateKernel = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('../../packages/dsh-presentation-protocol/src/performance-state.cjs') : {performanceSustained:plan => performanceSustained(plan), reducePerformanceEvent:(layer,event) => reducePerformanceEvent(layer,event)};
const modProjectionKernel = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('./mod-projection.cjs') : {modPerformanceLedgerKey:(...args) => modPerformanceLedgerKey(...args)};
const phoneBeatKernel = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('./phone-beat.cjs') : {phoneModAutoVoiceAllowed:(...args) => phoneModAutoVoiceAllowed(...args)};
const performanceKindsKernel = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('./stage-performance-kinds.cjs') : {stagePerformanceKindOf:descriptor => stagePerformanceKindOf(descriptor),
        stagePerformanceBlocks:(kinds,descriptor) => stagePerformanceBlocks(kinds,descriptor), stagePerformancePhaseBlocks:(kinds,value) => stagePerformancePhaseBlocks(kinds,value),
        get STAGE_PERFORMANCE_CORE() { return STAGE_PERFORMANCE_CORE; }};
const {createStageRuntimeState, reduceStageRuntime, stageRuntimeStatus, stageRuntimeIndicators, stageHistoryModPlays, stageBeatHold, stageRuntimeErrorText, stageDiagnosticText, stageSkipShows, sourceKey, sameSource, STAGE_HISTORY_SETTLE_MS} = stageRuntimeFactory({performanceStateKernel, modProjectionKernel, phoneBeatKernel, performanceKindsKernel});

return {createStageRuntimeState, reduceStageRuntime, stageRuntimeStatus, stageRuntimeIndicators, stageHistoryModPlays, stageBeatHold, stageRuntimeErrorText, stageDiagnosticText, stageSkipShows, sourceKey, sameSource, STAGE_HISTORY_SETTLE_MS};
})() : null;
const createStageRuntimeState = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).createStageRuntimeState(...args);
const reduceStageRuntime = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).reduceStageRuntime(...args);
const stageRuntimeStatus = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).stageRuntimeStatus(...args);
const stageRuntimeIndicators = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).stageRuntimeIndicators(...args);
const stageHistoryModPlays = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).stageHistoryModPlays(...args);
const stageBeatHold = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).stageBeatHold(...args);
const stageRuntimeErrorText = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).stageRuntimeErrorText(...args);
const stageDiagnosticText = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).stageDiagnosticText(...args);
const stageSkipShows = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).stageSkipShows(...args);
const sourceKey = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).sourceKey(...args);
const sameSource = (...args) => (stageRuntimeNode || stageViews.runtimeKernel).sameSource(...args);
const STAGE_HISTORY_SETTLE_MS = 1000;
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = stageRuntimeNode;
