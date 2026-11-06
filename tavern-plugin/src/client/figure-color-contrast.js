// display-time readability of a figure's image colour, everywhere it is drawn as text or a
// glyph. The core is the actual background behind the paint: the composited ancestors (chat theme light/dark, stage theme,
// skin surfaces, row tints), not a scheme token. The one shared helper figureTextColor then moves lightness only (hue and
// saturation kept) by the smallest amount that reaches the ratio, in either direction: a light colour on a light
// background darkens, a dark one on a dark background lightens; a passing colour is drawn unchanged. The stored colour
// never changes and no inline backing is ever written.
// - [data-figure-skip-color] (stage textbox): --figure-skip-ink / --figure-skip-surface for the SKIP label;
// - [data-figure-ink="<ratio>"] (names, emotion pill, ✓, silhouette): the colour the CSS actually paints there (the image
//   colour or a theme mix of it) is checked; only a shortfall writes the adjusted colour inline. A rule that paints its own
//   ink there instead (a theme's white over a figure plate, an authored skin name colour) declares `--figure-ink: none`.
//   A rule whose element changes background on hover declares the hovered paint as `--figure-ink-hover`; the colour is
//   then chosen to read on both (one colour, no swap).
// - [data-figure-plate="<ratio>"] (name plates): the other direction. The image colour is the plate under the theme's or
//   skin's own text; that text keeps its colour and the plate's --bubble-color moves (lightness only) until every visible
//   stop of the plate reaches the ratio against it. A plate that does not follow the image colour (an authored skin paint)
//   cannot move and is left alone. Text over a scene image is not measurable; it keeps the theme's shadow/scrim.
// the probe canvas is attached once per document and kept. Inserting and
// removing a <body> child on every run made each run restyle the whole document twice (a document-level :has() anchor
// re-matches on any <body> insertion: ~60 ms each with the chat and 素材库 mounted behind the stage), several times a
// second while a voiced line played - the text reveal froze while the audio ran on.
// var: harnesses may evaluate this module twice (see CONTRAST_INERT_STYLE).
var CONTRAST_PROBE=Symbol.for('dsh-tavern.figure-contrast-probe');
function forkContrastProbe(doc) {
  let canvas=doc[CONTRAST_PROBE];
  if(!canvas||!canvas.isConnected){
    canvas=doc.createElement('canvas');
    canvas.width=canvas.height=1;
    // Canvas 2D resolves system colors as light even in a dark document. Let CSS
    // resolve the actual canvas surface before compositing translucent ancestors.
    canvas.style.cssText='display:none;background-color:Canvas';
    canvas.setAttribute('aria-hidden','true');canvas.dataset.forkContrastProbe='';
    doc.body.append(canvas);doc[CONTRAST_PROBE]=canvas;
  }
  return canvas;
}
function applyFigureTextContrast(roots) {
  const doc=roots[0].ownerDocument,win=doc.defaultView,canvas=forkContrastProbe(doc);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  // Identical CSS colors share a canvas readback only within this read phase.
  // A new batch resolves them again, including system colors after a theme change.
  const colors=new Map(),surfaces=new WeakMap();
  const rgba=css=>{if(colors.has(css))return colors.get(css);ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);const color=[...ctx.getImageData(0,0,1,1).data];colors.set(css,color);return color;};
  const over=(front,back)=>{const a=front[3]/255;return [0,1,2].map(i=>front[i]*a+back[i]*(1-a)).concat(255);};
  const all=selector=>[...new Set(roots.flatMap(root=>[...(root.matches(selector)?[root]:[]),...root.querySelectorAll(selector)]))];
  const nodes=all('[data-figure-skip-color]'),inks=all('[data-figure-ink]'),plates=all('[data-figure-plate]');
  // Read the theme's own paint, not a previous correction (one write before the shared read phase).
  const clear=(node,prop)=>{if(node.style.getPropertyValue(prop)){node.style.removeProperty(prop);if(!node.style.length)node.removeAttribute('style');}};
  for(const node of inks)clear(node,'color');
  for(const node of plates)clear(node,'--bubble-color');
  const canvasSurface=rgba(win.getComputedStyle(canvas).backgroundColor);
  const hexOf=color=>'#'+color.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  // A gradient layer reads as its first visible stop over the element's background colour.
  const backgroundOf=node=>{
    const layers=[];
    for(let ancestor=node;ancestor;ancestor=ancestor.parentElement){
      let layer=surfaces.get(ancestor);
      if(!layer){
        const style=win.getComputedStyle(ancestor),base=rgba(style.backgroundColor);
        const stop=(style.backgroundImage.match(/(?:rgba?|color|oklab|oklch|lab|lch|hsla?)\([^)]*\)|#[0-9a-f]+/ig)||[]).map(rgba).find(color=>color[3]>0);
        layer=stop?(base[3]===255?over(stop,base):stop):base;surfaces.set(ancestor,layer);
      }
      layers.push(layer);if(layer[3]===255)break;
    }
    let background=canvasSurface;for(const layer of layers.reverse())background=over(layer,background);
    return background;
  };
  // Plates first (their text reads on them). A passing plate costs one read; a failing one is searched on the live
  // element (a handful of single-element style reads).
  const stopsOf=style=>(style.backgroundImage.match(/(?:rgba?|color|oklab|oklch|lab|lch|hsla?)\([^)]*\)|#[0-9a-f]+/ig)||[]).map(css=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];}).filter(color=>color[3]>0);
  for(const node of plates){
    const style=win.getComputedStyle(node),under=node.parentElement?backgroundOf(node.parentElement):canvasSurface;
    const base=rgba(style.getPropertyValue('--bubble-color').trim()||'transparent');
    if(base[3]!==255)continue;
    const paints=()=>{const fill=rgba(style.backgroundColor),own=fill[3]===255?fill:over(fill,under);const stops=stopsOf(style).map(stop=>hexOf(over(stop,own)));return stops.length?stops:fill[3]?[hexOf(own)]:[];};
    const before=paints();if(!before.length)continue;
    const text=hexOf(over(rgba(style.color),rgba(before[0]))),ratio=Number(node.dataset.figurePlate)||4.5;
    const passes=color=>{node.style.setProperty('--bubble-color',color);return paints().every(paint=>figureContrast(text,paint)>=ratio);};
    const plate=figureLightness(hexOf(base),passes,10);
    if(plate===hexOf(base))clear(node,'--bubble-color');else node.style.setProperty('--bubble-color',plate);
  }
  // All mounted nodes share one read phase, then one write phase.
  const results=nodes.map(node=>{
    const hex=hexOf(backgroundOf(node));
    return {node,hex,ink:figureTextColor(node.dataset.figureSkipColor,hex)};
  });
  const fixes=inks.map(node=>{
    const style=win.getComputedStyle(node);
    if(style.getPropertyValue('--figure-ink').trim()==='none')return null;
    const background=backgroundOf(node),paint=over(rgba(style.color),background);
    const ratio=Number(node.dataset.figureInk)||4.5,fg=hexOf(paint),bg=hexOf(background);
    const hover=style.getPropertyValue('--figure-ink-hover').trim(),grounds=[bg,...(hover?[hexOf(over(rgba(hover),background))]:[])];
    const passes=color=>grounds.every(ground=>figureContrast(color,ground)>=ratio);
    return passes(fg)?null:{node,ink:figureLightness(fg,passes)};
  }).filter(Boolean);
  for(const {node,hex,ink} of results){node.style.setProperty('--figure-skip-ink',ink);node.style.setProperty('--figure-skip-surface',hex);}
  for(const {node,ink} of fixes)node.style.setProperty('color',ink,'important');
}
function scheduleFigureTextContrast(root) {
  const doc=root.ownerDocument,key=Symbol.for('dsh-tavern.figure-contrast-queue');
  let queue=doc[key];
  if(!queue){
    queue=doc[key]=new Set();
    doc.defaultView.queueMicrotask(()=>{
      delete doc[key];
      const roots=[...queue].filter(root=>root.isConnected);
      if(roots.length)applyFigureTextContrast(roots);
    });
  }
  queue.add(root);
  return()=>queue.delete(root);
}
// the stage root's look/performance variables (shake, vignette, haze, grain) are
// written every frame while the scene animates (the stage menu); they never reach a background, so such writes
// must not re-read the SKIP backing (a forced style recalc, ~8 ms per frame).
// var: harnesses may evaluate this module twice (shared spinner bundle + browser fixture).
var CONTRAST_INERT_STYLE=/^--(?:look|performance)-/;
function contrastStyleChanged(scratch,before,after) {
  const read=text=>{scratch.style.cssText=text||'';const style=scratch.style,values=new Map();for(let i=0;i<style.length;i++)values.set(style[i],style.getPropertyValue(style[i])+'!'+style.getPropertyPriority(style[i]));return values;};
  const a=read(before),b=read(after);
  for(const name of new Set([...a.keys(),...b.keys()]))if(a.get(name)!==b.get(name)&&!CONTRAST_INERT_STYLE.test(name))return true;
  return false;
}
function useFigureTextContrast(React,ref,enabled,...keys) {
  React.useLayoutEffect(()=>{if(enabled&&ref.current)return scheduleFigureTextContrast(ref.current);},[enabled,...keys]);
  React.useEffect(()=>{
    const root=ref.current;if(!enabled||!root)return;
    const win=root.ownerDocument.defaultView,scratch=root.ownerDocument.createElement('div');
    const observer=new win.MutationObserver(records=>{
      if(records.some(record=>{
        const now=record.target.getAttribute(record.attributeName);
        return record.oldValue!==now&&(record.attributeName!=='style'||contrastStyleChanged(scratch,record.oldValue,now));
      }))scheduleFigureTextContrast(root);
    });
    for(const node of [root.ownerDocument.body,root.ownerDocument.documentElement,root.closest('.fork-gal-stage')].filter(Boolean))observer.observe(node,{attributes:true,attributeOldValue:true,attributeFilter:['class','style','data-ds-dark-theme','data-theme','data-fk-skin']});
    return()=>observer.disconnect();
  },[ref,enabled]);
}
