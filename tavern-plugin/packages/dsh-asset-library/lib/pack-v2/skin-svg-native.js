// Native decoding is an installed-library capability, not a portable authoring dependency.
export async function decodeSvg(bytes) {
  const {default: sharp} = await import('sharp')
  await sharp(bytes, {limitInputPixels: 32 * 1024 ** 2}).png().toBuffer()
}
