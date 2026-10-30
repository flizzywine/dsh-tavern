import {analyzeVariableValues,resolveVariable,variablePointer} from '../variable-bindings/index.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}
export function createConfigSourceRegistry() {
  const providers=new Map()
  const api={
    register(provider) {
      if(!/^(mvu|ledger|helper-chat|stage|mod:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)$/.test(provider.id) || providers.has(provider.id) || !Array.isArray(provider.exports) || typeof provider.read!=='function')fail('UNKNOWN_FIELD','Invalid source registration')
      const paths=new Set()
      for(const item of provider.exports) {
        variablePointer(item.path)
        if(paths.has(item.path) || !item.name || !item.description || !['string','number','boolean','object','array'].includes(item.type))fail('UNKNOWN_FIELD','Every exported key needs a unique path, name, type and description')
        if(item.settingsKeys && (!Array.isArray(item.settingsKeys) || item.settingsKeys.some(key=>typeof key!=='string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key))))fail('UNKNOWN_FIELD','Invalid published setting dependencies')
        paths.add(item.path)
      }
      providers.set(provider.id,provider)
      return ()=>providers.delete(provider.id)
    },
    declaration(id) {return providers.get(id)},
    async publish(id,own) {
      const provider=providers.get(id)
      if(!provider || !id.startsWith('mod:'))fail('SOURCE_MISSING','Unknown mod publisher: '+id)
      const keys=new Set(provider.exports.flatMap(row=>[...(row.settingsKeys || []),...(row.settingKey?[row.settingKey]:[])]))
      const settings=Object.fromEntries([...keys].filter(key=>Object.hasOwn(own.settings || {},key)).map(key=>[key,own.settings[key]]))
      return provider.read(structuredClone({state:own.state || {},settings}))
    },
    async snapshot(ctx={}, {deferMods=false}={}) {
      const result={...ctx.sources}
      for(const [id,provider] of providers) {
        if(id.startsWith('mod:')) {
          if(deferMods){result[id]={available:true,value:{}};continue}
          const own=ctx.mods?.[id.slice(4)] || {}
          result[id]={available:true,value:await api.publish(id,own)}
        } else result[id]=await provider.read(ctx)
      }
      return result
    },
    async list(ctx={},snapshot) {
      const values=snapshot || await api.snapshot(ctx),sources=[]
      for(const [id,provider] of providers) {
        const candidates=values[id]?.available?analyzeVariableValues(values[id].value,id):[]
        const tree=[],nodes=new Map()
        for(const item of candidates) {
          // Dynamic variable roots declare their schema at snapshot time; stage/mods expose only declared subtrees.
          if(id!=='mvu' && id!=='helper-chat' && !provider.exports.some(field=>item.path===field.path || item.path.startsWith(field.path+'/') || field.path.startsWith(item.path+'/')))continue
          const declaration=provider.exports.find(row=>row.path===item.path),parentDeclaration=provider.exports.find(row=>row.settingKey && item.path.startsWith(row.path+'/'))
          const settingKey=declaration?.settingKey || parentDeclaration?.settingKey || (declaration?.settingsKeys?.length===1?declaration.settingsKeys[0]:undefined)
          const row={name:item.parts.at(-1),path:item.path,type:item.valueType,...(['object','array'].includes(item.valueType)?{children:[]}:{}),
            ...(item.description!==undefined || declaration?.description?{description:item.description ?? declaration.description}:{}),
            ...(settingKey?{settingKey}:{}),
            ...(declaration?.settingsKeys?{settingsKeys:declaration.settingsKeys}:{}),
          }
          if(!['object','array'].includes(item.valueType))row.value=resolveVariable({source:id,path:item.path},values).value
          const parent=nodes.get(item.path.slice(0,item.path.lastIndexOf('/')))
          ;(parent?.children || tree).push(row);nodes.set(item.path,row)
        }
        for(const [path,error] of Object.entries(values[id]?.errors || {})) {
          const declaration=provider.exports.find(row=>row.path===path)
          const settingKey=declaration.settingKey || (declaration.settingsKeys?.length===1?declaration.settingsKeys[0]:undefined)
          tree.push({name:declaration.name,path,type:declaration.type,description:declaration.description,...(settingKey?{settingKey}:{}),...(declaration.settingsKeys?{settingsKeys:declaration.settingsKeys}:{}),error})
        }
        sources.push({id,label:provider.label,exports:structuredClone(provider.exports),tree})
      }
      return {sources}
    },
  }
  return Object.freeze(api)
}
