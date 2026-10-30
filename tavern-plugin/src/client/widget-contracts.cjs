// Bounded JSON-schema subset shared by the host and the opaque-frame parent.
const STAGE_WIDGET_LIMITS = Object.freeze({ manifest: 32768, schema: 16384, props: 12288, types: 32, files: 128, file: 2 * 1024 * 1024, total: 8 * 1024 * 1024 });
const stageWidgetPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const stageWidgetBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const stageWidgetSafeKey = key => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) && !['constructor', 'prototype', '__proto__'].includes(key);
function stageWidgetSchemaValid(schema, options = false) {
    let nodes = 0;
    function visit(s, depth) {
        if (!stageWidgetPlain(s) || ++nodes > 128 || depth > 5 || !['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(s.type)) return false;
        const allowed = ['type', 'description', 'default', 'enum'].concat(s.type === 'object' ? ['properties', 'required', 'additionalProperties'] : s.type === 'array' ? ['items', 'minItems', 'maxItems'] : s.type === 'string' ? ['minLength', 'maxLength'] : ['minimum', 'maximum']);
        if (Object.keys(s).some(k => !allowed.includes(k)) || s.description !== undefined && (typeof s.description !== 'string' || s.description.length > 600)) return false;
        if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.length > 32 || s.enum.some(v => !['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'string' && v.length > 1600))) return false;
        if (s.type === 'object') {
            if (s.additionalProperties !== false || !stageWidgetPlain(s.properties) || Object.keys(s.properties).length > 32 || !Array.isArray(s.required) || s.required.some(k => !Object.hasOwn(s.properties, k))) return false;
            if (!Object.entries(s.properties).every(([k, v]) => stageWidgetSafeKey(k) && visit(v, depth + 1))) return false;
        } else if (s.type === 'array') {
            if (!Number.isInteger(s.maxItems) || s.maxItems < 1 || s.maxItems > 16 || s.minItems !== undefined && (!Number.isInteger(s.minItems) || s.minItems < 0 || s.minItems > s.maxItems) || !visit(s.items, depth + 1)) return false;
        } else if (s.type === 'string') {
            if (s.maxLength === undefined ? !s.enum : !Number.isInteger(s.maxLength) || s.maxLength < 1 || s.maxLength > 1600) return false;
            if (s.minLength !== undefined && (!Number.isInteger(s.minLength) || s.minLength < 0 || s.minLength > (s.maxLength || 1600))) return false;
        } else if (s.type === 'number' || s.type === 'integer') {
            if (!Number.isFinite(s.minimum) || !Number.isFinite(s.maximum) || s.minimum < -86400 || s.maximum > 86400 || s.minimum > s.maximum) return false;
        }
        return s.default === undefined || stageWidgetSchemaValue(s, s.default);
    }
    try {
        return stageWidgetBytes(schema) <= STAGE_WIDGET_LIMITS.schema && schema?.type === 'object' && visit(schema, 0) && (!options || Object.values(schema.properties).every(s => Object.hasOwn(s, 'default')));
    } catch { return false; }
}
function stageWidgetSchemaValue(schema, value) {
    if (!schema || schema.enum && !schema.enum.some(v => v === value)) return false;
    switch (schema.type) {
        case 'object': return stageWidgetPlain(value) && schema.required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => stageWidgetSafeKey(k) && Object.hasOwn(schema.properties, k) && stageWidgetSchemaValue(schema.properties[k], value[k]));
        case 'array': return Array.isArray(value) && value.length >= (schema.minItems || 0) && value.length <= schema.maxItems && value.every(v => stageWidgetSchemaValue(schema.items, v));
        case 'string': return typeof value === 'string' && [...value].length >= (schema.minLength || 0) && [...value].length <= (schema.maxLength || 1600);
        case 'integer': if (!Number.isSafeInteger(value)) return false;
        // fall through
        case 'number': return typeof value === 'number' && Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum;
        case 'boolean': return typeof value === 'boolean';
        default: return false;
    }
}
// JSON Pointer segments, not string prefixes, define the variable capability boundary.
function stageWidgetVariablePointer(path, suffix = false) {
    if (suffix && path === '') return [];
    if (typeof path !== 'string' || !path.startsWith('/') || new TextEncoder().encode(path).length > 512) throw new Error('Invalid variable pointer');
    const parts = path.slice(1).split('/');
    if (parts.length > 16) throw new Error('Variable pointer is too deep');
    return parts.map(part => {
        if (/~(?![01])/u.test(part)) throw new Error('Invalid JSON Pointer escape');
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (['__proto__','prototype','constructor','*'].includes(key) || /^(?:\$|__)/.test(key) || /[\x00-\x1f]/.test(key) || /\{\{|\}\}/.test(key)) throw new Error('Reserved variable key');
        return key;
    });
}
const stageWidgetVariableContains = (parent, child) => parent.length <= child.length && parent.every((key, index) => key === child[index]);
function validateStageWidgetVariables(raw) {
    const shape = (value, keys) => stageWidgetPlain(value) && Object.keys(value).every(key => keys.includes(key));
    if (!shape(raw, ['reads','writes'])) throw new Error('Invalid variable declarations');
    const reads = [], writes = [];
    for (const [kind, limit, output] of [['reads',32,reads],['writes',16,writes]]) {
        const map = raw[kind] ?? {};
        if (!stageWidgetPlain(map) || Object.keys(map).length > limit) throw new Error('Variable declaration limit');
        for (const [id, item] of Object.entries(map)) {
            if (!/^[a-z][a-z0-9-]{0,31}$/.test(id) || !stageWidgetSafeKey(id) || !shape(item, kind === 'reads' ? ['source','path'] : ['source','path','scope','ops'])) throw new Error('Invalid variable declaration');
            if (!['mvu','helper-chat'].includes(item.source)) throw new Error('Unknown variable source');
            const parts = stageWidgetVariablePointer(item.path);
            if (parts.includes('-')) throw new Error('Append is not a declaration');
            if (output.some(other => other.source === item.source && (stageWidgetVariableContains(other.parts,parts) || stageWidgetVariableContains(parts,other.parts)))) throw new Error('Redundant variable declaration');
            if (kind === 'writes' && (item.source !== 'mvu' || !['exact','subtree'].includes(item.scope) || !Array.isArray(item.ops) || !item.ops.length || item.ops.length > 4 || new Set(item.ops).size !== item.ops.length || item.ops.some(op => !['replace','insert','delta','remove'].includes(op)))) throw new Error('Invalid variable write permission');
            output.push({...item, id, parts});
        }
    }
    for (const write of writes) if (!reads.some(read => read.source === write.source && stageWidgetVariableContains(read.parts,write.parts))) throw new Error('Every write requires a covering read');
    return raw;
}
// Settings are data, not another JSON-schema or expression language.
const STAGE_WIDGET_COLOURS = ['accent','accentText','surface','surfaceText','muted','border'];
const stageWidgetSettingShape = (value, keys) => stageWidgetPlain(value) && Object.keys(value).every(key => keys.includes(key));
const stageWidgetSettingRef = (value, kind = 'backgrounds') => stageWidgetSettingShape(value,['packId','kind','assetId']) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.packId) && value.kind === kind && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.assetId) && !['constructor','prototype','__proto__'].includes(value.assetId);
const stageWidgetSettingScalar = value => value === null || ['string','boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value);
const stageWidgetSettingDecimal = value => Number.isFinite(value) && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7;
function stageWidgetSettingValue(field, value) {
    switch (field.type) {
        case 'text': return typeof value === 'string' && !/[\x00-\x1f\x7f]/u.test(value) && [...value].length <= field.maxLength;
        case 'toggle': return typeof value === 'boolean';
        case 'choice': return typeof value === 'string' && field.choices.some(choice => choice.value === value);
        case 'colour': return typeof value === 'string' && (/^#[0-9a-f]{6}$/i.test(value) || value === 'stage' && STAGE_WIDGET_COLOURS.includes(field.stageToken));
        case 'range': return typeof value === 'number' && stageWidgetSettingDecimal(value) && value >= field.min && value <= field.max && Math.abs((value - field.min) / field.step - Math.round((value - field.min) / field.step)) < 1e-7;
        case 'pack-asset': return value === null || stageWidgetSettingRef(value,field.kind);
        default: return false;
    }
}
function validateStageWidgetSettings(schema, i18n) {
    const check = (condition, message) => { if (!condition) throw new Error(message || 'Invalid widget settings'); };
    if (schema === undefined) { check(i18n === undefined, 'Dictionary requires settings'); return; }
    check(stageWidgetSettingShape(schema,['fields']) && Array.isArray(schema.fields) && schema.fields.length <= 32);
    check(stageWidgetSettingShape(i18n,['defaultLocale','messages']) && stageWidgetPlain(i18n.messages));
    const locales = Object.keys(i18n.messages), dictionaryKey = key => /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) && stageWidgetSafeKey(key.replaceAll('.','-'));
    check(locales.length >= 1 && locales.length <= 8 && Object.hasOwn(i18n.messages,i18n.defaultLocale));
    for (const [locale, messages] of Object.entries(i18n.messages)) {
        check(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) && stageWidgetPlain(messages) && Object.keys(messages).length <= 128);
        for (const [key,value] of Object.entries(messages)) check(dictionaryKey(key) && typeof value === 'string' && [...value].length <= 240 && !/[\x00-\x1f\x7f]/u.test(value));
    }
    check(stageWidgetBytes({settingsSchema:schema,i18n}) <= 16384, 'Settings declaration exceeds 16 KiB');
    const label = (key,max=80) => {
        check(typeof key === 'string' && dictionaryKey(key) && Object.hasOwn(i18n.messages[i18n.defaultLocale],key),'Missing setting translation');
        for (const messages of Object.values(i18n.messages)) if (Object.hasOwn(messages,key)) check([...messages[key]].length <= max);
    };
    const keys = new Set(); let assets = 0, visible = 0;
    const extras = {text:['maxLength'],toggle:[],choice:['choices'],colour:['stageToken'],range:['min','max','step','unit'],'pack-asset':['kind']};
    for (const field of schema.fields) {
        check(stageWidgetPlain(field) && Object.hasOwn(extras,field.type));
        check(stageWidgetSettingShape(field,['key','type','label','help','default','directorVisible','bindable',...extras[field.type]]) && Object.hasOwn(field,'default'));
        check(stageWidgetSafeKey(field.key) && !keys.has(field.key)); keys.add(field.key); label(field.label);
        if (field.help !== undefined) label(field.help,240);
        for (const key of ['directorVisible','bindable']) if (field[key] !== undefined) check(typeof field[key] === 'boolean' && !['colour','pack-asset'].includes(field.type));
        check(!(field.bindable && field.directorVisible), 'Bound settings cannot be director-visible');
        if (field.directorVisible) check(++visible <= 4 && (field.type !== 'text' || field.maxLength <= 80));
        if (field.type === 'text') check(Number.isSafeInteger(field.maxLength) && field.maxLength >= 1 && field.maxLength <= 256);
        if (field.type === 'choice') {
            check(Array.isArray(field.choices) && field.choices.length >= 2 && field.choices.length <= 16);
            const choices = new Set();
            for (const choice of field.choices) {
                check(stageWidgetSettingShape(choice,['value','label']) && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(choice.value) && !choices.has(choice.value));
                choices.add(choice.value); label(choice.label);
            }
        }
        if (field.type === 'colour' && field.stageToken !== undefined) check(STAGE_WIDGET_COLOURS.includes(field.stageToken));
        if (field.type === 'range') {
            check([field.min,field.max,field.step].every(stageWidgetSettingDecimal) && field.min >= -86400 && field.max <= 86400 && field.min < field.max && field.step > 0 && (field.max-field.min)/field.step <= 1000);
            check(stageWidgetSettingValue(field,field.max));
            if (field.unit !== undefined) check(['ms','s','%'].includes(field.unit));
        }
        if (field.type === 'pack-asset') check(++assets <= 4 && field.kind === 'backgrounds' && field.default === null);
        check(stageWidgetSettingValue(field,field.default), 'Invalid setting default');
    }
}
function stageWidgetSettingsMap(values) {
    if (!stageWidgetPlain(values) || stageWidgetBytes(values) > 4096 || Object.keys(values).length > 32 || !Object.entries(values).every(([key,value]) => stageWidgetSafeKey(key) && (stageWidgetSettingScalar(value) || stageWidgetSettingRef(value)))) throw new Error('Invalid settings values');
    return values;
}
function validateStageWidgetSettingValues(document, values = {}) {
    stageWidgetSettingsMap(values);
    const fields = document.settingsSchema?.fields || [];
    for (const [key,value] of Object.entries(values)) {
        const field = fields.find(field => field.key === key);
        if (!field || !stageWidgetSettingValue(field,value)) throw new Error('Setting no longer matches its declaration');
    }
    const visible = Object.fromEntries(fields.filter(field => field.directorVisible).map(field => [field.key,values[field.key] ?? field.default]));
    if (stageWidgetBytes(visible) > 512) throw new Error('Director-visible settings exceed 512 B');
    return values;
}
function validateStageWidgetSettingBindings(bindings = {}, document) {
    if (!stageWidgetPlain(bindings) || Object.keys(bindings).length > 8) throw new Error('Invalid setting bindings');
    for (const [key,binding] of Object.entries(bindings)) {
        if (!stageWidgetSafeKey(key) || !stageWidgetSettingShape(binding,['source','path']) || !['mvu','helper-chat'].includes(binding.source)) throw new Error('Invalid setting binding');
        const parts = stageWidgetVariablePointer(binding.path);
        if (parts.length > 8 || new TextEncoder().encode(binding.path).length > 256 || parts.includes('-') || parts.some(part => /[\[\]]/.test(part))) throw new Error('Invalid setting path');
        if (document) {
            const field = document.settingsSchema?.fields.find(field => field.key === key);
            if (!field?.bindable) throw new Error('Setting is not bindable or fallback is invalid');
        }
    }
    return bindings;
}
function stageWidgetResolveSettings(document, defaults = {}, override = {}, projected = {}) {
    const settings = {}, sources = {}, diagnostics = {};
    for (const field of document.settingsSchema?.fields || []) {
        const key = field.key, shared = Object.hasOwn(defaults,key) && stageWidgetSettingValue(field,defaults[key]);
        let value = shared ? defaults[key] : field.default;
        sources[key] = shared ? 'shared' : 'factory';

        const binding = override.bindings?.[key];
        if (binding && field.bindable) {
            sources[key] = override.bindingSources?.[key] || 'author';
            const result = projected[key]; let candidate = result?.value;
            if (field.type === 'text' && candidate !== null && stageWidgetSettingScalar(candidate) && candidate !== undefined) {
                candidate = String(candidate).replace(/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,'');
                if ([...candidate].length > field.maxLength) diagnostics[key] = 'truncated';
                candidate = [...candidate].slice(0,field.maxLength).join('');
            }
            if (result?.status === 'ready' && stageWidgetSettingValue(field,candidate)) value = candidate;
            else diagnostics[key] = result?.status === 'ready' ? 'type-mismatch' : result?.status || 'unavailable';
        } else if (binding) diagnostics[key] = 'invalid-binding';
        settings[key] = field.type === 'colour' ? value.toLowerCase() : value;
    }
    for (const key of Object.keys(override.bindings || {})) if (!Object.hasOwn(settings,key)) diagnostics[key] = 'removed-setting';
    if (stageWidgetBytes(settings) > 4096) throw new Error('Resolved settings exceed 4 KiB');
    const visible = Object.fromEntries((document.settingsSchema?.fields || []).filter(field => field.directorVisible).map(field => [field.key,settings[field.key]]));
    if (stageWidgetBytes(visible) > 512) throw new Error('Director-visible settings exceed 512 B');
    return {settings,sources,diagnostics};
}
// Host-only field feedback. Never forward variable source paths or this diagnostic DTO to widgets.
function stageWidgetSettingsFeedback(resolved) {
    return Object.fromEntries(Object.entries(resolved.settings).map(([key,value])=>[key,{value,source:resolved.sources[key],status:resolved.diagnostics[key] || 'ready'}]));
}
function stageWidgetSettingLabel(document, key, locale = 'zh-CN') {
    const i18n = document.i18n;
    return i18n?.messages[locale]?.[key] ?? i18n?.messages[locale.split('-')[0]]?.[key] ?? i18n?.messages[i18n.defaultLocale]?.[key] ?? '';
}

// Pack-owned commands are declarative; importing a document never runs its view code.
function validateStageWidgetDocument(raw) {
    const fail = (path, message) => { throw Object.assign(new Error(message), {path, code:'INVALID_WIDGET'}); };
    const check = (value, path, message = 'Invalid widget document') => { if (!value) fail(path, message); };
    const shape = (value, allowed, required, path) => check(stageWidgetPlain(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value,key)), path, 'Unknown or missing field');
    const relative = (value, path) => check(typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\\:\x00-\x1f?#%]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'), path, 'Use a local bundle-relative path');
    const short = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
    shape(raw, ['format','namespace','runtime','view','presentation','commands','stateSchema','lifetime','settingsSchema','i18n','assets','caps','samples','variables'], ['format','namespace','view','presentation','commands','caps'], '$');
    check(stageWidgetBytes(raw) <= STAGE_WIDGET_LIMITS.manifest, '$', 'Widget document exceeds 32 KiB');
    check(raw.format === 'dsh.widget/2' && short(raw.namespace), '$.format', 'Use dsh.widget/2 with a short namespace');
    if (raw.variables !== undefined) {
        try { validateStageWidgetVariables(raw.variables); } catch (error) { fail('$.variables',error.message); }
    }
    shape(raw.view, ['entry'], ['entry'], '$.view');
    relative(raw.view.entry, '$.view.entry');
    check(/\.html?$/.test(raw.view.entry), '$.view.entry', 'View entry must be HTML');
    shape(raw.presentation, ['open','compact','notifications'], ['open'], '$.presentation');
    check(stageWidgetBytes(raw.presentation) <= 1024, '$.presentation');
    if (raw.presentation.notifications !== undefined) check(['none','changes'].includes(raw.presentation.notifications), '$.presentation.notifications');
    for (const state of ['open','compact']) {
        const box = raw.presentation[state], path = '$.presentation.' + state;
        if (box === undefined && state === 'compact') continue;
        shape(box, ['width','height','minWidth','minHeight','anchor','aspectRatio'], ['width','height','minWidth','minHeight','anchor'], path);
        const range = state === 'open' ? [560,80,900] : [400,44,160];
        for (const key of ['width','minWidth']) check(Number.isSafeInteger(box[key]) && box[key] >= 120 && box[key] <= range[0], path + '.' + key);
        for (const key of ['height','minHeight']) check(Number.isSafeInteger(box[key]) && box[key] >= range[1] && box[key] <= range[2], path + '.' + key);
        check(box.minWidth <= box.width && box.minHeight <= box.height, path);
        check(['top-center','corner-left','corner-right','center-card'].includes(box.anchor), path + '.anchor');
        if (box.aspectRatio !== undefined) {
            const ratio = box.aspectRatio;
            check(Number.isFinite(ratio) && ratio >= .2 && ratio <= 5 && Math.abs(box.width - box.height * ratio) <= 1, path + '.aspectRatio');
            check(Math.max(box.minWidth / ratio, box.minHeight) <= Math.min(box.width / ratio, box.height) + 1, path, 'Minimum bounds must admit the declared ratio');
        }
    }
    shape(raw.caps, ['bytes','active'], ['bytes','active'], '$.caps');
    check(raw.caps.active === 1 && Number.isSafeInteger(raw.caps.bytes) && raw.caps.bytes > 0 && raw.caps.bytes <= STAGE_WIDGET_LIMITS.props, '$.caps');
    check(raw.runtime === undefined || raw.runtime === 'items' && raw.namespace === 'items', '$.runtime');
    check(Array.isArray(raw.commands) && (raw.runtime === 'items' ? raw.commands.length === 0 : raw.commands.length >= 1 && raw.commands.length <= 8), '$.commands');
    const names = new Set(), effects = {set:'state.set',update:'state.patch',clear:'state.clear',mark:'source.mark'};
    for (const [i, command] of raw.commands.entries()) {
        const path = '$.commands[' + i + ']';
        shape(command, ['name','summary','params','bindings','effect','help'], ['name','summary','params','effect'], path);
        check(short(command.name) && !names.has(command.name) && Object.hasOwn(effects,command.name) && effects[command.name] === command.effect, path + '.name', 'Command name must match its effect and be unique');
        names.add(command.name);
        check(typeof command.summary === 'string' && command.summary.trim() && new TextEncoder().encode(command.summary).length <= 240, path + '.summary');
        check(stageWidgetSchemaValid(command.params) && !['op','ref'].some(key => Object.hasOwn(command.params.properties,key)), path + '.params', 'Use bounded named parameters; op/ref are reserved');
        if (command.bindings !== undefined) {
            check(stageWidgetPlain(command.bindings),path + '.bindings');
            for (const [key,value] of Object.entries(command.bindings)) check(Object.hasOwn(command.params.properties,key) && command.params.properties[key].type === 'string' && value === 'contact',path + '.bindings');
        }
        if (command.effect === 'state.clear') check(Object.keys(command.params.properties).length === 0, path + '.params', 'clear takes no business parameters');
        if (command.effect === 'source.mark') {
            check(Object.keys(command.params.properties).sort().join(',') === 'contact,side' && command.params.required.slice().sort().join(',') === 'contact,side',path + '.params','mark requires only contact and side');
            check(command.params.properties.contact.type === 'string' && JSON.stringify(command.params.properties.side.enum?.slice().sort()) === '["in","out"]',path + '.params');
        }
        if (command.help !== undefined) {
            shape(command.help,['details','examples'],[],path + '.help');
            if (command.help.details !== undefined) check(typeof command.help.details === 'string' && new TextEncoder().encode(command.help.details).length <= 2048,path + '.help.details');
            if (command.help.examples !== undefined) check(Array.isArray(command.help.examples) && command.help.examples.length >= 1 && command.help.examples.length <= 4 && command.help.examples.every(value => stageWidgetSchemaValue(command.params,value) && stageWidgetBytes(value) <= raw.caps.bytes),path + '.help.examples');
        }
    }
    const stateful = raw.commands.some(command => command.effect.startsWith('state.'));
    if (stateful) check(stageWidgetSchemaValid(raw.stateSchema), '$.stateSchema', 'State commands require a bounded state schema');
    else check(raw.stateSchema === undefined && raw.lifetime === undefined, '$.stateSchema', 'Source widgets have no persistent state or lifetime');
    if (raw.lifetime !== undefined) {
        shape(raw.lifetime,['until','durationSeconds'],['until'],'$.lifetime');
        check(['explicit','scene-change','turn-end'].includes(raw.lifetime.until),'$.lifetime.until');
        if (raw.lifetime.durationSeconds !== undefined) check(Number.isSafeInteger(raw.lifetime.durationSeconds) && raw.lifetime.durationSeconds >= 1 && raw.lifetime.durationSeconds <= 86400,'$.lifetime.durationSeconds');
    }
    try { validateStageWidgetSettings(raw.settingsSchema,raw.i18n); validateStageWidgetSettingValues(raw); stageWidgetResolveSettings(raw); } catch (error) { fail('$.settingsSchema',error.message); }
    if (raw.assets !== undefined) {
        check(stageWidgetPlain(raw.assets),'$.assets');
        for (const [key,asset] of Object.entries(raw.assets)) {
            check(short(key),'$.assets.' + key);
            shape(asset,['kind','path'],['kind','path'],'$.assets.' + key);
            check(['image','music','sfx','font'].includes(asset.kind),'$.assets.' + key + '.kind');
            relative(asset.path,'$.assets.' + key + '.path');
        }
    }
    if (raw.samples !== undefined) {
        check(Array.isArray(raw.samples) && raw.samples.length >= 1 && raw.samples.length <= 4,'$.samples');
        for (const sample of raw.samples) {
            shape(sample,['command','params'],['command','params'],'$.samples');
            const command = raw.commands.find(command => command.name === sample.command);
            check(command && stageWidgetSchemaValue(command.params,sample.params) && stageWidgetBytes(sample.params) <= raw.caps.bytes,'$.samples');
        }
    }
    return JSON.parse(JSON.stringify(raw));
}

function normalizeStageWidgetTuning(raw) {
    const output = {};
    if (!stageWidgetPlain(raw)) return output;
    for (const [id, item] of Object.entries(raw).slice(0, 64)) {
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(id) || !stageWidgetPlain(item)) continue;
        const tune = { note: typeof item.note === 'string' ? [...item.note.trim()].slice(0, 600).join('') : '' };
        if (stageWidgetPlain(item.options)) {
            try { if (stageWidgetBytes(item.options) <= 4096) tune.options = JSON.parse(JSON.stringify(item.options)); } catch { /* invalid options fall back */ }
        }
        if (['top-center', 'corner-left', 'corner-right', 'center-card'].includes(item.slot)) tune.slot = item.slot;
        if (Number.isFinite(item.scale)) tune.scale = Math.max(.75, Math.min(1.5, item.scale));
        if (typeof item.frame === 'boolean') tune.frame = item.frame;
        if (['theme', 'pink', 'info', 'warning'].includes(item.tone)) tune.tone = item.tone;
        output[id] = tune;
    }
    return output;
}
function stageWidgetEffectiveOptions(definition, tuning = {}) {
    const result = {};
    for (const [key, schema] of Object.entries(definition.optionsSchema?.properties || {})) {
        const proposed = tuning.options?.[key];
        result[key] = proposed !== undefined && stageWidgetSchemaValue(schema, proposed) ? proposed : schema.default;
    }
    return result;
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = { stageWidgetSettingsFeedback, stageWidgetSettingValue, validateStageWidgetSettings, stageWidgetSettingsMap, validateStageWidgetSettingValues, validateStageWidgetSettingBindings, stageWidgetResolveSettings, stageWidgetSettingLabel, stageWidgetVariablePointer, stageWidgetVariableContains, validateStageWidgetVariables, validateStageWidgetDocument, STAGE_WIDGET_LIMITS, stageWidgetPlain, stageWidgetBytes, stageWidgetSchemaValid, stageWidgetSchemaValue, normalizeStageWidgetTuning, stageWidgetEffectiveOptions };
