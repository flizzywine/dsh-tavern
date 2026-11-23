import { rawData } from './card-preparation.js'
import { exportCharacterBook, exportSillyTavernWorldBook } from './worldbook-resource.js'

function str(value) { return typeof value === 'string' ? value : '' }

// A card script updating its own card. The client maps SillyTavern's character and
// world-info calls onto these two operations; both take the card of one session, so a
// script can only ever read and replace the card it belongs to. The new card arrives
// from the network: it is validated once, by the card import that replaceCard runs.
export function createScriptCardUpdate({ presentCardText, readCardWorkspace, readCardImage, replaceCard }) {
  // The card as SillyTavern serves it: one document whose extensions.world names its
  // world book, and that book in World Info form.
  async function read(cardPath) {
    const { document } = await presentCardText(cardPath)
    const data = rawData(document)
    const book = data.character_book || null
    const worldName = str(data.extensions?.world) || str(book?.name) || str(data.name)
    data.extensions = { ...data.extensions, world: worldName }
    let world = null
    if (book) {
      // Entries the card's bubble settings maintain are DSH's: the replaced card syncs them again.
      const own = { ...book, entries: (book.entries || []).filter(entry => !entry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles) }
      world = exportSillyTavernWorldBook({ character_book: own })
      delete world.originalData
    }
    return { card: document, worldName, world }
  }

  // card: a SillyTavern card document; world: the World Info its extensions.world names
  // (null: the card has no book); cover: base64 PNG, or absent to keep the current cover.
  // What DSH keeps for the card (extensions.dsh_tavern: asset bindings, stage settings)
  // is the player's, not the script's, and stays as it is.
  async function replace(cardPath, { card, world, cover }) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('人物卡数据无效')
    const next = structuredClone(card)
    const data = rawData(next)
    const extensions = data.extensions && typeof data.extensions === 'object' ? data.extensions : (data.extensions = {})
    if (world) data.character_book = { ...exportCharacterBook(world, { replace: true }), name: str(extensions.world) || str(world.name) }
    else delete data.character_book
    const own = rawData((await readCardWorkspace(cardPath)).raw).extensions?.dsh_tavern
    if (own) extensions.dsh_tavern = own
    else delete extensions.dsh_tavern
    const text = JSON.stringify(next)
    const image = cover ? Buffer.from(cover, 'base64') : await readCardImage(cardPath).catch(() => undefined)
    const payload = image
      ? { kind: 'png', name: 'card.png', b64: Buffer.from(text, 'utf8').toString('base64'), fileB64: image.toString('base64') }
      : { kind: 'text', name: 'card.json', text }
    return await replaceCard(cardPath, { payload })
  }

  return Object.freeze({ read, replace })
}
