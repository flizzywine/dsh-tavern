import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Run with the extracted Electron executable in ELECTRON_RUN_AS_NODE mode.
const runtime = path.resolve(process.argv[2]);
const scratch = path.resolve(process.argv[3]);
fs.mkdirSync(scratch, { recursive: true });
const fixture = path.join(scratch, '命令 入口.mjs');
fs.writeFileSync(fixture, 'console.log(JSON.stringify(process.argv.slice(2)))');
const {prepare}=createRequire(import.meta.url)(path.join(runtime,'resources','official-desktop-runtime.cjs'));
const environment = { ...process.env };
Object.assign(environment,prepare({executable:process.execPath,home:path.join(scratch,'旧数据'),env:environment}));
// Both shims must transport Unicode entry paths independently of cmd's code page.
environment.DSH_DESKTOP_DSH_BOOTSTRAP=fixture;
environment.DSH_DESKTOP_PNPM_ENTRY=fixture;
for (const command of ['dsh probe', 'pnpm probe', 'node --version']) {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `chcp 936>nul & ${command}`], { env: environment, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  if (command.startsWith('node')) assert.match(result.stdout.trim(), /^v\d+\./);
  else assert.equal(JSON.parse(result.stdout).at(-1), 'probe');
  console.log(`PASS: ${command} works from a Unicode path under code page 936`);
}
