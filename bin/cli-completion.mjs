import { COMMANDS, HOST_VALUES } from './cli-help.mjs'

// 补全脚本只依赖命令表，不读取安装环境；与 --help 共用同一份命令元数据。
export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish', 'powershell']

const COMMAND_NAMES = COMMANDS.map(command => command.name)
const HOSTS = [...HOST_VALUES]

function commandDescriptions() {
  return COMMANDS.map(command => [command.name, command.summary])
}

export function renderCompletion(shell) {
  switch (shell) {
    case 'bash': return renderBash()
    case 'zsh': return renderZsh()
    case 'fish': return renderFish()
    case 'powershell': return renderPowerShell()
    default: return ''
  }
}

function renderBash() {
  return [
    '# bash completion for dsh-tavern',
    '# 启用：eval "$(dsh-tavern completion bash)"',
    '# 或保存为 ~/.bash_completion 由 bash-completion 自动加载。',
    '_dsh_tavern() {',
    '  local cur prev',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    '    COMPREPLY=( $(compgen -W "' + COMMAND_NAMES.join(' ') + '" -- "$cur") )',
    '    return 0',
    '  fi',
    '  case "${COMP_WORDS[1]}" in',
    '    install)',
    '      if [ "$prev" = "--host" ]; then',
    '        COMPREPLY=( $(compgen -W "' + HOSTS.join(' ') + '" -- "$cur") )',
    '        return 0',
    '      fi',
    '      COMPREPLY=( $(compgen -W "--host" -- "$cur") )',
    '      ;;',
    '    completion)',
    '      COMPREPLY=( $(compgen -W "' + COMPLETION_SHELLS.join(' ') + '" -- "$cur") )',
    '      ;;',
    '    *)',
    '      COMPREPLY=( $(compgen -W "--help" -- "$cur") )',
    '      ;;',
    '  esac',
    '}',
    'complete -F _dsh_tavern dsh-tavern',
  ].join('\n') + '\n'
}

function renderZsh() {
  const entries = commandDescriptions().map(([name, summary]) => "    '" + name + ':' + summary.replace(/'/g, "'\\''") + "'").join('\n')
  return [
    '#compdef dsh-tavern',
    '# 启用：保存为 _dsh-tavern 放入 $fpath，或 eval "$(dsh-tavern completion zsh)"。',
    '_dsh_tavern() {',
    '  local -a commands',
    '  commands=(',
    entries,
    '  )',
    '  if (( CURRENT == 2 )); then',
    "    _describe 'command' commands",
    '    return',
    '  fi',
    '  case $words[2] in',
    '    install)',
    "      if [[ $words[3] == '--host' ]]; then",
    "        _values 'host' " + HOSTS.join(' '),
    '      else',
    "        _values 'option' '--host'",
    '      fi',
    '      ;;',
    '    completion)',
    "      _values 'shell' " + COMPLETION_SHELLS.join(' '),
    '      ;;',
    '    *)',
    "      _values 'option' '--help'",
    '      ;;',
    '  esac',
    '}',
    '_dsh_tavern "$@"',
  ].join('\n') + '\n'
}

function renderFish() {
  const lines = [
    '# fish completion for dsh-tavern',
    '# 启用：dsh-tavern completion fish > ~/.config/fish/completions/dsh-tavern.fish',
    'complete -c dsh-tavern -f',
  ]
  for (const [name, summary] of commandDescriptions()) {
    lines.push('complete -c dsh-tavern -n "__fish_use_subcommand" -a ' + name + " -d '" + summary.replace(/'/g, "\\'") + "'")
  }
  lines.push('complete -c dsh-tavern -n "__fish_seen_subcommand_from install" -l host -xa "' + HOSTS.join(' ') + '" -d \'安装宿主\'')
  lines.push('complete -c dsh-tavern -n "__fish_seen_subcommand_from completion" -xa "' + COMPLETION_SHELLS.join(' ') + '" -d \'shell\'')
  lines.push('complete -c dsh-tavern -n "__fish_seen_subcommand_from help" -xa "' + COMMAND_NAMES.join(' ') + '" -d \'命令\'')
  return lines.join('\n') + '\n'
}

function renderPowerShell() {
  const commands = COMMAND_NAMES.map(name => "'" + name + "'").join(', ')
  const shells = COMPLETION_SHELLS.map(shell => "'" + shell + "'").join(', ')
  const hosts = HOSTS.map(host => "'" + host + "'").join(', ')
  return [
    '# PowerShell completion for dsh-tavern',
    '# 启用：dsh-tavern completion powershell | Out-String | Invoke-Expression',
    '# 持久化：把本脚本加入 $PROFILE。',
    'Register-ArgumentCompleter -Native -CommandName dsh-tavern -ScriptBlock {',
    '  param($wordToComplete, $commandAst, $cursorPosition)',
    '  $commands = @(' + commands + ')',
    '  $hosts = @(' + hosts + ')',
    '  $elements = $commandAst.CommandElements',
    '  if ($elements.Count -le 2) {',
    '    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
    "      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
    '    }',
    '    return',
    '  }',
    '  $subcommand = $elements[1].Value',
    "  if ($subcommand -eq 'install' -and $elements[-1].Value -eq '--host') {",
    '    $candidates = $hosts',
    '  } else {',
    '    $candidates = switch ($subcommand) {',
    "      'install' { @('--host') }",
    '      \'completion\' { @(' + shells + ') }',
    '      \'help\' { $commands }',
    "      default { @('--help') }",
    '    }',
    '  }',
    '  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
    "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
    '  }',
    '}',
  ].join('\n') + '\n'
}
