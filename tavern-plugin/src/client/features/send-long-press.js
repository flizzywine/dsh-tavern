// 长按输入框的发送键 1 秒：直接重新生成本轮正文，跳过「重新生成正文」的意见面板。
// 开关在 设置 › 高级 › 长按 1 秒发送键重新生成（默认关闭）；中途松开、取消、移开、切换窗口都算放弃。
// 触屏使用原生 TouchEvent 主通道，PointerEvent 的取消不会误删仍在进行的触摸；命中与移动容差避免手抖中断。
// 发送键是宿主的图标按钮，图标随状态（↑ / ■）变化，唯一稳定的标识是它的 aria-label。
const TAVERN_SEND_HOLD_MS = 1000;
const TAVERN_SEND_TOUCH_HIT_SLOP = 10;
const TAVERN_SEND_TOUCH_MOVE_SLOP = 24;
const TAVERN_SEND_HOLD_LABELS = /^(发送消息|排队发送|插话发送|停止|Send message|Queue message|Steer message|Stop)$/;
const TAVERN_SEND_HOLD_READY_CLASS = "dsh-tavern-send-hold-ready";
const TAVERN_SEND_HOLD_CLASS = "dsh-tavern-send-hold";
const TAVERN_SEND_HOLD_FIRED_CLASS = "dsh-tavern-send-hold-fired";

// 全局开关（tavern-settings.json 的 longPressSendRegenerate）。缓存与广播监听属于客户端生命周期，
// 不随某个会话插槽卸载：重挂后先复用已读到的值，再在后台校验，消除 RPC 返回前手势不生效的空窗。
let tavernSendHoldEnabled = false, tavernSendHoldWatching = false;
const tavernSendHoldListeners = new Set();
function refreshSendHoldRegenerate() {
    rpc("getTavernSettings").then(function (result) {
        tavernSendHoldEnabled = Boolean(result && result.settings && result.settings.longPressSendRegenerate === true);
        tavernSendHoldListeners.forEach(function (listener) { listener(); });
    }, function () { /* 读取失败沿用上一次值；首次读取仍保持关闭。 */ });
}
function useSendHoldRegenerate() {
    const [enabled, setEnabled] = React.useState(tavernSendHoldEnabled);
    React.useEffect(function () {
        if (typeof window === "undefined") return undefined;
        function update() { setEnabled(tavernSendHoldEnabled); }
        tavernSendHoldListeners.add(update);
        if (!tavernSendHoldWatching) {
            tavernSendHoldWatching = true;
            window.addEventListener("dsh-tavern-settings-changed", refreshSendHoldRegenerate);
        }
        update();
        refreshSendHoldRegenerate();
        return function () { tavernSendHoldListeners.delete(update); };
    }, []);
    return enabled;
}

