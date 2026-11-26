// 画风 for pictures Tavern asks for: the asset pictures, 自动素材 (人物, 背景) and the card's CG (getCardContext imageStyle).
// The chain (素材包 → 角色卡 → 配图插件) is resolveGenStyle's (dsh-asset-library gen-style.js); this side reads its links:
// the pack, the card it belongs to (only a card's 自动素材 pack follows its card), and the image plugin's current choice; and
// registers the styles a card or a pack carries into the plugin, read-only (随卡 / 随包), before one is named.
import {resolveGenStyle, readGenStyle, GEN_STYLE_USES, NO_STYLE, FOLLOW_PLUGIN, PACK_BACKGROUND_STYLE} from '../../packages/dsh-asset-library/lib/asset-packs/gen-style.js'

// The image plugin's use for a 画风 use (its 'scene' is a CG, a prop, UI art).
export const pluginStyleUse = use => use === 'cg' ? 'scene' : use
export const genStyleUse = pluginUse => pluginUse === 'scene' ? 'cg' : pluginUse
const ORIGIN_LABEL = {card:'随卡', pack:'随包'}

// readCardStyle({cardPath} | {cardId}) → {path, name, genStyle, styles} | null.
export function createAssetGenStyle({imageProvider, getLibrary, readCardStyle}) {
  const carried = new Map()
  let owner = null
  const presets = () => imageProvider()?.presets?.() ?? []
  // A card's or a pack's own styles, registered once per definition into the current image plugin (again when it changes).
  function register(styles, origin) {
    const source = imageProvider()
    if (!styles?.length || typeof source?.registerPreset !== 'function') return
    if (owner !== source) { for (const row of carried.values()) row.undo?.(); carried.clear(); owner = source }
    for (const style of styles) {
      const json = JSON.stringify(style), known = carried.get(style.id)
      if (known?.json === json) continue
      known?.undo?.()
      carried.delete(style.id)
      try { carried.set(style.id, {json, origin, name:style.name, undo:source.registerPreset({...style, source:ORIGIN_LABEL[origin]})}) }
      catch (error) { throw Object.assign(new Error('画风「' + style.name + '」登记不进配图插件：' + error.message), {code:'INVALID_ARGUMENT'}) }
    }
  }
  // The plugin's own choice: its selected preset when that paints a style; a template that adds none is no style.
  const pluginChoice = () => presets().find(row => row.active && row.addsStyle)?.id ?? null
  function nameOf(id) {
    if (id === NO_STYLE) return '无画风'
    if (id === PACK_BACKGROUND_STYLE) return '本包自定画法'
    return carried.get(id)?.name ?? presets().find(row => row.id === id)?.name ?? id
  }
  // The links of one chain: a pack snapshot (its card when it is a card's 自动素材 pack), or a card (its 自动素材 pack, if any).
  async function links({pack = null, cardPath} = {}) {
    let card = null
    if (pack?.automatic && pack.automaticCardId) card = await readCardStyle({cardId:pack.automaticCardId})
    else if (!pack && cardPath) {
      card = await readCardStyle({cardPath})
      const library = getLibrary(), target = card && library ? await library.cardAutomaticPack({path:cardPath, create:false}) : null
      pack = target ? await library.getPackSnapshot({packId:target.packId}) : null
    }
    register(card?.styles, 'card')
    register(pack?.manifest.styles, 'pack')
    return {pack, card}
  }
  function resolve({pack, card}, use, request) {
    const value = resolveGenStyle({use, request, card:card?.genStyle, plugin:pluginChoice(),
      pack:pack ? {genStyle:pack.manifest.genStyle, backgroundStyle:pack.manifest.backgroundStyle, automatic:!!pack.automatic} : null})
    return {...value, name:nameOf(value.id)}
  }
  // The 画风 menu: what each place may choose, grouped by where a style comes from, and what each use resolves to now.
  function menu({pack, card}) {
    const own = new Set(carried.keys()), styles = presets().filter(row => row.addsStyle)
    const group = (list, origin) => (list || []).map(style => ({id:style.id, name:style.name, origin}))
    const plugin = pluginChoice()
    return {
      plugin:{id:plugin, name:plugin ? nameOf(plugin) : '无画风'},
      card:card ? {name:card.name, path:card.path, value:readGenStyle(card.genStyle), styles:group(card.styles, 'card')} : null,
      pack:pack ? {packId:pack.manifest.id, automatic:!!pack.automatic, value:readGenStyle(pack.manifest.genStyle), backgroundStyle:!!pack.manifest.backgroundStyle, styles:group(pack.manifest.styles, 'pack')} : null,
      options:styles.filter(row => !own.has(row.id)).map(row => ({id:row.id, name:row.name, origin:'plugin', ...(row.status === 'experimental' ? {experimental:true} : {})})),
      resolved:Object.fromEntries(GEN_STYLE_USES.map(use => [use, resolve({pack, card}, use)])),
      // the same uses without the pack's own layer: what 「跟随角色卡」/「跟随配图插件」 lead to (the menus' grey text)
      follow:{card:card ? Object.fromEntries(GEN_STYLE_USES.map(use => [use, resolve({pack:null, card}, use)])) : null, plugin:{id:plugin ?? NO_STYLE, name:plugin ? nameOf(plugin) : '无画风'}},
    }
  }
  return {
    links, resolve, menu, pluginChoice, nameOf,
    // The card's CG style for the image plugin's pictures of this card (getCardContext imageStyle): set by the card or its
    // 自动素材 pack; null when the chain ends at the plugin, whose own choice then applies.
    async cardImageStyle(cardPath) {
      if (!cardPath || !imageProvider()) return null
      const styled = resolve(await links({cardPath}), 'cg')
      return styled.from === 'plugin' || styled.id === PACK_BACKGROUND_STYLE ? null : {id:styled.id, name:styled.name, from:styled.from}
    },
  }
}
export {FOLLOW_PLUGIN, NO_STYLE, PACK_BACKGROUND_STYLE}
