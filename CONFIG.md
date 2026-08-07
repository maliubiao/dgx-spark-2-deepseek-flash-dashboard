# 配置机制说明（CONFIG）

> 回答三个问题：**哪些东西要配、在哪一层配、改了怎么生效**。
> 全部占位符见 [VARIABLES.md](VARIABLES.md)；真实值只存本地 `.env`（gitignore）与 `data/central.db`。

## 一、配置分两层，别混淆

| 层 | 属于谁 | 配什么 | 存在哪 | 怎么改 |
|---|---|---|---|---|
| **A · Agent 侧** | 每台 DGX 机器 | 采集行为：监听端口、采集频率、数据保留期、是否采本机 vLLM | 机器上的 `/etc/dspark-agent.env` | `bash deploy/install-agent.sh` 重装（改参数后重跑同一条命令） |
| **B · 中控侧** | Mac 中控 | 面板要**拉取哪些机器**（节点列表） | `data/central.db` 的 `config_nodes` 表 | **面板「节点配置」页**（CRUD），或 REST API |

一句话：**机器上的 agent 决定“采什么”，中控配置决定“拉谁进来”。**
面板配置只认节点的 id + HTTP 地址，不关心那台机器里装了啥。

## 二、中控配置的生命周期（三个来源的优先级）

```
首次启动
   │  config_nodes 表为空?
   ├─ 是 → 从 .env 的 AGENTS 播种（一次性）
   └─ 否 → 直接用表里的配置（.env 不再生效）
                                   │
                                   ▼
             面板「节点配置」页 / CRUD API ──写入──► SQLite config_nodes 表
                                   │
                                   ▼
                   拉取器每 10s reconcile ──► 内存目标列表（动态增删改）
```

| 阶段 | 配置来源 | 说明 |
|---|---|---|
| 首次启动 | 环境变量 `.env` 的 `AGENTS` | 只在配置表为空时读一次；不进就不进 |
| 日常管理 | `config_nodes` 表 | 面板「节点配置」或 API 增删改，**立即持久化** |
| 运行中 | 拉取器内存 | 每轮同步按表 reconcile，≤10s 生效 |

> 想“重新播种”：停中控 → `rm -f config_nodes` 相关行（见文末备份/重置）→ 改 `.env` → 启动。

## 三、配置项参考

### B1. 节点字段（面板 / `config_nodes`）

| 字段 | 必填 | 说明 | 校验 |
|---|---|---|---|
| `id` | ✅ | 节点唯一标识，就是面板上显示的名字 | 1–64 位字母数字 `._-`；建后不可改（删了重建） |
| `name` | 否 | 显示名（如 `head 主节点`） | 任意 |
| `url` | ✅ | agent 的 HTTP 地址 | 必须以 `http://` 或 `https://` 开头 |
| `enabled` | 否 | 是否拉取（0/1） | 关闭=停止拉取但保留配置 |

### B2. `.env`（仅首次播种 + 服务参数）

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENTS` | 无 | 首次播种的节点：`id=http://IP:9100`，逗号分隔 |
| `PORT` | `8890` | 中控端口 |
| `DB` | `<项目>/data/central.db` | 中控时序库 + 配置库 |
| `DIST` | `apps/dashboard/dist` | 前端产物目录 |

### A1. Agent 侧参数（`/etc/dspark-agent.env`）

| 参数 | 默认 | 说明 |
|---|---|---|
| `--listen` | `:9100` | agent HTTP 端口（面板 `url` 要对应） |
| `--interval` | `5` | 采集周期（秒） |
| `--retention` | `168h` | 本地数据保留期 |
| `--vllm` | 空 | 填 `http://127.0.0.1:8888` → 额外采集本机 vLLM 服务指标（仅 head 装） |

## 四、CRUD API 参考

Base：`http://127.0.0.1:8890`

```bash
# 查（含在线状态/指标数）
curl http://127.0.0.1:8890/api/config

# 增
curl -X POST http://127.0.0.1:8890/api/config \
  -H 'Content-Type: application/json' \
  -d '{"id":"node-c","name":"第三台","url":"http://<IP>:9100","enabled":1}'

# 改（只传要改的字段）
curl -X PUT http://127.0.0.1:8890/api/config/nodes/node-c \
  -H 'Content-Type: application/json' -d '{"name":"改名","url":"http://<IP2>:9100"}'

# 启停
curl -X PUT http://127.0.0.1:8890/api/config/nodes/node-c \
  -H 'Content-Type: application/json' -d '{"enabled":0}'

# 删（只删配置，不影响机器上的 agent）
curl -X DELETE http://127.0.0.1:8890/api/config/nodes/node-c
```

错误语义：`400` 参数/JSON 非法 · `404` 节点不存在 · `409` id 已存在。

## 五、动态生效机制

- 拉取器 `Puller` 每 10s 一次同步；每次同步前把内存目标与 `config_nodes` 表 reconcile：
  新增 → 自动开始拉；删除 → 停止拉；改地址 → 立即切到新地址拉；`enabled=0` → 暂停拉（配置保留）。
- 因此**所有节点改动无需重启中控**，最长等待一个同步周期（≤10s）。
- 面板各页签的数据源（`/api/nodes`、`/api/snapshot`、`/api/range`）同样由配置驱动：
  没配的机器不会出现在任何页面。

## 六、常见操作

| 想干嘛 | 做法 |
|---|---|
| 加一台机器 | 先在那台装 agent → 面板「节点配置」→ 添加节点（`id` + `http://<IP>:9100`） |
| 某台连不上 | 面板看状态列；在「节点配置」改地址/启停排障，不用动代码 |
| 永久去掉一台 | 面板删除节点（只删配置）；机器上 agent 可留着 |
| 备份配置 | `sqlite3 data/central.db '.dump config_nodes' > cfg.sql` |
| 迁移到新中控 | 装好项目后 `cp cfg.sql` 回新库，或干脆在面板重新添加 |
| 清空配置、重新播种 | 停中控 → `sqlite3 data/central.db "DELETE FROM config_nodes"` → 改 `.env` → 启动 |
| 改 agent 采集参数 | 机上改 `/etc/dspark-agent.env` → `sudo systemctl restart dspark-agent`，或重跑安装脚本 |

## 七、与 vLLM 采集的关系（容易混淆的点）

- **vLLM 指标谁采**：每台机器上的 agent 自己决定。head 的 agent 用
  `install-agent.sh <HOST_A> --vllm http://127.0.0.1:8888` 安装，就会把它机上的 vLLM 指标写进本地库，再由中控拉走。
  面板配置页**不需要**填 vLLM 地址。
- **面板显示哪些 vLLM 系列**：哪个节点被拉进来，且它的库里有 `vllm.*` 系列，哪个节点就显示服务指标。
- 所以：某节点显示 `vLLM: 空闲` → 要么那台不是 head（没装 `--vllm`），要么 vLLM 没在跑。
