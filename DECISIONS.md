# DECISIONS

- `2026-03-31`: 饮食记录的信息架构改为“三层职责分离”：`pages/stats/index` 负责历史总览与日历入口，`pages/record/index` 只负责新增记录（拍照/文字），点击某一天的饮食记录必须进入独立的“当天记录页”，不能再跳进拍照页。

- `2026-03-31`: 独立“当天记录页”里的每条饮食记录卡片需要在进入详情前就提供图片缩略图预览；有实物图时展示首张照片并允许直接放大预览，无实物图时显示占位 logo，而不是只给纯文字列表。

- `2026-03-31`: 评论审核链路改为复用 OfoxAI OpenAI 兼容接口，与 Gemini 热量识别共用 `OFOXAI_API_KEY` 和 `https://api.ofox.ai/v1`，默认审核模型切到 `openai/gpt-5.4-nano`。

- `2026-03-31`: 评论审核口径改为“宽松优先、明确违规才拦截”。普通吐槽、轻微负面评价、食物语境玩梗、简短回复、情绪化口语默认放行；只有明确色情、暴力威胁、违法引流、政治煽动、强烈辱骂骚扰时才判违规。

- `2026-04-01`: 评论链路现阶段进一步收口为“默认不做审核，直接发布”。圈子评论与公共食物库评论提交后直接入库并立即展示，不再创建 `comment_tasks` 审核任务，也不再向前端展示“已提交审核/审核中”；圈子评论相关互动通知改为在接口层直接写入。

- `2026-03-31`: 首页所有达成率展示统一采用“真实百分比文案 + 视觉进度单独裁剪”的口径。三大营养素与各餐次都必须显示真实比例（可超过 `100%`），但圆环/进度条等视觉控件只裁到 `100%`，并且在前端对 `undefined / NaN / 非数字字符串` 做兜底，避免比例条消失或渲染异常。

- `2026-03-31`: 精准模式当前先临时关闭，不再允许用户在前端主动切换到 `strict`。分析页、健康档案问卷、健康档案编辑页点击精准模式时统一提示“该功能仍在完善中”；重新分析/二次纠错提交也统一回落到 `standard`，避免旧缓存或历史任务继续走精准模式链路。

- `2026-03-31`: 用户健康档案中的 `BMR/TDEE` 计算口径从 Mifflin-St Jeor 切换为更贴近中国成人样本的毛德倩公式；其中 `BMR` 改为按 `性别 + 体重` 计算，`TDEE` 仍保持 `BMR × 活动系数`。相应地，后端不再要求必须先有生日/年龄和身高才生成 `BMR/TDEE`。

- `2026-03-31`: 圈子互动消息不再只覆盖评论/回复/驳回，需补齐 `like_received`。用户给动态点了赞时，只要是“新增点赞”且作者不是自己，就应给作者写入一条站内互动通知。

- `2026-03-31`: 圈子评论里的“回复某人”不能再只靠一段行内文字表达；回复项在视觉上必须与普通评论拉开层级，至少要明确呈现“回复目标 + 差异化内容气泡/引导线”，避免看起来像两条互不相关的独立评论。

- `2026-03-31`: 图片模式二次纠错不能只按“纠错后的食物名”做匹配；请求侧必须携带原项身份（至少 `sourceName`，优先 `sourceItemId`），后端应按“原项替换”而不是“新名字追加”，避免把 `橘子 -> 橙子` 这类改名误处理成新增一项。
- `2026-03-31`: 图片模式二次纠错弹窗里提交的 `correctionItems` 代表用户确认后的“完整最终食物清单”，不是给模型参考的局部提示。Worker 最终写回结果时，数量、顺序、名称、克重都必须以这份清单为准，不能再把模型额外生成的旧项或重复项保留下来。
- `2026-03-31`: 图片模式二次纠错里，如果用户没有手动改列表，而是在补充说明里明确写出改名关系（如 `不是橘子，是橙子`、`炸肉饼实际上是牛肉饼`），前端必须先把这类自然语言翻译成结构化改名再提交；未显式改名的旧 `correctionItems` 不能把模型已经识别出的更具体新名字强行覆盖回去。
- `2026-03-31`: 文字模式二次纠错也需要与图片模式保持相同的“结构化优先”口径：前端不能再丢弃 `correctionItems`，补充说明中的明确改名也应先转成结构化清单；后端文字链路在模型返回后同样要按用户确认清单收口，避免名称、数量或重量又漂回去。
- `2026-03-31`: 二次纠错里的自由文本说明不能再被当成次级“补充信息”；它应是最高优先级的纠错输入。结构化 `correctionItems` 主要负责锁定最终食物列表、顺序和明确重量。前后端都需要支持把口语化表达（如 `X 说得太模糊了，这是 Y`）解析成结构化改名，避免旧清单继续把正确结果压回去。
- `2026-03-31`: 上一条决策继续收敛后，最终口径改为：二次纠错**不再依赖正则或规则去理解用户语义**。自由文本纠错说明完全交给大模型理解；结构化 `correctionItems` 只承担确定性职责，即标记哪些字段被用户显式手改（如 `nameEdited / weightEdited`）以及锁定最终列表顺序。未显式修改的旧名称/旧重量，不能再压过模型本轮结果。
- `2026-03-31`: 图片模式二次纠错需要兼容用户直接用自然语言说“不是 A，是 B / 把 A 改成 B”。当前前端在提交前应先把这类明确改名句式解析进结构化 `correctionItems`，避免用户只写补充说明时看起来“完全没生效”。
- `2026-03-31`: 食物二次纠错排查默认采用“全链路日志法”，不要再只靠猜测 prompt 行为。开启 `FOOD_ANALYSIS_DEBUG=1` 后，至少要能拿到：提交接口收到的 payload、worker 实际拿到的 task_input、prompt、模型 raw output、final_result。

