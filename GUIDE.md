# dgx-spark 集群监控 · 手把手配置向导

> 从零到能看面板的完整教程。每一步都给命令 + 预期输出。全程约 **30 分钟**。
> 不熟悉的部分照抄即可；`//` 前是注释说明。
>
> 🧷 **敏感说明**：本文所有真实地址均已用 `<占位符>` 脱敏（对照表见 [VARIABLES.md](VARIABLES.md)）。
> 执行前先按第 0 步把占位符换成你自己的值；真实值只写进本地 `.env`（已被 gitignore，不会提交）。

---

## 这套系统要装什么

| 组件 | 装在哪 | 干什么 | 形态 |
|---|---|---|---|
| `dspark-agent` | **每台 DGX Spark** | 本机采集（GPU/CPU/内存/RoCE/vLLM），写入本地时序库 | 单个 Go 二进制 + **systemd 服务**（装一次，开机自启） |
| 中控 `server` | **Mac** | 每 10s 从两台 agent 增量拉数据，落 SQLite 镜像库 | Node 进程（`:8890`） |
| 面板 `dashboard` | **Mac** | 画图 | React 静态页（由中控托管） |

运行期**不依赖 SSH**——agent 采集是在机器本地做的，Mac 只走 HTTP `:9100` 拉数据。
SSH 只在「安装/检查」时用到。

## 前提清单

- [x] 双 DGX Spark（head + worker）已开机、在运行 DeepSeek-V4-Flash（可选，没跑也能看主机指标）
- [x] Mac 与两台机器**同一局域网**，SSH 免密能通（`ssh <HOST_A>` 直接进）
- [x] Mac 上 `node ≥ 22`（用内置 sqlite，推荐 24+）、`pnpm`；Go 可选（仅改 agent 代码时需要）
- [x] 端口约定：agent `9100`、中控 `8890`、vLLM `8888`（默认都空闲）

**这套系统用到的占位符对照**（完整表在 [VARIABLES.md](VARIABLES.md)）：

| 占位符 | 含义 |
|---|---|
| `<HOST_A>` / `<HOST_B>` | head / worker 的 SSH 别名 |
| `<IP_MGMT_A>` / `<IP_MGMT_B>` | head / worker 管理 IP |
| `<HOSTNAME_A>` / `<HOSTNAME_B>` | 两台机器 `hostname`（核对示例输出用） |

---

## 第 0 步 · 准备（约 2 分钟）

```bash
cp VARIABLES.md   # 看一遍对照表，心里有数哪些要填
cp .env.example .env   # 把 AGENTS 里的占位符换成你的真实 IP/节点名
open .env
```

`AGENTS` 一行即「面板拉哪些机器」：`<节点id>=http://<IP>:9100`，逗号分隔。

---

## 第 1 步 · 环境检查（约 5 分钟）

### 1.1 本机工具链

```bash
node -v      # 期望 v22 及以上，如 v25.4.0
pnpm -v      # 期望 9/10，如 10.24.0
go version   # 可选；期望 go1.2x，如 go1.25.5（没有也行）
```

### 1.2 SSH 免密（一次性）

两台机器能直接 `ssh` 进去且不要密码：

```bash
ssh <HOST_A> 'hostname && uptime'   # 期望回显机器名和运行时长
ssh <HOST_B> 'hostname && uptime'
```

如果要求输密码，把 Mac 公钥加过去：

```bash
cat ~/.ssh/id_ed25519.pub
# 在 <HOST_A> / <HOST_B> 上执行一次：
#   mkdir -p ~/.ssh && echo '<上面那行>' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
```

### 1.3 一键自检（重点）

在项目根目录跑，自动检查上面所有项 + agent 拉取链路：

```bash
cd ~/code/dgx-spark-cluster-dashboard
bash scripts/preflight.sh
```

期望输出长这样（✓ 越多越好；`<N>` 表示你的实际数值）：

