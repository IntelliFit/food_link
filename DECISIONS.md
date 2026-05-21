# DECISIONS

- `2026-05-21`: 零食补库页的“拍照识别营养成分表”走异步任务，不走前端同步等待。
  - 前端上传图片后调用 `POST /api/packaged-food/nutrition-label/submit`，只拿 `task_id`，再复用 `GET /api/analyze/tasks/:task_id` 轮询。
  - 后端复用现有 `analysis_tasks`、TaskRepo、task queue、worker claim/lease/complete/fail 机制，新增任务类型 `packaged_nutrition_label`。
  - 识别模型配置默认复用现有 Doubao 视觉客户端，不新增独立 LLM key/config；除非后续明确要为营养成分表 OCR 单独切模型。

- `2026-05-21`: 零食拍照分析的实际查询顺序是 `packaged_food_library` 优先、普通食物库回退。识别 item 若带 `type=snack` 或命中零食/预包装关键词，后端先调用 `ResolvePackagedFood`；命中时返回 `nutrition_source=packaged_food_library` 并不再显示前端补库提示，未命中时继续沿用普通 `db_first` + DeepSeek fallback。

- `2026-05-21`: 拍照分析的零食识别仍沿用普通 `db_first` 营养估算链路，但结果页需要给用户明确的补库入口。
  - 只要识别结果像零食/预包装食品且当前没有命中 `packaged_food_library`，前端就在该 item 下提示“识别为零食”，并邀请用户补充包装上的名称、重量和营养成分。
  - 用户提交的数据写入 `packaged_food_library` 和 `packaged_food_aliases`，作为零食专用库沉淀；不改变当前普通食物营养补全和 DeepSeek fallback 主链路。
  - 未来如果拍照分析主链路接入 `ResolvePackagedFood` 并返回 `nutrition_source=packaged_food_library`，前端不再对该 item 显示补库提示。

- `2026-05-21`: “我的”页只保留复制用户 ID 的入口，完整用户 ID 放到“编辑资料”页。
  - 用户 ID 主要用于排障和 Jaeger tag 反查，不应在“我的”页头像昵称区直接占用视觉空间。
  - 首页只显示“复制用户ID”按钮；完整 UUID 在编辑资料页展示，并允许复制。
  - 资料保存逻辑需要保留本地 `userInfo.id`，避免保存头像/昵称后丢失后续展示和复制所需的用户 ID。

- `2026-05-21`: `/api/health` 健康检查不生成 OTel trace。
  - 健康检查频率高且没有业务排障价值，必须通过 `otelgin.WithFilter` 在入口跳过采集，避免 Jaeger 被健康检查 trace 淹没。
  - 只精确排除 `/api/health`；其它 API 仍需保留 trace，尤其是登录后请求的 `user.id` / `enduser.id` tag。

- `2026-05-21`: 登录用户 ID 必须作为 trace tag 写入 HTTP 请求 span。
  - `RequireJWT` 与 `OptionalJWT` 成功解析 JWT 后，统一给当前 OTel span 设置 `user.id` 和 `enduser.id`，方便在用户无法打开小程序控制台复制 trace_id 时，通过 Jaeger tag 反查该用户相关请求。
  - 分析任务/worker 链路继续保留 `analysis.user_id`，用于分析任务维度筛选；不要把 openid/unionid/token 等更敏感或无必要的身份标识写入 trace tag。

- `2026-05-21`: 会员支付记录创建必须在仓库层补齐非空 JSON 字段默认值。
  - `pro_membership_payment_records.notify_payload` 和 `extra` 在数据库层都是 JSON 非空字段；即使调用方漏传，`MembershipRepo.CreatePayment` 也要把它们初始化为 `{}`，不能依赖数据库默认值或上层 service 恰好传值。
  - 这样可以避免 `/api/membership/pay/create` 在会员支付单落库阶段因 `SQLSTATE 23502` 返回 500。

- `2026-05-21`: Go 后端日志栈继续统一使用 `backend/pkg/logger` + `log/slog`。
  - `backend/internal/analyze/service/analyze_service.go` 等新改动禁止重新引入 `go.uber.org/zap`，避免 `go.mod` 无该依赖时直接导致 `npm run dev:backend` 编译失败。
  - 新日志字段统一使用 `slog.String/Int/Bool/Duration/Any` 与 `logger.Err(...)`。

- `2026-05-20`: 手动记录的 item 级营养必须作为一等数据保存和展示。
  - `user_food_records.total_calories / total_protein / total_carbs / total_fat` 只能作为餐次汇总，不能替代 `items[].nutrients`；当天页、历史页、编辑页展开明细时应优先读取 item 级营养。
  - 手动记录保存链路必须保证每个 item 写入标准 `nutrients.calories/protein/carbs/fat`，不能只让外层总营养正确，否则会出现餐次总热量正常、食物明细全 0 的分裂体验。
  - 对已经保存的旧手动记录，读取层允许做有限兜底：优先按可识别的 `manual_source_title/name` 常见食物补回；无法识别时再按餐次总营养和克重比例兜底，避免用户看到无意义的 0。

- `2026-05-20`: 手动记录页需要产品级食物目录层，不能直接裸用原始营养库。
  - `food_nutrition_library` 和 `public_food_library` 是数据源，不是最终用户浏览目录；手动记录页应读取经过筛选、归类、命名清洗和排序的 food catalog。
  - 第一阶段应先从现有数据库挑出常用食物和高频真实餐食，补充分类、别名、默认份量和排序权重，再进入 UI 重构。
  - UI 方向参考成熟产品的“左侧分类 + 右侧列表 + 底部批量选择篮 + 克重调节弹层”，但保留 `food_link` 的 AI 估重、公共真实餐食、最近常吃和收藏复用特色。
  - 搜索必须先保证基础食物可靠命中，例如“饭/米饭/白米饭/米饭熟/rice/cooked rice”都应能互相召回；这是数据治理和搜索词典问题，不应只靠前端样式修补。

- `2026-05-20`: 圈子相关资质已通过，底部导航恢复「圈子」入口。
  - 主包 tab 使用 `pages/community/index`，自定义 tabBar 第四项为 `community / 圈子`。
  - 之前为审核临时创建的主包 `pages/expiry/index` 包装页不再保留；食物保质期继续作为分包功能页从首页/我的等入口 `navigateTo(extraPkgUrl('/pages/expiry/index'))` 打开。
  - 微信开发者工具运行态读取 `dist/` 产物；恢复 tab 后必须让 `dist/app.json` 与 `dist/custom-tab-bar/*` 刷新到最新源码，否则界面仍会显示旧的临时 tab。

- `2026-05-20`: 手动记录页不再按数据来源纵向堆长列表。
  - 默认视图应围绕“快速补录一餐”组织：先展示最近常吃、收藏、中文常见主食/蛋白/蔬菜等高频可用食物，再用分类 chip 快速收窄范围。
  - `food_nutrition_library` 在手动记录默认推荐中不能按英文字母顺序裸排；中文常见食物、米饭/鸡蛋/面条/鸡胸肉等日常高频项应优先，英文/USDA 低频项默认降权。
  - 搜索需要对短中文关键词做召回扩展，尤其“饭”必须能命中“米饭 / 白米饭 / rice / cooked rice”等标准库记录。
  - 搜索结果应混排最近常吃、收藏/公共库和标准营养库，并按用户使用信号、中文命中和标题相关性排序；不能只按来源分组让用户下滑找。
  - 后端 `ManualFoodResult.category` 是手动记录页分类筛选的稳定字段；前端分类口径先采用 `staple / protein / vegetable / meal / fruit / dairy / other`。

- `2026-05-20`: 手动记录页的食物来源统一采用“双库聚合”口径。
  - `pages/record-manual` 不再依赖旧 `manual_food_library` 单表；后端 `/api/manual-food/browse` 和 `/api/manual-food/search` 应直接聚合 `public_food_library` 与 `food_nutrition_library`，已登录用户再叠加 `user_food_records` 的最近常吃和 `public_food_library_collections` 的收藏餐食。
  - 手动记录默认推荐区应至少包含四块能力：最近常吃、收藏餐食、真实餐食库、标准食物库；未登录时允许隐藏前两块，但后两块不能为空白地退回旧单表。
  - `/api/manual-food/search` 前后端查询参数统一兼容 `q` 与历史 `keyword`；响应字段以当前小程序页面实际消费的 `results` 为准，避免继续出现“后端有数据但页面读不到”的协议错位。

- `2026-05-20`: 食物图片分析前端和主链路暂时收敛为两模式。
  - 普通模式 `standard` 首轮主识别使用 `gemini-3-flash-preview`，复用现有 Gemini3/Ofox API key 和 base_url，不再使用 Doubao 或 hybrid。
  - 精准模式 `strict` 使用独立 API key 的 `gemini-3.5-flash` 单次识别，非分组，不再走 `gemini35_flash_grouped`。
  - 图片二次纠错可使用 `gemini-3.1-flash-lite`，用于和首轮普通识别形成轻量差异化复核；不要把 Lite 作为普通模式首轮默认模型。
  - 零食、点心、饼干、肉干、坚果、糖果、糕点等预包装食品识别时，包装袋文字、品牌、品名、口味、配料表、营养成分表、净含量、规格和独立小包数量优先级高于包装正面插画或模型外观猜测。
  - 前端拍照前应提醒用户：包装袋文字尽量正着、清晰入镜，配料表清晰会更准；倒着拍包装文字会显著降低识别率。
  - 旧 `gemini35_flash/gemini35_flash_grouped` 在服务端和前端归一为 `strict`；旧 `lite/experimental` 归一为 `standard`，其它通道暂时隐藏。
  - 普通/精准主链路不再在 Gemini 临时失败时回退 Doubao，以便测试模型效果时能清晰归因。

- `2026-05-20`: db_first 营养库未命中补全统一使用 DeepSeek v4 Flash。
  - 食物识别阶段可继续使用 Doubao/Gemini/G3.5 等视觉模型，但未命中营养库后的“每 100g 营养数据补全”属于纯文本营养知识任务，默认走 `DeepSeekNutritionEstimator`。
  - 默认模型为 `deepseek-v4-flash`；补全成功写库 source 使用 `deepseek_generated`，日志和 metrics 也使用 `deepseek_*` 口径。
  - Gemini 不再作为 db_first 未命中营养补全的默认 fallback；除非后续明确新增专门实验通道。

- `2026-05-20`: `gemini35_flash_grouped` 应采用轻量版试验模式分工。
  - 第一阶段只负责识别规划：锁定食物清单、位置、OCR、候选名称和最多 2 组分组，不把精力放在精确重量上，也不能因重量不确定漏项。
  - 第二阶段只负责在第一阶段清单基础上估计可食部重量：默认不得新增、删除或改名；除非有极强反证，否则最终食物名称、顺序和 groupId 以第一阶段为准。
  - 融合时，名称/顺序/groupId/识别证据优先第一阶段；`estimatedWeightGrams`、`waterMl`、`suggestedRatio` 和 `weightEvidence` 优先第二阶段。
  - 日志需要同时保留 `plan_items`、`weight_items`、`final_items`，用于定位问题到底出在“看错种类/漏项”还是“估错重量”。

- `2026-05-20`: 首页“今日餐食”的“修改记录”弹层只允许修改饮食数据。
  - 该入口当前产品口径仅编辑食物名称、摄入克数、摄入比例和营养值，不在这里修改 `meal_type` 或 `activity_timing`。
  - 首页进入编辑弹层时，不能直接信任 dashboard 侧缓存作为编辑源数据；应优先拉取单条完整记录详情，避免编辑页出现 0 营养值或字段不全。
  - 若记录只有单个 food item，但 `items[].nutrients` 缺失而外层 `total_calories / total_protein / total_carbs / total_fat` 仍存在，编辑页允许先用外层总营养做单项兜底展示，优先保证用户看到可编辑的真实值，而不是全 0。

- `2026-05-20`: 宠物养成 MVP 采用“云端持久统一物种 + seed 外观组合 + 轻量离线惊喜”口径。
  - 第一版不做猫狗兔等多物种美术体系；每个用户只有一个基础健康伙伴，通过 `pet_seed` 派生颜色、体型、花纹、配饰、性格和名字，让用户感觉“我的宠物不同”。
  - 宠物经验和等级只用于成长展示、文案、外观/动作/惊喜解锁，不直接改变食物分析扣费规则。
  - 成长主要来自健康行为：记录饮食、热量稳定、蛋白达标、喝水达标、三餐完整、运动记录等；分享打卡仍沿用现有积分奖励体系，可作为额外成长来源。
  - 离线事件只做“温柔复盘/整理记录/发现好习惯/提醒待补习惯/带回少量奖励”，不做真实偷取别人积分，也不从其他用户账户扣减。
  - 每日宠物离线可消费积分奖励必须克制，MVP 默认最多 1 个积分；更多反馈给宠物经验和状态文案，避免积分经济膨胀。
  - 首页交互继续保持悬浮、可展开/收起/拖动；收起状态和位置保存在本地 storage，不急着上云同步。

- `2026-05-19`: 首页摄入目标的用户自定义覆盖应默认按日期生效。
  - 用户在首页某一天点击“目标设置”保存热量和宏量目标时，应锁定该具体日期，不应让系统动态目标在同一天再次覆盖。
  - 首页目标读取优先级为：当天自定义目标 > 旧全局手动目标 > 系统动态目标 > 档案/默认目标。
  - 旧全局 `health_condition.dashboard_targets` 仅保留兼容；新首页保存传 `target_date`，写入 `user_daily_nutrition_targets`，避免一次手动调整影响所有日期。
  - 需要长期自定义目标时，应在产品上另设明确入口，不和“当天目标设置”混用。
- `2026-05-19`: 状态文档维护口径：
  - `CURRENT_TASK.md` / `DECISIONS.md` 统一保存为 UTF-8，避免 GBK/UTF-8 混读写导致中文串码。
  - 两个文件均按日期倒序维护，最新信息在前；同一天内保持原追加顺序，避免重排时打散上下文。
  - `CURRENT_TASK.md` 记录近期任务、状态、阻塞和交接；`DECISIONS.md` 只记录应长期保留的稳定选择。
  - 完整开发流水继续写入 `memory/YYYY-MM-DD.md`，当主状态文件出现历史内容过长或不可恢复乱码时，以每日 memory 作为可追溯来源。

- `2026-05-19`: 喝水统计短期采用统一总量口径。
  - 拍照/文字食物分析得到的食物含水量应与用户手动记录的喝水一起计入当天总水分摄入，用于首页喝水卡、分析页喝水趋势和相关海报进度。
  - 当前不先拆成“来自食物的水”和“主动喝水”两个显眼指标，避免首页复杂化；未来如需解释来源，可基于 `user_water_logs.source_type` 做二级明细或弹层拆分。
  - 食物水分日志必须绑定到具体饮食记录，来源使用 `source_type=ai_food_record:<record_id>`；编辑/删除饮食记录时只能调整同 record id 的水分日志，禁止再从公共 `source_type=ai` 桶里按日期扣减，避免误扣其它食物或饮品的水分。

- `2026-05-19`: 收藏餐食复用为饮食记录时，不能直接透传 `user_recipes.items` 的历史 JSON 形态。
  - `POST /api/recipes/:recipe_id/use` 写入 `user_food_records.items` 前必须规范化 item 字段，保证饮食记录明细能读到标准 `weight/ratio/intake/water_ml/nutrients.calories/protein/carbs/fat`。
  - 对历史单 item 收藏，若 item 明细营养缺失但收藏餐食总营养存在，应把总营养补到该 item，避免当天饮食记录出现总热量正常、条目 0 kcal 的显示分裂。

- `2026-05-19`: 普通图片食物识别的联网增强先采用后端可控搜索证据层：
  - 火山方舟 Chat API 当前已确认页面只展示通用 `tools/tool_choice`，未明确给出可直接开启 websearch 的稳定参数；另有 `Web Search（联网内容插件）` 文档入口，但在没有确认插件接入协议、模型支持范围和请求格式前，不向 Doubao 请求体硬塞未知 `web_search` 字段。
  - 普通图片 hybrid 复核可在后端先搜索公开网页证据，再把标题/摘要/URL 作为 `webSearchEvidence` 给 Gemini/Ofox 复核；搜索证据只能作为佐证，不能覆盖图片可见 OCR、包装文字和用户补充事实。
  - 搜索失败不得导致食物识别失败；必须降级为原 Doubao→Gemini hybrid 或 Doubao 草稿结果，并在 `hybrid_review.web_search_status` 中暴露状态。

- `2026-05-19`: 官方 Web Search 接入结论与轻量模式口径：
  - 火山方舟官方 Web Search 走 `Responses API`：`POST /api/v3/responses` + `tools:[{"type":"web_search"}]`，不是 `/chat/completions` 的普通字段。
  - 新增轻量图片模式使用 `execution_mode=lite` 表示：单次 Doubao Responses + 官方 Web Search + 后端 `db_first` 营养回算。
  - 轻量模式跳过 Gemini hybrid 和自建 DuckDuckGo 搜索，用于快速验证“豆包视觉 + 官方联网搜索”的效果；若官方搜索未触发或失败，应按普通 LLM 错误/重试链路处理，不再额外调用 Gemini 兜底。
  - 若火山方舟账号未开通 `Web Search（联网内容插件）`，Responses API 会返回 `ToolNotOpen`；产品侧应提示开通插件或切回标准模式，不把上游 raw JSON 暴露给用户。
  - 官方 Web Search 仍使用火山方舟 Ark API Key 作为 `Authorization: Bearer` 凭据；用户在插件开通页面拿到的插件标识/短 key 不能直接当 API Key 使用，否则会返回 `AuthenticationError / API key format is incorrect`。
  - `doubao_web_search_api_key` 仅作为“另一个有效 Ark API Key”的可选覆盖；默认应留空，让轻量模式复用 `doubao_api_key` 所属账号的 Web Search 权限。不能把联网插件页面给出的非 Ark API Key 字符串填入该字段。

- `2026-05-19`: 不接受直接全局删除食物分析 Doubao `reasoning_effort` 的粗粒度修复。
  - 提交 `35d3037` 为解决多图 400 删除了 `backend/internal/analyze/service/llm_client.go` 中的 `reasoning_effort=minimal`，但该修改会影响所有食物分析 Doubao 调用，粒度过粗。
  - 当前已恢复普通食物分析 Doubao 请求中的 `reasoning_effort: "minimal"`，保持既有速度/推理强度口径。
  - 如果多图场景仍因 Ark 模型参数组合返回 400，后续应做按模型、图片数量或错误码的条件化兼容，而不是全局移除该参数。

- `2026-05-18`: 运动记录与打卡体系产品口径：
  - 饮食仍是 `food_link` 的核心记录与打卡主体；运动第一阶段不做与饮食同权重的独立强打卡体系。
  - 运动记录应参与首页今日目标、饮食推荐、全天复盘和分享图，作为“饮食目标为什么变化”的解释信号，而不是孤立的运动社交/挑战入口。
  - 单餐饮食打卡图保持聚焦餐食本身，不强行加入运动；全天饮食打卡/日总结图可以轻量展示当日运动摘要与对摄入建议的影响。
  - 可以给运动记录提供轻量完成感，例如“今日已运动/已记录”，但暂缓连续运动打卡、独立运动海报、复杂运动挑战和重游戏化机制，等运动记录真实使用频率验证后再升级。

- `2026-05-18`: 验证责任口径：
  - 当当前工作/提交作者是 `littlthorsebrother` 时，代理不需要执行自动化、本地运行或 weapp-devtools 验证；代码完成后只需说明“未验证，由用户手动验证”。
  - 这条优先于项目默认的前端验证要求，避免重复占用时间；若用户在具体任务中明确要求代理验证，再按用户当轮要求执行。

- `2026-05-18`: 食物分析纠错积分口径：
  - 首次普通食物分析继续消耗 2 积分，首次精准模式继续消耗 4 积分。
  - 纠错任务按半价扣费：普通模式纠错消耗 1 积分，精准模式纠错消耗 2 积分。
  - 后端以任务 payload 中确认的 `is_correction=true` 为准切换扣费模式，不依赖前端文案或页面状态。
  - 纠错任务仍必须写入 `credit_usage` 和 `credit_group_id`，失败、超时或取消时按实际纠错 cost 走幂等退款。

- `2026-05-18`: 首页热量与营养目标模型设计方向：
  - 不应长期要求用户理解并手选抽象活动系数（如久坐/轻度/中等/活跃/非常活跃）；注册阶段可以用生活方式问题给初始估计，但后续应根据用户在平台记录的近 1-2 周运动行为自动校准。
  - 模型需区分“基础生活消耗/非运动活动”与“平台记录的显式运动消耗”，避免活动系数已包含运动后又把运动热量 100% 叠加到当天摄入目标。
  - 首页应逐步从固定 `2000 kcal / 120g 蛋白 / 250g 碳水 / 65g 脂肪` 演进为：注册档案生成基础目标，饮食目标生成热量赤字/盈余，运动记录生成今日建议目标，宏量营养按体重、目标和训练状态动态分配。
  - 产品表达上应保留“基础目标”和“今日建议目标”的区别，并解释调整原因，例如“今天记录训练，建议额外补充部分碳水用于恢复”，而不是无提示地改变用户目标。
  - 第一版实现中，用户手动保存的 `health_condition.dashboard_targets` 仍拥有最高优先级；动态目标只在未设置手动目标时生效，避免已有用户目标被突然覆盖。
  - 第一版今日运动补偿采用温和加回：减脂约 45%、维持约 50%、增肌约 70%，单日补偿上限 600 kcal；该补偿主要进入碳水目标。
  - 后续需要修正“运动补偿”口径：如果基础目标使用的 TDEE 已经包含运动活动系数，则不能再把当天运动总消耗直接加回。更合理的长期口径是把活动拆成“非运动日常活动系数”和“平台记录运动预算”，或只对“今日运动超过近期平均/预期运动”的增量部分做补偿。
  - 旧版本曾保存到 `health_condition.dashboard_targets` 的历史目标不得长期阻挡系统动态重算；只有显式带 `dashboard_targets_mode=manual` 的新目标设置才视为用户自定义覆盖。
  - 首页不展示“手动目标”作为默认解释；系统动态目标展示“今日建议”，真正新保存的覆盖目标展示“自定义目标”。
  - 已落地口径：注册/健康档案里的 `activity_level` 产品语义改为“日常活动水平”，即不包含专门健身/训练的生活活动强度；前端同时提交 `daily_life_activity_level` 到 `health_condition` 作为稳定语义字段。
  - 首页动态目标基础热量不再直接使用旧 `TDEE`，而是用 `BMR × 日常活动系数` 估算日常消耗，再按饮食目标调整；显式运动记录只作为运动预算信号。
  - 今日运动补偿只针对 `今日运动消耗 - 近14天日均运动消耗` 的正增量，并且必须达到“明显超量门槛”才补偿；当前门槛为 `max(120 kcal, 近14天日均运动 × 30%)`，低于门槛不改变今日目标。

- `2026-05-18`: 后端数据库结构变更必须模型优先、迁移命令落地：
  - 禁止把手动 SQL 当作最终修复方案；修复性 SQL 不能只停留在终端操作或聊天记录里。
  - 先修改 `backend/internal/migration/do/schema_do.go` 中对应迁移 DO，让数据库表结构由 Go 代码表达；业务层需要读写时，再同步调整 domain/repo/service/DTO/handler，但不把 domain struct 当作迁移 DO。
  - AutoMigrate 覆盖不了或命名必须稳定的约束、索引、check、外键、触发器、数据修正步骤，要写入 `backend/internal/migration/migration.go` 的幂等迁移逻辑。
  - 最后从 `backend/` 执行 `go run ./cmd/migration -config-dir .`；运行前确认 `backend/config.yaml` 与环境变量指向的目标库，非本地/线上/不确定目标库必须先获得用户明确确认。

- `2026-05-18`: 后端可观测指标统一走 OpenTelemetry Metrics：Go 服务通过 OTLP gRPC 推送到 OTel Collector，由 Collector 的 Prometheus exporter 暴露 `/metrics` 给 Prometheus scrape；业务服务自身不再暴露 Prometheus `/metrics`。
  - `otel.enabled=true` 默认同时启用 trace 和 metrics；可用 `otel.traces_enabled` / `otel.metrics_enabled` 分别关闭。`app.env` 固定表示运行模式，只使用 `development`/`production`；服务器上的 dev/main 都应使用 `production`。Grafana dev/main 切换不再使用单独 environment 字段，改用 `app.name` 映射出的 `service_name`，建议为 `food_link-backend-dev` / `food_link-backend-main`。
  - 指标标签不得包含 `user_id`、`task_id`、图片 URL、prompt 原文、SQL 原文等高基数或隐私字段；HTTP route 使用 Gin 路由模板，DB 只暴露 operation/table/status，业务只暴露 source/provider/model/status 等低基数维度。
  - 数据库观测分三层：Collector collection 时的 `db_up` + 连接池状态；启动/显式 ping 的 `db_ping_*`；GORM callback 的操作耗时与结果。Grafana 面板优先用这三类指标组合判断 DB 可用性、连接池压力和慢表/慢操作。
  - 队列观测由 queue wrapper 和 Kafka/memory adapter 共同负责：应用内只统计 publish、delivery age、settlement、component health 和 memory depth；Kafka partition lag/backlog 后续应接 Kafka exporter，而不是在业务进程里扫描 broker。
  - 食物/运动分析业务指标只统计总耗时、LLM 调用、重试、解析/落库结果和 item 数，不记录用户输入内容；指标清单维护在 `backend/docs/observability-metrics.md`。
  - `app.name` 映射 OTel `service.name`，用于区分 dev/main 部署；不再提供 host name 覆盖配置。`host.name` 和 `service.instance.id` 固定读取系统 hostname，不要把实例维度配置成 `app.name`，否则会丢失多实例定位能力。

- `2026-05-18`: `food_nutrition_library` missing-nutrient batch enrich script contract:
  - Use `scripts/enrich_missing_nutrients.py` / `npm run nutrition:enrich-missing` for broad zero-field nutrient backfill; keep `scripts/enrich_vitamins.py` as the older vitamin-only script.
  - The script must preserve all existing non-zero DB values and update only fields that are still 0/NULL at write time.
  - AI prompts must explicitly allow true zero values; returned 0 values should not be written to DB.
  - A row whose missing fields were fully returned by AI, including all-zero results, is considered processed and is recorded in `scripts/enrich_missing_nutrients.state.json` so future runs skip it by default.
  - Do not commit the generated state JSON; use `--no-skip-processed` only when deliberately rechecking already processed rows.

- `2026-05-17`: 首页“按剩余目标推荐餐食”采用轻量候选增强口径：
  - 推荐不再只让模型凭空生成；后端应先检索小候选集，再把候选作为 DeepSeek 上下文。
  - 当前候选来源优先为 `public_food_library`（真实公共餐食/外食参考）、当前用户 `user_food_records`（个人历史偏好）、`food_nutrition_library`（标准营养库/自己做基础食材）。
  - 不把全量公共库或全量用户饮食记录直接放进 prompt；全局用户记录后续只能用聚合/热门组合，不直接暴露原始个人记录。
  - 推荐方案应带 `source/source_id`，前端可展示来源；DeepSeek 不可用时也优先从候选库生成 5 个兜底方案，再退回规则兜底。
  - “外面吃”优先公共食物库和个人历史外食，“自己做”优先标准营养库和个人历史；后续可继续引入收藏、地区、餐次、重复食物降权等信号。

- `2026-05-17`: 食物识别调用 Doubao/火山 Ark 返回上游临时错误时的口径：
  - `doubao api error 408/429/5xx` 和 `InternalServiceError` 视为临时 LLM 上游错误，后端可在同一任务内做有限重试，不能要求用户立刻重新提交。
  - 写入 `analysis_tasks.error_message` 前必须清洗上游原始 JSON、request id、API 域名等细节；用户侧统一看到“AI 识别服务暂时不可用/繁忙/超时”等友好提示。
  - 前端等待页也要保留兜底清洗，兼容旧后端或旧任务中已经落库的 raw LLM 错误。

- `2026-05-17`: 身体指标趋势页稳定口径：
  - 记录页（`weight-record` / `water-record` / `exercise-record`）首屏只服务当天/指定日期记录与当天记录管理，不放跨日趋势图。
  - 趋势页是二级页，负责回看、轻量分析和历史纠错；趋势页必须能删除历史记录，喝水必须能删除某一天里的单次 log。
  - 手机窄屏不再用 30 天横向点图/柱图作为默认表达；体重趋势应使用紧凑折线图表达 30 天连续变化，喝水和运动优先用紧凑热力图表达 30 天活跃/达标情况。
  - 喝水接口需要长期保留 `logs: number[]` 兼容旧客户端，同时新增 `log_items` 给新前端做逐条删除；删除单条喝水记录使用 `DELETE /api/body-metrics/water/:log_id`。
  - 运动趋势的深度类型分析暂缓，先保持热力概览 + 最近记录删除，后续再基于运动类型、频次、消耗分布设计。

- `2026-05-17`: 首页「体重 / 喝水 / 运动」快捷卡稳定口径：
  - 这三个入口是高频记录入口，不再承接统一「身体趋势」总览页。
  - 首页点击「体重」进入独立轻量 `weight-record`，首屏直接记录首页选中日期的体重；历史体重必须可删除。
  - 首页点击「喝水」进入独立轻量 `water-record`，首屏直接为首页选中日期加水；当天/指定日期喝水记录必须可清空。
  - 首页点击「运动」进入 `exercise-record`，首屏直接记录首页选中日期运动；已有删除能力必须保留。
  - 记录页不能在首屏展示趋势图、跨日分析或混合分析内容；记录动作必须是视觉中心。
  - 趋势只能通过弱入口「查看趋势」进入二级页：`weight-trend` / `water-trend` / `exercise-trend`。
  - 旧 `body-trends` 路由只保留兼容重定向，按 tab 转到对应二级趋势页；不要再把它作为新的业务入口。

