// Persistent compressed radix tree over IEEE-754 numeric keys. At most sixteen
// nibble levels; insertion/removal never shifts a sorted array's suffix.
function createOrderedNumericIndex({visit=()=>{},measure=()=>0}={}) {
  const states=new WeakMap(),buffer=new DataView(new ArrayBuffer(8))
  function digits(key) {
    if(typeof key!=='number' || Number.isNaN(key))throw new Error('Invalid ordered numeric key')
    buffer.setFloat64(0,key===0?0:key)
    let high=buffer.getUint32(0),low=buffer.getUint32(4)
    if(high>>>31){high=(~high)>>>0;low=(~low)>>>0}else high=(high^0x80000000)>>>0
    const result=[]
    for(const word of [high,low])for(let shift=28;shift>=0;shift-=4)result.push((word>>>shift)&15)
    return result
  }
  const leaf=(key,value)=>({key:key===0?0:key,value,count:1,bytes:48+measure(value),unsafe:Number.isFinite(key)?0:1})
  function branch(depth,key,slots){
    let count=0,bytes=160,unsafe=0,children=0,last
    for(const item of slots)if(item){count+=item.count;bytes+=item.bytes;unsafe+=item.unsafe;children++;last=item}
    return children===0?undefined:children===1?last:{depth,key,slots,count,bytes,unsafe}
  }
  function put(node,path,key,value,mutable=false) {
    visit()
    if(!node)return value===undefined?undefined:leaf(key,value)
    const other=digits(node.key),limit=node.slots?node.depth:16
    let split=0
    while(split<limit && other[split]===path[split])split++
    if(split<limit){
      if(value===undefined)return node
      const slots=[];slots[other[split]]=node;slots[path[split]]=leaf(key,value)
      return branch(split,node.key,slots)
    }
    if(!node.slots)return value===undefined?undefined:node.value===value?node:leaf(key,value)
    const digit=path[node.depth],child=put(node.slots[digit],path,key,value,mutable)
    if(child===node.slots[digit])return node
    const slots=mutable?node.slots:node.slots.slice();slots[digit]=child
    return branch(node.depth,node.key,slots)
  }
  function at(root,position) {
    let node=root
    while(node?.slots){
      visit()
      if(position<0 || position>=node.count)return undefined
      for(const child of node.slots){if(!child)continue;if(position<child.count){node=child;break}position-=child.count}
    }
    return position===0?node?.value:undefined
  }
  function view(root) {
    const length=root?.count || 0
    const numeric=key=>typeof key==='string' && /^(0|[1-9]\d*)$/.test(key) && Number(key)<length
    const array=new Proxy([],{
      get(target,key,receiver){return key==='length'?length:numeric(key)?at(root,Number(key)):Reflect.get(target,key,receiver)},
      has(target,key){return numeric(key)||Reflect.has(target,key)},
      ownKeys(){return [...Array.from({length},(_,id)=>String(id)),'length']},
      getOwnPropertyDescriptor(target,key){
        if(numeric(key))return {value:at(root,Number(key)),enumerable:true,writable:false,configurable:true}
        const descriptor=Reflect.getOwnPropertyDescriptor(target,key)
        return key==='length'?{...descriptor,value:length}:descriptor
      },
      set(){throw new Error('Ordered index is immutable')},defineProperty(){throw new Error('Ordered index is immutable')},deleteProperty(){throw new Error('Ordered index is immutable')}
    })
    states.set(array,root);return array
  }
  function from(entries){let root;for(const [key,value] of entries)root=put(root,digits(key),key,value,true);return view(root)}
  function update(source,entries){if(!states.has(source))throw new Error('Unknown ordered index');let root=states.get(source);for(const [key,value] of entries)root=put(root,digits(key),key,value);return root===states.get(source)?source:view(root)}
  function get(source,key){let node=states.get(source);const path=digits(key);while(node?.slots){visit();node=node.slots[path[node.depth]]}visit();return node?.key===key?node.value:undefined}
  function rank(source,key){
    let node=states.get(source),position=0;const path=digits(key)
    while(node?.slots){
      visit();const prefix=digits(node.key)
      for(let i=0;i<node.depth;i++)if(prefix[i]!==path[i])return position+(prefix[i]<path[i]?node.count:0)
      const digit=path[node.depth];for(let i=0;i<digit;i++)position+=node.slots[i]?.count || 0
      node=node.slots[digit]
    }
    return position+(node && node.key<key?1:0)
  }
  // Keep a suffix by rank, sharing all fully retained subtrees.
  function suffix(source,start){
    if(!states.has(source))throw new Error('Unknown ordered index')
    function trim(node,skip){
      visit()
      if(!node || skip>=node.count)return undefined
      if(skip<=0)return node
      const slots=[]
      for(let id=0;id<16;id++){
        const child=node.slots[id];if(!child)continue
        slots[id]=trim(child,skip);skip=Math.max(0,skip-child.count)
      }
      return branch(node.depth,node.key,slots)
    }
    const root=trim(states.get(source),Math.max(0,Math.floor(start)))
    return root===states.get(source)?source:view(root)
  }
  function changed(before,after){
    if(!states.has(before)||!states.has(after))return null
    const result=[]
    function emit(node,removed){
      if(!node)return
      visit()
      if(node.slots){for(const child of node.slots)emit(child,removed)}
      else result.push({key:node.key,before:removed?node.value:undefined,after:removed?undefined:node.value})
    }
    function walk(left,right){
      visit();if(left===right)return
      if(!left || !right){emit(left||right,Boolean(left));return}
      const a=digits(left.key),b=digits(right.key),ld=left.slots?left.depth:16,rd=right.slots?right.depth:16
      for(let i=0;i<Math.min(ld,rd);i++)if(a[i]!==b[i]){emit(left,true);emit(right,false);return}
      if(ld===16 && rd===16){result.push({key:right.key,before:left.value,after:right.value});return}
      if(ld===rd){for(let id=0;id<16;id++)if(left.slots[id]!==right.slots[id])walk(left.slots[id],right.slots[id]);return}
      // Compression can promote a shared child to root. Align by prefix before
      // descending, so removing a sibling never enumerates that shared subtree.
      if(ld<rd){for(let id=0;id<16;id++)if(left.slots[id] || id===b[ld])walk(left.slots[id],id===b[ld]?right:undefined)}
      else {for(let id=0;id<16;id++)if(right.slots[id] || id===a[rd])walk(id===a[rd]?left:undefined,right.slots[id])}
    }
    walk(states.get(before),states.get(after));return result
  }
  return {from,update,get,rank,suffix,changed,info:source=>states.has(source)?{count:states.get(source)?.count||0,bytes:states.get(source)?.bytes||0,unsafe:states.get(source)?.unsafe||0}:null}
}

export { createOrderedNumericIndex };