```text
=== dspark 环境自检 · 2026-08-07 10:20:00 ===

[01] 本机工具链 (node / pnpm)
  [✓] Node v25.4.0 (≥22，含 node:sqlite)
  [✓] pnpm 10.24.0

[02] Go (仅重新编译 agent 需要，可选)
  [✓] Go 1.25.5

[03] 前端构建产物
  [✓] 已构建: apps/dashboard/dist

[04] agent 拉取链路（HTTP :9100）
  [✓] <HOST_A> (<HOSTNAME_A>) 可达 · 最近写入 <N>s 前 · 库 <N> 行
  [✓] <HOST_B> (<HOSTNAME_B>) 可达 · 最近写入 <N>s 前 · 库 <N> 行

[05] vLLM OpenAI API (http://<IP_MGMT_A>:8888)
  [✓] vLLM API 200，模型已加载

[06] 中控端口 8890
  [✓] 8890 空闲
```

想连 SSH 一起查双机的 systemd 服务状态，加开关：

```bash
SSHT=1 bash scripts/preflight.sh
```

**怎么读结果**：
- `✗` = 必须修（见第 7 节常见问题）；`!` = 警告，看情况（比如「未构建前端」在第 4 步会好）
- `[04]` 最关键：`最近写入 Ns 前` 应为个位数秒。若显示 `已过期`，说明 agent 没在跑，跳到第 3 步重装。

---

## 第 2 步 · 首次播种配置（约 2 分钟）

中控启动时会把 `AGENTS` 读入**配置库**（`data/central.db` 的 `config_nodes` 表）作为初始节点——此后**不再读 `.env`**，增删改全在面板「节点配置」页完成（见第 5 步），改完立即生效、重启保留。

```bash
cp .env.example .env
open .env            # 用编辑器打开
```

```dotenv
# 首次启动的初始节点列表：<节点id>=<agent HTTP 地址>，逗号分隔
AGENTS=<HOST_A>=http://<IP_MGMT_A>:9100,<HOST_B>=http://<IP_MGMT_B>:9100
# PORT=8890       中控端口（可选，默认 8890）
# DB=./data/central.db   中控时序库位置（可选）
```

> 节点 id（`AGENTS` 里 `=` 左边）就是你在面板上看到的名字，可随意改（如 `head` / `worker`）。
> 若只有一台机器，`AGENTS` 只写一个即可。之后要加机器，直接在面板里点「添加节点」。
> 📘 **配置机制完整说明（两层配置/生命周期/API）见 [CONFIG.md](CONFIG.md)**。

---

## 第 3 步 · 安装 Agent（约 10 分钟）

### 3.1 编译（可选，建议执行一次验证工具链）

```bash
bash deploy/build-agent.sh
# 期望：deploy/bin/dspark-agent-linux-arm64 生成，file 显示
#   ELF 64-bit LSB executable, ARM aarch64, statically linked
```

> 二进制的生成产物 `deploy/bin/dspark-agent-linux-arm64` **不随仓库提交**（需在本机用 Go 编译，工具链就绪后一条命令搞定）。改过 `agent/` 代码同样重编译再装。

### 3.2 先装 worker（不采 vLLM）

```bash
bash deploy/install-agent.sh <HOST_B>
```

### 3.3 再装 head（额外采 vLLM 服务指标）

```bash
bash deploy/install-agent.sh <HOST_A> --vllm http://127.0.0.1:8888
```

> `--vllm` 传的是 head 机器**自己**访问本机 vLLM 的地址，所以永远是 `http://127.0.0.1:8888`。

### 3.4 验证两台都装好了

```bash
ssh <HOST_A> 'systemctl status dspark-agent --no-pager | head -5'
ssh <HOST_B> 'systemctl status dspark-agent --no-pager | head -5'
```

期望看到：

```text
● dspark-agent.service - dspark-agent — DGX Spark metrics collector ...
   Active: active (running) since <日期>; <N>s ago
```

再看数据是否在写：

```bash
curl -s http://<IP_MGMT_A>:9100/health   # head
curl -s http://<IP_MGMT_B>:9100/health   # worker
```

期望回显（`db_rows` 每次跑都在涨、`last_write` 是最近几秒）：

```json
{"db_rows":<N>,"hostname":"<HOSTNAME_A>","last_write":<UNIX_TS>,"ok":true,"vllm_url":"http://127.0.0.1:8888"}
```

**这个脚本是幂等的**：改配置/升级后直接重跑同一条命令即可，会覆盖二进制并重启服务。

常见预期差异：
- 头一次装时 `db_rows` 刚开始是几十，几分钟后涨到几千——正常，它在攒历史。
- worker 的 `vllm_url` 为空是**对的**；head 上必须有值。

