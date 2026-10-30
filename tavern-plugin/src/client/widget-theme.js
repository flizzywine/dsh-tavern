// @include widget-theme.cjs
const stageWidgetThemeOwners=new WeakMap(),stageWidgetPaletteCache=new Map();
let stageWidgetPaletteQueue=Promise.resolve();
function stageWidgetPalette(hash,url) {
    const key='oklab-1:'+hash;
    if(stageWidgetPaletteCache.has(key)){const value=stageWidgetPaletteCache.get(key);stageWidgetPaletteCache.delete(key);stageWidgetPaletteCache.set(key,value);return value;}
    // One small analysis at a time. Keep only scalar results, never another decoded background.
    const promise=stageWidgetPaletteQueue.then(()=>new Promise(resolve=>{
        const image=new Image();image.onerror=()=>resolve(null);
        image.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,32,32);resolve(stageWidgetAnalysePixels(context.getImageData(0,0,32,32).data));}catch{resolve(null);}};
        image.src=url;
    }));
    stageWidgetPaletteQueue=promise.then(()=>{});stageWidgetPaletteCache.set(key,promise);
    while(stageWidgetPaletteCache.size>128)stageWidgetPaletteCache.delete(stageWidgetPaletteCache.keys().next().value);
    return promise;
}
function stageWidgetBuiltinTheme(element) {
    const style=getComputedStyle(element),theme={},canvas=document.createElement('canvas');
    // Token conversion is a CPU readback, not artwork: avoid a GPU sync per color.
    canvas.width=canvas.height=1;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    const tokens={accent:'accent',accentText:'accent-ink',surface:'surface',surfaceText:'ink',muted:'ink-2',border:'line'};
    for(const [key,source] of Object.entries(tokens)){
        const value=style.getPropertyValue('--gal-ui-'+source).trim();if(!value)continue;
        context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);const rgba=context.getImageData(0,0,1,1).data;
        if(rgba[3]===255)theme[key]=stageWidgetThemeHex([...rgba].slice(0,3).map(v=>v/255));
    }
    const radius=parseFloat(style.getPropertyValue('--gal-ui-radius'));if(Number.isFinite(radius))theme.radius=Math.max(0,Math.min(40,radius));
    return theme;
}
function useWidgetTheme(rootRef,scene,skin,{theme='classic',snap=false,reducedMotion=false}={}) {
    const [sample,setSample]=React.useState({hash:null,value:null}),[revision,wake]=React.useState(0);
    const identity=scene?.backgroundMedia?.identity,hash=identity?.split(':').at(-1),url=scene?.backgroundUrl;
    React.useEffect(()=>{
        if(!hash || typeof url!=='string')return;
        let active=true;stageWidgetPalette(hash,url).then(value=>{if(active)setSample({hash,value});});return()=>{active=false;};
    },[hash,url]);
    React.useLayoutEffect(()=>{
        const root=rootRef.current;if(!root)return;
        const refresh=()=>wake(n=>n+1),observer=new MutationObserver(refresh);
        observer.observe(document.body,{attributes:true,attributeFilter:['class','style']});
        observer.observe(root,{attributes:true,attributeFilter:['class','data-theme']});
        const unsubscribe=typeof tavernFonts==='undefined'?()=>{}:tavernFonts.subscribe(refresh);
        return()=>{observer.disconnect();unsubscribe();};
    },[rootRef]);
    React.useLayoutEffect(()=>{
        const root=rootRef.current;if(!root)return;
        const builtin=stageWidgetBuiltinTheme(root),font=id=>typeof tavernFonts==='undefined'?'serif':tavernFonts.resolve('stage',{theme,...(id?{skin:{body:id}}:{})}).family; // the stage role, user override first
        builtin.fontFamily=font();builtin.headingFont=font();
        const derived=stageWidgetDerivedTheme(sample.hash===hash?sample.value:null,stageWidgetThemeLuminance(builtin.surface || '#242321')<.5);
        const value=stageWidgetComposeTheme({builtin,derived,skin,background:hash ? scene?.stageTheme || {} : {},font});
        const previous=stageWidgetThemeOwners.get(root),signature=JSON.stringify(value.theme);
        const next={...value,signature,transitionMs:!previous || snap || reducedMotion ? 0 : 200};
        stageWidgetThemeOwners.set(root,next);
        if(signature!==previous?.signature)root.dispatchEvent(new Event('widget-theme'));
        return()=>{};
    },[rootRef,hash,scene?.stageTheme,skin,theme,snap,reducedMotion,sample,revision]);
    React.useEffect(()=>()=>{if(rootRef.current)stageWidgetThemeOwners.delete(rootRef.current);},[rootRef]);
}
function stageWidgetThemeTokens(element) {
    const root=element?.closest('.fork-gal-stage,.fork-gal-theme-scope');
    return stageWidgetThemeOwners.get(root)?.theme || stageWidgetComposeTheme({builtin:element?stageWidgetBuiltinTheme(element):{}}).theme;
}
