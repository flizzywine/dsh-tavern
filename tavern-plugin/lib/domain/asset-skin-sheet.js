// a stage-skin art sheet - several painted UI components (a button's states, a
// plate, a corner cap...) generated in one native image request, laid out in declared cells, then cut apart once the image returns.
// Pure: no file system, no network. The sheet is checked once, when the request is prepared (renderGeneration).
import {decodeAssetRgba,encodeAssetRgba,VISIBLE_ALPHA_THRESHOLD} from './asset-image-processing.js'

const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_ARGUMENT'})}
// The native image tool's canvases (the request names one; the returned size is measured, never assumed).
export const SKIN_SHEET_CANVASES=Object.freeze(['1536x1024','1024x1536','1024x1024'])
const cellId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,47}$/.test(value)
const positive=value=>Number.isFinite(value)&&value>0&&value<=8192

// sheet: {canvas:[w,h], background:'transparent'|'opaque', cells:[{id, rect:[x,y,w,h], note, design?:[w,h]}]}. design = the
// component's size on the skin's design screen (px), reported back as the cut's density; rects never overlap.
export function validateSkinSheet(sheet) {
  if(!sheet||typeof sheet!=='object'||Array.isArray(sheet))fail('sheet must be {canvas, background, cells}')
  const extra=Object.keys(sheet).filter(key=>!['canvas','background','cells'].includes(key))
  if(extra.length)fail('Unknown sheet fields: '+extra.join(', '))
  const [width,height]=sheet.canvas||[]
  if(!SKIN_SHEET_CANVASES.includes(width+'x'+height))fail('sheet.canvas must be one of '+SKIN_SHEET_CANVASES.join(', '))
  if(!['transparent','opaque'].includes(sheet.background))fail('sheet.background must be transparent or opaque')
  if(!Array.isArray(sheet.cells)||!sheet.cells.length||sheet.cells.length>32)fail('sheet.cells must hold 1-32 cells')
  const seen=new Set()
  for(const cell of sheet.cells) {
    if(!cell||typeof cell!=='object'||Object.keys(cell).some(key=>!['id','rect','note','design'].includes(key)))fail('A cell is {id, rect, note, design?}')
    if(!cellId(cell.id)||seen.has(cell.id))fail('Cell ids are unique lowercase slugs: '+cell.id)
    seen.add(cell.id)
    const [x,y,w,h]=cell.rect||[]
    if(!Array.isArray(cell.rect)||cell.rect.length!==4||!cell.rect.every(Number.isInteger)||x<0||y<0||w<32||h<32||x+w>width||y+h>height)fail('Cell '+cell.id+' rect must be integers inside the canvas, at least 32 px')
    if(typeof cell.note!=='string'||!cell.note.trim()||cell.note.length>1200)fail('Cell '+cell.id+' needs a note (what to draw, at most 1200 characters)')
    if(cell.design!==undefined&&!(Array.isArray(cell.design)&&cell.design.length===2&&cell.design.every(positive)))fail('Cell '+cell.id+' design must be [width, height] design-screen px')
  }
  for(const [i,a] of sheet.cells.entries())for(const b of sheet.cells.slice(i+1)) {
    const [ax,ay,aw,ah]=a.rect,[bx,by,bw,bh]=b.rect
    if(ax<bx+bw&&bx<ax+aw&&ay<by+bh&&by<ay+ah)fail('Cells '+a.id+' and '+b.id+' overlap')
  }
  if(sheet.background==='opaque'&&sheet.cells.length!==1)fail('An opaque sheet is one full-bleed painting: exactly one cell')
  return sheet
}

