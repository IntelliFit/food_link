# 标准食物图片回填 — 持久化运行数据

本目录存放**批量回填**的状态与日志（已 gitignore 具体内容，仅保留说明与示例配置）。

## 首次准备

1. 在 `backend\.env` 中填写 `DASHSCOPE_API_KEY=`（参考 `.env.example`），执行 `go run ./cmd/standard-food-image-backfill --config-dir . --test-api`
2. 基线统计：
   ```powershell
   cd backend
   .\scripts\backfill-baseline.ps1
   ```
   如需同时导出按用户实际引用次数排序的缺图清单，可直接运行：
   ```powershell
   go run ./cmd/standard-food-image-backfill --config-dir . --stats-only --stats-missing-limit 100 --stats-output data/standard-food-image-backfill/baseline.json
   ```
3. 试跑 200 条 dry-run：
   ```powershell
   .\scripts\backfill-phase1-dryrun.ps1
   ```

## 目录约定

| 路径 | 说明 |
|------|------|
| `baseline.json` | 缺图队列规模（`--stats-only` 输出） |
| `scheduler.json` | 分片调度进度（由 `backfill-run-next.ps1` 维护） |
| `runs/shard-NNNN/` | 每片：`state.json`、`results.jsonl`、`failed.jsonl`、`run.log` |

## 持续运行

```powershell
# 执行下一片（读 scheduler.json）
.\scripts\backfill-run-next.ps1

# 汇总某片结果
python .\scripts\backfill-summarize-results.py runs\shard-0001\results.jsonl
```

正式写库时在 `scheduler.json` 中设 `"apply": true`。
