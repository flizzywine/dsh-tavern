// Browser-safe metadata and configuration transforms; no transport, disk or host initialization.
export { IMAGE_PROVIDERS } from '../provider-definitions.js'
export { IMAGE_API_PROTOCOLS, effectiveImageProvider, imageReferenceLimit, supportsImageReferences, supportsImageTaskResume } from '../image-provider-capabilities.js'
export { normalizeChannels, publicChannels, activeChannel, channelConfigPatch, migrateLegacyImageConfig } from '../image-channels.js'
