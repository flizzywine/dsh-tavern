// 长按输入框的发送键 2 秒：直接重新生成本轮正文，跳过「重新生成正文」的意见面板。
// 开关在 设置 › 高级 › 长按 2 秒发送键重新生成（默认关闭）；中途松开、取消、切换窗口都算放弃。
// 发送键是宿主的图标按钮，图标随状态（↑ / ■）变化，唯一稳定的标识是它的 aria-label。
const TAVERN_SEND_HOLD_MS = 2000;
const TAVERN_SEND_HOLD_LABELS = /^(发送消息|排队发送|插话发送|停止|Send message|Queue message|Steer message|Stop)$/;
const TAVERN_SEND_HOLD_CLASS = "dsh-tavern-send-hold";
const TAVERN_SEND_HOLD_FIRED_CLASS = "dsh-tavern-send-hold-fired";

// 全局开关（tavern-settings.json 的 longPressSendRegenerate），设置页保存后通过
// dsh-tavern-settings-changed 广播；读不到时保持关闭——这个手势只是补充入口。
function useSendHoldRegenerate() {
    const [enabled, setEnabled] = React.useState(false);
    React.useEffect(function () {
        if (typeof window === "undefined") return undefined;
        let active = true;
        function refresh() {
            rpc("getTavernSettings").then(function (result) {
                if (active) setEnabled(result && result.settings && result.settings.longPressSendRegenerate === true);
            }, function () { /* 读取失败不做任何事：保持关闭，也不打扰玩家 */ });
        }
        refresh();
        window.addEventListener("dsh-tavern-settings-changed", refresh);
        return function () { active = false; window.removeEventListener("dsh-tavern-settings-changed", refresh); };
    }, []);
    return enabled;
}

function TavernSendLongPress(props) {
    const enabled = useSendHoldRegenerate();
    const mode = useTavernSessionMode(props.sessionId);
    const running = props.useSession(function (snapshot) { return snapshot && snapshot.running === true; });
    // the listener lives across renders; it reads the current round through this ref.
    const current = React.useRef({ sessionId: props.sessionId, running: running });
    current.current = { sessionId: props.sessionId, running: running };
    React.useEffect(function () {
        if (!enabled || !isPlayMode(mode) || typeof document === "undefined") return undefined;
        let held = null, timer = null, mutedUntil = 0;
        // disabled 的按钮不派发鼠标事件，但仍是命中测试的目标，所以按坐标取元素，
        // 这样输入框为空（发送键禁用）时也能长按。
        function sendButtonAt(x, y) {
            const node = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
            const button = node && typeof node.closest === "function" ? node.closest("button") : null;
            if (!button || !button.closest("[data-composer-card]")) return null;
            return TAVERN_SEND_HOLD_LABELS.test(String(button.getAttribute("aria-label") || "")) ? button : null;
        }
        function repaint(button, busy) {
            if (!button) return;
            button.classList.remove(TAVERN_SEND_HOLD_CLASS);
            if (busy) button.classList.add(TAVERN_SEND_HOLD_FIRED_CLASS);
        }
        function release() {
            if (timer !== null) { window.clearTimeout(timer); timer = null; }
            repaint(held, false);
            held = null;
        }
        async function fire() {
            timer = null;
            const button = held;
            const sessionId = current.current.sessionId;
            // 松手紧跟一次 click，这次点击属于长按，不能把输入框的内容发出去。
            mutedUntil = Date.now() + 900;
            repaint(button, true);
            const snapshot = liveTavernView.getSnapshot(sessionId);
            const view = snapshot && snapshot.view;
            // 视图还没读到时照样发：接口自己会拒绝（原因进错误中心）；只有明确不可重生成才静默放弃。
            const allowed = !view || (view.canRegenerate ?? view.canRollback) === true;
            if (current.current.running || !allowed) {
                if (button) window.setTimeout(function () { button.classList.remove(TAVERN_SEND_HOLD_FIRED_CLASS); }, 400);
                return;
            }
            try { await interactions.submitBodyRegeneration(sessionId, { tail: null }, ""); }
            catch (error) { /* interactions 已经上报这次失败（错误中心里有完整原因） */ }
            finally {
                if (button) window.setTimeout(function () { button.classList.remove(TAVERN_SEND_HOLD_FIRED_CLASS); }, 900);
                liveTavernView.invalidate(sessionId);
                tavernCoordination.invalidate(sessionId);
                notifyTavernDataChanged(["sessions"], "play-controls");
            }
        }
        function onPointerDown(event) {
            if (held !== null || timer !== null) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const button = sendButtonAt(event.clientX, event.clientY);
            if (!button) return;
            held = button;
            button.classList.add(TAVERN_SEND_HOLD_CLASS);
            timer = window.setTimeout(fire, TAVERN_SEND_HOLD_MS);
        }
        function onClick(event) {
            if (Date.now() >= mutedUntil) return;
            // 只压发送键这一点，别处的点击照旧。
            const node = event.target;
            const button = node && typeof node.closest === "function" ? node.closest("button") : null;
            if (!button || !button.closest("[data-composer-card]")) return;
            mutedUntil = 0;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        // 手机上按住会弹出系统菜单，长按期间压掉；松开后已经触发的那次也一样。
        function onContextMenu(event) {
            if (held === null && Date.now() >= mutedUntil) return;
            event.preventDefault();
        }
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointerup", release, true);
        document.addEventListener("pointercancel", release, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("contextmenu", onContextMenu, true);
        window.addEventListener("blur", release);
        return function () {
            release();
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("pointerup", release, true);
            document.removeEventListener("pointercancel", release, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("contextmenu", onContextMenu, true);
            window.removeEventListener("blur", release);
        };
    }, [enabled, mode, props.sessionId]);
    return null;
}
