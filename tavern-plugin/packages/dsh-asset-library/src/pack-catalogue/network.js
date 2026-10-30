// bind each connection to validated DNS results; never delegate redirects to fetch.
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { check } from '../asset-packs/common.js'
import { httpsUrl } from './catalogue.js'
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number)
    return !(a===0 || a===10 || a===127 || a>=224 || a===169 && b===254 || a===172 && b>=16 && b<=31 || a===192 && (b===168 || b===0 || b===2 || b===88 && c===99) || a===100 && b>=64 && b<=127 || a===198 && (b===18 || b===19 || b===51 && c===100) || a===203 && b===0 && c===113)
  }
  // Only native global unicast; exclude transition/tunnelling and documentation ranges.
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^(2001:(?:0*:|0*2:|0*10:|0*20:|db8:)|2002:|3fff:)/i.test(address)
  return false
}
export function createPublicNetwork({resolve = lookup, request = https.request} = {}) {
  return async function open(value,{signal,headers={}}={}) {
    let url = new URL(httpsUrl(value))
    for(let redirects=0; redirects<=5; redirects++) {
      signal?.throwIfAborted()
      const host = url.hostname.replace(/^\[|\]$/g,''), addresses = isIP(host) ? [{address:host,family:isIP(host)}] : await resolve(host,{all:true,verbatim:true})
      check(addresses.length && addresses.every(a=>publicAddress(a.address)), '$.url', 'Private or reserved network address rejected', 'DOWNLOAD_FAILED')
      const pinned = addresses[0]
      const response = await new Promise((resolve,reject)=>{
        const req = request(url,{method:'GET',agent:false,signal,headers:{'Accept-Encoding':'identity',...headers},lookup:(_host,options,cb)=> options.all ? cb(null,[pinned]) : cb(null,pinned.address,pinned.family)},resolve)
        req.setTimeout(30000,()=>req.destroy(Object.assign(new Error('Download stalled'),{code:'DOWNLOAD_FAILED'})))
        req.on('error',reject); req.end()
      })
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.destroy()
        check(redirects<5 && response.headers.location, '$.url','Too many or invalid redirects','DOWNLOAD_FAILED')
        url = new URL(httpsUrl(new URL(response.headers.location,url).href)); continue
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding']!=='identity') {
        response.destroy()
        check(false, '$.response', 'Encoded HTTP bodies are not supported', 'DOWNLOAD_FAILED')
      }
      return {status:response.statusCode,headers:response.headers,body:response,url:url.href}
    }
  }
}
export const publicNetwork = createPublicNetwork()
export async function readBounded(network,url,maximum,signal) {
  const response = await network(url,{signal}), chunks=[]
  let size=0
  try {
    // the status is part of the reason (card URL import words 404 / 403 / 5xx).
    check(response.status===200,'$.response','Catalogue HTTP request failed (HTTP '+response.status+')','DOWNLOAD_FAILED')
    check(!response.headers['content-length'] || Number(response.headers['content-length'])<=maximum,'$.response','Response too large','LIMIT_EXCEEDED')
    for await(const chunk of response.body) { size+=chunk.length; check(size<=maximum,'$.response','Response too large','LIMIT_EXCEEDED'); chunks.push(chunk) }
    return Buffer.concat(chunks,size)
  } finally { response.body.destroy() }
}
