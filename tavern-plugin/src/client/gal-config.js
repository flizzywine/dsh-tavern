// @include font-picker.js

// The stage package and the phone mod share the CONFIG sections registry.
const STAGE_CONFIG_SECTIONS = {};
function GalConfigSwitch(props) { return stageViews ? React.createElement(stageViews.configFields.Switch, props) : null; }
