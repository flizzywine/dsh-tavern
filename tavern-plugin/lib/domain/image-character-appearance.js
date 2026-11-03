// A figure's 外貌 lives in the 配图 人物库 record (schema 4, per view). Asset generation draws standing, clothed,
// front-facing pictures, so it reads the front SFW views and the outfit's front parts.
const joined = values => values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean).join('；')

export function appearanceFromImageCharacter(character, outfitKey) {
  const traits = character?.traits || {}, outfit = character?.outfits?.find(item => item.id === outfitKey)
  return {
    identityAppearance: joined([traits.face, traits.bodySFW, traits.lowerSFW]),
    outfitAppearance: outfit ? joined([outfit.upper, outfit.lower, outfit.shoes, outfit.accessory, outfit.full]) : '',
  }
}

/** The first 人物库 record of a figure: its names, its 外貌 text and its outfits' text (identityAppearance → face,
 *  outfitAppearance → upper, as the 人物库 reads its own single-text legacy fields). */
export function imageCharacterFromFigure(figure) {
  return {
    name: figure.name, match: (figure.aliases || []).join(', '), figureId: figure.id,
    ...(figure.identityAppearance ? { traits: { face: figure.identityAppearance } } : {}),
    outfits: figure.outfits.map(outfit => ({ id: outfit.key, name: outfit.label, ...(outfit.outfitAppearance ? { upper: outfit.outfitAppearance } : {}) })),
  }
}

/** Linking an existing record fills only what it lacks; the record's own text always wins. */
export function linkPatchFromFigure(character, figure) {
  const seed = imageCharacterFromFigure(figure)
  const outfits = seed.outfits.filter(outfit => !character.outfits.some(item => item.id === outfit.id))
  return { figureId: figure.id,
    ...(seed.traits && !character.traits?.face?.trim() ? { traits: seed.traits } : {}),
    ...(outfits.length ? { outfits } : {}) }
}
