#!/bin/sh
# 本机开发：把本地代码库（含未提交的修改）同步到本机命令行版并重启，不经 GitHub。
#   sh bin/dev-sync-cli.sh            # 默认 ~/.dsh-tavern；DSH_TAVERN_CLI_HOME 可改
# 只同步运行所需的路径；装好的 node_modules 不动。改了 package.json / pnpm-lock.yaml 时请正常更新一次。
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI_HOME=${DSH_TAVERN_CLI_HOME:-$HOME/.dsh-tavern}
APP=$CLI_HOME/apps/dsh-tavern
[ -d "$APP" ] || { echo "找不到本机命令行版：$APP" >&2; exit 1; }
cd "$ROOT"
node bin/build-tavern-client.mjs >/dev/null
PATHS="bin config presets patches tavern-plugin package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml install.ps1 install.sh"
if ! cmp -s package.json "$APP/package.json" || ! cmp -s pnpm-lock.yaml "$APP/pnpm-lock.yaml"; then
  echo "注意：依赖清单与本机安装不同，同步后还需要重新安装依赖才能生效。" >&2
fi
# shellcheck disable=SC2086
# core.quotePath=false: otherwise Git prints non-ASCII names (世界书-*.json) as quoted octal escapes.
git -c core.quotePath=false ls-files --cached --others --exclude-standard -- $PATHS | while IFS= read -r file; do [ -e "$file" ] && printf '%s\n' "$file"; done | rsync -a --files-from=- ./ "$APP/"
# `install` run from any checkout links the CLI profile to that checkout's tavern-plugin, so
# the CLI would serve that folder instead of the synced copy (or break once it is deleted).
# Re-link the profile to the synced copy whenever it points elsewhere.
PROFILE_MANIFEST=$CLI_HOME/profiles/tavern/package.json
if [ -f "$PROFILE_MANIFEST" ] && ! grep -q "\"dsh-tavern-plugin\": \"link:$APP/tavern-plugin\"" "$PROFILE_MANIFEST"; then
  echo "命令行版的插件链接指向了别处，正在改回 $APP/tavern-plugin……"
  node "$APP/bin/dsh-tavern.mjs" install
fi
echo "已同步到 ${APP}，正在重启……"
DSH_TAVERN_NO_OPEN=1 node "$APP/bin/dsh-tavern.mjs" restart
