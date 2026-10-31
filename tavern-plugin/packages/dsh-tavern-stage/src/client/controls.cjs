'use strict';
function createStageControls() {
// The stage's real key bindings (the window keydown handler in GalStage, the held Ctrl and galStageShortcut's F12):
// [label, key, action, cap]. One table: the first-run key list shows label / key; a skin's key hints (art.buttons.*.hint,
// stage-skin-buttons.js) show the action's cap (the key's name on a key cap: 按住 Ctrl -> Ctrl).
// R replays the line's voice; D (danmaku-ui.js) is listed only while 弹幕 is usable (galShortcuts).
const GAL_SHORTCUTS = [['自动', 'A', 'auto'], ['跳过', '按住 Ctrl', 'skip', 'Ctrl'], ['隐藏', 'H', 'hide'], ['履历', 'L', 'backlog'], ['重播配音', 'R', 'replay'], ['弹幕', 'D', 'danmaku'], ['菜单', 'Esc', 'menu'], ['重新生成', 'G', 'regenerate'], ['回聊天', 'F12', 'exit']];
function galShortcuts(danmaku) { return GAL_SHORTCUTS.filter(([, , action]) => action !== 'danmaku' || danmaku); }
// G: presses the turn-end menu's 重新生成 badge (gal-choices.js) when it is on screen and can act -
// the key follows the control's own rule (hidden while the choices generate, disabled while the stage is busy).
function galPressRegenerate(root) {
    const control = root?.querySelector?.('.fork-gal-choices [data-action="regenerate"]');
    if (!control || control.disabled || !control.getClientRects().length) return false;
    control.click();
    return true;
}
const GAL_KEY_CAPS = Object.fromEntries(GAL_SHORTCUTS.map(([, key, action, cap]) => [action, cap || key]));

// the classic control row is 自动 / 跳过 / 隐藏 / 上一页 / 履历 / ≡
// (设置 and 返回主页面 are menu items, ✕ is in the top bar). Phones (the one stage breakpoint, 640px - the skin art, the
// CONFIG compact layout and this row share it) keep four 44 px targets: 自动 / 跳过 / 履历 / ≡; hiding the box is right click /
// long press or H, the previous page ← or the backlog.
const GAL_CONTROLS_FULL = ["auto", "skip", "eye-off", "chevron-left", "backlog", "menu"];
const GAL_CONTROLS_NARROW = ["auto", "skip", "backlog", "menu"];

function galControlIds(narrow) { return narrow ? GAL_CONTROLS_NARROW : GAL_CONTROLS_FULL; }
// a row drawn from the skin's icons (quickMenu.icons) shows hide and back only with an
// icon of their own (their keys - H / right click, ← / PageUp - stay); every other control keeps the engine's icon if unset.
function galControlDrawn(id, skin) {
    const icons = skin?.resolvedControlIcons;
    return !icons || !(id === "eye-off" || id === "chevron-left") || Boolean(icons[GAL_CONTROL_ACTIONS[id]]);
}
// The action each control-row icon performs (data-action on every on-stage control: the row, the folded menu control, a skin's
// drawn buttons), read by the mechanical skin check (bin/lib/stage-action-homes.mjs).
const GAL_CONTROL_ACTIONS = { "eye-off": "hide", "chevron-left": "back" };
// Every on-stage SKIP control - the control row's and a skin's drawn button (stage-skin-buttons.js) - is
// [data-action="skip"]: its own press toggles skip instead of only stopping it (SKIP stayed on).
const GAL_SKIP_CONTROL = '[data-action="skip"]';
// one place decides where 自动 / 跳过 / 履历 live. A skin with a folded quick menu
// (quickMenu.layout capsule / orb) has no control row; its drawn buttons (art.buttons) stand at every width, on phones in a
// touch-sized unit (theme.css「stage skin: art」 手机版 SKIP / LOG 不是 fallback). The Esc menu lists exactly the actions with no home on screen;
// 履历 is not one of them - it is always a menu row (gal-menu.js), also beside a drawn LOG button.
const GAL_MENU_ACTIONS = ["auto", "skip"];
function galActionHomes(skin, narrow) {
    const fold = skin && (skin.quickMenu?.layout === "capsule" || skin.quickMenu?.layout === "orb") ? skin.quickMenu.layout : null;
    const row = fold ? [] : galControlIds(narrow).map(id => GAL_CONTROL_ACTIONS[id] || id);
    const drawn = skin?.resolvedArt?.buttons.map(button => button.action) || [];
    const onStage = new Set([...row, ...drawn, ...(fold ? ["menu"] : [])]);
    // declared: the skin's own art.buttons, resolved or not - the stage root carries them (data-skin-buttons) so the real-stage
    // check (stage screenshots) catches drawn buttons that silently failed to resolve and left their actions to the menu.
    // A mode's skin without buttons of its own keeps the stage skin's controls (useStageSkin `controls`): those are declared.
    return { fold, row, drawn, declared: skin?.resolvedArt?.controls?.declared || Object.keys(skin?.art?.buttons || {}), menu: GAL_MENU_ACTIONS.filter(id => !onStage.has(id)) };
}
return {actionFor:id => GAL_CONTROL_ACTIONS[id] || id, shortcuts:galShortcuts, keyCaps:GAL_KEY_CAPS, skipSelector:GAL_SKIP_CONTROL, actionHomes:galActionHomes, ids:galControlIds, drawn:galControlDrawn, pressRegenerate:galPressRegenerate};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageControls};