- `2026-05-17`: 小程序审核避险期间，底部导航不再暴露「圈子」入口；第四个 tab 临时替换为主包 `pages/expiry/index`，文案为「保质期」，直接展示现有食物保质期管理页面。不要新增泛化「工具」tab，也不要把健康档案做成底部中转入口；底部导航优先承载高频动作。原 `src/pages/community` 代码暂不删除，后续取得社交/社区/论坛等资质类目后可再评估恢复；恢复前不要把 `/pages/community/index` 重新放回 tabBar 或其它显眼入口。

- `2026-05-17`: 未命中食物营养补全改用 Gemini：
  - db_first 营养库未命中时，营养补全标准路径改用当前 Gemini/Ofox 客户端生成每 100g 营养数据。
  - 不使用“咖啡/饮品规则值”这类硬编码兜底写库；Gemini 如果失败或没有返回可解析数据，保持 unresolved 并记录 warn。
  - Gemini 返回数据后必须先写入 `food_nutrition_library`；只有 upsert 成功，本次 item 才标记 `nutrition_source=gemini_generated` 并使用该营养数据展示。
  - 写库时 `source` 必须为 `gemini_generated`，便于直接在数据库按时间和 source 核验新补条目。
  - 如果 upsert 失败，后端必须记录 `gemini nutrition upsert failed` warn，并保持该 item 为 unresolved，避免前端展示未落库数据。

- `2026-05-17`: 未命中食物营养 AI 补全口径：
  - 标准 db_first 营养库未命中后，AI 营养补全默认使用 `deepseek-v4-pro`，不再默认使用 `deepseek-v4-flash`。
  - AI 补全写入 `food_nutrition_library` 时，当前先通过 `source=deepseek_v4_pro_auto` 标记为 v4-pro 自动后补数据；后续如做审核后台，应继续扩展 `source_detail/model/confidence/review_status/generated_at/raw_name` 等 provenance 字段。
  - AI 补全结果必须经过服务端校验：营养值非负、每 100g 宏量营养不超过合理上限、糖不超过碳水、饱和脂肪不超过脂肪；若宏量营养有值但热量过低，应按 `protein*4 + carbs*4 + fat*9` 修正热量，避免出现“碳水有数值但热量为 0”的矛盾结果。
  - Prompt 中需要明确告诉模型：未知不能随意填 0；无糖黑咖啡/美式/纯茶/白水可接近 0，但含奶、糖、糖浆、奶油、椰乳等饮品必须估算对应营养。
  - Web search 可作为后续增强：优先用于品牌包装食品/饮品获取公开营养标签；在没有稳定工具协议前，不把未经验证的搜索摘要直接当作权威库覆盖人工/已审核数据。

- `2026-05-17`: 首页非今日日期补录提示口径：
  - 首页选择当天日期时不展示补录提示，保持当天视图正常。
  - 首页选择昨天或其它允许记录的历史日期时，只要页面数据不忙、用户非游客且该日期没有被用户取消提醒，就展示补录提示；不再依赖当天摄入是否低于能量目标。
  - 补录提示文案应明确这是给历史日期补记食物、体重、喝水和运动记录，避免继续把补录提示解释成“能量过低”告警。
  - 身体趋势页或运动记录页触发 `HOME_DASHBOARD_REFRESH_EVENT` 后，首页必须刷新当前选中日期；历史日期选择留下的 `skipNextRefreshRef` 不能吞掉补录后的返回刷新。

- `2026-05-17`: 小程序体验版/正式版后端域名口径修正：
  - `v2.healthymax.cn` 已弃用，小程序生产/预览构建不得再请求该域名。
  - 体验版/真机预览包应请求 `https://dev.healthymax.cn`，不能请求正式线上域名。
  - 正式发布包才请求 `https://healthymax.cn`。
  - `build:weapp` 与 `build:weapp:preview` 统一注入 `TARO_APP_API_BASE_URL=https://dev.healthymax.cn`，用于体验版上传。
  - `build:weapp:release` 显式注入 `TARO_APP_API_BASE_URL=https://healthymax.cn`，用于正式版发布。
  - `config/index.ts` 的 production 默认值和 `src/utils/api.ts` 的注入失败兜底统一为 `https://dev.healthymax.cn`，避免普通 build 上传体验版时误连正式线上数据。

- `2026-05-17`: 食物结果页 AI 摄入比例建议口径：
  - AI 摄入比例不是展示文案，而是直接写入每个 item 的 `suggestedRatio`，前端用它初始化结果页现有 `ratio/intake` 滑块。
  - 比例建议必须在 db_first 营养库回算之后执行，基于最终营养数据、餐次、用户目标、运动时机、剩余热量和补充上下文生成，不能只依赖第一轮视觉识别的粗营养。
  - 开关字段为 `suggest_ratio_enabled`；前端偏好保存在 `analyzeSuggestRatioEnabled`，默认开启。关闭、无模型客户端、模型失败、超时或返回非法比例时，所有 item 必须回退 `suggestedRatio=100`。
  - 后端需要返回 `suggest_ratio_status` 便于排查，且二阶段建议失败不得导致整个食物识别任务失败。
  - 结果页可显示轻量“AI建议”标记，但用户手动拖动滑块后应转为 manual，不再暗示当前比例仍由 AI 决定。

- `2026-05-17`: 全仓库模型口径更新：不再保留 旧视觉模型通道 命名、配置或运行时代码。旧视觉/图文调用统一迁移到 Doubao 或 Gemini 3 Flash：食物标准链路默认 Doubao，精准估重继续可使用 Gemini 3 Flash，保质期默认 Doubao 且可按 provider 走 Gemini，运动估算与体检 OCR 改为 Doubao；配置统一使用 `DOUBAO_API_KEY` / `doubao_api_key`，不再使用旧 旧视觉服务 key。

- `2026-05-17`: Doubao `reasoning_effort` 场景化口径：普通食物识别继续用 `minimal` 以控制速度；运动记录使用 `medium`，因为需要综合运动类型、强度、时长和用户画像估算热量，同时避免最高档带来的延迟；保质期识别也使用 `medium`，提升日期/包装信息解析稳定性。

- `2026-05-17`: 运动记录 Doubao 思考强度采用 `medium`，不再使用最高档 `high` 作为默认，以平衡准确性和延迟。运动记录标题兜底口径：用户标题为空或只是泛标题（如“运动/打卡/图片”等）时，后端使用模型返回的 `exercise_type` 自动生成保存标题；用户输入了具体标题时保留用户原文。

- `2026-05-17`: 运动记录不得静默回退本地规则估算。无论文字输入还是文字+图片/纯图片，Doubao 运动分析失败、未配置、返回非 2xx、JSON 不可解析时，都应让任务失败并走既有失败/退款链路，不能保存“图片识别运动/一般运动/约 59 kcal”这类假成功结果。运动 Doubao 请求暂不使用 `response_format=json_object`，避免火山 Ark 当前模型组合返回 400；继续通过 prompt 要求 JSON 并在后端解析校验。

- `2026-05-17`: 训练打卡截图识别 prompt 必须要求 OCR 多动作、重量、次数、组数、总耗时和截图消耗；`exercise_type` 应概括主要训练内容，不允许泛化成“一般运动”。

- `2026-05-17`: 食物分析重量与营养库口径统一为可食部净重：
  - `estimatedWeightGrams` 是后端营养计算使用的重量，不是整只/整份毛重。
  - 带壳、带骨、带核食物必须按去壳/去骨/去核后的可食重量估算；虾壳、蟹壳、贝壳、花生壳、瓜子壳、骨头、果核等不可食部分不计入重量，也不作为单独食物输出。
  - 普通图片、文字解析、精准模式 planner、精准分项估重和重量复核 prompt 都应保留该规则；后续新增识别链路也要继承这个口径。

- `2026-05-16`: 食物分析等待页互动卡口径：
  - 等待页的 `WAITING_INTERACTION_CARDS` 应保持大题库，不再只放少量固定题。
  - 互动内容优先覆盖用户高频饮食决策：进食顺序、主食份量、蛋白质、控油控糖、外卖、火锅、奶茶、夜宵、聚餐、轻食、记录习惯等。
  - 展示逻辑应优先从本地未看过的互动卡中随机抽取，整套题库看完后再重置新一轮，避免用户连续看到同一张卡。

- `2026-05-16`: 食物识别模型分工口径：
  - 普通图片模式固定走 Doubao 识别食物名称、克重和 waterMl，然后继续用 db_first 营养库回算营养。
  - 纠错任务固定走 Doubao，并保持 db_first；纠错不使用 Gemini 估重链路。
  - 精准模式拆成两阶段：Doubao 负责 planner/食物主体与中国菜种类识别；Gemini (`ofox-gemini`) 负责分项重量估计。
  - 精准模式的 Gemini 估重调用不允许静默 fallback 到 Doubao，避免重量质量退回普通识别水平。
  - 精准模式对所有 planned items 启用重量复核，复核同样使用 Gemini no-fallback；营养仍由后端 db_first 统一回算。

- `2026-05-15`: 分析页面板命名与归类口径：
  - 分析页三段面板为 `健康指数 / AI分析 / 热量分布`。
  - `AI分析` 面板承载 `AI 风险解读`，不再放在健康指数底部；该内容直接展开显示完整正文，不使用点击卡片、折叠或底部详情弹层。
  - `AI 风险解读` 在 `AI分析` 中不使用独立边框或渐变背景，保持普通内容卡片呈现。
  - `热量分布` 面板按顺序承载 `热量摄入趋势`、`宏量营养结构`、`餐次热量分布`、`长期健康指标` 四个板块。
  - 长期健康指标中的体重趋势使用折线图表达，不再使用日期/体重胶囊列表作为主要可视化。

- `2026-05-15`: 体检报告上传统一最多 3 张：
  - 健康档案引导页和健康档案查看/编辑页的体检报告上传都应限制为最多 3 张图片。
  - 多张报告图片按逐张上传后的 URL 数组处理，提交识别任务和档案字段时使用逗号拼接字符串，保持后端当前 `report_image_url` / `submitReportExtractionTask()` 协议不变。
  - 引导页允许用户在保存健康档案前预览 1/2/3 张报告图片；保存成功后再后台提交识别任务，不阻塞档案保存。

- `2026-05-15`: 首页记录菜单入口配色口径：
  - 点击卡路里/记录按钮后打开的记录菜单，顶部 `拍照识别 / 相册上传 / 文本输入 / 手动输入` 四个入口使用低饱和 tone，不再使用高饱和红绿橙蓝。
  - 配色风格对齐“我的”页功能入口：柔绿、灰蓝、米金、灰紫；每个入口同时具备浅色卡片背景、浅边框和淡色图标槽。
  - 记录菜单底部快捷入口（`我的收藏`、`识别记录`）不展示左侧图标槽；同一行最右侧统一使用项目 iconfont 的向右箭头。
  - 暗色模式下使用同色相低透明度背景/边框，保持克制而可辨识。

- `2026-05-15`: 分析页布局分区口径：
  - 周期选择（`近一周/近一个月`）放在页面左上角固定区域，通过下拉/ActionSheet 切换，不再占用内容区第一行分段控件。
  - 分析页内容区顶部使用三段面板：`健康指数`、`营养证据`、`结构指标`。
  - 默认展示 `健康指数`；`营养证据` 承载热量证据和宏量结构证据；`结构指标` 承载餐次分布和长期健康指标。
  - 为减少板块堆叠，记录分布和连续记录卡片不再作为当前分析页面板中的可见卡片。
  - `我的关注` 不再作为整张卡片展示；应作为健康指数卡片右侧的小按钮，点击后用底部浮层定制 6 个关注方向，浮层需要盖过并隐藏底部导航。
  - 营养/结构面板内部卡片默认展开；卡片标题应描述内容本身，避免继续使用“证据”作为标题后缀。
  - 营养/结构面板内卡片标题区统一左对齐。
  - 健康友好度小卡片的详情入口应为右下角 `图标 + 更多`，不使用居中的“查看更多”横线分隔；整卡仍可点击打开详情。
  - 分析页底部弹层（我的关注、友好度详情、AI 风险解读）层级、遮罩、最大高度和安全区留白应保持一致，避免被自定义 tabBar 覆盖。
  - 健康指数主卡中的 4 个概览指标应一行四列展示，不使用独立块背景和边框，仅保留文字层级与间距。

- `2026-05-14`: Backend API contract tests use a Go-native YAML-driven runner:
  - Global settings stay in `backend/e2e-test/suite.yaml`; new route-specific cases should be added under `backend/e2e-test/cases/<route-or-module>/*.yaml`; shared fixture data belongs under `backend/e2e-test/fixtures/`.
  - The E2E CLI, runner, assets, and guide are kept together under `backend/e2e-test/`; use `go run ./e2e-test/cmd/api-contract-test` from `backend/`.
  - E2E metadata uses `id` for stable machine-readable selection, `name` for short human-readable Chinese output, and `desc` for detailed human-readable behavior notes.
  - The runner builds the real Gin app through `internal/app.New`, disables OTel and background workers, and sends requests in-process through `httpexpect`.
  - Each default run creates a fresh PostgreSQL database using the configured server, runs the existing Go AutoMigrate, applies seed SQL, and drops the database afterward. `--keep-db` is only for debugging.
  - Authenticated cases use named users from the YAML suite and signed JWTs generated with the configured JWT secret; `test_backend_cookie` is reserved for internal test-backend routes.
  - Route smoke cases are shallow reachability checks; explicit YAML cases remain the source of real response contract assertions.
  - Workflow cases can use `capture` to save response JSON fields, `{{var}}` substitution to pass values into later requests/assertions, and `db_assert` to verify side effects in the same temporary database. Dependent workflow steps should stay in the same case file and in execution order.

- `2026-05-14`: 二次纠错样本不再复用 `critical_samples_weapp`：
  - `critical_samples_weapp` 只适合旧式单食物重量偏差样本，不能承载“纠错前结果数组 / 用户纠错数组 / 二次分析结果数组”。
  - 新增稳定表 `analysis_feedback_samples` 存 AI 纠错反馈样本，核心字段包括 `source_task_id`、`correction_task_id`、`root_task_id`、`model_name`、`analysis_engine`、`before_result`、`user_correction_items`、`after_result`、`payload_snapshot`、`error_message`。
  - 用户在结果页点击“识别有误？点击纠错”并执行“重新智能分析”后，后端以 `analysis_tasks.payload.is_correction=true` 为准，在 worker 完成或失败纠错任务时自动 upsert 一条样本；`correction_task_id` 是唯一键，失败后重试成功可覆盖同一条样本。

- `2026-05-13`: 健康档案引导页非选项题默认可继续：
  - 用户画像/健康档案引导页中，身高、体重、作息、补充信息、体检报告等非选项题应默认允许点击下一步。
  - 身高默认值为 `170cm`，体重默认值为 `60kg`；如果用户没有拨动对应组件，提交健康档案时也应保存这些默认值，不能只让页面跳过但最终保存失败。
  - 性别、饮食目标、活动水平等选项题仍按当前业务要求等待用户选择。

- `2026-05-13`: “修改食物参数”弹层不再提供饮食目标编辑：
  - 首页今日餐食的 `MealRecordEditModal` 只保留餐次、运动时机和食物明细参数编辑。
  - 该弹层保存时不再提交 `diet_goal`，避免用户在食物参数编辑里继续修改饮食目标。
  - 记录详情页同名编辑弹层本来只编辑食物明细，继续保持不展示饮食目标。

- `2026-05-13`: 健康档案作息习惯改为小时级入睡/起床选择：
  - 作息仍复用 `health_condition.routine_type` 字段，不新增数据库列。
  - 前端保存统一写入格式化文本 `HH:00 睡，HH:00 起`，例如 `23:00 睡，07:00 起`。
  - 引导页展示常见作息快捷项用于快速填充两个小时；健康档案修改页只展示两个小时拨动选择器，不展示快捷项。
  - 旧枚举 `early_bird/regular/night_owl/irregular` 需要继续被前端解析成对应小时，避免旧用户档案打开编辑时丢失可用值。

- `2026-05-13`: 分析页健康指数与作息字段稳定口径：
  - 健康指数需要至少 2 个有饮食记录的自然日；`recorded_days < 2` 时，分析页不展示健康指数、关注风险卡片、行动建议和 AI 风险解读入口，改为提示用户连续记录两天以上后再显示。
  - `/api/stats/summary` 需要返回 `recorded_days`，前端也可用 `daily_calories` 本地推导兜底。
  - 健康档案作息仍复用 `health_condition.routine_type` 字段；当前前端采用小时级入睡/起床选择，保存为 `HH:00 睡，HH:00 起` 文本。
  - 后端 AI 风险解读 prompt 使用作息时，预设值要转为中文说明，自定义文本原样进入 prompt；作息内容进入洞察缓存 fingerprint，修改作息后旧洞察应提示刷新。
  - 当前健康指数公式主要在前端 `src/pages/stats/index.tsx` 即时计算，完整口径记录在 `docs/health-index-logic.md`。

- `2026-05-13`: 分享海报底部头像资料来源：
  - 海报底部头像/昵称优先使用当前登录用户的 `/api/user/profile` 最新资料，并回写本地 `userInfo`。
  - 本地 `userInfo` 作为离线兜底，需兼容 `name/nickname/nickName` 与 `avatar/avatarUrl/avatar_url`。
  - 公开邀请资料 `getFriendInviteProfile()` 只能作为补充来源；若其昵称或头像为空，不能覆盖当前用户资料或本地缓存。
  - 首页单餐海报、识别记录详情海报、当天饮食海报都应走同一套合并逻辑。

- `2026-05-13`: 食物图片识别多图输入的稳定口径：
  - 食物识别前后端最多允许 3 张图片；超过 3 张应在前端阻止，后端服务层也必须返回 400 防御。
  - 多张图片无论是否开启 `is_multi_view`，都作为同一次识别提交，后端只发起一次大模型请求。
  - `is_multi_view=true` 只影响模型理解方式：把多张图片更明确地视为同一餐食/同一组食物的多角度输入；不再触发多次请求或不同积分倍率。
  - 食物识别积分消耗按“提交一次识别”计算，不按图片数倍增；标准模式仍为 2 积分/次，精准模式仍为 4 积分/次。

- `2026-05-13`: 今日餐食分享海报的摄入比例位置与底部头像口径：
  - 单餐海报 `drawRecordPoster()` 中，每个食物的摄入比例放在食物名右侧括号内，使用小号灰色文字，例如 `米饭（80%）`。
  - 右侧信息只保留实际摄入克数与热量，例如 `120g · 180 kcal`，避免右侧过挤。
  - 海报底部左侧必须保留用户头像区域；头像图片加载失败时画圆形首字占位，不让底部标题顶到最左。
  - 生成海报时可用本地 `userInfo` 作为昵称/头像兜底，再用接口资料覆盖。

- `2026-05-13`: 当天饮食分享海报按钮对齐首页单餐海报分享口径：
  - `packageExtra/pages/day-record` 的「分享今日饮食」按钮生成海报后直接调用微信官方 `Taro.showShareImageMenu()`，不再把自定义预览弹层作为主路径。
  - 成功、取消或失败后都清理本次海报状态，和首页今日餐食卡片点击「生成分享海报」的单餐海报行为一致。
  - 分享海报里的摄入比例要显示并兼容旧数据：优先 `items[].ratio`，缺失时用 `intake/weight` 推导，仍缺失按 100%。
  - 单餐海报 `drawRecordPoster()` 在每个食物明细行显示「摄入xx%」；当天饮食海报 `drawDayRecordPoster()` 在每条餐食行显示聚合「摄入xx%」。

- `2026-05-13`: 图片分析页不再暴露「饮食目标」选择：
  - `src/packageExtra/pages/analyze/index.tsx` 不再从健康档案或本地缓存初始化饮食目标，也不再展示目标选项。
  - 为兼容后端和结果页既有字段，图片分析提交继续传 `diet_goal: 'none'`，并在提交时清理旧 `analyzeDietGoal` 缓存。

- `2026-05-13`: 首页低能量补录提示不再展示具体日期：
  - 提示文案保持“检测到当日能量过低，是否需要补录”，不再渲染 `M月D日` 这类日期副文案。
  - 补录操作使用独立「去补录」按钮打开首页 `RecordMenu`；「取消」按钮必须先弹确认框提醒用户。
  - 用户确认取消后，以本地存储 `home_backfill_hint_dismissed_dates_v1` 按选中日期记住不再展示该低能量补录提醒；用户仍可通过首页记录入口自行补录。
  - 当天能量/食量没有独立日报表；首页按日视图来自 `user_food_records.record_time` 中国自然日窗口聚合，`total_calories` 等字段存在每条食物记录上。

- `2026-05-13`: 首页「今日餐食」卡片不展示数量徽章：
  - 标题行不再展示同一餐次 `N次` / 记录数量徽章。
  - 缩略图不再展示“共 N 张”图片数量角标；仍保留卡片点击详情和图片预览能力。

- `2026-05-13`: 用户记录的食物摄入比例需要在饮食明细类页面显式展示：
  - 「当天饮食记录」每个食物 item 都展示「摄入 xx%」，不能只在识别记录详情页展示。
  - 历史数据缺 `ratio` 时继续按 `intake/weight` 推导；仍缺失时默认展示 100%。

- `2026-05-13`: 圈子评论输入栏成功发送后应自动收起：
  - 行为等同用户点击空白区域收起输入栏，但成功发送后的收起不能把已发送内容重新存成草稿。
  - 异步发送期间若用户已经切换到其它动态或输入了新内容，不应误关闭当前新输入态。

- `2026-05-13`: 首页身体指标写入必须使用首页选中日期：
  - 喝水新增/清空不能默认写入后端当天，必须传首页当前选中日期快照。
  - 身体指标日期请求体同时带 `date` 与 `recorded_on`，后端 handler 保持 `date` 优先，兼容历史字段。
  - 对弹窗类写入，必须在打开弹窗时固化目标日期快照；弹窗内所有快捷按钮、自定义保存、清空操作都使用该快照，不能再读取可能变化的外层实时 `selectedDate`。
  - 首页日期选择不得在 render 主体里用旧 state 覆盖 ref；日期变更必须通过单一 `commitSelectedDate()` 同步 ref/state/storage。日期选择组件点击瞬间也要持久化 `home_selected_date_v1`，供后续弹窗写入兜底读取。

- `2026-05-13`: 「当天饮食记录」页面及其「分享今日饮食」海报的餐食顺序应按 `record_time` 升序展示：
  - 先吃/先记录的餐食在前，最晚吃/最晚记录的餐食在后。
  - 页面列表和当天饮食海报必须使用同一份已排序数据，避免截图/分享顺序与页面顺序不一致。
  - 不因这个页面需求修改全局饮食记录接口默认排序，避免影响其它“最近记录优先”的选择器。

- `2026-05-13`: 「分享今日饮食」海报顶部今日摄入量采用进度条表达：
  - 左侧展示已摄入 kcal，右侧展示目标 kcal，下方圆角进度条表达进度。
  - 目标内使用绿色，明显超过目标时使用暖色提示。
  - 调整海报顶部模块时必须同步更新 `computeDayRecordPosterHeight()`，避免导出图片裁剪或内容重叠。

- `2026-05-12`: 摄入比例的稳定来源是 `user_food_records.items[].ratio/intake/weight`：
  - 保存识别结果和后续编辑记录时，必须继续把每个食物 item 的 `ratio` 与 `intake` 写入 `items` JSON。
  - 老数据可能没有 `ratio`；读取和渲染时必须兼容：优先用 `intake/weight` 推导比例，若 `ratio/intake` 都不存在则按 100% 摄入处理，不能渲染成 0% 或把营养折算成 0。
  - 首页 `/api/home/dashboard` 需要返回餐次级 `intake_ratio`，按该餐所有 item 的 `sum(intake)/sum(weight)*100` 聚合；缺少 intake 时可用 `weight * ratio / 100` 兜底。
  - 首页 `meal_record_entries[]` 也需要返回每条记录的 `intake_ratio` 以及 `total_protein/total_carbs/total_fat/water_ml`，便于同餐多记录弹层不依赖 `full_record` 缓存即可展示。
  - 识别记录详情页按每个 item 的 `ratio` 渲染「摄入比例 xx%」，即使为 100% 也显式展示；营养值继续按 ratio 折算实际摄入。

- `2026-05-12`: 分支命名与基线口径更新：
  - 原 `main` 已保留为 `old_main`，对应提交 `fcc6b61`。
  - 新 `main` 与新 `dev` 保持同一基线，当前均指向 `48fd3a7`。
  - 后续开发默认基于新的 `dev` / `main` 这条线继续，不再把旧 `main` 当作当前产品基线。

- `2026-05-12`: 旧主包 `pages/record/index` 不再作为饮食记录入口：
  - 当前饮食记录主入口是首页 `RecordMenu` 弹窗；底栏中间按钮、首页空餐食按钮、当天记录页空态补录都必须回到首页打开该弹窗。
  - 旧 `src/pages/record/index.tsx`、旧 `packageExtra/pages/record-menu/index.tsx` 及其样式/配置应移除，避免旧拍照 UI 被误打开。
  - 自定义 tabBar 中间按钮可以保留视觉项，但 `pagePath` 不应再指向已删除的 `/pages/record/index`。
  - 登录回跳或旧缓存里的 `/pages/record/index` 统一兼容收口到 `/pages/index/index`。

- `2026-05-12`: `useAppColorScheme()` 在小程序页面 context 断链时不能直接 throw：
  - App 层仍应使用 `AppColorSchemeProvider` 作为正常主题来源。
  - 但 Taro 分包页面、hot reload 或页面独立挂载时可能让页面树读不到 provider；此时应从 `fl_app_color_scheme` 本地存储构建 fallback context。
  - fallback 仍要提供 `setScheme/toggleScheme` 并触发 `APP_COLOR_SCHEME_EVENT`，避免“今日餐食”等 `withAuth` 包裹页面因主题 hook 抛错白屏。

- `2026-05-12`: 首页运动卡片进入身体趋势页后，运动记录的目标日期必须继续沿用路由里的选中日期：
  - `src/pages/index/index.tsx` 的运动卡片只负责把当前 `selectedDate` 传给 `body-trends`。
  - `src/packageExtra/pages/body-trends/index.tsx` 不能再把“去记录”按钮硬编码成今天；它要把路由 `date` 再传给 `exercise-record`。
  - `src/packageExtra/pages/exercise-record/index.tsx` 提交前要重新从当前日期 ref 归一化一次目标日期，避免切日后 state 闭包把记录写到默认今天。

- `2026-05-12`: 圈子好友动态页面已有内存列表时也必须按 `CACHE_DURATION` 自动刷新：
  - 社区页 `Taro.useDidShow()` 不能因为 `feedList.length > 0` 就直接 return，否则小程序长期挂起/切 tab 回来时会一直展示旧 Feed。
  - 在已有列表分支中仍应保留临时评论合并，但如果 `Date.now() - lastFeedRefreshTime.current > CACHE_DURATION`，必须静默调用 `refreshFeed(true, false)` 拉取 `/api/community/feed` 最新数据。
  - `App.useLaunch` 清理跨冷启动缓存只能解决冷启动旧数据；不能替代页面保持挂载时的显示刷新。
  - 圈子默认排序应为 `latest`，旧筛选缓存 key 升级时需更换版本号，避免历史 `recommended` 缓存影响用户第一屏。
  - `ScrollView.onScrollToLower` 在微信端不稳定时，必须保留 `onScroll` 近底兜底触发 `loadMoreFeed()`，并给底部加载更多区域提供点击兜底。
  - 后端 feed 分页不能只取 `limit` 条后再做 `offset` 切片；对于 `latest` 这类非自定义排序，repo 查询候选数量至少要是 `offset + limit`，否则第二页必然为空。

- `2026-05-12`: 食物营养库 DeepSeek 回填分成两条路径：
  - 已存在于 `food_nutrition_library` 且已有三大营养素的食物，不应当重新生成整条记录，也不应覆盖已有热量/蛋白/碳水/脂肪；只允许补当前为 0 的扩展营养字段（纤维、糖、矿物质、维生素等）。
  - 批量待处理目标按“整组维生素为空或整组矿物质为空”筛选，而不是任意单字段为 0；因为胆固醇、维 D、B12 等字段对很多食物天然可能为 0，不能据此判定数据缺失。
  - 不在营养库里的食物，才通过 DeepSeek 生成完整每 100g 营养条目，并用 `deepseek_auto` 来源插入标准库与 alias。
  - 批量维护命令使用 `backend/cmd/nutrition-backfill`；默认 dry-run，显式 `--apply` 才写库。DeepSeek 批量默认 `--batch-size 1`，优先保证 JSON 稳定。
  - 回填顺序优先处理 `source LIKE '历史%'` 的历史识别食物，避免 USDA 冷门酒水等低微量食物长期占住批次前排。
  - 全量执行时建议重复运行 `--apply --limit 50 --batch-size 5` 且保持 `offset=0`，让每轮从当前仍缺失的集合继续处理；`offset` 只用于预览或手动跳过当前批次。

- `2026-05-12`: 后端 Docker 部署构建需要显式使用可配置 `GOPROXY`：
  - `backend/Dockerfile` 在 builder 阶段设置 `ARG GOPROXY=https://goproxy.cn,direct` 与 `ENV GOPROXY=${GOPROXY}`。
  - `backend/scripts/push-docker-ccr.mjs` 默认将 `DOCKER_GO_PROXY` / `GOPROXY` / `https://goproxy.cn,direct` 传入 Docker build。
  - 这样直接运行 `npm run push-docker-ccr` 时，`go mod download` 不再默认依赖容器内访问 `proxy.golang.org`，降低本地网络卡死风险。

- `2026-05-12`: 线上 Kafka topic partition 初始建议按后端总 worker 数规划，并给未来 Pod 扩容预留。
  - 当前若后端 3 个 Pod 且 `worker.count=2`，同一 consumer group 中总消费者为 6。
  - 后续若扩到 6 个 Pod 且 `worker.count=2`，总消费者为 12。
  - 建议线上 `food-link-analysis-tasks` topic 初始创建为 12 partitions；当前 6 个消费者可消费 12 partitions，未来扩容到 12 个消费者时无需改 topic。
  - 单副本 Kafka 仍只能 `replication-factor=1`；若后续 Kafka 扩成 3 broker，应新环境或重建 topic 使用 `replication-factor=3`。

