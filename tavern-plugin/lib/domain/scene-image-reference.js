import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
const pathFor = chatId => 'scene-images/' + hash(String(chatId)) + '/references.json'
const modes = new Set(['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'])
const formats = new Set(['image/png', 'image/jpeg', 'image/webp'])
const limit = 8 * 1024 * 1024

export function imageReferenceCapability(config) {
  const supported = config.provider === 'gemini' && modes.has(config.model)
  const service = [config.provider, config.baseURL, config.model].join(' · ')
  return { supported, service, gateway: hash(service), maxImages: supported ? 4 : 0,
    reason: supported ? '' : '当前渠道/模型尚未接入造型参考，仅使用文字外貌。' }
}

function imageDigest(image) {
  const type = image?.ref?.mediaType || image?.mediaType
  if (!formats.has(type) || !(image?.data instanceof Uint8Array) || !image.data.length || image.data.length > limit) throw new Error('参考图须为已保存的 PNG、JPEG 或 WebP，大小不超过 8 MiB')
  return { mediaType: type, digest: hash(image.data) }
}

/** User-authorized references, never an automatic last-image feedback loop. */
export function createSceneImageReferences({ store }) {
  async function read(chatId) { return await store.readJson(pathFor(chatId)) || { version: 1, records: [] } }
  async function select({ chatId, lineage, config }) {
    const capability = imageReferenceCapability(config), keys = new Set(lineage.map(target => target.key)), people = new Map()
    const document = await read(chatId)
    for (const record of document.records) {
      if (!keys.has(record.activation.key) || !keys.has(record.source.key)) continue
      people.set(record.person.id, record)
    }
    const active = [...people.values()].filter(record => record.enabled && !(document.revokedIds || []).includes(record.id))
    const eligible = capability.supported ? active.filter(record => record.gateway === capability.gateway) : []
    return { chatId, capability, active, records: eligible, warning: active.length && eligible.length < active.length
      ? capability.supported ? '部分造型参考未授权给当前渠道/模型，仅沿用文字；需要时请重新选择参考图。' : capability.reason : '' }
  }
  async function bind({ chatId, source, activation, version, config, consent, image, enabled = true }) {
    const capability = imageReferenceCapability(config)
    const people = version?.plan?.people || []
    if (people.length !== 1 || version.plan.subjects?.length !== 1 || version.plan.subjects[0] !== people[0].id || !people[0].identity?.quote) throw new Error('仅能直接绑定身份明确的单人人物方案；多人图暂不支持直接绑定')
    if (enabled && (!capability.supported || consent !== capability.gateway)) throw new Error('请确认参考图发送的当前生图服务；渠道或模型可能已变化')
    const bytes = enabled ? imageDigest(image) : null
    const record = { person: { id: people[0].id, name: people[0].name }, source: { key: source.key, turn: source.turn, versionId: version.id, attachment: version.attachment },
      activation: { key: activation.key, turn: activation.turn }, gateway: capability.gateway, enabled, image: bytes, at: Date.now() }
    record.id = hash(JSON.stringify(record))
    await store.updateJson(pathFor(chatId), previous => {
      const records = (previous?.records || []).filter(item => !(item.activation.key === activation.key && item.person.id === record.person.id))
      if (records.length >= 2000) throw new Error('本游戏造型参考记录已达上限，未覆盖历史记录')
      const revoked = new Set(previous?.revokedIds || [])
      if (!enabled) for (const item of records) if (item.person.id === record.person.id) revoked.add(item.id)
      return { version: 1, records: [...records, record], revokedIds: records.filter(item => revoked.has(item.id)).map(item => item.id) }
    })
    return record
  }
  async function load({ selected, plan, readImage, readVersion }) {
    const images = [], warnings = []
    const current = await read(selected.chatId)
    // Model membership alone cannot authorize another person's reference.
    const subjects = new Set(plan.subjects || [])
    for (const record of selected.records) {
      if (!subjects.has(record.person.id)) continue
      if (!current.records.some(item => item.id === record.id) || (current.revokedIds || []).includes(record.id)) { warnings.push('造型参考已取消或替换，本次仅沿用文字外貌。'); continue }
      if (images.length >= selected.capability.maxImages) { warnings.push('参考图数量超过渠道上限，部分人物仅沿用文字外貌。'); break }
      const version = await readVersion(record.source)
      if (!version || JSON.stringify(version.attachment) !== JSON.stringify(record.source.attachment)) { warnings.push('参考图片已删除或版本改变，仅沿用文字外貌。'); continue }
      try {
        const image = await readImage(record.source.attachment)
        if (imageDigest(image).digest !== record.image.digest) throw new Error('参考图内容已变化')
        images.push({ personId: record.person.id, name: record.person.name, data: Buffer.from(image.data), mediaType: record.image.mediaType,
          reference: { id: record.id, person: record.person, source: record.source, activation: record.activation, gateway: record.gateway, image: record.image } })
      } catch { warnings.push('参考图读取或完整性校验失败，仅沿用文字外貌。') }
    }
    return { images, warnings: [...new Set([selected.warning, ...warnings].filter(Boolean))] }
  }
  return { select, bind, load }
}
