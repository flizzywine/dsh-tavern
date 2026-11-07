// Workbench tool envelopes: input guards, secret-free projections, paging and failures.
export const featureError=(code,path,next)=>Object.assign(new Error(code),{code,path,next})
const secret=/^(?:api[-_]?key|authorization|password|secret|secrets|token|accessToken|refreshToken|credentials|credentialValue|grant|ticket|headers)$/i
export function assertFeatureInput(value,path='$') {
  if(Array.isArray(value)) { for(let i=0;i<value.length;i++) assertFeatureInput(value[i],path+'['+i+']'); return }
  if(value && typeof value==='object') for(const [key,item] of Object.entries(value)) {
    if(secret.test(key)||['__proto__','prototype','constructor'].includes(key)) throw featureError('CREDENTIALS_FORBIDDEN',path+'.'+key,'Use the application settings page for credentials.')
    assertFeatureInput(item,path+'.'+key)
  }
  if(typeof value==='string' && /^https?:\/\//i.test(value)) {
    const url=new URL(value)
    if(url.username||url.password||[...url.searchParams.keys()].some(k=>secret.test(k)||/signature|sig|key/i.test(k))) throw featureError('CREDENTIALS_FORBIDDEN',path,'Use an unsigned URL without credentials.')
  }
}
export function featureProjection(value) {
  if(value instanceof Uint8Array || value instanceof Map || typeof value==='function') return undefined
  if(Array.isArray(value)) return value.map(featureProjection).filter(v=>v!==undefined)
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([key])=>!secret.test(key)&&!['raw','currentRaw','bytes','dataB64','fileB64','stack'].includes(key)).map(([key,item])=>[key,featureProjection(item)]).filter(([,v])=>v!==undefined))
  if(typeof value==='string') {
    if(/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) return '[local file]'
    if(/^https?:\/\//i.test(value)) { try {const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.href} catch {return '[URL]'} }
  }
  return value
}
export function featurePage(rows,{offset=0,limit=20}={}) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50) throw featureError('INVALID_INPUT','$.offset/limit','Use offset >= 0 and limit 1..50.')
  return {items:rows.slice(offset,offset+limit),total:rows.length,...(offset+limit<rows.length?{nextOffset:offset+limit}:{})}
}
export function featureText(text,{offset=0,limit=4000}={}) {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>8000) throw featureError('INVALID_INPUT','$.offset/limit','Use offset >= 0 and limit 1..8000.')
  const value=String(text)
  return {text:value.slice(offset,offset+limit),totalChars:value.length,...(offset+limit<value.length?{nextOffset:offset+limit,truncated:true}:{})}
}
export function featureFailure(error) {
  const code=/^[A-Z_]+$/.test(error?.code||'')?error.code:'INVALID_INPUT'
  return {ok:false,error:{code,message:error?.message || code,path:error?.path || '$',retryable:code==='SAVE_FAILED',mayHaveCharged:error?.mayHaveCharged===true,
    ...(error?.reason?{reason:error.reason}:{}),...(typeof error?.revision==='string'?{revision:error.revision}:{}),next:error?.next || (code==='REVISION_CONFLICT'?'Read the target again; review the change before retrying.':'Correct the indicated owner field and read its schema before retrying.')}}
}