- `2026-05-12`: Kafka consumer 并发口径按“后端 Pod 数 * worker.count”计算，而不是只看单个 Pod。
  - 同一个 `consumer_group` 内，Kafka 会把 topic partition 分配给消费者；同一 partition 同一时间只会给 group 内一个 consumer。
  - 如果后端 3 个 Pod 且 `worker.count=8`，实际是 24 个消费者；topic partition 少于 24 时，多出来的消费者会空闲。
  - 当前模型任务会调用外部 LLM/OCR，生产初始值建议让 partition 数与有效消费者数接近，并从较小并发开始，例如 3 个后端 Pod 时 `worker.count=1~2`、topic partitions 为 3~6，再根据限流和延迟扩容。
  - 单副本 Kafka 只能用于轻量/过渡环境；生产可靠性需要多 broker、topic replication factor 大于 1、持久化卷和健康检查。

- `2026-05-12`: 本地 Kafka 验证使用仓库内 `backend/docker-compose.kafka.yml` 启动单节点 Kafka。
  - 本地 Kafka 镜像使用官方 `apache/kafka:3.7.0`；不要使用当前解析不到的 `bitnami/kafka:3.7` 标签。
  - 本地 Kafka broker 暴露为 `127.0.0.1:9092`，topic 使用 `food-link-analysis-tasks`。
  - 本地测试时 `backend/config.yaml` 可临时设置 `task_queue.driver: "kafka"`、`brokers: ["127.0.0.1:9092"]`、`consumer_group: "food-link-local-workers"`。
  - 独立 worker 入口已删除；本地 Kafka 模式仍通过 server 内嵌 worker 消费，必须保持 `worker.count > 0`。

- `2026-05-12`: 首页喝水卡片依赖 `bodyMetrics.waterByDate`，不能只靠 `/api/home/dashboard` 刷新：
  - 删除或更新食物记录会在后端同步维护 AI 饮水日志，但首页喝水卡片来自 `/api/body-metrics/summary` 合并后的本地 `bodyMetrics`。
  - 因此删除食物记录后的首页轻量同步必须同时刷新 body metrics summary，否则热量/三宏会更新，喝水量仍停留在本地旧值。
  - 前端合并云端 `water_daily` 时需要把 `total/logs` 钳制为非负数；后端也应保证扣减不低于 0。
  - `user_water_logs.recorded_on` 是数据库 `date` 字段；后端 exact/sum/delete/reduce 这类单日水日志操作必须按自然日匹配，不能用中国自然日转 UTC 的 `time.Time` 窗口去查，否则 Go/GORM 对 PostgreSQL date 参数可能匹配不到行。

- `2026-05-12`: 食物分析压测脚本的主耗时口径改为后端 processing 窗口：
  - 20 并发压测日志里的 `task_wait` 只作为辅助字段，因为它包含提交后排队、worker 领取等待和轮询间隔。
  - 主性能字段使用 `processing`：轮询第一次观察到 `analysis_tasks.status=processing` 时取任务 `updated_at` 作为开始，终态 `done` 的 `updated_at` 作为结束。
  - 压测汇总优先看 `avg_processing / p95_processing / processing_variance_ms2 / processing_stddev`；`avg_total` 仍包含提交接口和轮询总等待，不应再作为模型性能结论。
  - 默认轮询间隔使用 `500ms`，降低漏采 processing 开始时间的概率；真实模型压测仍只在显式手动执行 build tag `food_analysis_load` 时运行。

- `2026-05-12`: 食物记录含水量与喝水统计的扣减口径：
  - 保存食物记录时自动生成的饮水日志统一使用 `source_type='ai'`，用于和用户手动喝水区分。
  - 删除整条食物记录时，后端按原记录 items 的实际摄入含水量，从该记录日期对应中国自然日的 AI 饮水日志中扣减。
  - 当天饮食记录页删除单个食物成分实际走 `PUT /api/food-record/:id` 更新 items；后端必须按旧 items 与新 items 的含水量差值同步调整 AI 饮水日志。
  - 扣减不能影响 `source_type='manual'` 的手动喝水记录；若 AI 饮水不足，只扣到已有 AI 水量为止，整体喝水统计不得小于 0。

- `2026-05-12`: 食物分析压测脚本的稳定口径：
  - `backend/internal/analyze/loadtest/food_analysis_stability_test.go` 仍使用 `//go:build food_analysis_load`，不进入普通 `go test ./...`。
  - 每次压测只上传 1 张图片到 `/api/upload-analyze-image-file`，随后所有并发请求复用同一个 image URL 调 `/api/analyze/submit`，用于隔离模型/任务处理并发能力，避免 COS 上传成为主要变量。
  - 清理阶段需要对 image URL 去重后删除 COS object；任务记录仍逐个调用 `DELETE /api/analyze/tasks/:task_id`。
  - 模型快速切换优先使用 Go test 参数 `-food.analysis.model=<modelName>`，也兼容环境变量 `FOOD_ANALYSIS_LOAD_MODEL`；执行模式同理支持 `-food.analysis.execution_mode=<mode>` 和 `FOOD_ANALYSIS_LOAD_EXECUTION_MODE`。
  - 压测结果必须输出 task wait 与 total duration 的 variance/stddev；默认使用 20 个同图输入样本。
  - 千问专用压测入口放在 `backend/internal/analyze/loadtest/food_analysis_doubao_stability_test.go`，测试名 `TestFoodAnalysisStabilityAndLatencyDoubao`，默认 `modelName="doubao"`，后端解析为 Doubao `doubao-seed-2-0-lite-260428`。

- `2026-05-12`: 食物记录含水量需要同时进入首页今日餐食展示和当天喝水统计：
  - 保存食物记录时，后端以 `items[].water_ml` 为主，同时兼容 `waterMl`、`nutrients.water_ml`、`nutrients.waterMl`，避免不同前端/旧缓存 payload 丢失水量。
  - 计入喝水的水量按实际摄入折算：优先 `water_ml * ratio / 100`；缺少 ratio 时用 `water_ml * intake / weight`；缺少摄入上下文时才按整份含水量计。
  - 自动写入 `user_water_logs`，`source_type='ai'`，日期使用该食物记录的 `record_time` 所在中国自然日。
  - 首页 `/api/home/dashboard` 的 `meals[]` 必须返回 `water_ml`，同样按该餐下所有 `user_food_records.items` 的实际摄入水量聚合。
  - 小程序首页今日餐食卡片在蛋白质/碳水/脂肪之后展示含水量，使用 `icon-drink` 和 `ml`；本地乐观缓存和旧缓存刷新判断也要保留该字段。

- `2026-05-12`: 食物分析稳定性/平均响应速度压测采用手动 build tag，不进入普通 Go 测试：
  - 压测文件放在 `backend/internal/analyze/loadtest/food_analysis_stability_test.go`，使用 `//go:build food_analysis_load`。
  - 普通 `go test ./...` 不应执行真实上传、模型调用、任务轮询或 COS 删除。
  - 手动执行时使用 `go test -tags food_analysis_load ./internal/analyze/loadtest -run TestFoodAnalysisStabilityAndLatency -count=1 -timeout=20m -v`。
  - 食物分析上传接口是 `POST /api/upload-analyze-image-file`（multipart 字段 `file`）和兼容旧入口 `POST /api/upload-analyze-image`（base64）。
  - 当前没有公开 HTTP 删除 COS 图片接口；`DELETE /api/analyze/tasks/:task_id` 只删除/取消任务记录，不实际删除 COS object。压测清理上传图片时直接使用后端 COS 配置按 URL 解析 key 并删除 `food-images` bucket 对象。
  - 压测清理可单独运行 `TestFoodAnalysisLoadCleanupUploadedImages`，通过 `FOOD_ANALYSIS_LOAD_CLEANUP_IMAGE_URLS` 删除已知图片 URL；删除 COS 对象时应支持 region fallback 和短重试，避免本地配置/网络抖动导致清理失败。

- `2026-05-12`: 保存食物记录时，食物成分含水量要计入当天饮水：
  - 后端 `POST /api/food-record/save` 成功创建 `user_food_records` 后，根据 `items[].water_ml` 累计生成 `user_water_logs`。
  - 计入饮水的水量必须按实际摄入折算：优先 `water_ml * ratio / 100`，缺少 ratio 时用 `water_ml * intake / weight`。
  - 饮水记录日期使用食物记录的 `record_time` 对应中国自然日，不一定是当天真实日期；补录到昨天/前天时也应加到对应日期。
  - 自动生成的饮水日志 `source_type='ai'`，用于和用户手动喝水记录区分。

- `2026-05-12`: 食物图片识别默认模型选择必须尊重 `external.llm_provider`：
  - `backend/config.yaml` 中若设置 `external.llm_provider: "gemini"`，普通食物图片分析、精准图片子任务、图片 engine 对比和批量图片分析在 model 为空或历史 `gemini` 参数时，应走 Ofox/Gemini。
  - 显式传入 `doubao` / `doubao-seed-2-0-lite-260428` 时仍走 Doubao/Doubao，不被默认 provider 覆盖。
  - 这条规则用于避免配置文件已经选择 Gemini、但分析模块仍默认打到缺失/不可用 Doubao key 后返回“AI 识别服务配置异常”。

- `2026-05-12`: 积分消耗口径改为“创建异步任务即预扣，失败整组返还”：
  - 提交接口仍需先校验当前积分是否足够；只要成功创建对应 `analysis_tasks` 异步任务，就立即占用本次 `credit_usage`。
  - 每次提交必须写入统一 `credit_group_id`；标准/文字/运动/保质期通常是一组一个任务，精准模式的 `precision_plan`、`precision_item_estimate`、`precision_aggregate` 共享同一组。
  - 每日系统积分使用量按 `credit_group_id` 分组统计 `pending / processing / done` 任务，一组只计一次；同组任一任务进入 `failed / timed_out / cancelled`，整组系统积分立即视为返还。
  - 累计奖励积分在任务创建后用 `food_analysis:<credit_group_id>` 或 `exercise:<credit_group_id>` 幂等预扣；失败时用对应 `*_refund:<credit_group_id>` 幂等返还。
  - 精准模式中任一子任务失败即触发整组退款；后续 aggregate 再失败时退款仍保持幂等，不会重复返还。
  - 计费单位按任务类型和图片数计算：标准食物/保质期识别 `2 * 图片数`，精准模式 `4 * 图片数`，文字分析按 1 个 unit，运动记录 1。
  - `AnalysisTask` 响应保留 `task_type`、`image_paths`、`payload`，前端可用它们判断任务类型、执行模式、图片数量和积分组。

- `2026-05-12`: 首页非今日补录提示不再展示“当前补录日期”这类上下文说明；稳定口径改为低能量补录提醒：
  - 仅当选中日期属于允许补录窗口、不是今天、且当天摄入低于目标 60% 时展示。
  - 文案为“检测到当日能量过低，是否需要补录”。
  - 点击提示色块直接打开首页记录菜单弹窗，沿用拍照识别/相册上传/文本输入/手动输入的补录入口。

- `2026-05-12`: 食物分析提交链路不再请求或保存“分析完成通知”订阅授权：
  - 图片分析页和文字分析页不调用 `Taro.requestSubscribeMessage()`。
  - 分析提交/文字分析提交/精准续接协议不再携带 `subscribe_status`。
  - 前端不再注入 `TARO_APP_ANALYSIS_SUBSCRIBE_TEMPLATE_ID` / `__ANALYSIS_SUBSCRIBE_TEMPLATE_ID__`。
  - Go 后端不再保留 `wechat_pay.analysis_subscribe_template_id` 配置、`ANALYSIS_SUBSCRIBE_TEMPLATE_ID` env 绑定或 `analysis_tasks.payload.subscribe_status`。
  - 该决策只影响食物分析通知授权；保质期过期通知订阅链路继续保留。

- `2026-05-12`: trace 和 log 的口径固定如下：
  - zap log 是结构化日志流，用于控制台、文件或后续日志系统；它不会因为启用 OTel trace 就自动出现在 Jaeger。
  - Jaeger 主要展示 trace/span/event/error；需要在 Jaeger 里看到的关键节点，应显式写入 span event、span attribute，错误用 `RecordError`。
  - 后端关键诊断日志仍走 zap，不使用 `print`/`fmt.Println`；需要与 trace 关联时使用 `logger.WithTrace(ctx)` 增加 `trace_id/span_id`。

- `2026-05-12`: 分析任务的 trace context 应随 `task_queue` 消息传播：
  - `/api/analyze/submit` 创建 task 后发布队列消息时注入 W3C trace context。
  - server 内嵌后台消费者从消息中提取 trace context，再启动 delivery/process/analysis span。
  - 这样 HTTP submit span 和后续异步处理 span 可在 Jaeger 中落到同一条 trace 下，便于定位卡在 submit、queue、claim、LLM、DB-first、complete 还是 fail update。

- `2026-05-12`: 独立 Go worker 入口正式删除：
  - 不再保留 `backend/cmd/worker`、`scripts/run-worker.cjs`、`npm run dev:worker` 或镜像内 `/app/food-link-worker`。
  - 后台分析消费能力保留在 server 进程内，由 `config.yaml` 的 `worker.count` 控制；`count=0` 关闭，`count>0` 启动对应数量内嵌 worker loop。
  - 当前本地 `memory` queue 是进程内队列，独立进程无法消费 server 发布的消息；后续若接入 Kafka/NATS/Redis Stream，可在 `task_queue` adapter 层重新评估是否需要独立消费者进程。

- `2026-05-12`: `worker.poll_interval_seconds` 的稳定口径：
  - 它不是前端轮询 `/api/analyze/tasks/:task_id` 的间隔，也不是普通 `memory` queue 消息投递延迟。
  - 当前普通分析任务通过进程内 channel 直接投递给内嵌 worker；消息到达后立即处理。
  - 该间隔主要控制 worker tick：如果 `task_types` 包含 `expiry_notification`，tick 时检查一条 due 的 `food_expiry_notification_jobs`；同时影响 idle 日志节奏。

- `2026-05-12`: `worker.task_types` 是 worker 消费和处理任务的白名单：
  - 对普通队列任务，它同时影响订阅过滤、DB claim 白名单和 worker switch 分支。
  - `expiry_notification` 不是 `analysis_tasks` 队列消息类型，而是开启保质期通知 DB job 检查。
  - 不要随意删类型；缺少对应类型会导致相关任务 pending、被跳过或无法发送通知。

- `2026-05-12`: 所有会创建 `analysis_tasks` pending 且依赖 worker 处理的入口，都应在创建成功后发布 `{task_id, task_type}` 到 `task_queue`：
  - 当前已覆盖 `food`、`food_text`、`precision_plan`、精准模式子任务、`health_report`、`exercise`、`public_food_library_text`。
  - `analysis_tasks` 只保留状态/结果/前端轮询职责；新增异步任务类型时不能只写 DB pending，否则在当前取消 DB pending 扫描后任务不会被 worker 领取。

- `2026-05-12`: `task_queue` 配置语义：
  - `driver=memory` 是当前唯一实现，适合 server 内嵌 worker；它是进程内队列，不持久化，server 重启不会 replay 旧 pending。
  - `driver=kafka` 仅为预留，adapter 未实现前必须启动失败，不能静默 fallback 到 DB 扫描。
  - `buffer_size` 是 memory channel 容量，必须大于 0；`topic/brokers/consumer_group` 当前为未来真实 broker 预留，memory driver 不使用。

- `2026-05-12`: `worker.task_types` 不再属于配置契约：
  - `config.yaml` 只控制 `worker.count` 和 `worker.poll_interval_seconds`，不允许按环境裁剪 worker 可处理的业务任务类型。
  - worker 支持的任务类型由代码层 `worker.SupportedTaskTypes()` 固定维护；新增、删除或禁用任务类型应改代码和测试。
  - 这样避免生产/本地配置漏掉某个 `task_type` 后导致任务长期 pending 或提醒不发送。

- `2026-05-12`: 结果页「更多营养」展开区采用两列放大明细卡，不再使用三列小格；触发按钮和明细数值应优先保证小程序手机端阅读与点击舒适度。

- `task_queue.driver=kafka` 是生产级队列实现，不再是 fail-fast 占位；worker 使用 `FetchMessage` 读取，只有在 `analysis_tasks` 成功写入 `done` 或 `failed` 后才 `CommitMessages`。
- `analysis_tasks` 的可靠处理口径固定为 DB attempt lease：claim 写入 `worker_id`、`attempt_id`、`attempt_count`、`processing_started_at`、`lease_until`；complete/fail 必须按当前 `attempt_id` 条件更新，旧 attempt 不允许覆盖新 attempt。
- `processing` 不应永久存在：worker 处理期间续租；server/worker 挂掉后，lease 过期任务由 recovery 重新发布到 queue；`memory` 本地模式也复用这套 DB recovery。
- Kafka 只能保证未 commit 消息重新投递，不能单独保证外部副作用 exactly once；项目保证的是 DB 终态幂等与旧 attempt 不覆盖新结果。
- Go server 内嵌 worker goroutine 会 recover/restart；整个 server 进程崩溃的拉起职责属于 systemd、Docker、K8s 或部署平台。

- `2026-05-12`: 文本食物记录积分口径与图片食物分析一致：
  - `food_text` 创建异步任务时必须写入 `credit_usage` 与 `credit_group_id`，并使用 `food_analysis:<credit_group_id>` 作为 earned 积分预扣 source key。
  - `food_text` 进入 `failed/timed_out/cancelled` 后，必须使用 `food_analysis_refund:<credit_group_id>` 走幂等退款；worker 失败路径和 `GetTask()` 轮询失败态都应保持这个行为。
  - 后续重构积分、队列或文本记录入口时，不能把文本任务从食物分析积分分组退款链路中拆出去。

- `2026-05-12`: HTTP 响应 trace/request id 兜底口径：
  - 生产仍应开启 `otel.enabled=true` 才能在 Jaeger 里看到真实链路。
  - 但前端用户报错所需的 `X-Trace-Id` 不能完全依赖 OTel；后端必须在 OTel 关闭或没有有效 span 时生成基础 32 位 hex trace id，并同时返回 `X-Request-Id`。
  - 前端必须把 `no-trace-id/none/null/undefined` 视为占位符，不展示给用户，也不作为真实 trace id 拼接进错误文案。

- `2026-05-12`: 用户可见热量显示不得为负：
  - 结果页入口应对后端/缓存返回的 calories 和宏量营养做非负归一化，避免负值继续进入页面状态、保存 payload 或首页统计。
  - 图片结果页已有 `normalizeNutrientValue()` 兜底；文字结果页同样需要保持该口径。

- `2026-05-12`: 识别历史页“一键删除未记录”必须由后端按当前用户全量条件原子执行：
  - 前端不得基于当前已加载列表逐条调用 `DELETE /api/analyze/tasks/:task_id`，否则会受分页/加载数量和部分请求失败影响，需要多次操作。
  - 后端批量条件稳定为：历史页可见任务类型 + `status='done'` + 不存在同用户 `user_food_records.source_task_id`。
  - 该操作不删除 pending/processing/failed/timed_out/cancelled，也不删除已记录任务或精准模式内部估重子任务。

- `2026-05-12`: 将当前功能分支同步到远程 `dev` 时，默认采用非破坏性 merge commit：
  - 不 force push、不重写 `origin/dev` 历史。
  - 保留 `origin/dev` 作为合并父提交，便于后续追溯远程 dev 曾经的独立提交。
  - 合并结果代码以当前已验证功能分支 `backend-refactor-sync-migrate-tencent` 为准，避免远程 dev 的旧 Python 后端、旧记录页入口或旧前端链路覆盖近期需求。

- `2026-05-12`: 食物识别模型输出 JSON 不合法时采用同任务内部重试：
  - 稳定识别 `parse llm json failed` / `unexpected end of JSON input` 等 JSON 解析失败，而不是靠前端错误文案判断。
  - 重试发生在同一个 `analysis_tasks` 的 worker 处理内，不重新提交任务、不再次扣用户积分。
  - 单任务最多额外重试 3 次；若 3 次后仍是非法 JSON，才按原失败链路标记任务失败并触发既有退款/失败处理。

- `2026-05-11`: 食物/健康/运动等 `analysis_tasks` 分析任务不再把 DB pending 扫描当作分发队列：
  - DB 表 `analysis_tasks` 只作为任务状态、结果、错误信息和前端轮询的持久化来源。
  - 分发层统一走 `task_queue` 接口；当前唯一可用 driver 是进程内 `memory`，HTTP submit 和 server 内嵌 worker 在同一进程内传递 `task_id/task_type`。
  - worker 收到消息后按 `task_id` 调用 `ClaimTaskByID()`，只 claim 该条 `status=pending` 的任务，避免共享 DB 时其它开发者 worker 扫走任务。
  - `task_queue.driver=kafka`、`topic`、`brokers`、`consumer_group` 是预留配置；adapter 未实现前配置为 kafka 必须启动失败，不能静默退回 DB polling。
  - 独立 `cmd/worker` 暂时保留，但在 `memory` driver 下无法消费 server 进程内发布的任务；本地/当前 Docker 单入口默认使用 server 内嵌 worker。
  - `food_expiry_notification_jobs` 仍是定时通知 job 的 DB 扫描链路；它和分析算法任务分发是不同问题，后续可单独迁移到 broker。
  - `memory` queue 不持久化；server 重启后的旧 pending/replay 需要后续真实 broker 或带 instance ownership 的显式恢复设计。

- `2026-05-11`: Go 后端食物拍照分析仍是异步 worker 架构，但 server 默认内嵌启动 worker：
  - `/api/analyze/submit` 只创建 `analysis_tasks` pending 任务，不会在 HTTP 请求里同步跑模型。
  - worker 与 server 的通信媒介是数据库表 `analysis_tasks` / `food_expiry_notification_jobs`，不是进程内全局变量，也不是消息队列。
  - worker 通过 `FOR UPDATE SKIP LOCKED` 原子领取 pending 任务；多 worker 同时跑时不会重复消费同一条任务，但会放大并发和模型调用压力。
  - server 内置 worker 由 `config.yaml` 中的 `worker.count` 控制；`count=0` 表示不开启，`count>0` 表示启动对应数量 worker，缺少 `worker.count` 直接报错。
  - 独立 `cmd/worker` 入口保留；显式运行 `npm run dev:worker` 或 `/app/food-link-worker` 时仍可作为独立 worker 消费同一 DB 队列。
  - worker 诊断日志统一走 zap logger；当前 OTel 只配置 trace exporter，不把这些日志直接作为 OTel logs 上报。

- `2026-05-11`: 保质期订阅通知链路的稳定口径：
  - 前端只有在构建时注入 `TARO_APP_EXPIRY_SUBSCRIBE_TEMPLATE_ID` 后，才会调用 `Taro.requestSubscribeMessage()` 并继续请求后端 `/api/expiry/items/:item_id/subscribe` 创建提醒 job。
  - 后端订阅模板 ID 读取 `wechat_pay.expiry_subscribe_template_id`，可由环境变量 `EXPIRY_SUBSCRIBE_TEMPLATE_ID` 覆盖；微信 access token 使用 `external.appid` / `external.secret`，可由 `APPID` / `SECRET` 覆盖。
  - 通知发送依赖 worker 轮询 `food_expiry_notification_jobs`；当前 server 默认可内嵌 worker，Docker 镜像也保留 `/app/food-link-worker` 独立入口。
  - worker task types 不能覆盖丢 `expiry_notification`，否则通知 job 不会被消费。
  - 到期当天已 due 的 job 不应因为重新计算出 `now + 1min` 被判定为“旧任务作废”；该逻辑已修正。

- `2026-05-11`: 注册后健康档案引导中的作息字段采用轻量枚举 `health_condition.routine_type`，不新增数据库列：
  - 当前选项为 `early_bird`（早睡早起）、`regular`（标准作息）、`night_owl`（晚睡晚起）、`irregular`（不太固定/轮班）。
  - 首次引导问卷在活动水平之后询问该字段。
  - 健康档案查看页在基础信息区展示，并通过底部 radio 编辑器修改。
  - 后端 `PUT /api/user/health-profile` 接收 `routine_type` 后写入 `weapp_user.health_condition`。

- `2026-05-11`: 食物识别前端提交入口需要保留短时间防重复提交保护：
  - 相册/拍照后的分析主按钮使用 300ms 前端防抖，并且进入实际提交流程时要尽早置 `isAnalyzing=true`，避免上传前窗口期重复触发。
  - 结果页纠错抽屉里的「重新智能分析」同样使用 300ms 前端防抖，并在弹确认框前拦截重复点击，避免重复弹窗和重复创建纠错任务。

- `2026-05-11`: 圈子「好友动态」列表缓存只允许在本次小程序启动会话内复用：
  - `App.useLaunch` 会清理上一次启动留下的 `community_feed_cache / community_feed_timestamp / community_feed_cache_session_id_v1`，并生成新的 `community_feed_session_id_v1`。
  - Feed 缓存写入时必须记录当前 session id；读取时 session 不一致就丢弃，避免跨冷启动展示旧动态。
  - `community_feed_filters_v2`、特别关注和好友/申请缓存不属于本条 Feed 列表缓存限制，可继续按各自业务需要保留。
  - 自己从圈子删除/隐藏的动态不应再通过单条 Feed context、点赞、评论等圈子互动入口访问；后端对 `hidden_from_feed=true` 的记录按 `not_found` 处理。

- `2026-05-11`: 圈子「好友动态」加载态已有骨架屏时，不再额外叠加 spinner 动画；触底加载也不显示“正在加载”文字，保持安静占位即可。

- `2026-05-11`: 普通模式食物分析的 DB-first 第一阶段模型 item schema 需要长期保留 `waterMl`：
  - 图片/文字普通分析 prompt 均使用 `items:[{"name":"","estimatedWeightGrams":0,"waterMl":0}]` 作为结构口径。
  - `waterMl` 表示该食物或饮品本身可计入饮水参考的含水量，单位毫升；无法判断时为 `0`。
  - 后端营养库仍只负责热量、蛋白质、碳水、脂肪等营养回算，`waterMl` 从模型识别结果透传并随前端重量/比例展示调整。
  - 前端和保存链路同时兼容 camelCase `waterMl` 与 snake_case `water_ml`，保存记录 item JSON 使用 `water_ml`。

- `2026-05-11`: 食物图片分析模型临时切换口径：由于最近 1-2 天 Ofox/Gemini 视觉链路持续 `429/resource exhausted` 或超时，标准图片识别和精准模式图片子任务默认改用 Doubao `doubao-seed-2-0-lite-260428`。即使前端/任务 payload 仍传历史默认值 `modelName: "gemini"` 或 `gemini-3-flash-preview`，后端也临时路由到 Doubao，避免继续打到 Ofox。Ofox/Gemini 仅保留显式 `modelName: "ofox-gemini"` / `ofox-gemini:<model>` 入口，方便后续上游恢复后切回 Gemini3。worker 仍需归一 timeout/resource exhausted/5xx 等错误为用户可读提示。

- `2026-05-11`: 当前所有默认用户图像识别入口统一走 Doubao `doubao-seed-2-0-lite-260428`：食物标准图片识别、精准模式图片子任务、批量图片分析、保质期拍照识别、健康报告 OCR、运动图片估算。不得在 Doubao 缺失/失败时隐式 fallback 到 Ofox/Gemini，避免上游限流期偷偷绕回旧链路；Ofox/Gemini 仅作为显式 `ofox-gemini` escape hatch、compare/test-backend 工具或 Ofox client 单元测试保留。

- `2026-05-11`: 切 Doubao 只是临时默认通道切换，不得删除原 Gemini/Ofox 通道。必须保留显式 `ofox-gemini` / `ofox-gemini:<model>` 入口、Ofox client、compare/test-backend 能力和后续切回 Gemini3 所需代码；后续清理或重构时只能调整默认路由，不能把 Gemini 通道整体移除。

- `2026-05-11`: 运行时外部 API key（Doubao/Ofox/DeepSeek 等）从 env/ConfigMap/YAML 读入后必须 trim 首尾空白。生产 `DOUBAO_API_KEY` 若来自 `.env`/ConfigMap，`KEY= value` 这类前导空格会成为真实 key 内容并导致 Doubao `401 Incorrect API key`；代码侧要防御，但部署侧仍应保证 ConfigMap 中的值没有多余空格或错误 key。

- `2026-05-11`: Go 后端配置优先级对外部模型 key 做项目内收口：只要运行目录存在 `config.yaml`，`external.doubao_api_key` / `external.ofoxai_api_key` / `external.deepseek_api_key` 以 YAML 文件值为准，不允许 Windows/User/system 环境变量里的同名 key 偷偷覆盖本地配置。生产 scratch 镜像不包含 `config.yaml`，因此线上仍通过 ConfigMap/env 注入。

- `2026-05-11`: 体重记录允许同一天多次录入时，所有“每日体重 summary / 最新体重 / 体重趋势”展示口径必须统一为“当天最后一次记录”。`user_weight_records` 可保留多条原始记录，`/api/body-metrics/summary` 的按日聚合不得取当天第一条，否则同一用户会在不同位置看到旧值和新值混杂。例如「饭饭」在 `2026-05-09` 依次记录 `47.5kg`、`47.5kg`、`47.4kg`，最新体重应展示 `47.4kg`。

- `2026-05-11`: 圈子「本周打卡排行榜」的统计窗口必须对齐 `dev` 旧后端口径：北京时间自然周，周一 00:00 至下周一 00:00（不含）。Go 代码中不得用 `Time.Truncate(24 * time.Hour)` 计算北京时间自然日/自然周边界，因为 `Truncate` 按绝对 UTC duration 截断，会把北京时间边界偏到 08:00。稳定口径是用 `time.Date(year, month, day, 0, 0, 0, 0, chinaTZ)` 先构造北京时间当天零点，再按 weekday 回退到周一。

