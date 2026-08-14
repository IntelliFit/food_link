# 2026-08-08 容量规划交接

- 完成 `154.8.205.78` 生产服务器只读容量盘点与腾讯云 10–20 倍用户增长采购建议。
- 当前为 4C15G 单节点 K8s，14 天 CPU 峰值 81.33%；PostgreSQL/Redis/Kafka 数据量很小但均为单点。建议先迁托管高可用资源，再用 TKE HPA/节点池承接弹性。
- 报告位于 `docs/capacity-planning/2026-08-tencent-cloud/report.md`；证据和容量模型位于同目录 `evidence/`。
- HTML 便携打包器增强 reader 停在 fallback，未交付未验证的 HTML。
