// Build staging only. Run with the pinned official Electron in Node mode.
// Read through Electron's ASAR filesystem; write outside the archive using original-fs.
const fs = require('node:fs');
const disk = require('original-fs');
const path = require('node:path');
const resources = path.resolve(process.argv[2]);
const archive = path.join(resources, 'app.asar');
const output = path.join(resources, 'app');
const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
if (manifest.name !== '@deepseek-ai/dsh-desktop' || manifest.version !== '0.2.1-rc.2') throw Error('Unexpected official desktop build');
if (disk.existsSync(output)) throw Error('Build staging app directory already exists');
function copy(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    disk.mkdirSync(destination, {recursive: true});
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name));
  } else disk.writeFileSync(destination, fs.readFileSync(source), {mode: stat.mode});
}
copy(archive, output);
manifest.main = 'lib/tavern-portable.js';
disk.writeFileSync(path.join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
// Official Electron permits unpacked app loading (OnlyLoadAppFromAsar is disabled).
// Remove the archive only after every file, including native unpacked files, was copied.
disk.rmSync(archive);
disk.rmSync(archive + '.unpacked', {recursive: true, force: true});

// This distribution upgrades its pinned host through the Tavern Setup.
// Do not let upstream auto-update replace the managed launcher distribution.
disk.rmSync(path.join(resources, 'app-update.yml'), {force: true});
