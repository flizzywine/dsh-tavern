import {access,readFile} from 'node:fs/promises'
import {firstPartyModDirectory,firstPartyModIds} from './mod-system-distributions.js'
// The foreground tools the installed first-party mods declare, each from its folder's optional tools.js
// (docs/mod-authoring.md). Its default export lists {name, create(core), settlement?}; create returns the tool definition, given
// the core's turn readers and two mod-scoped callbacks: authorize(chat) (the mod is on for this card) and
// markUsed(chat) (this game's history now calls the tool, so it stays declared). Core code offers, registers and
// controls these tools by this list and never names one. settlement(results), if given, turns the results of the tool a
// reply's variables do not hold yet into the operations its settlement writes (domain/tool-settlement-context.js);
// checkCard(data, {prefix, limits}), if given, adds the tool's errors to the card check (domain/card-validation.js).
export const modTools = Object.freeze((await Promise.all(firstPartyModIds.map(async folder => {
  const directory=firstPartyModDirectory(folder)
  if (!await access(new URL('tools.js',directory)).then(()=>true,()=>false)) return []
  const modId=JSON.parse(await readFile(new URL('mod.json',directory),'utf8')).id
  return (await import(new URL('tools.js',directory))).default.map(tool=>Object.freeze({modId,name:tool.name,create:tool.create,...(tool.settlement?{settlement:tool.settlement}:{}),...(tool.checkCard?{checkCard:tool.checkCard}:{})}))
}))).flat())
