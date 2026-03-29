# CURRENT_TASK

- Task: 修复识别失败 `name 'text_input' is not defined`
- Status: done（已修复图片分析链路误用文字模式字段派生的问题，后端编译校验通过）
- Scope:
  - `backend/worker.py`：图片分析结果收尾阶段错误调用 `_derive_text_recognition_fields(..., text_input)`，但图片任务上下文中并不存在 `text_input`
  - 影响：异步图片识别任务在 worker 完成识别后写结果前抛 `NameError`，前端“识别中”页显示 `识别失败: name 'text_input' is not defined`
- Verification:
  - `python -m py_compile backend/worker.py` 通过
- Next step:
  - 用户重新发起一次图片识别，确认任务不再在“识别中”页以 `text_input` 未定义失败

---

- Task: 社区评论初版补齐（审核状态闭环 / 单层回复 / 轻量互动消息 / 权限与评论数修正）
- Status: done（代码已落地；本地编译和 weapp 构建通过，待用户在微信开发者工具或真机验证交互）
- Scope:
  - `backend/database/feed_likes_comments.sql`、`backend/database/migrate_feed_comments_reply_fields.sql`：`feed_comments` 新增 `parent_comment_id`、`reply_to_user_id`
  - `backend/database/comment_tasks.sql`、`backend/database/migrate_comment_tasks_add_extra.sql`：评论任务新增 `extra`，用于回复上下文
  - `backend/database/feed_interaction_notifications.sql`：新增轻量互动通知表，支持评论、回复、评论驳回三类事件
  - `backend/database.py`：补圈子动态可见性判断、真实评论总数、回复评论读写、互动通知查询/已读
  - `backend/main.py`：新增圈子评论任务状态接口、互动通知接口、评论/点赞权限校验、回复评论入参
  - `backend/worker.py`：评论审核通过/违规后写入互动通知
  - `src/utils/api.ts`：新增评论任务、互动通知、回复评论相关 API 类型与方法
  - `src/pages/community/index.tsx`、`src/pages/community/index.scss`：评论提交文案改为“已提交审核”，支持审核中临时评论回显、单层回复、互动消息入口、展开全部评论
  - `src/pages/interaction-notifications/*`、`src/app.config.ts`：新增互动消息页并挂到小程序路由
- Verification:
  - `python -m py_compile backend/main.py backend/database.py backend/worker.py` 通过
  - `npm run build:weapp` 通过
  - `ReadLints` 检查最近修改文件无报错
  - `mrc where --port 9420`、`mrc errors 30 --port 9420` 失败：本机当前未开启微信开发者工具自动化端口 9420，未完成运行态截图/交互验证
- Next step:
  - 在微信开发者工具或真机验证四条链路：发评论、回复评论、违规评论提示、互动消息已读与跳转详情
  - 执行新增 SQL/migration，确保 `feed_comments`、`comment_tasks`、`feed_interaction_notifications` 结构与代码一致

---

- Task: 精准模式升级为“受约束执行模式”
- Status: done（已落地结构化判定、后端硬/软拒绝、结果页/历史页状态展示；等待用户用真实样本验证策略阈值）
- Scope:
  - `src/utils/api.ts`、`backend/main.py`：分析结果结构新增 `recognitionOutcome`、`rejectionReason`、`retakeGuidance`、`allowedFoodCategory`
  - `backend/worker.py`：精准模式新增白名单导向判定与后校验；明显不符合规则时 `hard_reject`，轻微不确定时 `soft_reject`
  - `backend/main.py`：文字异步分析提交改为与图片提交一致，未显式传模式时回退用户档案默认模式
  - `src/pages/result/index.tsx`、`src/pages/result/index.scss`：新增精准模式状态卡；`hard_reject` 禁止记录/收藏，`soft_reject` 允许继续记录但先强提示
  - `src/pages/analyze-history/index.tsx`、`src/pages/analyze-history/index.scss`：历史任务新增“精准通过 / 不建议执行 / 需重拍”标签
  - `src/pages/analyze/index.tsx`：精准模式文案改为“受约束执行模式”
- Verification:
  - `python -m py_compile backend/main.py backend/worker.py` 通过
  - `ReadLints` 检查最近修改文件无报错
  - `mrc where --port 9420` 成功连到 `pages/analyze/index`
  - `mrc errors 20 --port 9420` 为 0
  - `mrc screenshot` 连接成功但命令挂起，未拿到截图文件