- `2026-05-11`: 圈子 feed 的 `record_time` 展示应按中国时间口径稳定输出与格式化。后端返回动态时应把 `record_time` 显式转为 `Asia/Shanghai` 偏移；前端格式化不能依赖设备默认 `toLocaleDateString()`，超过相对时间窗口后要按北京时间格式化，且兼容没有时区后缀的旧 ISO 字符串。

- `2026-05-10`: 保质期拍照识别接口 `/api/expiry/recognize` 的错误口径必须区分用户可处理错误、模型上游错误和后端配置错误，不能让裸 `fmt.Errorf` 穿透到统一响应层后被抹成 `internal server error`：
  - 缺图、图片里没有识别到可用于保质期录入的食物 → 400，返回可读提示。
  - 模型上游非 2xx、空响应、返回非 JSON 或结果 JSON 解析失败 → 502，返回“保质期识别服务暂时不可用，请稍后再试”，同时在后端日志记录上游细节。
  - 模型 key/base URL 等后端配置缺失或错误 → 明确 500 AppError，不要给前端泛化成无信息的 internal server error。
  - 保质期页涉及 `Taro.showLoading` 时必须本地显式配对，失败路径不能多次 `hideLoading`。
  - 保质期页写入 `USER_DATA_PATH` 的 `expiry_` 临时文件遇到 quota 错误时，应复用 `cleanupGeneratedUserFiles()` 清理项目生成文件后再重试。

- `2026-05-10`: 当用户反馈“小程序非调试模式报错、调试模式正常”时，排查优先级不能只盯接口域名；要先排除前端同步运行时异常与生产包残留调用。当前已确认一个真实案例：
  - `src/pages/profile/index.tsx` 退出登录回调里残留 `setRegisterDate('--')`
  - 该 state 已不存在，正式运行到这条链路会直接抛 `ReferenceError`
  - 这类错误在真机上可能表现为“只要走到某操作就连续报错”，应优先通过堆栈定位到具体页面回调并消除残留引用

- `2026-05-10`: 首页补录提示的稳定口径：
  - 首页出现的补录提示不是后端“补录中”任务状态，也不依赖任何接口字段
  - 它仅由前端当前 `selectedDate` 计算：当日期属于最近 3 天可补录窗口且不是今天时显示
  - 因为这是页面上下文提示而不是异步处理中状态，文案应避免使用“正在补录”这类会暗示自动消失的措辞；当前收口为“当前补录日期 {date}”

- `2026-05-10`: 首页「编辑今日目标」里总卡路里带动三大营养素联动时，缩放基准必须是“本轮编辑最后一份稳定有效的宏量目标”，不能用每次联动后已经被舍入的临时值继续做下一次缩放，否则用户清空后逐字重输时比例会漂移并把部分目标压到 0。

- `2026-05-10`: 首页「编辑今日目标」弹窗的稳定交互口径：
  - 输入框在前端层先做字符清洗，只允许数字和单个小数点；空字符串仅作为用户编辑中的临时态存在，不能把其他字符写进目标表单
  - 所有目标步进和联动展示统一按 1 位小数舍入，避免 `98.00000000003` 这类浮点长尾直接暴露到 UI
  - 当用户修改总卡路里目标时，蛋白质/碳水/脂肪应始终按比例联动；即使热量输入框刚被清空后再输入/再点加减，也必须从可用的目标基准恢复联动，不能退化成只更新单个字段

- `2026-05-10`: 结果页“实际摄入”滑杆的当前收口口径：
  - 以较早版本的简洁 slider 观感为基底，不再继续做复杂轨道壳造型
  - 保留外层圆角矩形框
  - 外框底色与“估算重量”控件容器保持一致
  - 可用性优化仅通过放大滑块、增厚轨道、增大热区来完成

- `2026-05-10`: 结果页食物卡片的视觉收口规则：
  - 单个食物卡片应保持统一底色和同一张“卡片表面”感觉，不要把标题区、营养区、控制区切成明显不同底板
  - 营养摘要小卡虽参考首页日期胶囊语言，但圆角不能过度夸张；当前稳定口径是中等圆角、竖向胶囊感，而不是 `999rpx` 的鼓包形态
  - “实际摄入”滑杆优先贴近参考图里的浅色内嵌轨道，视觉上应先像卡内轨道控件，再考虑装饰性

- `2026-05-10`: 结果页里每个食物卡片的营养摘要区，稳定视觉口径不是普通四格方卡，而是更接近首页日期选择器的竖向胶囊卡。单块内容顺序固定为“图标 -> 标签 -> 数据”；其中图标与容器可升级视觉层次，但数值字号、颜色和单位风格尽量保持当前读数习惯不变。

- `2026-05-10`: 分析结果页“实际摄入”滑杆的稳定交互口径：
  - 视觉上使用内嵌式胶囊轨道，而不是裸露的细线滑杆
  - 触控热区要明显大于视觉轨道本身，优先通过额外包裹层和更大的滑块提升拖拽命中率
  - 拖动过程中应实时更新热量、重量和营养展示，不能只在松手后刷新
  - 步进以细粒度为主，当前口径为 `step=1`

- `2026-05-10`: 分析结果页里「实际摄入」滑杆调节的是 `ratio/intake`，不是直接改整份 `weight`。稳定展示口径是：
  - 保存/落库仍保留 `weight + ratio` 双字段，避免影响后续记录详情和营养换算
  - 但结果页食物卡片中的重量数字要跟当前 `intake` 同步展示，保证用户拖动滑杆后看到的热量和重量口径一致

- `2026-05-10`: 用户明确要求相册/拍照隐私开关这一块“暂时不允许改”。稳定口径：不要重新加入 `__usePrivacyCheck__`，不要把 `scope.camera` / `scope.writePhotosAlbum` 写回 `app.config.ts/app.json`，不要把 `chooseImage` / `getImageInfo` 写进 `requiredPrivateInfos`。除非用户后续明确解除该限制，否则该区域只能做不改变上述口径的旁路修复。

- `2026-05-10`: 小程序 `app.config.ts` 的 `requiredPrivateInfos` 只能声明微信当前允许的定位/地址类隐私接口；当前稳定值只保留 `getLocation`。不要把 `chooseImage`、`getImageInfo` 写进 `requiredPrivateInfos`，否则微信开发者工具 3.15.2 会直接编译失败。若出现 `chooseImage:fail api scope is not declared in the privacy agreement (errno:112)`，解决点是微信小程序后台“用户隐私保护指引”中声明选图/拍照相关信息类型，而不是改 `app.json` 的 `requiredPrivateInfos`。

- `2026-05-10`: 小程序隐私授权的代码侧稳定口径是全局挂载 `PrivacyAuthorizationModal`，监听 `wx.onNeedPrivacyAuthorization`，用官方 `agreePrivacyAuthorization` 按钮完成用户同意，并用 `openPrivacyContract` 打开隐私指引。该代码只能处理“后台隐私指引已声明且已生效，但用户尚未同意”的情况；如果后台隐私指引处于 `审核中` 或没有声明相册/拍照用途，`chooseImage` 仍会被微信基础库直接拦截。

- `2026-05-10`: 小程序所有相册/拍照入口不得直接调用 `Taro.chooseImage`。稳定口径是统一调用 `chooseImageWithPrivacy()`，并在 `api scope is not declared in the privacy agreement` 或用户未同意隐私授权时走 `showPrivacyAuthorizeFailure()`，避免用户只看到笼统的“选择图片失败/上传失败”。新增选图入口时必须复用 `src/utils/weapp-privacy.ts`。

- `2026-05-10`: 首页记录菜单的会员额度预检不能无限阻塞相册/相机拉起。稳定口径是预检最多等待约 1.2 秒；超时或接口失败时先允许用户选图，最终积分/额度由分析提交接口兜底校验。`chooseImageWithPrivacy()` 在拉起选图前应先清理项目生成的 USER_DATA_PATH 文件，遇到文件配额类错误再清理并重试一次。

- `2026-05-10`: 小程序 `permission` 配置只保留微信仍支持的合法权限说明。当前稳定值只包含 `scope.userLocation`；不要再写 `scope.camera` 或 `scope.writePhotosAlbum` 到 `app.config.ts/app.json`，否则微信开发者工具 3.15.2 会提示 invalid permission。相机/相册用途应通过微信后台隐私保护指引声明，代码侧通过 `chooseImageWithPrivacy()` 和隐私授权弹窗兜底。

- `2026-05-10`: `__usePrivacyCheck__` 暂不写入 `app.config.ts/app.json`，development 和 production 都不主动开启。原因是当前优先级是保证拍照/相册流程可用；该字段会在微信后台隐私指引不稳定时把 `chooseImage` 变成硬拦截并报 `errno:112`。这不代表可以无视微信审核和未来运行时规则；发布前仍应在微信后台隐私保护指引中声明相册/拍照用途。若未来后台隐私指引已审核通过且需要主动压测隐私合规，再单独恢复该字段。

- `2026-05-10`: `about` 页主业务入口稳定路由仍是独立分包 `packageAbout/pages/about/index`，但 `packageExtra/pages/about/index` 需要保留为轻量兼容页。原因是微信开发者工具、旧本地缓存、旧 redirect 或历史页面栈可能仍尝试编译/打开 `/packageExtra/pages/about/index`；如果该路径没有 WXML 产物，会触发 `ENOENT dist/packageExtra/pages/about/index.wxml` 并导致登录/导航超时。该兼容页必须继续保持轻量，不得重新 import 本地大图。

- `2026-05-10`: 小程序 `USER_DATA_PATH` 中由项目生成的临时持久文件需要可清理，至少包括 `analyze_`、`expiry_`、`cv_` 前缀。普通 `removeStorageSync` 不会清除文件系统配额；登录前和“我的 -> 清除缓存”应清理这些生成文件，canvas/base64 写文件遇到 quota 类错误时应先清理再重试一次。

- `2026-05-10`: 微信小程序非 Tab 页不再默认全部塞进单一 `packageExtra` 分包。对明显偏重的页面采用“顶层独立分包 + `extraPkgUrl()` 路由映射”的稳定口径，当前已单独拆出：
  - `packageAbout/pages/about/index`
  - `packageUserGroup/pages/user-group/index`
  - `packageStatsMetabolic/pages/stats-metabolic/index`
  这样可以在不改业务调用口径的前提下控制单分包体积，避免真机调试/预览触发微信包体限制；旧的 `/packageExtra/pages/...` 回跳地址也要继续兼容映射到新分包路径。

- `2026-05-10`: `about` 页 logo 不再 import 本地大图 `src/assets/logo.png`。该资源会被直接打进页面 JS，显著放大编译产物；稳定口径是优先使用 `__ICON_CDN_BASE_URL__`，缺省回退 `https://cdn-food-icon.coachlink.fit/shitan-nobackground.png`。

- `2026-05-10`: `识别记录` 列表中的状态标签（如 `已经记录`、`等待记录`）稳定口径是单行胶囊，不允许在圆角矩形内部换行。样式上应优先通过 `white-space: nowrap`、更宽的横向内边距、适度最小宽度和轻微高光/阴影来保证可读性，而不是依赖更小字体硬塞进去。

- `2026-05-10`: 后端 Docker 构建基础镜像不要使用浮动主版本别名 `golang:1.26-bookworm`。当前稳定口径是固定到 patch tag `docker.io/library/golang:1.26.1-bookworm`，以减少 Docker Hub 别名元数据漂移或损坏导致的 `buildx` 拉取失败；项目代码与本机工具链仍保持 `go 1.26 / go1.26.1`，不因为这类镜像别名问题而回退语言版本。国内网络下如 Docker Hub 不可达，可通过 `DOCKER_GO_BUILDER_IMAGE` 临时覆盖 builder 基础镜像，但默认口径仍保留官方镜像。

- `2026-05-10`: 小程序本地临时图片路径（如 `wxfile://tmp/...`、`http://tmp/...`）不是可持久化的后端图片引用，不能进入 `analysis_tasks` / `user_food_records` / `public_food_library` 的稳定图片字段，也不能作为圈子/公共库展示源。稳定口径是：
  - 分析页可在前端本地缓存临时路径，仅用于当前会话预览
  - 一旦进入保存记录、分享到公共库或任何后端持久化链路，必须改用已上传后的 CDN/COS URL，或完全依赖 `source_task_id` 回填
  - 后端图片归一化逻辑也应过滤这类本地临时 scheme，避免脏数据再次落库

- `2026-05-09`: 首页「今日餐食 -> 生成分享海报」的稳定交互口径是不再停留在项目自定义的全屏海报预览层。首页只保留隐藏 canvas 用于生成图片；生成成功后立即拉起微信官方图片菜单 `showShareImageMenu`。如本地缺少相册权限，则先通过官方小程序权限接口 `getSetting / authorize / openSetting` 请求或引导开启，再交由微信官方菜单提供发送/保存能力。

- `2026-05-09`: 微信原生图片菜单 `showShareImageMenu` 的 `fail cancel` 属于用户主动关闭菜单，不应当作业务失败提示。稳定口径是：真正拉起失败才提示错误；若当前页面已没有自定义预览层（如首页餐食海报直拉官方菜单），取消时可静默关闭当前分享流程；若当前页面仍停留在自定义预览层，则取消时保持页面原状且不报错。

- `2026-05-09`: Go 精准模式的分组估重要真正并行执行，不能让 `grouped_parallel` 在本地 worker 默认配置下退化成串行。worker 默认并发和本地配置口径为 `max_concurrent=4`。当前用户要求先不要二次重量复核，因此精准模式默认 `precisionRefineEnabled=false`，只做 planner -> 分项首轮估重 -> db_first 回算 -> aggregate；复核代码可以保留但默认关闭。所有精准子项估计结果都必须按本组 `items_to_estimate` 过滤，不能因为模型输出整餐而扩项或重复累计。

- `2026-05-09`: 精准模式的优先级必须是“先判准食物种类，再估重量”。planner 不能只直接输出单个 `item_name`；对每个主体应先列 2-3 个候选食物，并记录 `candidate_names / alternative_name / visual_evidence` 等内部字段，再基于视觉证据选择主名称。子项估重阶段必须接收这些候选和证据；若 planner 名称与视觉证据冲突，允许把最终 `name` 修正为更可能的候选。典型易混淆项包括莴苣/莴笋片 vs 青菜/小白菜，百叶包/千张包/豆皮包 vs 蒸饺/馄饨，鱼块 vs 鸡块，豆干 vs 肉块。这些候选和证据属于内部识别辅助，不展示到用户结果页。

- `2026-05-09`: `precision_sessions.status` 必须严格使用数据库 check constraint 允许值：`collecting / estimating / needs_user_input / needs_retake / done / cancelled / failed`。精准模式纠错完成时也写 `done`，不得写 `completed`；前端结果字段 `precisionStatus` 同步使用 `done`。

- `2026-05-09`: `识别记录` 列表不应把同一次食物识别的多轮纠错/重识别展示成多条并列记录。稳定口径：纠错任务在 `analysis_tasks.payload` 中记录 `correction_source_task_id` 与 `correction_root_task_id`；列表、总数和等待记录角标按 root 折叠，只展示最新版本。为兼容已经产生的旧任务，如果没有 root 字段，则同一天同一图片或同一文字输入也按同一组折叠为最新一条。该口径不改数据库 schema，只复用已有 JSON payload。

- `2026-05-09`: 体重、喝水、运动的完整趋势统计不继续塞进底部「分析」页。稳定信息架构是：首页作为日常身体状态与行为数据入口，体重/喝水/运动卡点击进入统一分包页 `body-trends`；分析页保持「健康指数 / 饮食相关风险趋势」主叙事，只在需要时引用身体数据摘要或证据，不承载完整录入型统计。该方向第一版只复用已有 `body-metrics` 与 `exercise-logs` 接口，不改数据库 schema。

- `2026-05-09`: 体重趋势页的记录列表必须按“每次记录都显示相对上一条体重的变化量”来呈现。正向增加用红色、下降用绿色；列表可按月分组，并展示月总变化与日均变化，帮助用户快速扫出体重波动方向。

- `2026-05-09`: 食物分析二次纠错必须做 AI 二次分析，不能把前端结构化纠错清单直接当最终结果回算。稳定口径对齐 `dev` Python：任务 payload 携带 `additionalContext / previousResult / correctionItems`；prompt 中明确上一轮餐食描述、上一轮识别结果、用户纠错说明和结构化清单；AI 重新输出名称和重量；后端再走 db_first 营养库回算。精准模式纠错不进入 precision planner/item_estimate/aggregate，而是和普通纠错一样走单次 AI 二次分析，避免扩项和重复累计。

- `2026-05-09`: 首页/我的页「识别记录」角标的稳定口径是“最近 24 小时内已识别完成但未保存为饮食记录的任务数”，不是历史所有未保存任务总数。历史识别记录仍保留在列表和总数里，但不再持续累加到角标；`has_unseen_waiting_record` 也只在最近 24 小时窗口内判断未读。

- `2026-05-09`: 公共食物库允许上传者删除/下架自己上传的条目。实现口径为软下架，不改数据库结构：复用 `public_food_library.status`，用户主动删除写为 `user_deleted`；公共列表/收藏列表不可见，详情读取把 `user_deleted/deleted` 当作 not found，`mine` 列表也排除删除状态。后端必须校验 `item.user_id == 当前登录用户`，非上传者不得删除。过渡期不为此能力新增表、字段、索引或约束。

- `2026-05-09`: 当天饮食记录页删除单个食物时，稳定口径是复用已有饮食记录更新接口 `PUT /api/food-record/:id`，提交删减后的 `items` 与重新汇总的 `total_calories/total_protein/total_carbs/total_fat/total_weight_grams`；不为“记录内单个食物删除”新增表字段或 schema。若一条记录只剩最后一个食物，删除该食物等价于删除整条饮食记录，并在确认文案中明确提示。

- `2026-05-09`: Go 后端使用 `Updates(map[string]any)` 更新 `serializer:json` / JSONB 字段时，不能直接把 slice/map（如 `user_food_records.items`、`image_paths`）放进 map 里依赖 GORM serializer。repo 层应先显式 `json.Marshal` 并写入 `datatypes.JSON`，避免 PostgreSQL JSONB 更新 500。该口径已应用到 `FoodRecordRepo.Update()` 的 `items` / `image_paths`。

- `2026-05-09`: 食物分析二次纠错前端不得再跳转到 `analyze-loading` 走完整长任务页面。后端纠错轻链路完成很快，结果页应在当前页面轮询纠错 task，拿到 `done + result` 后直接刷新当前页面状态和 `analyzeResult/analyzeSourceTaskId` 缓存；否则 loading 页重定向和旧缓存/旧导航栈会让用户看到“提交成功但又退回原结果且无改动”。

- `2026-05-09`: 食物分析二次纠错不再重新走完整识别链路。普通模式和精准模式纠错统一采用“用户结构化纠错清单 -> db_first 营养库回算 -> 完成任务”的轻链路；只要请求带 `correctionItems`，worker 就不得重新识图、不得重新跑精准 planner/item_estimate/refine/aggregate。精准纠错可以更新 precision session 的 final_result/status，但不能再因为重新 planner 把 5 个食物扩成 7-8 个。若纠错项营养库未命中且 DeepSeek fallback 不可用，应保留纠错提交时页面已有的 calories/protein/carbs/fat 作为 `user_correction_fallback`，避免热量显示为 0。

- `2026-05-09`: 会员升级/切换套餐的当前稳定口径：采用“改签当前会员期 + 剩余价值补差”模型，不是新卡叠加。当前连续会员期的起算日不变；目标套餐周期从该起算日开始计算；用户只补“目标套餐从今天到目标到期日的剩余价值 - 当前套餐从今天到当前到期日的剩余价值”。支付成功后立即切换到新档位权益，当日积分额度即时按新档位生效，已消耗积分继续计入当天用量。若所选套餐会缩短当前有效期，或当前套餐剩余价值已覆盖所选套餐，则不允许即时切换，提示选择更高档位/更长周期或到期后再购买。

- `2026-05-09`: 会员套餐优惠展示必须按真实差价展示，不得把 `4.8` 取整宣传成 `5`、把 `59.8` 取整宣传成 `60`。购买页的“立省”金额应保留必要小数并去掉多余 0。

- `2026-05-09`: Python/Supabase -> Go/PostgreSQL 过渡期的开发规则：
  - 可直接转述的短口径：当前项目处在 Python/Supabase 旧线上版本 -> Go/PostgreSQL 新版本 的过渡期。正式切流前，Supabase 仍是生产数据和 schema 真源。现有 `migrate_supabase_db_to_postgres.py` 是破坏式全量同步：会让目标 PostgreSQL 与 Supabase 完全一致，因此只在 PostgreSQL 手工新增的表/字段，最终同步时可能被覆盖。
  - 不涉及数据库结构的改动（Go 业务逻辑、前端、接口适配、文案、样式、bug fix）可以正常在 Go 重构分支推进。
  - 涉及数据库结构的改动不能只手工改本地/服务器 PostgreSQL；当前 `backend/scripts/migrate_supabase_db_to_postgres.py` 会 drop/recreate 目标 schema，并让目标库与 Supabase 源库完全一致，PostgreSQL-only 字段/表会在最终全量同步时被覆盖。
  - 切流前真实生产 schema 仍以 Supabase/Python 侧为准。新增字段/表如果需要随最终同步保留，要么先作为向后兼容 migration 应用到 Supabase 生产源库，要么在最终全量同步之后、Go 正式启动之前作为正式 Go SQL migration 应用到目标 PostgreSQL。
  - 体验版/本地 Go 写入 PostgreSQL 的数据默认视为测试数据；如果必须保留为真实用户数据，最终切流不能只做 Supabase 覆盖 PostgreSQL，必须额外做 PostgreSQL delta/upsert 合并。

- `2026-05-09`: 首页 dashboard 的 `expirySummary` 必须保持 Python 旧版前端契约：`pendingCount / soonCount / overdueCount / items[]`，其中 item 至少包含 `food_name / quantity_text / storage_location / note / days_left / deadline_label / urgency_level`。Go 后端不得只返回内部字段 `count/name/urgency`，否则首页保质期卡片会出现标题和 meta 为空。保质期条目当前不显示图片，也不新增 `food_expiry_items.image_url`；旧 Python/Supabase 口径本来没有为保质期条目持久化图片。

- `2026-05-09`: Go 重构分支的积分体系当前目标是先严格对齐 `dev` / Python 旧版逻辑，不在本轮顺手修正旧版自身设计问题。对齐口径包括：食物标准分析 2 分、精准分析 4 分、运动记录 1 分；系统积分按中国自然日计算；补录优先消耗目标日系统积分，再消耗今日系统积分，最后消耗 earned credits；任务/识别成功创建后才扣 earned credits；邀请奖励也必须保留旧版“新用户 7 天内 2 个不同自然日有效使用后双方各得 15 earned credits”的闭环。

- `2026-05-09`: 海报分享奖励不能在“生成海报图片”时发放，只能在用户触发微信图片分享并进入 `showShareImageMenu` 成功回调后调用 `/api/membership/rewards/share-poster/claim`。保存图片、打开海报预览、自动生成海报都不应领取 1 积分；后端仍保持幂等和每日上限校验。

- `2026-05-09`: Go 精准模式必须对齐 Python 当前正在使用的实际流程。稳定口径是：`precision_plan` 使用专用 planner prompt 拆主体并规范化 `itemsToEstimate/splitStrategy`；`precision_item_estimate` 使用专用单项/多项估重 prompt，只解析 `item/items` 的 `name + estimatedWeightGrams`，再挂 planner metadata；随后按 Python 条件触发二次重量复核，触发条件为 `uncertainty_level=high`、`requires_reference=true`、或食物名包含米饭/炒饭/面/粥/红烧肉等易错关键词，复核使用 `temperature=0.1`，失败只记录日志并沿用首次估重；最后走 db_first 营养库回算；`precision_aggregate` 按 `item_index` 聚合子项结果；planner/item estimate 精准 JSON completion 使用多图输入、固定 `temperature=0.2`，图片/文字超时分别为 `90s/60s`。不能再用通用 `Analyze/AnalyzeText` 作为精准子任务主算法，否则会重新识别整餐并造成重复累加。

- `2026-05-09`: 精准模式结果页不得展示内部流程/工程诊断文案。`insight/context_advice` 不能包含“分组精估、估重不确定性、建议补充参考物、数据库命中、AI补全、AI估算非数据库标准值”等内容；这些只允许出现在 worker/server 终端日志或内部调试字段。用户可见结果只展示饮食分析、食物明细、热量和营养构成。

- `2026-05-09`: 精准模式主食估重必须以实际可见体积为准，不能套“常见一碗饭”默认值，也不能把“薄薄一层”直接映射成固定低克重区间。米饭/面条/粉/粥/炒饭/盖饭类必须先判断容器口径、深度、填充比例、可见面积、平均厚度、被菜覆盖程度和松散度，再用体积密度换算重量；薄层但面积很大时重量仍可能不低，小面积薄层才应低。该规则必须同时进入一次估重和二次重量复核 prompt。

- `2026-05-09`: 普通拍照识别和精准拍照识别都不再使用 Doubao 作为默认或别名路由。未指定模型时统一走 Ofox/Gemini `gemini-3-flash-preview`；即使请求里显式传入 `doubao`、`doubao` 或 `doubao-seed-2-0-lite-260428`，普通/精准识别也要强制归到 Gemini，避免旧前端参数或缓存绕回 Doubao/Doubao。Doubao 仅可保留在模型对比/测试入口中；文字输入模式仍按单独决策默认 DeepSeek `deepseek-v4-flash`。

- `2026-05-09`: 数据分析页「AI 风险解读」遵循缓存优先 + 用户主动刷新口径：打开统计页只读 `ai_stats_insights` 缓存并根据 `analysis_summary_needs_refresh` 提示是否过期；仅在过期时于详情弹窗状态条显示「手动更新」，点击后调用 `/api/stats/insight/generate` 重新生成，再 `save` 入缓存。Go stats insight 生成模型固定为 `deepseek-v4-flash`，不再通过 YAML/env 切换模型名。