- `2026-03-31`: 圈子 Feed 无论使用 `recommended / hot / balanced` 还是其他推荐排序，主序都必须保持 `record_time` 倒序；推荐分只能作为同时间层内的次级排序参考，不能把旧动态整体顶到新动态前面。

- `2026-03-31`: 微信小程序生产上传默认必须使用“压缩后、无 sourcemap”的 `dist/` 产物：`project.config.json` 保持 `minified=true`、`uploadWithSourceMap=false`，`config/prod.ts` 显式启用 `terser/csso` 并关闭 `mini.enableSourceMap`。这属于低风险减包基线，优先于分包或业务改造。

- `2026-03-31`: 处理 Supabase Storage 配额时，当前阶段采取“先压缩、后删除”的保守策略：先对 `food-images` 中被引用的长期图片做安全二次压缩，确认回看体验可接受后，再处理 `analysis_only_temp` 与 `orphan` 这类临时/孤儿图片删除。压缩阶段优先保持对象 key/URL 不变，降低业务回归风险。

- `2026-03-31`: 食物分析的每日次数限制先临时取消。后端默认不再因当日配额拒绝拍照/文字分析，仅保留环境变量 `FOOD_ANALYSIS_DAILY_LIMIT_ENABLED` 作为恢复开关；恢复前，不再向用户暴露 `3/20` 的日限口径。

- `2026-03-30`: 精准模式后续收敛为“经典简洁版拆分精估模式”：核心不再依赖过细的 `sceneTags` 心智，而是优先围绕 `单食物 / 可拆分混合餐 / 复杂混合餐`、`主体数量`、`边界清晰度`、`是否需要拆拍` 来判断。默认规则是：单主体清晰可直接估，2-3 个清晰主体可分项估，4 个以上或遮挡严重时建议拆拍；缺参照物只作为降可信度因素，不再作为唯一主心智。

- `2026-03-30`: 本地排查 token / prompt 问题时，`FOOD_ANALYSIS_DEBUG=1` 必须启用“本地专用异步任务队列”隔离：`food -> food_debug`、`food_text -> food_text_debug`。避免同一 Supabase 项目中的其他环境 Worker 抢占本地调试任务，导致本地终端看不到真实 prompt/输出日志。

- `2026-03-29`: 食物营养分析链路（图片识别 + 文字识别）当前明确以“速度最大化”为优先级，不再保留任何独立内容审核步骤；提交任务后直接进入主模型识别，由主模型本身返回可识别/不可识别结果。评论审核与公共食物库审核暂不受这条决策影响。
- `2026-03-29`: 首页“今日餐食”里的餐次规划默认按“三餐模式”处理：早餐 / 午餐 / 晚餐按用户当天总热量目标动态分配；各类加餐只显示统一参考值，并明确标注“加餐参考，不计入总目标”。
- `2026-03-29`: 分析中页不展示无法反映真实后端阶段的“步骤进度”；拿不到真实进度时，只保留加载动效与说明，避免用假进度误导用户。
- `2026-03-29`: 首页三大营养素达成率的“文案显示值”不能再被封顶为 `100%`；超过目标时应显示真实比例（如 `120%`），但圆环和进度条等视觉控件仍可保留 100% 上限，避免超出一圈后失真。
- `2026-03-29`: 圈子推荐一期不直接上复杂推荐系统，而采用“后端轻量打分 + 前端轻筛选”的方案：动态 Feed 支持 `recommended / latest / hot / balanced`，并综合特别关注、餐次匹配、目标匹配、热度、新鲜度、营养均衡度做排序。
- `2026-03-29`: 食物识别的 `standard` 与 `strict` 必须走严格分叉的 prompt/schema：`standard` 保持轻量营养识别流程，不再默认输出 `recognitionOutcome / rejectionReason / retakeGuidance / allowedFoodCategory / sceneTags / followupQuestions`；这些结构化判定字段只在 `strict` 下启用，避免标准模式替精准模式承担额外 token 成本。
- `2026-03-29`: “我关注的会员”一期先落为本地持久化的“特别关注作者”列表，不单独新建复杂社交关系表；用户在圈子页点击好友头像即可切换，推荐排序与“特别关注”筛选直接复用该列表。
- `2026-03-29`: 公共食物库推荐一期新增 `balanced / high_protein / low_calorie / recommended` 排序，并通过 `recommend_reason` 给出简短推荐理由，先提升实用性，再考虑后续补餐次字段与更细画像。

