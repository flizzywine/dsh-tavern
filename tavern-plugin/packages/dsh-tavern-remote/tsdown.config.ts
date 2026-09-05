import type { UserConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

const host: UserConfig = {
  name: 'dsh-tavern-remote',
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
}

const clientExternals = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-api-gateway/client']
const client: UserConfig = {
  name: 'dsh-tavern-remote/client',
  entry: { client: 'lib/types/client.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: clientExternals,
  noExternal: (id: string) => clientExternals.includes(id) ? undefined : true,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-tavern-remote", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default process.env.DSH_BUILD_FACE === 'client' ? client : host