// The exact layout, written into the prompt (the layout guide reference shows the same cells).
export function skinSheetLayoutText(sheet) {
  if(!sheet)return ''
  const [width,height]=sheet.canvas
  const ground=sheet.background==='opaque'
    ?'Background: the whole canvas is one opaque painting edge to edge; no transparency, border or frame.'
    :'Background: fully transparent (alpha 0) everywhere outside the components. Glows and soft shadows fade into transparency, never onto a backdrop colour; no checkerboard, floor, cast-shadow plate, vignette or sheet background.'
  const cells=sheet.cells.map((cell,i)=>{const [x,y,w,h]=cell.rect;return `${i+1}. "${cell.id}" in cell x ${x}-${x+w-1}, y ${y}-${y+h-1} (${w}x${h} px): ${cell.note.trim()}`})
  return [`Canvas: exactly ${width}x${height} px. ${ground}`,
    sheet.background==='opaque'?'Composition:':`Components: ${sheet.cells.length}, one per cell, each drawn whole and centred in its own cell with clear transparent space all round; no component touches another, crosses its cell's edge or is cropped by it.`,
    ...cells].join('\n')
}

// 5x7 digits for the guide's cell numbers (the board's face).
const DIGITS={0:'01110100011001110101110011000101110',1:'00100011000010000100001000010001110',2:'01110100010000100010001000100011111',3:'11110000010000101110000010000111110',4:'00010001100101010010111110001000010',5:'11111100001000011110000010000111110',6:'01110100001000011110100011000101110',7:'11111000010001000100010000100001000',8:'01110100011000101110100011000101110',9:'01110100011000101111000010000101110'}
// The layout guide: the canvas in dark grey, each cell a lighter panel outlined and numbered (1-based, as the prompt lists).
export function renderSkinSheetGuide(sheet) {
  const [width,height]=sheet.canvas,data=new Uint8ClampedArray(width*height*4)
  const fill=(x0,y0,w,h,[r,g,b])=>{for(let y=Math.max(0,y0);y<Math.min(height,y0+h);y++)for(let x=Math.max(0,x0);x<Math.min(width,x0+w);x++)data.set([r,g,b,255],(y*width+x)*4)}
  fill(0,0,width,height,[34,34,38])
  for(const [i,cell] of sheet.cells.entries()) {
    const [x,y,w,h]=cell.rect,line=[230,90,200]
    fill(x,y,w,h,[70,70,78]); fill(x,y,w,4,line); fill(x,y+h-4,w,4,line); fill(x,y,4,h,line); fill(x+w-4,y,4,h,line)
    let cx=x+14
    for(const digit of String(i+1)) {const glyph=DIGITS[digit];for(let k=0;k<35;k++)if(glyph[k]==='1')fill(cx+(k%5)*6,y+14+Math.floor(k/5)*6,6,6,[250,250,250]);cx+=36}
  }
  return encodeAssetRgba({width,height,data})
}

