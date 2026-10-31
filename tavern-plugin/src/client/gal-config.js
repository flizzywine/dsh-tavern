// the stage's CONFIG screen, visual-novel
// style - the one home of the stage's lasting preferences. The system menu's 设置 (and the top bar's 声音) open a full-screen
// overlay over the blurred stage with left tabs: 声音 (every audio layer, with previews), 文字 (reading pace, fonts, text size),
// 画面 (本卡皮肤, 顶栏按钮, effects) and 模组 (each enabled mod's stage preferences; no tab without one). The stage owns the open
// state (auto / skip pause while it is open, like the backlog). Styled only through the stage UI tokens (--gal-ui-*).

// The font picker (舞台字体 / 字幕字体 here, 正文字体 on the 外观 settings page — appearance.js, same closure).
// @include font-picker.js

// 本卡皮肤 - the player's own skin for this card (stage.skinChoice; null clears it, back to the
// card's / the global default). Serialized per session, same RPC and store as the settings tab (bubbleStore).
// Application-owned slots; imported mods cannot register executable client code.
const STAGE_CONFIG_SECTIONS = {};
function GalConfigScreen(props) { return stageViews ? React.createElement(stageViews.configScreen.Screen, props) : null; }

function galConfigGroup(...args) { return stageViews.configFields.group(...args); }
function galConfigRow(...args) { return stageViews.configFields.row(...args); }
function galConfigSegmented(...args) { return stageViews.configFields.segmented(...args); }
function galConfigSlider(...args) { return stageViews.configFields.slider(...args); }
// 文字大小 - the stage text of the skin on screen (props.textSkin from the stage) as a percent of
// that skin's own size; each skin keeps its own value on this machine (stageReading textScale), 100% = as designed.
function stageTextScaleSet(...args) { return stageViews.configText.setScale(...args); }
// 音量: the mixer rows, larger, with ▶ previews where cheap (a built-in one-shot, the current voice line).
// an on / off switch drawn in the stage tokens (track + knob), the same geometry as the stage
// settings' switches; a button with role="switch", never a native checkbox. No state word beside it (UI standard §三.7,
// phase 2 batch 4).
function GalConfigSwitch(props) { return stageViews ? React.createElement(stageViews.configFields.Switch, props) : null; }

// 文字: text speed and auto-mode pace, the stage / subtitle fonts (font-picker.js, applied at once), the current skin's
// text size, and a live preview that types and waits like the stage, in the stage font, with a subtitle line in the film font.
// 本卡皮肤 as a compact select instead of a grid of preview cards. The trigger shows a
// small preview of the chosen skin and its name; the list (portaled like the font picker's, in the stage tokens) shows
// every skin with its preview, the chosen one marked. Keys: ↓ / ↑ on the trigger open it; ↑ ↓ Home End move,
// Enter / Space choose, Esc / Tab close (Esc does not reach the CONFIG screen).
// Built-in ids compare by id; pack skins by all three identity fields (storage may reorder the keys).
// the one generic CONFIG row renderer, for the settings a mod (or the engine)
// hands over as plain data instead of building rows. An item: { key, type, label, help?, value, onChange(value), onCommit?(value),
// disabled?, choices [{ value, label }], min, max, step, unit?, maxLength?, placeholder?, palette?, auto? (colour: the automatic
// colour, the value null = automatic), display? (picker / other: the value in words), onOpen? (picker: open its chooser) }.
// Types are the mod settings' (settingsSchema): text, toggle, slider, segmented, colour, asset-picker / sound-picker (= picker),
// plus select; any other type is `other` - its label and its value in words, read-only, never a broken control. Each row
// carries data-fk-control, so the skin's surface draws it (its controls.<type>, else controls.other).
function GalConfigItems(props) { return stageViews ? React.createElement(stageViews.configFields.Items, props) : null; }
function galConfigFieldSections(...args) { return stageViews.configFields.sections(...args); }