- `2026-03-29`: 互动消息里的“评论了你的动态 / 回复了你的评论”点击后，不应再跳到 `record-detail`；应切回 `pages/community/index`，并基于 `record_id / comment_id / parent_comment_id` 自动定位到对应动态的评论区，方便继续回复。
- `2026-03-29`: 当 `main` 与 `dev` 同时各自前进时，分支同步默认采用“先把 `dev` 合入最新 `main`，验证通过后再让 `dev` 快进到同一合并提交”的策略；这样既保留双边历史，也能让两个分支最终落到同一提交，避免继续分叉。
- `2026-03-29`: 这个项目的微信开发者工具读取的是 `dist/` 产物，不是 `src/` 源码；像 tabbar、路由、页面注册这类变更即使源码已正确合并，如果没有重新编译，运行效果仍会停留在旧 `dist`。判断“合并是否生效”时要同时核对 `src/*` 和 `dist/*`。
- `2026-03-29`: 用户已明确确认：`food_link` 项目后续默认不要求“运行项目 + 微信开发者工具截图/交互验证”；前端改动可仅做代码修改与构建校验，除非用户之后单独要求运行态验证。
- `2026-03-29`: 用户再次明确收紧口径：`food_link` 项目默认不做任何运行检测、交互点击、前端截图、构建校验或其他前端验证；只有用户刻意指定时才执行对应验证动作。
- `2026-03-29`: 分析页、结果页、文字结果页的餐次选择必须保持 6 餐次：`breakfast / morning_snack / lunch / afternoon_snack / dinner / evening_snack`；历史 `snack` 仅作为兼容值保留，前端展示与新记录默认映射为 `午加餐`。
- `2026-03-29`: 结果页点击“记录”时，若分析前已经存有 `analyzeMealType`，必须直接按该餐次保存；不要再次弹出餐次选择。只有在缺失餐次缓存时，才允许用户补选一次。

- `2026-03-29`: 食物识别模型返回值不能再默认信任为顶层 `dict`；图片/文字识别解析前必须先做响应归一化。若模型偶发直接返回食物数组，则先包成 `{"items": [...]}`；若结构仍异常，返回用户可读错误，不能把 Python 原始 `.get` 异常直接暴露到前端。

- `2026-03-29`: `food_link` 微信小程序在开发者工具中显示时，默认直接运行 `project.config.json` 指向的 `dist/` 构建产物；`dev:weapp` 只是 Taro 的 watch 编译，不是必须常驻的前端 dev server。
- `2026-03-29`: 前端未显式配置开发环境地址时，`src/utils/api.ts` 默认把 `API_BASE_URL` 指向 `https://healthymax.cn`；因此只要本地还保留 `access_token`，小程序就会直接请求线上后端，而不是依赖本地 Python 服务。
- `2026-03-29`: 本地联调默认应走“开发编译 + 本地后端”链路；前端在 development 下若未显式配置 `TARO_APP_API_BASE_URL`，默认回退到 `http://127.0.0.1:3010`，production 继续使用 `https://healthymax.cn`。
- `2026-03-29`: `backend/run_backend.py` 与本地开发文档统一使用 `3010` 作为默认端口，避免再出现 `3010 / 8000 / 8888` 多套口径并存。
- `2026-03-29`: `npm run build:weapp` 生成的是生产 `dist`，当前会指向 `https://healthymax.cn`；`npm run dev:weapp` 才是开发 watch 构建，首轮编译后 `dist/common.js` 会注入 `http://127.0.0.1:3010`。
- `2026-03-29`: 微信开发者工具当前项目私有配置里 `useStaticServer=false`、`useLanDebug=false`，不存在“开发者工具替你起本地服务”的机制；工具之所以能打开页面，是因为它直接读取现成的 `dist/` 产物。
- `2026-03-29`: `compileHotReLoad=true` 只会在 `dist/` 已经变化时帮助热刷新，不会代替 `npm run dev:weapp` 做源码编译。

