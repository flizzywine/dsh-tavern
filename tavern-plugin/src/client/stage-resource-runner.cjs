'use strict';

// @include-stage resource-runner.cjs
const createStageResourceRunnerModuleAdapter = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('../../packages/dsh-tavern-stage/lib/client/resource-runner.cjs').createStageResourceRunnerModule : createStageResourceRunnerModule;
const {createStageResourceRunner, stageResourceAuthority, stagePlaybackVisual, stageAvatarResources, stageVisibleAvatars, stageBoundedAvatars, stagePrepareIdleAvatars} = createStageResourceRunnerModuleAdapter({stageResourceMatches: typeof module !== 'undefined' && typeof window === 'undefined' ? require('./stage-resources.cjs').stageResourceMatches : stageResourceMatches, stageRuntimeErrorText: typeof module !== 'undefined' && typeof window === 'undefined' ? require('./stage-runtime.cjs').stageRuntimeErrorText : stageRuntimeErrorText, createPerformanceTimeline: typeof module !== 'undefined' && typeof window === 'undefined' ? require('../../packages/dsh-presentation-protocol/src/performance-timeline.cjs').createPerformanceTimeline : createPerformanceTimeline, performanceSustained: typeof module !== 'undefined' && typeof window === 'undefined' ? require('../../packages/dsh-presentation-protocol/src/performance-state.cjs').performanceSustained : performanceSustained});

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageResourceRunner, stageResourceAuthority, stagePlaybackVisual, stageAvatarResources, stageVisibleAvatars, stageBoundedAvatars, stagePrepareIdleAvatars};
