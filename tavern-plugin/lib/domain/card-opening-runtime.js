import { marked } from 'marked'
import { createOpeningPreparation } from './opening-preparation.js'
import { projectCardOpeningPreviews } from './card-opening-previews.js'
import { cardOpeningChoices } from './card-openings.js'
import { generateHelper, generateHelperRaw, defaultOrderedRawConfig } from './helper-generation.js'
import { validateHelperGenerateConfig } from './helper-generation-prompts.js'
import { openingPreviewPayload } from './opening-transport.js'
import { projectTavernHelperScripts } from './tavern-helper-scripts.js'

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function createCardOpeningRuntime({
  readCard, worldBooks, tavernExtensionSettings, readCardExtensions, tavernRemoteAssets,
  helperGenerationPreset, callModel, readTavernSettings, requestPerformance, performanceDiagnostics, fullTemplateRuntime
}) {
  const openingPreparation = createOpeningPreparation({ readCard, worldBooks, extensionSettings: tavernExtensionSettings, trace: requestPerformance,
    // the card's extensions with its remote script assets pinned, as getCardOpenings reads them (openingSetup included)
    readRuntimeExtensions: async cardPath => { const extensions = await readCardExtensions(cardPath); return { ...extensions, ...await tavernRemoteAssets.pinExtensions(extensions) } },
    generateRaw: (config, context) => defaultOrderedRawConfig(config) ? openingGenerate(defaultOrderedRawConfig(config), context)
      : generateHelperRaw(config, { ...context, callModel: opts => callModel({ ...opts, background: true, signal: context.signal }) }),
    generate: (config, context) => openingGenerate(config, context)
  })
  async function openingGenerate(config, context) {
    validateHelperGenerateConfig(config)
    const presetSnapshot = await helperGenerationPreset(config.preset_name, context.presetSnapshot)
    const activeSnapshot = config.preset_name && config.preset_name !== 'in_use'
      ? await helperGenerationPreset('in_use', context.presetSnapshot) : presetSnapshot
    context.signal?.throwIfAborted()
    return generateHelper(config, { ...context, presetSnapshot, presetRegexScripts: activeSnapshot?.regexScripts || [],
      loadWorldbookTemplates: async () => ({ runtime: fullTemplateRuntime.forSession(context.chat.sessionId, { readOnlyProjection: true }),
        globalVariables: context.chat.macroState?.global, settings: context.templateSettings }),
      callModel: opts => callModel({ ...opts, background: true, signal: context.signal }) })
  }
  async function getCardOpenings(cardPath, userName, previewTransport) {
    const startedAt = performance.now(), stages = {}
    let success = false
    async function timedStage(stage, operation) {
      const started = performance.now()
      try { return await requestPerformance.stage(stage, operation) } finally { stages[stage] = Math.round(performance.now() - started); performanceDiagnostics.opening({ stage, durationMs: stages[stage] }) }
    }
    try {
      const card = await timedStage('readCard', () => readCard(cardPath))
      if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
      const settings = await readTavernSettings()
      const defaultPlayerName = settings.defaultPlaySettings.playerName
      const playerName = str(userName).trim().slice(0, 80) || defaultPlayerName
      const cardExtensions = await timedStage('readExtensions', () => readCardExtensions(cardPath))
      const extensions = { ...cardExtensions, ...await timedStage('resources', () => tavernRemoteAssets.pinExtensions(cardExtensions)) }
      const previews = await timedStage('preview', () => projectCardOpeningPreviews({
        card,
        extensions,
        userName: playerName,
        presetRegexScripts: []
      }))
      const hasOpeningScript = opening => /<script\b/i.test(opening.projection.text) || opening.projection.parts.some(part => /<script\b/i.test(part.content || ''))
      const hasHelperScripts = projectTavernHelperScripts(extensions.helperScripts).scripts.length > 0
      const interactive = hasHelperScripts || previews.openings.some(opening => opening.setup || hasOpeningScript(opening))
      const preparation = interactive ? await timedStage('prepare', () => openingPreparation.create(cardPath, { card, extensions, runtime: (extensions.mvuResources || []).some(item => item.enabled !== false), userName: playerName })) : null
      if (preparation) {
        const choices = cardOpeningChoices(card)
        const swipes = choices.map(opening => opening.text)
        const openingIds = choices.map(opening => opening.id)
        for (const opening of previews.openings) if (hasHelperScripts || opening.setup || hasOpeningScript(opening)) {
          opening.openingPreview = { swipes, openingIds, selectedIndex: openingIds.indexOf(opening.id),
            messageHtml: opening.projection.parts.map(part => part.kind === 'markdown' ? marked.parse(str(part.text), { gfm: true }) : str(part.content)).join('\n'),
            preparationId: preparation.id, characterName: card.name, playerName, ...openingPreviewPayload(preparation, previewTransport) }
        }
      }
      success = true
      return {
        preparationId: preparation?.id || '',
        defaultPlayerName,
        previewTransport: previewTransport === 'deferred-v1' ? previewTransport : undefined,
        openings: previews.openings,
        diagnostics: previews.diagnostics,
        trustedCardMode: settings.trustedCardMode
      }
    } finally {
      console.info('[dsh-tavern.opening]', JSON.stringify({ success, durationMs: Math.round(performance.now() - startedAt), stages }))
    }
  }

  return { openingPreparation, getCardOpenings }
}
