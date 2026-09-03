import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Follow the plugin's actual host link, not a coincidentally hoisted transitive
// dependency in its node_modules. An explicit boot target selects another host.
const pluginRequire = createRequire(new URL('../../tavern-plugin/package.json', import.meta.url))
const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
const sessionUrl = process.env.DSH_BOOT_MODULE
  ? new URL('../../dsh-session/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE))
  : pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-session'))
export const { Session, adoptSessionEvent } = await import(sessionUrl.href)
