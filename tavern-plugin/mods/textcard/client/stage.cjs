'use strict';
// The 「文字演出」 stage feature (src/client/features.cjs): the full-screen text card view, built per view scope, and its
// 履历 row (the declarations' backlog renderer "textcard"); client/stage.css is its CSS. The card takes the stage over while it
// plays (takeover: the controller's useStageTakeovers).
const {planTextcard, textcardHistory, createTextcardGate, textcardPeak} = require('./presets.cjs');
const {createStageTextcard} = require('./card.cjs');
const {createStageTextcardFonts} = require('./fonts.cjs');
const {createStageTextcardPlayers} = require('./player.cjs');
const {createStageTextcardCenter} = require('./center.cjs');
const {TEXTCARD_VERT_INK} = require('./vert-ink.cjs');
const {createStageTextcardLayout} = require('./layout.cjs');

module.exports = {
    backlog:{textcard(performance) {
        const card = textcardHistory(performance.payload);
        // Explicit placement survives pagination; unmarked historical cards still precede their paragraph.
        return card && {tag:card.tag, parts:card.parts, place:performance.payload.placement === 'after' ? 'end' : 'before'};
    }},
    takeover:views => views.textcard,
    // a text card is page DOM alone, so it still flashes by while skipping.
    skipShows:kind => /^dsh\.textcard(?:\.|$)/.test(kind),
    views:({options, own, window, document}) => {
        const center = own(createStageTextcardCenter({metrics:TEXTCARD_VERT_INK}));
        const layout = createStageTextcardLayout(options.textcardLayout || {});
        const players = own(createStageTextcardPlayers({document, ...options.textcardPlayer, layout, center, createGate:createTextcardGate, peak:textcardPeak}));
        const fonts = own(createStageTextcardFonts({document, ...options.textcardFonts}));
        return {textcard:own(createStageTextcard({React:options.React, window, ...options.textcard, players, fonts, plan:planTextcard}))};
    }
};
