'use strict';
function createStageViews({React, ReactDOM, window, document, navigation, useBubbles, useGalEntryLoader, GalStage, Icon}) {
const cleanups = new Set();
let disposed = false;
function own(cleanup) {
    let active = true;
    const release = () => {
        if (!active) return;
        active = false;
        cleanups.delete(release);
        cleanup();
    };
    cleanups.add(release);
    return release;
}
function dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const cleanup of [...cleanups]) {
        try { cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Stage host cleanup failed');
}
const {galStageAvailable, galCoverChat, galUncover, galActive, galMenuRequest, galEscapeLock, galLeave, galEnter} = navigation;
function useGalOn(sessionId) {
    const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
    const active = React.useSyncExternalStore(galActive.subscribe, galActive.get);
    const data = useBubbles(sessionId, enabled && Boolean(sessionId));
    const available = !disposed && enabled && Boolean(data && data.cardPath && data.config && data.config.enabled);
    return { available, on: available && active === sessionId, data };
}
// Mounted in the session shell; the stage covers the whole window (and the screen, when the
// browser grants full screen). Leaving full screen opens the stage menu (Esc exits full screen first).
function StagePortal(props) {
    const state = useGalOn(props.sessionId);
    // Admit the stage and its veil atomically with decoded loader art. Keep the
    // transcript visible during the cold read rather than showing an empty veil.
    // An entrance (config.stage.entrance) is the veil itself: the stage opens at once, without waiting for the skin's loader art.
    const loader = useGalEntryLoader(state.on && !state.data?.config?.stage?.entrance ? state.data?.config?.stage?.skin : null);
    const [target, setTarget] = React.useState(null);
    const admitted = state.on && (!!target || loader !== 'pending');
    React.useLayoutEffect(function () {
        if (disposed) return;
        if (!admitted) { setTarget(null); return; }
        const mount = document.createElement("div");
        mount.className = "fork-gal-mount";
        let active = true;
        let wasFull = Boolean(document.fullscreenElement), lostSent = false;
        // Leaving system full screen (Esc, which the browser takes first) opens the stage menu instead of leaving.
        // Commit it before the first windowed frame paints (flushSync): one transition, not resize then menu.
        function fullscreenLost() {
            if (!active || disposed || lostSent || galActive.get() !== props.sessionId) return;
            lostSent = true;
            if (ReactDOM && typeof ReactDOM.flushSync === "function") ReactDOM.flushSync(galMenuRequest.request); else galMenuRequest.request();
        }
        // Electron shrinks the window 50-100 ms before fullscreenchange; the window no
        // longer filling the screen is the first sign, so the menu lands in that same frame.
        function onResize() {
            if (wasFull && document.fullscreenElement && (window.outerWidth !== window.screen.width || window.outerHeight !== window.screen.height)) fullscreenLost();
        }
        function onFullscreen() {
            if (!active || disposed) return;
            if (wasFull && !document.fullscreenElement) fullscreenLost();
            wasFull = Boolean(document.fullscreenElement); lostSent = false;
            galEscapeLock(wasFull);
        }
        const release = own(() => {
            active = false;
            const errors = [];
            for (const cleanup of [
                () => galEscapeLock(false),
                () => document.removeEventListener("fullscreenchange", onFullscreen),
                () => window.removeEventListener("resize", onResize),
                () => mount.remove(),
                () => galUncover?.(),
                () => { if (!disposed) setTarget(null); },
            ]) { try { cleanup(); } catch (error) { errors.push(error); } }
            if (errors.length) throw new AggregateError(errors, 'Stage portal cleanup failed');
        });
        try {
            document.body.appendChild(mount);
            galCoverChat();
            document.addEventListener("fullscreenchange", onFullscreen);
            window.addEventListener("resize", onResize);
            galEscapeLock(wasFull);
            setTarget(mount);
            return release;
        } catch (error) {
            try { release(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Stage portal mount failed'); }
            throw error;
        }
    }, [props.sessionId, admitted]);
    React.useEffect(() => {
        if (disposed) return;
        return own(() => { if (galActive.get() === props.sessionId) galLeave(); });
    }, [props.sessionId]);
    const h = React.createElement;
    return admitted && target && ReactDOM && ReactDOM.createPortal ? ReactDOM.createPortal(h(GalStage, { sessionId: props.sessionId, data: state.data, Regenerate: props.Regenerate, replayFailed: props.replayFailed, Choices: props.Choices, choiceProps: props.choiceProps, onExit: galLeave }), target) : null;
}

// This boundary belongs to the shell slot, outside the stage portal and controller subtree.
// It can uncover chat and exit without running a broken controller's leave animation.
let StageBoundary;
function boundaryType() {
    if (StageBoundary) return StageBoundary;
    StageBoundary = class extends React.Component {
        state = {failed:false};
        static getDerivedStateFromError() { return {failed:true}; }
        recover(exit = false) {
            const actions = [() => galUncover?.(), () => galEscapeLock(false)];
            if (exit) actions.push(() => (navigation.galLeaveNow || galLeave)());
            for (const action of actions) {
                try { action(); } catch (error) { window.console?.error('Stage recovery failed',error); }
            }
        }
        componentDidCatch() { this.recover(); }
        render() {
            if (!this.state.failed) return this.props.children;
            return React.createElement('div',{role:'alert','data-stage-failure':true},
                React.createElement('p',null,'舞台显示出错，普通聊天仍可使用。'),
                React.createElement('button',{type:'button',onClick:()=>{
                    this.recover(true);
                    if (!galActive.get()) this.setState({failed:false});
                }},'返回普通聊天'));
        }
    };
    return StageBoundary;
}
function GalStageHost(props) {
    const active = React.useSyncExternalStore(galActive.subscribe,galActive.get);
    return React.createElement(boundaryType(),{key:props.sessionId},
        !disposed && active === props.sessionId ? React.createElement(StagePortal,props) : null);
}

// Header button: enter the stage (full screen). Esc opens the stage menu; its 「返回主页面」(or the chat button) leaves.
function GalStageToggle(props) {
    const state = useGalOn(props.sessionId);
    if (!state.available) return null;
    return React.createElement("button", { type: "button", className: "dsh-tavern-btn fork-gal-toggle", title: "进入舞台模式（F12 切换，Esc 打开菜单）", "aria-keyshortcuts": "F12", onClick: () => { if (!disposed) galEnter(props.sessionId); } },
        React.createElement(Icon, { name: "stage", size: 16 }), React.createElement("span", null, "舞台"));
}

return {Host:GalStageHost, Toggle:GalStageToggle, dispose};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageViews};
