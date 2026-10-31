import {checkCssSyntax} from './lib/css-syntax-guard.mjs'
import {readFile, writeFile} from 'node:fs/promises'
import vm from 'node:vm'
const root = new URL('../tavern-plugin/packages/dsh-dream-skin/', import.meta.url)
const start = '// BEGIN TAVERN INTERFACE SKIN\n', end = '// END TAVERN INTERFACE SKIN\n'
export async function integrateInterfaceSkin(client) {
  const source = (await Promise.all(['interface-skin.js', 'font-library.js', 'font-picker.js'].map(name => readFile(new URL('src/' + name, root), 'utf8')))).join('\n')
  const css = await readFile(new URL('src/font-picker.css', root), 'utf8')
  checkCssSyntax(css, 'dsh-dream-skin/src/font-picker.css')
  const block = start + 'const SKIN_FONT_PICKER_CSS = ' + JSON.stringify(css) + ';\n' + source + '\n' + end
  if (client.includes(start)) {
    const a = client.indexOf(start), b = client.indexOf(end, a)
    if (b < 0) throw Error('Incomplete interface skin client block')
    client = client.slice(0,a) + block + client.slice(b+end.length)
  } else {
    const marker = '\t\tfunction apply(ctx) {'
    if (!client.includes(marker)) throw Error('Missing dream-skin apply')
    client = client.replace(marker, block + marker)
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
  const file = new URL('lib/client.js', root), current = await readFile(file,'utf8')
  const next = await integrateInterfaceSkin(current)
  if (next === current) return
  if (check) throw Error('Skin client is stale; run node bin/build-tavern-client.mjs')
  await writeFile(file,next)
}
