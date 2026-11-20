import { COMMANDS, ENV_VARIABLES, GLOBAL_OPTIONS, WIKI_URL, tavernVersion } from './cli-help.mjs'

// man 手册与 --help 共用 COMMANDS / GLOBAL_OPTIONS / ENV_VARIABLES，避免两处描述漂移。
function escapeRoff(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/-/g, '\\-')
    .replace(/^([.'])/gm, '\\&$1')
}

export function renderManPage({ version = tavernVersion() } = {}) {
  const lines = [
    '.TH DSH-TAVERN 1',
    '.SH NAME',
    escapeRoff('dsh-tavern - DSH 酒馆命令行'),
    '.SH SYNOPSIS',
    '.B dsh-tavern',
    '[命令] [选项]',
    '.SH DESCRIPTION',
    'dsh-tavern 安装、启动、停止和更新 DSH 酒馆，并管理它的运行状态。',
    '不带任何命令时默认显示运行状态（等同 status）。',
  ]
  if (version) {
    lines.push('.PP')
    lines.push('版本：' + escapeRoff(version))
  }
  lines.push('.SH COMMANDS')
  for (const command of COMMANDS) {
    lines.push('.TP')
    lines.push('.B ' + command.name)
    lines.push(escapeRoff(command.summary))
    for (const usage of command.usage) {
      lines.push('.br')
      lines.push('用法：' + escapeRoff(usage))
    }
  }
  lines.push('.SH OPTIONS')
  for (const [flags, description] of GLOBAL_OPTIONS) {
    lines.push('.TP')
    lines.push('.B ' + escapeRoff(flags))
    lines.push(escapeRoff(description))
  }
  lines.push('.SH ENVIRONMENT')
  for (const [name, description] of ENV_VARIABLES) {
    lines.push('.TP')
    lines.push('.B ' + escapeRoff(name))
    lines.push(escapeRoff(description))
  }
  lines.push('.SH "EXIT STATUS"')
  lines.push('.TP')
  lines.push('.B 0')
  lines.push('成功。')
  lines.push('.TP')
  lines.push('.B 1')
  lines.push('执行失败。')
  lines.push('.TP')
  lines.push('.B 2')
  lines.push('未知命令、帮助主题或补全参数。')
  lines.push('.SH "SEE ALSO"')
  lines.push(escapeRoff('dsh-tavern help 显示帮助；' + WIKI_URL))
  return lines.join('\n') + '\n'
}
