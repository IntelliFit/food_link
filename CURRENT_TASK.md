# CURRENT_TASK

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
