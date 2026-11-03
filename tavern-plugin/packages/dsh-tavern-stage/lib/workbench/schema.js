// Card-workbench management tools the stage package owns: one request envelope per tool,
// one row per action. Syntax only; payload semantics stay with each owner (asset library,
// asset engine, mods, asset generation).
const s={type:'string'},b={type:'boolean'},i={type:'integer'},n={type:'null'},o={type:'object',additionalProperties:true};
const a=items=>({type:'array',items}),e=(...values)=>({type:typeof values[0],enum:values}),u=(...oneOf)=>({oneOf});
export const WORKBENCH_ACTIONS = {
  assets_read: [
    ["list", {"query?":s,"offset?":i,"limit?":i}],
    ["item", {"packId":s,"kind":e("figures","backgrounds","music","sfx","ambience","skins","looks","cg","items","directions","performances","widgets","sprites","voices","bundles"),"id?":s,"offset?":i,"limit?":i}],
    ["resolve", {"refs":a(o)}],
    ["bindings", {"path?":s}],
    ["dependencies|pack", {"packId":s}],
    ["settings|catalogue", {}],
    ["schema", {"kind":e("figures","backgrounds","music","sfx","ambience","skins","looks","cg","items","directions","performances","widgets","sprites","voices","bundles")}],
  ],
  assets_patch: [
    ["create-pack", {"name":s,"description?":s,"expectedRevision":n}],
    ["patch-pack", {"packId":s,"expectedRevision":s,"patch":o}],
    ["item", {"packId":s,"expectedRevision":s,"item":o}],
    ["remove-item", {"packId":s,"expectedRevision":s,"kind":e("backgrounds","music","sfx","ambience","skins","looks","cg","items","directions","performances","widgets"),"id":s}],
    ["create-figure", {"packId":s,"expectedRevision":s,"figure":o}],
    ["patch-figure", {"packId":s,"expectedRevision":s,"figureId":s,"patch":o}],
    ["remove-figure", {"packId":s,"expectedRevision":s,"figureId":s}],
    ["copy", {"sourcePackId":s,"itemRefs":a(o),"target":o}],
    ["bind", {"path?":s,"expectedRevision":s,"boundPackIds":a(s)}],
    ["global-packs", {"expectedRevision":s,"globalEnabledPackIds":a(s)}],
    ["catalogue-settings", {"expectedRevision":s,"sources":a(o),"preferredDownloadId?":s,"mirrorPrefix?":s}],
    ["avatar-crop", {"packId":s,"expectedRevision":s,"figureId":s,"outfitKey":s,"scope":e("outfit","state"),"stateId?":s,"crop":u(o,n)}],
    ["emotion-fallback", {"packId":s,"expectedRevision":s,"figureId":s,"outfitKey":s,"emotionId":s,"enabled":b}],
    ["remove-emotion", {"packId":s,"expectedRevision":s,"figureId":s,"emotionId":s}],
  ],
  media_upload: [
    ["blob", {"packId":s,"expectedRevision":s,"file":s,"purpose":e("music","sound","ambience","voice-reference")}],
    ["image", {"packId":s,"expectedRevision":s,"file":s,"target":o}],
    ["bundle", {"packId":s,"expectedRevision":s,"directory":s,"bundleKey":s,"kind":e("live2d","widget","skin","performance"),"entry":s}],
    ["mod-file", {"modId":s,"expectedRevision":s,"layer":e("global","card"),"file":s}],
    ["mod-media", {"modId":s,"packId":s,"kind":s,"slot":s,"file":s}],
  ],
  assets_transfer: [
    ["inspect", {"kind":e("pack","card"),"file":s,"path?":s}],
    ["inspect-url", {"kind":e("card"),"url":s,"path?":s}],
    ["preview-card", {"inspectionId":s,"decisions":o}],
    ["apply-pack", {"inspectionId":s,"expectedRevision":u(s,n),"decision":e("install","update","keep-both","noop","cancel"),"acceptScriptRisk?":b}],
    ["apply-card", {"inspectionId":s,"expectedRevision":u(s,n),"decisions":o,"cancel?":b,"acceptScriptRisk?":b}],
    ["export-pack", {"packs":a(o),"output":s}],
    ["export-card", {"path?":s,"expectedRevision":s,"packIds":a(s),"output":s}],
    ["refresh", {"sourceId":s}],
    ["updates", {"packIds":a(s)}],
    ["download", {"selection":o,"useMirrorPrefix?":b}],
    ["download", {"url":s,"useMirrorPrefix?":b}],
    ["status", {"jobId":s}],
    ["control", {"jobId":s,"actionId":e("pause","resume","cancel")}],
  ],
  stage_read: [
    ["card", {"path?":s}],
    ["engine|judge|bubbles", {}],
    ["director-preview", {"playRef":s,"turn":i,"section?":s,"offset?":i,"limit?":i}],
    ["bubble-preview", {"config":o}],
    ["schema", {"section":e("openings","engine","judge")}],
  ],
  stage_patch: [
    ["card", {"path?":s,"expectedRevision":s,"patch":o}],
    ["engine", {"expectedRevision":s,"patch":o}],
    ["judge", {"expectedRevision":s,"patch":o}],
    ["judge-test", {}],
  ],
  mods_read: [
    ["list|sources", {}],
    ["mod|packs|config", {"modId":s}],
    ["resolve", {"modId":s,"key":s}],
    ["formula", {"formula":s}],
  ],
  mods_patch: [
    ["settings", {"modId":s,"expectedRevision":s,"values":o}],
    ["pack", {"modId":s,"expectedRevision":s,"pack":o}],
    ["config", {"modId":s,"expectedRevision":s,"key":s,"layer":e("global","card"),"value":o}],
    ["clear-config", {"modId":s,"expectedRevision":s,"key":s,"layer":e("global","card")}],
  ],
  asset_generation: [
    ["prepare", {"target":o,"expectedRevision":s,"userPrompt?":s,"references?":a(o),"quality?":e("low","medium","high","auto"),"count?":i,"redrawOf?":s,"note?":s,"useCandidateReference?":b}],
    ["generate", {"planId":s,"consentToken":s,"confirmNewRequestIds?":a(s)}],
    ["status|cancel|reject|retry-save", {"jobId":s}],
    ["read", {"jobId":s,"emotionId?":s}],
    ["list", {"packId":s}],
  ],
}
// The Skills that unlock each tool: a tool joins the card-workbench request once one of them is loaded.
export const WORKBENCH_SKILLS = {
  'asset-library': ['tavern_assets_read', 'tavern_assets_patch', 'tavern_media_upload', 'tavern_assets_transfer'],
  'figure-assets': ['tavern_assets_read', 'tavern_assets_patch', 'tavern_media_upload'],
  'stage-setup': ['tavern_assets_read', 'tavern_stage_read', 'tavern_stage_patch'],
  'stage-directing': ['tavern_assets_read', 'tavern_assets_patch', 'tavern_stage_read', 'tavern_stage_patch'],
  'stage-mods': ['tavern_mods_read', 'tavern_mods_patch', 'tavern_media_upload'],
  'card-sharing': ['tavern_assets_read', 'tavern_assets_transfer'],
  'asset-generation': ['tavern_assets_read', 'tavern_asset_generation']
}
export const WORKBENCH_TOOL_NAMES=Object.keys(WORKBENCH_ACTIONS).map(name=>'tavern_'+name)
