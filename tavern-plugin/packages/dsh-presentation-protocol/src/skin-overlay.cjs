'use strict';
// Host-only optional contract. The client does not load this schema for ordinary skins.
const overlaySchema = require('../schema/skin.schema.json');
function validateSkinSchema(schema, value) {
    const root=schema;
    const fail=path=>{throw Object.assign(new Error('Invalid skin overlay at '+path),{code:'INVALID_SKIN',path});};
    function visit(s,v,path) {
        // the performance theme reuses this exact closed schema.
        if (s.$ref === 'dsh.skin/1') return validateSkinSchema(overlaySchema,v);
        if (s.$ref) return visit(s.$ref.slice(2).split('/').reduce((o,k)=>o[k],root),v,path);
        const type=Array.isArray(v)?'array':v===null?'null':Number.isInteger(v)?'integer':typeof v;
        if(s.type && ![].concat(s.type).some(t=>t===type||t==='number'&&type==='integer')) fail(path);
        if('const' in s && JSON.stringify(s.const)!==JSON.stringify(v)) fail(path);
        if(s.enum && !s.enum.some(x=>JSON.stringify(x)===JSON.stringify(v))) fail(path);
        if(typeof v==='number' && (!Number.isFinite(v)||s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum||s.exclusiveMinimum!==undefined&&v<=s.exclusiveMinimum)) fail(path);
        if(typeof v==='string' && (s.pattern&&!new RegExp(s.pattern,'u').test(v)||s.minLength!==undefined&&[...v].length<s.minLength||s.maxLength!==undefined&&[...v].length>s.maxLength)) fail(path);
        if(Array.isArray(v)) {
            if(s.minItems!==undefined&&v.length<s.minItems||s.maxItems!==undefined&&v.length>s.maxItems) fail(path);
            if(s.items) v.forEach((x,i)=>visit(s.items,x,path+'['+i+']'));
        } else if(v && typeof v==='object') {
            for(const key of s.required||[]) if(!Object.hasOwn(v,key)) fail(path+'.'+key);
            for(const [key,x]of Object.entries(v)) {
                if(s.propertyNames) visit(s.propertyNames,key,path);
                if(Object.hasOwn(s.properties||{},key)) visit(s.properties[key],x,path+'.'+key);
                else if(s.additionalProperties===false) fail(path+'.'+key);
                else if(s.additionalProperties && typeof s.additionalProperties==='object') visit(s.additionalProperties,x,path+'.'+key);
            }
        }
        if(s.oneOf) {
            let matches=0;
            for(const choice of s.oneOf) try {visit(choice,v,path);matches++;} catch(error) {if(error.code!=='INVALID_SKIN') throw error;}
            if(matches!==1) fail(path);
        }
    }
    visit(schema,value,'$');return value;
}
function validateSkinOverlay(document) {
    validateSkinSchema(overlaySchema,document);
    const error=message=>{throw Object.assign(new Error(message),{code:'INVALID_SKIN'});};
    if(document.levels && !document.levels[document.levels.default]) error('Skin default level is not declared');
    const overlay=document.overlay;
    if(!overlay) return document;
    const pieces=new Map();
    for(const p of overlay.pieces) {if(pieces.has(p.id)) error('Duplicate overlay piece');pieces.set(p.id,p);}
    if(overlay.pieces.filter(p=>p.layer==='over').length>12 || overlay.pieces.filter(p=>p.layer==='front').length>2) error('Overlay layer budget');
    for(const p of overlay.pieces) if(p.layer==='front' && p.id!==overlay.intrusion?.piece) error('Front piece needs the intrusion declaration');
    if(overlay.intrusion && !pieces.has(overlay.intrusion.piece)) error('Unknown intrusion piece');
    for(const event of overlay.events||[]) for(const id of event.pieces) if(!pieces.has(id)) error('Unknown overlay event piece');
    if(Object.keys(overlay.labels||{}).length>12 || Object.keys(overlay.decals||{}).length>8) error('Overlay label budget');
    return document;
}
module.exports={validateSkinSchema,validateSkinOverlay};
