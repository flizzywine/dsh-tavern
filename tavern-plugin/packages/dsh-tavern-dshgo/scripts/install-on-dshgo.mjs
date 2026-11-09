#!/usr/bin/env node
// 把酒馆装进 dsh-go 的 web profile。
//
// dsh-go 的 web profile 在 ~/.dsh/profiles/web，由 App 内的 pnpm 维护；
// 酒馆的六个包是本仓库里的私有包，两个是打过补丁的 npm 包，五个 @deepseek-ai/*
// 必须借用宿主（/opt/dsh/node_modules）那一份，不能另装——装上第二份会让插件的
// ctx 与服务注册对不上。
//
// 用法：node scripts/install-on-dshgo.mjs [--dry-run] [--dsh-home DIR] [--app-root DIR]
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { TAVERN_BUNDLES } from '../lib/status.js'
import { mergeBundles } from '../lib/bundles.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = resolve(HERE, '..')
export const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..', '..')

/** 本仓库里的私有包：用 link: 指回源码目录，不复制——酒馆从 lib 里按 ../../bin 这类相对路径取仓库根的 bin/、shared/、packages/。 */
export const LOCAL_PACKAGES = Object.freeze({
  'dsh-tavern-plugin': 'tavern-plugin',
  'dsh-tavern-remote': 'tavern-plugin/packages/dsh-tavern-remote',
  'dsh-dream-skin': 'tavern-plugin/packages/dsh-dream-skin',
  'dsh-asset-library': 'tavern-plugin/packages/dsh-asset-library',
  'dsh-tavern-stage': 'tavern-plugin/packages/dsh-tavern-stage',
  'dsh-tavern-tts': 'tavern-plugin/packages/dsh-tavern-tts',
})

/** 打补丁的 npm 包：版本号必须和 patches/ 里的文件名对齐，否则 pnpm 不会套补丁。 */
export const NPM_PACKAGES = Object.freeze({
  'dsh-web-mobile': '3.1.0',
  'dsh-better-sidebar': '0.28.0',
})

/** 必须指向宿主那一份的包；插件 import 它们，另装一份会拿到不同的服务实例。 */
export const HOST_PACKAGES = Object.freeze([
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
])

const PATCH_FILES = [
  'dsh-better-sidebar@0.28.0.patch',
  'dsh-web-mobile@3.1.0.patch',
]

/** pnpm 在 proot 里要的三条设置：复制而非硬链接（跨层不共享 inode）、不缓存副作用、忽略发布年龄。 */
export const PNPM_ARGS = [
  'install',
  '--config.minimum-release-age=0',
  '--config.package-import-method=copy',
  '--config.side-effects-cache=false',
]

function yamlValue(value) {
  return /^[A-Za-z0-9@/._-]+$/.test(value) ? value : JSON.stringify(value)
}

/** 只写酒馆需要的那几条；App 自己写的内容原样留在文件末尾。 */
export function workspaceYaml(patches, appRoot = '/opt/dsh') {
  const lines = [
    'packages:',
    '  - .',
    'nodeLinker: hoisted',
    'autoInstallPeers: false',
    'confirmModulesPurge: false',
    'ignorePnpmfile: true',
    'allowBuilds:',
    '  esbuild: true',
    '  sharp: true',
    '  node-pty: false',
    'minimumReleaseAgeExclude:',
    '  - dsh-web-mobile@3.1.0',
    '  - dsh-better-sidebar@0.28.0',
    // sharp 与 undici 常把这两个包拉到当天发布的新版本；锁到具体版本会随上游升级再次撞策略，
    // 所以按包名放行。它们只是实现细节，不参与酒馆的行为。
    '  - ws',
    '  - wasm-feature-detect',
    // pnpm 只认这里的 overrides；package.json 顶层的 overrides 是 npm/yarn 的字段，会被无视。
    // 五个宿主包 link 回 App 自己那一份：另装一份版本对不上会被判 incompatible 并禁用整行。
    'overrides:',
    ...HOST_PACKAGES.map(name => `  ${yamlValue(name)}: ${yamlValue(`link:${appRoot}/node_modules/${name}`)}`),
    'patchedDependencies:',
  ]
  // 键是「包名@版本」，值是补丁文件路径；版本对不上 pnpm 就不会套补丁。
  for (const file of patches) lines.push(`  ${yamlValue(file.replace(/\.patch$/, ''))}: ${yamlValue(join('patches', file))}`)
  return `${lines.join('\n')}\n`
}

/**
 * 把酒馆的依赖与 bundle 合并进 profile 的 package.json。
 * 已有条目一律保留顺序，只补缺的；@deepseek-ai/* 写 overrides 指回宿主。
 */
export function mergeProfileManifest(manifest, { appRoot = '/opt/dsh', srcRoot = REPO_ROOT } = {}) {
  const next = structuredClone(manifest)
  if (next.dependencies === undefined || next.dependencies === null) next.dependencies = {}
  for (const [name, relative] of Object.entries(LOCAL_PACKAGES)) {
    next.dependencies[name] = `link:${join(srcRoot, relative)}`
  }
  for (const [name, version] of Object.entries(NPM_PACKAGES)) if (next.dependencies[name] === undefined) next.dependencies[name] = version
  for (const name of Object.keys(NPM_PACKAGES)) next.dependencies[name] = NPM_PACKAGES[name]

  if (next.dsh === undefined || next.dsh === null) next.dsh = {}
  if (next.dsh.profile === undefined || next.dsh.profile === null) next.dsh.profile = {}
  next.dsh.profile.bundles = mergeBundles(
    Array.isArray(next.dsh.profile.bundles) ? next.dsh.profile.bundles : [],
    TAVERN_BUNDLES,
  )
  return next
}

