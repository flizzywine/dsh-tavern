// 设置 › 高级 › 流式显示思维链（tavern-settings.json 的 reasoningStreamOnly）。
// 两处读者：
//   1. 宿主对话界面的思考行，补丁在 tavern-plugin/lib/domain/chat-reasoning-fold.js，
//      只认 localStorage 里的这个键（ui-chat 的 bundle 没有 RPC 通道）。
//   2. 酒馆自己的正文渲染（ui/message-frame.js）：DSH 的「工作步骤展示」若是简洁档，
//      整个过程区会收起，正文里根本看不到思考；开关打开时把思考块放回正文座位。
// 这里常驻同步：启动读一次，之后每次设置变更再读一次；写入后派发事件换挡。
// 读不到设置时保持「开」，与设置页的出厂默认一致。
const TAVERN_REASONING_STREAM_KEY = "dsh-tavern.reasoningStreamOnly";
const TAVERN_REASONING_STREAM_EVENT = "dsh-tavern-reasoning-stream";
let tavernReasoningStreamWatching = false;
let tavernReasoningStreamCached = null;

function applyTavernReasoningStream(settings) {
    const enabled = !settings || settings.reasoningStreamOnly !== false;
    tavernReasoningStreamCached = enabled;
    try {
        if (window.localStorage) window.localStorage.setItem(TAVERN_REASONING_STREAM_KEY, enabled ? "1" : "0");
    } catch (error) { /* 隐私模式写不进去：宿主补丁按默认（开）处理。 */ }
    try { window.dispatchEvent(new CustomEvent(TAVERN_REASONING_STREAM_EVENT)); } catch (error) { /* 老 WebView 没有 CustomEvent 时由下一次渲染兜底。 */ }
}

// 渲染路径上的同步读：正文与思考座位每帧都会问一次，命中缓存后不再碰 localStorage。
function tavernReasoningStreamEnabled() {
    if (tavernReasoningStreamCached === null) {
        try { tavernReasoningStreamCached = !window.localStorage || window.localStorage.getItem(TAVERN_REASONING_STREAM_KEY) !== "0"; }
        catch (error) { tavernReasoningStreamCached = true; }
    }
    return tavernReasoningStreamCached;
}

function refreshTavernReasoningStream() {
    rpc("getTavernSettings").then(function (result) {
        applyTavernReasoningStream(result && result.settings);
    }, function () { /* 读取失败沿用上一次值；首次失败保持默认开。 */ });
}

function installTavernReasoningStream() {
    if (tavernReasoningStreamWatching || typeof window === "undefined") return;
    tavernReasoningStreamWatching = true;
    window.addEventListener("dsh-tavern-settings-changed", refreshTavernReasoningStream);
    refreshTavernReasoningStream();
}

// 包一层：这是启动路径上的顶层调用，任何异常都不该拖垮整个客户端 bundle。
try { installTavernReasoningStream(); } catch (error) { /* 同步失败时按默认（开）处理。 */ }
