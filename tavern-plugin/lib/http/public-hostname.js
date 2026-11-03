import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { publicAddress } from '../../packages/dsh-asset-library/lib/pack-catalogue/network.js'

// Invoked by the static cache before each outbound request, including redirect hops.
export async function verifyPublicHostname(value, resolve = lookup) {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname, { all: true, verbatim: true })
  if (!addresses.length || !addresses.every(({ address }) => publicAddress(address))) {
    throw new Error('Static assets cannot access private or reserved network addresses')
  }
}
