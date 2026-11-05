import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCardPages, CARD_PAGE_SHORTCUT_KEYS } from '../tavern-plugin/lib/domain/card-status-panel.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'

const page = { id: 'status', label: '状态', html: '<p>状态</p>', shortcut: 's', menu: true,
  ledger: ['items'], figures: [{ name: '辉夜', emotion: '平静' }] }
const invalid = (value, path) => assert.throws(() => validateCardPages(value), error => error.code === 'CARD_PAGES_INVALID' && error.path === path)

test('pages accept two cards and preserve declarations', () => {
  const pages = [page]
  assert.equal(validateCardPages(pages), pages)
  assert.doesNotThrow(() => validateCardPages([{id:'map', label:'航海图', html:'<b>港口</b>', shortcut:'m', size:'full', showOn:{event:'stage-enter'}, initial:true, preload:[{kind:'backgrounds',id:'port',size:512}]}]))
  assert.ok(Object.isFrozen(CARD_PAGE_SHORTCUT_KEYS))
  assert.ok(CARD_PAGE_SHORTCUT_KEYS.includes('s') && CARD_PAGE_SHORTCUT_KEYS.includes('m'))
})

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
  invalid([{...page,showOn:{event:'other'}}], 'pages.0.showOn')
  invalid([{...page,preload:[{kind:'backgrounds',id:'port',size:42}]}], 'pages.0.preload.0.size')
})

test('writes validate changed pages but do not revalidate unchanged pages', () => {
  const cards = createCardPreparation({id:()=> 'card',now:()=>1})
  const workspace = cards.create({kind:'import',payload:{spec:'chara_card_v3',data:{name:'辉夜',extensions:{}}}})
  const set = value => ({op:'set',path:'/data/extensions/dsh_tavern/pages',value})
  assert.throws(()=>cards.update({kind:'card',card:workspace,patch:{},rawOperations:[set([{...page,html:''}])]}),{code:'CARD_PAGES_INVALID'})
  const saved = cards.update({kind:'card',card:workspace,patch:{},rawOperations:[set([page])]})
  assert.deepEqual(saved.card.raw.data.extensions.dsh_tavern.pages,[page])
  saved.card.raw.data.extensions.dsh_tavern.pages[0].html = ''
  assert.doesNotThrow(()=>cards.update({kind:'card',card:saved.card,patch:{name:'新名字'}}))
})

test('editing library pages does not change cardContentDigest', () => {
  const card = {name:'辉夜',extensions:{dsh_tavern:{modSystem:{version:1},pages:[page]}}}
  const edited = structuredClone(card)
  edited.extensions.dsh_tavern.pages[0].html = '<p>新状态</p>'
  assert.equal(cardContentDigest(edited),cardContentDigest(card))
  edited.name = '辉夜姬'
  assert.notEqual(cardContentDigest(edited),cardContentDigest(card))
})
