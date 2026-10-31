'use strict';

// @include-stage runtime-kernel.cjs
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

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageRuntimeState, reduceStageRuntime, stageRuntimeStatus, stageRuntimeIndicators, stageHistoryModPlays, stageBeatHold, stageRuntimeErrorText, stageDiagnosticText, stageSkipShows, sourceKey, sameSource, STAGE_HISTORY_SETTLE_MS};
