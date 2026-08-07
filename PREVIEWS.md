# 面板效果预览（PREVIEWS）

> 截图来自一套**真实运行中的双 DGX Spark 集群**（DeepSeek-V4-Flash，TP2）。
> 已剔除「节点配置」页截图（其中含内网地址，不外放）。
> ⚠️ 其余截图含运行环境的真实机器名/节点 id/实时数据，**公开分发前请用你自己的环境重新生成**（一键脚本见文末）。

## 1. 总览（Overview）

双节点在线状态、服务健康卡（解码吞吐 / prefill / KV cache / prefix 命中率 / 投机解码 / 运行队列 / 延迟分位）、GPU 利用率与吞吐实时曲线。

![总览](screenshots/overview.png)

## 2. GPU / 主机（GPU & Host）

双机 GPU 利用率/温度/功耗/时钟、CPU 负载、内存、磁盘、vLLM 容器占用。

![GPU/主机](screenshots/gpu.png)

## 3. 吞吐 / 延迟（Throughput & Latency）

decode/prefill/引擎步进 tok/s，TTFT / ITL / 端到端 / 排队 的 p50 / p90 / p99（由 vLLM 直方图实时计算）。

![吞吐/延迟](screenshots/throughput.png)

## 4. 投机解码（Speculative Decoding）

MTP5 投机解码：接受率、平均接受长度、draft/accepted 累计、**每个投机位置的接受率曲线**。

![投机解码](screenshots/spec.png)

## 5. 缓存 / 队列（Cache & Queue）

prefix 缓存命中率/缓存占比、KV cache 使用率、运行/等待/抢占、命中与查询累计。

![缓存/队列](screenshots/cache.png)

## 6. 网络（Network）

RoCE 双链路状态、4 个 fabric 口（enp1s0f0np0 等）双向吞吐。

![网络](screenshots/network.png)

## 7. 节点配置（节点 Config）

> ⚠️ **此页截图已从仓库剔除**——它显示 agent 的真实内网地址（`http://<IP>:9100`）。
> 页面本身用法见 [CONFIG.md](CONFIG.md)（配置中心：增删改机器、启停、在线状态），不再附预览图。

---

## 如何重新生成截图

环境：面板运行在 `http://127.0.0.1:8890`，本机有 `agent-browser`（Playwright 驱动）。

```bash
bash docs/screenshots/capture.sh
```

脚本会：切窗口尺寸 → 逐页打开（`#/overview` … `#/network`）→ 等数据加载 → 整页截图覆盖到 `docs/screenshots/`。

> 说明：脚本**刻意跳过** `#/settings`（节点配置页含内网地址，不生成截图），避免误入库。

> 想让图表更有数据：截图前发几个请求制造流量（见 [GUIDE.md](GUIDE.md) 第 5 步），或在「总览」右上角把时间窗调到 15 分钟看更密的曲线。
