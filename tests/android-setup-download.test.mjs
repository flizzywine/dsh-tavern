import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const bash = process.env.TEST_BASH || 'bash'
const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)

for (const failures of [0, 1, 3]) {
  test(`setup downloads with ${failures} interrupted Git attempts`, async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'android-setup-download-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const fixture = path.join(directory, 'source')
    const mock = path.join(directory, 'mock')
    await mkdir(path.join(fixture, 'android'), { recursive: true })
    await mkdir(path.join(fixture, 'bin'))
    await mkdir(mock)
    await writeFile(path.join(fixture, '.gitattributes'), await readFile(path.join(root, '.gitattributes')))
    await writeFile(path.join(fixture, 'package.json'), '{}')
    await writeFile(path.join(fixture, 'bin/dsh-tavern.mjs'), '')
    await writeFile(path.join(fixture, 'android/install.sh'), '#!/usr/bin/env bash\ntouch "${DSH_HOME}/installed"\n')
    const archive = path.join(directory, 'source.tar.gz')
    for (const args of [
      ['init', '-b', 'main'], ['add', '.'],
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'],
      ['archive', '--format=tar.gz', '--prefix=source/', '-o', archive, 'HEAD'],
    ]) {
      const result = spawnSync('git', args, { cwd: fixture, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }
    await writeFile(path.join(mock, 'git'), `#!/usr/bin/env bash
set -eu
if [ "$1" != clone ]; then exit 0; fi
count=0
[ ! -f "$TEST_ROOT/attempts" ] || count=$(cat "$TEST_ROOT/attempts")
count=$((count + 1))
echo "$count" > "$TEST_ROOT/attempts"
destination="\${@: -1}"
[ ! -e "$destination" ] || exit 90
mkdir -p "$destination"
if [ "$count" -le "${failures}" ]; then
  touch "$destination/partial"
  exit 1
fi
cp -R "$TEST_ROOT/source/." "$destination/"
`, { mode: 0o755 })
    const result = spawnSync(bash, ['-c', 'export PATH="$TEST_ROOT/mock:$PATH"; exec bash "$TEST_SETUP"'], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, TEST_ROOT: shellPath(directory), TEST_SETUP: shellPath(path.join(root, 'android/setup.sh')),
        DSH_HOME: shellPath(path.join(directory, 'home')), DSH_TAVERN_REPOSITORY: 'test-repository',
        DSH_TAVERN_TARBALL_URL: pathToFileURL(archive).href },
    })
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`)
    assert.equal(await readFile(path.join(directory, 'attempts'), 'utf8'), `${Math.min(failures + 1, 3)}\n`)
    await readFile(path.join(directory, 'home/installed'))
    if (failures === 3) assert.match(result.stdout, /改用 GitHub 压缩包/)
    else assert.doesNotMatch(result.stdout, /改用 GitHub 压缩包/)
  })
}
