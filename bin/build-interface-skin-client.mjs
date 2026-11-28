import {checkCssSyntax} from './lib/css-syntax-guard.mjs'
import {readFile, writeFile} from 'node:fs/promises'
import vm from 'node:vm'
const root = new URL('../tavern-plugin/packages/dsh-dream-skin/', import.meta.url)
const start = '// BEGIN TAVERN INTERFACE SKIN\n', end = '// END TAVERN INTERFACE SKIN\n'
const themesStart = '// BEGIN TAVERN COLOR THEMES\n'
const themesEnd = '// END TAVERN COLOR THEMES\n'
const lf = value => value.replace(/\r\n?/g, '\n')

export async function integrateTavernThemes(client) {
  client = lf(client)
  const themes = JSON.parse(await readFile(new URL('tavern-themes.json', root), 'utf8'))
  const block = themesStart + themes.map(theme => JSON.stringify(theme, null, 2) + ',\n').join('') + themesEnd
  const start = client.indexOf(themesStart)
  if (start >= 0) {
    const end = client.indexOf(themesEnd, start)
    if (end < 0) throw Error('Incomplete Tavern color themes block')
    return client.slice(0, start) + block + client.slice(end + themesEnd.length)
  }
  const marker = 'const SKINS = [\n'
  if (!client.includes(marker)) throw Error('Missing Dream Skin palette list')
  return client.replace(marker, () => marker + block)
}

export async function integrateInterfaceSkin(client) {
  client = lf(client)
  const source = (await Promise.all(['interface-skin.js', 'font-library.js', 'font-picker.js'].map(async name => lf(await readFile(new URL('src/' + name, root), 'utf8'))))).join('\n')
  const css = lf(await readFile(new URL('src/font-picker.css', root), 'utf8'))
  const bloomCss = lf(await readFile(new URL('src/bloom-appearance.css', root), 'utf8'))
  checkCssSyntax(css, 'dsh-dream-skin/src/font-picker.css')
  checkCssSyntax(bloomCss, 'dsh-dream-skin/src/bloom-appearance.css')
  const block = start + 'const SKIN_FONT_PICKER_CSS = ' + JSON.stringify(css) + ';\n'
    + 'const BLOOM_APPEARANCE_CSS = ' + JSON.stringify(bloomCss) + ';\n' + source + '\n' + end
  if (client.includes(start)) {
    const a = client.indexOf(start), b = client.indexOf(end, a)
    if (b < 0) throw Error('Incomplete interface skin client block')
    client = client.slice(0,a) + block + client.slice(b+end.length)
  } else {
    const marker = '\t\tfunction apply(ctx) {'
    if (!client.includes(marker)) throw Error('Missing dream-skin apply')
    client = client.replace(marker, () => block + marker)
    const anchor = '\n\t\t\tconst wallpaperInjected ='
    if (!client.includes(anchor)) throw Error('Missing dream-skin settings integration')
    client = client.replace(anchor, '\n\t\t\tinstallInterfaceSkinSettings(ctx, _react, window.dshDreamSkin);\n' + anchor)
    client = client.replace('\t\texports.apply = apply;', '\t\texports.installInterfaceSkinSettings = installInterfaceSkinSettings;\n\t\texports.apply = apply;')
  }
  if (!client.includes('installSkinFontLibrary(ctx);')) client = client.replace('installInterfaceSkinSettings(ctx, _react, window.dshDreamSkin);', 'installSkinFontLibrary(ctx);\n\t\t\tinstallInterfaceSkinSettings(ctx, _react, window.dshDreamSkin);')
  if (!client.includes('exports.installSkinFontLibrary =')) client = client.replace('exports.apply = apply;', 'exports.installSkinFontLibrary = installSkinFontLibrary;\n\t\texports.apply = apply;')
  new vm.Script(client)
  return client
}
export async function buildInterfaceSkinClient({check = false} = {}) {
  const file = new URL('lib/client.js', root), current = lf(await readFile(file,'utf8'))
  const next = await integrateInterfaceSkin(await integrateTavernThemes(current))
  if (next === current) return
  if (check) throw Error('Skin client is stale; run node bin/build-tavern-client.mjs')
  await writeFile(file,next)
}
