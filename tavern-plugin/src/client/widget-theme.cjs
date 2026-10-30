// nine inert tokens; no selectors, webfont URLs or style sheets cross the bridge.
const STAGE_WIDGET_THEME_COLOURS = ['accent','accentText','surface','surfaceText','muted','border'];
const STAGE_WIDGET_THEME_TOKENS = [...STAGE_WIDGET_THEME_COLOURS,'radius','fontFamily','headingFont'];
function validateStageTheme(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || new TextEncoder().encode(JSON.stringify(value)).length>2048) throw new Error('Invalid stage theme');
    for (const [key,token] of Object.entries(value)) {
        const valid=STAGE_WIDGET_THEME_COLOURS.includes(key) ? typeof token==='string' && /^#[0-9a-f]{6}$/i.test(token) : key==='radius' ? Number.isFinite(token) && token>=0 && token<=40
            : ['fontFamily','headingFont'].includes(key) && typeof token==='string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(token);
        if(!valid)throw new Error('Invalid stage theme token');
    }
    return value;
}
const stageWidgetThemeRgb=hex=>[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16)/255);
const stageWidgetThemeHex=rgb=>'#'+rgb.map(value=>Math.max(0,Math.min(255,Math.round(value*255))).toString(16).padStart(2,'0')).join('');
const stageWidgetThemeLuminance=hex=>stageWidgetThemeRgb(hex).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((n,value,i)=>n+value*[.2126,.7152,.0722][i],0);
function stageWidgetThemeContrast(a,b){const x=stageWidgetThemeLuminance(a),y=stageWidgetThemeLuminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const stageWidgetThemeInk=hex=>stageWidgetThemeContrast(hex,'#000000')>=stageWidgetThemeContrast(hex,'#ffffff')?'#000000':'#ffffff';
function stageWidgetComposeTheme({builtin={},derived={},skin,background={},font=id=>id ? 'sans-serif' : 'serif'}={}) {
    const theme={accent:'#c79060',accentText:'#171717',surface:'#242321',surfaceText:'#faf7f2',muted:'#c6c0b8',border:'#70685f',radius:12,fontFamily:'serif',headingFont:'serif',...builtin,...derived};
    if(skin){
        const paint={...skin.textbox?.paint,...skin.ui}; // same panel palette as choices/config
        for(const [key,source] of Object.entries({accent:'accent',accentText:'onAccent',surface:'bg',surfaceText:'fg',muted:'fgMuted',border:'border'}))if(paint[source]!==undefined)theme[key]=paint[source];
        if(paint.accent===undefined && skin.textStyle?.emphasis)theme.accent=skin.textStyle.emphasis;
        if(skin.textbox?.shape?.radius!==undefined)theme.radius=skin.textbox.shape.radius;
        if(skin.font?.body)theme.fontFamily=font(skin.font.body);
        if(skin.font?.name)theme.headingFont=font(skin.font.name);
    }
    for(const [key,value] of Object.entries(background))if(STAGE_WIDGET_THEME_TOKENS.includes(key))theme[key]=['fontFamily','headingFont'].includes(key)?font(value):value;
    const corrected=[];
    for(const [ink,base] of [['surfaceText','surface'],['muted','surface'],['accentText','accent']])if(stageWidgetThemeContrast(theme[ink],theme[base])<4.5){theme[ink]=stageWidgetThemeInk(theme[base]);corrected.push(ink);}
    for(const key of STAGE_WIDGET_THEME_COLOURS)theme[key]=theme[key].toLowerCase();
    return {theme,corrected};
}
function stageWidgetAnalysePixels(pixels) {
    const bins=new Map();
    for(let i=0;i<pixels.length;i+=4){
        if(pixels[i+3]<128)continue;
        const rgb=[pixels[i],pixels[i+1],pixels[i+2]].map(v=>v/255),linear=rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4),[r,g,b]=linear;
        const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
        const light=.2104542553*l+.793617785*m-.0040720468*s,a=1.9779984951*l-2.428592205*m+.4505937099*s,bb=.0259040371*l+.7827717662*m-.808675766*s,chroma=Math.hypot(a,bb);
        if(light<.12 || light>.94 || chroma<.025)continue;
        const hue=(Math.atan2(bb,a)+Math.PI)/(Math.PI*2),key=Math.min(11,Math.floor(hue*12));
        const bin=bins.get(key)||{count:0,rgb:[0,0,0],chroma:0};bin.count++;bin.chroma+=chroma;rgb.forEach((v,j)=>bin.rgb[j]+=v);bins.set(key,bin);
    }
    const rows=[...bins].sort((a,b)=>b[1].count-a[1].count || a[0]-b[0]);
    if(!rows.length)return null;
    const dominant=rows[0][1],accent=rows.slice().sort((a,b)=>b[1].chroma-a[1].chroma || a[0]-b[0])[0][1];
    return {dominant:dominant.rgb.map(v=>v/dominant.count),accent:accent.rgb.map(v=>v/accent.count)};
}
function stageWidgetDerivedTheme(sample,dark=true) {
    if(!sample)return {};
    const blend=(rgb,base,weight)=>stageWidgetThemeHex(rgb.map(value=>value*weight+base*(1-weight)));
    const surface=blend(sample.dominant,dark?.07:.97,dark?.17:.07),accent=blend(sample.accent,dark?.9:.35,dark?.7:.8);
    return {surface,accent,surfaceText:stageWidgetThemeInk(surface),muted:stageWidgetThemeInk(surface),accentText:stageWidgetThemeInk(accent),border:blend(sample.dominant,dark?.45:.65,.3)};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {STAGE_WIDGET_THEME_TOKENS,validateStageTheme,stageWidgetComposeTheme,stageWidgetAnalysePixels,stageWidgetDerivedTheme,stageWidgetThemeContrast};
