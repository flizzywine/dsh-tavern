// Temporary consumers delegate to the optional plugin's admission owner.
const galEntryShown = {
    get:() => stageViews?.admission.shown.get() || null,
    subscribe:fn => stageViews?.admission.shown.subscribe(fn) || (() => {}),
    wait:(...args) => stageViews?.admission.shown.wait(...args) || Promise.resolve(),
    settled:() => stageViews?.admission.shown.settled() || Promise.resolve()
};
function useGalEntry(...args) { return stageViews.admission.useEntry(...args); }
function useGalEntryLoader(...args) { return stageViews.admission.useLoader(...args); }
function GalEntryOverlay(props) {
    return stageViews ? React.createElement(stageViews.admission.Overlay, props) : null;
}
