'use strict';

// @include-stage session.cjs
const createStageSessionModuleAdapter = typeof window === 'undefined' && typeof require === 'function'
    ? require('../../packages/dsh-tavern-stage/lib/client/session.cjs').createStageSessionModule : createStageSessionModule;

const stageSessionStore = typeof window === 'undefined' && typeof require === 'function'
    ? require('./stage-runtime-store.cjs') : {createStageRuntimeStore};

const {createStageSessionOwner} = createStageSessionModuleAdapter(stageSessionStore);

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageSessionOwner};
