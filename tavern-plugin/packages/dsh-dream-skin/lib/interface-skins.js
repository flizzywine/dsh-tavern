import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

// 界面皮肤: user-imported CSS files appended after Tavern's own stylesheet. Only CSS,
// never script, so importing someone else's skin cannot touch data or run code.
// Layout: interface-skins/index.json { active, skins: [{ id, name, size, importedAt }] }
// plus interface-skins/<id>.css per skin. Built-in skins ship with Tavern as samples;
// they can be chosen but not deleted, and none is active until the player picks it.
const DIR = 'interface-skins'
const INDEX = DIR + '/index.json'
const MAX_CSS_BYTES = 5 * 1024 * 1024
const MAX_SKINS = 50
const ID = /^[0-9a-f]{12}$/
const BUILTIN = Object.freeze([
  // 纸感: contributed by SilverLark257 (PR #418); a full restyle that also sets the colors.
  Object.freeze({ id: 'builtin:paper', name: '纸感', file: 'paper.css', preview: Object.freeze({
    '--dsw-alias-bg-layer-1': '#fffdf8', '--dsw-alias-border-l2': '#e6dfd8', '--dsw-alias-label-primary': '#2e2921',
    '--dsw-alias-brand-primary': '#cc785c', '--dsw-alias-label-secondary': '#6f6759' }) })
])
const BUILTIN_DIR = new URL('./skins/', import.meta.url)
const builtinOf = id => BUILTIN.find(skin => skin.id === id)

function readIndex(value) {
  const skins = Array.isArray(value?.skins) ? value.skins.filter(skin => ID.test(skin?.id) && typeof skin.name === 'string') : []
  const active = builtinOf(value?.active) || skins.some(skin => skin.id === value?.active) ? value.active : null
  return { active, skins }
}

function skinName(value) {
  const name = String(value || '').replace(/\.css$/i, '').trim().slice(0, 80)
  return name || '未命名皮肤'
}

export function createInterfaceSkins({ store }) {
  // Built-ins first, then the player's own imports in import order.
  function present(index) {
    return { active: index.active, skins: [...BUILTIN.map(({ id, name, preview }) => ({ id, name, builtin: true, preview })), ...index.skins] }
  }
  async function list() {
    return present(readIndex(await store.readJson(INDEX)))
  }
  async function importSkin(payload) {
    const css = typeof payload?.css === 'string' ? payload.css : ''
    if (!css.trim()) throw new Error('皮肤文件为空')
    const size = Buffer.byteLength(css, 'utf8')
    if (size > MAX_CSS_BYTES) throw new Error('皮肤文件不能超过 5 MB')
    const id = randomUUID().replaceAll('-', '').slice(0, 12)
    const skin = { id, name: skinName(payload.name), size, importedAt: new Date().toISOString() }
    await store.writeBytes(`${DIR}/${id}.css`, Buffer.from(css, 'utf8'))
    const index = await store.updateJson(INDEX, current => {
      const next = readIndex(current)
      if (next.skins.length >= MAX_SKINS) throw new Error(`最多保存 ${MAX_SKINS} 套皮肤，请先删除不用的`)
      // A freshly imported skin is what the player wants to see, so it becomes active.
      return { active: id, skins: [...next.skins, skin] }
    }).catch(async error => { await store.remove(`${DIR}/${id}.css`); throw error })
    return present(readIndex(index))
  }
  async function select(id) {
    if (id !== null && !builtinOf(id) && !ID.test(String(id))) throw new Error('皮肤不存在')
    return present(readIndex(await store.updateJson(INDEX, current => {
      const next = readIndex(current)
      if (id !== null && !builtinOf(id) && !next.skins.some(skin => skin.id === id)) throw new Error('皮肤不存在')
      return { ...next, active: id }
    })))
  }
  async function remove(id) {
    if (builtinOf(id)) throw new Error('内置皮肤不能删除')
    if (!ID.test(String(id))) throw new Error('皮肤不存在')
    const index = await store.updateJson(INDEX, current => {
      const next = readIndex(current)
      return { active: next.active === id ? null : next.active, skins: next.skins.filter(skin => skin.id !== id) }
    })
    await store.remove(`${DIR}/${id}.css`)
    return present(readIndex(index))
  }
  async function active() {
    const { active: id } = await list()
    if (!id) return { id: null, css: '' }
    const builtin = builtinOf(id)
    if (builtin) return { id, css: await readFile(new URL(builtin.file, BUILTIN_DIR), 'utf8') }
    const css = await store.readText(`${DIR}/${id}.css`)
    return css === undefined ? { id: null, css: '' } : { id, css }
  }
  return Object.freeze({ list, importSkin, select, remove, active })
}
