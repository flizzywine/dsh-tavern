import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageControls}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controls.cjs')
const {stageEnterPage}=createStageControls()

const title={id:'title',label:'标题',html:'<p>t</p>',showOn:{event:'stage-enter'},initial:true}
const intro={id:'intro',label:'导览',html:'<p>i</p>',showOn:{event:'stage-enter'}}
const map={id:'map',label:'地图',html:'<p>m</p>',shortcut:'m',menu:true,showOn:{event:'stage-enter'}}
const status={id:'status',label:'状态',html:'<p>s</p>',shortcut:'s',menu:true}

test('a showOn page opens on a later stage entry when the chat already has a player message',()=>{
 assert.equal(stageEnterPage({pages:[intro,status],fresh:false,skip:false}),'intro')
})

test('a fresh chat opens its initial page; the initial page never opens once the chat has a message',()=>{
 assert.equal(stageEnterPage({pages:[title,map],fresh:true,skip:false}),'title')
 assert.equal(stageEnterPage({pages:[title,map],fresh:false,skip:false}),'map')
 assert.equal(stageEnterPage({pages:[title],fresh:false,skip:false}),null)
})

test('跳过标题页 skips showOn pages on a non-fresh entry but keeps the initial page of a fresh chat',()=>{
 assert.equal(stageEnterPage({pages:[intro,map],fresh:false,skip:true}),null)
 assert.equal(stageEnterPage({pages:[title,intro],fresh:true,skip:true}),'title')
})

test('pages without showOn never open on entry',()=>{
 assert.equal(stageEnterPage({pages:[status],fresh:true,skip:false}),null)
 assert.equal(stageEnterPage({pages:[],fresh:true,skip:false}),null)
 assert.equal(stageEnterPage({pages:undefined,fresh:false,skip:false}),null)
})
