import { readFileSync } from 'node:fs'

const protocol = readFileSync(new URL('../../tavern-plugin/lib/domain/style-reference-protocol.cjs', import.meta.url), 'utf8')

// These fixtures run the raw transcript fragment the way the client bundle includes it.
export const withStyleReferenceProtocol = source => source.replace('// @include-domain style-reference-protocol.cjs', () => protocol)
