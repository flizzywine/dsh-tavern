import { createHash } from 'node:crypto'
const modes = new Set(['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'])
export function imageReferenceCapability(config) {
  const supported = config.provider === 'gemini' && modes.has(config.model)
  const service = [config.provider, config.baseURL, config.model].join(' · ')
  return { supported, service, gateway: createHash('sha256').update(service).digest('hex'), maxImages: supported ? 4 : 0,
    reason: supported ? '' : '当前渠道/模型尚未接入造型参考，仅使用文字外貌。' }
}
