// Provenance recorded when the illustrator's picture enters the material library.
const scenePictureOf = asset => asset?.kind === 'cg' ? asset.extensions?.dsh_tavern?.scenePicture || null : null;
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = scenePictureOf;
