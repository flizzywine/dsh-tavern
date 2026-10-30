// native settings own persistence; official provenance is never a catalogue claim.
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsSectionProvider } from '../shared/native-settings.js'
import { canonicalJson, check } from '../asset-packs/common.js'
import { digest, httpsUrl } from './catalogue.js'
export const CATALOGUE_SETTINGS_SECTION = 'asset-library-catalogues'
export const sourceId = url => 'source-' + digest(url).slice(0,24)
export function catalogueSettingsModel(officialCatalogueUrl) {
  const official = officialCatalogueUrl ? httpsUrl(officialCatalogueUrl) : null
  const defaults = {sources:official ? [{url:official,enabled:true,builtin:true}] : [],preferredDownloadId:'',mirrorPrefix:''}
  function validate(v) {
    check(v && Array.isArray(v.sources) && v.sources.length<=32,'$.sources')
    check(typeof v.preferredDownloadId==='string' && v.preferredDownloadId.length<=100,'$.preferredDownloadId')
    check(typeof v.mirrorPrefix==='string','$.mirrorPrefix')
    const mirrorPrefix=v.mirrorPrefix ? httpsUrl(v.mirrorPrefix) : ''
    const seen=new Set(), sources=v.sources.map(s=>{
      const url=httpsUrl(s.url); check(typeof s.enabled==='boolean' && !seen.has(url),'$.sources','Duplicate or invalid source'); seen.add(url)
      return {url,enabled:s.enabled,...(s.builtin===true && url===official ? {builtin:true} : {})}
    })
    return {sources,preferredDownloadId:v.preferredDownloadId,mirrorPrefix}
  }
  function expose(v) { return {...v,sources:v.sources.map(s=>({sourceId:sourceId(s.url),url:s.url,enabled:s.enabled,official:s.builtin===true && s.url===official}))} }
  function fromInput(input,current) {
    // Only an existing built-in row, with its exact ID and URL, can retain identity.
    return validate({...input,sources:input.sources.map(s=>({...s,builtin:current.sources.some(old=>old.builtin && s.sourceId===sourceId(old.url) && s.url===old.url)}))})
  }
  return {defaults,validate,expose,fromInput}
}
export function createCatalogueSettings(ctx,officialCatalogueUrl) {
  const model=catalogueSettingsModel(officialCatalogueUrl)
  let source=()=>model.defaults, active=true, tail=Promise.resolve()
  // Native installSection requires notifications; this consumer reads settings on demand.
  ctx.inject(['settings'],child=>installSettingsSection(ctx,child.get('settings'),CATALOGUE_SETTINGS_SECTION,z.object({sources:z.any().default(model.defaults.sources),preferredDownloadId:z.string().default(''),mirrorPrefix:z.string().default('')}),model.defaults,{setSource:fn=>{source=fn},validate:model.validate,onChange:()=>{}}))
  ctx.effect(()=>()=>{active=false})
  function read() { check(active,'$','Settings unavailable','ASSET_UNAVAILABLE'); const v=source(); return {values:model.expose(v),revision:digest(canonicalJson(v))} }
  return {read,save(input) {
    const task=tail.then(async()=>{
      check(read().revision===input.expectedRevision,'$.expectedRevision','Catalogue settings changed','REVISION_CONFLICT')
      const provider=settingsSectionProvider(ctx,CATALOGUE_SETTINGS_SECTION); check(provider && provider.writable!==false,'$','Native settings unavailable','SETTINGS_UNAVAILABLE')
      const next=model.fromInput(input,source()), revision=provider.describe?.().find(s=>s.ns===CATALOGUE_SETTINGS_SECTION)?.revision
      await provider.replace(CATALOGUE_SETTINGS_SECTION,next,revision); return read()
    }); tail=task.catch(()=>{}); return task
  }}
}
