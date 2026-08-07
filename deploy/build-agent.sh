#!/usr/bin/env bash
# 交叉编译 dspark-agent → linux/arm64 静态二进制
set -euo pipefail
cd "$(dirname "$0")/../agent"
export PATH="$PATH:/usr/local/go/bin"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags '-s -w' -o ../deploy/bin/dspark-agent-linux-arm64 .
ls -la ../deploy/bin/dspark-agent-linux-arm64
file ../deploy/bin/dspark-agent-linux-arm64
