// 生图渠道和 ComfyUI 的密钥存进 DSH 凭据服务（ctx.credentials），config.json 里只留空值和引用名清单。
// 宿主没有凭据服务、或写入失败时，照旧明文留在 config.json，不影响出图。
import { createHash } from 'node:crypto'

const PREFIX = 'DSH_TAVERN_IMAGE_PLUGIN_'

// 凭据引用名必须是环境变量写法；渠道编号可能有小写和连字符，附上原编号的哈希避免 a-b / a_b 撞名。
function refPart(id) {
  const clean = String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  const hash = createHash('sha256').update(String(id)).digest('hex').slice(0, 8).toUpperCase()
  return `${clean || 'CH'}_${hash}`
}

/** 配置里每个密钥的位置：引用名 + 读写。channels 字段名与 image-channels.js 一致。 */
export function secretSlots(config) {
  const field = (target, key, ref) => ({ ref, get: () => String(target[key] ?? ''), set: value => { target[key] = value } })
  const slots = [field(config, 'comfyAuthToken', PREFIX + 'COMFY_TOKEN'), field(config, 'comfyAuthPass', PREFIX + 'COMFY_PASSWORD')]
  for (const channel of Array.isArray(config.imageChannels) ? config.imageChannels : []) {
    if (!channel || typeof channel !== 'object' || !channel.id) continue
    const part = refPart(channel.id)
    slots.push(field(channel, 'apiKey', `${PREFIX}CH_${part}_API_KEY`), field(channel, 'password', `${PREFIX}CH_${part}_PASSWORD`))
  }
  return slots
}

export function createCredentialStore({ save, logger = console } = {}) {
  let vault = null
  let config = null
  // 凭据服务里实际存着的值；只有完整读过一次（synced）才敢据此删除凭据。
  const known = new Map()
  let synced = false

  const usable = () => vault && ['resolve', 'set', 'unset'].every(key => typeof vault[key] === 'function') ? vault : null
  const refs = target => new Set(Array.isArray(target?.credentialRefs) ? target.credentialRefs.map(String) : [])

  async function sync() {
    const store = usable()
    if (!store || !config) return
    known.clear()
    let complete = true
    const stored = refs(config)
    let plaintext = false
    for (const slot of secretSlots(config)) {
      if (slot.get()) { plaintext = true; continue }
      if (!stored.has(slot.ref)) continue
      try {
        const hit = await store.resolve(slot.ref)
        if (hit?.value) { slot.set(hit.value); known.set(slot.ref, hit.value) }
      } catch (error) {
        complete = false
        logger.warn?.(`dsh-tavern-image: 读取凭据 ${slot.ref} 失败：${error?.message ?? error}`)
      }
    }
    synced = complete
    // 旧版明文密钥：保存一次即移进凭据服务。
    if (plaintext && typeof save === 'function') await save(config)
  }

  return {
    /** loadConfig 读完文件后调用：记住这份常驻配置，凭据服务已就绪就立即补全密钥。 */
    async load(target) { config = target; await sync() },
    /** 凭据服务注入时调用；服务可能比配置晚到。 */
    async connect(service) { vault = service ?? null; await sync() },
    /**
     * saveConfig 写盘前调用：out 是要写进 config.json 的对象。
     * 密钥写进凭据服务后从 out 抹掉；写不进去的照旧明文保留。
     */
    async persist(target, out) {
      const store = usable()
      if (!store) return
      out.imageChannels = (out.imageChannels ?? []).map(item => ({ ...item }))
      const previous = refs(target)
      const kept = new Set()
      const seen = new Set()
      for (const slot of secretSlots(out)) {
        seen.add(slot.ref)
        const value = slot.get()
        if (value) {
          try {
            if (known.get(slot.ref) !== value) await store.set(slot.ref, value)
            known.set(slot.ref, value)
            slot.set('')
            kept.add(slot.ref)
          } catch (error) {
            logger.warn?.(`dsh-tavern-image: 写入凭据 ${slot.ref} 失败，暂时保留在 config.json：${error?.message ?? error}`)
          }
        } else if (synced && (known.has(slot.ref) || previous.has(slot.ref))) {
          await store.unset(slot.ref).catch(error => logger.warn?.(`dsh-tavern-image: 删除凭据 ${slot.ref} 失败：${error?.message ?? error}`))
          known.delete(slot.ref)
        } else if (previous.has(slot.ref)) kept.add(slot.ref)
      }
      // 已删除的渠道：凭据跟着删。没完整读过凭据时宁可留着。
      for (const ref of previous) {
        if (seen.has(ref)) continue
        if (synced) { await store.unset(ref).catch(() => {}); known.delete(ref) } else kept.add(ref)
      }
      out.credentialRefs = [...kept]
      target.credentialRefs = [...kept]
    },
  }
}
