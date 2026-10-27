'use strict';

// Trusted, static command composition. Wire grammar and the consumer adapter share this table.
const directorCommands = (() => {
    const version = 5;
    // saved pre-registry ops are already normalized, not tool commands.
    const recordedOps = new Set(['scene.set','scene.clear','scene.variant','music.set','music.stop','skin.set','skin.off','perform','perform.off','actor.enter','actor.move','actor.exit','actor.variant','actor.reset','actor.patch','cast.clear','stage.patch','light','event','clock.advance','time.set','soundscape.set','soundscape.clear','cg.show','cg.variant','cg.pan','cg.hide','item.play']);
    const retiredOperation = op => typeof op?.op === 'string' && (op.op.startsWith('phone.') || ['widget.show','widget.update','widget.hide','widget.set','widget.clear'].includes(op.op));
    const dimensionGroups = [["\u573a\u666f\u4e0e\u8f6c\u573a",[["scene","\u573a\u666f"],["transitions","\u8f6c\u573a"],["weather","\u5929\u6c14"],["lighting.time","\u65f6\u6bb5\u8c03\u8272"],["lighting.mood","\u6c1b\u56f4\u8c03\u8272"]]],["\u955c\u5934",[["camera","\u955c\u5934"],["camera.close","\u8fd1\u666f"],["dof","\u666f\u6df1"]]],["\u4eba\u7269",[["cast","\u51fa\u573a"],["outfit","\u670d\u88c5"],["position","\u7ad9\u4f4d"],["gaze","\u89c6\u7ebf"],["actorLight","\u4eba\u7269\u5149\u7167"],["acts","\u52a8\u4f5c"],["emotes","\u6f2b\u7b26"]]],["\u6548\u679c",[["screenEffects","\u753b\u9762\u6548\u679c"],["titles","\u6807\u9898"]]],["Audio and widgets",[["music","\u97f3\u4e50"],["soundscape","\u73af\u5883\u97f3"],["sfx","\u97f3\u6548"],["widgets","\u7ec4\u4ef6"]]]];
    // independent overlay dimension; tools stay static across recall windows.
    dimensionGroups.push(['CG',[['cg','CG']]]);
    const dimensions = Object.fromEntries(dimensionGroups.flatMap(([,items]) => items));
    const en = values => ({enum:values});
    const str = {type:'string'};
    const variant = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
    const actor = {$ref:'#/$defs/actor'}, ref = {$ref:'#/$defs/ref'};
    const shape = (properties, required = Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
    const int = (minimum,maximum) => ({type:'integer',minimum,maximum});
    const rows = (c,kind) => c.catalogue.candidates[kind] || [];
    const available = kind => c => rows(c,kind).length > 0;
    const patch = value => ({op:'stage.patch',value});
    const actorPatch = (op,value) => ({op:'actor.patch',actor:op.actor,value});
    const event = (kind,field,hasActor = false) => op => ({op:'event',value:{op:kind,...(hasActor ? {id:op.actor} : {}),value:op[field]}});
    // Chinese name and one-sentence help per command, for the UI only;
    // never part of a schema, prompt line or tool description.
    const ui = Object.freeze({
        'actor.move':['\u79fb\u52a8\u4eba\u7269','\u8ba9\u5728\u573a\u4eba\u7269\u6ed1\u52a8\u5230\u65b0\u7ad9\u4f4d\uff0c\u4fdd\u6301\u5176\u4ed6\u72b6\u6001\u3002'],
        'performance.set':['演出组合','开始或调整素材声明的演出组合。'],
        'performance.off':['结束演出组合','通过退出段结束当前演出组合。'],
        'item.play':['\u7269\u54c1\u6f14\u51fa','\u83b7\u5f97\u3001\u5931\u53bb\u6216\u5c55\u793a\u4e00\u4ef6\u91cd\u8981\u7269\u54c1\u65f6\u5f39\u51fa\u7269\u54c1\u63d0\u793a\u3002'],
        'scene.set':['\u5207\u6362\u80cc\u666f','\u6362\u5230\u65b0\u5730\u70b9\u7684\u80cc\u666f\uff0c\u5e76\u6807\u660e\u6545\u4e8b\u65f6\u6bb5\u3002'],
        'scene.variant':['\u80cc\u666f\u53d8\u4f53','\u5207\u6362\u5f53\u524d\u80cc\u666f\u7684\u53d8\u4f53\u3002'],
        'cg.variant':['CG \u53d8\u4f53','\u5207\u6362\u5f53\u524d CG \u7684\u53d8\u4f53\u3002'],
        'scene.clear':['\u6e05\u7a7a\u80cc\u666f','\u79fb\u9664\u80cc\u666f\uff0c\u53ea\u7559\u7a7a\u821e\u53f0\uff0c\u4f8b\u5982\u7184\u706f\u540e\u4e00\u7247\u6f06\u9ed1\u3002'],
        'lighting.mood.set':['\u6c1b\u56f4\u8c03\u8272','\u53e0\u52a0\u4e00\u5c42\u6c1b\u56f4\u8c03\u8272\uff0c\u81f3\u5c11\u4fdd\u6301 8 \u6bb5\u3002'],
        'lighting.mood.clear':['\u53d6\u6d88\u6c1b\u56f4\u8c03\u8272','\u53bb\u6389\u6c1b\u56f4\u8c03\u8272\uff0c\u65f6\u6bb5\u8c03\u8272\u4e0d\u53d8\u3002'],
        'weather.set':['\u8bbe\u7f6e\u5929\u6c14','\u5f00\u59cb\u4e0b\u96e8\u3001\u4e0b\u96ea\u3001\u98d8\u82b1\u7b49\u6301\u7eed\u7684\u5929\u6c14\u3002'],
        'weather.clear':['\u505c\u6b62\u5929\u6c14','\u53bb\u6389\u5929\u6c14\u6548\u679c\u3002'],
        'ambience.set':['\u73af\u5883\u97f3','\u6362\u6210\u4e00\u5230\u4e24\u5c42\u5faa\u73af\u73af\u5883\u97f3\uff0c\u4e00\u76f4\u64ad\u653e\u5230\u6545\u4e8b\u91cc\u7684\u58f0\u97f3\u53d8\u5316\u3002'],
        'ambience.clear':['\u505c\u6b62\u73af\u5883\u97f3','\u505c\u6389\u5168\u90e8\u73af\u5883\u97f3\u3002'],
        'music.set':['\u5207\u6362 BGM','\u6362\u4e00\u9996\u80cc\u666f\u97f3\u4e50\uff1b\u540c\u4e00\u8f6e\u7b2c\u4e8c\u6b21\u6362\u66f2\u8981\u5199\u660e\u7406\u7531\u3002'],
        'music.clear':['\u505c\u6b62 BGM','\u505c\u6389\u80cc\u666f\u97f3\u4e50\uff0c\u8f6c\u4e3a\u5b89\u9759\u3002'],
        'cast.add':['\u4eba\u7269\u767b\u573a','\u8ba9\u4e00\u4f4d\u4eba\u7269\u767b\u573a\uff0c\u5176\u4ed6\u4eba\u4f4d\u7f6e\u4e0d\u53d8\u3002'],
        'cast.remove':['\u4eba\u7269\u9000\u573a','\u8ba9\u4e00\u4f4d\u4eba\u7269\u9000\u573a\uff0c\u5e76\u7ed3\u675f\u5176\u8fd1\u666f\u3002'],
        'cast.set':['\u8bbe\u5b9a\u5728\u573a\u4eba\u7269','\u4e00\u6b21\u7ed9\u51fa\u5168\u90e8\u5728\u573a\u4eba\u7269\uff0c\u7559\u4e0b\u7684\u4eba\u4fdd\u6301\u539f\u987a\u5e8f\u3002'],
        'cast.clear':['\u5168\u5458\u9000\u573a','\u6240\u6709\u4eba\u7269\u9000\u573a\uff0c\u670d\u88c5\u4fdd\u6301\u4e0d\u53d8\u3002'],
        'actor.outfit.set':['\u6362\u88c5','\u7ed9\u4eba\u7269\u6362\u4e0a\u5217\u51fa\u7684\u4e00\u5957\u670d\u88c5\u3002'],
        'actor.outfit.reset':['\u6062\u590d\u9ed8\u8ba4\u670d\u88c5','\u8ba9\u4eba\u7269\u6362\u56de\u9ed8\u8ba4\u670d\u88c5\u3002'],
        'actor.gaze.set':['\u89c6\u7ebf','\u8ba9\u4eba\u7269\u770b\u5411\u73a9\u5bb6\u3001\u522b\u5904\u6216\u53e6\u4e00\u4f4d\u4eba\u7269\u3002'],
        'actor.light.set':['\u4eba\u7269\u5149\u7167','正常、发光或强逆光剪影；剪影仅用于强逆光或刻意隐藏身份，普通逆光、夜晚和情绪（含悲伤）保持人物可读。'],
        'camera.set':['\u955c\u5934','\u8bbe\u5b9a\u6301\u7eed\u7684\u53d6\u666f\uff0c\u5982\u8fdc\u666f\u3001\u63a8\u8fd1\u6216\u503e\u659c\u3002'],
        'camera.reset':['\u6062\u590d\u955c\u5934','\u56de\u5230\u6b63\u5e38\u53d6\u666f\u3002'],
        'closeup.play':['\u8fd1\u666f','\u7ed9\u4e00\u4f4d\u5728\u573a\u4eba\u7269 4 \u6bb5\u8fd1\u666f\uff0c\u4e4b\u540e\u81ea\u52a8\u6062\u590d\u6b63\u5e38\u53d6\u666f\u3002'],
        'dof.set':['\u666f\u6df1','\u628a\u666f\u6df1\u7126\u70b9\u653e\u5728\u4e00\u4f4d\u5728\u573a\u4eba\u7269\u8eab\u4e0a\u3002'],
        'dof.clear':['\u53d6\u6d88\u666f\u6df1','\u53bb\u6389\u666f\u6df1\u7126\u70b9\u3002'],
        'actor.act.play':['\u4eba\u7269\u52a8\u4f5c','\u8ba9\u5728\u573a\u4eba\u7269\u505a\u4e00\u6b21\u52a8\u4f5c\uff0c\u5982\u70b9\u5934\u3001\u97a0\u8eac\u3002'],
        'actor.emote.play':['\u6f2b\u7b26','\u5728\u573a\u4eba\u7269\u5934\u4e0a\u5f39\u51fa\u4e00\u6b21\u6f2b\u7b26\uff0c\u5982\u611f\u53f9\u53f7\u3001\u95ee\u53f7\u3001\u7231\u5fc3\u3002'],
        'screen.play':['\u753b\u9762\u6548\u679c','\u64ad\u653e\u4e00\u6b21\u9707\u5c4f\u3001\u95ea\u767d\u7b49\u753b\u9762\u6548\u679c\u3002'],
        'screen.set':['画面状态','保持一种画面状态（模糊、提亮、高反差、回忆、黑框），直到取消。'],
        'screen.clear':['取消画面状态','去掉画面状态，回到正常画面。'],
        'transition.play':['\u8f6c\u573a','\u7ed9\u540c\u4e00\u62cd\u91cc\u7684\u6362\u80cc\u666f\u6216\u6e05\u7a7a\u80cc\u666f\u52a0\u8f6c\u573a\u52a8\u753b\u3002'],
        'title.play':['\u6807\u9898','\u663e\u793a\u4e00\u884c\u4e0d\u8d85\u8fc7 24 \u5b57\u7684\u6807\u9898\u3002'],
        'sfx.play':['\u97f3\u6548','\u64ad\u653e\u4e00\u6b21\u5217\u51fa\u7684\u97f3\u6548\u3002'],
        'clock.advance':['\u63a8\u8fdb\u65f6\u95f4','\u8ba9\u7ec4\u4ef6\u7684\u6545\u4e8b\u65f6\u949f\u524d\u8fdb\u82e5\u5e72\u79d2\uff0c\u5230\u65f6\u7684\u7ec4\u4ef6\u968f\u4e4b\u7ed3\u675f\u3002'],
        'cg.set':['\u663e\u793a CG','\u663e\u793a\u4e00\u5f20 CG\uff0c\u6216\u5207\u6362\u5f53\u524d CG \u7684\u5dee\u5206\u3002'],
        'cg.focus.set':['CG \u805a\u7126','\u628a\u753b\u9762\u79fb\u5230\u5f53\u524d CG \u6807\u6ce8\u7684\u67d0\u4e2a\u7126\u70b9\u3002'],
        'cg.focus.reset':['CG \u5168\u56fe','\u91cd\u65b0\u663e\u793a\u6574\u5f20 CG\u3002'],
        'cg.clear':['\u5173\u95ed CG','\u6536\u8d77 CG\uff0c\u9732\u51fa\u821e\u53f0\u548c\u671f\u95f4\u767b\u573a\u7684\u4eba\u7269\u3002']
    });
    // Chinese labels of the effect names, for the UI and for
    // the submit tool's repair (a label sent as the value is accepted as its id); never in a schema or prompt.
    const valueLabels = Object.freeze({
        'screen.play':{effect:{flash:'白闪','flash-red':'红闪','shake-1':'震屏·小','shake-2':'震屏·中','shake-3':'震屏·大',shock:'冲击',blackout:'眼前一黑',glitch:'故障',heartbeat:'心跳'}},
        'screen.set':{look:{blur:'模糊',bright:'提亮',contrast:'高反差',memory:'回忆',vignette:'黑框'}},
        'actor.emote.play':{symbol:{'!':'感叹号','?':'问号','...':'省略号',sweat:'汗',anger:'怒',heart:'爱心',note:'音符',gloom:'阴沉',sparkle:'闪亮',tear:'泪滴'}},
        'transition.play':{transition:{cut:'硬切',fade:'淡入淡出',black:'黑场',white:'白场',wipe:'擦除',iris:'圈入'}}
    });
    // The submit tool's repair table (engine configuration, 0 B of prompt). family: a bare family name means its engine
    // default member (level 1, accepted). synonyms: a near name whose meaning is close but not the same - the op is
    // dropped with a resendable didYouMean (level 2); a value of another command's catalogue moves to that command.
    const repairs = Object.freeze({
        'screen.play':{field:'effect',family:{shake:'shake-2','震屏':'shake-2'},synonyms:{'white-flash':'flash',whiteout:'flash','red-flash':'flash-red',explosion:'shock','black-out':'blackout'},
            moves:{to:'screen.set',field:'look'}},
        'screen.set':{field:'look',synonyms:{sepia:'memory',flashback:'memory',monochrome:'memory','soft-focus':'blur',unfocus:'blur','black-frame':'vignette'},moves:{to:'screen.play',field:'effect'}},
        'actor.emote.play':{field:'symbol',synonyms:{tears:'tear',cry:'tear',crying:'tear',love:'heart',music:'note',angry:'anger',star:'sparkle'}},
        'transition.play':{field:'transition'}
    });
    const definitions = [];
    function add(name,toggle,properties,consume,options = {}) {
        const definition = {name,version,category:dimensionGroups.find(([,items]) => items.some(([key]) => key === toggle))?.[0] || 'Performance',toggle,requires:[],persistence:'state',promptLine:'',defaults:{},summary:options.summary,label:ui[name]?.[0],help:ui[name]?.[1],...options,consume};
        if (!ui[name]) throw new Error('Director command without a UI label: '+name);
        definition.examples = context => {
            const schema = definition.schema(context), defs = directorCommands.defs(context);
            const sample = s => s.$ref ? sample(defs[s.$ref.split('/').at(-1)]) : s.const !== undefined ? s.const : s.enum ? s.enum[0] : s.oneOf ? sample(s.oneOf[0]) : s.type === 'object' ? Object.fromEntries((s.required || []).map(key => [key,sample(s.properties[key])])) : s.type === 'array' ? Array.from({length:s.minItems || 0},() => sample(s.items)) : s.type === 'boolean' ? false : s.type === 'integer' || s.type === 'number' ? s.minimum ?? 0 : 'example';
            const example = sample(schema);
            for (const [field,kind] of Object.entries(definition.refs || {})) if (schema.required.includes(field)) {
                const value = rows(context,kind).find(row => !definition.lookLayer || row.asset.layer === definition.lookLayer)?.ref || {packId:'PACK_UUID',kind,assetId:'ASSET_ID'};
                example[field] = schema.properties[field].type === 'array' ? [value] : value;
            }
            if (example.outfit) example.outfit = context.actors[example.actor]?.outfits[0]?.key || 'OUTFIT_KEY';
            return [example];
        };
        definition.schema = c => {
            const props = typeof properties === 'function' ? properties(c) : properties;
            return shape({op:{const:name},...props},['op',...(definition.required || Object.keys(props))]);
        };
        definition.configured = c => (toggle !== 'items' || c.items?.enabled === true) && c.dimensions[toggle] !== false && definition.requires.every(key => c.dimensions[key] !== false);
        definition.grammar = c => options.grammar ? shape({op:{const:name},...options.grammar}) : definition.schema(c);
        definition.enabled = c => !c.modCommands?.some(command => command.replaces===name) && definition.configured(c) && !c.unavailableCommands?.includes(definition.name) && (!definition.available || definition.available(c));
        definition.validate = (op,c,state,api) => {
            const figure = c.actors[op.actor];
            if (figure && !figure.emotions?.some(row=>row.label !== undefined)) {
                for (const field of ['emotion','difference']) if (Object.hasOwn(op,field)) api.check(false,'$.'+field,figure.name+' has no variants; omit '+field+'.','UNKNOWN_FIELD');
            }
            api.schema(op,definition.schema(c));
            if (op.actor !== undefined) api.check(Object.hasOwn(c.actors,op.actor),'$.actor','Choose a listed actor.','ARG_INVALID');
            for (const [field,kind] of Object.entries(definition.refs || {})) if (op[field] !== undefined) {
                if (definition.schema(c).properties[field].type === 'array') op[field].forEach((ref,index) => api.recalled(ref,kind,'$.'+field+'['+index+']'));
                else api.recalled(op[field],kind,'$.'+field);
            }
            // Mutually exclusive argument groups: one declaration drives this check and describe().
            for (const group of definition.exclusive || []) {
                const given = group.filter(field => op[field] !== undefined && op[field] !== null && op[field] !== '');
                api.check(given.length <= 1,'$.'+given.at(-1),'Use either '+group.join(' or ')+', not both.','ARG_INVALID');
            }
            definition.precondition?.(op,c,state,api);
        };
        definitions.push(Object.freeze(definition));
    }
    const onstage = (op,c,state,api) => api.check(state.cast.includes(op.actor),'$.actor','Enter this actor first or choose a current cast actor.','PRECONDITION');
    add('item.play','items',{action:en(['gain','lose','show']),ref,variant:{type:'string'}},op => op,{required:['action','ref'],refs:{ref:'props'},available:available('props'),persistence:'event',summary:'Show an item; MVU settles changes.',promptLine:'- item.play: show important items; gain/lose need an inventory binding, with quantities revised after settlement.'});
    add('performance.set','performance',{ref,level:int(1,3),topic:{type:'string',minLength:1,maxLength:160},sec:{type:'number',minimum:0.001,maximum:86400}},op => ({op:'perform',id:op.ref,level:op.level,topic:op.topic,sec:op.sec}),{required:['ref'],refs:{ref:'performances'},available:available('performances'),summary:'Start or retain a recalled performance combination; follow its directorNote.'});
    add('performance.off','performance',{},() => ({op:'perform.off'}),{available:available('performances'),summary:'End the current performance combination through its exit.'});
    const actorOptions = {requires:['actors','cast']};
    const transient = {persistence:'event',requires:['events']};
    add('scene.set','scene',{background:ref,time:en(['day','dusk','night',null]),variant},op => ({op:'scene.set',value:{background:op.background,timeOfDay:op.time,...(op.variant ? {variant:op.variant} : {})}}),{summary:"Select a recalled background and explicit story time; preserve other stage state.",required:['background','time'],refs:{background:'backgrounds'},available:available('backgrounds'),promptLine:'- scene.set: change the background when the location changes; choose by kind of space, use and indoors or outdoors before mood (a courtyard is outdoors). Overlays such as a CG or title card keep it. Take time from the story, never from an asset\'s name.'});
    add('scene.variant','scene',{variant,ref},op=>op,{required:['variant'],refs:{ref:'backgrounds'},available:available('backgrounds'),summary:'Switch the current background variant without changing location or time.',precondition:(op,c,state,api)=>api.check(!!state.scene,'$.op','Set a scene first.','PRECONDITION')});
    add('scene.clear','scene',{},op => op,{summary:"Clear the background for an intentional empty stage, not missing art.",promptLine:'- scene.clear: only for a deliberately empty stage, not because nothing fits. Between scenes, send the next scene.set in the same or next beat; a title card covers the scene without clearing it.',cuePromptLine:'scene.clear: if the lights go out and the scene turns pitch dark, clear the background; otherwise it stays visible.'});
    add('lighting.mood.set','lighting.mood',{ref},op => patch({lighting:{mood:op.ref}}),{summary:"Select a mood-layer look, subject to pacing rules.",requires:['lighting'],refs:{ref:'looks'},lookLayer:'mood',available:c => rows(c,'looks').some(row => row.asset.layer === 'mood'),promptLine:'- lighting.mood: ordinary looks hold for 8 paragraphs; event looks follow their story trigger and end, even during performances.'});
    add('lighting.mood.clear','lighting.mood',{},() => patch({lighting:{mood:null}}),{summary:"Remove the mood look without changing time lighting.",requires:['lighting']});
    add('weather.set','weather',{weather:en(['rain','storm','snow','sakura','leaves','sparkle'])},op => patch({weather:op.weather}),{summary:"Set persistent weather."});
    add('weather.clear','weather',{},() => patch({weather:'none'}),{summary:"Remove the weather."});
    add('ambience.set','soundscape',{refs:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:ref}},op => ({op:'soundscape.set',refs:op.refs}),{summary:'Replace the ambience with one or two looping layers.',requires:['sound'],refs:{refs:'ambience'},available:available('ambience'),promptLine:"- ambience.set: one or two looping layers; they keep playing until the story's sound changes, even across scene or weather changes."});
    add('ambience.clear','soundscape',{},() => ({op:'soundscape.clear'}),{summary:'Remove all ambience.',requires:['sound']});
    const musicOverride = {force:{type:'boolean',description:'With reason for further music changes; not same-track resume.'},reason:{type:'string',minLength:1,maxLength:120}};
    add('music.set','music',{ref,...musicOverride},op => ({op:'music.set',value:op.ref,...(op.force === undefined ? {} : {force:op.force}),...(op.reason === undefined ? {} : {reason:op.reason})}),{summary:'Change BGM.',required:['ref'],refs:{ref:'music'},available:available('music')});
    add('music.clear','music',musicOverride,op => ({...op,op:'music.stop'}),{summary:'Stop the BGM, leaving silence.',required:[]});
    add('cast.add','cast',c => ({actor,...(c.dimensions.position ? {position:en(['left','center','right']),after:actor} : {})}),op => ({op:'actor.enter',actor:op.actor,...(op.after ? {position:'after '+op.after} : op.position ? {position:op.position} : {})}),{summary:"Bring one actor on stage without moving the others; omitted position appends right.",...actorOptions,required:['actor'],defaults:{position:'right'},exclusive:[['position','after']],precondition(op,c,state,api) {
        const cast = state.cg?.resumeCast || state.cast;
        api.check(!(cast.includes(op.actor) && (op.position || op.after)),'$.actor','Use actor.move to reposition an on-stage actor.','PRECONDITION');
        if (op.after) api.check(cast.includes(op.after),'$.after','Choose an on-stage insertion anchor.','PRECONDITION');
    }});
    add('actor.move','position',{actor,position:en(['left','center','right']),after:actor},op => ({op:'actor.move',actor:op.actor,position:op.after ? 'after '+op.after : op.position || 'right'}),{...actorOptions,required:['actor'],defaults:{position:'right'},exclusive:[['position','after']],summary:'Slide an on-stage actor to a new slot; omitted position means right.',precondition(op,c,state,api) {
        const cast = state.cg?.resumeCast || state.cast;
        api.check(cast.includes(op.actor),'$.actor','Choose an on-stage actor.','PRECONDITION');
        if (op.after) api.check(op.after !== op.actor && cast.includes(op.after),'$.after','Choose another on-stage anchor.','PRECONDITION');
    }});
    add('cast.remove','cast',{actor},op => ({op:'actor.exit',actor:op.actor}),{...actorOptions,summary:"Take one actor off stage and end its close-up."});
    add('cast.set','cast',{actors:{type:'array',uniqueItems:true,items:actor}},op => patch({cast:op.actors}),{summary:"Set the cast, preserving survivor order and appending arrivals.",promptLine:'- cast.set: list the actors who stay in their current order, then any arrivals; to place one arrival elsewhere, use cast.add with a position.',...actorOptions,precondition(op,c,state,api) {
        const cast = state.cg?.resumeCast || state.cast;
        const ordered = cast.filter(id => op.actors.includes(id)).concat(op.actors.filter(id => !cast.includes(id)));
        api.check(JSON.stringify(ordered) === JSON.stringify(op.actors),'$.actors','Keep survivors in order; append arrivals.','PRECONDITION');
    }});
    add('cast.clear','cast',{},op => op,{...actorOptions,summary:"Remove all on-stage actors without resetting their outfits."});
    add('actor.outfit.set','outfit',{actor,outfit:str},op => ({op:'actor.variant',actor:op.actor,value:op.outfit}),{summary:"Select a recalled outfit owned by the actor; omission keeps the current outfit.",...actorOptions,precondition(op,c,state,api) {
        api.check(c.actors[op.actor]?.outfits.some(row => row.enabled && row.key === op.outfit) && (c.outfits[op.actor].some(row => row.key === op.outfit) || state.actors[op.actor]?.outfitKey === op.outfit),'$.outfit','Choose a recalled outfit key owned by this actor.','REF_UNAVAILABLE');
    }});
    add('actor.outfit.reset','outfit',{actor},op => ({op:'actor.reset',actor:op.actor}),{...actorOptions,summary:"Return the actor to the default outfit."});
    add('actor.gaze.set','gaze',{actor,target:{oneOf:[en(['viewer','away']),shape({actor})]}},op => actorPatch(op,{gaze:op.target.actor || op.target}),{summary:"Aim an actor at the viewer, away, or another actor; never itself.",...actorOptions,precondition(op,c,state,api) {
        api.check(op.target.actor !== op.actor,'$.target.actor','Choose another actor, viewer or away.','PRECONDITION');
    }});
    add('actor.light.set','actorLight',{actor,light:en(['lit','glow','shadow'])},op => actorPatch(op,{figureLight:op.light}),{...actorOptions,summary:"Persistent actor light; shadow silhouettes only strong backlight (sunset/spotlight/glare) or deliberately hidden identity, not mood/sadness/night; ordinary backlight stays lit.",promptLine:'- actor.light.set: shadow silhouettes only strong backlight (sunset/spotlight/glare) or deliberately hidden identity; keep lit for ordinary backlight, night or emotion (including sadness).'});
    add('camera.set','camera',{mode:en(['wide','push','pan-left','pan-right','dutch'])},op => patch({camera:{mode:op.mode,actor:null}}),{summary:"Set persistent framing.",capKey:'cam'});
    add('camera.reset','camera',{},() => patch({camera:{mode:'reset',actor:null}}),{summary:"Return to normal framing.",capKey:'cam'});
    add('closeup.play','camera.close',{actor},op => patch({camera:{mode:'close',actor:op.actor}}),{summary:"Frame an on-stage actor for four paragraphs, then return to normal framing.",requires:['camera','actors','cast'],capKey:'cam',precondition:onstage,persistence:'temporary',promptLine:"- closeup.play: frames one actor for 4 paragraphs, then normal framing returns; a location change, the actor's exit or the end of the reply cuts it short."});
    add('dof.set','dof',{actor},op => patch({dof:op.actor}),{summary:"Focus depth of field on an on-stage actor, independently of camera commands.",requires:['actors','cast'],precondition:onstage});
    add('dof.clear','dof',{},() => patch({dof:null}),{summary:"Remove the depth-of-field focus."});
    add('actor.act.play','acts',{actor,motion:en(['nod','shake','jump','tremble','turn','bow','lean','step-back'])},event('act','motion',true),{summary:"Play one motion on an on-stage actor; never persist or replay on history.",...transient,requires:['events','actors','cast'],capKey:'act',perActor:true,precondition:onstage});
    // manpu are comic marks drawn over the figure (tear: a
    // comic drop); body changes - blush, real tears - belong to the emotion's expression, never to an emote.
    add('actor.emote.play','emotes',{actor,symbol:en(['!','?','...','sweat','anger','heart','note','gloom','sparkle','tear'])},event('emote','symbol',true),{summary:"Play one emote on an on-stage actor.",...transient,requires:['events','actors','cast'],precondition:onstage});
    add('screen.play','screenEffects',{effect:en(['shake-1','shake-2','shake-3','flash','flash-red','glitch','shock','heartbeat','blackout'])},event('beat','effect'),{summary:"Play one screen effect without changing persistent state.",...transient,capKey:'beat'});
    // A screen look holds across turns and locations until screen.clear ; at most 4 changes a turn.
    add('screen.set','screenEffects',{look:en(['blur','bright','contrast','memory','vignette'])},op => patch({screen:op.look}),{summary:"Hold a screen look until screen.clear.",capKey:'screen'});
    add('screen.clear','screenEffects',{},() => patch({screen:null}),{summary:"Remove the screen look.",capKey:'screen'});
    add('transition.play','transitions',{transition:en(['cut','fade','black','white','wipe','iris'])},event('trans','transition'),{summary:"Play a transition after scene.set or scene.clear in the same beat.",...transient,requires:['events','scene'],promptLine:'- transition.play: animates a scene.set or scene.clear placed before it in the same beat.'});
    add('title.play','titles',{text:{type:'string',minLength:1,maxLength:24}},event('title','text'),{summary:"Show a nonblank title of at most 24 characters.",...transient,capKey:'title',precondition(op,c,state,api) {api.check(op.text.trim().length > 0,'$.text','Use a nonblank title of at most 24 characters.','ARG_INVALID');}});
    add('sfx.play','sfx',{ref},event('sfx','ref'),{summary:"Play one recalled sound effect.",...transient,capKey:'sfx',refs:{ref:'sfx'},available:available('sfx')});
    add('clock.advance','widgets',{seconds:int(0,86400)},op => ({op:'clock.advance',value:op.seconds}),{summary:"Advance widget story time by seconds and expire timed widgets.",capKey:'clock.advance',available:c => rows(c,'widgets').some(row => row.widget?.lifetime?.durationSeconds !== undefined)});
    const cgKey = {type:'string',minLength:1,maxLength:64};
    const cgActive = (op,c,state,api) => api.check(!!state.cg,'$.op','Show a CG first.','PRECONDITION');
    add('cg.set','cg',{cg:ref,variant,transition:en(['fade','white'])},op => ({...op,op:'cg.show'}),{required:['cg'],refs:{cg:'cg'},available:available('cg'),summary:'Show a CG, or change the variant of the one shown; omitted variant uses the default.',defaults:{variant:'asset default',transition:'fade'},promptLine:'- CG: cg.set without a variant shows the default; on the CG already shown it only switches the variant. Actors entering during a CG appear once cg.clear or a location change removes it.'});
    add('cg.variant','cg',{variant,ref},op=>op,{required:['variant'],refs:{ref:'cg'},precondition:cgActive,available:available('cg'),summary:'Switch the current CG variant without replaying its entrance.'});
    add('cg.focus.set','cg',{focus:cgKey},op => ({op:'cg.pan',focus:op.focus}),{precondition(op,c,state,api) {
        cgActive(op,c,state,api);
        const hints = api.content(state.cg.ref,state.cg.variant ?? undefined).focusHints || [];
        api.check(hints.length > 0,'$.focus','This CG has no listed focus; omit cg.focus.set.','DISABLED');
        api.check(op.focus !== 'full','$.focus','Choose a listed focus; cg.focus.reset shows the whole CG.','ARG_INVALID');
    },summary:'Move to a listed focus of the shown CG.'});
    add('cg.focus.reset','cg',{},() => ({op:'cg.pan',focus:'full'}),{precondition:cgActive,summary:'Show the whole CG again.'});
    add('cg.clear','cg',{},() => ({op:'cg.hide'}),{summary:'Remove the CG and reveal the stage, including actors who entered meanwhile.'});
    const byName = Object.freeze(Object.assign(Object.create(null),Object.fromEntries(definitions.map(item => [item.name,item]))));
    if (Object.keys(byName).length !== definitions.length) throw new Error('Duplicate director command');
    const widgetKey = ref => ref && [ref.packId,ref.kind,ref.assetId].join('/');
    function widgetDefinitions(context) {
        return rows(context,'widgets').flatMap(row => (row.widget?.commands || []).map(command => {
            const name = 'widget.' + row.widget.namespace + '.' + command.name;
            const schema = c => {
                const properties = {...command.params.properties};
                for (const key of Object.keys(command.bindings || {})) properties[key] = {...properties[key],enum:c.phone?.aliases || []};
                return shape({op:{const:name},ref:{const:row.ref},...properties},['op','ref',...command.params.required]);
            };
            const sample = s => s.default ?? s.enum?.[0] ?? (s.type === 'object' ? Object.fromEntries(s.required.map(key => [key,sample(s.properties[key])])) : s.type === 'array' ? Array.from({length:s.minItems || 0},()=>sample(s.items)) : s.type === 'boolean' ? false : ['integer','number'].includes(s.type) ? s.minimum : 'example'.padEnd(s.minLength || 0,'x').slice(0,s.maxLength));
            const definition = {name,version,ref:row.ref,widget:row.widget,command,summary:command.summary,category:'Widgets',toggle:'widgets',requires:[],refs:{ref:'widgets'},defaults:Object.fromEntries(Object.entries(command.params.properties).filter(([,s])=>s.default !== undefined).map(([key,s])=>[key,s.default])),persistence:command.effect === 'source.mark' ? 'marker' : 'state',effect:command.effect,capKey:'widget.'+command.name,schema,
                enabled:c => c.dimensions.widgets !== false && rows(c,'widgets').some(item => widgetKey(item.ref) === widgetKey(row.ref)),
                examples:c => Object.keys(command.bindings || {}).length && !c.phone?.aliases.length ? [] : [{op:name,ref:row.ref,...sample({...command.params,properties:schema(c).properties})}],
                validate(op,c,state,api) {
                    api.schema(op,schema(c));api.recalled(op.ref,'widgets','$.ref');
                    const {op:ignored,ref,...params}=op;
                    api.check(new TextEncoder().encode(JSON.stringify(params)).length <= row.widget.caps.bytes,'$','Widget parameter byte cap','CAP_EXCEEDED');
                },
                consume(op) {const {op:ignored,ref,...params}=op;return command.effect === 'source.mark' ? {op:'widget.source',ref,...params} : {op:'widget.state',effect:command.effect,ref,params};}
            };
            return definition;
        }));
    }
    // Frozen, declarative admission data comes from the registered first-party compiler.
    const checkModAdmission = (command,params,check) => {
        for (const field of command.admission?.nonblank || []) if (params[field] !== undefined)
            check(typeof params[field] === 'string' && params[field].trim().length > 0,'$.'+field,'Use nonblank text or omit this optional field.','ARG_INVALID');
        for (const rule of command.admission?.lists || []) if (params[rule.selector] === rule.value) {
            const values=params[rule.field],path='$.'+rule.field;
            check(Array.isArray(values) && values.length >= rule.minItems && values.length <= rule.maxItems,path,`${rule.value}: provide ${rule.minItems}-${rule.maxItems} text entries.`, 'ARG_INVALID');
            for (const [index,value] of values.entries()) {
                check(typeof value === 'string' && value.trim().length > 0 && [...value].length <= rule.maxLength,path+'['+index+']',`${rule.value}: use nonblank text of at most ${rule.maxLength} characters.`, 'ARG_INVALID');
                if(rule.enum)check(rule.enum.includes(value),path+'['+index+']',`${rule.value}: choose ${rule.enum.join(', ')}.`, 'ARG_INVALID');
            }
        }
        for (const rule of command.admission?.requires || []) if (rule.values.includes(params[rule.field]))
            check(rule.available,'$.'+rule.field,rule.code,rule.code);
        for (const rule of command.admission?.names || []) {
            if (params[rule.force] === true) continue;
            const group = rule.groups.find(row => row.value === params[rule.scope]);
            const normalized = String(params[rule.field]).normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
            const names = group?.terms.find(row => row.term === normalized)?.names || [];
            const candidates = (names.length ? names : group?.candidates || []).slice(0,3);
            if (names.length !== 1) {
                const code = names.length ? rule.ambiguous : rule.unknown;
                try {check(false,'$.'+rule.field,'Choose a listed '+rule.field+' for this '+rule.scope+(candidates.length ? ': '+candidates.join(', ') : '')+'; or set '+rule.force+':true to use the supplied name with its category icon.',code);}
                catch (error) {error.modError = {candidates}; throw error;}
            }
        }
    };
    // The host supplies validated first-party commands; records never load a module.
    const modDefinitions = context => (context?.modCommands || []).map(command => {
        const params = op => command.paramsStyle === 'flat' ? Object.fromEntries(Object.entries(op).filter(([key])=>key!=='op')) : op.params;
        const schema = () => command.paramsStyle === 'flat' ? {...command.params,properties:{op:{const:command.op},...command.params.properties},required:['op',...(command.params.required || [])]} : shape({op:{const:command.op},params:command.params});
        return {name:command.op,version,mod:{id:command.modId,commandId:command.id},command,dsl:command.dsl,
            summary:command.dsl.syntax,category:'Mods',toggle:'mods',requires:[],refs:{},defaults:{},persistence:command.persistence,
            ...(command.admission?.source === 'phone.message' ? {effect:'source.mark'} : {}),
            schema,enabled:()=>true,examples:()=>[],
            validate(op,c,state,api) {api.schema(op,schema());api.check(new TextEncoder().encode(JSON.stringify(params(op))).length<=command.caps.bytes,'$.params','Mod command byte cap','CAP_EXCEEDED');checkModAdmission(command,params(op),api.check);},
            consume:op=>({op:'mod.command',modId:command.modId,commandId:command.id,params:params(op)})};
    });
    const resolve = (op,context) => typeof op?.op !== 'string' ? undefined : Object.hasOwn(byName,op.op) ? byName[op.op] : widgetDefinitions(context).find(item => item.name === op.op && widgetKey(item.ref) === widgetKey(op.ref)) || modDefinitions(context).find(item=>item.name===op.op);
    const selected = context => [...definitions.filter(item => item.enabled(context)),...widgetDefinitions(context).filter(item => item.enabled(context)),...modDefinitions(context)];
    const schemas = context => selected(context).map(item => item.schema(context));
    // Arbitrary pack vocabularies remain named flat parameters, but never enter provider grammar.
    // capability availability is stable across recall windows, not across disabled packs.
    const widgetAvailable = context => context.dimensions.widgets !== false && context.catalogue.rows.some(row => row.ref.kind === 'widgets' && (!row.excluded || ['below-fill-rank','no-fill-threshold'].includes(row.excluded)));
    const advertised = (item,context) => item.configured(context) && (item.toggle !== 'widgets' || widgetAvailable(context) && context.catalogue.rows.some(row => row.ref.kind === 'widgets' && (!row.excluded || ['below-fill-rank','no-fill-threshold'].includes(row.excluded)) && row.widget?.lifetime?.durationSeconds !== undefined));
    const grammar = context => [...definitions.filter(item => advertised(item,context)).map(item => item.grammar(context)),...(widgetAvailable(context) ? [{type:'object',properties:{op:{type:'string',pattern:'^widget\\.[a-z][a-z0-9-]{0,31}\\.(set|update|clear|mark)$'},ref},required:['op','ref'],additionalProperties:true}] : []),...modDefinitions({...context,modCommands:context.schemaModCommands || context.modCommands}).map(item=>item.schema())];
    const grammarDefs = () => ({actor:str,ref:shape({packId:{type:'string',format:'uuid'},kind:en(['backgrounds','looks','music','sfx','ambience','widgets','performances','cg']),assetId:str})});
    function consume(op,context) {
        const definition = context ? resolve(op,context) : byName[op.op];
        if (!definition) throw new Error('Unregistered director command: '+op.op);
        return definition.consume(op);
    }
    function describe(context,name,ref) {
        // Ownership for the panel: a mod command names its mod and what it replaces; a core command a mod replaces names that mod.
        const replacer = item => context?.modCommands?.find(command => command.replaces === item.name);
        // Only groups whose fields this context's schema offers (cast.add has no position/after when position is off).
        const exclusiveGroups = (item,c) => {const props = c ? item.schema(c).properties : {};return (item.exclusive || []).filter(group => group.filter(field => Object.hasOwn(props,field)).length > 1).map(group => [...group]);};
        return [...definitions,...widgetDefinitions(context),...modDefinitions(context)].filter(item => (!name || item.name === name) && (!ref || !item.ref || widgetKey(item.ref) === widgetKey(ref))).map(item => ({name:item.name,summary:item.summary,category:item.category,
            ...(item.label ? {label:item.label,help:item.help} : {}),
            ...(exclusiveGroups(item,context).length ? {exclusive:exclusiveGroups(item,context)} : {}),
            ...(item.mod ? {source:'mod',mod:{id:item.mod.id,commandId:item.mod.commandId},mode:item.command.mode || 'adds',...(item.command.replaces ? {replaces:item.command.replaces} : {})} : {}),
            ...(!item.mod && !item.ref && replacer(item) ? {replacedBy:{modId:replacer(item).modId,commandId:replacer(item).id,op:replacer(item).op}} : {}),...(item.ref ? {ref:item.ref,source:'widget',effect:item.effect,details:item.command.help?.details} : {}),args:item.schema(context),defaults:item.defaults,persistence:item.persistence,enabled:item.enabled(context),examples:item.examples(context)}));
    }
    function suggestion(name) {
        if (typeof name === 'string' && name.startsWith('actor.focus.')) return 'closeup.play';
        const parts = String(name || '').split('.');
        return definitions.map(item => ({name:item.name,score:item.name.split('.').filter(part => parts.includes(part)).length})).filter(item => item.score).sort((a,b) => b.score-a.score)[0]?.name;
    }
    // ---- the submit tool's repair: one tolerant reading of a name, at submit only;
    // records and renderers know canonical ids alone.
    const enumOf = (name,field) => byName[name]?.schema({actors:{},dimensions:{},catalogue:{candidates:{}}}).properties[field]?.enum;
    // Spelling only: case, width, spaces / underscores, a digit without its hyphen, the emote punctuation forms.
    function spelled(value,values) {
        if (typeof value !== 'string') return undefined;
        const text = value.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g,'-');
        if (values.includes(text)) return text;
        if (/^\.{2,}$/.test(text) && values.includes('...')) return '...';
        if (/^!+$/.test(text) && values.includes('!')) return '!';
        if (/^\?+$/.test(text) && values.includes('?')) return '?';
        const digit = /^([a-z]+)-?(\d)$/.exec(text);
        if (digit && values.includes(digit[1] + '-' + digit[2])) return digit[1] + '-' + digit[2];
        return undefined;
    }
    // Level 1: the same name written differently, a UI label, or a family's default member -> {op, normalized} | null.
    function normalize(op) {
        const rule = typeof op?.op === 'string' && Object.hasOwn(repairs,op.op) && repairs[op.op];
        if (!rule || !Object.hasOwn(op,rule.field) || typeof op[rule.field] !== 'string') return null;
        const values = enumOf(op.op,rule.field), received = op[rule.field];
        if (!values || values.includes(received)) return null;
        const labels = valueLabels[op.op]?.[rule.field] || {}, text = received.normalize('NFKC').trim();
        const used = spelled(received,values) ?? Object.keys(labels).find(id => labels[id] === text) ?? rule.family?.[text.toLowerCase()];
        return used === undefined ? null : {op:{...op,[rule.field]:used},normalized:[{path:'$.'+rule.field,received,used}]};
    }
    // Level 2: a resendable op for a near name (a synonym, the other screen command, an unknown op naming a listed value),
    // or undefined. The op it repairs is dropped; nothing is accepted on a guess that changes the meaning.
    function didYouMean(op,error,known = false) {
        if (!op || typeof op.op !== 'string') return undefined;
        const rule = Object.hasOwn(repairs,op.op) && repairs[op.op];
        if (rule && typeof op[rule.field] === 'string') {
            const text = op[rule.field].normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g,'-');
            const synonym = rule.synonyms?.[text];
            if (synonym) return {...op,[rule.field]:synonym};
            if (rule.moves) {
                const other = enumOf(rule.moves.to,rule.moves.field), moved = other && (spelled(text,other) ?? repairs[rule.moves.to]?.synonyms?.[text]);
                if (moved) return {op:rule.moves.to,[rule.moves.field]:moved};
            }
        }
        // A black transition with no scene change before it is the one-shot blackout.
        if (op.op === 'transition.play' && op.transition === 'black' && error?.code === 'PRECONDITION') return {op:'screen.play',effect:'blackout'};
        if (known || Object.hasOwn(byName,op.op)) return undefined;
        // An unknown op whose last part is a listed value of a command in its namespace: screen.flash -> screen.play flash.
        const at = op.op.lastIndexOf('.'), noun = op.op.slice(0,at), verb = op.op.slice(at + 1);
        for (const name of Object.keys(repairs).filter(name => at > 0 && name.startsWith(noun + '.'))) {
            const field = repairs[name].field, values = enumOf(name,field), value = values && (spelled(verb,values) ?? repairs[name].synonyms?.[verb.toLowerCase()]);
            if (value) {const {op:ignored,...rest} = op; return {op:name,...rest,[field]:value};}
        }
        const named = suggestion(op.op);
        if (!named) return undefined;
        const {op:ignored,...rest} = op, fields = Object.keys(byName[named].schema({actors:{},dimensions:{},catalogue:{candidates:{}}}).properties);
        return {op:named,...Object.fromEntries(Object.entries(rest).filter(([key]) => fields.includes(key)))};
    }
    return Object.freeze({version,dimensionGroups,dimensions,definitions:Object.freeze(definitions),byName,resolve,selected,schemas,grammar,grammarDefs,consume,describe,suggestion,
        valueLabels,repairs,normalize,didYouMean,
        recordedOps, retiredOperation,
        recordOperation:(op,binding) => {
            if (!op || typeof op.op !== 'string' || retiredOperation(op)) return null;
            if (op.op==='mod.command') return binding?.mods?.commands.some(row=>row.modId===op.modId && row.commandId===op.commandId) ? op : null;
            if (binding && binding.commandSpecVersion === undefined) {
                if (!recordedOps.has(op.op)) return null;
                if (op.op === 'scene.set' && op.value?.timeOfDay === 'morning') {
                    const value = {...op.value,timeOfDay:'day'};
                    if (value.timeLook?.assetId === 'morning') value.timeLook = {...value.timeLook,assetId:'day'};
                    return {...op,value};
                }
                return op;
            }
            // historical skin commands are readable, never model-facing definitions.
            if (op.op === 'skin.set') return {op:'skin.set',value:op.ref,...(op.level === undefined ? {} : {level:op.level})};
            if (op.op === 'skin.off') return {op:'skin.off'};
            if (/^widget\.[a-z][a-z0-9-]{0,31}\.mark$/.test(op.op)) return {op:'widget.source',ref:op.ref,contact:op.contact,side:op.side};
            if (!byName[op.op]) return null;
            try {return consume(op);} catch {return null;}
        },
        index:context => {
            const groups = new Map();
            for (const {name} of definitions.filter(item => !context?.modCommands?.some(command => command.replaces===item.name) && (!context || item.enabled(context)) && (item.toggle !== 'items' || context?.items?.enabled === true))) {
                const at = name.lastIndexOf('.'), noun = name.slice(0,at);
                if (!groups.has(noun)) groups.set(noun,[]);
                groups.get(noun).push(name.slice(at+1));
            }
            return [...groups].map(([noun,verbs]) => noun+':'+verbs.join(',')).join(';');
        },
        prompt:context => [...new Set(selected(context).map(item => item.promptLine).filter(Boolean))].join('\n'),
        checkModAdmission,
        defs:context => ({actor:en(Object.keys(context.actors)),ref:shape({packId:{type:'string',format:'uuid'},kind:en([...new Set(selected(context).flatMap(item => Object.values(item.refs || {})))]),assetId:str})})});
})();
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = directorCommands;
