import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execute = promisify(execFile)
const updateModule = new URL('../bin/application-update.mjs', import.meta.url).href
const receiptModule = new URL('../bin/installation-receipt.mjs', import.meta.url).href
const environmentModule = new URL('../bin/launcher-environment.mjs', import.meta.url).href
const proxyKey = /^(https?_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const psQuote = value => "'" + value.replaceAll("'", "''") + "'"
const cases = [
  ['system proxy only', {}],
  ['explicit bypass and disabled Node proxy', { NO_PROXY: '.internal.test', NODE_USE_ENV_PROXY: '0' }],
  ['intentional environment proxy without Node flag', { HTTPS_PROXY: 'http://127.0.0.1:18998', NO_PROXY: '' }],
  ['intentional environment proxy with Node flag', { HTTP_PROXY: 'http://127.0.0.1:18998', NODE_USE_ENV_PROXY: '1', NO_PROXY: 'localhost,.internal.test' }],
  ['lowercase proxy and bypass', { https_proxy: 'http://127.0.0.1:18998', all_proxy: 'http://127.0.0.1:18999', no_proxy: '.internal.test', NODE_USE_ENV_PROXY: '0' }],
]

// Exercise real updater -> installer and updater -> launcher -> service processes.
// System proxy discovery is synthetic; no registry settings or provider requests
// are made. This checks inheritance, not the reporter's Windows network failure.
const lifecycleCases = [...cases, ['repeated update with cached system proxy', {}, 2]]
for (const [name, original, attempts = 1] of lifecycleCases) for (const rollback of [false, true]) {
  test(`${rollback ? 'rollback' : 'successful update'} preserves service environment: ${name}`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-update-proxy-'))
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
    const sourceRoot = path.join(root, 'apps/dsh-tavern')
    const profile = path.join(root, 'profiles/tavern')
    await Promise.all([mkdir(path.join(sourceRoot, 'bin'), { recursive: true }), mkdir(profile, { recursive: true })])
    for (const [file, value] of [
      ['package.json', '{"version":"3.2.0"}'], ['pnpm-lock.yaml', 'fixture'],
      ['.dsh-tavern-local.json', JSON.stringify({ host: 'cli', dshHome: root })],
    ]) await writeFile(path.join(sourceRoot, file), value)
    for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) await writeFile(path.join(profile, file), '{}')
    const select = `Object.fromEntries(Object.entries(process.env).filter(([key]) => ${proxyKey}.test(key)))`
    const installerFile = path.join(root, 'installer.mjs')
    const installerOutput = path.join(root, 'installer-env.json')
    const serviceOutput = path.join(root, 'service-env.json')
    const launcherOutput = path.join(root, 'launcher-env.json')
    await writeFile(installerFile, `
      import { writeFileSync } from 'node:fs';
      import { recordInstallationReceipt } from ${JSON.stringify(receiptModule)};
      writeFileSync(${JSON.stringify(installerOutput)}, JSON.stringify(${select}));
      if (${rollback}) process.exit(23);
      await recordInstallationReceipt({ sourceRoot: ${JSON.stringify(sourceRoot)}, dshHome: process.env.DSH_HOME, host: 'cli', attemptId: process.env.DSH_TAVERN_INSTALL_ATTEMPT });
    `)
    await writeFile(path.join(sourceRoot, 'install.sh'), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(installerFile)}\n`)
    await writeFile(path.join(sourceRoot, 'install.ps1'), `& ${psQuote(process.execPath)} ${psQuote(installerFile)}\nexit $LASTEXITCODE\n`)
    const serviceScript = `require('node:fs').writeFileSync(${JSON.stringify(serviceOutput)}, JSON.stringify(${select}))`
    await writeFile(path.join(sourceRoot, 'bin/dsh-tavern.mjs'), `
      import { spawnSync } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { runtimeEnvironment } from ${JSON.stringify(environmentModule)};
      if (process.argv[2] !== 'start') throw new Error('expected start');
      if (process.env.DSH_TAVERN_INSTALL_FIXTURE) throw new Error('installer flag leaked');
      writeFileSync(${JSON.stringify(launcherOutput)}, JSON.stringify(${select}));
      const child = spawnSync(process.execPath, ['-e', ${JSON.stringify(serviceScript)}], { env: runtimeEnvironment({ installation: false }), encoding: 'utf8' });
      if (child.error || child.status !== 0) throw child.error || new Error(child.stderr);
    `)
    const runner = path.join(root, 'run-update.mjs')
    await writeFile(runner, `
      import childProcess from 'node:child_process';
      import http from 'node:http';
      import { syncBuiltinESMExports } from 'node:module';
      import { readFileSync } from 'node:fs';
      import assert from 'node:assert/strict';
      const originalExec = childProcess.execFileSync;
      childProcess.execFileSync = (command, args, options) => {
        if (command === 'reg') return '    ProxyEnable    REG_DWORD    0x1\\n    ProxyServer    REG_SZ    127.0.0.1:18997\\n';
        if (command === 'gsettings') return args.at(-1) === 'mode' ? "'manual'" : args.at(-1) === 'host' ? "'127.0.0.1'" : '18997';
        if (command === 'scutil') return '  HTTPEnable : 1\\n  HTTPProxy : 127.0.0.1\\n  HTTPPort : 18997\\n';
        return originalExec(command, args, options);
      };
      // Do not change the runner's dispatcher; only inspect environment transfer.
      http.setGlobalProxyFromEnv = () => {};
      syncBuiltinESMExports();
      const { recordInstallationReceipt } = await import(${JSON.stringify(receiptModule)});
      if (${rollback}) await recordInstallationReceipt({ sourceRoot: ${JSON.stringify(sourceRoot)}, dshHome: ${JSON.stringify(root)}, host: 'cli', attemptId: 'previous' });
      const { updateApplication } = await import(${JSON.stringify(updateModule)});
      for (let attempt = 0; attempt < ${attempts}; attempt++) {
      try {
        await updateApplication({ sourceRoot: ${JSON.stringify(sourceRoot)}, dshHome: ${JSON.stringify(root)}, host: 'cli', statusFile: ${JSON.stringify(path.join(root, 'update-status.json'))}, log() {} });
        if (${rollback}) throw new Error('expected installer failure');
      } catch (error) {
        if (!${rollback} || !/23/.test(error.message)) throw error;
      }
      const canonical = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toUpperCase(), item]));
      assert.deepEqual(canonical(JSON.parse(readFileSync(${JSON.stringify(serviceOutput)}, 'utf8'))), canonical(${JSON.stringify(original)}));
      if (${attempts} > 1 && ['win32', 'linux', 'darwin'].includes(process.platform)) {
        const installer = JSON.parse(readFileSync(${JSON.stringify(installerOutput)}, 'utf8'));
        assert.equal(installer.HTTPS_PROXY, 'http://127.0.0.1:18997');
        assert.equal(installer.NODE_USE_ENV_PROXY, '1');
      }
      }
    `)
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !proxyKey.test(key) && !/^DSH_|^NODE_OPTIONS$/i.test(key)))
    Object.assign(env, original, { DSH_HOME: root, DSH_TAVERN_CLI_HOME: root, DSH_TAVERN_RUNTIME_HOST: 'cli', DSH_TAVERN_INSTALL_FIXTURE: 'must-not-leak' })
    await execute(process.execPath, [runner], { env, timeout: 30000 })
    const read = async file => JSON.parse(await readFile(file, 'utf8'))
    // Windows environment keys are case insensitive: compare canonical names.
    const canonical = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toUpperCase(), item]))
    assert.deepEqual(canonical(await read(launcherOutput)), canonical(original))
    assert.deepEqual(canonical(await read(serviceOutput)), canonical(original))
    const installer = canonical(await read(installerOutput))
    const hasOriginalProxy = !!(original.HTTPS_PROXY || original.HTTP_PROXY || original.https_proxy)
    const systemDetected = ['linux', 'win32', 'darwin'].includes(process.platform)
    if (!hasOriginalProxy && systemDetected) {
      assert.equal(installer.HTTP_PROXY, 'http://127.0.0.1:18997')
      assert.equal(installer.HTTPS_PROXY, 'http://127.0.0.1:18997')
    }
    assert.equal(installer.NODE_USE_ENV_PROXY, original.NODE_USE_ENV_PROXY ?? (hasOriginalProxy || systemDetected ? '1' : undefined))
    const status = await read(path.join(root, 'update-status.json'))
    assert.equal(status.phase, rollback ? 'failed' : 'completed')
    if (rollback) assert.match(status.error, /已恢复原版本并继续运行/)
  })
}

for (const [name, original] of cases) {
  test(`UI updater launch removes only plugin-added proxy values: ${name}`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-ui-update-proxy-'))
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
    const output = path.join(root, 'launch-env.json')
    const runner = path.join(root, 'runner.mjs')
    await writeFile(path.join(root, 'package.json'), '{"version":"3.2.0"}')
    await writeFile(runner, `
      import http from 'node:http';
      import { writeFileSync } from 'node:fs';
      import { applySystemProxy } from ${JSON.stringify(new URL('../bin/system-proxy.mjs', import.meta.url).href)};
      import { createApplicationUpdater } from ${JSON.stringify(new URL('../tavern-plugin/lib/application-updater.js', import.meta.url).href)};
      http.setGlobalProxyFromEnv = () => {};
      applySystemProxy(process.env, { platform: 'win32', exec: () => '    ProxyEnable    REG_DWORD    0x1\\n    ProxyServer    REG_SZ    127.0.0.1:18997\\n' });
      const updater = createApplicationUpdater({
        sourceRoot: ${JSON.stringify(root)}, dshHome: ${JSON.stringify(root)}, dataRoot: ${JSON.stringify(path.join(root, 'data'))}, runtimeHost: 'cli', platform: 'linux',
        readLocalIdentity: async () => ({ currentVersion: '3.2.0', currentCommit: 'a'.repeat(40) }),
        fetchManifest: async () => ({ version: '3.2.0' }), fetchLatestCommit: async () => 'b'.repeat(40),
        fetchCdnMetadata: async () => { throw new Error('offline fixture') }, compareCommits: async () => 'ahead',
        spawnProcess(_command, _args, options) {
          writeFileSync(${JSON.stringify(output)}, JSON.stringify(Object.fromEntries(Object.entries(options.env).filter(([key]) => ${proxyKey}.test(key)))));
          return { unref() {} };
        },
      });
      await updater.start();
    `)
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !proxyKey.test(key) && !/^DSH_|^NODE_OPTIONS$/i.test(key)))
    Object.assign(env, original)
    await execute(process.execPath, [runner], { env, timeout: 30000 })
    const canonical = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toUpperCase(), item]))
    assert.deepEqual(canonical(JSON.parse(await readFile(output, 'utf8'))), canonical(original))
  })
}
