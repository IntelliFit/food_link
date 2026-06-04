# 标准食物库图片回填 — 运行手册

> 工具说明见 [../README.md](../README.md)。本文描述 **1 万+ 条** 的持续化批处理。

## 1. 规模基线（已跑通）

`nutrition_library` 约 **12,458** 条、当前 **0%** 有图（`manual-food-image-audit`）。  
回填 CLI 队列更严： `is_active`、`kcal_per_100g > 0`、无 `image_path`/`image_paths`。

```powershell
cd backend
.\scripts\backfill-baseline.ps1
# 输出 data/standard-food-image-backfill/baseline.json
```

## 2. 阶段

| 阶段 | 脚本 | 说明 |
|------|------|------|
| 0 基线 | `backfill-baseline.ps1` | 只读统计 |
| 1 试跑 | `backfill-phase1-dryrun.ps1` | 200 条 dry-run，看命中率 |
| 2 小批入库 | 改 `scheduler.json` `apply:true` 后跑 1 片 | 500 条验证 COS+DB |
| 3 持续 | `backfill-run-next.ps1` | 按片循环至 `missing.total=0` |
| 4 二轮 | 同片目录 `--failed-only` | 降 threshold / 加候选 |

## 3. 分片与断点

- 每片默认 **500** 条：`--limit 500 --offset (shard-1)*500`
- **`--checkpoint-every 1`**：每处理 1 条写 `state.json` + 追加 `results.jsonl`
- 同片崩溃后**直接重跑同命令**（不加 `--force-reprocess`）会跳过已完成 `food_id`
- 已成功 `--apply` 的行因 DB 已有图，不再进入缺图查询

## 4. 调度器 `scheduler.json`

从 `data/standard-food-image-backfill/scheduler.example.json` 复制为 `scheduler.json`。

`backfill-run-next.ps1` 每执行一次：`next_shard` +1，写入 `runs/shard-0001/` 等。

## 5. 监控

```powershell
python .\scripts\backfill-summarize-results.py data\standard-food-image-backfill\runs\shard-0001\results.jsonl
```

SQL 总进度：

```sql
SELECT
  COUNT(*) FILTER (WHERE NULLIF(trim(COALESCE(image_path,'')), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(image_paths,'[]'::jsonb)) u
               WHERE NULLIF(trim(u), '') IS NOT NULL)) AS has_image,
  COUNT(*) FILTER (WHERE is_active AND COALESCE(kcal_per_100g,0)>0
    AND NULLIF(trim(COALESCE(image_path,'')), '') IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(image_paths,'[]'::jsonb)) u
                    WHERE NULLIF(trim(u), '') IS NOT NULL)) AS missing
FROM food_nutrition_library;
```

## 6. 工期粗算

- 缺图约 **1.2 万**（以 `baseline.json` 为准）
- 约 15–25 s/条（含 Kimi）→ 单 worker 约 **50–80 h**
- 建议 `workers=2`、`sleep=1s`，夜间每天 2–4 片（1000–2000 条/天）

## 7. 风险

| 风险 | 处理 |
|------|------|
| 无 DashScope Key | 在 `backend/.env` 填写 `DASHSCOPE_API_KEY`，运行 `--test-api` 验证 |
| Bing 限流 | 增大 `sleep_ms` |
| `no_match` | `--failed-only` 二轮 |
| 错图 | Phase1 人工抽检 30 张 |
