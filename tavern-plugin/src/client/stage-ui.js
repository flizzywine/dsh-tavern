// Temporary entry points for the remaining host controls; state and speech policy live in the plugin.
function useStageSelector(...args) { return stageViews.runtimeUi.useSelector(...args); }
function useStageRuntime(...args) { return stageViews.runtimeUi.useRuntime(...args); }
function useStagePerformanceKinds(...args) { return stageViews.runtimeUi.usePerformanceKinds(...args); }
function useStagePosition(...args) { return stageViews.position.usePosition(...args); }
function stageVoiceHandle(...args) { return stageViews?.speech.handle(...args) || null; }
function stageVoiceAvailable() { return stageViews?.speech.available() || false; }
function stageVoiceWindowFromIndex(...args) { return stageViews?.speech.window(...args) || []; }
function useStageConsumers(...args) { return stageViews.displayConsumers.useConsumers(...args); }
