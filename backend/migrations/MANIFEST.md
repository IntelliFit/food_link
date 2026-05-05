# Migration Manifest

## Scope

- `archive/database/`: schema or feature-oriented SQL baselines copied from `backend_bak/database`
- `archive/sql/`: historical one-off repairs, audits, and rollout scripts copied from `backend_bak/sql`

## Classification

| Group | Meaning |
| --- | --- |
| `baseline-schema` | Current线上 schema 构成的核心表定义与增量结构文件 |
| `feature-migration` | 新功能引入时的结构补丁 |
| `repair-or-audit` | 历史修复、治理、核查脚本，仅归档参考，不默认自动执行 |

## Notes

- 本次 Go 初始化以兼容现有线上 PostgreSQL schema 为目标，不承诺从空库回放所有历史 SQL。
- 具体 SQL 文件已完整归档，后续可逐步补成可执行 migration 链。