### 3.5（可选）卸载 / 改采集间隔

```bash
ssh <HOST_A> 'sudo systemctl disable --now dspark-agent'   # 卸载
# 改采集间隔(默认5s)/保留期(默认168h=7天)：改 /etc/dspark-agent.env 后重启
ssh <HOST_A> 'sudo systemctl restart dspark-agent'
```

---

## 第 4 步 · 安装前端依赖并构建（约 5 分钟）

```bash
cd ~/code/dgx-spark-cluster-dashboard
pnpm install
pnpm --filter dashboard build
# 期望：apps/dashboard/dist/index.html + assets/index-*.js 生成
```

---

## 第 5 步 · 启动中控并打开面板（约 3 分钟）

```bash
bash scripts/start-dashboard.sh
# 期望：中控已启动: http://127.0.0.1:8890
```

浏览器打开 **http://127.0.0.1:8890**。

**打开后先看这 4 处**（都是实时/最近值）：
1. 右上角两个节点绿点 = agent 在线，显示机器名
2. 总览顶部的状态卡：解码吞吐、KV cache、GPU 利用率/温度都应该有数字
3. 节点徽章显示「正常」（不是「降级/离线」）
4. 下方四条折线是否有曲线（GPU 利用率、解码吞吐、KV、请求数）

**如何确认真在实时流动**：给集群发一个请求制造流量，面板几秒内跳动：

```bash
curl http://<IP_MGMT_A>:8888/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4-flash-0731","messages":[{"role":"user","content":"hi"}],"max_tokens":32,"thinking":false}'
```

看「解码吞吐」和「GPU 利用率」往上跳、「节点徽章」变「活跃」。

### 5.1 在面板里管理节点（配置中心，核心）

打开 **「节点配置」** 页签（右上角），这是面板的配置中心——**不用改任何代码/重启**：

- **添加节点**：点「+ 添加节点」→ 填 节点id、名称(可选)、agent 地址 `http://<IP>:9100` → 保存。10s 内拉取器自动接入，其他页签开始出数据
- **编辑节点**：改名称/地址/启用开关；id 建好后不可改（删了重建即可）
- **删除节点**：只删配置，**不影响机器上运行的 agent**
- **状态列**：在线/离线、机器 hostname、指标数、最近同步秒数——一眼看出哪台没通
- 所有改动写入 `data/central.db`，重启后保留

> 📘 配置机制细节（字段校验、CRUD API、动态生效、备份/重置）见 [CONFIG.md](CONFIG.md)。

> 端口 `9100` 是 agent 的固定端口；如果某台机器的 agent 改过监听端口，在这里把地址改掉即可。

### 开发模式（改前端时的替代启动方式）

```bash
pnpm dev:server    # 终端 1：中控
pnpm dev:dash      # 终端 2：Vite 热更新 → http://127.0.0.1:5173
```

---

## 第 6 步 · 面板各页说明

| 页签 | 看什么 | 常用排查用途 |
|---|---|---|
| 总览 | 服务健康卡 + GPU/吞吐/KV/并发 4 图 | 一眼判断服务在不在、忙不忙 |
| GPU/主机 | 双机 GPU 利用率/温度/功耗/时钟、CPU、内存、磁盘、容器占用 | 看负载和散热 |
| 吞吐/延迟 | decode/prefill tok/s、TTFT/ITL/端到端/排队 p50/p90/p99 | 验证性能是否达标 |
| 投机解码 | MTP 接受率、平均接受长度、每位置接受曲线 | 验证投机解码是否生效 |
| 缓存/队列 | prefix 命中率、KV cache 使用、运行/等待/抢占 | 长上下文与并发的健康度 |
| 网络 | RoCE 链路数、4 个 fabric 口吞吐 | 集群互联是否正常 |
| 节点配置 | **配置中心**：增删改要拉取的机器、启停、看在线状态 | 换机器/加机器/排查某台没数据 |

页面右上角切时间窗（15分/1小时/6小时/24小时/7天）；页内图表刷新的快慢见右上角 agent 绿点。

---

## 第 7 步 · 常见问题（先查这个）

