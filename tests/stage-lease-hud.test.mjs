import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageLeaseHud}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/lease-hud.cjs')
const {createStagePortraits}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/portraits.cjs')
class Boundary extends React.Component {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?this.props.fallback:this.props.children}
}
const PackImage=props=>React.createElement('img',{'data-pack':props.identity,src:props.src,alt:props.alt})
const {placeholderFace}=createStagePortraits({React})
const views=createStageLeaseHud({React,Boundary,PackImage,placeholderFace})
async function mount(element,run){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://example.test'}),{window}=dom
  const before={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true})
  const root=createRoot(window.document.getElementById('app'),{onCaughtError(){}})
  try{await act(async()=>root.render(element));await run(window.document)}
  finally{act(()=>root.unmount());window.close();Object.assign(globalThis,{window:before.window,document:before.document,IS_REACT_ACT_ENVIRONMENT:before.act})}
}
const stage=(...children)=>React.createElement('div',{className:'fork-gal-stage','data-theme':'aero'},React.createElement('div',{'data-stage-scene':true},'scene'),...children)
const seats=[{name:'辉夜',face:{identity:'pack:kaguya',src:'kaguya.png'}},{name:'Emma'}]

test('lease HUD renders the card hud inside the stage theme scope with read, device and Avatar',async()=>{
  let received
  const hud=props=>{received=props;return React.createElement('div',{className:'card-strip'},props.seats.map(name=>React.createElement(props.Avatar,{key:name,name,size:40})))}
  const lease={owner:'werewolf',hud,props:{seats:['辉夜','Emma','某人']}},read={lineId:'l3',unread:0}
  const displayed={lineId:'l1',speaker:'Emma'}
  await mount(stage(React.createElement(views.StageLeaseHud,{lease,rows:seats,device:'mobile-portrait',read,displayed})),async document=>{
    const region=document.querySelector('.fork-gal-lease-hud')
    assert.equal(region.closest('.fork-gal-stage').dataset.theme,'aero')
    assert.equal(region.dataset.device,'mobile-portrait')
    assert.ok(region.querySelector('.card-strip'))
    assert.deepEqual([received.read,received.device,received.Avatar,received.seats.length],[read,'mobile-portrait',views.Avatar,3])
    assert.deepEqual(received.displayed,displayed,'displayed line is independent of the read high-water mark')
    const avatars=[...region.querySelectorAll('.fork-gal-lease-avatar')]
    assert.equal(avatars[0].querySelector('img').dataset.pack,'pack:kaguya')
    assert.equal(avatars[0].style.width,'40px')
    assert.equal(avatars[1].textContent,'E')
    assert.equal(avatars[2].textContent,'某')
  })
})