- Next step:
  - 用户用三类真实样本验证：单纯碳水/瘦肉、明显混合食物、主体清晰但条件一般的图片
  - 若策略过严或过松，再细调 `backend/worker.py` 中白名单与 hard/soft reject 规则

---

- Task: 图片分析在「精准模式」下上传失败（提示「上传图片失败」）
- Status: done（已做上传前压缩 + 上传接口改进；等待用户真机/开发者工具验证）
- 根因假设: 精准模式用户更易拍高清大图，base64 JSON 超过网关/服务端单请求体积限制，或响应非 JSON 时前端只显示泛化「上传图片失败」
- 代码: `compressImagePathForUpload` + `uploadAnalyzeImage` 超时/可选 Bearer/413 提示；`src/pages/analyze/index.tsx` 上传前压缩
- Verification: 未跑 weapp-devtools 自动化（本机需微信开发者工具 9420）
- Next step: 用户在精准模式下再试图片分析；若仍失败，看 Network 里 `/api/upload-analyze-image` 的 HTTP 状态与响应体

---

- Task: 修复二次纠错「图片记录模式 vs 文字记录模式」逻辑混用导致结果不变的问题
- Status: done（已按双模式拆分并加兜底，等待用户链路验证）
- Scope:
  - `src/pages/result/index.tsx`：二次纠错提交按模式拆分
    - 图片模式：下发 `original image + previousResult + correctionItems + additionalContext`，且强调纠错清单为主输入
    - 文字模式：下发 `original text + previousResult + additionalContext`，不再把纠错清单作为主输入
  - `src/pages/record/index.tsx`、`src/pages/analyze-loading/index.tsx`、`src/pages/analyze-history/index.tsx`：补存/回填 `analyzeTextInput`
  - `src/utils/api.ts`、`backend/main.py`、`backend/worker.py`：文字异步分析接口新增 `previousResult`、`correctionItems`，并在 prompt 中定义二轮分析的信息优先级
  - 移除 `src/pages/analyze-loading/index.tsx` 中“按纠错清单强制覆盖最终结果”的旧兜底，避免压掉用户在补充说明里的更晚反馈
  - `src/pages/result/index.tsx`：文字模式二次纠错弹窗改为“说明优先、列表仅作参考摘要”，名称/重量仍应先在结果页直接修改
  - `backend/worker.py`：
    - 图片模式 prompt 改为“纠错清单优先于补充说明/首轮结果/原图”
    - 新增 `_apply_image_correction_items` 结果兜底：若模型忽略图片模式纠错清单，按清单回写克重并按比例缩放营养
    - 文字模式 prompt 明确纠错清单仅作参考，不是主输入
- Verification:
  - `python -m py_compile backend/worker.py backend/main.py` 通过
  - `npm run build:weapp` 通过（仅有 taroify sass deprecation warning）
  - `mrc errors 30 --port 9420` 为 0；`mrc where --port 9420` 正常返回页面
- Next step:
  - 用户分别验证两条链路：
    - 图片记录：二次纠错改克重后，结果是否按纠错清单变化（不再回弹旧克重）
    - 文字记录：二次纠错主要看补充说明是否生效，不受弹窗列表干扰
  - 若仍异常，抓取异常任务的 `task.payload` 与 `task.result.items` 做逐项比对
- Last updated: `2026-03-28`

---

- Task: 结果页移除“上传公共库”保存后弹窗，改为右下角直达上传按钮
- Status: done（代码已改，等待用户自行验证）
- Scope:
  - `src/pages/result/index.tsx`、`src/pages/result/index.scss`：
    - 删除底部右侧“估算不准？点击标记样本”入口
    - 新增右下角“上传公共库”按钮
    - 点击后不再走“选择餐次/保存记录”链路，而是把当前拍照分析结果写入快捷上传草稿并直接跳到公共库上传页
    - 普通“记录”按钮保存成功后不再弹出“是否上传公共库”提醒，直接进入记录详情
  - `src/pages/food-library-share/index.tsx`：
    - 新增快捷上传草稿读取
    - 当从结果页直达时，自动带入当前图片、营养结果与识别描述，用户只需要补充商家、地理位置、是否自制等信息
- Verification:
  - 按用户要求，本次未运行编译、weapp-devtools、截图或前端自动化验证
- Next step:
  - 用户验证两点：
    - 结果页右下角“上传公共库”是否直接进入公共库上传页，且已自动带入本次拍照分析内容
    - “记录”后是否不再弹“是否上传公共库”的提醒
- Last updated: `2026-03-29`
