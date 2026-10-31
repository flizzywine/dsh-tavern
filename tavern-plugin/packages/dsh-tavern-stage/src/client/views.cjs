'use strict';
function createStageViews({React, ReactDOM, window, document, navigation, useBubbles, useGalEntryLoader, GalStage, Icon}) {
const {galStageAvailable, galCoverChat, galUncover, galActive, galMenuRequest, galEscapeLock, galLeave, galEnter} = navigation;
function useGalOn(sessionId) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    const active = React.useSyncExternalStore(galActive.subscribe, galActive.get);
    const data = useBubbles(sessionId, enabled && Boolean(sessionId));
    const available = enabled && Boolean(data && data.cardPath && data.config && data.config.enabled);
    return { available, on: available && active === sessionId, data };
}
// Mounted in the session shell; the stage covers the whole window (and the screen, when the
// browser grants full screen). Leaving full screen opens the stage menu (Esc exits full screen first).
function GalStageHost(props) {
    const state = useGalOn(props.sessionId);
    // Admit the stage and its veil atomically with decoded loader art. Keep the
    // transcript visible during the cold read rather than showing an empty veil.
    // An entrance (config.stage.entrance) is the veil itself: the stage opens at once, without waiting for the skin's loader art.
    const loader = useGalEntryLoader(state.on && !state.data?.config?.stage?.entrance ? state.data?.config?.stage?.skin : null);
    const [target, setTarget] = React.useState(null);
    const admitted = state.on && (!!target || loader !== 'pending');
    React.useLayoutEffect(function () {
        if (!admitted) { setTarget(null); return; }
        const mount = document.createElement("div");
        mount.className = "fork-gal-mount";
        document.body.appendChild(mount);
        galCoverChat();
        let wasFull = Boolean(document.fullscreenElement), lostSent = false;
        // Leaving system full screen (Esc, which the browser takes first) opens the stage menu instead of leaving.
        // Commit it before the first windowed frame paints (flushSync): one transition, not resize then menu.
        function fullscreenLost() {
            if (lostSent || galActive.get() !== props.sessionId) return;
            lostSent = true;
            if (ReactDOM && typeof ReactDOM.flushSync === "function") ReactDOM.flushSync(galMenuRequest.request); else galMenuRequest.request();
        }
        // Electron shrinks the window 50-100 ms before fullscreenchange; the window no
        // longer filling the screen is the first sign, so the menu lands in that same frame.
        function onResize() {
            if (wasFull && document.fullscreenElement && (window.outerWidth !== window.screen.width || window.outerHeight !== window.screen.height)) fullscreenLost();
        }
        function onFullscreen() {
            if (wasFull && !document.fullscreenElement) fullscreenLost();
            wasFull = Boolean(document.fullscreenElement); lostSent = false;
            galEscapeLock(wasFull);
        }
        document.addEventListener("fullscreenchange", onFullscreen);
        window.addEventListener("resize", onResize);
        galEscapeLock(wasFull);
        setTarget(mount);
        return function () {
            galEscapeLock(false);
            document.removeEventListener("fullscreenchange", onFullscreen);
            window.removeEventListener("resize", onResize);
            mount.remove(); galUncover?.(); setTarget(null);
        };
    }, [props.sessionId, admitted]);
    React.useEffect(() => () => { if (galActive.get() === props.sessionId) galLeave(); }, [props.sessionId]);
    const h = React.createElement;
    return admitted && target && ReactDOM && ReactDOM.createPortal ? ReactDOM.createPortal(h(GalStage, { sessionId: props.sessionId, data: state.data, Regenerate: props.Regenerate, replayFailed: props.replayFailed, Choices: props.Choices, choiceProps: props.choiceProps, onExit: galLeave }), target) : null;
}

// Header button: enter the stage (full screen). Esc opens the stage menu; its 「返回主页面」(or the chat button) leaves.
function GalStageToggle(props) {
    const state = useGalOn(props.sessionId);
    if (!state.available) return null;
    return React.createElement("button", { type: "button", className: "dsh-tavern-btn fork-gal-toggle", title: "进入舞台模式（F12 切换，Esc 打开菜单）", "aria-keyshortcuts": "F12", onClick: () => galEnter(props.sessionId) },
        React.createElement(Icon, { name: "stage", size: 16 }), React.createElement("span", null, "舞台"));
}

return {Host:GalStageHost, Toggle:GalStageToggle};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageViews};
