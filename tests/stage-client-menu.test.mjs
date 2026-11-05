import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageMenu}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/menu.cjs')
const {createStageControls}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controls.cjs')
const {createStageInput}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/input.cjs')
test('stage menu preserves historical actions and keyboard focus wrapping',()=>{
 const menu=createStageMenu({})
 const items=menu.items({historical:true,latestTurn:5,controls:['skip'],atEnd:true})
 assert.equal(items.some(item=>item.id==='regenerate'),false)
 assert.equal(items.find(item=>item.id==='latest').note,'第 5 轮')
 assert.equal(items.find(item=>item.id==='skip').disabled,true)
 assert.equal(menu.step(0,4,'Tab',true),3)
 assert.equal(menu.step(3,4,'ArrowDown'),0)
 assert.equal(menu.step(2,4,'Home'),0)
})
test('stage menu disposal removes keyboard and director subscriptions before React unmount',()=>{
 const effects=[],listeners=new Map();let released=0,closed=0
 const React={createElement:(type,props,...children)=>({type,props,children}),useState:value=>[typeof value==='function'?value():value,()=>{}],useRef:value=>({current:value}),useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>effects.push(fn),useSyncExternalStore:(_,get)=>get()}
 const menu=createStageMenu({React,document:{activeElement:null,querySelectorAll:()=>[]},window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},sounds:{play(){}},getSession:()=>({select:()=>({subscribe(){},getSnapshot:()=>false,dispose(){released++}})})})
 menu.Menu({sessionId:'s',latestTurn:1,onClose:()=>closed++})
 const stops=effects.map(fn=>fn())
 const late=listeners.get('keydown')
 assert.equal(typeof late,'function')
 menu.dispose();menu.dispose()
 late({key:'Escape',preventDefault(){},stopImmediatePropagation(){}})
 assert.equal(listeners.size,0)
 assert.equal(released,1)
 assert.equal(closed,0)
 stops.forEach(fn=>fn?.())
 assert.equal(released,1)
})
test('stage menu labels are Chinese only and a touch screen gets no shortcut entry',()=>{
 const menu=createStageMenu({})
 const items=menu.items({controls:[]})
 assert.equal(items.some(item=>'sub' in item),false)
 assert.equal(items.some(item=>item.id==='keys'),true)
 assert.equal(menu.items({controls:[],touch:true}).some(item=>item.id==='keys'),false)
})

test('card page rows: none without menu pages; one per menu page in order, where 状态 was; a touch screen still has no keys row',()=>{
 const menu=createStageMenu({})
 const ids=options=>menu.items(options).map(item=>item.id)
 const status={id:'status',label:'状态',shortcut:'s',menu:true}
 assert.equal(ids({controls:['auto','skip']}).some(id=>id.startsWith('page:')),false)
 assert.deepEqual(ids({controls:['auto','skip'],pages:[status]}),['resume','backlog','auto','skip','page:status','gallery','regenerate','config','keys','leave'])
 assert.equal(menu.items({controls:['auto','skip'],pages:[status]}).find(item=>item.id==='page:status').title,'状态（S）')
 assert.deepEqual(ids({controls:[],pages:[status,{id:'map',label:'地图',menu:true},{id:'hidden',label:'隐藏',shortcut:'x'}],touch:true}),['resume','backlog','page:status','page:map','gallery','regenerate','config','leave'])
})

