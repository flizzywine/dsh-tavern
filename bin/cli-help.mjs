import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE_FILE = fileURLToPath(new URL('../package.json', import.meta.url))
export const WIKI_URL = 'https://github.com/flizzywine/dsh-tavern/wiki'
export const HOST_VALUES = ['cli', 'desktop', 'next', 'android']

// 帮助文本只描述命令行本身，不读取安装环境，未安装依赖时也能单独测试。
export const COMMANDS = [
  {
    name: 'install',
    group: '安装与更新',
    summary: '安装酒馆，或切换已安装的酒馆宿主',
    usage: ['dsh-tavern install [--host cli|desktop|next|android]'],
    body: [
      '安装酒馆，或把已安装的酒馆切换为指定宿主。',
      '',
      '宿主：',
      '  cli       命令行版：自带独立 DSH 运行时，需要 Node.js 22.19+ 与',
      '            pnpm，默认安装到 ~/.dsh-tavern',
      '  desktop   官方 DeepSeek Harness 桌面版：安装后由桌面宿主启动',
      '  next      DSH NEXT：由应用管理安装、启动与切换；更新源码后重新运行',
      '            dsh-tavern install --host next',
      '  android   Android 应用内安装',
      '',
      '省略 --host 时沿用当前安装的宿主，否则用 DSH_TAVERN_HOST（默认 cli）。',
      '重复安装会保留人物卡、会话和设置。安装过程较慢，请保持终端运行。',
    ],
  },
  {
    name: 'update',
    group: '安装与更新',
    summary: '检查并更新到最新版本',
    usage: ['dsh-tavern update'],
    body: [
      '检查并更新酒馆到最新版本；更新会保留人物卡、会话和设置。',
      '桌面版由宿主应用负责更新流程，更新完成后会重新打开应用。',
      '通常由安装脚本或应用内「检查更新」触发，一般不需要手动执行。',
    ],
  },
  {
    name: 'start',
    group: '运行',
    summary: '启动酒馆，并显示访问地址',
    usage: ['dsh-tavern start'],
    body: [
      '启动酒馆并显示访问地址；首次启动或更新后较慢，',
      '默认最多等待 120 秒（DSH_TAVERN_START_TIMEOUT）。',
      '服务已在运行时只确认状态，不重复启动。',
    ],
  },
  {
    name: 'stop',
    group: '运行',
    summary: '停止酒馆',
    usage: ['dsh-tavern stop'],
    body: [
      '停止由 dsh-tavern 启动的酒馆服务。',
      '端口被其它程序占用时不会结束该进程。',
    ],
  },
  {
    name: 'restart',
    group: '运行',
    summary: '重启酒馆',
    usage: ['dsh-tavern restart'],
    body: [
      '停止后重新启动酒馆，用于更新完成或页面无法连接时；数据与设置保留。',
    ],
  },
  {
    name: 'status',
    group: '运行',
    summary: '查看运行状态和访问地址',
    usage: ['dsh-tavern status'],
    body: [
      '查看酒馆是否在运行；运行时显示 PID 和访问地址。',
      '不带任何命令时默认执行本命令。',
    ],
  },
  {
    name: 'open',
    group: '运行',
    summary: '在浏览器中打开酒馆',
    usage: ['dsh-tavern open'],
    body: [
      '在默认浏览器中打开正在运行的酒馆。',
      '服务未运行或未就绪时，会提示先运行 dsh-tavern start。',
    ],
  },
  {
    name: 'window',
    group: '运行',
    summary: '用独立应用窗口打开（仅桌面版）',
    usage: ['dsh-tavern window'],
    body: [
      '用独立应用窗口打开酒馆，仅供桌面版快捷方式使用；',
      '命令行版请用 dsh-tavern open。',
    ],
  },
  {
    name: 'completion',
    group: '帮助',
    summary: '输出 shell 补全脚本',
    usage: ['dsh-tavern completion bash|zsh|fish|powershell'],
    body: [
      '把补全脚本输出到标准输出，支持 bash、zsh、fish 和 powershell。',
      '',
      '启用方式：',
      '  bash        eval "$(dsh-tavern completion bash)"',
      '              或写入 ~/.bash_completion 由 bash-completion 加载',
      '  zsh         保存为 _dsh-tavern 放入 $fpath，或 eval "$(dsh-tavern completion zsh)"',
      '  fish        dsh-tavern completion fish > ~/.config/fish/completions/dsh-tavern.fish',
      '  powershell  dsh-tavern completion powershell | Out-String | Invoke-Expression',
      '',
      '补全内容跟随当前版本的全部命令与 install --host 取值。',
    ],
  },
  {
    name: 'man',
    group: '帮助',
    summary: '输出 man 手册',
    usage: ['dsh-tavern man'],
    body: [
      '以 roff 格式输出 dsh-tavern 的 man 手册。',
      '',
      '查看方式：',
      '  man -l <(dsh-tavern man)          直接分页查看（bash/zsh）',
      '  dsh-tavern man > dsh-tavern.1     先写入文件，再 man dsh-tavern.1',
      '',
      '手册包含全部命令、全局选项、环境变量和退出码。',
    ],
  },
  {
    name: 'help',
    group: '帮助',
    summary: '显示帮助；给出命令名时显示该命令的完整说明',
    usage: ['dsh-tavern help [命令]', 'dsh-tavern <命令> --help'],
    body: [
      '显示全部命令；给出命令名时显示该命令的用法、参数和说明。',
      '',
      '也可以直接用 dsh-tavern <命令> --help。',
      '',
      '可用的命令名：install、update、start、stop、restart、status、open、',
      'window、completion、man、help。',
    ],
  },
]

