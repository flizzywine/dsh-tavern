// The asset-pack pages (asset-pack-{gen,card,engine}-ui.js, mod-manager.js) ship only in the stage client: the core's
// createAssetPackUI hands its names to createStageAssetPackViews (stageScope.names) and binds the page names back.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const read = file => readFile(new URL('../tavern-plugin/' + file, import.meta.url), 'utf8')
const list = text => text.split(',').map(name => name.trim()).filter(Boolean)
const PAGES = ['StagePanel', 'StagePage', 'EnginePage', 'FigureGenTab', 'GenPromptSettings', 'ReadingsEditor', 'ModManager', 'ModManagerEntry']

test('the asset-pack pages ship in the stage client; their shared widgets stay in the core', async () => {
  const [core, stage] = await Promise.all([read('lib/client.js'), read('packages/dsh-tavern-stage/lib/client.js')])
  const declares = (source, name) => new RegExp('function\\s+' + name + '\\s*\\(').test(source)
  for (const name of PAGES) {
    assert.equal(declares(core, name), false, name + ' must not ship in the core payload')
    assert.equal(declares(stage, name), true, name + ' must ship in the stage payload')
  }
  // The core pack pages draw these before the stage client binds (asset-pack-widgets.js).
  for (const name of ['Popover', 'MenuItem', 'ConfirmDialog', 'StageSection', 'SwitchRow', 'HintLine', 'cellMenuTrigger', 'useStageFold', 'stageMissing'])
    assert.equal(declares(core, name), true, name + ' stays in the core payload')
})

test('the stage takes exactly the names the core hands over and returns every name the core binds or exposes', async () => {
  const [ui, entry] = await Promise.all([read('src/client/asset-pack-ui.js'), read('packages/dsh-tavern-stage/src/client/entry.js')])
  const given = list(ui.match(/const names=\{([^}]*)\};/)[1])
  const taken = list(entry.match(/function createStageAssetPackViews\(core\) \{\s*const \{([^}]*)\} = core;/)[1])
  assert.deepEqual([...taken].sort(), [...given].sort())
  const bound = list(ui.match(/\n {2}let ([^;]*);\n {2}const stageScope=/)[1])
  assert.deepEqual(list(ui.match(/const take=next=>\{\(\{([^}]*)\}=next\);\};/)[1]), bound)
  const api = ui.slice(ui.lastIndexOf('return stageExposed('))
  const exposed = [...api.matchAll(/\[((?:'[A-Za-z_$][\w$]*',?\s*)+)\]/g)].flatMap(match => list(match[1]).map(name => name.slice(1, -1)))
  const factory = entry.slice(entry.indexOf('function createStageAssetPackViews(core) {'))
  const returned = new Set(list(factory.match(/\n {12}return \{([^}]*)\};\n {8}\}/)[1]))
  for (const name of [...bound, ...exposed, 'STAGE_RETURN_KEY']) assert.ok(returned.has(name), name + ' is returned by createStageAssetPackViews')
})

test('the pages build in the stage scope over the core names (strict, as the stage module runs them)', async () => {
  const entry = await read('packages/dsh-tavern-stage/src/client/entry.js')
  const start = entry.indexOf('function createStageAssetPackViews(core) {')
  const end = entry.indexOf('__STAGE_FEATURES__', start)
  const sources = {
    __STAGE_CARD_STAGE_MODE__: 'packages/dsh-presentation-protocol/src/card-stage-mode.cjs',
    __STAGE_ASSET_PACK_GEN_UI__: 'packages/dsh-tavern-stage/src/client/asset-pack-gen-ui.js',
    __STAGE_ASSET_PACK_CARD_UI__: 'packages/dsh-tavern-stage/src/client/asset-pack-card-ui.js',
    __STAGE_ASSET_PACK_ENGINE_UI__: 'packages/dsh-tavern-stage/src/client/asset-pack-engine-ui.js',
    __STAGE_MOD_MANAGER__: 'packages/dsh-tavern-stage/src/client/mod-manager.js',
  }
  let factory = entry.slice(start, end)
  for (const [token, file] of Object.entries(sources)) factory = factory.replace(token, await read(file))
  const createStageAssetPackViews = new Function('"use strict";\n' + factory + '\nreturn createStageAssetPackViews;')()
  const given = {React: {memo: view => view, createElement: () => null}, directorCommands: require('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs')}
  const names = new Proxy(given, {get: (target, name) => Object.hasOwn(target, name) ? target[name] : () => null})
  const views = createStageAssetPackViews(names)
  for (const name of PAGES) assert.equal(typeof views[name], 'function', name)
  assert.equal(typeof views.STAGE_RETURN_KEY, 'string')
  for (const [name, value] of Object.entries(views)) assert.notEqual(value, undefined, name)
})
