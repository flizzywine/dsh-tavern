// The built stage client's real Pixi scene renderer (scene.cjs) on a browser page, over the core's Pixi runtime and the
// scene services gal-stage.js passes (sceneServices, backgrounds, figureMetrics, sceneFigureProtocol). The page must serve
// /api/dsh-tavern/vendor/** from tavern-plugin/lib/vendor. A scene check reads the instance's Pixi app and layers through
// one test seam (SCENE_EXPOSE_SEAM); `seams` are more [from, to] replacements in the built stage client.
// Page API: await window.startStageScene(groups?) -> {client, create(host, options)}; groups are option groups over these.
import {readFile} from 'node:fs/promises'
import {browserReactScript} from '../fixtures/browser-react.mjs'
import {presentationSourceUrl} from './presentation-sources.mjs'
import {stageClientPage} from './stage-client-page.mjs'

const root = new URL('../../tavern-plugin/', import.meta.url)
async function source(name) {
  let text = await readFile(presentationSourceUrl(name, root), 'utf8')
  for (const match of [...text.matchAll(/^\s*\/\/ @include(-protocol)? (\S+)\s*$/gm)]) text = text.replace(match[0], match[1]
    ? await readFile(new URL('packages/dsh-presentation-protocol/src/' + match[2], root), 'utf8') : await source(match[2]))
  return text
}
const HOST = ['shared/canvas-resolution.cjs', 'shared/canvas-empty.cjs', 'packages/dsh-presentation-protocol/src/figure-scale.cjs', 'shared/color-math.cjs',
  'packages/dsh-presentation-protocol/src/stage-light.cjs', 'shared/stage-look-math.cjs', 'src/client/gal-looks.js', 'src/client/figure-measure.js']
export const SCENE_EXPOSE_SEAM = ['        figureRects,\n        debug,',
  '        figureRects,\n        get app(){return app;},\n        layers:{get world(){return world;},get figures(){return figuresBox;},get emotes(){return emotesBox;}},\n        debug,']

export async function stageScenePage({seams = []} = {}) {
  const host = (await Promise.all(HOST.map(async name => (await readFile(new URL(name, root), 'utf8')).replace(/^'use strict';/m, '').replace(/^module\.exports = [^\n]*$/m, '')))).join('\n;\n')
  return await browserReactScript() + '\n' + await source('foreground.js') + '\n;\n' + await source('pixi-runtime.js') + '\n;\n' + host + '\n;\n' +
    stageClientPage([SCENE_EXPOSE_SEAM, ...seams]) + `
window.startStageScene=async(groups={})=>{
  const client=stageClient.start({sessionInputs:()=>stageHost.sessionInputs({native:stageHost.nativeSession().native}),
    options:stageHost.options({sceneServices:{foreground:forkForeground,lipSync:{wake(){}},loadPixi:loadPixiRuntime,resolution:galResolution,subscribeResolution:galResolutionSubscribe,
      layered:{urls:layeredSpriteUrls,paint:layeredSpritePaint,voice:layeredSpriteVoice},canvas:{paint:stagePaintEmpty,palette:stageEmptyPalette}},
    backgrounds:{correction:galLayerCorrection,timeGrade:galTimeGrade},
    figureMetrics:{source:figureSource,measure:figureMeasureTexture,anatomy:packFigureAnatomy,record:packFigureRecord,resolve:resolveFigureSizing,bodyCentre:figureBodyCentre},
    sceneFigureProtocol:{FIGURE_DISPLAY,figureSceneFrame,figureSceneUpdate,figureMixedWarning,resolveFigureSizing},...groups})});
  if(!client.views)throw new Error('stage client did not mount: '+client.errors.map(args=>String(args[1]?.stack||args[1])).join('\\n'));
  await loadPixiRuntime();
  return {client,create:(host,options)=>client.views.scene.create(host,options)};
};`
}
