'use strict';

// the one registry of stage performance kinds.
// Every kind - core and managed mod alike - declares all four contracts, with no inferred defaults:
//   autoHold: {minMs, until: 'minimum'|'complete'|'dismiss'}; dwell starts at readiness, not preparation.
//   regions: explicit exclusive regions; [] claims none. Overlaps serialize in page order until holds release.
//   backlog: its 履历 record, projected from the same stored record the stage played (no second history):
//            {renderer: <id>, role}      a host-shipped client projection (STAGE_PERFORMANCE_RENDERERS),
//            {row: {label, text}, role}  a generic row: tag `label`, text read at JSON pointer `text` of the payload,
//            {line: {label, command?, voice?, icon?}} the record is its anchored story line itself, tagged `label` (the line's role).
//                                        command: the declaring mod's director mark (a `mod.command` of this mod with this
//                                        commandId on the paragraph) makes that story line this kind - the 履历 shows the
//                                        line once (its pages joined) with the kind's badge `label` (one
//                                        「手机」 badge, drawn as the skin's backlog.badge says). voice {when, is}: the line
//                                        keeps its voice button only when the mark's param at JSON pointer `when` is `is`
//                                        (omitted: as any line). icon: an SVG path in a 24x24 box (filled, evenodd, in the
//                                        badge's ink) the badge draws instead of the word; `label` stays its accessible
//                                        name. The badge only marks the line: the
//                                        row reads and replays as any line. No mod-specific code in the engine reads the mark.
//            {none: '<reason>'}          deliberately no row, with the reason.
//            role: how the row reads in every skin - notice (a stage / mod notice: a check, an item, a card)
//            or narration (read as narration); skins style roles, never kinds (STAGE_PERFORMANCE_ROLES).
//   replay:  {stage: true}           it plays again when the stage settles on its history page (HISTORY_DWELL,
//                                    projection only, no write, no consumption), or {none: '<reason>'}: static there.
//   blocking: true | false (optional, absent = false) -: a blocking kind is sequential: the line of the page
//            it is placed on (text reveal, voice, AUTO) starts only after it ends (a title card, a text card); a parallel kind
//            plays alongside the line (SE, acts, an item show, a scene transition).
// The host validates managed manifests with the same function (mod-system.js validateDistributionManifest).
const STAGE_PERFORMANCE_RENDERERS = Object.freeze(['item', 'textcard', 'title', 'dice']);
const STAGE_PERFORMANCE_ROLES = Object.freeze(['notice', 'narration']);
const STAGE_PERFORMANCE_KIND = /^[a-z][a-z0-9-]*(?:\.[a-zA-Z0-9_-]+)+$/;
const stagePerformanceText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
function stagePerformanceError(message, details) { return Object.assign(new Error(message), {code: 'MOD_INVALID', details}); }