/** 装机前先把要做的事列出来，dry-run 与真跑共用这一份。 */
export function planInstall({ srcRoot = REPO_ROOT, dshHome = join('/root', '.dsh'), appRoot = '/opt/dsh' } = {}) {
  const profile = join(dshHome, 'profiles', 'web')
  const steps = []
  // 源码原地不动：六个包用 link: 指过去，仓库结构（bin/ shared/ packages/）保持完整。
  for (const file of PATCH_FILES) {
    steps.push({ kind: 'copy-file', name: file, from: join(srcRoot, 'patches', file), to: join(profile, 'patches', file) })
  }
  steps.push({ kind: 'manifest', name: 'package.json', to: join(profile, 'package.json'), appRoot, srcRoot })
  steps.push({ kind: 'workspace', name: 'pnpm-workspace.yaml', to: join(profile, 'pnpm-workspace.yaml'), patches: PATCH_FILES, appRoot })
  steps.push({ kind: 'pnpm', name: 'pnpm install', cwd: profile, args: PNPM_ARGS })
  steps.push({ kind: 'verify', name: 'verify', profile, appRoot })
  const sources = Object.values(LOCAL_PACKAGES).map(relative => join(srcRoot, relative, 'package.json'))
  return { profile, steps, missingSources: sources.filter(file => !existsSync(file)) }
}

function backup(file) {
  const target = `${file}.pre-tavern`
  if (existsSync(target) || !existsSync(file)) return target
  cpSync(file, target)
  return target
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 退出码 ${result.status}`)
}

export function applyInstall(plan, { dry = false, log = console.log } = {}) {
  if (plan.missingSources.length > 0) {
    throw new Error(`源码缺文件，先确认在仓库根跑：\n${plan.missingSources.join('\n')}`)
  }
  for (const step of plan.steps) {
    if (step.kind === 'copy-file') {
      log(`复制 ${step.from} → ${step.to}`)
      if (dry) continue
      mkdirSync(dirname(step.to), { recursive: true })
      cpSync(step.from, step.to)
    } else if (step.kind === 'manifest') {
      log(`合并 ${step.to}（dependencies / dsh.profile.bundles）`)
      if (dry) continue
      const manifest = JSON.parse(readFileSync(step.to, 'utf8'))
      backup(step.to)
      const merged = mergeProfileManifest(manifest, { appRoot: step.appRoot, srcRoot: step.srcRoot })
      const temporary = `${step.to}.tavern-tmp`
      writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`)
      renameSync(temporary, step.to)
    } else if (step.kind === 'workspace') {
      log(`写 ${step.to}（overrides + patchedDependencies + pnpm 设置）`)
      if (dry) continue
      backup(step.to)
      writeFileSync(step.to, workspaceYaml(step.patches, step.appRoot))
    } else if (step.kind === 'pnpm') {
      log(`在 ${step.cwd} 跑 pnpm ${step.args.join(' ')}`)
      if (dry) continue
      run('pnpm', step.args, step.cwd)
    } else if (step.kind === 'verify') {
      log('校验 8 个 bundle 与 5 个宿主包能否解析')
      if (dry) continue
      const missing = []
      for (const name of TAVERN_BUNDLES) {
        if (!existsSync(join(step.profile, 'node_modules', name, 'package.json'))) missing.push(name)
      }
      for (const name of HOST_PACKAGES) {
        if (!existsSync(join(step.profile, 'node_modules', name, 'package.json'))) missing.push(name)
      }
      if (missing.length > 0) throw new Error(`装完仍解析不到：${missing.join(', ')}`)
      log('OK')
    }
  }
}

function parseArgs(argv) {
  const options = { dry: false, dshHome: process.env.DSH_HOME ?? '/root/.dsh', appRoot: process.env.DSH_APP_ROOT ?? '/opt/dsh', srcRoot: REPO_ROOT }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') options.dry = true
    else if (arg === '--dsh-home') options.dshHome = argv[++index]
    else if (arg === '--app-root') options.appRoot = argv[++index]
    else if (arg === '--src') options.srcRoot = resolve(argv[++index])
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`不认识的参数：${arg}`)
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('用法：node scripts/install-on-dshgo.mjs [--dry-run] [--dsh-home DIR] [--app-root DIR] [--src DIR]')
    return
  }
  const plan = planInstall(options)
  applyInstall(plan, { dry: options.dry })
  if (options.dry) {
    console.log('\n（dry-run，没有改动任何文件）')
    return
  }
  console.log('\n装好了。下一步：')
  console.log('  1. 关掉 dsh-go 里的引擎，再回来启动它（App「引擎」页的重启按钮）')
  console.log('  2. 引擎里会出现「酒馆」原生面板；面板上再点一次「启用酒馆」把 bundle 写进去')
  console.log('  3. 想退回：把 profiles/web/package.json.pre-tavern 拷回 package.json，再重启引擎')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
