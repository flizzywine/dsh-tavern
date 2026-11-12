'use strict';
// The phone's stage feature (src/client/features.cjs): the handheld source device the source widgets lay out and adjust
// (sourceDevice: its mod id, presentation read, glyph, layout preferences per device and the direct adjust hook), with its
// CONFIG › 模组 › 手机 section; client/stage.css is its CSS.
const {createStagePhoneLayout} = require('./layout.cjs');
const {createStagePhoneAdjust} = require('./adjust.cjs');
module.exports = {sourceDevice:views => views.phoneDevice, views:({options, views, own, window, document}) => {
    const fields = views.configFields;
    const layout = own(createStagePhoneLayout({React:options.React, group:fields.group, row:fields.row, slider:fields.slider, Switch:fields.Switch, ...options.phoneLayout}));
    const adjust = own(createStagePhoneAdjust({React:options.React, window, document, sizes:layout.sizes, ...options.phoneAdjust}));
    return {phoneDevice:Object.freeze({modId:'dsh.phone', presentation:'getStagePhonePresentation', glyph:'phone',
        // the director's mark and group commands and the saved threads its records carry (source-widgets.cjs).
        mark:'mark', group:'group', threads:state => state?.threads,
        prefs:layout.prefs, min:layout.min, useAdjust:adjust.useAdjust})};
}};