import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const {createStageLookUi}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/look-ui.cjs')
const frame={matrix:[1,0,0,0,0],shake:{x:1.23456,y:2},vignette:{alpha:0.5,color:[1,0,0]},haze:{alpha:0.2,color:[0,1,0]},grain:0.1}
const markup='<svg class="fork-gal-look-defs"><filter><feColorMatrix values="original"/></filter></svg><div class="fork-gal-frame"></div>'
test('look UI restores prior styles when roots and frame nodes change',()=>{
 const dom=new JSDOM('<section id="a">'+markup+'</section><section id="b">'+markup+'</section>'),doc=dom.window.document
 const module=createStageLookUi({}),api=module.create(),a=doc.getElementById('a'),b=doc.getElementById('b'),paint=a.querySelector('.fork-gal-frame')
 a.style.setProperty('--look-shake-x','9px')
 api.apply(a,frame)
 assert.equal(a.style.getPropertyValue('--look-shake-x'),'1.235px')
 assert.equal(a.style.getPropertyValue('--look-vig'),'');assert.equal(paint.style.getPropertyValue('--look-vig'),'0.5')
 assert.equal(a.querySelector('feColorMatrix').getAttribute('values'),'1 0 0 0 0')
 const replacement=doc.createElement('div');replacement.className='fork-gal-frame';paint.replaceWith(replacement)
 api.apply(a,frame);assert.equal(paint.style.getPropertyValue('--look-vig'),'');assert.equal(replacement.style.getPropertyValue('--look-vig'),'0.5')
 api.apply(b,frame)
 assert.equal(a.style.getPropertyValue('--look-shake-x'),'9px')
 assert.equal(a.hasAttribute('data-look-ui'),false);assert.equal(a.querySelector('feColorMatrix').getAttribute('values'),'original')
 b.style.setProperty('--look-shake-x','77px')
 module.dispose();api.apply(b,frame)
 assert.equal(b.style.getPropertyValue('--look-shake-x'),'77px');assert.equal(b.hasAttribute('data-look-grain'),false)
 assert.equal(b.querySelector('feColorMatrix').getAttribute('values'),'original')
 api.dispose();dom.window.close()
})
test('look UI hook survives StrictMode replay and ignores calls after unload or unmount',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const module=createStageLookUi({React});let apply,node
 function View(){const ref=React.useRef(null);apply=module.useApply(ref);return React.createElement('section',{ref:n=>{ref.current=node=n}},React.createElement('div',{className:'fork-gal-frame'}))}
 const root=createRoot(dom.window.document.getElementById('root'))
 try{
 await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(View))))
 apply(frame);assert.equal(node.hasAttribute('data-look-ui'),true)
 const oldNode=node,late=apply
 module.dispose();late(frame)
 assert.equal(oldNode.hasAttribute('data-look-ui'),false);assert.equal(oldNode.style.getPropertyValue('--look-shake-x'),'')
 await act(async()=>root.unmount());late(frame)
 assert.equal(oldNode.hasAttribute('data-look-grain'),false)
 }finally{await act(async()=>root.unmount());module.dispose();dom.window.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous}
})
