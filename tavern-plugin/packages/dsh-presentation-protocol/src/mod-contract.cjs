// First-party mod boundary contract. No runtime loading or legacy input aliases.
const MOD_API_VERSION = 1;
const MOD_ERRORS = Object.freeze(['UNKNOWN_FIELD', 'MOD_DISABLED', 'MOD_API_UNSUPPORTED', 'MOD_DEPENDENCY_MISSING', 'MOD_PERMISSION_DENIED', 'MOD_COMMAND_CONFLICT', 'MOD_REVISION_CONFLICT', 'MOD_SOURCE_STALE', 'MOD_RESOURCE_UNAVAILABLE', 'MOD_RUNTIME_FAILED']);
const MOD_PROMPT_SLOTS = Object.freeze({
    director: Object.freeze(['director.rules.presentation', 'director.commands.presentation', 'director.catalogue']),
    model: Object.freeze(['model.rules']),
    settlement: Object.freeze(['settlement.rules', 'settlement.variables'])
});
const MOD_STAGE_CAPABILITIES = Object.freeze(['place', 'state', 'playDeclarative', 'reviseAfterSettlement', 'music', 'skin', 'sfx', 'overlays']);
const MOD_FIELD_TYPES = Object.freeze(['text', 'toggle', 'slider', 'segmented', 'colour', 'asset-picker', 'sound-picker', 'object', 'list', 'reference']);
const MOD_SETTLEMENT_POLICY = Object.freeze({initial: 'immediate', pending: 'play-original', ok: 'revise-existing', error: 'log-only', skipped: 'log-only', replay: 'no-one-shots'});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeKey = key => typeof key === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) && !['constructor', 'prototype', '__proto__'].includes(key);
function modFail(path, message, code = 'MOD_API_UNSUPPORTED') {
    throw Object.assign(new Error(message), {code, path});
}
function modCheck(condition, path, message = 'Invalid mod declaration', code) {
    if (!condition) modFail(path, message, code);
}
function modShape(value, allowed, required = allowed, path = '$') {
    modCheck(plain(value), path, 'Expected an object');
    for (const key of Object.keys(value)) modCheck(allowed.includes(key), path + '.' + key, 'Unknown field', 'UNKNOWN_FIELD');
    for (const key of required) modCheck(Object.hasOwn(value, key), path + '.' + key, 'Required field');
}
function modJson(value, maxBytes = 131072) {
    let nodes = 0;
    function visit(item, depth, path) {
        modCheck(++nodes <= 8192 && depth <= 16, path, 'JSON structure limit');
        if (item === null || ['string', 'boolean'].includes(typeof item)) return;
        if (typeof item === 'number') { modCheck(Number.isFinite(item), path, 'Expected finite number'); return; }
        modCheck(Array.isArray(item) || plain(item), path, 'Expected JSON');
        for (const [key, child] of Object.entries(item)) {
            modCheck(!['__proto__', 'prototype', 'constructor'].includes(key), path + '.' + key, 'Reserved property');
            visit(child, depth + 1, path + '.' + key);
        }
    }
    visit(value, 0, '$');
    modCheck(new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes, '$', 'JSON byte limit');
    return value;
}
function modPlacement(value, target, path = '$.placement') {
    modShape(value, ['section', 'order'], undefined, path);
    modCheck(MOD_PROMPT_SLOTS[target]?.includes(value.section), path + '.section', 'Unknown prompt section');
    modCheck(Number.isSafeInteger(value.order) && Math.abs(value.order) <= 1000000, path + '.order', 'Invalid prompt order');
}
function modFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) modFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function modResultError(error) {
    return {ok: false, error: {code: MOD_ERRORS.includes(error?.code) ? error.code : 'MOD_RUNTIME_FAILED', message: MOD_ERRORS.includes(error?.code) ? error.message : 'Mod operation failed', retryable: error?.code === 'MOD_REVISION_CONFLICT', ...(error?.path ? {path: error.path} : {}), ...(error?.currentRevision ? {currentRevision: error.currentRevision} : {})}};
}
module.exports = {MOD_API_VERSION, MOD_ERRORS, MOD_PROMPT_SLOTS, MOD_STAGE_CAPABILITIES, MOD_FIELD_TYPES, MOD_SETTLEMENT_POLICY, modFail, modCheck, modShape, modJson, modPlacement, modFreeze, modResultError, modPlain: plain, modSafeKey: safeKey};
