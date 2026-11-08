// 长按输入框的发送键：直接重新生成本轮正文，跳过「重新生成正文」的意见面板。
// 开关在 设置 › 高级 › 长按发送键重新生成（默认关闭）；中途松开、取消、移开、切换窗口都算放弃。
// 桌面保留 2 秒防误触；触屏缩短到 0.7 秒，并扩大命中与移动容差，避免被浏览器滚动手势抢占。
// 发送键是宿主的图标按钮，图标随状态（↑ / ■）变化，唯一稳定的标识是它的 aria-label。
const TAVERN_SEND_HOLD_MS = 2000;
const TAVERN_SEND_TOUCH_HOLD_MS = 700;
const TAVERN_SEND_TOUCH_HIT_SLOP = 10;
const TAVERN_SEND_TOUCH_MOVE_SLOP = 24;
const TAVERN_SEND_HOLD_LABELS = /^(发送消息|排队发送|插话发送|停止|Send message|Queue message|Steer message|Stop)$/;
const TAVERN_SEND_HOLD_READY_CLASS = "dsh-tavern-send-hold-ready";
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
        let held = null, timer = null, mutedUntil = 0, mutedButton = null;
        const prepared = new Set();

        function isSendButton(button) {
            return Boolean(button && button.closest("[data-composer-card]")
                && TAVERN_SEND_HOLD_LABELS.test(String(button.getAttribute("aria-label") || "")));
        }
        // touch-action 必须在第一根手指落下前就设好；按下后再改已经来不及阻止浏览器接管手势。
        // 宿主会随输入状态替换发送键，所以用观察器给现有及后插入的按钮预先做标记。
        function prepare(button) {
            if (!isSendButton(button)) return;
            button.classList.add(TAVERN_SEND_HOLD_READY_CLASS);
            prepared.add(button);
        }
        function scan(root) {
            if (!root) return;
            if (root.nodeName === "BUTTON") prepare(root);
            const composer = typeof root.closest === "function" ? root.closest("[data-composer-card]") : null;
            if (composer) {
                composer.querySelectorAll("button").forEach(prepare);
                return;
            }
            if (typeof root.querySelectorAll === "function") root.querySelectorAll("[data-composer-card] button").forEach(prepare);
        }
        scan(document);
        const observer = typeof MutationObserver === "function" ? new MutationObserver(function (records) {
            records.forEach(function (record) {
                if (record.type === "attributes") {
                    if (!isSendButton(record.target)) {
                        record.target.classList.remove(TAVERN_SEND_HOLD_READY_CLASS);
                        prepared.delete(record.target);
                    } else prepare(record.target);
                } else record.addedNodes.forEach(scan);
            });
        }) : null;
        if (observer) observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });

        // disabled 按钮在部分移动浏览器里不会成为 elementFromPoint 的结果。
        // 先走正常命中；命中被 disabled 吃掉时，再按按钮矩形找，空输入时也能长按。
        function sendButtonAt(x, y, padding) {
            const node = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
            const direct = node && typeof node.closest === "function" ? node.closest("button") : null;
            if (isSendButton(direct)) return direct;
            // 扩大的是发送键，不是旁边的发送选项、输入框或链接。
            if (direct || (node && typeof node.closest === "function" && node.closest("input, textarea, select, a, [contenteditable=\"true\"]"))) return null;
            let nearest = null, nearestDistance = Infinity;
            prepared.forEach(function (button) {
                if (!button.isConnected || !isSendButton(button)) return;
                const rect = button.getBoundingClientRect();
                if ((!rect.width && !rect.height) || x < rect.left - padding || x > rect.right + padding
                    || y < rect.top - padding || y > rect.bottom + padding) return;
                const dx = x - (rect.left + rect.width / 2), dy = y - (rect.top + rect.height / 2);
                const distance = dx * dx + dy * dy;
                if (distance < nearestDistance) { nearest = button; nearestDistance = distance; }
            });
            return nearest;
        }
        function repaint(button, busy) {
            if (!button) return;
            button.classList.remove(TAVERN_SEND_HOLD_CLASS);
            if (busy) button.classList.add(TAVERN_SEND_HOLD_FIRED_CLASS);
        }
        function release() {
            if (timer !== null) { window.clearTimeout(timer); timer = null; }
            const press = held;
            held = null;
            if (!press) return;
            repaint(press.button, false);
            try {
                if (press.pointerId !== undefined && press.button.hasPointerCapture
                    && press.button.hasPointerCapture(press.pointerId)) press.button.releasePointerCapture(press.pointerId);
            } catch (error) { /* 宿主在按住期间换掉按钮时，指针捕获可能已由浏览器释放。 */ }
        }
        async function fire() {
            timer = null;
            const press = held;
            if (!press) return;
            press.fired = true;
            const button = press.button;
            const sessionId = current.current.sessionId;
            // 松手紧跟一次 click，这次点击属于长按，不能把输入框的内容发出去。
            mutedUntil = Date.now() + 900;
            mutedButton = button;
            repaint(button, true);
            const snapshot = liveTavernView.getSnapshot(sessionId);
            const view = snapshot && snapshot.view;
            // 视图还没读到时照样发：接口自己会拒绝（原因进错误中心）；只有明确不可重生成才静默放弃。
            const allowed = !view || (view.canRegenerate ?? view.canRollback) === true;
            if (current.current.running || !allowed) {
                window.setTimeout(function () { button.classList.remove(TAVERN_SEND_HOLD_FIRED_CLASS); }, 400);
                return;
            }
            try { await interactions.submitBodyRegeneration(sessionId, { tail: null }, ""); }
            catch (error) { /* interactions 已经上报这次失败（错误中心里有完整原因） */ }
            finally {
                window.setTimeout(function () { button.classList.remove(TAVERN_SEND_HOLD_FIRED_CLASS); }, 900);
                liveTavernView.invalidate(sessionId);
                tavernCoordination.invalidate(sessionId);
                notifyTavernDataChanged(["sessions"], "play-controls");
            }
        }
        function onPointerDown(event) {
            if (held !== null || timer !== null || event.isPrimary === false) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const touch = event.pointerType === "touch";
            const button = sendButtonAt(event.clientX, event.clientY, touch ? TAVERN_SEND_TOUCH_HIT_SLOP : 0);
            if (!button) return;
            const holdMs = touch ? TAVERN_SEND_TOUCH_HOLD_MS : TAVERN_SEND_HOLD_MS;
            held = { button: button, pointerId: event.pointerId, pointerType: event.pointerType,
                x: event.clientX, y: event.clientY, fired: false };
            button.style.setProperty("--dsh-tavern-send-hold-duration", holdMs + "ms");
            button.classList.remove(TAVERN_SEND_HOLD_FIRED_CLASS);
            button.classList.add(TAVERN_SEND_HOLD_CLASS);
            try { if (event.pointerId !== undefined && button.setPointerCapture) button.setPointerCapture(event.pointerId); }
            catch (error) { /* disabled 按钮可能拒绝捕获；document 上的监听仍然完整。 */ }
            timer = window.setTimeout(fire, holdMs);
        }
        function onPointerMove(event) {
            if (!held || held.fired || event.pointerId !== held.pointerId) return;
            const slop = held.pointerType === "touch" ? TAVERN_SEND_TOUCH_MOVE_SLOP : 10;
            const dx = event.clientX - held.x, dy = event.clientY - held.y;
            if (dx * dx + dy * dy > slop * slop) release();
        }
        function onPointerEnd(event) {
            // 第二根手指的抬起不能取消主手指的长按。
            if (held && event.pointerId !== held.pointerId) return;
            release();
        }
        function onClick(event) {
            if (Date.now() >= mutedUntil) { mutedButton = null; return; }
            const node = event.target;
            const button = node && typeof node.closest === "function" ? node.closest("button") : null;
            if (!mutedButton || button !== mutedButton) return;
            mutedUntil = 0;
            mutedButton = null;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        // 手机上按住会弹出系统菜单或选择文字；按住期间及触发后的那一次都压掉。
        function onContextMenu(event) {
            if (held === null && Date.now() >= mutedUntil) return;
            event.preventDefault();
        }
        function onSelectStart(event) { if (held) event.preventDefault(); }
        function onVisibilityChange() { if (document.hidden) release(); }
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("pointerup", onPointerEnd, true);
        document.addEventListener("pointercancel", onPointerEnd, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("contextmenu", onContextMenu, true);
        document.addEventListener("selectstart", onSelectStart, true);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", release);
        return function () {
            release();
            if (observer) observer.disconnect();
            prepared.forEach(function (button) { button.classList.remove(TAVERN_SEND_HOLD_READY_CLASS); });
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("pointermove", onPointerMove, true);
            document.removeEventListener("pointerup", onPointerEnd, true);
            document.removeEventListener("pointercancel", onPointerEnd, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("contextmenu", onContextMenu, true);
            document.removeEventListener("selectstart", onSelectStart, true);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("blur", release);
        };
    }, [enabled, mode, props.sessionId]);
    return null;
}
