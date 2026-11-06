'use strict';

// @include-stage runtime-store.cjs
const createStageRuntimeStoreModuleAdapter = typeof window === 'undefined' && typeof require === 'function'
    ? require('../../packages/dsh-tavern-stage/lib/client/runtime-store.cjs').createStageRuntimeStoreModule : createStageRuntimeStoreModule;

const stageRuntimeKernel = typeof window === 'undefined' && typeof require === 'function'
    ? require('./stage-runtime.cjs') : {createStageRuntimeState, reduceStageRuntime};

const {createStageRuntimeStore, stageRuntimeShallowEqual} = createStageRuntimeStoreModuleAdapter(stageRuntimeKernel);

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageRuntimeStore, stageRuntimeShallowEqual};
