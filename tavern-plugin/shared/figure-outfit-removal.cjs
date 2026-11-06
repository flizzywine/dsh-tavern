// Shared editor patch; the native authoring transaction retires unused image closures.
const figureOutfitRemoval = (figure, keys) => {
  const selected = new Set(keys);
  const outfits = figure.outfits.filter(outfit => !selected.has(outfit.key));
  return {outfits, ...(outfits.length ? {} : {heightCm: null})};
};
if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports = figureOutfitRemoval;
