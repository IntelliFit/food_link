# FoodLink / CoachLink 腾讯云扩容采购建议

## Executive Summary

- **当前核心问题不是容量用完，而是单点故障。** 现有 4C15G 单机同时承载 Kubernetes 控制面、FoodLink、CoachLink、开发环境、PostgreSQL、Redis、Kafka 和监控。近 14 天 CPU 峰值 81.3%、内存峰值 72.6%，任一主机故障会导致全栈中断。
- **先把状态组件托管，再建设计算弹性。** PostgreSQL 数据目录约 587 MiB、Redis 仅 1.14 MiB、Kafka 约 145 MiB 且无积压。购买重点是跨可用区、高可用、自动故障切换、备份和可在线升配，而不是一次买很大容量。
- **10 倍建议以 3×4C8G TKE 为常驻底座；20 倍使用 3×8C16G，或让 4C8G 节点池弹性扩至 6–9 台。** 生产和 dev 必须隔离，生产 API 至少 3 副本，并配置 HPA、节点池自动扩缩、PDB 和跨节点反亲和。
- **数据库建议从 4C16G/200GB 双机高可用起步，20 倍预留 8C32G/500GB；Redis 从 1GB 主从起步；CKafka 选 Serverless 或最小跨可用区高可用档。** 只读库、Redis 集群版和更高 Kafka 吞吐应由监控阈值触发，而不是预先过度采购。

## 当前负载与风险

| 项目 | 当前状态 | 判断 |
|---|---|---|
| 主机 | 4 vCPU / 15 GiB / 180 GiB，无 Swap | 日常尚可，但 14 天 CPU 峰值 81.3%，不适合直接承接 10–20 倍宣传峰值 |
| Kubernetes | 单控制面、单工作节点 | 最大风险；无节点级容灾 |
| FoodLink 主环境 | 3 副本，14 天合计峰值约 0.138 核 / 1.23 GiB | Go 服务本身余量较大，可水平扩容 |
| CoachLink 主环境 | 3 副本，14 天合计峰值约 0.176 核 / 1.35 GiB | 同上；需同时考虑异步分析 worker |
| PostgreSQL 17 | 单 Docker 容器，数据目录约 587 MiB | 容量小，但无托管主备和自动切换 |
| Redis 7.4 | 单实例，1.14 MiB、4 连接、0 淘汰 | 性能不是瓶颈，高可用是主要诉求 |
| Kafka | 单 broker、RF=1、145 MiB、所有消费组 lag=0 | 吞吐很低，但 broker/磁盘故障风险高 |
| 磁盘 | 当前 42%，14 天峰值约 49% | 暂无容量压力；状态数据仍不应继续与应用同盘 |
| 网络 | 14 天入站峰值约 33.9 Mbps、出站约 14.4 Mbps | CDN 已承载图片，不能简单把源站流量乘 20 |
| 证书 | `certbot.service` failed | 宣传前必须确认自动续期和到期告警 |

## 腾讯云采购清单

| 类别 | 建议产品 | 10 倍建议起步档 | 20 倍 / 大促预留档 | 必须能力 |
|---|---|---|---|---|
| 生产计算 | TKE 标准集群 + 普通节点池 | 3×4C8G，跨 3 AZ；节点池 3–6 台 | 3×8C16G，或 4C8G 节点池 3–9 台 | HPA、Cluster Autoscaler、PDB、反亲和、生产/dev 隔离、30% 余量 |
| 负载均衡 | 公网 CLB | 1 个生产 CLB，50–100 Mbps 可突发 | 100–300 Mbps 或按使用量；用回源峰值校准 | HTTPS、健康检查、跨 AZ、连接数/RPS/P99/5xx 监控 |
| PostgreSQL | TencentDB for PostgreSQL 17 双机高可用 | 4C16G、200GB 高性能 SSD | 8C32G、500GB；读压力确认后再加 1 个只读实例 | 跨 AZ、PITR 7–30 天、SSL、慢查询/审计、连接池、容量告警 |
| Redis | 腾讯云兼容 Redis 7.x 标准架构 | 1GB、1 主 1 副本、跨 AZ | 2–4GB、1 主 2 副本；指标触发后再转集群 | 自动切换、SSL、内存策略、慢日志、大 key/热 key 监控 |
| 消息队列 | CKafka Serverless 或最小跨 AZ 高可用档 | 生产 5MB/s、消费 10MB/s、100–200GB | 生产 10MB/s、消费 20MB/s、300–500GB | 3 副本、生产主题至少 6 分区、7 天保留、lag 告警、死信/重试 |
| 对象存储 | COS 标准存储 | 商务占位 1–2TB | 商务占位 3–5TB | 私有桶、CDN 回源鉴权、版本控制、生命周期、按 RPO 决定跨地域复制 |
| CDN | CDN；有更强安全诉求时评估 EdgeOne | 先询 2TB/月流量包、100Mbps 峰值场景 | 询 5–10TB/月、300Mbps 峰值场景 | HTTPS、命中率 >90%、防盗链、URL 鉴权、回源保护、实时日志 |
| 安全 | WAF + 基础 DDoS + CAM/KMS | 公网 API 域名接 WAF | 按峰值 QPS 升 WAF；高防按活动风险临时启用 | Bot/CC 防护、API 限流、密钥轮换、审计日志 |
| 可观测 | Cloud Monitor + CLS + APM/Tracing | 核心指标 30 天，应用日志 14–30 天 | 按采样率控成本；审计日志独立保留 | SLO、P95/P99、5xx、DB/Redis/Kafka、成本和容量告警 |
| 备份灾备 | DB 自动备份 + COS 生命周期/版本 + 异地备份 | 目标 RPO ≤15 分钟、RTO ≤60 分钟 | 关键期提高备份频率，按要求建设异地恢复 | 季度恢复演练、加密、备份账号隔离、明确负责人 |

