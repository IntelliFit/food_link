# 服务器容量快照（已脱敏）

采集时间：2026-08-08 21:34–21:41（Asia/Shanghai）  
采集方式：通过 SSH 在 `154.8.205.78` 上执行只读系统、Kubernetes、Prometheus、PostgreSQL 数据目录、Redis 与 Kafka 查询。未修改配置，未重启服务，未记录密码或令牌。

## 主机与 Kubernetes

- 单节点：4 vCPU、15 GiB 内存、180 GiB ext4 系统盘，无 Swap。
- 即时负载：load average 0.82 / 1.09 / 1.04；Kubernetes `top node` 为 723m CPU（18%）、10,853 MiB 内存（69%）。
- 磁盘：71 GiB / 178 GiB，使用率 42%，可用约 100 GiB。
- 近 14 天 Prometheus 峰值：CPU 81.33%，内存 72.58%，根盘 49.07%，主机入站约 4.24 MB/s（约 33.9 Mbps），出站约 1.80 MB/s（约 14.4 Mbps）。
- Kubernetes 是单控制面、单工作节点，所有业务与基础设施共用该节点。
- 生产部署：FoodLink 3 副本、CoachLink 3 副本；同时还运行 dev 副本、异步 worker、Apollo、Prometheus、Grafana、Jaeger、OTel Collector 等。
- 近 14 天工作负载峰值：FoodLink 主环境合计 0.138 核 / 1,319,772,160 bytes（约 1.23 GiB）；CoachLink 主环境合计 0.176 核 / 1,452,007,424 bytes（约 1.35 GiB）。
- `certbot.service` 处于 failed 状态，需要单独排查证书自动续期链路。

## PostgreSQL

- PostgreSQL 17 作为单 Docker 容器运行，健康状态正常。
- 当前瞬时占用约 9.22% CPU、561 MiB 内存。
- PostgreSQL 数据目录总占用约 587 MiB。
- 数据库认证配置与容器初始化变量不一致，本次未强行读取数据库业务表、连接数和 SQL 级性能数据；正式选型前需补充慢查询、TPS/QPS、连接峰值和 IOPS。

## Redis

- Redis 7.4.8，单实例。
- 已用内存 1.14 MiB；4 个连接；瞬时 0 ops/s。
- 0 次淘汰；1,188 个过期键。
- 累计 keyspace hits 1,047、misses 1,187，当前命中率约 46.9%。该值受验证码、短 TTL 等业务影响，不能直接等同于通用缓存命中率。

## Kafka

- Kafka 单 broker、单副本（ReplicationFactor=1），数据目录约 145 MiB。
- 业务主题 7 个，FoodLink 主题为 3 分区；当前所有可见消费组 lag 为 0。
- 生产 FoodLink 主主题累计可见 offset 约 68,964；dev 主题约 88,207。当前吞吐远低于云 Kafka 常见最小规格，迁移价值主要是多副本高可用与免运维，而不是容量。

## 结论边界

- 这是近 14 天基础设施峰值与一次即时快照，不是宣传活动压测结果。
- 当前监控没有提供按 API 的 RPS、P95/P99、错误率、数据库 TPS/IOPS、COS/CDN 月流量与对象增长量，因此公网、CDN、数据库最终规格需在压测和腾讯云账单导出后校准。
