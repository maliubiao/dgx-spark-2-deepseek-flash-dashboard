#!/usr/bin/env bash
set -euo pipefail
pkill -f 'apps/server/src/index.ts' 2>/dev/null && echo "中控已停止" || echo "未在运行"
