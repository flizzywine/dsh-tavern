// Temporary GalStage delegates; implementation and lifetimes belong to the plugin.
function useModPerformances(...args){return stageViews.modSurface.usePerformances(...args);}
function ModStageLayers(props){return stageViews ? React.createElement(stageViews.modSurface.Layers,props) : null;}
