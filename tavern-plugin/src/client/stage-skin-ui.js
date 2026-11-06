function useStageConfigSkin(...args) {return stageViews.skinResources.useConfig(...args);}
function useStageSkin(...args) {return stageViews.skinPresentation.useSkin(...args);}
function skinTxLeaveMs(...args) { return stageViews.transitions.leaveMs(...args); }
// Transitional call sites; the optional stage package owns all transition work.
function useSkinLeave(...args) { return stageViews.transitions.useLeave(...args); }
function useSkinSweep(...args) { return stageViews.transitions.useSweep(...args); }
function useSkinParts(...args) { return stageViews.transitions.useParts(...args); }
function SkinSweep(props) { return stageViews ? React.createElement(stageViews.transitions.Sweep, props) : null; }
