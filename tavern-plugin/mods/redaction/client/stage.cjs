'use strict';
// The redaction mod's stage feature (src/client/features.cjs): its text mark, the redact command's words drawn as a
// cover the player opens (marks.cjs); client/stage.css is its CSS. The stage finds the marks in the director record and
// lays them out (text-marks.cjs); this feature only draws one.
const {createRedactionMarks} = require('./marks.cjs');
const {redactionNoise} = require('./noise.cjs');
module.exports = {
    views:({options, window}) => ({redaction:createRedactionMarks({React:options.React, window, rpc:options.features?.rpc})}),
    // the command and its quoted-words parameter, as mod.json declares them (commands[].textMark); open: whether a mark is
    // open again; noise: what its words sound like while it is shut (noise.cjs)
    textMark:views => ({modId:'dsh.redaction', command:'redact', quote:'quote', Mark:views.redaction.RedactionMark,
        open:views.redaction.open, noise:redactionNoise}),
};
