#!/usr/bin/env bash
# 重新生成面板所有页截图到 docs/screenshots/（需 agent-browser + 面板在 127.0.0.1:8890）
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="${BASE:-http://127.0.0.1:8890}"
# 注意：故意不含 settings（节点配置页显示真实内网地址，不生成截图）
for pg in overview gpu throughput spec cache network; do
  agent-browser set viewport 1600 1000 >/dev/null 2>&1 || true
  agent-browser open "$BASE/#/$pg" >/dev/null 2>&1
  agent-browser wait 3500 >/dev/null 2>&1
  agent-browser screenshot --full "$DIR/$pg.png" >/dev/null 2>&1
  echo "$pg.png ✓"
done
