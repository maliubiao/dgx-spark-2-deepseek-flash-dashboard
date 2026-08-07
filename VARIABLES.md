# 变量总表（脱敏对照）

> 本文档与 `GUIDE.md` / `README.md` / `.env.example` / 脚本默认值中的占位符一一对应。
> **文档不出现任何真实 IP / 主机名 / 机器别名**；真实值只填在你本机，且因 `.env` 已被 `.gitignore` 排除，不会进入版本库。
> 复现/部署前，先把下表**所有** `<占位符>` 替换成你自己的实际值（填的位置见「填到哪」）。

| 占位符 | 含义 | 示例/取值说明 | 填到哪 |
|---|---|---|---|
| `<HOST_A>` | head 机器的 **SSH 别名**（你 Mac 上 `~/.ssh/config` 配的名字） | 如 `node-a` | `.env` 的 `AGENTS`、所有 `ssh <HOST_A>` 命令 |
| `<HOST_B>` | worker 机器的 SSH 别名 | 如 `node-b` | 同上 |
| `<IP_MGMT_A>` | head **管理 IP**（SSH 用地址） | 同一局域网内，如 `192.168.50.11` | `.env` 的 `AGENTS` / `VLLM_URL` |
| `<IP_MGMT_B>` | worker 管理 IP | 如 `192.168.50.12` | `.env` 的 `AGENTS` |
| `<HOSTNAME_A>` | head 机器 **hostname**（`hostname` 命令输出） | 如 `dgx-node-a` | 示例输出核对用，无需替换 |
| `<HOSTNAME_B>` | worker 机器 hostname | 如 `dgx-node-b` | 同上 |
| `<NODE_ID_A>` / `<NODE_ID_B>` | 面板上显示的节点名（= agent 的 `id`，`AGENTS` 里 `=` 左边） | 直接用 `<HOST_A>`/`<HOST_B>` 即可 | `.env` 的 `AGENTS` |

## 端口约定（公共/不敏感，固定即可）

| 端口 | 用途 | 所在 |
|---|---|---|
| `9100` | agent HTTP（采集/拉取 API） | 每台 DGX |
| `8890` | 中控 + 面板 | Mac |
| `8888` | vLLM OpenAI API | head（仅 head 的 agent 采集它） |

> `--vllm http://127.0.0.1:8888` 中的 `127.0.0.1` 是 head 机器**访问自己**，永远这么写，不是占位符。

> **一次性替换清单**：填完 `.env` 启动后，节点配置改由面板「节点配置」页管理（落 SQLite），`.env` 不再参与。

```bash
# 1) Mac ~/.ssh/config 里确保两个别名存在，指向两台机器
Host <HOST_A>
    HostName <IP_MGMT_A>
    User <USER>
Host <HOST_B>
    HostName <IP_MGMT_B>
    User <USER>

# 2) 本项目复制配置并按真实值填写（已被 .gitignore 排除，不外泄）
cp .env.example .env
# 编辑 .env：把 AGENTS 的占位符换成真实 IP/节点名
```

## 实际值速查（仅本机自己看，勿提交）

| 占位符 | 本机真实值 |
|---|---|
| `<HOST_A>` | （填你的） |
| `<HOST_B>` | （填你的） |
| `<IP_MGMT_A>` | （填你的） |
| `<IP_MGMT_B>` | （填你的） |
| `<HOSTNAME_A>` | （填你的） |
| `<HOSTNAME_B>` | （填你的） |
