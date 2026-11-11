import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCardPages } from '../tavern-plugin/lib/domain/card-status-panel.js'

const page = { id: 'status', label: '状态', html: '<p>状态</p>', shortcut: 's', menu: true,
  ledger: ['items'], figures: [{ name: '辉夜', emotion: '平静' }] }
const invalid = (value, path) => assert.throws(() => validateCardPages(value), error => error.code === 'CARD_PAGES_INVALID' && error.path === path)

test('invalid declarations identify the exact page and field', () => {
  invalid([page, page], 'pages.1.id')
  invalid([page, {...page,id:'map'}], 'pages.1.shortcut')
  invalid([{...page,shortcut:'a'}], 'pages.0.shortcut')
  invalid([{...page,initial:true}], 'pages.0.initial')
  invalid([{...page,variables:{}}], 'pages.0.variables')
  invalid(Array.from({length:9},(_,i)=>({...page,id:'p'+i})), 'pages.8')
  invalid([{...page,ledger:['items','secrets']}], 'pages.0.ledger.1')
  invalid([{...page,figures:Array.from({length:9},(_,i)=>({name:'人物'+i}))}], 'pages.0.figures')
  invalid([{...page,figures:[{name:'辉夜'},{name:'辉夜'}]}], 'pages.0.figures')
  invalid([{...page,html:' '}], 'pages.0.html')
  invalid([{...page,label:'题'.repeat(17)}], 'pages.0.label')
  invalid([{...page,size:'huge'}], 'pages.0.size')
  invalid([{...page,closeControl:'page'}], 'pages.0.closeControl')
  invalid([{...page,size:'full',closeControl:'stage'}], 'pages.0.closeControl')
  invalid([{...page,showOn:{event:'other'}}], 'pages.0.showOn')
  invalid([{...page,preload:[{kind:'backgrounds',id:'port',size:42}]}], 'pages.0.preload.0.size')
  const opening = { id: 'opening', label: '开局', html: '<p>开局</p>', size: 'full', opening: true }
  invalid([{...opening,size:'window'}], 'pages.0.opening')
  invalid([{...opening,showOn:{event:'stage-enter'}}], 'pages.0.opening')
  invalid([{...opening,opening:'yes'}], 'pages.0.opening')
  invalid([opening, {...opening,id:'opening-b'}], 'pages.1.opening')
  assert.deepEqual(validateCardPages([page, opening]), [page, opening])
})
