// One registration line per built-in. The assembler inlines these expression modules.
const BUILTIN_STAGE_WIDGETS = Object.freeze([
    require('./widgets/countdown.cjs'),
    require('./widgets/notification.cjs'),
    require('./widgets/note.cjs'),
    require('./widgets/chat-thread.cjs'),
]);
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = BUILTIN_STAGE_WIDGETS;