## 与腾讯云谈判时的要求

1. 同时给出“稳定基线包年”“20 倍按量弹性”“大促 2 小时突发”三档整体报价。
2. 按 10 倍、20 倍提供阶梯折扣、流量包、承诺消费和可转配额度。
3. 提供 PostgreSQL、Redis、Kafka 的迁移评审、工具、割接值守、数据校验和回滚支持。
4. 争取 1–3 个月双跑优惠期、测试实例额度和迁移流量减免。
5. 要求拆分 CDN 流量、HTTPS 请求、COS GET/PUT、回源、跨 AZ、日志、备份费用，避免附加计费失控。
6. 逐项确认 TKE、PostgreSQL、Redis、CKafka、CLB 的 SLA、故障切换目标和赔付规则。
7. 宣传前锁定 CVM、EIP、CLB、CDN、WAF、短信、AI API 等配额，并建立活动支持群和升级通道。

## 扩容阈值

- TKE：Pod CPU 连续 5 分钟 >60% 扩容，<25% 持续 20 分钟缩容；生产 API 最少 3 副本；节点池常态保留 30% 余量。
- PostgreSQL：CPU、连接、IOPS 任一持续 >60%，或存储 >65%、P95 查询明显恶化时升配；存储 >75% 强告警。
- Redis：内存/连接 >60%、P99 >2ms、出现淘汰、热点阻塞或大 key 时升配。
- CKafka：生产/消费吞吐 >50%、磁盘 >60%、lag 超过 1 分钟处理量时扩吞吐、分区或消费者。
- CDN：命中率目标 >90%；回源带宽或 5xx 上升时先检查缓存规则、鉴权和源站保护。

## 上线前的必做动作

1. 导出最近 30 天 COS/CDN 账单：存储量、日新增对象、下行流量、峰值带宽、HTTPS 请求数和缓存命中率。
2. 对核心用户旅程做 1×、5×、10×、20× 阶梯压测，记录 RPS、P95/P99、错误率、数据库连接/IOPS、Redis QPS 和 Kafka lag。
3. 按 PostgreSQL → Redis → CKafka 的顺序迁移，每项准备双跑/停写、校验与回滚方案。
4. 生产 TKE 与 dev 分离，完成 HPA、节点池弹性、PDB、反亲和、CLB 健康检查和 30% 资源缓冲。
5. 宣传前做节点故障、数据库切换、Redis 故障、Kafka 消费者暂停的演练。
6. 修复或替代失败的 certbot 自动续期链路。

## 假设与限制

本建议基于 2026 年 8 月 8 日的即时快照和近 14 天 Prometheus 峰值。当前缺少 API 级 RPS/延迟、PostgreSQL TPS/IOPS/慢查询、Redis 命令分布、Kafka 字节吞吐以及 COS/CDN 月账单，因此规格是询价和压测起点，不是最终采购承诺。

腾讯云官方参考：[PostgreSQL 规格](https://cloud.tencent.com/document/product/409/7562)、[Redis 产品架构](https://intl.cloud.tencent.com/zh/document/product/239/3205)、[CKafka 高可用](https://cloud.tencent.com/document/product/597/52786)、[TKE 节点池](https://intl.cloud.tencent.com/zh/document/product/457/35900)、[CDN 计费](https://cloud.tencent.com/document/product/228/2949/)、[COS CDN 加速](https://cloud.tencent.com/document/product/436/18670)。
