# 全国高校餐饮目录自动化研究流水线

## 目标

这套流水线面向全国 3,196 所高校。省份、学校代码、审计状态和批次数量都是运行参数；北京只作为首个完整 MVP，用于验证“学校 → 校区 → 食堂 → 楼层 → 稳定命名窗口”的闭环。

自动化只负责发现、抓取、抽取和排队，不直接把候选事实发布到用户下拉列表。发布前仍需核验：

1. 当前运营校区是否完整；
2. 食堂是否属于该校区；
3. 楼层是否明确属于该食堂，而不是建筑总层数；
4. 窗口是否有稳定名称，而不是“风味档口”“各窗口”等类别词；
5. 来源正文、时间、学校身份和原始链接是否可追溯。

## 输出文件

- `nationwide-campus-dining-research-queue.json`：统一网页与小红书查询队列。
- `nationwide-xiaohongshu-query-queue.json`：便于登录态 MCP 单独消费的小红书队列。
- `nationwide-xiaohongshu-evidence.json`：小红书 MCP 读取正文后的证据回填文件。
- `nationwide-official-source-crawl.json`：网页抓取、候选名称、楼层、窗口和正文片段。

JSON 是唯一事实交换格式，便于断点续跑、去重、审计和代码校验。需要 Excel 时可从统一 JSON 导出，不维护两份事实源。

## 生成全国队列

在 `backend/` 目录运行：

```bash
go run ./cmd/campus-directory-crawl \
  -limit 0 \
  -queue-only
```

## 生成北京 MVP 队列

```bash
go run ./cmd/campus-directory-crawl \
  -province 北京市 \
  -limit 0 \
  -queue-only \
  -research-queue-output ../docs/campus-directory-proofreading/beijing-mvp-research-queue.json \
  -xiaohongshu-queue-output ../docs/campus-directory-proofreading/beijing-mvp-xiaohongshu-query-queue.json
```

北京当前队列同时包含从未核验、待复核、缺楼层和已有部分数据的学校，不能只处理 `not_started`。

## 批量抓取公开网页

```bash
go run ./cmd/campus-directory-crawl \
  -province 北京市 \
  -limit 10 \
  -max-pages 8 \
  -school-timeout 3m \
  -concurrency 2 \
  -output ../docs/campus-directory-proofreading/beijing-mvp-official-source-crawl.json
```

也可从仓库根目录运行同一命令：

```bash
npm run campus:web:crawl -- -province 北京市 -limit 10 -concurrency 2
```

常用筛选：

```bash
# 只抓尚未开始的学校
-audit-statuses not_started

# 精确重跑学校代码
-school-codes 4111011417 -force-refresh

# 全国运行
-province "" -limit 0

# 排除已经完成的省份，并发抓取其他学校
-exclude-provinces 北京市 -concurrency 4
```

脚本先搜索学校官网域名，再使用站内限定查询寻找食堂、楼层和窗口页面；高校官网、政府网站、阳光高考和可访问的微信公众号页面会进入候选。`-concurrency` 控制学校 worker 数（1–8，默认 2）；网络请求仍由线程安全的全局限速器控制启动间隔，既能重叠慢站点等待，又不会让每个 worker 各自无上限请求。抓取结果由主协程逐校写入同目录临时文件并原子替换断点 JSON，避免并发或进程中断写坏唯一状态文件。

官网返回 403、搜索引擎触发验证或 PDF 无法自动解析时，会保留失败状态供浏览器/MCP 补采，不会误判为“没有食堂”。

## 小红书 MCP 回填

本地 Go 进程不能直接调用 Codex 会话里的 MCP 登录态。正确流程是：

1. 脚本生成 `xiaohongshu_queries`；
2. Codex 使用用户已登录的 Chrome/MCP 按 `query_id` 批量搜索；
3. 只有实际可见的正文、发布时间、学校/校区身份和原帖 URL 才写入证据文件；
4. 再运行 Go 命令，脚本会把小红书候选合并到同一学校的抓取结果中。

证据文件结构：

```json
{
  "schools": [
    {
      "school_id": "学校 UUID",
      "sources": [
        {
          "url": "https://www.xiaohongshu.com/explore/...",
          "title": "笔记标题",
          "host": "www.xiaohongshu.com",
          "channel": "xiaohongshu",
          "query_id": "学校 UUID:xiaohongshu-overview",
          "status": "candidate_evidence",
          "canteen_candidates": ["第一食堂"],
          "floor_mentions": ["二层"],
          "window_candidates": ["兰州拉面窗口"],
          "evidence_excerpt": "可见正文中的相关片段"
        }
      ]
    }
  ]
}
```

