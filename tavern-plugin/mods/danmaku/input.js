import {shortText} from './contract.js'

// P4 caps the mod-owned JSON input at 16 KiB (the host adds its own visible window).
// Keep every recalled group's identity; shorten prose rather than silently dropping groups.
export function compactAudienceInput(input) {
  const result=structuredClone(input),fields=[]
  const add=(object,key)=>{if(typeof object?.[key]==='string')fields.push({object,key})}
  for(const group of result.groups) {
    for(const key of ['name','persona','tone'])add(group,key)
    for(const key of ['catchphrases','examples','presetExamples'])(group[key] || []).forEach((_,index)=>add(group[key],index))
  }
  for(const row of result.recent)for(const key of ['author','text'])add(row,key)
  for(const row of result.presented)for(const key of ['text','visualType'])add(row,key)
  add(result,'memory');add(result.acceptedInput,'text')
  for(const page of result.pages || [])add(page,'text')
  while(Buffer.byteLength(JSON.stringify(result))>16000) {
    fields.sort((a,b)=>Buffer.byteLength(b.object[b.key])-Buffer.byteLength(a.object[a.key]))
    const field=fields[0],value=field?.object[field.key]
    if(!value || [...value].length<=16)throw Object.assign(new Error('Audience identities exceed the model input budget'),{code:'MOD_RESOURCE_UNAVAILABLE'})
    field.object[field.key]=shortText(value,Math.floor([...value].length/2))
  }
  return result
}
