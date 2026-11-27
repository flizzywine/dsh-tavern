// 设置 › 高级 › 关闭回车键发送消息（tavern-settings.json 的 disableEnterSend，默认关闭）。
// 开启后，在宿主输入框（[data-composer-card] 内的 contenteditable 或 textarea）按纯回车键只换行不发送：
// 在 window capture 阶段 stopImmediatePropagation() 拦截到达宿主 Lexical/React 的 keydown，
// 不调用 preventDefault()，让浏览器继续原生换行（Lexical 走 beforeinput -> insertParagraph -> insertLineBreak，
// textarea 走原生插入换行符）。Shift/Ctrl/Cmd+Enter、IME 选词与斜杠/引用补全菜单打开时照常放行。
let tavernDisableEnterSend = false;
let tavernDisableEnterSendWatching = false;
const TAVERN_COMPOSER_INPUT_SELECTOR = '[data-composer-input], textarea, [contenteditable="true"], [contenteditable=""]';
const TAVERN_COMPOSER_MENU_SELECTOR = '[role="listbox"], [role="menu"]';

function refreshTavernDisableEnterSend() {
    rpc("getTavernSettings").then(function (result) {
        tavernDisableEnterSend = Boolean(result && result.settings && result.settings.disableEnterSend === true);
    }, function () { /* 读取失败沿用上一次值；首次失败保持默认关闭。 */ });
}

function onTavernDisableEnterSendKeyDown(event) {
    if (!tavernDisableEnterSend || !event || event.defaultPrevented) return;
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    const input = target.closest(TAVERN_COMPOSER_INPUT_SELECTOR);
    if (!input) return;
    const card = input.closest("[data-composer-card]");
    if (!card) return;
    // 命令 / 引用补全菜单打开时，回车用于选中候选条目，不拦截。
    if (card.querySelector(TAVERN_COMPOSER_MENU_SELECTOR)) return;
    event.stopImmediatePropagation();
}

function installTavernDisableEnterSend() {
    if (typeof window !== "undefined" && window.__dshTavernHeadless === true) return;
    if (tavernDisableEnterSendWatching || typeof window === "undefined") return;
    tavernDisableEnterSendWatching = true;
    window.addEventListener("keydown", onTavernDisableEnterSendKeyDown, true);
    window.addEventListener("dsh-tavern-settings-changed", refreshTavernDisableEnterSend);
    refreshTavernDisableEnterSend();
}

// 顶层启动路径保护：异常不拖垮客户端 bundle。
try { installTavernDisableEnterSend(); } catch (error) { /* 保持默认关闭。 */ }