// Cut the returned sheet into its cells. The returned canvas is measured and the cells scaled to it. A transparent sheet is cut
// by its own drawing: every 8-connected island of visible pixels belongs to the cell holding its centre (else the nearest cell),
// and a cell's cut is the box round its islands (pad px), keeping only its own islands' visible pixels - so a component that
// drifted over a cell edge is cut whole and never takes a neighbour's part. An opaque sheet's one cell is the whole image.
// -> {width, height, cells:[{id, rect:[x,y,w,h] in the returned image, size:[w,h], design?, density?, bytes}], missing:[id],
// strays:[{rect, cell}], noise}
// A cell's cut is its own rect (scaled to the returned size): a part's glow and its faint haze stay where the layout put
// them, however far they spread or touch a neighbour's. Bodies (8-connected islands of alpha above solidAlpha) belong to the
// cell holding their centre (else the nearest, reported as a stray): a body that drifted past its rect comes with it, and a
// neighbour's body reaching in is taken out with a 2 px margin. Bodies under minArea px are noise; alpha at or below the
// floor is dropped. A painted object whose paint thins below solidAlpha (a milky sheen) splits into several bodies; a piece of
// it whose centre sits in another cell is still its object's: bodies joined through alpha above joinAlpha are one paint, and a
// body lying apart from its cell's largest body, in paint that another cell's bodies dominate, goes to that cell (a stray).
export function sliceSkinSheet(bytes,sheet,{pad=6,minArea=48,solidAlpha=160,joinAlpha=32,floor=VISIBLE_ALPHA_THRESHOLD}={}) {
  const image=decodeAssetRgba(bytes),{width,height,data}=image,[cw,ch]=sheet.canvas,sx=width/cw,sy=height/ch
  const scaled=sheet.cells.map(cell=>{const [x,y,w,h]=cell.rect;return [Math.round(x*sx),Math.round(y*sy),Math.round(w*sx),Math.round(h*sy)]})
  const density=(cell,size)=>cell.design?Math.round(Math.min(size[0]/cell.design[0],size[1]/cell.design[1])*100)/100:undefined
  const crop=(x0,y0,w,h,keep)=>{
    const out=new Uint8ClampedArray(w*h*4)
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y0+y)*width+x0+x;if(!keep||keep(p))out.set(data.subarray(p*4,p*4+4),(y*w+x)*4)}
    return encodeAssetRgba({width:w,height:h,data:out})
  }
  if(sheet.background==='opaque') {
    const [x,y,w,h]=scaled[0],cell=sheet.cells[0],size=[w,h]
    return {width,height,cells:[{id:cell.id,rect:[x,y,w,h],size,...(cell.design?{design:cell.design,density:density(cell,size)}:{}),bytes:crop(x,y,w,h)}],missing:[],strays:[],noise:0}
  }
  const labels=new Int32Array(width*height).fill(-1),islands=[],stack=new Int32Array(width*height)
  for(let start=0;start<width*height;start++) {
    if(labels[start]!==-1||data[start*4+3]<=solidAlpha)continue
    const id=islands.length,island={seed:start,left:width,top:height,right:-1,bottom:-1,area:0,sumX:0,sumY:0}
    let top=0;stack[top++]=start;labels[start]=id
    while(top) {
      const p=stack[--top],x=p%width,y=(p-x)/width
      island.area++;island.sumX+=x;island.sumY+=y
      if(x<island.left)island.left=x;if(x>island.right)island.right=x;if(y<island.top)island.top=y;if(y>island.bottom)island.bottom=y
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy
        if((dx||dy)&&nx>=0&&ny>=0&&nx<width&&ny<height){const q=ny*width+nx;if(labels[q]===-1&&data[q*4+3]>solidAlpha){labels[q]=id;stack[top++]=q}}
      }
    }
    islands.push(island)
  }
  const owner=new Int32Array(islands.length).fill(-1),strays=[]
  let noise=0
  for(const [i,island] of islands.entries()) {
    if(island.area<minArea){noise++;continue}
    const cx=island.sumX/island.area,cy=island.sumY/island.area
    let best=-1,distance=Infinity
    for(const [c,[x,y,w,h]] of scaled.entries()) {
      const d=Math.hypot(Math.max(x-cx,0,cx-(x+w)),Math.max(y-cy,0,cy-(y+h)))
      if(d<distance){distance=d;best=c}
    }
    owner[i]=best
    if(distance>0)strays.push({rect:[island.left,island.top,island.right-island.left+1,island.bottom-island.top+1],cell:sheet.cells[best].id})
  }
  // The paint (alpha above joinAlpha, 8-connected) each body lies in; a cell's home is the paint of its largest body.
  const paint=new Int32Array(width*height).fill(-1)
  let paints=0
  for(const island of islands) {
    if(paint[island.seed]!==-1)continue
    const id=paints++
    let top=0;stack[top++]=island.seed;paint[island.seed]=id
    while(top) {
      const p=stack[--top],x=p%width,y=(p-x)/width
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy
        if((dx||dy)&&nx>=0&&ny>=0&&nx<width&&ny<height){const q=ny*width+nx;if(paint[q]===-1&&data[q*4+3]>joinAlpha){paint[q]=id;stack[top++]=q}}
      }
    }
  }
  const home=sheet.cells.map((_,c)=>{let best=-1;for(const [i,island] of islands.entries())if(owner[i]===c&&(best===-1||island.area>islands[best].area))best=i;return best===-1?-1:paint[islands[best].seed]})
  const share=new Map(),moved=new Set()
  for(const [i,island] of islands.entries())if(owner[i]>=0){const key=paint[island.seed]+':'+owner[i];share.set(key,(share.get(key)||0)+island.area)}
  for(const [i,island] of islands.entries()) {
    const c=owner[i],g=paint[island.seed]
    if(c<0||home[c]===g)continue
    let best=c,most=share.get(g+':'+c)
    for(const d of sheet.cells.keys())if(d!==c&&(share.get(g+':'+d)||0)>most){best=d;most=share.get(g+':'+d)}
    if(best!==c){owner[i]=best;moved.add(g);strays.push({rect:[island.left,island.top,island.right-island.left+1,island.bottom-island.top+1],cell:sheet.cells[best].id})}
  }
  // The cells of each paint a piece moved in: its thin paint is never cut into a cell holding no body in it.
  const holders=new Map()
  for(const [i,island] of islands.entries())if(owner[i]>=0&&moved.has(paint[island.seed])){const g=paint[island.seed];if(!holders.has(g))holders.set(g,new Set());holders.get(g).add(owner[i])}
  // ...and its faint fringe: visible haze reached from that paint before any other (a breadth-first spread through alpha above
  // the floor from every paint at once).
  if(moved.size) {
    let head=0,tail=0
    for(let p=0;p<width*height;p++)if(paint[p]!==-1)stack[tail++]=p
    while(head<tail) {
      const p=stack[head++],x=p%width,y=(p-x)/width
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy
        if((dx||dy)&&nx>=0&&ny>=0&&nx<width&&ny<height){const q=ny*width+nx;if(paint[q]===-1&&data[q*4+3]>floor){paint[q]=paint[p];stack[tail++]=q}}
      }
    }
  }
  // Every pixel within 2 px of a body: that body's owner (-2 = noise); the rest is free glow.
  const near=new Int32Array(width*height).fill(-1)
  for(let p=0;p<width*height;p++){const l=labels[p];if(l===-1)continue;const o=owner[l]===-1?-2:owner[l],x=p%width,y=(p-x)/width
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<width&&ny<height){const q=ny*width+nx;if(near[q]===-1||labels[q]===l)near[q]=o}}}
  const cells=[],missing=[]
  for(const [c,cell] of sheet.cells.entries()) {
    if(!islands.some((_,i)=>owner[i]===c)){missing.push(cell.id);continue}
    const [rx,ry,rw,rh]=scaled[c],inside=(x,y)=>x>=rx&&x<rx+rw&&y>=ry&&y<ry+rh
    const keep=p=>{const a=data[p*4+3];if(a<=floor)return false;const l=labels[p];if(l!==-1)return owner[l]===c;const x=p%width,y=(p-x)/width,cells=holders.get(paint[p])
      if(cells&&!cells.has(c))return false
      return inside(x,y)?near[p]===-1||near[p]===c:near[p]===c}
    const box={left:width,top:height,right:-1,bottom:-1},grow=(x,y)=>{if(x<box.left)box.left=x;if(x>box.right)box.right=x;if(y<box.top)box.top=y;if(y>box.bottom)box.bottom=y}
    for(let y=Math.max(0,ry);y<Math.min(height,ry+rh);y++)for(let x=Math.max(0,rx);x<Math.min(width,rx+rw);x++)if(keep(y*width+x))grow(x,y)
    for(const [i,island] of islands.entries())if(owner[i]===c){grow(island.left,island.top);grow(island.right,island.bottom)}
    const x0=Math.max(0,box.left-pad),y0=Math.max(0,box.top-pad),x1=Math.min(width,box.right+1+pad),y1=Math.min(height,box.bottom+1+pad),size=[x1-x0,y1-y0]
    cells.push({id:cell.id,rect:[x0,y0,...size],size,...(cell.design?{design:cell.design,density:density(cell,size)}:{}),bytes:crop(x0,y0,size[0],size[1],keep)})
  }
  return {width,height,cells,missing,strays,noise}
}