// owner: who declares it (a mod ID, or 'core'). Throws a fixable message naming the kind and the field.
function validateStagePerformanceDeclaration(declaration, owner) {
    const kind = declaration && declaration.kind, where = 'Performance kind ' + JSON.stringify(kind) + ' (' + owner + ')';
    if (typeof kind !== 'string' || !STAGE_PERFORMANCE_KIND.test(kind) || kind.length > 128) throw stagePerformanceError('A performance declaration of ' + owner + ' needs "kind": a dotted id such as "' + owner + '.card"', {owner});
    if (owner !== 'core' && !kind.startsWith(owner + '.')) throw stagePerformanceError(where + ' must start with its mod ID "' + owner + '."', {owner, kind});
    const extra = Object.keys(declaration).filter(key => !['kind', 'backlog', 'replay', 'autoHold', 'regions', 'blocking'].includes(key));
    if (extra.length) throw stagePerformanceError(where + ' has unknown field ' + JSON.stringify(extra[0]) + '; a declaration has only kind, backlog, replay, autoHold, regions and blocking', {owner, kind});
    if (declaration.blocking !== undefined && typeof declaration.blocking !== 'boolean') throw stagePerformanceError(where + ' has an invalid "blocking": use true (the line waits for it) or false (it plays alongside the line)', {owner, kind, field: 'blocking'});
    const validateTiming = typeof module !== 'undefined' && typeof window === 'undefined' ? require('./stage-auto-timing.cjs').validateStagePerformanceTiming : validateStagePerformanceTiming;
    validateTiming(declaration);
    const backlog = declaration.backlog;
    if (backlog === undefined) throw stagePerformanceError(where + ' is missing "backlog": declare its 履历 row as {"renderer":"' + STAGE_PERFORMANCE_RENDERERS.join('|') + '","role":"notice"}, {"row":{"label":"…","text":"/payload/pointer"},"role":"notice"}, {"line":{"label":"…"}} or {"none":"<reason it has no row>"}', {owner, kind, field: 'backlog'});
    const forms = backlog && typeof backlog === 'object' ? Object.keys(backlog).filter(key => key !== 'role') : [];
    // A row of its own reads by its role; a line is the story line's own row and a none has none, so neither takes one.
    const roled = forms[0] === 'renderer' || forms[0] === 'row';
    if (forms.length === 1 && roled !== STAGE_PERFORMANCE_ROLES.includes(backlog.role)) throw stagePerformanceError(roled
        ? where + ' needs "backlog.role": how its 履历 row reads in every skin, one of ' + STAGE_PERFORMANCE_ROLES.map(role => JSON.stringify(role)).join(' or ') + ' (a stage notice is "notice")'
        : where + ' has "backlog.role" on a ' + forms[0] + ' declaration: only a {renderer} or {row} row takes a role', {owner, kind, field: 'backlog.role'});
    const ok = forms.length === 1 && (
        forms[0] === 'none' && stagePerformanceText(backlog.none) ||
        forms[0] === 'renderer' && STAGE_PERFORMANCE_RENDERERS.includes(backlog.renderer) ||
        forms[0] === 'line' && backlog.line && Object.keys(backlog.line).every(key => ['label', 'command', 'voice', 'icon'].includes(key)) && stagePerformanceText(backlog.line.label) &&
            (backlog.line.icon === undefined || typeof backlog.line.icon === 'string' && backlog.line.icon.length <= 1024 && /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9.,\s-]*$/.test(backlog.line.icon)) &&
            backlog.line.label.length <= 8 && (backlog.line.command === undefined || owner !== 'core' && /^[a-z][a-z0-9_-]{0,63}$/i.test(backlog.line.command)) &&
            (backlog.line.voice === undefined || backlog.line.command !== undefined && backlog.line.voice && Object.keys(backlog.line.voice).sort().join() === 'is,when' &&
                typeof backlog.line.voice.when === 'string' && /^\/[^\s]{0,239}$/.test(backlog.line.voice.when) && ['string', 'number', 'boolean'].includes(typeof backlog.line.voice.is)) ||
        forms[0] === 'row' && backlog.row && Object.keys(backlog.row).every(key => ['label', 'text'].includes(key)) && stagePerformanceText(backlog.row.label) &&
            typeof backlog.row.text === 'string' && /^\/[^\s]{0,239}$/.test(backlog.row.text));
    if (!ok) throw stagePerformanceError(where + ' has an invalid "backlog": use exactly one of {"renderer":"' + STAGE_PERFORMANCE_RENDERERS.join('|') + '","role"}, {"row":{"label","text":"/pointer"},"role"}, {"line":{"label":"<badge, up to 8 characters>","command":"<your mark command id>","voice":{"when":"/param/pointer","is":"<value>"},"icon":"<SVG path d in a 24x24 box, up to 1024 characters>"}} (command, voice and icon optional; voice needs command) or {"none":"<reason>"}', {owner, kind, field: 'backlog'});
    const replay = declaration.replay;
    if (replay === undefined) throw stagePerformanceError(where + ' is missing "replay": declare {"stage":true} when tapping its 履历 row may replay it on the stage (pure projection, no side effects), or {"none":"<reason it cannot replay>"}', {owner, kind, field: 'replay'});
    const replayForms = replay && typeof replay === 'object' ? Object.keys(replay) : [];
    if (!(replayForms.length === 1 && (replayForms[0] === 'stage' && replay.stage === true || replayForms[0] === 'none' && stagePerformanceText(replay.none))))
        throw stagePerformanceError(where + ' has an invalid "replay": use {"stage":true} or {"none":"<reason>"}', {owner, kind, field: 'replay'});
    return declaration;
}

