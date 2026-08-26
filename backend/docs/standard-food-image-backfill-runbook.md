# 标准食物库图片回填 — 运行手册

> 工具说明见 [../README.md](../README.md)。本文描述 **1 万+ 条** 的持续化批处理。

## 1. 规模基线

回填 CLI 只统计 `is_active=true`、`kcal_per_100g > 0` 的可用标准食物，并把
`image_path`、`image_paths` 都为空的记录放入缺图队列。每次处理前后都应重新生成统计，
不要把历史数量当作当前基线。

2026-08-26 首批低成本复用完成后的 development 基线为：符合口径 11,405 条、已有图
8,971 条、缺图 2,434 条；剩余队列最高用户引用次数为 0。

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

## 8. Gemini 全库图片质检

工具同时支持万界方舟 Gemini 原生 `generateContent` 协议。临时密钥只通过进程环境变量传入，禁止写入仓库、报告或命令行参数文件。

### 已有图片全量审计（只读）

```powershell
cd backend
$env:FOOD_IMAGE_VISION_API_KEY = '<temporary-key>'
go run ./cmd/standard-food-image-backfill `
  --vision-model gemini-3-flash-preview `
  --vision-base-url https://maas-openapi.wanjiedata.com/api `
  --audit-existing `
  --workers 24 `
  --checkpoint-every 25 `
  --audit-search-replacements `
  --audit-output tmp/food-image-audit/full-existing-report.json
```

- `--audit-existing` 强制只读，即使同时误传 `--apply` 也不会覆盖已有图。
- `match` 与 `mismatch` 会被断点续跑跳过；`uncertain`、`vision_failed`、`download_failed` 会在下次运行自动重试。
- 高置信错配可通过 `--audit-search-replacements` 继续联网找图，但候选仍保持 dry-run。

### 缺图全量找图（默认 dry-run）

```powershell
go run ./cmd/standard-food-image-backfill `
  --vision-model gemini-3-flash-preview `
  --vision-base-url https://maas-openapi.wanjiedata.com/api `
  --workers 12 `
  --max-candidates 6 `
  --search-query-limit 3 `
  --output-dir tmp/food-image-audit/full-missing `
  --success-json tmp/food-image-audit/full-missing-success.json
```

该命令只生成候选报告；通用找图模式即使传入 `--apply` 也会被门禁拒绝。人工复核候选后，必须使用下节的 `--reviewed-apply` 二次复核与 allowlist 路径写入。已有非空图片不会被该写入路径覆盖。

### 高置信报告二次复核与安全写入

先不带 `--apply` 运行一次现场复核：

```powershell
go run ./cmd/standard-food-image-backfill `
  --reviewed-apply `
  --reviewed-missing-report tmp/food-image-audit/full-missing-success.json `
  --reviewed-existing-report tmp/food-image-audit/full-existing-report.json `
  --reviewed-output tmp/food-image-audit/reviewed-verification-report.json `
  --reviewed-min-confidence 0.95 `
  --vision-model gemini-3-flash-preview `
  --vision-base-url https://maas-openapi.wanjiedata.com/api `
  --workers 24
```

确认复核报告后，增加 `--apply`、用 `--reviewed-allowlist-report` 指向上述复核报告，并换用新的输出文件执行写入。这样只有上一轮 `status=verified` 的固定白名单会进入正式写入。该模式有以下门禁：

- 审计与现场复核置信度都必须达到阈值，候选必须无水印；
- 同一候选 URL 被多个食物复用时整组排除；
- 替换已有图片时，旧图必须在现场第二次判定中仍为高置信错配；
- 上传新对象后按审计前的 `image_path`、`image_paths` 做条件更新，扫描后被他人修改的行自动跳过；
- 不删除旧 COS 对象；输出清单保留旧值、新 key、来源 URL 与两轮模型结果，可用于回滚和追责。

## 9. 低成本回填顺序

按以下顺序处理，前一层没有合格候选时才进入下一层：

1. **库内图片复用**：零新增 COS 存储、零联网图片版权风险。只允许视觉上等价的食物，模型初筛后仍需本地人工看图。
2. **Wikimedia Commons**：只接受明确的 CC0、Public Domain、CC BY 或 CC BY-SA；必须保存文件页、作者和许可证 URL。
3. **AI 生成**：仅用于常见、视觉特征明确且前两层均无结果的食物。零引用长尾默认延后，不为追求缺图总数归零而批量生成。

普通搜索引擎图片没有清晰授权信息时不得写入，即使视觉模型判定匹配也只能留作 dry-run 参考。
任何 `library` / `commons` / `bing` / `google` 搜索结果都不能通过通用 `--apply` 直接写库；网络图统一走 `--reviewed-apply`，库内复用统一走 `--library-reuse-apply`。

### 库内图片复用 dry-run

```bash
cd backend
go run ./cmd/standard-food-image-backfill \
  --image-search library \
  --limit 50 \
  --workers 8 \
  --max-candidates 4 \
  --threshold 0.95 \
  --success-json tmp/standard-food-image-library-reuse-success.json
```

下载成功报告中的候选并本地人工看图，只把确认等价的记录写入 allowlist。正式应用前先执行不带
`--apply` 的预演；预演通过后再增加 `--apply`：

```bash
go run ./cmd/standard-food-image-backfill \
  --library-reuse-apply \
  --library-reuse-report tmp/standard-food-image-library-reuse-success.json \
  --library-reuse-allowlist tmp/standard-food-image-library-reuse-allowlist.json \
  --library-reuse-output tmp/standard-food-image-library-reuse-preflight.json

go run ./cmd/standard-food-image-backfill \
  --library-reuse-apply \
  --library-reuse-report tmp/standard-food-image-library-reuse-success.json \
  --library-reuse-allowlist tmp/standard-food-image-library-reuse-allowlist.json \
  --library-reuse-output tmp/standard-food-image-library-reuse-applied.json \
  --apply
```

该写入模式会核对报告、人工白名单、目标缺图状态和来源图片 key，并在单个事务中条件更新；
不会再次上传图片。`quality_evidence.image_reuse` 会记录来源食物和人工复核信息。

### Commons 合规图片 dry-run

```bash
go run ./cmd/standard-food-image-backfill \
  --image-search commons \
  --limit 50 \
  --workers 4 \
  --max-candidates 6 \
  --threshold 0.95 \
  --success-json tmp/standard-food-image-commons-success.json
```

Commons 路径仍需人工复核后才能写入。写入时保留 `image_source_url`、
`image_source_label` 和 `image_license`，以满足署名和来源追溯要求。将上述 success JSON
传给 `--reviewed-missing-report`，按“高置信报告二次复核与安全写入”流程生成复核报告和 allowlist，
再使用 `--reviewed-apply --apply` 正式写入。