test('a card page shortcut opens its page; Esc or its own key closes it; a letter without a page does nothing',()=>{
 const controls=createStageControls()
 const listeners=[]
 const window={addEventListener(type,handler){listeners.push([type,handler])},removeEventListener(){}}
 const document={hidden:false,addEventListener(){},removeEventListener(){}}
 const input=createStageInput({React:{},window,document,clock:{setTimeout:()=>1,clearTimeout(){}},controls,navigation:{galKeyboardFocus:()=>false}})
 const pages=[{id:'status',label:'状态',shortcut:'s',menu:true}]
 let state={pages:[]}
 const sent=[]
 const instance=input.attach(()=>state,action=>sent.push(action))
 const onKey=listeners.find(([type])=>type==='keydown')[1]
 const press=key=>onKey({key,preventDefault(){},stopImmediatePropagation(){},repeat:false,isComposing:false})
 press('s')
 assert.deepEqual(sent,[])
 state={pages}
 press('s')
 assert.deepEqual(sent,[{type:'page',open:true,id:'status'}])
 state={pages,page:'status'}
 press('Escape')
 press('s')
 press('x')
 assert.deepEqual(sent.slice(1),[{type:'page',open:false},{type:'page',open:false}])
 instance.dispose()
})
test('menu letters draw glyph tiles from art.menu.glyphTiles and keep the word for screen readers',()=>{
 const {createStageLabels}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/labels.cjs')
 const labels=createStageLabels({React:{}})
 const word=labels.ransomGlyphs('返回主页面')
 assert.deepEqual(word,labels.ransomGlyphs('返回主页面'),'a word always reads the same')
 assert.equal(word[0].r,'lead')
 assert.ok(word.slice(1).every((block,index)=>block.r!==word[index].r),'neighbours never repeat a variant')
 assert.deepEqual(labels.ransomGlyphs('A B').map(block=>block.gap?'gap':block.latin),[true,'gap',true])
 assert.ok(word.every(block=>block.tile===undefined),'no tiles, no tile pick')
 const tiles=[{ground:'#ffffff',ink:'#121212'},{ground:'#121212',ink:'#ffffff',weight:6},{ground:'#1f4e9c',ink:'#ffffff',weight:2}]
 const long='返回主页面保存读取设置快捷键履历',picked=labels.ransomGlyphs(long,tiles)
 assert.deepEqual(picked,labels.ransomGlyphs(long,tiles))
 assert.deepEqual(picked.map(block=>block.r),labels.ransomGlyphs(long).map(block=>block.r),'tiles change paint, not variants')
 assert.ok(picked.every(block=>[0,1,2].includes(block.tile))&&picked.filter(block=>block.tile===1).length>picked.length/3)
 assert.ok(labels.ransomGlyphs('菜单回到舞台',[{ground:'#1f4e9c',ink:'#ffffff',weight:3}]).every(block=>block.tile===0))
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useState:value=>[typeof value==='function'?value():value,()=>{}],useRef:value=>({current:value}),useMemo:fn=>fn(),useEffect(){},useLayoutEffect(){},useSyncExternalStore:(_,get)=>get()}
 const menu=createStageMenu({React,window:{addEventListener(){},removeEventListener(){}},document:{activeElement:null,querySelectorAll:()=>[]},sounds:{play(){}},getSession:()=>({select:()=>({subscribe(){},getSnapshot:()=>false,dispose(){}})}),ransom:labels})
 const find=(node,match,out=[])=>{if (node&&typeof node==='object') {if (match(node)) out.push(node);for (const child of node.children||[]) find(child,match,out)}return out}
 const glyphTiles={shape:'torn',tiles,jitter:{rotate:6,scale:0.25}}
 const tree=menu.Menu({sessionId:'s',latestTurn:1,onClose(){},letter:'ransom',titleLetter:'ransom',glyphTiles})
 const blocks=find(tree,node=>node.props.className==='fork-gal-ransom'),texts=find(tree,node=>node.props.className==='fork-gal-ransom-text').map(node=>node.children.join(''))
 assert.ok(texts.includes('回到舞台')&&texts.includes('菜单'),texts.join())
 assert.equal(blocks.length,texts.length)
 assert.ok(blocks.every(node=>node.props['aria-hidden']===true))
 assert.deepEqual([blocks[0].props['data-shape'],blocks[0].props.style],['torn',{'--gt-rot':'6deg','--gt-scale':0.25}])
 const glyphs=find(blocks[0],node=>node.type==='i')
 assert.deepEqual(glyphs.map(node=>node.props['data-r']),labels.ransomGlyphs(texts[0]).map(block=>block.r))
 assert.deepEqual(glyphs.map(node=>node.props['data-t']),labels.ransomGlyphs(texts[0],tiles).map(block=>block.tile))
 assert.deepEqual(glyphs.map(node=>node.props.style['--gt-ground']),labels.ransomGlyphs(texts[0],tiles).map(block=>tiles[block.tile].ground))
 // a letter without glyphTiles, or glyphTiles without a letter: the words stay plain text
 assert.equal(find(menu.Menu({sessionId:'s',latestTurn:1,onClose(){},glyphTiles}),node=>node.props.className==='fork-gal-ransom').length,0)
 assert.equal(find(menu.Menu({sessionId:'s',latestTurn:1,onClose(){},letter:'ransom',titleLetter:'ransom'}),node=>node.props.className==='fork-gal-ransom').length,0)
 const still=find(menu.Menu({sessionId:'s',latestTurn:1,onClose(){},letter:'ransom',glyphTiles:{shape:'circle',tiles}}),node=>node.props.className==='fork-gal-ransom')
 assert.deepEqual([still[0].props['data-shape'],still[0].props.style],['circle',{'--gt-rot':'0deg','--gt-scale':0}])
})
