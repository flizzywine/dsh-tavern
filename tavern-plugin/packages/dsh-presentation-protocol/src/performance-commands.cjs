'use strict';

function reducePerformanceCommand(state, command, params, metadata, document, choices, boundary, check) {
    check(Number.isSafeInteger(metadata.page) && metadata.page >= 0 && Number.isSafeInteger(metadata.turn) && metadata.turn > 0, '$.performance', 'Performance requires a verified turn and canonical page', 'PRECONDITION');
    const off = command === 'performance.off';
    const choice = !off && choices.find(row => ['packId','kind','assetId'].every(key => row.ref[key] === params.ref[key]));
    check(off || choice, '$.ref', 'Choose a recalled performance combination', 'REF_UNAVAILABLE');
    const level = off ? undefined : params.level ?? choice.performanceDefault;
    check(off || choice.performanceLevels.includes(level), '$.level', 'Choose a declared performance level', 'ARG_INVALID');
    if (state.performance || choice) state.performance = boundary(state.performance || null, {ref:choice ? structuredClone(choice.ref) : undefined,level,topic:params.topic,off}, metadata, document);
    return state;
}
if (typeof module !== 'undefined') module.exports = {reducePerformanceCommand};
