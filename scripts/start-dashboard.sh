#!/usr/bin/env bash
# 启动中控 + 面板（后台运行），日志在 /tmp/dspark-server.log
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8890}"
if lsof -ti :$PORT >/dev/null 2>&1; then
  echo "端口 $PORT 已占用（服务可能已在运行）"
  exit 0
fi
cd "$ROOT"
if [ ! -d "apps/dashboard/dist" ]; then
  pnpm --filter dashboard build >/dev/null 2>&1 || { echo "前端构建失败"; exit 1; }
fi
nohup node --env-file-if-exists=.env apps/server/src/index.ts > /tmp/dspark-server.log 2>&1 &
sleep 2
echo "中控已启动: http://127.0.0.1:$PORT"
