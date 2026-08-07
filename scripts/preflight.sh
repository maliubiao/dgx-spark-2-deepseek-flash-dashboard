#!/usr/bin/env bash
# =============================================================================
# dspark 项目环境自检（在 Mac 上运行）——教程「第 1 步」
#
# 用法:
#   bash scripts/preflight.sh                # 只做不依赖 SSH 的检查（HTTP）
#   SSHT=1 bash scripts/preflight.sh         # 额外做 SSH 到双机的检查
#
# 检查项：
#   01 本机 Node / pnpm（中控+前端需要）
#   02 本机 Go（仅重新编译 agent 需要，可选）
#   03 前端是否已构建
#   04 agent HTTP 可达性 / 数据新鲜度（核心）
#   05 vLLM OpenAI API 可达性（head）
#   06 中控端口 8890 是否空闲
#   [SSHT] 双机 systemd 服务状态 / 免密 SSH
# =============================================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$PATH:/usr/local/go/bin:/opt/homebrew/bin"

# --- 解析 agent 列表（优先 .env，其次环境变量，最后默认值）------------
AGENTS_LINE="${AGENTS:-}"
if [ -z "$AGENTS_LINE" ] && [ -f "$ROOT/.env" ]; then
  AGENTS_LINE=$(grep -E '^AGENTS=' "$ROOT/.env" | head -1 | cut -d= -f2-)
fi
AGENTS_LINE="${AGENTS_LINE:-<HOST_A>=http://<IP_MGMT_A>:9100,<HOST_B>=http://<IP_MGMT_B>:9100}"
VLLM_URL="${VLLM_URL:-http://<IP_MGMT_A>:8888}"

PASS=0; FAIL=0; WARN=0
ok()  { PASS=$((PASS+1)); printf '  [✓] %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  [✗] %s\n' "$*"; }
wrn() { WARN=$((WARN+1)); printf '  [!] %s\n' "$*"; }

echo "=== dspark 环境自检 · $(date '+%F %T') ==="

# --- 01 本机 node / pnpm ---------------------------------------------
echo; echo "[01] 本机工具链 (node / pnpm)"
NODE_V="$(node -v 2>/dev/null)"
if [ -n "$NODE_V" ] && [ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 22 ? 1 : 0' 2>/dev/null)" = 1 ]; then
  ok "Node $NODE_V (≥22，含 node:sqlite)"
else
  bad "Node 缺失或 <22（当前 ${NODE_V:-无}），需 Node ≥22"
fi
if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm -v)"; else bad "缺少 pnpm"; fi

# --- 02 本机 go（可选）-----------------------------------------------
echo; echo "[02] Go (仅重新编译 agent 需要，可选)"
if go version >/dev/null 2>&1; then ok "Go $(go version | sed 's/.*go//;s/ .*//')"; else wrn "未安装 Go —— 用现成二进制即可，需改 agent 才要装"; fi

# --- 03 前端构建产物 ------------------------------------------------
echo; echo "[03] 前端构建产物"
if [ -f "$ROOT/apps/dashboard/dist/index.html" ]; then
  ok "已构建: apps/dashboard/dist"
else
  wrn "未构建 —— 向导第 5 步 pnpm --filter dashboard build 后即生成"
fi

# --- 04 agent HTTP 可达 / 数据新鲜度（核心）--------------------------
echo; echo "[04] agent 拉取链路（HTTP :9100）"
IFS=',' read -ra AGENTS_ARR <<< "$AGENTS_LINE"
for spec in "${AGENTS_ARR[@]}"; do
  id="${spec%%=*}"; url="${spec#*=}"; [ -z "$id" ] && continue
  health=$(curl -sm 4 "$url/health" 2>/dev/null) || health=""
  if [ -z "$health" ]; then
    bad "$id 不可达 ($url) —— 检查 agent 是否在机器上运行 (systemctl status dspark-agent)"
    continue
  fi
  hostname=$(echo "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("hostname","?"))' 2>/dev/null)
  lw=$(echo "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("last_write",0))' 2>/dev/null)
  rows=$(echo "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("db_rows",0))' 2>/dev/null)
  stale=$(( $(date +%s) - lw ))
  if [ "$stale" -le 30 ]; then
    ok "$id ($hostname) 可达 · 最近写入 ${stale}s 前 · 库 $rows 行"
  else
    wrn "$id 可达但数据已过期 ${stale}s —— 采集循环可能卡住/last_write 为 0"
  fi
done

# --- 05 vLLM API（head）----------------------------------------------
echo; echo "[05] vLLM OpenAI API ($VLLM_URL)"
if curl -sm 5 -o /dev/null -w '%{http_code}' "$VLLM_URL/v1/models" 2>/dev/null | grep -q 200; then
  ok "vLLM API 200，模型已加载"
else
  wrn "vLLM API 不可达 —— 若只看主机指标可忽略；看服务指标需 head 上 vLLM 运行中"
fi

# --- 06 中控端口 -----------------------------------------------------
echo; echo "[06] 中控端口 8890"
if lsof -nP -iTCP:8890 -sTCP:LISTEN >/dev/null 2>&1; then
  wrn "8890 已被占用（可能中控已在运行）—— 继续用即可或先 bash scripts/stop-dashboard.sh"
else
  ok "8890 空闲"
fi

# --- SSHT: 双机 SSH 检查（可选）--------------------------------------
if [ "${SSHT:-0}" = 1 ]; then
  echo; echo "[SSH] 双机 systemd 服务 / 免密"
  for h in <HOST_A> <HOST_B>; do
    if ssh -o BatchMode=yes -o ConnectTimeout=5 "$h" "systemctl is-active dspark-agent 2>/dev/null" 2>/dev/null | grep -q active; then
      ok "$h: dspark-agent active"
    else
      wrn "$h: agent 非 active 或 SSH 不通"
    fi
  done
fi

echo
echo "==== 结果: 通过 $PASS · 失败 $FAIL · 警告 $WARN ===="
if [ "$FAIL" -eq 0 ]; then
  echo "环境就绪，可以继续：bash scripts/start-dashboard.sh → http://127.0.0.1:8890"
else
  echo "存在失败项，先解决再继续（见 GUIDE.md 常见问题）"
fi
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
