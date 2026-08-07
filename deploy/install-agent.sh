#!/usr/bin/env bash
# =============================================================================
# 在 DGX Spark 上安装 dspark-agent 为 systemd 服务（仅安装时用一次 SSH）。
#
# 用法:
#   bash deploy/install-agent.sh <HOST_B>                                  # worker
#   bash deploy/install-agent.sh <HOST_A> --vllm http://127.0.0.1:8888     # head
#
# 幂等：重复执行会覆盖二进制并重启服务。
# =============================================================================
set -euo pipefail

NODE="${1:?用法: install-agent.sh <host> [--vllm URL]}"
shift || true
VLLM_URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --vllm) VLLM_URL="${2:-}"; shift 2 || true ;;
    *) shift ;;
  esac
done
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/deploy/bin/dspark-agent-linux-arm64"
UNIT="$ROOT/deploy/dspark-agent.service"

[ -f "$BIN" ] || { echo "缺少二进制: $BIN（先跑 deploy/build-agent.sh）"; exit 1; }

ENV_LINE="AGENT_FLAGS=--listen :9100 --db /var/lib/dspark-agent/metrics.db --interval 5 --retention 168h"
if [ -n "$VLLM_URL" ]; then
  ENV_LINE="$ENV_LINE --vllm $VLLM_URL"
fi

echo "==> 传输二进制与 unit 到 $NODE"
scp -q "$BIN" "$NODE:/tmp/dspark-agent"
scp -q "$UNIT" "$NODE:/tmp/dspark-agent.service"

ssh -o BatchMode=yes "$NODE" "
set -e
sudo install -m 0755 /tmp/dspark-agent /usr/local/bin/dspark-agent
sudo install -m 0644 /tmp/dspark-agent.service /etc/systemd/system/dspark-agent.service
printf '%s\\n' '$ENV_LINE' | sudo tee /etc/dspark-agent.env >/dev/null
sudo mkdir -p /var/lib/dspark-agent
sudo systemctl daemon-reload
sudo systemctl enable --now dspark-agent >/dev/null 2>&1 || true
sudo systemctl restart dspark-agent || true
sleep 3
echo '==> 服务状态:'
systemctl --no-pager --lines=4 status dspark-agent | head -8 || true
echo '==> /health:'
curl -s http://127.0.0.1:9100/health || echo '(HTTP 未就绪)'
"

echo "==> $NODE 安装完成"
