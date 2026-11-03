'use strict'
// The stage's media resources (dsh-tavern-stage lib/client/resources.cjs), built once per process the way the stage
// builds them once per page (entry.js `stageResources`), so owners, crops and bundle files are shared like on a page.
// browserSource is the same module for page harnesses that read sources as scripts: it declares the same names.
const fs = require('node:fs')
const path = require('node:path')
const file = path.join(__dirname, '../../tavern-plugin/packages/dsh-tavern-stage/lib/client/resources.cjs')
const resources = require(file).createStageResourcesModule()
exports.stageDecodeImage = resources.stageDecodeImage
exports.createStageResourceOwner = resources.createStageResourceOwner
exports.stageResourceMatches = resources.stageResourceMatches
exports.stageAvatarBitmap = resources.stageAvatarBitmap
exports.stageAvatarCap = resources.stageAvatarCap
exports.stageMediaTier = resources.stageMediaTier
exports.stagePreviewBitmap = resources.stagePreviewBitmap
exports.getStageAvatarCrop = resources.getStageAvatarCrop
exports.getStageBundleFiles = resources.getStageBundleFiles
exports.browserSource = fs.readFileSync(file, 'utf8').replace(/^'use strict';/m, '') +
  `\nconst {${Object.keys(resources).join(', ')}} = createStageResourcesModule();\n`
