import {createOrderedNumericIndex} from './ordered-numeric-index.js'
import {createIndexedArrayApi} from './indexed-array.js'
// Internal immutable projections may share JSON subtrees across revisions.
// Public editable reads must still detach them before returning.
const immutable = new WeakSet()
export const isImmutableJson = value => Boolean(value && typeof value === 'object' && immutable.has(value))
export function freezeJson(value) {
  if (!value || typeof value !== 'object' || immutable.has(value)) return value
  for (const child of Object.values(value)) freezeJson(child)
  Object.freeze(value)
  immutable.add(value)
  return value
}

// Immutable indexed arrays retain shared branches across point updates. Only
// this factory can brand them: every stored row is deeply frozen first.
const indexedOwners = new WeakMap()
export function createImmutableJsonIndex(options) {
  const index=createIndexedArrayApi(options)
  const brand=value=>{immutable.add(value);indexedOwners.set(value,index);return value}
  return {...index,
    from(source){return index.info(source) ? source : brand(index.from(source.map(freezeJson)))},
    update(source,entries,length=source.length){return brand(index.update(index.info(source) ? source : index.from(source.map(freezeJson)),entries.map(([id,row])=>[id,freezeJson(row)]),length))}
  }
}
export function immutableArrayChanges(before,after) {
  const index=indexedOwners.get(after)
  return index && index===indexedOwners.get(before) ? index.changed(before,after) : null
}

export function createImmutableOrderedJsonIndex(options) {
  const index=createOrderedNumericIndex(options)
  const owner={ordered:index,changed(before,after){
    const changes=index.changed(before,after)
    if(!changes)return null
    const dirty=new Set()
    let offset=0,previousEnd=0
    // Between changed keys every retained row has the same rank offset. Once
    // insertion and removal counts balance, the unchanged suffix needs no work.
    for(const row of changes.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)){
      const position=index.rank(after,row.key)
      if(offset!==0)for(let i=previousEnd;i<position;i++)dirty.add(i)
      if(row.after!==undefined)dirty.add(position)
      if(row.before===undefined)offset++
      if(row.after===undefined)offset--
      previousEnd=position+(row.after===undefined?0:1)
    }
    if(offset!==0)for(let i=previousEnd;i<after.length;i++)dirty.add(i)
    return [...dirty]
  }}
  const brand=value=>{immutable.add(value);indexedOwners.set(value,owner);return value}
  return {...index,
    from(entries){return brand(index.from(entries.map(([key,value])=>[key,freezeJson(value)])))},
    update(source,entries){return brand(index.update(source,entries.map(([key,value])=>[key,freezeJson(value)])))}
  }
}

export function isImmutableOrderedArray(value) {
  const info=indexedOwners.get(value)?.ordered?.info(value)
  return Boolean(info && info.unsafe===0)
}
export function immutableOrderedChanges(before,after) {
  const owner=indexedOwners.get(after)
  return owner?.ordered && owner===indexedOwners.get(before) ? owner.ordered.changed(before,after) : null
}

const turnFieldStates=new WeakMap()
export function createImmutableTurnFields({visit=()=>{}}={}) {
  const index=createOrderedNumericIndex({visit,measure:row=>JSON.stringify(row).length*2})
  const valid=key=>typeof key==='string' && /^(0|[1-9]\d*)$/.test(key) && Number(key)<0xffffffff
  function wrap(rows){
    const target={}
    const lookup=key=>valid(key)?index.get(rows,Number(key)):undefined
    const value=new Proxy(target,{
      get(object,key,receiver){const row=lookup(key);return row?row.value:Reflect.get(object,key,receiver)},
      has:(object,key)=>Boolean(lookup(key))||Reflect.has(object,key),
      ownKeys:()=>rows.map(row=>row.key),
      getOwnPropertyDescriptor(object,key){const row=lookup(key);return row?{value:row.value,enumerable:true,configurable:true,writable:false}:Reflect.getOwnPropertyDescriptor(object,key)},
      set(){throw Error('Immutable turn fields')},deleteProperty(){throw Error('Immutable turn fields')},defineProperty(){throw Error('Immutable turn fields')}
    })
    immutable.add(value);turnFieldStates.set(value,{index,rows});return value
  }
  function from(source){
    const keys=Object.keys(source)
    if(!keys.every(valid))return freezeJson({...source})
    return wrap(index.from(keys.map(key=>[Number(key),{key,value:freezeJson(source[key])}])))
  }
  function update(source,sets,removes=[]){
    const state=turnFieldStates.get(source)
    if(state?.index!==index || !sets.every(([key])=>valid(String(key))) || !removes.every(key=>valid(String(key)))){
      const result={...source};for(const key of removes)delete result[key];for(const [key,value] of sets)result[key]=value;return from(result)
    }
    const removed=new Set(removes.map(String)),lastSets=new Map(sets.map(([key,value])=>[String(key),value]))
    const entries=[...removed].map(key=>[Number(key),undefined])
    for(const [key,value] of lastSets){const old=index.get(state.rows,Number(key));if(removed.has(key) || !old || old.value!==value)entries.push([Number(key),{key,value:freezeJson(value)}])}
    const rows=index.update(state.rows,entries);return rows===state.rows?source:wrap(rows)
  }
  return {from,update,bytes:value=>{const state=turnFieldStates.get(value);return state?.index===index?index.info(state.rows).bytes:JSON.stringify(value).length*2}}
}
export function immutableTurnFieldChanges(before,after){
  const left=turnFieldStates.get(before),right=turnFieldStates.get(after)
  return left && right && left.index===right.index ? right.index.changed(left.rows,right.rows).map(row=>({key:String(row.key),before:row.before?.value,after:row.after?.value})) : null
}