function TavernSendLongPress(props) {
    const enabled = useSendHoldRegenerate();
    const mode = useTavernSessionMode(props.sessionId);
    // the listener lives across renders; it reads the current session through this ref.
    // Busy/availability checks belong to regenBody: a stale host snapshot must not silently swallow a completed hold.
    const current = React.useRef(props.sessionId);
    current.current = props.sessionId;
    React.useEffect(function () {
        if (!enabled || !isPlayMode(mode) || typeof document === "undefined") return undefined;
        let held = null, timer = null, mutedUntil = 0, mutedButton = null;
        const prepared = new Set();
        // Android / iOS 都提供 TouchEvent。支持时让触屏只走这一条通道，避免 PointerEvent
        // 被浏览器滚动、系统长按或宿主手势取消后，实际仍按着的手指被误判为已经松开。
        const nativeTouch = "ontouchstart" in window;

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
        function release(cancelled) {
            const press = held;
            if (timer !== null) { window.clearTimeout(timer); timer = null; }
            // CSS 动画不受 JS 定时器节流影响；若画面已转完但回调还没跑，正常松手时按实际时长补足。
            // 取消、移开、切窗不走这条补触发，避免把已经放弃的手势又提交。
            if (press && !cancelled && !press.fired && Date.now() - press.startedAt >= TAVERN_SEND_HOLD_MS) void fire();
            held = null;
            if (!press) return false;
            repaint(press.button, false);
            if (press.source === "pointer") {
                try {
                    if (press.button.hasPointerCapture && press.button.hasPointerCapture(press.id)) press.button.releasePointerCapture(press.id);
                } catch (error) { /* 宿主在按住期间换掉按钮时，指针捕获可能已由浏览器释放。 */ }
            }
            return press.fired === true;
        }
        async function fire() {
            timer = null;
            const press = held;
            if (!press) return;
            press.fired = true;
            const button = press.button;
            const sessionId = current.current;
            // 松手紧跟一次 click，这次点击属于长按，不能把输入框的内容发出去。
            mutedUntil = Date.now() + 900;
            mutedButton = button;
            repaint(button, true);
            // 每次完成长按都进入同一个提交流程；忙碌、目标与历史校验由 regenBody 决定并上报原因。
            try {
                notifyRegenerating(sessionId, true);
                await interactions.submitBodyRegeneration(sessionId, { tail: null }, "");
            }
            catch (error) { /* interactions 已经上报这次失败（错误中心里有完整原因） */ }
            finally {
                window.setTimeout(function () { button.classList.remove(TAVERN_SEND_HOLD_FIRED_CLASS); }, 900);
                // 正文换了、视图与故事列表一起收尾，玩家不必刷新页面看新的一楼。
                notifyRegenerating(sessionId, false);
                notifyTavernDataChanged(["sessions"], "play-controls");
            }
        }
        function start(button, source, id, pointerType, x, y) {
            if (held || !button) return;
            held = { button: button, source: source, id: id, pointerType: pointerType, x: x, y: y, startedAt: Date.now(), fired: false };
            button.classList.remove(TAVERN_SEND_HOLD_FIRED_CLASS);
            button.classList.add(TAVERN_SEND_HOLD_CLASS);
            if (source === "pointer") {
                try { if (button.setPointerCapture) button.setPointerCapture(id); }
                catch (error) { /* disabled 按钮可能拒绝捕获；window 上的监听仍然完整。 */ }
            }
            timer = window.setTimeout(fire, TAVERN_SEND_HOLD_MS);
        }
        function moved(press, x, y) {
            const slop = press.pointerType === "touch" ? TAVERN_SEND_TOUCH_MOVE_SLOP : 10;
            const dx = x - press.x, dy = y - press.y;
            if (dx * dx + dy * dy > slop * slop) release(true);
        }
        function onPointerDown(event) {
            // 支持 TouchEvent 的设备上，触摸只走 onTouchStart；这里保留桌面及无 TouchEvent 环境的回退。
            if (nativeTouch && event.pointerType === "touch") return;
            if (held !== null || timer !== null || event.isPrimary === false) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const touch = event.pointerType === "touch";
            const button = sendButtonAt(event.clientX, event.clientY, touch ? TAVERN_SEND_TOUCH_HIT_SLOP : 0);
            start(button, "pointer", event.pointerId, event.pointerType, event.clientX, event.clientY);
        }
        function onPointerMove(event) {
            if (!held || held.source !== "pointer" || held.fired || event.pointerId !== held.id) return;
            moved(held, event.clientX, event.clientY);
        }
        function onPointerEnd(event) {
            if (!held || held.source !== "pointer" || event.pointerId !== held.id) return;
            release(event.type === "pointercancel");
        }
        function touchIn(list, id) {
            if (!list) return null;
            for (let index = 0; index < list.length; index += 1) if (list[index].identifier === id) return list[index];
            return null;
        }
        function onTouchStart(event) {
            if (held !== null || timer !== null || !event.changedTouches || event.changedTouches.length !== 1) return;
            const touch = event.changedTouches[0];
            const button = sendButtonAt(touch.clientX, touch.clientY, TAVERN_SEND_TOUCH_HIT_SLOP);
            start(button, "touch", touch.identifier, "touch", touch.clientX, touch.clientY);
        }
        function onTouchMove(event) {
            if (!held || held.source !== "touch") return;
            const touch = touchIn(event.touches, held.id) || touchIn(event.changedTouches, held.id);
            if (!touch) return;
            // 已确认从发送键开始的手势不交回页面滚动；其他位置的滚动不受影响。
            if (event.cancelable) event.preventDefault();
            if (!held.fired) moved(held, touch.clientX, touch.clientY);
        }
        function onTouchEnd(event) {
            if (!held || held.source !== "touch" || !touchIn(event.changedTouches, held.id)) return;
            // 原生 touchend 也直接吞掉长按后的兼容 click，包括定时器被节流后由松手补触发的情况。
            const fired = release(false);
            if (fired && event.cancelable) event.preventDefault();
        }
        function onTouchCancel(event) {
            if (!held || held.source !== "touch") return;
            if (touchIn(event.changedTouches, held.id) || !touchIn(event.touches, held.id)) release(true);
        }
        function onClick(event) {
            if (Date.now() >= mutedUntil) { mutedButton = null; return; }
            const node = event.target;
            const button = node && typeof node.closest === "function" ? node.closest("button") : null;
            if (!mutedButton || !isSendButton(button)) return;
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
        function onVisibilityChange() { if (document.hidden) release(true); }
        function onBlur() { release(true); }
        // window capture 先于宿主 document / React 监听，宿主停止传播也不会丢掉开始与结束事件。
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerEnd, true);
        window.addEventListener("pointercancel", onPointerEnd, true);
        if (nativeTouch) {
            window.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
            window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
            window.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
            window.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: true });
        }
        document.addEventListener("click", onClick, true);
        document.addEventListener("contextmenu", onContextMenu, true);
        document.addEventListener("selectstart", onSelectStart, true);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", onBlur);
        return function () {
            release(true);
            if (observer) observer.disconnect();
            prepared.forEach(function (button) { button.classList.remove(TAVERN_SEND_HOLD_READY_CLASS); });
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", onPointerEnd, true);
            window.removeEventListener("pointercancel", onPointerEnd, true);
            if (nativeTouch) {
                window.removeEventListener("touchstart", onTouchStart, true);
                window.removeEventListener("touchmove", onTouchMove, true);
                window.removeEventListener("touchend", onTouchEnd, true);
                window.removeEventListener("touchcancel", onTouchCancel, true);
            }
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("contextmenu", onContextMenu, true);
            document.removeEventListener("selectstart", onSelectStart, true);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("blur", onBlur);
        };
    }, [enabled, mode, props.sessionId]);
    return null;
}
