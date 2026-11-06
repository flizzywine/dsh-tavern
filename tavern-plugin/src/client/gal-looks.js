// Shared look math also serves asset-library previews while the stage plugin is disabled.
// @include-protocol stage-light.cjs
// @include-shared stage-look-math.cjs
const stageLookMath=createStageLookMath({matrix:galMatrix,clamp:galClamp01,lighting:stageLighting,layer:stageLookLayer});
const {GAL_LOOK_ID, GAL_LOOK_MS, GAL_LEAK_FROM, GAL_MOTE_KINDS, GAL_LUMA, galLookNumber, galLookRgb, galLookHex, galLookVec, galLookMixer, galLookObject, galLookNormalize, GAL_LOOK_NEUTRAL, GAL_LOOK_LINEAR, galLookExtras, galLookMix, galLookMatrix, galLookPlan, galGradeUniforms, galLookRegistry, GAL_LOOKS_EMPTY, galLookResolveAssets, galLookResolve, galLookComposeMatrix, galLookCompose, galTimeGrade, galLayerCorrection, galFitAffine, galLookUi}=stageLookMath;
