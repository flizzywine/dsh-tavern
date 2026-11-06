import { isIP } from 'node:net'

export const DEFAULT_BIND_HOST = '127.0.0.1'

// Accept only literal, concrete addresses: no DNS, URL syntax, wildcard or scope IDs.
// WHATWG URLs do not support scoped IPv6, so accepting one would break access links.
export function resolveBindHost(value) {
  const host = String(value ?? '').trim() || DEFAULT_BIND_HOST
  const version = host.includes('%') ? 0 : isIP(host)
  if (!version) throw new Error('DSH_TAVERN_BIND 必须是具体 IPv4 或 IPv6 地址（不含方括号、端口或作用域 ID）。')
  const normalized = version === 6 ? new URL(`http://[${host}]/`).hostname.slice(1, -1) : host
  if (['0.0.0.0', '::', '::ffff:0:0'].includes(normalized)) {
    throw new Error('DSH_TAVERN_BIND 不支持通配地址；监听所有网卡会暴露远程代码执行能力，请指定一个可信内网或 VPN 的具体地址。')
  }
  return normalized
}

export function serviceOrigin(host, port) {
  const address = resolveBindHost(host)
  return new URL(`http://${isIP(address) === 6 ? `[${address}]` : address}:${port}`).origin
}

export function isLoopbackHost(host) {
  const address = resolveBindHost(host)
  return address.startsWith('127.') || address === '::1' || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]+$/.test(address)
}