- `2026-03-29`: 分析页的本地图片必须在“选中图片/恢复缓存路径”当下立即持久化到 `USER_DATA_PATH`，不能等到点击“分析”时再保存；否则微信临时文件可能已被回收，触发 `compressImage:fail file doesn't exist` / `uploadFile:fail file not found`。
- `2026-03-29`: 图片分析上传链路改为“文件直传优先、base64 仅兼容兜底”；分析页不得再把大 base64 放进页面状态，否则既会放大 `413` 风险，也会触发小程序 `setData` 体积过大告警。
- `2026-03-29`: 食物分析、文字录入、评论审核都需要遵守“食物语境优先”原则；食品名、菜单名、品牌名、包装文案里的玩梗词（如“牛马”“打工人”“摸鱼”）若明显在描述食物商品本身，不按政治敏感拦截，且只在 `politics / inappropriate_text / other` 这类轻度误判场景自动放行。
- `2026-03-29`: 社区评论初版只支持“动态评论 + 单层回复”，不做多层楼中楼；前端保持扁平渲染，通过 `parent_comment_id` 和 `reply_to_user_id` 展示“回复某人”。
- `2026-03-29`: 社区评论继续沿用异步审核模型；前端提交成功文案必须表达“已提交审核”，并在社区页合并本地临时评论，避免用户误以为评论丢失。
- `2026-03-29`: 互动消息初版不做独立复杂消息中心和推送，只做站内轻量通知表 `feed_interaction_notifications`，支持 `comment_received`、`reply_received`、`comment_rejected`。
- `2026-03-29`: 圈子动态的评论和点赞必须经过可见性校验，允许范围限定为：本人、好友、或作者开启 `public_records` 的动态。
- `2026-03-29`: 圈子 Feed 返回的 `comment_count` 必须是真实总数，不能再直接等于预览评论条数；卡片里评论仅作为预览，允许用户再拉完整列表。
- `2026-03-29`: 图片分析链路与文字分析链路的精准模式字段派生必须分开处理；图片任务只能走 `_derive_recognition_fields`，不能误传文字链路专用的 `text_input`。
- `2026-03-31`: 统计页 `AI 营养洞察` 不应在用户每次打开页面时实时调用大模型；默认策略改为“优先展示最近缓存 + 明示生成日期”，当日数据有变化时仅提示“可手动更新”，由用户主动触发重新生成。

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
- `2026-03-28`: Text-mode secondary correction must preserve the original text input and send correction instructions as structured context; when correction instructions conflict with original text, backend prompt should prioritize the correction context.
- `2026-03-28`: For secondary correction flows where the user explicitly confirms food weights, the final displayed result must respect those confirmed weights even if the model re-estimates them differently; use prompt constraints plus client-side post-processing as a safeguard.
- `2026-03-28`: Text-mode second-pass correction should be treated as a true re-analysis over four context sources: original input, previous output, structured correction list, and latest free-text note. Latest free-text clarification should be able to override earlier rounds; avoid hard client-side overwrites that suppress newer feedback.
- `2026-03-28`: In text mode, direct edits on the result page are the primary structured baseline. The secondary-correction drawer should mainly collect explanatory text about why the previous analysis was wrong and how to reinterpret it, rather than asking the user to re-edit the same weights there.
- `2026-03-28`: 二次纠错必须按模式拆分：图片记录模式以结构化纠错清单为主输入（并保留原图+首轮结果）；文字记录模式以补充说明文本为主输入，弹窗列表仅参考。
- `2026-03-28`: 图片记录模式新增后端强约束兜底：若模型未遵守纠错清单克重，按纠错清单回写 `estimatedWeightGrams` 并按比例缩放营养，避免“二次纠错后结果不变”。
- `2026-03-28`: 精准模式不再只是提示词差异；分析结果统一新增 `recognitionOutcome`、`rejectionReason`、`retakeGuidance`、`allowedFoodCategory`，由后端在严格模式下做 hard/soft reject 后校验，前端结果页和历史页按结构化状态展示。
- `2026-03-28`: 文字异步分析任务的 `execution_mode` 必须和图片任务一样做“请求优先、档案回退”的统一合并，避免未传模式时默认掉回 `standard`。
- `2026-03-29`: 结果页的“上传公共库”必须是独立入口，点击后应直接进入公共库上传页并沿用当前拍照分析结果作为草稿；不要先走“记录餐次/保存记录”链路，也不要在“记录”成功后再弹上传提醒。
