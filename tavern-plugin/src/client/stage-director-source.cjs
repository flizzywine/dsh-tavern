'use strict';

// @include-stage director-source.cjs
const createStageDirectorModuleAdapter = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('../../packages/dsh-tavern-stage/lib/client/director-source.cjs').createStageDirectorModule : createStageDirectorModule;
const {createStageDirectorSource, projectStageDirection} = createStageDirectorModuleAdapter({directorCommands: typeof module !== 'undefined' && typeof window === 'undefined' ? require('../../packages/dsh-presentation-protocol/src/director-commands.cjs') : directorCommands});

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageDirectorSource, projectStageDirection};
