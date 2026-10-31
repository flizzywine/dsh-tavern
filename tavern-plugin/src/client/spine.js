// Shared with the asset-library preview; stage instances are owned by the stage plugin.
// @include-shared spine-rig.cjs
const spineRig=createSpineRig({window,loadPixi:loadPixiRuntime,loadScript:forkLoadScript,files:(...args)=>getStageBundleFiles(...args),fetch,URL,Blob,location,
    measure:{cache:figureCached,head:galEstimateHeadTop,alpha:measureFigureAlpha}});
const {loadSpineRuntime,spineSources,forkSpineLocalSource,spineLoadData,spineFigure,spineBottomFade,spineFrame,spineMeasure,spineBody}=spineRig;
