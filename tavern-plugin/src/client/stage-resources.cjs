'use strict';

// @include-stage resources.cjs
const createStageResourcesModuleAdapter = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('../../packages/dsh-tavern-stage/lib/client/resources.cjs').createStageResourcesModule : createStageResourcesModule;
const {stageDecodeImage, createStageResourceOwner, stageResourceMatches, stageAvatarBitmap, stageAvatarCap, stageMediaTier, stagePreviewBitmap, getStageAvatarCrop, getStageBundleFiles} = createStageResourcesModuleAdapter();

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {stageDecodeImage, createStageResourceOwner, stageResourceMatches, stageAvatarBitmap, stageAvatarCap, stageMediaTier, stagePreviewBitmap, getStageAvatarCrop, getStageBundleFiles};