| 现象 | 原因 | 处理 |
|---|---|---|
| 新机器加进来没数据 | 端口/地址不对，或该机器 agent 没装 | 在「节点配置」页核对地址；`ssh <HOST> 'systemctl status dspark-agent'`；装好 agent 后本页自动变在线 |
| 节点改了地址不生效 | 拉取器 10s 自愈 | 改完保存，等 ≤15s；仍不行重启中控 `bash scripts/start-dashboard.sh` |
| 删了节点还有旧数据 | 历史数据保留 | 正常——只是不再拉新；想清数据见本文档末尾「清空历史」 |
| `[04]` 显示 agent 不可达 | agent 没装好/服务没起来 | `ssh <HOST_A> 'sudo systemctl status dspark-agent'`；重跑第 3 步安装 |
| 节点徽章「离线」 | `.env` 里 agent 地址错 或 agent 挂了 | 改 `.env`；重启中控 `bash scripts/start-dashboard.sh` |
| 节点徽章「降级」但有数据 | （旧版本 bug，已修复）前端拿到 `{ts,values}` 结构 | 更新 server 代码后重启中控；强刷浏览器 Cmd+Shift+R |
| 某张卡片一直是 `—` | 该节点没有这个指标（如 worker 无 vLLM 指标） | 属正常；head 才有 vLLM 系列 |
| vLLM 指标全 0 / 空闲 | vLLM 没跑、或 head 的 agent 没带 `--vllm` | `ssh <HOST_A> 'curl -s localhost:8888/v1/models'`；重装用 `install-agent.sh <HOST_A> --vllm http://127.0.0.1:8888` |
| GPU 显存显示 0 | GB10 的 nvidia-smi 不报显存（`[N/A]`） | 属正常；看 KV cache 与内存使用 |
| 端口 8890/9100 被占用 | 重复启动 / 别的东西占了 | `lsof -nP -iTCP:PORT`；`bash scripts/stop-dashboard.sh` |
| 重启机器后还要装吗 | 不用 | agent 是 systemd 服务，开机自启；Mac 中控需手动 `bash scripts/start-dashboard.sh` |
| 面板空白/白屏 | 前端没构建或 JS 报错 | `pnpm --filter dashboard build` 后再启动；浏览器控制台看报错 |
| 想清空历史 | 删库重启 | `rm -f data/central.db*`；agent 侧 `rm -f /var/lib/dspark-agent/metrics.db*` 后 `sudo systemctl restart dspark-agent` |

---

## 第 8 步 · 常见运维命令速查

```bash
# ── Mac 中控 ──
bash scripts/stop-dashboard.sh                       # 停
bash scripts/start-dashboard.sh                      # 起
cat /tmp/dspark-server.log                           # 中控日志
bash scripts/preflight.sh                            # 随时自检

# ── 双机 agent（SSH） ──
ssh <HOST_A> 'sudo journalctl -u dspark-agent -n 50'  # agent 日志
ssh <HOST_A> 'sudo systemctl restart dspark-agent'     # 重启
ssh <HOST_B> 'systemctl is-active dspark-agent'        # 是否 active

# ── 升级 agent ──
# 改 agent/ 代码后：
bash deploy/build-agent.sh
bash deploy/install-agent.sh <HOST_B>
bash deploy/install-agent.sh <HOST_A> --vllm http://127.0.0.1:8888
```

---

## 附：数据从哪来到哪去（30 秒看懂）

```
<HOST_A>  ┌──────────────────────┐        <HOST_B>  ┌──────────────────────┐
         │ dspark-agent (systemd)│                │ dspark-agent (systemd)│
         │  采集 → SQLite 时序库 │                │  采集 → SQLite 时序库 │
         │  HTTP :9100           │                │  HTTP :9100           │
         └──────────┬───────────┘                └──────────┬───────────┘
                    │  每 10s 增量 /changes                    │
                    └──────────────┬──────────────────────────┘
                                   ▼
        Mac  中控 server (:8890) ── SQLite 镜像 data/central.db
                                   │
                                   ▼
                         React 面板 (浏览器)
```

- 每个 agent 采 5s 一次：GPU/CPU/内存/磁盘/网口/RoCE/容器 +（head 上额外）vLLM `/metrics` 的吞吐、延迟分位、投机解码、缓存命中
- 数据默认保留 **7 天**，中控镜像全量历史
- 面板上的数字延迟最多 ~10s（agent 5s 采集 + 中控 10s 同步）
