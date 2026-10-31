import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from 'jsdom'

test('retained React status placement renews its released iframe lease only on return',()=>{
 const dom=new JSDOM('<div id="a"></div><div id="b"></div>',{runScripts:'outside-only'}),win=dom.window
 win.Element.prototype.moveBefore=function(node,before){this.insertBefore(node,before)}
 for(const name of ['session-resource-retention','retained-message-frames'])win.eval(readFileSync(new URL('../tavern-plugin/src/client/modules/'+name+'.js',import.meta.url),'utf8'))
 const retention=win.createTavernSessionRetention({window:win}),created=[],closed=[]
 const frames=win.createRetainedTavernFrames({window:win,retention,createLifecycle:props=>{
   const id=created.length;created.push(props.sessionId)
   return {snapshot:()=>({height:50,visibleDocument:null,pendingDocument:null}),start:()=>()=>closed.push(id),update(){}}
 }})
 const props=id=>({sessionId:id,persistent:true,panelId:'status',partIndex:0})
 try {
 retention.select('A');const a=frames.mount(props('A'),win.document.querySelector('#a'))
 retention.select('B');const b=frames.mount(props('B'),win.document.querySelector('#b'))
 assert.equal(win.document.querySelector('#a').children.length,0)
 a.update(props('A'));assert.equal(created.length,2,'hidden cached React panel must not revive')
 retention.select('A')
 assert.equal(win.document.querySelector('#a').children.length,1)
 assert.equal(win.document.querySelector('#b').children.length,0)
 assert.deepEqual(created,['A','B','A']);assert.deepEqual(closed,[0,1])
 a.update(props('A'));assert.equal(created.length,3)
 a.detach();a.update(props('A'));b.detach()
 retention.select('B');retention.select('A');assert.equal(created.length,3,'detached leases must remove selection listeners')
 }finally{frames.clear();retention.clear();win.close()}
})
