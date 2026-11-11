#!/bin/sh
# 打 dsh-go 用的运行时子集（酒馆源码 + bin + patches + config）。
#
# 用不了整仓：仓库 16G，手机上不可能下载。但也不能漏目录——漏 config/ 会让
# tavern-plugin/lib/domain/host-compatibility.js 读不到 dsh-compatibility.json，
# 主插件 apply 时抛 ENOENT，tavernSessionSignals 不注册，dsh-tavern-remote 一直 pending。
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
OUT=${1:-/tmp/dshgo-runtime.tar.gz}
cd "$ROOT"
tar czf "$OUT" \
  --exclude='node_modules' \
  --exclude='*.map' \
  --exclude='.git' \
  --exclude='*/fonts/*' \
  --exclude='*/__tests__/*' \
  tavern-plugin bin patches config
echo "打包完成: $OUT"
tar tzf "$OUT" | awk -F/ '{print $1}' | sort -u | sed 's/^/  顶层目录: /'
ls -lh "$OUT" | awk '{print "  体积:", $5}'