搜索结果摘要、不可见帖子、只出现菜名的内容、无法确认校区的窗口和过期临时活动均不得写成已确认事实。

## 小红书本地批量采集器（推荐）

逐页使用 Codex/Chrome MCP 适合核验少量重点笔记，不适合消费数百条队列。批量阶段使用根目录脚本 `scripts/crawl-xiaohongshu-campus-dining.mjs`：它启动本机 Chrome 的专用资料目录，用户只需首次登录一次，之后脚本自动并发搜索、提取可见结果并逐条写断点 JSON。

登录资料目录为 `.local-state/xiaohongshu-chrome-profile/`，已被 Git 忽略。脚本不会读取日常 Chrome Profile，也不会把 Cookie、密码或登录资料写入仓库。

首次登录：

```bash
npm run xhs:crawl -- --login-only
```

北京 MVP 快速首轮（只搜“学校全名 + 食堂”）：

```bash
npm run xhs:crawl -- \
  --query-kinds overview \
  --concurrency 2 \
  --output docs/campus-directory-proofreading/beijing-mvp-xiaohongshu-raw-evidence.json
```

楼层与窗口补采：

```bash
npm run xhs:crawl -- \
  --query-kinds floors,windows \
  --concurrency 2 \
  --output docs/campus-directory-proofreading/beijing-mvp-xiaohongshu-raw-evidence.json
```

一次跑完三类查询：

```bash
npm run xhs:crawl -- --query-kinds all --concurrency 2
```

同一个脚本可直接消费全国队列，并按省份、官方学校代码或审计状态筛选：

```bash
npm run xhs:crawl -- \
  --queue docs/campus-directory-proofreading/nationwide-xiaohongshu-query-queue.json \
  --output docs/campus-directory-proofreading/nationwide-xiaohongshu-raw-evidence.json \
  --province 广东省 \
  --query-kinds overview \
  --concurrency 2

# 精确学校代码或审计状态
--school-codes 4144010561,4144010564
--audit-statuses not_started,source_backed_missing_floors

# 全国运行时排除已经完成的北京
--exclude-provinces 北京市
```

默认只保存每个查询前 12 条可见搜索结果，速度最快。若需同时读取前两篇候选笔记正文，可增加：

```bash
--max-notes-per-query 2
```

断点规则：

- 每完成一条查询立即原子写入输出 JSON；中断后重新运行会跳过已完成项。
- `capture_failed`、`unreadable`、`login_required` 默认会重试。
- `--no-retry-failures` 可临时跳过失败项，`--force` 可强制全量重抓。
- `--limit 10 --dry-run` 可先检查任务选择，不会打开浏览器。
- 并发限制为 1–4，默认 2；不提供绕过验证码、登录或平台风控的能力。

批量输出仍是原始发现证据。搜索结果中可能混入同名、简称相似或无关学校，不能直接发布；Codex/人工只需审核脚本筛出的候选，而不再逐页执行全部搜索。

## 下一步归一与发布

统一抓取结果由人工或代理逐校读取，归一到 `backend/data/campus_directory_pending_research_seed.json`。只有直接官方/政府 A 级来源，或产品负责人明确确认的窄范围 D 级事实，才能通过 `campus-directory-publish` 激活；其他来源保持 `pending_review`。
## 公开索引优先的全国补充发现

小红书站内搜索不再作为全国无人值守采集入口。连续使用同一登录账号执行数千次模板化搜索会触发安全验证，切换 Playwright、MCP 或 CDP 控制方式并不能改变平台看到的账号、设备和请求模式。

全国补充发现改用公开搜索引擎索引，每所学校只执行一次 `"学校名称" 食堂` 综合查询。脚本只读取 Bing 搜索结果页中的标题、摘要和候选链接，不打开小红书站内搜索，也不访问候选正文。官网、公众号、知乎、哔哩哔哩、新闻页和偶尔被索引的小红书公开链接统一作为待人工核验候选：

```bash
npm run campus:indexed-social:crawl -- --dry-run
npm run campus:indexed-social:crawl -- --limit 20 --concurrency 4
npm run campus:indexed-social:crawl -- --concurrency 4 --limit 0
```

默认断点输出为 `docs/campus-directory-proofreading/nationwide-indexed-social-raw-evidence.json`。完成状态按学校 ID 续跑；网络失败和访问限制可重试，连续访问限制会自动熔断。该文件仍是原始候选证据，必须核验学校、校区、食堂、楼层和窗口的父子关系后才能进入发布流程。