const EXAMPLES = [
  ['dsh-tavern install --host cli', '安装命令行版（数据目录 ~/.dsh-tavern）'],
  ['dsh-tavern start', '启动并显示访问地址'],
  ['dsh-tavern open', '在浏览器中打开'],
  ['dsh-tavern completion bash', '输出 bash 补全脚本'],
  ['dsh-tavern help install', '查看安装宿主的说明'],
]

export const ENV_VARIABLES = [
  ['DSH_TAVERN_HOST=cli|desktop|next|android', '默认安装宿主；未指定 --host 时使用'],
  ['DSH_TAVERN_PORT=3081', '服务端口；被占用且未显式设置时自动顺延到下一个空闲端口'],
  ['DSH_TAVERN_BIND=127.0.0.1', '监听地址；默认仅本机，远程访问须指定可信内网或 VPN 地址'],
  ['DSH_TAVERN_CLI_HOME=~/.dsh-tavern', '命令行版的数据目录'],
  ['DSH_TAVERN_NO_OPEN=1', '启动时不自动打开浏览器'],
  ['DSH_TAVERN_START_TIMEOUT=120', '等待服务启动的秒数'],
]

// 全帮助与 man 手册共用同一份全局选项表。
export const GLOBAL_OPTIONS = [
  ['-h, --help', '显示帮助；放在命令后显示该命令的说明'],
  ['-v, -V, --version', '显示版本'],
  ['--', '结束选项；其后的参数按位置参数处理'],
]

export function tavernVersion() {
  try {
    const meta = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8'))
    return typeof meta.version === 'string' ? meta.version.trim() : ''
  } catch {
    return ''
  }
}

export function commandNames() {
  return COMMANDS.map(command => command.name)
}

export function hasCommand(topic) {
  return COMMANDS.some(command => command.name === topic)
}

export function renderHelp({ version = tavernVersion() } = {}) {
  const lines = [
    'DSH 酒馆（dsh-tavern）' + (version || ''),
    '',
    '用法：',
    '  dsh-tavern <命令> [选项]',
    '  dsh-tavern                     显示运行状态（等同 status）',
    '',
  ]
  for (const group of ['安装与更新', '运行', '帮助']) {
    lines.push(group + '：')
    for (const command of COMMANDS.filter(item => item.group === group)) {
      lines.push('  ' + command.name.padEnd(12) + command.summary)
    }
    lines.push('')
  }
  lines.push('全局选项：')
  for (const [flags, description] of GLOBAL_OPTIONS) lines.push('  ' + flags.padEnd(20) + description)
  lines.push('')
  lines.push('常用示例：')
  for (const [example, description] of EXAMPLES) lines.push('  ' + example.padEnd(32) + description)
  lines.push('')
  lines.push('环境变量：')
  for (const [name, description] of ENV_VARIABLES) {
    lines.push('  ' + name)
    lines.push('        ' + description)
  }
  lines.push('')
  lines.push('退出码：0 成功；1 执行失败；2 未知命令或参数。')
  lines.push('文档：' + WIKI_URL)
  return lines.join('\n')
}

export function renderCommandHelp(topic) {
  const command = COMMANDS.find(item => item.name === topic)
  if (!command) return ''
  const lines = ['用法：']
  for (const usage of command.usage) lines.push('  ' + usage)
  lines.push('')
  lines.push(...command.body)
  return lines.join('\n')
}