- `2026-05-09`: Go 精准模式写入 `precision_sessions / precision_session_rounds / precision_item_estimates` 时，repo 层必须显式补齐非空 JSONB 默认值和时间戳，不能依赖 GORM 对 nil map/slice/*time.Time 与 PostgreSQL DEFAULT 的交互。`pending_requirements/reference_objects/input_payload/payload` 无内容时写空数组或空对象，`created_at/updated_at` 无值时由 repo 设为当前时间，避免精准模式提交在数据库 NOT NULL 约束处返回 500。

- `2026-05-09`: Go 精准模式更新 `precision_sessions` 或 `precision_item_estimates` 的 JSONB 字段时，不能直接把 `[]any{}` / `map[string]any{}` 放进 `Updates(map[string]any)` 依赖 GORM serializer；必须先显式 `json.Marshal` 并以 `datatypes.JSON` 写入。尤其 `pending_requirements`、`reference_objects` 这类 NOT NULL JSONB 空数组字段，更新时也必须落库为 `[]`，不能变成 SQL NULL。

- `2026-05-09`: Go 精准模式的 `precision_item_estimate` 子任务如果继续复用通用食物识别模型，必须在 worker 层按 `items_to_estimate` 做结果过滤，不能把模型返回的整图所有食物直接交给 aggregate。否则多个子任务会各自输出完整餐盘，最终聚合重复计入同一份米饭/菜品。长期 parity 方向是迁回 Python 版专用子项估计 prompt；短期保护栏是按计划项名称 exact/contains/相似度匹配后只保留本组食物。

- `2026-05-09`: 不能再声称当前 Go 精准模式与 Python 版算法 1:1。当前 Go 版只具备任务形态 parity（plan/item_estimate/aggregate）和重复过滤保护；Python 版还有专用 planner prompt、专用单项/多项估重 prompt、结构化 `item/items` 解析、重量复核 `_maybe_refine_precision_weights_sync`、previous rounds/session latest_inputs 参与规划等语义。真正 parity 需要继续迁移这些专用逻辑。

- `2026-05-09`: 食物文字输入模式默认使用 DeepSeek 文本模型，不再默认走 Doubao/Doubao。原因是文字输入不需要视觉模型，而当前 Doubao key 配置错误会导致 `doubao api error 401`；未指定 `modelName` 时应走 `external.deepseek_api_key`，base URL 固定为 `https://api.deepseek.com`，模型固定为 `deepseek-v4-flash`。如果 DeepSeek key 缺失，后端应返回明确的 `DEEPSEEK_API_KEY` 配置错误，而不是静默回退到 Doubao。图片/拍照分析仍按现有视觉模型 + `db_first` 营养库回算链路执行。

- `2026-05-09`: Go 后端本地开发配置统一从 `backend/config.yaml` 读取，不再自动读取 `backend/.env`。DeepSeek 在 YAML 中只配置 `external.deepseek_api_key`；base URL 固定为 `https://api.deepseek.com`，文字模型固定为 `deepseek-v4-flash`，不再额外暴露 `deepseek_base_url` 或 `deepseek_text_model` 配置项。

- `2026-05-09`: Go 重构版本必须保留 Python 旧版的补录日期口径：记录相关入口只允许近 3 天，即今天、昨天、前天。前端用 `src/utils/record-date.ts` 的 `RECORD_BACKFILL_WINDOW_DAYS = 3` 约束入口日期，后端用 `backend/internal/common/dateutil.ResolveRecordedOnDate` 做最终校验；食物记录保存必须通过 `BuildRecordTime` 把目标中国自然日写入 `user_food_records.record_time`，不能默默落到当天。

- `2026-05-09`: 首页选中昨天或前天时必须显示补录上下文提示，稳定文案为 `正在补录 X月X日`。该提示不是装饰文案，而是防止用户误以为正在记录今天；仅在 `isAllowedRecordDate(selectedDate) && !isTodayRecordDate(selectedDate)` 时显示，未来日期和窗口外日期不能显示补录提示。

- `2026-05-09`: 运动记录的 `user_exercise_logs.recorded_on` 按 PostgreSQL `date` 字段处理，详情列表、当日运动消耗和首页 dashboard 必须使用同一日期口径。查询单日总量用 `recorded_on = YYYY-MM-DD`；查询日期范围用 `recorded_on >= start_date AND recorded_on <= end_date`。不要再把该字段当 `timestamptz` 做中国时区 UTC 窗口查询，否则会出现首页有 kcal、详情列表为空的矛盾。

- `2026-05-09`: Go 后端识别记录接口必须保持 Python 版业务口径：
  - `GET /api/analyze/tasks` 默认只返回食物识别历史相关任务，排除运动、健康报告、公共食物库审核、保质期识别和精准模式内部子任务。
  - 完成任务必须通过 `user_food_records.source_task_id` 补齐 `is_recorded` 与 `record_id`，前端据此显示“已经记录/等待记录”并跳转已保存记录详情。
  - `GET /api/analyze/tasks/status-count` 返回业务状态 `recognizing / waiting_record / recorded / has_unseen_waiting_record`，不是数据库原始状态分组。
  - 精准模式最终展示与保存应以 `precision_aggregate` 为准；完成后带 `redirectTaskId` 的 `precision_plan` 不应作为一条可点击历史结果展示。
  - `precision_aggregate` 任务必须继承原始 `source_type / image_url / image_paths / text` 上下文，否则历史页点开会缺少图片或文字输入。
  - 用户查看识别记录的已读时间字段与 Python 生产 schema 对齐为 `weapp_user.last_seen_analyze_history_at`。

- `2026-05-09`: Go `analysis_tasks` 对外 JSON 契约必须保持 Python/前端使用的 snake_case 字段（`id/status/result/error_message/task_type` 等），不能让 Gin 默认输出 Go 结构体字段名（`ID/Status/Result`）。否则前端轮询会读不到任务完成状态，表现为异步任务一直“分析中”直到超时。

- `2026-05-09`: 运动记录迁移必须保留 Python 旧版的文字与图片双入口：`POST /api/exercise-logs` 允许 `exercise_desc` 或 `image_url` 任一存在；worker 应同时读取 `text_input/payload.exercise_desc` 和 `image_url`；列表响应必须提供 `recorded_at`，前端需对旧数据时间字段做兜底，避免 `NaN:NaN`。

- `2026-05-09`: 运动记录页的前端状态必须按记录日期隔离。服务端记录、pending/failed 本地卡片、统计卡次数与热量都只能展示当前 `recordDate`；日期切换后请求必须显式传入目标日期，不能依赖刚 `setState` 后的旧闭包状态。

- `2026-05-09`: Go 后端调用腾讯云 COS SDK 上传对象时必须传入非 nil `context.Context`。当前 SDK 在 header option 处理里会调用 `ctx.Value(...)`，传 `nil` 会导致 `POST /api/upload-analyze-image-file` 等上传链路 panic；storage 基础设施层统一使用 `context.Background()` 作为当前兼容口径，后续如需请求取消语义，可再把 request context 从 handler/service 逐层传入 storage。

- `2026-05-09`: 小程序 `Taro.uploadFile` 返回的 `response.data` 在微信端通常是 JSON 字符串；Go 后端标准响应为 `{code,message,data}` 信封。前端文件上传解析必须先 JSON parse，再兼容解包 `data`，不能只从顶层读取业务字段。拍照分析、保质期识别、运动图片上传等复用 `uploadAnalyzeImageFile` 的入口都遵守这个口径。

- `2026-05-09`: Go 后端 Ofox / Gemini 兼容 API 默认 base URL 固定为 `https://api.ofox.ai/v1`，并允许通过 `external.ofoxai_base_url`、`OFOXAI_BASE_URL` 或 `OFOX_BASE_URL` 覆盖。不要再写死 `https://ofoxai.com/v1`，该域名会返回官网 HTML，导致食物识别任务失败或页面展示乱码。所有 worker 落库错误必须清洗 HTML/超长上游响应，不能把外部网页原文返回给小程序。

- `2026-05-09`: `db_first` 数据库命中率属于开发/测试诊断信息，不展示在小程序结果页给用户看。Go 后端应把命中统计输出到 server/worker 终端日志，字段包括总项数、命中数、未命中数、命中率、每个 item 的匹配食物名、匹配状态、匹配分数和营养来源。

- `2026-05-09`: 智能饮食推荐第一版采用“即时生成、不落库、不改 schema”的保守口径，适配 Python/Supabase -> Go/PostgreSQL 过渡期。前端把当天剩余热量、三大营养素缺口、目标、已吃餐次摘要和场景（`eat_out` / `cook_home`）传给 Go 后端；Go 后端用 DeepSeek `deepseek-v4-flash` 生成结构化 JSON，失败或缺少 `DEEPSEEK_API_KEY` 时返回规则兜底推荐。后续若要引入推荐历史、用户口味画像、外食商家库或收藏替换项，涉及新增表/字段时必须先写正式 migration，并明确 Supabase 源库与最终 PostgreSQL 的应用顺序。

- `2026-05-09`: 首页「今日餐食」卡片右侧的 `N次` 固定表示该餐次下有 N 条饮食记录，不表示照片数量。照片数量仍只在餐次缩略图角标中用「共 N 张」表达。多记录弹层里的每条 entry 必须展示该记录自己的 `image_path/image_paths`，不能复用餐次级聚合图片。

- `2026-05-09`: 当 `backend-refactor-sync-migrate-tencent` 本地分支同时落后远端又携带旧本地提交时，同步策略以“先 fetch，再 rebase 到远端最新，再只保留仍有独立价值的本地迁移资产”为准：
  - 已被远端更完整实现覆盖的旧本地提交可跳过，不强行保留历史实现形态
  - 迁移脚本、状态文档等独立资产需要在 rebase 后继续保留并推回远端

- `2026-05-09`: 小程序内海报“保存图片/下载图片”的正式口径改为直接使用微信原生图片菜单 `showShareImageMenu`，不再维护项目自己的本地相册保存 helper：
  - 首页餐食海报、首页今日小结海报、记录详情海报、按日记录海报统一使用原生图片菜单
  - 项目不再直接调用 `Taro.saveImageToPhotosAlbum` 作为海报下载主路径
  - `src/utils/weapp-save-image-album.ts` 已删除
  - `scope.writePhotosAlbum` 权限声明也随之移除

- `2026-05-09`: 「我的」页正式口径改为“进入即拉后端最新数据”，不再以本地缓存作为展示优先源：
  - `src/pages/profile/index.tsx` 不再依赖 `userInfo`、`membershipStatus`、`userRegisterTime`、`profile_stats_*` 作为首屏展示缓存
  - 「识别记录」快捷入口不再展示 waiting/unread 红色 badge
  - 与该 badge 相关的 `waiting_record / has_unseen_waiting_record` 前端计数、透传、清零逻辑一并移除

- `2026-05-08`: Go 后端 `v2` 上线前必须执行 `docs/go-backend-prelaunch-checklist-2026-05-08.md`：
  - P0 项是上线阻断项，任何 P0 未完成、证据缺失或结果不确定时，不发布生产流量。
  - P1 项是强建议项，若上线前未完成，必须记录明确风险接受人和补偿措施。
  - 清单执行时每项都要留下负责人、执行时间、结果、证据链接或截图、备注。
  - 敏感配置只核对存在性、格式、来源和指向环境，不把密钥、密码、私钥写入仓库。
  - 当前文档变更不涉及小程序 UI，因此不触发 `weapp-devtools` 验证要求；真正发布体验版/正式版时仍需按清单跑小程序全链路 smoke test。

- `2026-05-08`: Go 测试后台 Phase 6 兼容口径：
  - `/test-backend` 继续服务 Python 旧静态页，不要求静态页一次性改成 Go 新统一响应模型。
  - 测试后台静态 JS 允许在 `authFetch().json()` 层统一解包 Go `{code,message,data}`，并继续向页面逻辑暴露 Python 风格 `{success,data,...}`。
  - `/api/test-backend/analyze`、`/api/test-backend/batch/prepare`、`/api/test-backend/batch/start` 必须兼容 FormData，因为恢复的旧页面直接上传图片/ZIP。
  - Go 版批量测试当前可把批次状态和结果写入 `test_batches.results`，后续如需完全复刻 Python，可再改为进程内/后台 goroutine 异步执行；本 checkpoint 先保证页面契约和核心处理可用。
  - `/api/prompts*` 在测试后台上下文中同时兼容 Go `name/content` 与 Python `prompt_name/prompt_content` 字段。

- `2026-05-08`: Go stats insight 迁移口径更新：
  - 统计页摘要接口只读 AI 洞察缓存，不在打开统计页时实时调用大模型。
  - Go 后端使用 Python 生产表 `ai_stats_insights`，以 `(user_id, range_type, generated_date)` 作为 upsert 唯一口径。
  - 数据一致性通过 `data_fingerprint = total_calories / avg_calories_per_day / recorded_days / macro_percent` 判断；缓存日期不是当天或指纹不一致时返回 `analysis_summary_needs_refresh=true`。
  - `generate` / websocket 负责按当前统计数据与健康档案调用 DeepSeek；`save` 负责重新计算指纹并保存前端最终展示的完整文本。
  - 无 `DEEPSEEK_API_KEY` 时返回可用兜底洞察文本，避免本地/测试环境因缺 key 完全不可用。

- `2026-05-08`: Go exercise 迁移口径更新：
  - `POST /api/exercise-logs` 走异步 `analysis_tasks(task_type=exercise)`，不再同步创建 stub exercise log。
  - 提交时必须保存 `profile_snapshot`，优先使用 `user_weight_records` 最新体重，缺失才回退 `weapp_user.weight`。
  - worker 成功估算后再写 `user_exercise_logs`，并落库 `ai_reasoning`。
  - 估算优先走 OfoxAI `google/gemini-3.1-flash-lite-preview` 短 JSON；无 key、调用失败或解析失败时用 MET/时长/体重规则兜底。
  - 一条描述包含多项运动时，按换行/分号/句号拆分分项估算后求和。

- `2026-05-08`: Go `db_first` DeepSeek fallback 迁移口径：
  - 标准模式下图片/文字分析 prompt 应尽量只让模型输出食物名称、重量、描述和简短建议；营养计算统一由 `food_nutrition_library` / aliases / DeepSeek fallback 后处理完成。
  - `legacy_direct` 与模型对比接口继续使用旧的“模型直接估营养” prompt，避免对比结果因为 db_first 轻 prompt 变成零营养。
  - 未命中食物先标记 `is_unresolved=true` 并记录 `food_unresolved_logs`；若 DeepSeek fallback 成功，`nutrition_source` 改为 `deepseek_text_fallback`，但仍保留未命中事实用于补库追踪。
  - DeepSeek fallback 生成的是每 100g 扩展营养字段，Go 返回的 `unit_nutrition_per_100g` 与按重量缩放的 `nutrients` 应保持同一字段集合；没有 fallback 时也返回 zero unit，避免前端/保存链路分叉。
  - DeepSeek fallback 成功后自动写入 `food_nutrition_library(source=deepseek_auto)` 和 `food_nutrition_aliases`，下一次同名食物优先走库命中。

- `2026-05-08`: 保质期通知发送 Go worker 口径：
  - `/api/expiry/items/:item_id/subscribe` 只负责创建/更新/取消 `food_expiry_notification_jobs`；真实微信订阅消息发送由 worker 处理。
  - worker 通过原子 claim pending job，使用稳定 access token/临时 fallback token 调用微信订阅消息接口。
  - 发送失败按 `5/30/120` 分钟退避重试，超过最大重试次数后标记 `failed`，避免单个坏 job 阻塞队列。

- `2026-05-08`: Go worker Phase 2 后续决策：
  - `precision_plan` 不再直接把单次分析结果当最终精准结果；Go worker 需要保留 Python 旧链路的多阶段形态：planner round -> item estimate 子任务 -> aggregate。
  - `health_report` 应继续保持 Python 主分支的多图兼容：允许逗号分隔 URL，逐张 OCR 后合并并写入 `user_health_documents` 与 `weapp_user.health_condition.report_extract`。
  - `/api/expiry/recognize` 对前端仍应是同步识别接口：创建 `analysis_tasks` 只是为了历史/配额/审计记录，接口必须直接返回 `items` 给前端预填表单。
  - `expiry_recognize` 仍加入 worker 默认任务类型，作为历史 pending 任务或后续异步化的兜底消费路径。
  - 保质期订阅接口不应只是 stub；Go 版应继续沿用 Python 的 `food_expiry_notification_jobs` 队列表。订阅接口负责 upsert/cancel job，实际微信订阅消息发送由后续 worker 处理。

- `2026-05-08`: Go 后端恢复真实 worker 的部署口径更新：
  - 允许重新创建 `backend/cmd/worker`，因为这次不是旧的空壳 worker，而是真正消费 `analysis_tasks` 的 runtime。
  - `backend/Dockerfile` 同时构建 `/app/food-link` 和 `/app/food-link-worker`；默认入口仍是 server，worker 由部署层用同镜像不同 command 启动。
  - worker 默认任务类型先覆盖 `food,food_text,precision_plan,public_food_library_text,exercise`，健康报告 OCR、保质期识别和订阅通知在后续 Phase 接入。
  - 任务领取必须使用数据库原子锁定，当前采用 GORM transaction + `FOR UPDATE SKIP LOCKED`，避免多 worker 重复消费同一 pending task。

- `2026-05-08`: Go `db_first` 第一版策略：
  - 模型识别结果进入后处理后，优先用 `food_nutrition_aliases` / `food_nutrition_library` 回算营养。
  - 命中库的项以每 100g 营养值按 `estimatedWeightGrams` 缩放，未命中项记录到 `food_unresolved_logs`。
  - 未完成 DeepSeek fallback 前，未命中项保留原模型营养估计但显式标记 `nutrition_source=unresolved` 与 `is_unresolved=true`，不能伪装成库命中。
  - 下一步应继续迁移 Python 的 unknown-food per-100g fallback 自动补库，并把 db_first prompt 收窄为“食物名 + 重量”为主。

- `2026-05-08`: 当前 Go 后端迁移状态不能只按 `docs/go-backend-migration-status.md` 的“Migration is COMPLETE”判断；实际代码对账显示：
  - `main` / `dev` 当前同为 `fcc6b61`，可作为本轮 Python 后端旧基线。
  - 当前 Go 分支 `434d019` 仍有 `20` 个小程序使用路由依赖 route map stub fallback，且 `/ws/stats/insight` 仍是 websocket 占位。
  - 行为等价层面，异步 worker、db_first 食物库匹配、会员支付/积分治理、小程序码、stats insight、保质期识别/订阅、测试后台批处理等仍需继续补迁。
  - 详细对账报告固定记录在 `docs/go-backend-main-gap-analysis-2026-05-08.md`。

- `2026-05-08`: Go 后端完整迁移采用“一条集中迁移分支 + 分阶段 checkpoint”的策略：
  - 计划书固定在 `docs/go-backend-full-migration-plan-2026-05-08.md`。
  - 目标是一口气补完到可替代 Python，但执行过程必须按 Phase 验收，不能无检查地大爆炸写到底。
  - 优先级固定为：先补 20 个 stub 路由，再补 worker runtime，再补 db_first，再补会员支付/积分治理，然后补二维码、stats insight、保质期、测试后台和运维脚本。
  - 当前估时以 `15-20` 个工作日为正式计划口径；若加入完整灰度和回滚演练，预留 `20-25` 个工作日。

- `2026-05-08`: Go 后端 Phase 1 已将 route-map stub 数量从 `20` 清到 `0`：
  - `/api/public-food-library*` 与 `/api/recipes*` 已按独立 DDD module 注册真实 handler。
  - `POST /api/precision-sessions/:session_id/continue` 已接入 analyze handler 和 task service。
  - 这只表示路由不再 501；异步审核/分析任务仍需要 Phase 2 worker runtime 才能闭环。

- `2026-05-08`: 当前 Go backend 数据库访问基线：
  - 数据库客户端统一为 `GORM + PostgreSQL`，连接入口为 `backend/pkg/database/postgres.go`。
  - 启动装配由 `backend/internal/app/app.go` 创建一个共享 `*gorm.DB`，再手工注入各模块 repo。
  - 业务 repo 应继续通过 `db.WithContext(ctx)` 做 GORM 查询；目前未采用 `database/sql`、`sqlx` 或 `pgx` 直连作为业务访问路径。
  - 数据库配置继续由 `backend/pkg/config` 通过 `config.yaml` 与环境变量绑定提供，生产敏感值不应写入仓库配置文件。
  - Supabase 当前应视为旧数据/旧存储迁移源和兼容对象 URL 来源；不要把 Supabase 当作 Go 后端运行时主数据源，除非明确执行一次性同步/迁移脚本。
  - 如 Supabase 上还有新变更，必须主动再次执行“从 Supabase 源库/对象存储同步到当前腾讯云 PostgreSQL/COS”的迁移流程；当前 Go 服务不会自动轮询 Supabase。

- `2026-05-08`: Go 后端会员/支付/积分迁移以 Python 生产表为准，不能继续沿用 Go 重构早期 mock schema。稳定口径：
  - 会员配置表使用 `membership_plan_config`。
  - 用户权益表使用 `user_pro_memberships`。
  - 支付流水表使用 `pro_membership_payment_records`。
  - 额外奖励与 earned credits 使用 `user_credit_bonus_events`、`user_earned_credit_ledger`、`weapp_user.earned_credits_balance`。
  - `/api/membership/me` 应以最新真实 `paid` 会员订单为真相来源进行 reconcile，避免 mock/手动脏状态覆盖付费事实。
  - `/api/membership/pay/create` 必须走真实微信 JSAPI 下单；`/api/payment/wechat/notify/membership` 必须按微信支付回调原始 body + headers 验签、AES-GCM 解密 resource、校验金额后再激活或续期会员。
  - 微信支付 PEM 配置可接受直接 PEM 或文件路径；生产真源仍是运行时 `ConfigMap`，不是镜像构建机环境变量。

- `2026-05-08`: Go 后端积分额度治理迁移口径：
  - 食物标准分析和保质期识别消耗 `2` 分；精准分析消耗 `4` 分；运动估算消耗 `1` 分；普通试用每日系统积分为 `8`。
  - submit/recognize/log 创建成功前只校验并生成 `credit_spend_plan`；成功后才扣 earned credits，避免失败请求吞积分。
  - `analysis_tasks.payload.credit_usage` 记录系统积分按天使用量，精准模式子任务不再复制 `credit_usage`，避免重复计数。
  - 历史任务 fallback 计数仍按 `food/food_text=2`、`precision_plan=4`、`exercise=1` 兼容。

- `2026-05-08`: `/api/qrcode` 在 Go 后端必须调用微信 `stable_token -> getwxacodeunlimit` 生成真实小程序码，token 可缓存约 5400 秒，遇到 token 失效需清缓存重试一次；不得再返回 mock PNG。

- `2026-05-08`: Go stats insight websocket 不能返回“未迁移”占位。当前先使用 Go 生成文本流式推送；后续若追求完全等价，需要继续迁移 Python `_generate_nutrition_insight` 的 LLM prompt、缓存与数据指纹策略。

- `2026-05-06`: Go backend CCR 推送脚本继续使用 mjs：
  - 该脚本属于仓库级部署辅助工具，不属于 Go 后端 runtime。
  - 继续通过根目录 `npm run push-docker-ccr` 调用 `backend/scripts/push-docker-ccr.mjs`。
  - 迁移完成后恢复按当前分支生成镜像标签：`main` 分支推送 `ccr.ccs.tencentyun.com/littlehorse/foodlink:main`，`dev` 分支推送 `ccr.ccs.tencentyun.com/littlehorse/foodlink:dev`。
  - 其它分支拒绝执行；脚本仍打印当前分支和短 SHA 作为人工确认信息。
  - 迁移期新增的 Docker 构建环境变量能力继续保留，包括 `DOCKER_BUILD_PLATFORM`、`DOCKER_GO_BUILDER_IMAGE`、`DOCKER_GO_PROXY` / `GOPROXY` 和 `DOCKER_BUILD_PROGRESS`。
  - 以后只有当部署工具需要成为可分发 CLI、需要复用 Go 内部配置/代码、或需要复杂 CCR/Kubernetes API 编排时，再考虑用 Go 重写。

- `2026-05-06`: Go backend Docker 镜像构建口径：
  - `backend/Dockerfile` 采用多阶段构建，固定编译 `./cmd/server`。
  - runtime 镜像不复制本地 `config.yaml` 或 `.env`；业务敏感配置继续通过运行时环境变量 / ConfigMap 注入。
  - runtime 需要保留 `docs/backend-api-prd/ROUTE_MAP.md`，因为当前 Go 服务启动时会读取它来注册尚未迁移完成的兼容占位路由。

- `2026-05-06`: 用户明确决定删除 Go backend 的 `cmd/worker` 占位入口：
  - 当前 `cmd/worker` 只加载配置、打印日志并无限 sleep，没有实际消费队列或执行任务。
  - `backend/Dockerfile` 收口为固定构建 `./cmd/server`，不再保留 `BUILD_TARGET` 切换到 worker 的口径。
  - 后续若需要独立异步任务 runtime，应重新按真实任务消费模型创建入口，而不是保留空壳 worker。

- `2026-05-06`: Supabase 技术栈迁移正式切换为独立 PostgreSQL + 腾讯云 COS + CDN：
  - 旧 Python 后端归档至 `backend_bak/`，新 Go 后端接管 `backend/`
  - 数据迁移通过 `backend_bak/scripts/` 下的三套脚本完成：数据库全量迁移、Storage 图片迁移、URL 清洗为 COS key
  - 数据库只存 COS key，不存完整 URL；CDN 前缀由 `backend/config.yaml` 按 bucket 维度配置

- `2026-05-06`: 图片存储查询返回口径统一为"数据库只存 key，后端负责拼接 CDN URL"：
  - 上传链路：`storage.UploadBytes` / `UploadBase64` 内部通过 `BuildAccessURL` 返回完整 CDN URL
  - 查询链路：Go 后端 service/handler 层必须调用 `BuildAccessURL` 把 key 拼接为完整 CDN URL 后再返回前端
  - 禁止直接把数据库中的纯 key 透传给前端

- `2026-05-05`: 新 Go 后端第一阶段迁移底座采用“全量路由占位 + 核心链路优先真实实现”的落地方式：
  - `backend/docs/backend-api-prd/ROUTE_MAP.md` 作为全量路由注册源
  - 所有 PRD 路由先在 Go 服务中完成路径/方法/鉴权层面的注册覆盖
  - 未迁移完成的路由统一返回明确的“已注册但尚未迁移”兼容占位响应
  - 已知前端 gap 路由优先真实补齐：
    - `GET /api/food-record/{record_id}/poster-calorie-compare`
    - `DELETE /api/community/feed/{record_id}/comments/{comment_id}`

- `2026-05-05`: 当前分支中的 `backend/` 已被视为新 Go 后端目标路径：
  - 旧 Python 后端历史代码以 `backend_bak/` 为保留基准
  - `backend/` 下原被 Git 跟踪的 Python 文件允许在本次迁移中被新的 Go 目录结构取代
  - SQL 与 PRD 文档需要在新 `backend/` 内另行归档，避免后续会话只依赖根目录版本

- `2026-05-05`: 为当前分支的 Go 后端重构准备，项目内新增第一优先级本地 skill：
  - 路径：`.kimi/skills/ddd-go-backend/SKILL.md`
  - 来源仓库：`LSTM-Kirigaya/jinhui-skills`
  - 安装口径：不仅保存 `SKILL.md`，还要把其相对引用的配套文档递归落地到同一 skill 目录，确保离线可读和后续会话可复用
  - `AGENTS.md` 需显式登记该 skill，便于后续新会话优先使用

- `2026-05-05`: 为后端跨语言重写准备的接口实现文档集合固定放在 `docs/backend-api-prd/`。该集合不是 Swagger 导出副本，而是迁移蓝图：既记录路由/鉴权/请求响应，也记录数据库依赖、worker/异步链路、外部依赖、前端调用面和已知 drift。

- `2026-05-05`: 后端接口 PRD 文档的覆盖范围按“全量后端 surface”执行，不只包含小程序主业务 API，也包含测试后台 API、WebSocket、后端直出页面和运维/回调类接口；但文档中必须显式区分 `miniapp-used`、`backend-only`、`internal-only`、`frontend-missing-backend`。

- `2026-05-05`: 后端迁移文档中，积分系统与健康档案报告识别链路需要保留独立专题文档，当前固定为：
  - `docs/backend-api-prd/_shared/credits-system.md`
  - `docs/backend-api-prd/_shared/health-report-ocr.md`

- `2026-05-05`: 当前确认需要在重写阶段特别关注的两个前后端缺口为：
  - `GET /api/food-record/{record_id}/poster-calorie-compare`
  - `DELETE /api/community/feed/{record_id}/comments/{comment_id}`

- `2026-05-05`: 健康档案 OCR 目前属于 branch drift 区域：
  - 本地 `main` 仍体现较宽的多图 / provider-switch worker 路径
  - `origin/dev` 已出现更收口的单图 Doubao 导向实现
  - 正式重写前必须先选定以哪条链路为准

- `2026-05-05`: 「我的」页底部版本号继续以 `package.json` 为唯一版本源：
  - `src/pages/profile/index.tsx` 通过构建常量 `__APP_VERSION__` 展示版本号。
  - `config/index.ts` 从根目录 `package.json` 读取 `version` 并注入 `__APP_VERSION__`。
  - 以后若只需要更新页面版本号，优先 bump `package.json` / `package-lock.json`，不要手改页面硬编码字符串。

- `2026-05-05`: 后端重构采用增量迁移，不做一次性大爆炸拆分：
  - 先以 `main.py / database.py / worker.py` 三个超大文件为主线建立模块边界。
  - 每次只拆一个低耦合业务域，保持 API 行为不变，完成后用 `py_compile`、目标测试或基准脚本验证。
  - 路由层优先拆出 `APIRouter` 模块；schema、service、repository 随业务域逐步下沉。
  - 性能问题不能只靠“拆文件”判断，必须结合接口基准、数据库调用次数、缓存和 Supabase 查询结构定位。
  - 当前已有未提交功能改动时，后端重构应尽量单独提交，避免和业务修复混在一起。

- `2026-05-05`: 当用户要求“提交当前工作区全部改动并合并到 main”时，默认发布顺序保持为：
  - 先在 `dev` 提交并推送当前工作区改动
  - 再把同一提交同步到 `main` 并推送
  - 若远端分支在发布前已前进，先同步远端再继续，避免静默覆盖

- `2026-05-05`: Food analysis waiting-page interactions must not change the analysis input after task submission:
  - Do not add supplemental-info buttons whose answers would require a second model pass.
  - Waiting-page improvements should stay local or navigational: real task status/stages, elapsed time, leave-and-check-later, health tips, quiz/fact cards, and similar no-reanalysis interactions.
  - If a future interaction affects nutrition estimation, it should be designed as an explicit correction/re-analysis flow after the first result, not hidden inside the waiting page.

- `2026-05-05`: User-group QR entry should be a low-interruption profile service entry:
  - Add `加入用户群` under the `我的` page service list instead of using homepage popups or analysis-flow interruptions.
  - The entry opens a dedicated lightweight QR page in `packageExtra`.
  - The page should show one recommended current group first and keep other supplied QR codes as switchable backups.
  - Group QR metadata and image imports should stay centralized so future weekly QR replacement touches one config file.
  - Because WeChat group QR codes expire, a future backend/remote-config path is preferred before treating this as a long-term operational solution.

- `2026-05-05`: Text food analysis should follow the same database-first nutrition strategy as standard photo analysis:
  - In standard mode, the text model should parse natural-language input into structured food names and estimated weights only.
  - Nutrition values should be calculated by backend lookup against `food_nutrition_library` / `food_nutrition_aliases`.
  - Unknown foods may use the existing DeepSeek per-100g fallback and be written back for future reuse.
  - `legacy_direct` remains available as an explicit compatibility analysis engine, but standard text submissions default to `db_first`.

- `2026-05-05`: Login skip-browse must not use `navigateBack()` as its primary behavior:
  - `暂不登录，随便看看` should switch to the public homepage tab (`/pages/index/index`).
  - This avoids a loop where skipping login returns to a protected route (for example a circle record detail), and the auth guard immediately sends the user back to login.
  - Development/test OpenID helpers may remain in backend compatibility code, but the login page frontend must not expose the test OpenID input unless the user explicitly asks to restore a dev-only testing affordance.

- `2026-05-05`: Membership reconciliation should keep paid-order truth by default; manual service upgrades are allowed only for an explicit whitelist:
  - For normal users, `/api/membership/me` should repair `current_plan_code`, status, period timestamps, expiry, last paid time, and `daily_credits` back to the latest real paid membership order.
  - Only users in `MANUAL_MEMBERSHIP_UPGRADE_USER_IDS` may keep a manually higher `current_plan_code` and manually boosted `daily_credits`.
  - Current whitelist includes `cafa4614-9453-4eb0-bf60-51f442ce0f4a`（倒数第二位用户）, upgraded to `standard_monthly` with `daily_credits=200`.
  - `backend/scripts/reconcile_membership_truth.py` must follow the same rule as `/api/membership/me`.

- `2026-05-03`: Invite-new-user should support dual product entry while keeping one reward rule:
  - Poster/share content remains one invite path.
  - `我的 -> 邀请有礼` is a second dedicated growth entry and should not require users to first share a check-in record.
  - Both entry paths must converge on the same invite code and the same `7 days / 2 distinct valid-use days / both get 15 earned credits / inviter monthly cap 10` qualification rule.
  - Unauthenticated QR scans carrying `fi=邀请码` should land on a public invite page first so users can see the reward proposition before logging in.
  - Invite-facing copy should emphasize `新用户达标后双方各得15积分`, rather than only `成为好友`.

- `2026-05-02`: Membership display and entitlement truth must prefer the latest real paid membership order over stale `user_pro_memberships` snapshots:
  - If `user_pro_memberships.current_plan_code / status / expires_at / daily_credits` drifts from the latest paid membership order, backend `/api/membership/me` should auto-reconcile it before returning data.
  - Non-membership orders such as `points_recharge` must not participate in membership-plan reconciliation.
  - Preserved manual exceptions remain explicit (`锦恢`, `小马哥`) because they are developer accounts; other active memberships without any real paid membership order should be treated as data errors to clean up instead of as display truth.

- `2026-05-02`: Invite rewards now use a higher-quality qualification rule:
  - For new referrals, the invitee must complete valid usage on `2` distinct China dates within `7` days.
  - Once qualified, inviter and invitee each receive `15` earned credits immediately.
  - The reward goes directly into persistent `earned_credits_balance` instead of being split across 3 daily drops.
  - Existing legacy referrals already in `reward_active` continue their old 3-day daily reward flow so in-flight rewards are not cut off.

- `2026-05-02`: The profile membership card should keep the paid area intentionally compact:
  - Keep only `系统剩余 0`, `累计奖励`, and when applicable a compact founder-benefit block.
  - Reward points should map to a visible on-card level ladder (`Lv1+`) with playful titles instead of long explanatory copy.
  - When double membership benefits apply, the card must keep that founder-benefit copy to a single line and express rank position as `33/1000`-style text instead of a second explanatory line.

- `2026-05-02`: On the profile page, earned reward credits should not be hidden behind the membership detail page for non-members:
  - If a user has `earned_credits_balance > 0`, the membership card on `src/pages/profile/index.tsx` should surface that value directly.
  - Current UX uses an `已赚 X` badge plus free-card summary text so users can notice reward progress without tapping into the membership page first.

- `2026-05-01`: Membership credits are now split into two pools:
  - System credits from membership/trial still refresh the next day.
  - User-earned invite/share rewards accumulate in a persistent balance.
  - Consumption order is system credits first, then earned credits.
  - Frontend/API fields are `system_credits_remaining`, `earned_credits_balance`, and `total_credits_available`.
  - Daily reward detail remains visible for display, but is no longer merged into `daily_credits_max`.

- `2026-05-01`: Historical backfill uses a date-aware credit priority:
  - Spend the backfill target day's unused daily system credits first.
  - If that target day is exhausted, spend today's unused daily system credits second.
  - If both daily system-credit buckets are exhausted, spend earned persistent credits last.
  - This applies to backfilled food and exercise records.

- `2026-05-01`: Historical backfill is now limited to the recent `3` days and uses the homepage-selected date as the source of truth:
  - Supported dates are today, yesterday, and the day before yesterday.
  - Homepage date selection feeds both food and exercise record entry flows.
  - Non-today entry should show an explicit backfill state such as `正在补录 YYYY-MM-DD`.
  - Backend task payloads persist per-date credit usage so historical backfill can consume the target-day system credits before falling back to today and then earned credits.

- `2026-05-01`: 项目部署文档口径升级为“可直接执行的操作手册”，不能只保留命令名。当前稳定规则是：
  - `AGENTS.md` 的后端部署章节必须明确：前置依赖（Docker + Buildx）、默认平台策略（`linux/amd64`）、平台覆盖方式（`DOCKER_BUILD_PLATFORM`）
  - 必须包含标准操作步骤与常见故障排查，确保不同开发机架构下部署一致可执行

- `2026-05-01`: 后端镜像推送脚本的构建平台口径收敛为“默认强制 `linux/amd64`”，避免开发机架构影响线上可运行性。当前稳定规则是：
  - `npm run push-docker-ccr` 统一走 `docker buildx build --platform ... --push`
  - 默认平台为 `linux/amd64`，确保 ARM 开发机构建时不会推送仅 ARM 可运行的镜像到 AMD64 服务器
  - 仅在明确需要时，通过 `DOCKER_BUILD_PLATFORM` 覆盖默认平台（例如 `linux/amd64,linux/arm64`）

- `2026-04-30`: 后端 OpenTelemetry 依赖在本项目里不能再作为“本地必装硬依赖”阻塞启动。当前稳定口径是：
  - `backend/main.py`、`backend/database.py`、`backend/worker.py` 相关 OTel 能力必须通过兼容层接入
  - 本地/临时环境若未安装 `opentelemetry-*` 包，后端应自动降级为 no-op observability，并继续可启动
  - 只有在正式环境已安装依赖时，才启用真实 trace/log/exporter/instrumentation
  - “未装 OTel 时打印 warning 并关闭观测”优先于“因 import 失败导致整个后端不可启动”

- `2026-04-30`: 小程序错误提示统一的实现策略正式收口为“静态替换失败类 toast”，不再使用 `app.ts` 里的全局 `showToast` 运行时拦截。稳定口径是：
  - 失败类提示统一改为 `showUnifiedApiError(...)`（阻塞弹窗 + 复制 traceId）
  - 成功提示、输入校验提示、复制动作提示可继续保留普通 `showToast`
  - 登录页里“复制失败，请手动记录”属于复制动作反馈，不视为 API 失败弹窗范围

- `2026-04-30`: 后端链路排障的可观测性口径新增 OpenTelemetry 基线：
  - `backend/main.py` 默认支持通过 OTLP HTTP 上报 trace 与 logs
  - 默认 Collector 地址使用 `OTEL_EXPORTER_OTLP_ENDPOINT`，当前约定值是 `http://otel-collector.observability.svc.cluster.local:4318`
  - 每个 HTTP 响应统一返回 `x-trace-id` 与 `traceparent`，便于前端/测试同学回传链路 ID 直查 Jaeger
  - 多 Pod 排障默认再返回 `x-instance-id`；值优先使用 `POD_NAME`，回退 `HOSTNAME`
  - 实例头支持开关：`INSTANCE_HEADER_ENABLED`，默认开启；响应头名可由 `INSTANCE_HEADER_NAME` 覆盖
  - 生产环境可按需通过 `OTEL_ENABLED` 与 `OTEL_LOGS_ENABLED` 分别开关 trace 与 logs 上报

- `2026-04-29`: 手动记录前台展示的正式心智继续收口为“双库模式”，不要把辅助表也讲成用户可见数据库。当前稳定规则是：
  - 前台可见的主库只有两类：
    - `food_nutrition_library`：标准食物库
    - `public_food_library`：真实餐食库
  - `food_nutrition_aliases` 继续只做后台召回，不在手动记录页面上单独作为“库”展示
  - `food_unresolved_logs` 继续只做后台补词典日志，不进入前台展示层
  - 页面文案、来源标签、默认说明都应围绕“标准食物 / 真实餐食”两种心智统一，不再出现“营养词典 / 公共库 / aliases”并列给用户

- `2026-04-29`: 手动记录对食物词典的正式利用口径继续收口为“标准营养库做大盘、公共库做整餐、别名库做召回”，不能再只让用户体感到几十条数据。当前稳定规则是：
  - 手动记录的主数据盘明确以 `food_nutrition_library` 为主；当前实库量级已确认是 `11275` 条标准食物、`9925` 条别名
  - `public_food_library` 继续承担“整份餐食/真实餐次复用”角色；当前量级较小，不应让用户误以为它就是全部手动记录词典
  - 手动记录搜索与浏览返回值里，标准营养库的 `fiber / sugar / sodium_mg` 不应再被吞掉；这些字段至少要能进入前端编辑态和 `user_food_records.items[].nutrients`
  - 默认浏览区要明确提示词典规模，让用户知道手动记录后面接的是“上万条标准食物 + 上万别名”，而不是有限推荐卡片本身
  - 页面纯加载态继续禁止出现“加载中/搜索中”文字，只保留可视化 loading

- `2026-04-29`: 保质期提醒的 AI 录入首版正式口径升级为“多食物拍照识别预填”，而不是纯手动录入或 AI 自动入库。当前稳定规则是：
  - 入口放在现有“新增保质期”页面顶部，沿用原始表单 UI，并在上方增加“拍照识别预填”区
  - 支持 `1` 张图内识别多个食物，也支持最多 `5` 张图片一起识别
  - AI 只负责把能识别出的字段预填到多个待确认卡片里；无法识别出的字段继续由用户手动补齐
  - 若图片里没有明确到期日期，允许 AI 补充“建议保存天数 + 默认到期日”，但必须明确标注为估计值
  - 首版不做“识别后自动保存”，用户始终需要在编辑页确认后再入库
  - 计费口径复用现有食物分析能力，按 `2` 积分/次执行，不单独新建一套积分规则
  - 为避免污染普通分析历史，保质期识别任务虽然复用分析任务记账，但需带 `payload.expiry_recognition=true` 并在历史页隐藏

- `2026-04-29`: 精准模式参考物的正式口径收口为“默认手掌 + 用户级尺寸记忆”，避免每轮都重新录入。当前稳定规则是：
  - 默认参考物优先使用 `手掌`，而不是 `筷子`
  - 用户在精准模式里填写过的参考物名称与尺寸，需要持久化为用户默认值，下次直接复用
  - 持久化位置先复用 `health_condition.precision_reference_defaults`，不额外新建表
  - 入口页与结果页的参考物预设统一收口为 `手掌 / 常规卡片 / 大卡片 / 自定义`
  - 预设参考物按 key 各自记住尺寸（如 `hand / campus_card / large_card`）
  - 额外允许记住 `1` 个自定义参考物名称与尺寸
  - 参考物的摆放说明 `placement_note` 仍属于单次会话信息，不做长期默认值

- `2026-04-29`: 分析历史页左滑操作按钮的视觉口径继续收口为“高对比、可一眼辨认”，不能再用过浅的浅绿 / 浅红渐变。当前稳定规则是：
  - `分享` 使用更深的品牌绿渐变
  - `删除` 使用更深的红色渐变
  - 图标与文案保持纯白，并适当提高字号、字重与阴影，保证在浅色主题下也清楚可见

- `2026-04-29`: 收藏餐食入口的正式口径继续收紧为单一“我的收藏”心智，不再混用“我的食谱 / 全部模板 / 已收藏”等中间概念。当前稳定规则是：
  - 结果页点击“收藏餐食”创建的餐食模板默认写入 `is_favorite=true`
  - 「我的」页服务入口标题统一为“我的收藏”
  - 落地页标题统一为“我的收藏”
  - 列表页只展示收藏过的餐食，不再提供“全部/收藏”切换
  - 右下角 `+` 浮动入口移除，因为新建来源只能是“分析结果页点击收藏”，不是在列表页手动新建
  - 收藏页前端不要强依赖 `/api/recipes?is_favorite=true` 这一层后端过滤；当前更稳的口径是先拉用户餐食模板，再在前端按 `is_favorite` 过滤展示
  - 首页记录弹层也必须给出“我的收藏”直达入口，并把它与“历史记录”放在同一快捷层级，因为收藏的核心价值就是“快速复用记录”

- `2026-04-29`: 在已取消上述 4 个指定假会员后，会员治理本轮只继续处理一类脏状态：`user_pro_memberships.expires_at <= now()` 但 `status` 仍为 `active`` 的记录，应统一收口为 `expired`；除此之外，暂不继续扩大到其他 active 假会员。

- `2026-04-29`: 会员数据修正进一步收口为“支付真相优先”：除用户明确保留的 `小马哥 / 锦恢` 外，其余存在真实 `paid` 会员订单的用户，`user_pro_memberships` 应统一按最近一次 `paid` 会员订单回写。若会员状态表里出现“月卡支付却挂成年卡”的情况，以支付表为准修正为月卡。

- `2026-04-29`: 前 `1000` 名注册用户的创始礼遇从“仅免费试用 30 天”升级为“双重激励”：
  - 免费试用阶段进一步细分为：前 `500` 名用户从注册开始享受 `60` 天、每天 `8` 积分；第 `501-1000` 名用户从注册开始享受 `30` 天、每天 `8` 积分；其余新用户为 `3` 天
  - 一旦开通任意付费会员，套餐基础积分按 `x2` 发放；当前口径对应为：轻度版 `16/日`、标准版 `40/日`、进阶版 `80/日`
  - 该翻倍仅作用于会员套餐基础积分，不放大奖励积分（邀请/海报）与试用积分
  - 试用期内的额外积分获取渠道保持可用：邀请奖励、分享海报等奖励可在基础 `8` 积分之外正常叠加
  - `/api/membership/me` 必须返回创始用户编号与翻倍状态：`early_user_rank / early_user_limit / early_user_paid_bonus_multiplier / early_user_paid_bonus_eligible / early_user_paid_bonus_active`
  - 会员购买页与「我的」页都需要明确展示“你是第 N / 1000 位用户”，并让前 `500` 名用户能感知自己拿到的是“额外加赠 1 个月”的版本

- `2026-04-29`: 底部导航「分析」页的产品定位开始从“营养统计看板”向“疾病风险可视化报告”收口。当前稳定口径是：
  - 页面表达的是“饮食相关风险趋势”，不是医学诊断、治疗建议或疾病结论
  - 不直接宣称“吃这个会治疗/导致某病”，而是基于公开指南、RCT、队列研究、疾病负担模型与 meta 分析，表达“该饮食模式与某类疾病风险上升/下降相关”
  - 页面核心卖点优先从“热量/营养素展示”升级为“疾病预防指数 + 最小改善动作 + 改善后预计收益”
  - 第一批可产品化的核心指标优先考虑：高血压预防、糖尿病预防、心血管保护、结直肠癌饮食风险、体重管理友好度、健康寿命趋势
  - 文案风格应保持“风险可视化 + 可逆转方案”，避免恐吓式健康焦虑表达
  - 第一版页面信息架构先收口为“结论区 + 证据区”双层：
    - 结论区：总分、风险卡、最小改善动作、AI 风险解读
    - 证据区：热力图、趋势图、宏量、餐次、连续记录、体重喝水等原统计模块
  - 风险卡默认折叠，只先展示标题、分数和一句短判断；详细依据与改善动作按点击展开
  - 用户可通过页面内的“我的关注”本地管理想显示的疾病卡片；默认至少保留 1 项，且显示顺序优先跟随当前关注项
  - 页面文案应尽量避免过硬的“疾病报告”语气，优先使用“健康方向 / 友好度 / 长期状态趋势 / 仅供参考”这类更柔和的健康管理表达

- `2026-04-29`: FoodLink 当前 Docker/K8s 部署口径下，后端业务敏感配置不打进镜像，而由集群运行时 `ConfigMap` 注入。当前稳定规则是：
  - 本地 `npm run push-docker-ccr` 只负责构建并推送 `ccr.ccs.tencentyun.com/littlehorse/foodlink` 镜像，不负责把本机 shell 环境变量烤进镜像
  - `backend/Dockerfile` 只保留通用默认 `ENV`（如 `PORT/HOST`），支付/数据库/第三方密钥应通过运行时注入
  - `littlehorse-deployment/foodlink/main/deployment.yaml` 的生产后端使用 `envFrom -> configMapRef -> foodlink-main-env`
  - 因此生产支付配置（如 `APPID / WECHAT_PAY_MCHID / WECHAT_PAY_SERIAL_NO / WECHAT_PAY_PRIVATE_KEY / WECHAT_PAY_NOTIFY_URL / WECHAT_PAY_API_V3_KEY`）的真源应视为集群中的 `foodlink-main-env`，而不是镜像构建机当前环境
  - 若仅更新镜像、不更新 `foodlink-main-env` 或不重启 Pod，线上仍会继续使用旧支付配置

- `2026-04-28`: 食物分析链路的时间/位置上下文继续收口为“弱提示、低打扰”策略：
  - 时间侧继续沿用 `meal_type + timezone_offset_minutes`，主要帮助判断餐次语境
  - 地理位置侧只透传粗粒度 `province / city / district`，不把原始经纬度直接塞给模型
  - 前端仅在用户已经授权 `scope.userLocation` 时静默获取并缓存位置；未授权时不额外弹窗打断分析
  - 模型收到的位置只能作为辅助线索，用于理解地域菜名、口味和常见分量；若与图片或文字描述冲突，必须始终以图片/文字本身为准

- `2026-04-28`: 用户已收口本轮会员治理执行范围：只取消 4 个指定假会员（`凣凣尜尜 / 草！我要干俄挺 / kk / 条条`），暂不处理其余 2 个假会员候选，也暂不对 `ikura` 做补偿会员。

- `2026-04-28`: 临时会员开通能力不能再让真实用户看到或触发。正式口径改为：前端会员页彻底移除 `[DEV]` 测试入口，后端 `/api/dev/toggle-test-membership` 测试路由直接删除，不再保留环境变量开关后门。

- `2026-04-28`: 测试后台 `custom` 模式的正式 prompt 实验口径继续升级为“多提示词并跑”：
  - 分析体验与批量测试都允许同时选择多个 Gemini 自定义提示词
  - 实际执行语义是“所选模型 × 所选提示词”的笛卡尔积，而不是只支持单个 `prompt_id`
  - 结果展示、批量聚合与详情查看时，必须把“同模型不同提示词”视为不同实验结果拆开显示，不能再只按模型名聚合

- `2026-04-28`: GitHub Actions 后端自动部署（原 `.github/workflows/deploy-backend.yml`）已停用。工作流内容保留为同目录下 `deploy-backend.yml.disabled`（非 `.yml` 扩展名，GitHub 不加载、不执行）；需恢复时将其重命名回 `deploy-backend.yml` 并核对 secrets 与部署脚本。

- `2026-04-28`: 测试后台单图页顶部“分析摘要”不能再混放某个模型私有的 `估算总重量 / 估算总热量`。正式口径改为：顶部摘要只展示跨模型共享的全局信息（图片数、参与模型数、标签模式、标准总重量、最佳综合分模型等）；`估重 / 热量 / 回答时长` 一律下沉到各模型自己的结果卡。批量页顶部也要按模型展示平均回答时长，便于做生产选型。

- `2026-04-28`: 食物测试后台当前的 benchmark 主目标明确收口为“食物名称识别 + 重量估算”。正式口径是：
  - DeepSeek 评估器继续只负责食物名称一对一匹配；最终得分继续只基于食物匹配与重量误差计算
  - `custom` 模式下的 Gemini 提示词允许只返回 `items[].name + items[].estimatedWeightGrams`，不必再强制返回描述、建议、热量和营养字段
  - 测试后台页面展示应同步聚焦到 `识别项 / 重量 / benchmark / 回答时长`，不再把描述、建议、PFC、热量等与当前实验目标无关的信息放在主界面

- `2026-04-28`: benchmark 报告里“未匹配”不应再等同于“模型完全没识别到”。若 DeepSeek 评估器明确看到某个候选识别项但判定它与标准标签不匹配（如 `炖冬瓜` 被识别成 `白萝卜`），报告应保留这个候选识别结果，并把匹配类型显示为 `识别成其他食物 / 名称过泛 / 未匹配` 等，而不是直接写成“未识别”。

- `2026-04-28`: DeepSeek 食物匹配评估器的正式口径继续细化为“两层保证”：第一层，prompt 必须要求对每个 `expected_item` 返回一条 assignment，哪怕 `accepted=false` 也要尽量给出 best candidate；第二层，若 DeepSeek 仍未返回 rejected candidate，本地只为“报告展示”做宽松候选回填（允许去掉 `清炒 / 炖 / 红烧` 等做法前缀后比较主体食材）。这类回填不能改变正式评分，`Food Precision / Recall / F1` 仍按未匹配处理。

- `2026-04-28`: 测试后台 item-only prompt 升级后，DeepSeek evaluator 的正式输入口径同步升级为：除 `name + weight` 外，再向匹配器透传 `isMixedDish / count / confidence`，并提供 expected/predicted 总重量作为辅助上下文。其中 `isMixedDish` 参与匹配判断；`count / confidence / totalEstimatedWeightGrams` 仅作辅助 disambiguation，不直接进入 benchmark 主评分。

- `2026-04-28`: 本地脱敏测试集的标签口径进一步收紧：凡是“单食物 / 单菜品且有明确名称”的样本，不应再写成纯 `total`，而应写成单项 `items`（如 `sample_xxx | 黑咖啡=245g`）。只有“多食物但缺逐项分重”“未知食物无法可靠命名”“空包装/非食物 0g”这类样本，才继续保留 `total` 口径。

- `2026-04-27`: 当前会员数据治理采取“先止血、再审名单、后执行修复”的顺序。正式口径是：
  - “没付钱的人不应拥有付费会员资质”，但若仍处于合法试用期，则保留试用权益，不算付费会员
  - “补 1 个月会员”只针对“最近一次 `paid` 理论上仍未到期，却失去会员资格”的异常 paid 用户；正常自然过期的老付费用户不在本轮补偿范围
  - `pending` 保留为“下单未支付”漏斗数据，不算已付费用户，也不算有效会员；历史会员 `pending` 可以批量转 `expired`，但不删除

- `2026-04-27`: 会员试用与会员数据治理不能再硬编码依赖 `weapp_user.created_at`。当前已知实库注册时间字段为 `create_time`；正式口径改为：治理 SQL 直接按 `create_time` 执行，后端试用判定按优先级识别 `created_at -> create_time -> created_time -> register_time -> registered_at -> updated_at`。

- `2026-04-27`: 会员奖励体系的当前实现口径是：
  - 邀请奖励复用现有 `好友邀请码 / 好友申请` 链路，不另起一套分享码系统；当被邀请人通过邀请码进入后，完成 `1` 次有效使用才生效
  - 当前“有效使用”先收口为：成功保存 `1` 次饮食记录，或成功写入 `1` 条运动记录
  - 奖励发放口径为：邀请人和被邀请人从生效当天开始，连续 `3` 天每天 `+5` 积分；积分仍是当天有效、次日清零
  - 防刷上限当前先按 `10` 个有效邀请 / 月实现；这是工程默认值，若后续产品改口径，再同步调整
  - 分享海报奖励当前采用“生成即奖励”而非“实际分享成功回调奖励”：记录拥有者在详情页成功生成海报后，每日最多领取 `1` 次、奖励 `1` 积分

- `2026-04-27`: 会员 `dev` 测试开通接口 `/api/dev/toggle-test-membership` 不能再默认在线上环境可用。正式口径改为：默认关闭，只有显式配置环境变量 `ENABLE_DEV_MEMBERSHIP_TOGGLE=1` 时才允许使用。线上若未开启该环境变量，接口统一返回 `404`。

- `2026-04-27`: 会员支付记录表里的 `pending` 不计入“已付费用户”或“有效会员”。后端止血口径改为：同一用户创建新会员订单前，先把其历史“会员类” `pending` 改成 `expired`；某笔会员订单支付成功后，再把该用户残留“会员类” `pending` 一并改成 `expired`，避免持续堆积。由于 `pro_membership_payment_records` 当前混有 `points_recharge`，清理逻辑必须按会员套餐 code 过滤，并保留原订单 `extra`。

- `2026-04-27`: 会员免费试用策略从“统一 3 天”升级为分层口径：按 `weapp_user` 注册顺序判定，前 `1000` 名注册用户享受 `30` 天免费试用，之后的新用户享受 `3` 天免费试用；两类试用均为每天 `8` 积分、当天清零、不累计。当前治理 SQL 直接使用实库字段 `create_time`，后端 `/api/membership/me` 继续作为唯一真源，并额外返回 `trial_days_total / trial_policy` 供前端展示。

- `2026-04-27`: 食物测试后台的正式口径改为“三模式并存”：`standard`、`strict` 继续保留并实际生效，仍走原有主链路 prompt 逻辑；新增 `custom` 自定义模式，才读取 `提示词管理` 中的 Gemini 自定义提示词。后端按 `execution_mode + prompt_id` 执行，只有 `custom` 且提示词为空时才回退 `backend/worker.py::_build_food_prompt`。

- `2026-04-27`: 提示词管理页不再承担第二套“模型选择”职责。测试后台实际使用哪个模型，只看“分析体验 / 批量测试”页中的模型勾选；提示词管理页仅维护 `custom` 模式使用的 Gemini 自定义提示词。

- `2026-04-27`: 测试后台单图分析在多模型并跑时，结果展示必须按模型分别展开完整详情，不能再只用“第一个成功模型”填充下方详情区。摘要区与详情区都应显示具体模型名，避免用户误以为只跑了一个模型。

- `2026-04-27`: 食物测试后台的正式 benchmark 口径升级为“两阶段指标”：
  - 先做食物匹配，再在匹配成功的食物上评估重量误差，最后单独保留总重量误差
  - 主指标为 `finalCompositeScore = Food F1 × matchedWeightScore`
  - `matchedWeightScore` 基于匹配食物的归一化相对误差计算：`|pred-gt| / max(gt, 50g)`，并裁剪到 `100%`
  - 辅助指标至少保留：`Food Precision / Recall / F1`、`matchedWeightMaeGrams`、`matchedWeightRelativeError`、`weightedFoodRecall`、`totalWeightRelativeError`
  - 当前正式口径改为：`items` 模式默认使用 DeepSeek（`deepseek-v4-flash`）做食物名称一对一匹配，只让模型输出结构化 match；最终分数仍由代码计算，不让 LLM 直接打总分
  - 本地 deterministic 规则匹配（`exact / contain / close_equivalent / fuzzy`）仅作为 DeepSeek 不可用时的兜底，不再是主评估器

- `2026-04-26`: 「我的」页底部版本号不能再写死。正式口径是：版本展示统一读取 `config/index.ts` 注入的 `__APP_VERSION__`，而实际版本号只从根目录 `package.json` / `package-lock.json` 通过 `npm version <x.y.z> --no-git-tag-version` 维护。

- `2026-04-26`: 当前应用主题切换完全由 `AppColorSchemeContext` 手动控制，不能再让微信宿主根据系统黑色模式自动改色。正式口径是：`app.config.ts` 里的 `darkmode` 保持 `false`，全局 `page` 也不能再挂 `prefers-color-scheme: dark` 媒体查询；否则会出现“应用仍是浅色态，但宿主底色先变黑”的半黑半白混合页面。

- `2026-04-26`: 社区页顶部搜索框在暗色主题下，底色只能由外层 `.feed-search-wrap` 承担；`.feed-search-input` 本体必须保持透明，并单独覆盖占位符颜色。否则宿主会把输入框渲染成一块独立深色矩形，破坏整条圆角搜索框的一体感。

- `2026-04-26`: 积分充值页顶部 Hero 仍保留“食探会员”标题和说明文案，放在勋章下、积分状态卡上方；该文案不再视为冗余信息移除。

- `2026-04-26`: 积分充值页“选择档位”区当前回到更简洁的三列积分档位卡，而不是价格+能力点+CTA 的重卡片版本。正式口径是：档位卡只承担“档位识别和积分差异”的选择职责，详细价格与购买行动继续放在下方周期区和套餐价格卡承接。

- `2026-04-26`: 积分充值页“选择档位”参考图只用于布局借鉴，不直接沿用其紫色视觉。正式口径是：会员档位卡必须使用 `food_link` 当前的绿色主题体系，并优先适配手机端阅读密度；当三档信息在单屏横向放不下时，应改为横向滑动卡片带，而不是继续把桌面三列定价卡硬塞进小程序宽度。

- `2026-04-26`: 「我的」页左上角的主题切换入口正式使用项目 iconfont，而不是字符符号。当前口径是：暗色主题显示 `icon-zaoshang`，浅色主题显示 `icon-wanshang`；这样能与首页问候区的图标体系保持一致，也便于后续统一做视觉微调。

- `2026-04-26`: 积分充值页“选择档位”区域的正式口径调整为定价卡式 UI，而不是轻量信息卡。每个档位卡至少包含：顶部徽章（如“最受欢迎”/“当前套餐”）、标题、副标题、按当前周期联动的价格、大数字主视觉、能力点列表和底部 CTA；选中卡需要更强的描边和浮起感，整体视觉可参考桌面定价表，但需适配小程序三列布局。

- `2026-04-26`: 积分充值页 Hero 顶部不再保留额外的产品标题和说明文案。正式口径是：顶部只保留徽章视觉和积分状态卡，不再显示“食探会员”标题与“按使用强度选套餐...”说明，避免首屏信息密度过高、与导航标题重复。

- `2026-04-26`: 「我的」页左上角主题切换不能只保留样式定义，必须确保 JSX 节点真实渲染。正式口径是：`src/pages/profile/index.tsx` 需要显式接入 `useAppColorScheme()` 并渲染 `.profile-theme-chip`，点击调用 `toggleScheme()`；否则即使 SCSS 还在，入口也会在合并后“看起来有样式、实际完全消失”。

- `2026-04-26`: GitHub Actions 的后端自动部署不能再直接假设服务器上的 `deploy_backend.sh` 具有可执行位。正式口径是：workflow 远端必须用 `bash` 显式执行部署脚本，并提供脚本路径回退（根目录 `deploy_backend.sh`、仓库内 `deploy/scripts/deploy_backend_v2.sh`、`deploy/scripts/deploy_backend.sh`）；同时支持可选 `DEPLOY_PORT`。这样即使服务器脚本权限不一致，也不会再因为 `permission denied` 卡死自动部署。

- `2026-04-26`: 当日代谢页这类使用 iconfont 的工具按钮和标题/摘要图标，不能继续依赖默认文本基线对齐。正式口径是：返回箭头、标题图标、顶部按钮图标和摘要卡图标统一使用固定宽高的块级元素，并显式设置对应的 `line-height` 与 `text-align`，否则在不同宿主/字体回退下很容易出现“图标在按钮里漂移”的问题。

- `2026-04-26`: 分享海报上的多图角标能否显示，不只取决于前端 canvas 绘制，还取决于记录详情接口是否补回 `image_paths`。正式口径是：`/api/food-record/{id}` 和 `/api/food-record/share/{id}` 必须与列表口径一致，在记录缺少 `image_paths` 但存在 `source_task_id` 时，从来源分析任务补全多图；否则分享海报会误判成单图记录，导致右上角角标完全不出现。

- `2026-04-26`: 分享餐食海报的多图计数角标不能继续作为预览弹层外层的绝对定位浮层来显示。正式口径是：`共 N 张` 必须直接绘制在海报图片区域右上角，这样导出的海报图片、首页分享弹层、记录详情分享弹层三者位置一致；角标底色使用更淡的浅绿色系，避免抢主图视觉。

- `2026-04-26`: 首页“今日餐食”的超标 warning 卡片在黑色主题下不能只沿用浅色系红底。正式口径是：`meal-item.is-warning` 以及其时间胶囊、目标值、宏量、完成度、图片角标等子元素都要切到高对比深红系暗色样式；同时相关 `warning/error` 信息面板也应使用稳定实色深底，避免在暗色模式下出现半透明发灰的观感。

- `2026-04-26`: 用户在分析结果页点击“记录”后，首页的“今日餐食”与今日摄入不能只依赖后端异步回刷。正式口径是：保存成功后必须立即把今天的本地 dashboard 快照同步更新，再通知首页优先吃本地快照回填 UI；随后再异步拉云端 dashboard 做最终校正。这样用户返回首页时能立刻看到新增的那餐和更新后的摄入值。

- `2026-04-26`: 结果页顶部多图 `Swiper` 不能放在透明滚动层下面。正式口径是：即使页面主体使用全屏 `ScrollView` 覆盖布局，头图固定层也必须保持更高 `z-index`，让横向手势优先到 `Swiper`；否则会出现“界面显示有 1/N 计数，但左右滑没反应”的假多图状态。

- `2026-04-26`: 食物分析页后续不再为“多图实物分析”保留同步直出结果的特例。正式口径是：无论单图还是多图，图片分析都统一先提交后台任务，再进入 `analyze-loading`；用户可直接离开当前页，完成后去分析历史或结果页查看，不再让多图请求把用户卡在分析页原地等待。

- `2026-04-26`: 分析结果页的多图查看正式口径继续使用顶部 `Swiper` 左右切换，而不是把多图压成单张静态封面。多图结果至少保留两处反馈：头图左右滑动切换，以及右下角 `1/N` 计数；当 `imagePaths` 变化时，需要把当前索引纠正回合法范围，避免重进结果页时停在越界索引。

- `2026-04-26`: 食物分析接口中的 `modelName` 不能再被直接当成单一 provider 的“裸模型名”透传。正式口径是：`doubao / doubao-seed-2-0-lite-260428` 走 Doubao 千问视觉链路；`gemini / gemini-*` 走 OfoxAI Gemini 链路。这个口径同时适用于 `/api/analyze` 和 `/api/analyze/batch`，否则前端传 `modelName: "gemini"` 时，多图 batch 会把 Gemini 错发到 Doubao，导致整批失败。

- `2026-04-26`: 多图食物分析 `/api/analyze/batch` 的正式口径是“复用单张分析结果结构，而不是另起一套返回形状”。稳定字段至少要与单张 `AnalyzeResponse` 对齐：`description / insight / items / pfc_ratio_comment / absorption_notes / context_advice`，以及严格模式下的 `recognitionOutcome / rejectionReason / retakeGuidance / allowedFoodCategory / followupQuestions`。

- `2026-04-26`: 批量食物分析不应对所有图片做无限并发直打模型。正式口径改为：批量识别最多并发 `3` 张，并对单张识别做有限重试；否则在 Doubao 限流或短时波动下，很容易把整批请求一起打成失败。

- `2026-04-26`: 多图批量分析允许“部分成功”。正式口径是：只要至少有 1 张图成功，就应返回汇总结果并把失败图片下标写入任务 `payload.failed_indices`，不要因为其中 1 张失败就整批直接返回 500；只有全部图片都失败时，才返回“所有图片分析均失败，请稍后重试”。

- `2026-04-25`: 小程序页面里凡是“底部 fixed/sticky 操作区”都不能只改外层页面背景，必须单独做暗色适配。正式口径是：像 `analyze-page .confirm-section` 这类固定底栏，需要同时覆盖容器本身、主按钮、禁用态、次级入口按钮和内部开关控件；否则黑色主题下会出现底栏发白、禁用按钮像浅色残留、开关控件跳出页面体系的问题。

- `2026-04-25`: 对于明确指定到某个页面 SCSS 文件的暗色适配需求，不能只把规则写进全局 `src/styles/fl-color-scheme-dark.scss`。正式口径是：全局暗色文件负责统一兜底，但页面自己的 `index.scss` 也要能直接看到对应的 `.fl-page-theme-root--dark` 局部样式块，方便排查和后续维护。

- `2026-04-25`: 暗色主题基础面板的正式口径改为“全部使用不透明深色底”，不再使用 `rgb(... / alpha)` 或 `rgba(...)` 透明面板变量。包括 `$fl-dark-panel-bg`、`$fl-dark-panel-bg-strong`、`$fl-dark-panel-bg-soft`、`$fl-dark-input-bg`、`$fl-dark-ghost-bg`、`$fl-dark-modal-bg` 等都应保持实色，否则在分析历史、分析结果这类有叠层和左滑操作的页面里，会出现下层内容透出、卡片发灰或像蒙了一层雾的视觉问题。

- `2026-04-25`: 图片结果页在暗色主题下不能只做“整卡变深”。正式口径是：`result-page` 的 `execution-mode-row`、`total-weight-badge`、`insight-item` 及其不同语义变体（`intro/highlight/ratio/absorption/context`）都必须单独做深色收口；否则从分析历史页进入图片结果页时，会出现“整体是暗色，但 AI 分析部分仍像白卡浮在页面上”的割裂感。

- `2026-04-25`: 暗色主题下，分析历史页 `.task-card` 不能复用半透明的 `$fl-dark-panel-bg`。正式口径是：该页卡片必须使用不透明深色背景，否则左滑露出的 `分享 / 删除` 操作区会从卡片底色透出来，造成“卡片内容被遮蔽但颜色还在漏”的错觉。

- `2026-04-25`: 分析历史页不能继续依赖小程序原生导航栏的“当前栈决定显示返回/主页”逻辑。正式口径改为：该页使用 `navigationStyle: 'custom'` + `CustomNavBar`，并复用“上一页是 Tab 则 `switchTab`，否则 `redirectTo`，最后兜底回首页”的返回策略，避免在某些入口下左上角出现主页图标而不是返回箭头。

- `2026-04-25`: 分析历史页的左滑操作区不应遮挡卡片主信息。正式口径是：`分享/删除` 只保留紧凑操作宽度，来源/状态/精准标签必须留在卡片主内容区可见范围内，不能放在一左滑就被盖住的最右列。

- `2026-04-25`: 分析历史页的文字记录缩略图，不再使用通用图标占位。正式口径改为：若任务来源是 `food_text` 且无图片，则从 `text_input` 提取前 1-4 个字做文本头像封面；这样用户在历史列表里能直接辨认不同文字记录，而不是看到一排相同的占位图标。

- `2026-04-25`: 分析历史页后续的卡片信息层级固定为“标题 / kcal / 来源说明 / 时间 + 右侧标签组”，不要再回退到只有热量和时间的扁平列表。历史页属于高频浏览入口，必须优先保证扫读效率。

- `2026-04-25`: 文字记录链路在 `analyze-loading` 和 `result` 页的顶部无图占位区，正式口径改为“优先展示用户本次输入的原始文字”，数据源统一取 `analyzeTextInput`。不能继续固定写“文字记录，未提供实物照片”，否则用户在文字链路里看不到自己刚输入的内容。

- `2026-04-25`: 分析结果页后续必须跟随应用 `scheme` 切换整页深色皮肤，不能只停留在导航栏或页面外层背景。正式口径是：`src/packageExtra/pages/result/index.tsx` 需接入 `useAppColorScheme + applyThemeNavigationBar(...)`，并通过 `.result-page--dark` 统一覆盖无图占位、营养概览卡、AI 分析卡、成分卡、底部固定栏、餐次弹窗和纠错抽屉，避免深色模式下出现大面积白卡漏光。

- `2026-04-25`: `dev:weapp` 当前的 Sass 噪音治理口径固定为“两层收口”：
  - 项目内自有 `.scss` 不再新增 `@import`，可迁移处优先改为 `@use` / `meta.load-css`
  - Vite Sass 预处理统一开启 `quietDeps`，并静默 `legacy-js-api`、`import` 这两类依赖链 deprecation；否则 `npm run dev:weapp` 会被第三方 Sass warning 持续刷屏，掩盖真正的编译错误

- `2026-04-25`: `src/assets/iconfont/iconfont.css` 的 `@font-face` 不再保留 `svg` 字体源。当前小程序构建链会对 `iconfont.svg?...#iconfont` 持续打印 “didn't resolve at build time” warning，而项目实际已由 `woff2 / woff / ttf` 覆盖运行需求。

- `2026-04-25`: `src/packageExtra/pages/record-text/index.tsx` 的“开始智能分析”正式交互收口为“点击即提交”，不再额外弹“确认分析”二次确认框；提交成功后必须统一跳到 `${extraPkgUrl('/pages/analyze-loading/index')}?...`，不能再写裸 `/pages/analyze-loading/index`，否则分包页里会出现确认后停留原页无反应的问题。

- `2026-04-25`: 本项目后续正式校验入口固定为 `npm run lint` 与 `npm run typecheck`。其中：
  - `lint = eslint src --ext .ts,.tsx --max-warnings 0`
  - `typecheck = tsc --noEmit --pretty false`

- `2026-04-25`: `food_link` 代码库当前存在大量历史性的 `unused vars` 与 `react-hooks/exhaustive-deps` 警告，不再作为 lint 阻断项。正式口径改为：lint 只拦截硬错误；这两类警告在后续大规模重构时再统一治理，避免继续阻断日常开发。

- `2026-04-25`: `tsconfig.json` 需保持 `skipLibCheck=true`，避免 Taro/平台声明文件噪音淹没业务代码真实错误；同时关闭 `noUnusedLocals / noUnusedParameters`，把“未使用变量”留给 ESLint 策略管理，而不是让 TypeScript 编译直接失败。

- `2026-04-25`: 会员充值页顶部 Hero 的视觉方向继续固定为“深绿会员感 + 中心徽章 + 半透明积分玻璃卡”，并尽量贴近用户提供的参考图。该区域应优先突出标题与积分余量，不再回退到浅色或普通营销横幅样式。

- `2026-04-25`: 当前 `weapp-devtools` 环境里，`mrc errors` / `mrc logs error` 可稳定返回，但 `pageInfo`、`relaunch`、`exists`、`stack` 以及 `miniprogram-automator` 的页面回执类操作会再次出现长时间挂起。后续小程序运行态验证若复用当前环境，需要优先把这个自动化卡顿视为独立阻塞，而不是误判成页面代码报错。

- `2026-04-25`: `src/pages/profile/index.tsx` 属于主包 Tab 页，但它跳往会员、档案、保质期、好友管理、个人设置等非 Tab 页面时，必须统一使用 `extraPkgUrl(...)`；不能继续写裸 `/pages/...`，也不能漏掉 `extraPkgUrl` import，否则小程序运行时会出现 `ReferenceError` 或页面路径错误。

- `2026-04-25`: 会员充值页后续需要跟随应用 `scheme` 切换导航栏与整页深色皮肤；不能只改 `page` 背景色。正式口径是：`src/packageExtra/pages/pro-membership/index.tsx` 通过 `useAppColorScheme + applyThemeNavigationBar(...)` 控制导航栏，样式层通过 `membership-page--dark` 覆盖 Hero、卡片、对比表、说明卡与按钮。

- `2026-04-25`: 如果要给用户手动补会员，而系统当前没有对应正式套餐编码（例如“半年卡”），优先采用“保留或追加原到期时间，不缩短现有权益 + 切到目标档位权益”的处理方式；本次锦恢账号按该口径处理，权益升到进阶版、每日积分 `40`，并在原到期日基础上追加 `6` 个月。

- `2026-04-25`: 会员页使用自定义导航栏时，左上角返回不能再直接依赖 `Taro.navigateBack()`。正式口径是：读取上一页路由；若上一页是 Tab（如 `pages/profile/index`），必须用 `Taro.switchTab(...)` 返回；若不是 Tab，再走 `normalizeRedirectUrlForSubpackage(...) + Taro.redirectTo(...)`，最后兜底回 `/pages/profile/index`。

- `2026-04-24`: `food_link` 项目后续默认不由代理操作任何本地常驻进程。启动、停止、重启前后端一律默认由用户自己手动执行；除非用户在当前对话里明确要求，否则代理只能改代码并提醒用户自行运行，避免抢占 `3010`、干扰用户自己的调试会话。

- `2026-04-24`: 为避免本地 `3010` 被残留后端长期占用，项目增加 `npm run stop:backend` 作为标准清理入口。后续优先用该脚本清掉 `backend.pid` 或占用 `3010` 的 `run_backend.py` 进程，而不是每次手查 PID。

- `2026-04-24`: 食物测试后台后续的主工作流应切到“可复用测试集”。ZIP 仍可作为导入格式保留，但不应要求用户每次批量评测都重新上传 ZIP；正式口径应支持把服务器本机目录中的标准测试集导入并持久化到云端，之后在后台列表中重复载入为新批次。

- `2026-04-24`: 用户已再次明确：当前这轮只需要把代码写好，不需要本地运行验证或端口排查；除非用户后续单独要求，否则这次“可复用测试集”改造按代码交付口径推进。

- `2026-04-24`: 对于“可复用测试集”，未标注样本既然导入时已忽略，就不应继续出现在样本数展示里。测试集列表的 `itemCount` 必须表示“实际可测样本数”，而不是源目录总图片数；像 `33/37` 这种展示口径视为错误。

- `2026-04-24`: 为了降低食物回归测试成本，可以在完整测试集之外维护一个“小型回归集”。当前口径允许从完整已标注样本集中按固定随机种子抽样生成，例如 `mini10`；抽样必须可复现，并作为独立的可复用测试集保存。

- `2026-04-24`: 食物测试后台里的“测试模型”选项收口为两个 Gemini 具体型号：`gemini-3-flash-preview` 与 `gemini-3.1-flash-lite-preview`。Doubao 及其他模型不再出现在测试后台单图/批量/测试集批次的可选项中。

- `2026-04-24`: 为方便做 prompt 实验，食物测试后台的“分析体验 / 批量测试 / 可复用测试集批次”后续默认优先读取 `model_prompts` 表中当前激活的 `gemini` 提示词，不再默认走 `backend/worker.py::_build_food_prompt`。仅当 Gemini 激活提示词为空时，才允许回退到 worker 默认 prompt。`standard/strict` 暂时保留为实验标记字段，不再决定测试后台实际使用的 prompt 文本。

- `2026-04-24`: 用户本地数据集脱敏的正式口径是：图片文件名不得再带重量、食物名或参考物等标签信息，统一改成匿名样本名；标签必须单独放在 `labels.txt`。若已有逐项食物克重，用 `items` 格式写入；只有整餐总重量时，用 `total` 格式写入。原始带标签文件夹保留不动，脱敏后数据集在新目录中维护。

- `2026-04-24`: 本轮本地 `food_test` 脱敏数据集整理中，未标注样本直接忽略，不纳入上传包，也不作为当前待补标签任务。

- `2026-04-24`: 会员页保留的 `[DEV]` 测试开通能力，正式口径必须改为“作用于当前登录用户，并按当前所选有效套餐 code 开通/关闭”，不能再写死测试用户或旧套餐 `pro_monthly`。这样测试 9 档套餐时，前端所见状态、`/api/membership/me` 和 `user_pro_memberships.daily_credits` 快照才能保持一致。

- `2026-04-24`: 会员积分计算里，“运动记录回退投递到 food_text* 队列”的任务不能再被算作食物分析积分。正式口径是：`analysis_tasks.task_type in {food, food_text, food_debug, food_text_debug}` 仅在 `payload.exercise != true` 时才计入食物分析 2 分；运动始终只按 `user_exercise_logs` 的 1 分/条计算。

- `2026-04-24`: 会员前端展示口径继续收敛：
  - 轻度版 `9.9/月` 不含精准模式；精准模式只对标准版、进阶版开放。当前是轻度版时，分析页点击“精准”必须提示“升级到标准版/进阶版”，不能再误写成“开通食探会员即可使用”
  - 会员相关积分展示统一优先使用“已用 / 总额 + 剩余”语义，避免 `3/8`、`5/8` 这类未标注到底是“已用”还是“剩余”的歧义
  - 会员购买页的套餐对比表只写当前真实已上线差异；计划指导、强督促等未开放能力不再提前承诺

- `2026-04-24`: 精准模式权限判断不能只看 `is_pro`。正式口径统一为：只有 `standard` / `advanced` 付费会员才能开启 `strict`；`light` 虽然是会员，但一律视为“需升级”。这个判断要在分析页、健康档案创建页、健康档案编辑页统一复用，避免同一账号在不同页面出现“有的地方能开精准、有的地方不能”的割裂体验。

- `2026-04-24`: 会员购买页对轻度版会员要显式展示升级路径，而不是只展示当前套餐。正式口径是：页面应告诉用户“当前不含精准模式”，并提供直达标准版/进阶版的升级引导；不能让用户自己猜该点哪个套餐。

- `2026-04-24`: 食物分析积分限制不再只是展示态。正式口径改为：`/api/analyze`、`/api/analyze/submit`、`/api/analyze-text`、`/api/analyze-text/submit`、`/api/precision-sessions/{session_id}/continue` 都必须在提交前按 `daily_credits_remaining` 做硬拦截；不足时返回 `402`，前端各入口也同步做本地预拦截。当前仍是按“今日已发生行为计数”试算，不是独立积分流水原子扣减。

- `2026-04-24`: 运动记录也必须纳入同一套积分硬拦截，不能只拦食物分析。正式口径是：`POST /api/exercise-logs` 提交前按 `daily_credits_remaining` 校验，运动记录消耗 `1` 积分/次；前端 `exercise-record` 页面也要在提交前做本地预拦截，不允许在剩余 `0` 分时继续创建运动任务。

- `2026-04-23`: 食物识别测试后台标准标签正式支持两种模式：`total`（整餐总重量）与 `items`（每种食物 + 标准克重）。`total` 可写 `图片名 500g` 或 `图片名 | 总重量=500g`，只评估整餐总重量偏差；`items` 推荐写 `图片名 | 食物=克重; 食物=克重`，同时评估总重量偏差与逐项匹配/缺失/额外识别/克重偏差。两种模式可在同一个批量 ZIP 的 `labels.txt` 中混用。

- `2026-04-23`: 测试后台的“分析体验/批量测试”必须使用当前食物识别主链路 prompt，即 `backend/worker.py::_build_food_prompt` 按 `execution_mode=standard|strict` 动态生成。`model_prompts` 表仍可保留为提示词管理/后台配置能力，但不得让用户误以为它就是当前拍照识别主链路 prompt。

- `2026-04-23`: 食物识别模型评测需支持同一输入同时跑多个 provider（当前 `doubao`、`gemini`），并在结果里保留每个模型的总重量偏差、逐项克重偏差、缺失项与额外识别项，方便 prompt 或模型变更后的回归对比。

- `2026-04-21`（实现口径）：三档 × 三周期会员已在本代码库落地一期。正式实现口径：
  - 9 档套餐落在 `membership_plan_config`，每档带 `tier ∈ {light, standard, advanced}` + `period ∈ {monthly, quarterly, yearly}` + `daily_credits` + `original_amount` + `sort_order`；订阅成功时把所选套餐 `daily_credits` 快照写入 `user_pro_memberships`，之后一律以快照为准，不随后台配置改动而改变已购用户权益
  - 积分状态以后端 `/api/membership/me` 为唯一真源：免费试用按注册顺序分层，前 `1000` 名注册用户为 `30` 天试用、之后新用户为 `3` 天试用（两类试用均每日 `8` 积分）；付费用户按自己套餐的 `daily_credits`；积分消耗口径固定为「食物分析 2 / 运动记录 1」；`credits_reset_at` 始终按用户本地中国时区次日 0 点返回；积分当日有效、次日清零、永不累计
  - 前端不再依赖旧的「今日拍照 x/y」口径，会员页与我的页统一改为「今日积分 x/y」与 `trial_active / trial_expires_at` 显示
  - 当前仍未引入独立积分流水表，会员积分继续按“基础配额 + 奖励积分 - 当日已发生行为计数”试算；扣减 enforcement 已落地，邀请/分享奖励也已接入，但微信自动续费与 `user_membership_payments.pending` 清理仍推迟到后续阶段

- `2026-04-21`: `food_link` 对外商业计划书与品牌沟通中，统一使用 `食探（智健食探）` 表达；其中 `食探` 作为品牌简称，`智健食探` 作为小程序正式名称建议。商业计划书风格采用“精简、抓核心痛点、弱化尚未正式付费验证”的对外口径，不把早期自愿付费样本作为核心卖点。

- `2026-04-21`: `食探（智健食探）` 会员订阅草案采用三档订阅 + 每日积分清零：轻度版 `9.9/月、27.9/季、99/年`，每天 `8` 积分；标准版 `19.9/月、56.9/季、199/年`，每天 `20` 积分；进阶版 `29.9/月、84.9/季、299/年`，每天 `40` 积分。新用户免费体验 `3` 天，每天 `8` 积分。积分当天有效、不累计。运动记录 `1` 积分/次，基础记录/基础分析 `2` 积分/次。超额后等待次日恢复、升级更高会员或邀请好友获取额外积分。邀请双方在被邀请人完成 1 次有效使用后，连续 3 天每天 `+5` 积分，每月设置上限防刷。分享海报奖励 `1` 积分，建议每日上限 1 次。订阅支持自动续费，月卡/季卡/年卡同时提供，页面展示“立省 xx 元”。

- `2026-04-10`: `food_link` 真机调试不得继续使用 `dev:weapp` 默认注入的 `http://127.0.0.1:3010`。在真机上，`127.0.0.1` 永远指向手机自身；若要联本地后端，必须改成开发电脑的局域网 IP；若要联体验版后端，使用 `build:weapp:preview / dev:weapp:preview` 走 `https://dev.healthymax.cn`；若要联正式线上后端，使用 `build:weapp:release / dev:weapp:online` 走 `https://healthymax.cn`。

- `2026-04-10`: 小程序端应避免直接在页面 JSX 中渲染原生 `<svg>` 作为常规图标方案。当前 `tmpl_0_svg not found` 已定位到多处直接 `<svg>` 写法；后续图标实现优先使用 iconfont、图片资源或其它 weapp 兼容方案。

- `2026-04-10`: 互动消息点击动态的定位链路不能再依赖社区页当前 Feed 的筛选、缓存列表或分页 offset。正式口径改为：通知跳转优先按 `record_id` 直取单条动态上下文，再在社区页插入并滚动到目标动态；评论/回复类通知再按 `comment_id / parent_comment_id` 补拉完整评论区并打开输入框。

- `2026-04-10`: 互动消息通知也必须具备防重复能力。`create_feed_interaction_notification_sync()` 需要按“同接收人 + 同触发人 + 同动态 + 同通知类型 + 同文案”做短时间幂等；若 `comment_id` 完全相同则直接视为同一事件，不得重复插入通知。

- `2026-04-10`: 历史重复互动通知的清理口径与评论清理一致，默认按 `45` 秒窗口分簇：同接收人、同触发人、同动态、同父评论、同通知类型、同文案在窗口内出现多条时，只保留最早一条。

- `2026-04-10`: 运动热量估算在 `gemini-3-flash-preview + Instructor` 组合下，遇到“高强度动作描述 + 完整画像快照”时可能因 reasoning token 膨胀触发 `max_tokens length limit`。正式口径改为：保留 Instructor 结构化主链路，但若命中“输出被截断”，必须自动降级到“短 JSON fallback”再次估算；同时主提示词与 schema 需强约束 reasoning 只保留 1-2 句短依据，避免长推导再次撑爆。

- `2026-04-10`: 对于“一条文本里包含多项运动”的描述，后端应自动按换行/分号/句号拆分为多个分项，再逐项估算后求和，不要求用户手动拆条。分项估算优先走短 JSON / 数字输出的轻链路；若单项仍拿不到可解析结果，则允许退化到基于 `运动关键词 + 时长 + 体重` 的规则估算，目标优先保证“不报错、能落结果”。

- `2026-04-10`: 运动热量估算模型当前直接在程序里写死为 `google/gemini-3.1-flash-lite-preview`，不再通过 `EXERCISE_CALORIES_MODEL_NAME` 环境变量切换，避免本地/线上环境变量漂移影响这条专用链路。

- `2026-04-08`: 手动记录的产品形态从“浏览食物表”收口为“搜索优先单餐工作台”。空搜索时优先展示 `最近常吃 / 收藏优先 / 公共库推荐 / 标准营养词典` 四层；有搜索词时统一走远程搜索混排，不再依赖前端本地筛选和“两栏 tab 切换”。

- `2026-04-08`: 手动记录保存时必须保留来源身份。当前口径是把 `manual_source / manual_source_id / manual_source_title / manual_portion_label` 写进 `user_food_records.items[]` 的 JSON 快照里，而不是额外新建表；这样能在不改主表结构的前提下，支撑“最近常吃 / 同食物复用 / 收藏优先”。

- `2026-04-08`: 手动记录的主链路交互改为“重复点击直接累加”。同一个食物再次点击不再提示“已添加”，而是默认增加一份或一组默认克重；保存成功后统一跳转到 `pages/day-record/index` 的当天页，让用户看到“这顿饭已经记上了”。

- `2026-04-08`: 圈子评论提交必须具备“双层防重复”保护。前端 `community` 评论发送需要同时拦截 `in-flight` 重复触发和短时间同内容连点；后端 `feed_comments` 写入前也必须按“同用户 + 同动态 + 同回复目标 + 同内容 + 短时间窗口”做幂等去重，并在命中重复时跳过再次写互动通知。

- `2026-04-08`: 历史圈子重复评论的清理口径与线上防重保持一致，但窗口放宽到 `45` 秒：同用户、同动态、同回复目标、同内容在 `45` 秒内出现多条时，只保留最早一条，其余视为重复提交清理。

- `2026-04-08`: 运动热量估算链路不得把大模型的非标准返回静默降级为 `0 kcal` 并直接入库。若无法可靠解析，应将任务标记为失败；解析时优先识别带 `kcal/千卡/大卡` 的数字，兜底再取候选数值中的最大值，避免把“30分钟”误写成 `30 kcal` 或 `0 kcal`。

- `2026-04-08`: 运动热量估算改为「思考过程 + 千卡」结构化 JSON（`reasoning` + `calories_kcal`），不再要求模型只吐单个数字；思考过程落库字段 `user_exercise_logs.ai_reasoning`（需执行 `backend/sql/add_exercise_ai_reasoning.sql`），任务结果与试算接口同步返回 `reasoning`。

- `2026-04-08`: 运动热量估算必须结合用户画像快照：优先使用 `user_weight_records` 最近体重，没有则回退 `weapp_user.weight`；并一并透传 `height / gender / birthday(age) / activity_level / bmr / tdee`。异步任务在提交时将该快照写入 `analysis_tasks.payload.profile_snapshot`，worker 执行时优先使用该快照，缺字段再回源补齐。

- `2026-04-08`: 本地联调运动任务时，不能继续直接投递共享主队列 `task_type=exercise`，否则会被同一 Supabase 上的旧环境 worker 抢走并按旧逻辑处理。当前本地口径是开启 `FOOD_DEBUG_TASK_QUEUE=1` 后，将 `POST /api/exercise-logs` 直接投递到 `food_text_debug + payload.exercise=true`，由本地 debug worker 内部转到 `process_one_exercise_task`。

- `2026-04-07`: 保质期提醒正式收口到 `pages/expiry/* + /api/expiry/* + food_expiry_items` 新链路，旧 `pages/food-expiry/*` 不接订阅提醒能力。

- `2026-04-07`: 保质期微信通知采用“小程序订阅消息”而不是服务号模板通知；V1 仅在新增成功后的当次交互里申请订阅，默认只在到期当天提醒一次，调度时间固定为当天 `09:00`（若用户当天晚于该时间才订阅，则尽快补发）。

- `2026-04-07`: 保质期订阅消息里若模板字段使用 `character_string`，后端不得直接透传中文 `quantity_note`；发送前必须统一清洗成 ASCII 安全字符串，空值或全中文备注降级为 `NA`，避免微信报 `argument invalid! data.character_string*.value`。

- `2026-04-07`: 小程序 `app.json` 的 `permission` 只保留合法权限声明（当前保留 `scope.userLocation`）；`scope.camera` 属于无效键，不再写入配置。

- `2026-04-07`: 为兼容微信开发者工具历史启动页缓存，保留 `pages/food-expiry/index` 兼容路由页，仅用于自动跳转到 `pages/expiry/index`，不承载业务逻辑。

- `2026-04-07`: 统计页 `fetchStats` 不能再让本地缓存解析影响云端主链路。即便 `/api/stats/summary` 与 `/api/body-metrics/summary` 返回 200，也必须对 `body_metrics_storage` 做结构校验并“按需读取”（仅在云端缺数据时兜底），避免脏缓存触发前端 `获取统计失败`。

- `2026-04-05`: 食物保质期功能 V1 的入口放在"我的"页面服务网格，首页只展示已设置好的临期摘要，不承担设置职责。

- `2026-04-05`: 首页"快到期食物"卡片仅在用户当前存在待处理保质期食物时显示；若从未设置或当前待处理数为 `0`，首页整块直接隐藏，不显示空状态占位。

- `2026-04-05`: 食物保质期数据采用独立表 `food_expiry_items` 作为唯一主表管理，不挂在 `health_condition` 等用户 JSON 字段里；旧 `user_food_expiry_items` 与 `/api/food-expiry/*` 已下线，首页与“我的”统一走 `/api/expiry/*`。

- `2026-04-05`: 食物保质期 V1 只支持手动录入，暂不与饮食记录、公共食物库、服务号通知联动。

- `2026-04-05`: 食物保质期支持两种截止精度：`date`（按当天 `23:59:59` 处理）和 `datetime`（按具体时分处理）；状态不单独存库，由 `completed_at + deadline_at` 派生。

- `2026-04-05`: 个人页服务网格中的 `Pro会员` 入口属于测试入口，当前产品阶段对用户侧隐藏；仅移除服务网格测试入口，不影响顶部"食探会员"卡片和既有会员页面路由。

- `2026-04-01`: 精准模式重新恢复开发，不再沿用“前端彻底关闭 strict”的临时策略。新的正式口径是“多轮精准会话”：`strict` 提交后先进入规划阶段，再根据结果进入 `追问补充 / 建议重拍 / 并行分项估计 / 聚合最终结果`。

- `2026-04-01`: 精准模式的状态机当前收口为 `collecting / needs_user_input / needs_retake / estimating / done / cancelled / failed`。会话主状态放在 `precision_sessions`，轮次问答放在 `precision_session_rounds`，多主体并行估计放在 `precision_item_estimates`。

- `2026-04-01`: 精准模式的“参考物”必须走结构化字段透传，而不是只塞进自由文本。当前统一使用 `reference_objects[]`，每个参考物包含 `reference_type / reference_name / dimensions_mm / placement_note / applies_to_items`，供规划器和分项估计器共同使用。

- `2026-04-01`: 多食物精准估计默认不再让一个模型注意整餐一次做完；正式链路改为“先拆主体，再对子项并行估计，最后聚合”。只有明确单主体时才允许 `single_item` 直接进入单项估计，其余可拆分场景优先 `multi_item_parallel`。

- `2026-04-01`: 体重记录不能再按"每天最多 1 条"处理。正式口径改为：同一天允许记录多次；首页变化文案按"最近一次 vs 上一次"计算，不再默认绑到"昨天"；统计趋势按"每天最后一次"聚合展示。

- `2026-04-01`: 放开同日多次体重记录后，云端同步必须补幂等键。当前收口为：`user_weight_records` 引入 `client_record_id` 作为客户端记录 ID，并移除 `(user_id, recorded_on)` 唯一约束；本地旧体重迁移到云端时优先按 `client_record_id` 去重，没有客户端 ID 时再按"同日同体重"保守去重，避免重复导入。

- `2026-04-01`: 首页喝水弹层的快捷量按钮属于"即时动作"，点击后应直接记一杯并关闭弹层；只有自定义输入量才保留"填写后点保存"的交互。饮水统计仍按自然日累计：第二天首页今日值自动从 `0` 开始，但历史天数据保留用于统计页趋势。

- `2026-04-01`: 首页体重/喝水弹层不能再贴底顶着自定义 tabBar。产品实现口径改为"浮起式底部卡片"，整体上移到 tabBar 之上，并给底部操作区和清空按钮留出稳定点击空间。

- `2026-04-01`: 首页 `今日餐食` 卡片也应遵守"先看图、再看字"的口径。每个餐次卡片默认展示该餐次当天记录里的代表图；若同餐次有多张照片，则保留可预览图片列表并显示张数角标；只有没有实物图时才回退到餐次图标占位。

- `2026-04-01`: 体重/喝水能力不再停留在首页本地 storage。正式口径改为"云端为主、本地兜底"：已登录用户的体重记录、喝水日志、喝水目标都应写入云端；旧首页本地缓存允许作为迁移来源自动补同步，避免之前已记的数据直接丢失。

- `2026-04-01`: 统计页的长期分析不仅看热量和宏量营养素，还要纳入体重与喝水。当前收口为：`GET /api/stats/summary` 直接返回 `body_metrics` 聚合结果，前端统计页展示体重趋势和喝水趋势，不再把这两类数据留在首页孤岛里。

- `2026-04-01`: 饮食记录的商业化口径从"每日次数限制"转向"积分制"。当前拟定的基础规则是：`标准分析 1 积分/次`、`精准分析 3 积分/次`、`新用户赠送 20 积分`，积分仅对 `拍照记录` 与 `文字记录` 生效。

- `2026-04-01`: `手动记录` 必须作为独立记录模式新增，且永久免费。手动记录不走 AI 分析，不消耗积分；其食物选择链路优先使用 `public_food_library`，再兜底 `food_nutrition_library + food_nutrition_aliases`，未命中再进入 `food_unresolved_logs` 供后续词典扩充。

- `2026-04-01`: 用户明确否定"首页体重/喝水做成独立大卡片模块"的方向。正确口径应是：它们只是首页里的极轻量快捷操作，视觉重量必须低于热量卡和三大营养素卡，按钮尺寸应接近甚至小于营养素卡里的百分比徽标。

- `2026-04-01`: 首页里的体重/喝水即使做成直出，也必须保持"辅助信息"定位，不能压过热量总览与饮食记录主链路。布局上应让热量卡保持首页主视觉，体重/喝水采用更轻、更小的二级卡片表达。

- `2026-04-01`: 体重记录文案不能默认假设"每日 1 次"。产品口径应允许用户按自己节奏补记，比较文案优先使用"较上次"而不是强绑定"较昨日"。

- `2026-04-01`: 圈子评论回复输入栏必须采用稳定的底部 composer 结构，回复提示条与输入框不能再塞进同一横向行里；实现上优先避免 `Textarea autoHeight + fixed` 这类容易导致键盘顶起抖动的组合，确保"点回复后输入框立即可见、位置稳定"。

- `2026-04-01`: "食物保质期记录与提醒"功能当前产品定位应按"个人管理工具"处理，主入口放在 `我的` 页，而不是首页或健康档案。入口形态不是独立大卡片，而应做成和其他服务一致的小图标入口，放在 `我的` 页顶部功能区、靠近"食探会员"卡片；图标右上角允许显示红色数字角标，用于提示即将过期/待处理食物数量。

- `2026-04-01`: 多视角辅助模式采用严格口径：未开启多视角时，拍照分析只允许上传 `1` 张图片；上传多张图片仅用于"同一份食物的不同视角"。前端需要明确提醒用户"如果要拍多视角，请先开启多视角模式"，后端正式接口也必须做同样的硬校验，不能只靠 prompt 猜测。

- `2026-04-01`: 评论链路现阶段进一步收口为"默认不做审核，直接发布"。圈子评论与公共食物库评论提交后直接入库并立即展示，不再创建 `comment_tasks` 审核任务，也不再向前端展示"已提交审核/审核中"；圈子评论相关互动通知改为在接口层直接写入。

- `2026-04-01`: 体重记录、喝水记录如果要进入 `food_link`，入口不应藏在"健康档案/健康板块"这类二级区域里。产品口径应优先保证"用户一打开就能直接看到并顺手记录"，优先考虑首页直出，而不是先放进设置型或档案型页面。

- `2026-04-01`: 首页新增体重/喝水能力时，信息架构采用"首页一级数据卡"而非"功能入口"。具体位置固定为：首页日期条下方、热量总览卡上方；其中体重卡偏低频状态记录，喝水卡偏高频快捷操作。

- `2026-03-31`: 饮食记录的信息架构改为"三层职责分离"：`pages/stats/index` 负责历史总览与日历入口，`pages/record/index` 只负责新增记录（拍照/文字），点击某一天的饮食记录必须进入独立的"当天记录页"，不能再跳进拍照页。

- `2026-03-31`: 独立"当天记录页"里的每条饮食记录卡片需要在进入详情前就提供图片缩略图预览；有实物图时展示首张照片并允许直接放大预览，无实物图时显示占位 logo，而不是只给纯文字列表。

- `2026-03-31`: 评论审核链路改为复用 OfoxAI OpenAI 兼容接口，与 Gemini 热量识别共用 `OFOXAI_API_KEY` 和 `https://api.ofox.ai/v1`，默认审核模型切到 `openai/gpt-5.4-nano`。

- `2026-03-31`: 评论审核口径改为"宽松优先、明确违规才拦截"。普通吐槽、轻微负面评价、食物语境玩梗、简短回复、情绪化口语默认放行；只有明确色情、暴力威胁、违法引流、政治煽动、强烈辱骂骚扰时才判违规。

- `2026-03-31`: 首页所有达成率展示统一采用"真实百分比文案 + 视觉进度单独裁剪"的口径。三大营养素与各餐次都必须显示真实比例（可超过 `100%`），但圆环/进度条等视觉控件只裁到 `100%`，并且在前端对 `undefined / NaN / 非数字字符串` 做兜底，避免比例条消失或渲染异常。

- `2026-03-31`: 精准模式当前先临时关闭，不再允许用户在前端主动切换到 `strict`。分析页、健康档案问卷、健康档案编辑页点击精准模式时统一提示"该功能仍在完善中"；重新分析/二次纠错提交也统一回落到 `standard`，避免旧缓存或历史任务继续走精准模式链路。

- `2026-03-31`: 用户健康档案中的 `BMR/TDEE` 计算口径从 Mifflin-St Jeor 切换为更贴近中国成人样本的毛德倩公式；其中 `BMR` 改为按 `性别 + 体重` 计算，`TDEE` 仍保持 `BMR × 活动系数`。相应地，后端不再要求必须先有生日/年龄和身高才生成 `BMR/TDEE`。

- `2026-03-31`: 圈子互动消息不再只覆盖评论/回复/驳回，需补齐 `like_received`。用户给动态点了赞时，只要是"新增点赞"且作者不是自己，就应给作者写入一条站内互动通知。

- `2026-03-31`: 圈子评论里的"回复某人"不能再只靠一段行内文字表达；回复项在视觉上必须与普通评论拉开层级，至少要明确呈现"回复目标 + 差异化内容气泡/引导线"，避免看起来像两条互不相关的独立评论。

- `2026-03-31`: 图片模式二次纠错不能只按"纠错后的食物名"做匹配；请求侧必须携带原项身份（至少 `sourceName`，优先 `sourceItemId`），后端应按"原项替换"而不是"新名字追加"，避免把 `橘子 -> 橙子` 这类改名误处理成新增一项。

- `2026-03-31`: 图片模式二次纠错弹窗里提交的 `correctionItems` 代表用户确认后的"完整最终食物清单"，不是给模型参考的局部提示。Worker 最终写回结果时，数量、顺序、名称、克重都必须以这份清单为准，不能再把模型额外生成的旧项或重复项保留下来。

- `2026-03-31`: 图片模式二次纠错里，如果用户没有手动改列表，而是在补充说明里明确写出改名关系（如 `不是橘子，是橙子`、`炸肉饼实际上是牛肉饼`），前端必须先把这类自然语言翻译成结构化改名再提交；未显式改名的旧 `correctionItems` 不能把模型已经识别出的更具体新名字强行覆盖回去。

- `2026-03-31`: 文字模式二次纠错也需要与图片模式保持相同的"结构化优先"口径：前端不能再丢弃 `correctionItems`，补充说明中的明确改名也应先转成结构化清单；后端文字链路在模型返回后同样要按用户确认清单收口，避免名称、数量或重量又漂回去。

- `2026-03-31`: 二次纠错里的自由文本说明不能再被当成次级"补充信息"；它应是最高优先级的纠错输入。结构化 `correctionItems` 主要负责锁定最终食物列表、顺序和明确重量。前后端都需要支持把口语化表达（如 `X 说得太模糊了，这是 Y`）解析成结构化改名，避免旧清单继续把正确结果压回去。

- `2026-03-31`: 上一条决策继续收敛后，最终口径改为：二次纠错**不再依赖正则或规则去理解用户语义**。自由文本纠错说明完全交给大模型理解；结构化 `correctionItems` 只承担确定性职责，即标记哪些字段被用户显式手改（如 `nameEdited / weightEdited`）以及锁定最终列表顺序。未显式修改的旧名称/旧重量，不能再压过模型本轮结果。

- `2026-03-31`: 图片模式二次纠错需要兼容用户直接用自然语言说"不是 A，是 B / 把 A 改成 B"。当前前端在提交前应先把这类明确改名句式解析进结构化 `correctionItems`，避免用户只写补充说明时看起来"完全没生效"。

- `2026-03-31`: 食物二次纠错排查默认采用"全链路日志法"，不要再只靠猜测 prompt 行为。开启 `FOOD_ANALYSIS_DEBUG=1` 后，至少要能拿到：提交接口收到的 payload、worker 实际拿到的 task_input、prompt、模型 raw output、final_result。

- `2026-03-31`: 圈子 Feed 无论使用 `recommended / hot / balanced` 还是其他推荐排序，主序都必须保持 `record_time` 倒序；推荐分只能作为同时间层内的次级排序参考，不能把旧动态整体顶到新动态前面。

- `2026-03-31`: 微信小程序生产上传默认必须使用"压缩后、无 sourcemap"的 `dist/` 产物：`project.config.json` 保持 `minified=true`、`uploadWithSourceMap=false`，`config/prod.ts` 显式启用 `terser/csso` 并关闭 `mini.enableSourceMap`。这属于低风险减包基线，优先于分包或业务改造。

- `2026-03-31`: 处理 Supabase Storage 配额时，当前阶段采取"先压缩、后删除"的保守策略：先对 `food-images` 中被引用的长期图片做安全二次压缩，确认回看体验可接受后，再处理 `analysis_only_temp` 与 `orphan` 这类临时/孤儿图片删除。压缩阶段优先保持对象 key/URL 不变，降低业务回归风险。

- `2026-03-31`: 食物分析的每日次数限制先临时取消。后端默认不再因当日配额拒绝拍照/文字分析，仅保留环境变量 `FOOD_ANALYSIS_DAILY_LIMIT_ENABLED` 作为恢复开关；恢复前，不再向用户暴露 `3/20` 的日限口径。

- `2026-03-31`: 统计页 `AI 营养洞察` 不应在用户每次打开页面时实时调用大模型；默认策略改为"优先展示最近缓存 + 明示生成日期"，当日数据有变化时仅提示"可手动更新"，由用户主动触发重新生成。

- `2026-03-30`: 精准模式后续收敛为"经典简洁版拆分精估模式"：核心不再依赖过细的 `sceneTags` 心智，而是优先围绕 `单食物 / 可拆分混合餐 / 复杂混合餐`、`主体数量`、`边界清晰度`、`是否需要拆拍` 来判断。默认规则是：单主体清晰可直接估，2-3 个清晰主体可分项估，4 个以上或遮挡严重时建议拆拍；缺参照物只作为降可信度因素，不再作为唯一主心智。

- `2026-03-30`: 本地排查 token / prompt 问题时，`FOOD_ANALYSIS_DEBUG=1` 必须启用"本地专用异步任务队列"隔离：`food -> food_debug`、`food_text -> food_text_debug`。避免同一 Supabase 项目中的其他环境 Worker 抢占本地调试任务，导致本地终端看不到真实 prompt/输出日志。

- `2026-03-29`: 食物营养分析链路（图片识别 + 文字识别）当前明确以"速度最大化"为优先级，不再保留任何独立内容审核步骤；提交任务后直接进入主模型识别，由主模型本身返回可识别/不可识别结果。评论审核与公共食物库审核暂不受这条决策影响。

- `2026-03-29`: 首页"今日餐食"里的餐次规划默认按"三餐模式"处理：早餐 / 午餐 / 晚餐按用户当天总热量目标动态分配；各类加餐只显示统一参考值，并明确标注"加餐参考，不计入总目标"。

- `2026-03-29`: 分析中页不展示无法反映真实后端阶段的"步骤进度"；拿不到真实进度时，只保留加载动效与说明，避免用假进度误导用户。

- `2026-03-29`: 首页三大营养素达成率的"文案显示值"不能再被封顶为 `100%`；超过目标时应显示真实比例（如 `120%`），但圆环和进度条等视觉控件仍可保留 100% 上限，避免超出一圈后失真。

- `2026-03-29`: 圈子推荐一期不直接上复杂推荐系统，而采用"后端轻量打分 + 前端轻筛选"的方案：动态 Feed 支持 `recommended / latest / hot / balanced`，并综合特别关注、餐次匹配、目标匹配、热度、新鲜度、营养均衡度做排序。

- `2026-03-29`: 食物识别的 `standard` 与 `strict` 必须走严格分叉的 prompt/schema：`standard` 保持轻量营养识别流程，不再默认输出 `recognitionOutcome / rejectionReason / retakeGuidance / allowedFoodCategory / sceneTags / followupQuestions`；这些结构化判定字段只在 `strict` 下启用，避免标准模式替精准模式承担额外 token 成本。

- `2026-03-29`: "我关注的会员"一期先落为本地持久化的"特别关注作者"列表，不单独新建复杂社交关系表；用户在圈子页点击好友头像即可切换，推荐排序与"特别关注"筛选直接复用该列表。

- `2026-03-29`: 公共食物库推荐一期新增 `balanced / high_protein / low_calorie / recommended` 排序，并通过 `recommend_reason` 给出简短推荐理由，先提升实用性，再考虑后续补餐次字段与更细画像。

- `2026-03-29`: 互动消息里的"评论了你的动态 / 回复了你的评论"点击后，不应再跳到 `record-detail`；应切回 `pages/community/index`，并基于 `record_id / comment_id / parent_comment_id` 自动定位到对应动态的评论区，方便继续回复。

- `2026-03-29`: 当 `main` 与 `dev` 同时各自前进时，分支同步默认采用"先把 `dev` 合入最新 `main`，验证通过后再让 `dev` 快进到同一合并提交"的策略；这样既保留双边历史，也能让两个分支最终落到同一提交，避免继续分叉。

- `2026-03-29`: 这个项目的微信开发者工具读取的是 `dist/` 产物，不是 `src/` 源码；像 tabbar、路由、页面注册这类变更即使源码已正确合并，如果没有重新编译，运行效果仍会停留在旧 `dist`。判断"合并是否生效"时要同时核对 `src/*` 和 `dist/*`。

- `2026-03-29`: 用户已明确确认：`food_link` 项目后续默认不要求"运行项目 + 微信开发者工具截图/交互验证"；前端改动可仅做代码修改与构建校验，除非用户之后单独要求运行态验证。

- `2026-03-29`: 用户再次明确收紧口径：`food_link` 项目默认不做任何运行检测、交互点击、前端截图、构建校验或其他前端验证；只有用户刻意指定时才执行对应验证动作。

- `2026-03-29`: 分析页、结果页、文字结果页的餐次选择必须保持 6 餐次：`breakfast / morning_snack / lunch / afternoon_snack / dinner / evening_snack`；历史 `snack` 仅作为兼容值保留，前端展示与新记录默认映射为 `午加餐`。

- `2026-03-29`: 结果页点击"记录"时，若分析前已经存有 `analyzeMealType`，必须直接按该餐次保存；不要再次弹出餐次选择。只有在缺失餐次缓存时，才允许用户补选一次。

- `2026-03-29`: 食物识别模型返回值不能再默认信任为顶层 `dict`；图片/文字识别解析前必须先做响应归一化。若模型偶发直接返回食物数组，则先包成 `{"items": [...]}`；若结构仍异常，返回用户可读错误，不能把 Python 原始 `.get` 异常直接暴露到前端。

- `2026-03-29`: `food_link` 微信小程序在开发者工具中显示时，默认直接运行 `project.config.json` 指向的 `dist/` 构建产物；`dev:weapp` 只是 Taro 的 watch 编译，不是必须常驻的前端 dev server。

- `2026-03-29`: 前端未显式配置生产构建地址时，`src/utils/api.ts` 当前兜底指向 `https://dev.healthymax.cn`，用于避免普通 build 上传体验版时误连正式线上。

- `2026-03-29`: 本地联调默认应走"开发编译 + 本地后端"链路；前端在 development 下若未显式配置 `TARO_APP_API_BASE_URL`，默认回退到 `http://127.0.0.1:3010`，production 默认用于体验版并回退到 `https://dev.healthymax.cn`。

- `2026-03-29`: `backend/run_backend.py` 与本地开发文档统一使用 `3010` 作为默认端口，避免再出现 `3010 / 8000 / 8888` 多套口径并存。

- `2026-03-29`: `npm run build:weapp` 生成的是体验版上传用 `dist`，当前会指向 `https://dev.healthymax.cn`；`npm run build:weapp:release` 才生成正式线上域名 `https://healthymax.cn` 的发布包；`npm run dev:weapp` 是本地开发 watch 构建，会注入 `http://127.0.0.1:3010`。

- `2026-03-29`: 微信开发者工具当前项目私有配置里 `useStaticServer=false`、`useLanDebug=false`，不存在"开发者工具替你起本地服务"的机制；工具之所以能打开页面，是因为它直接读取现成的 `dist/` 产物。

- `2026-03-29`: `compileHotReLoad=true` 只会在 `dist/` 已经变化时帮助热刷新，不会代替 `npm run dev:weapp` 做源码编译。

- `2026-03-29`: 分析页的本地图片必须在"选中图片/恢复缓存路径"当下立即持久化到 `USER_DATA_PATH`，不能等到点击"分析"时再保存；否则微信临时文件可能已被回收，触发 `compressImage:fail file doesn't exist` / `uploadFile:fail file not found`。

- `2026-03-29`: 图片分析上传链路改为"文件直传优先、base64 仅兼容兜底"；分析页不得再把大 base64 放进页面状态，否则既会放大 `413` 风险，也会触发小程序 `setData` 体积过大告警。

- `2026-03-29`: 食物分析、文字录入、评论审核都需要遵守"食物语境优先"原则；食品名、菜单名、品牌名、包装文案里的玩梗词（如"牛马""打工人""摸鱼"）若明显在描述食物商品本身，不按政治敏感拦截，且只在 `politics / inappropriate_text / other` 这类轻度误判场景自动放行。

- `2026-03-29`: 社区评论初版只支持"动态评论 + 单层回复"，不做多层楼中楼；前端保持扁平渲染，通过 `parent_comment_id` 和 `reply_to_user_id` 展示"回复某人"。

- `2026-03-29`: 社区评论继续沿用异步审核模型；前端提交成功文案必须表达"已提交审核"，并在社区页合并本地临时评论，避免用户误以为评论丢失。

- `2026-03-29`: 互动消息初版不做独立复杂消息中心和推送，只做站内轻量通知表 `feed_interaction_notifications`，支持 `comment_received`、`reply_received`、`comment_rejected`。

- `2026-03-29`: 圈子动态的评论和点赞必须经过可见性校验，允许范围限定为：本人、好友、或作者开启 `public_records` 的动态。

- `2026-03-29`: 圈子 Feed 返回的 `comment_count` 必须是真实总数，不能再直接等于预览评论条数；卡片里评论仅作为预览，允许用户再拉完整列表。

- `2026-03-29`: 图片分析链路与文字分析链路的精准模式字段派生必须分开处理；图片任务只能走 `_derive_recognition_fields`，不能误传文字链路专用的 `text_input`。

- `2026-03-29`: 结果页的"上传公共库"必须是独立入口，点击后应直接进入公共库上传页并沿用当前拍照分析结果作为草稿；不要先走"记录餐次/保存记录"链路，也不要在"记录"成功后再弹上传提醒。

- `2026-03-28`: Text-mode secondary correction must preserve the original text input and send correction instructions as structured context; when correction instructions conflict with original text, backend prompt should prioritize the correction context.

- `2026-03-28`: For secondary correction flows where the user explicitly confirms food weights, the final displayed result must respect those confirmed weights even if the model re-estimates them differently; use prompt constraints plus client-side post-processing as a safeguard.

- `2026-03-28`: Text-mode second-pass correction should be treated as a true re-analysis over four context sources: original input, previous output, structured correction list, and latest free-text note. Latest free-text clarification should be able to override earlier rounds; avoid hard client-side overwrites that suppress newer feedback.

- `2026-03-28`: In text mode, direct edits on the result page are the primary structured baseline. The secondary-correction drawer should mainly collect explanatory text about why the previous analysis was wrong and how to reinterpret it, rather than asking the user to re-edit the same weights there.

- `2026-03-28`: 二次纠错必须按模式拆分：图片记录模式以结构化纠错清单为主输入（并保留原图+首轮结果）；文字记录模式以补充说明文本为主输入，弹窗列表仅参考。

- `2026-03-28`: 图片记录模式新增后端强约束兜底：若模型未遵守纠错清单克重，按纠错清单回写 `estimatedWeightGrams` 并按比例缩放营养，避免"二次纠错后结果不变"。

- `2026-03-28`: 精准模式不再只是提示词差异；分析结果统一新增 `recognitionOutcome`、`rejectionReason`、`retakeGuidance`、`allowedFoodCategory`，由后端在严格模式下做 hard/soft reject 后校验，前端结果页和历史页按结构化状态展示。

- `2026-03-28`: 文字异步分析任务的 `execution_mode` 必须和图片任务一样做"请求优先、档案回退"的统一合并，避免未传模式时默认掉回 `standard`。

- `2026-03-27`: Added persistent state files so `food_link` context survives session resets and compaction better.

- `2026-03-27`: Project ownership must come from `IDENTITY.md` plus state files, not stale transcript memory.

- `2026-03-27`: Durable requirements, blockers, and handoffs must be written to files instead of relying on chat history alone.

- `2026-03-27`: Pure text analysis must clear both `analyzeImagePath` and `analyzeImagePaths`, and result-page logic must trust explicit task type over stale image storage.

- `2026-03-27`: When a food record has no user-provided real image, UI should display the product logo instead of reusing any previous meal photo.

- `2026-03-27`: Keep backward-compatible API aliases in `src/utils/api.ts` when page code still imports old names (e.g. `friendRemove` -> `friendDelete`) to avoid build breaks during incremental refactor.

- `2026-03-27`: For friend-invite APIs, keep legacy login compatibility function `requestFriendByInviteCode` and map status `request_sent -> requested` until login page fully migrates.

- `2026-03-27`: In mini-program runtime code, never access `process.env` directly at module top-level; always guard with `typeof process !== 'undefined'` (or equivalent) to avoid `ReferenceError: process is not defined`.

- `2026-03-27`: In `result` page correction flow, avoid re-declaring identifiers that shadow state names inside async callbacks (e.g. `taskType`), to prevent TDZ runtime errors like `Cannot access 'taskType2' before initialization`.

- `2026-03-27`: For pages/components that hit ambiguous hook-binding runtime errors in Taro mini-program builds, prefer explicit `React.useState/useEffect/useCallback` and named lifecycle hook imports like `useDidShow` over mixed shorthand/default-namespace patterns.
- `2026-05-20`: Gemini 3.5 Flash 作为独立试验通道接入。
  - `gemini35_flash` 表示单次 Gemini 3.5 Flash 直接做图片食物识别和估重，仍走后端 db_first 营养回算，按普通分析 2 积分计费。
  - `gemini35_flash_grouped` 表示 Gemini 3.5 Flash 先识别，再进行最多 2 组分组复核估重，按试验/精准成本 4 积分计费，并要求标准版/进阶版权限。
  - 该通道使用独立配置 `external.gemini35_api_key/base_url/model`，不复用旧 `gemini-3-flash-preview` key。

- `2026-05-21`: 后端运行配置优先走 Infisical 云端拉取。
  - 本地 `backend/config.yaml` 只应保留 Infisical Universal Auth bootstrap、项目/环境/路径等启动必要配置，以及确实只属于本机环境的少量设置。
  - 后端必须通过 Go SDK 在 `config.Load()` 内自动登录 Infisical 并拉取 secrets；不要要求用户额外执行 Infisical CLI，也不要把云端配置先注入成环境变量再启动。
  - Infisical secret key 优先使用点号路径式命名（如 `database.host` / `external.doubao_api_key`），因为 Infisical 本身不是 shell 环境变量，点号更接近 YAML/Viper 配置树，也更方便人工核对；代码继续兼容现有环境变量式命名（如 `POSTGRESQL_HOST`、`DOUBAO_API_KEY`、`WORKER_COUNT`）和双下划线路径式命名（如 `database__host`）。
  - 云端配置用于覆盖本地业务配置；如果需要临时脱离云端调试，可将 `infisical.enabled=false` 并继续使用本地 YAML 兼容路径。

- `2026-05-21`: 后端配置源必须通过顶层 `config_source` 显式二选一。
  - `config_source: local` 表示全部业务配置来自本地 YAML/本地兼容输入。
  - `config_source: infisical` 表示本地 YAML 只作为 Infisical bootstrap，业务配置全部来自 Infisical secrets；禁止把本地业务配置作为云端模式下的覆盖或兜底。
  - 后续新增配置项时必须遵守该互斥语义，不能重新引入“云端覆盖本地”的混合设计。

- `2026-05-21`: 后端配置文件拆分为 `app-config.yaml` 与 `infisical-config.yaml`。
  - `infisical-config.yaml` 只用于 `config_source: infisical`，保存 Infisical Universal Auth bootstrap，不保存业务运行配置。
  - `app-config.yaml` 只用于 `config_source: local`，保存本地业务运行配置。
  - 加载优先级为 `infisical-config.yaml` > `app-config.yaml` > 旧 `config.yaml` 兼容；前两个文件的 `config_source` 必须和文件用途一致。

- `2026-05-21`: 后端配置源选择收敛为 `.env` 中的必填 `CONFIG_SOURCE`。
  - `.env` 必须存在，且 `CONFIG_SOURCE` 只能是 `local` 或 `infisical`，没有默认值。
  - `CONFIG_SOURCE=local` 时只读 `app-config.yaml`，业务配置全部来自本地文件。
  - `CONFIG_SOURCE=infisical` 时只读 `infisical-config.yaml` 作为 Infisical bootstrap，业务配置全部来自 Infisical secrets。
  - 不再通过文件存在性猜测模式，也不再自动兼容旧 `config.yaml`，避免本地/云端混合和隐式切换。

- `2026-05-21`: `CONFIG_SOURCE` 的权威入口支持进程环境变量和 `.env`，其中进程环境变量优先。
  - Kubernetes/容器部署可以只通过 Deployment env 设置 `CONFIG_SOURCE=local|infisical`，不需要挂载 `.env`。
  - 本地开发可以用 `backend/.env` 作为便利 fallback。
  - 两者都不存在或值非法时才启动失败；不能因为容器没有 `.env` 而忽略已有进程环境变量。

- `2026-05-21`: 零食/预包装食品是否进入 `packaged_food_library` 必须由模型输出的 `type` 决定。
  - prompt 必须要求每个 item 输出 `type`，当前取值口径为 `normal`、`snack`、`packaged`。
  - 后端只做 `type/food_type` 兼容归一化，不再按名称、OCR、category、recognitionEvidence 或 alternativeNames 里的“薯片/饼干/零食/净含量”等关键词推断零食。
  - 如果模型没有输出 `snack/packaged`，即使名称像零食，也先走普通食物库和 DeepSeek fallback；日志里的 item 摘要必须保留 `type` 以便判断模型分类是否正确。
