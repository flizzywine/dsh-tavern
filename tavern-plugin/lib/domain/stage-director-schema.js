import directorCommands from '../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import {codepointCompare} from './asset-pack-lexical.js'

// Managed grammar describes installed capabilities; core performance is present only with recalled assets.
export function directorSchemaContext(context) {
  return {
    dimensions:Object.fromEntries([...Object.keys(directorCommands.dimensions),'actors','lighting','sound','events','performance','position'].map(key => [key,true])),
    actors:{}, items:{enabled:true}, catalogue:{candidates:{},rows:[]},
    modCommands:[...(context.schemaModCommands || [])].sort((a,b) => codepointCompare(a.op,b.op))
  }
}
export function directorSchemaDefinitions(context) {
  const stable = directorSchemaContext(context)
  return [...directorCommands.definitions.filter(def => def.toggle !== 'performance' || def.enabled(context)),
    ...directorCommands.selected(stable).filter(def => def.mod)]
}
export function frozenDirectorTool(canonical, context) {
  const stable = directorSchemaContext(context)
  const definitions = directorSchemaDefinitions(context)
  const result = structuredClone(canonical)
  result.description = 'Submit stage changes for the reply, using listed handles and allowedCommands.'
  result.parameters.$defs = {actor:{type:'string',description:'Listed actor handle.'},ref:{type:'string',description:'Asset handle from the catalogue.'}}
  // Each asset field names the list its handles come from.
  const handle = (kind,layer) => ({type:'string',description:kind === 'props' ? 'props ref.' : kind === 'performances' ? 'Handle from the performances list.' : 'Handle from catalogue.'+kind+(layer ? ' ('+layer+' layer).' : '.')})
  const variants = definitions.map(def => {
    const value = structuredClone(def.schema(stable))
    for (const [field,kind] of Object.entries(def.refs || {})) {
      const described = handle(kind,def.lookLayer)
      if (value.properties[field].type === 'array') value.properties[field].items = described
      else value.properties[field] = described
    }
    if (def.name === 'actor.outfit.set') value.properties.outfit = {type:'string',description:'Outfit key listed for this actor.'}
    return value
  })
  // Legacy pack commands still use the host's exact recalled-widget validator.
  const widget = {type:'object',properties:{op:{type:'string',pattern:'^widget\\.[a-z][a-z0-9-]{0,31}\\.(set|update|clear|mark)$'},ref:{$ref:'#/$defs/ref'}},required:['op','ref'],additionalProperties:true}
  result.parameters.properties.beats.items.properties.ops.items = {anyOf:[{oneOf:variants},widget,
    ...(stable.modCommands.length ? [{type:'string',description:'Registered mod DSL: verb commandId key=JSON-value; quote string values.'}] : [])]}
  // Providers receive complete schemas, never references into a separate definition map.
  const defs = result.parameters.$defs
  const inline = value => {
    if (Array.isArray(value)) return value.map(inline)
    if (!value || typeof value !== 'object') return value
    if (value.$ref) {
      const target = defs[value.$ref.split('/').at(-1)]
      if (!target) throw new Error('Unknown director schema reference: '+value.$ref)
      return inline({...target,...Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref'))})
    }
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$defs').map(([key,child]) => [key,inline(child)]))
  }
  result.parameters = inline(result.parameters)
  return result
}