// Core kinds: the host's own one-shot performances (director events, items, check receipts, line voice, ritual phases).
// Managed mods declare theirs in manifest.performances. The runtime's one-shot ledger only ever carries these kinds.
const STAGE_PERFORMANCE_CORE = Object.freeze([
    {kind: 'core.items.item', blocking: false, autoHold: {minMs: 2800, until: 'minimum'}, regions: ["illustration"], backlog: {renderer: 'item', role: 'notice'}, replay: {stage: true}},
    {kind: 'core.dice.roll', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: ["center-card"], backlog: {renderer: 'dice', role: 'notice'}, replay: {stage: true}},
    {kind: 'core.event.title', blocking: true, autoHold: {minMs: 0, until: 'complete'}, regions: ["center-card"], backlog: {renderer: 'title', role: 'notice'}, replay: {stage: true}},
    {kind: 'core.event.sfx', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: [], backlog: {none: '音效是它那一页的声音：履历行就是那一页的正文，点开回到那一页'}, replay: {stage: true}},
    {kind: 'core.event.act', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: ["figures"], backlog: {none: '人物动作是那一页台词的表演：履历行就是那一句'}, replay: {stage: true}},
    {kind: 'core.event.emote', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: ["figures"], backlog: {none: '漫符是那一页台词的表演：履历行就是那一句'}, replay: {stage: true}},
    {kind: 'core.event.beat', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: ["screen-effect"], backlog: {none: '画面效果（震动、闪光）是那一页的修饰：履历行就是那一页的正文'}, replay: {stage: true}},
    {kind: 'core.event.trans', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: ["scene-transition"], backlog: {none: '转场是换场景的方式，换场后的画面在下一页：履历行就是那一页的正文'}, replay: {stage: true}},
    {kind: 'core.voice', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: [], backlog: {line: {label: '配音'}}, replay: {none: '配音在它那一行的播放按钮上重听，不必重演舞台'}},
    {kind: 'core.performance.phase', blocking: false, autoHold: {minMs: 0, until: 'complete'}, regions: ["stage"], backlog: {none: '演出组合是持续的画面状态：回到那一页即按记录显示，不是一条独立的事件'}, replay: {none: '持续状态没有单独的一次性重演；片段导出回放整轮时照常播放'}},
].map(row => validateStagePerformanceDeclaration(row, 'core')));
// whether a ledger one-shot holds the line of its page. kinds: the
// session's registry declarations (core and the installed managed mods'). A text card placed after its paragraph follows the
// line, so it never holds it.
function stagePerformanceBlocks(kinds, descriptor) {
    if (descriptor.kind === 'mod-performance' && descriptor.performance.payload?.placement === 'after') return false;
    const kind = stagePerformanceKindOf(descriptor);
    return kinds.find(row => row.kind === kind)?.blocking === true;
}
// A performance combination's live phase (entry, turn, exit) holds the line when the phase puts the dialogue away
// (keyframes.<phase>.holdDialogue: nothing can be read or heard then); otherwise its own document (dsh.performance/1)
// decides with `blocking`, and without it the kind's default (core.performance.phase: parallel - most combinations are
// ambience, BGM, skin and look). value: the accepted performance (its required dependencies carry the documents).
function stagePerformancePhaseBlocks(kinds, value) {
    const ref = value.ref;
    const document = value.dependencies?.find(item => item.ref?.kind === 'performances' && item.ref.packId === ref.packId && item.ref.assetId === ref.assetId)?.document;
    if (document?.keyframes?.[value.phase]?.holdDialogue === true) return true;
    if (typeof document?.blocking === 'boolean') return document.blocking;
    return kinds.find(row => row.kind === 'core.performance.phase')?.blocking === true;
}
// The ledger descriptor of a runtime one-shot -> its registry kind (stage-runtime.cjs ledgerEvent / scanEvents).
function stagePerformanceKindOf(descriptor) {
    if (descriptor.kind === 'mod-performance') return descriptor.performance.kind;
    if (descriptor.kind === 'voice') return 'core.voice';
    if (descriptor.kind === 'performance-phase') return 'core.performance.phase';
    return 'core.event.' + descriptor.kind;
}

// declarations: [{owner, performances}] - core first, then each installed managed mod's manifest.performances.
function createStagePerformanceRegistry(declarations) {
    const kinds = new Map();
    for (const {owner, performances} of declarations) {
        if (!Array.isArray(performances)) throw stagePerformanceError('Mod ' + owner + ' must declare "performances" (use [] when it places no stage performance)', {owner, field: 'performances'});
        for (const declaration of performances) {
            validateStagePerformanceDeclaration(declaration, owner);
            if (kinds.has(declaration.kind)) throw stagePerformanceError('Performance kind ' + JSON.stringify(declaration.kind) + ' is declared twice (' + kinds.get(declaration.kind).owner + ', ' + owner + ')', {owner, kind: declaration.kind});
            kinds.set(declaration.kind, Object.freeze({...declaration, owner}));
        }
    }
    return Object.freeze({get: kind => kinds.get(kind) || null, list: () => [...kinds.values()]});
}
// A JSON pointer into a performance payload (generic {row} declarations).
function stagePerformancePointer(value, pointer) {
    for (const part of pointer.split('/').slice(1).map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
        value = value[part];
    }
    return value;
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {STAGE_PERFORMANCE_RENDERERS, STAGE_PERFORMANCE_ROLES, STAGE_PERFORMANCE_CORE,
    validateStagePerformanceDeclaration, createStagePerformanceRegistry, stagePerformanceKindOf, stagePerformancePointer, stagePerformanceBlocks, stagePerformancePhaseBlocks};
