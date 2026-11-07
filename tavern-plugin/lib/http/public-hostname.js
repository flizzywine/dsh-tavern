import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { publicAddress } from '../../packages/dsh-asset-library/lib/pack-catalogue/network.js'
import { StaticAssetError } from '../domain/tavern-static-resource-cache.js'

const fakeIpCdnHosts = new Set(['cdn.jsdelivr.net', 'testingcf.jsdelivr.net', 'fastly.jsdelivr.net'])

function isFakeIp(address) {
  if (isIP(address) === 4) return /^198\.(?:18|19)\./.test(address)
  if (isIP(address) !== 6) return false
  const canonical = new URL(`https://[${address}]`).hostname
  return /^\[(?:fdfe:dcba:9876|2001:2:0):/.test(canonical) || canonical.startsWith('[2001:2::')
}

// A local TUN can synthesize DNS answers for these CDN names. Pin the approved
// answers for this exception and keep TLS verification against the CDN name.
export async function verifyPublicHostname(value, resolve = lookup, allowCdnFakeIp = process.env.DSH_TAVERN_ALLOW_CDN_FAKE_IP === '1') {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  const addresses = family ? [{ address: hostname, family }] : await resolve(hostname, { all: true, verbatim: true })
  if (addresses.length && addresses.every(({ address }) => publicAddress(address))) return
  if (addresses.length && allowCdnFakeIp && url.protocol === 'https:' && !url.port && fakeIpCdnHosts.has(hostname)
      && addresses.every(({ address }) => publicAddress(address) || isFakeIp(address))) return addresses
  throw new StaticAssetError('Static assets cannot access private or reserved network addresses', 403)
}
