import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { publicAddress } from '../../packages/dsh-asset-library/lib/pack-catalogue/network.js'
import { StaticAssetError } from '../domain/tavern-static-resource-cache.js'

const publicLookups = new Map()

async function publicDnsRecords(hostname, type, family) {
  const url = new URL('https://1.1.1.1/dns-query')
  url.searchParams.set('name', hostname)
  url.searchParams.set('type', String(type))
  const response = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) throw new Error('Public DNS HTTP ' + response.status)
  const { Status, TC, Answer } = await response.json()
  if (Status === 3) return []
  if (Status !== 0 || TC) throw new Error('Public DNS did not return a complete answer')
  return (Answer || []).filter(record => record.type === type).map(record => ({ address: record.data, family }))
}

function resolvePublicDns(hostname) {
  const pending = publicLookups.get(hostname)
  if (pending) return pending
  const query = Promise.all([publicDnsRecords(hostname, 1, 4), publicDnsRecords(hostname, 28, 6)])
    .then(results => results.flat())
    .finally(() => publicLookups.delete(hostname))
  publicLookups.set(hostname, query)
  return query
}

function isFakeIp(address) {
  if (isIP(address) === 4) return /^198\.(?:18|19)\./.test(address)
  if (isIP(address) !== 6) return false
  const canonical = new URL(`https://[${address}]`).hostname
  return /^\[(?:fdfe:dcba:9876|2001:2:0):/.test(canonical) || canonical.startsWith('[2001:2::')
}

// A local TUN can synthesize DNS answers for any site. The opt-in re-resolves
// those names independently and pins the connection to the validated public IPs.
export async function verifyPublicHostname(value, resolve = lookup, allowCdnFakeIp = process.env.DSH_TAVERN_ALLOW_CDN_FAKE_IP === '1', resolvePublic = resolvePublicDns) {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  const addresses = family ? [{ address: hostname, family }] : await resolve(hostname, { all: true, verbatim: true })
  if (addresses.length && addresses.every(({ address }) => publicAddress(address))) return
  const domain = hostname.replace(/\.$/, '')
  if (addresses.length && allowCdnFakeIp && !family && url.protocol === 'https:' && !url.port
      && domain.includes('.') && !/\.(?:local|localhost|internal|lan|arpa|test|invalid|onion)$/.test(domain)
      && addresses.every(({ address }) => publicAddress(address) || isFakeIp(address))) {
    let verified
    try { verified = await resolvePublic(domain) }
    catch { throw new StaticAssetError('无法通过公共 DNS 解析静态资源域名', 502) }
    if (verified.length && verified.every(({ address, family }) => publicAddress(address) && isIP(address) === family)) return verified
  }
  throw new StaticAssetError('Static assets cannot access private or reserved network addresses', 403)
}
