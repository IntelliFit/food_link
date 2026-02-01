# 📊 Food Link 开发日志

> 简洁记录项目的所有修改，类似 Git commit 日志

---

## 2026-02-01

- ✨ feat: 食物分析先上传图片到 Supabase 获取 URL，分析接口支持 image_url；分析页先调 upload-analyze-image 再分析，结果页/标记样本/保存记录均存 Supabase 图片 URL `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/analyze/index.tsx`
- ✨ feat: 结果页「标记样本」功能：AI 估算偏差大时点击标记，需先修改重量（>1g 差异）并登录，提交到 critical_samples_weapp 表；参考 hkh 实现，已标记后按钮变绿不可再点 `src/pages/result/index.tsx` `src/pages/result/index.scss` `src/utils/api.ts` `backend/main.py` `backend/database.py` `backend/database/critical_samples.sql`
- ✨ feat: 分析页增加餐次选择（早餐/午餐/晚餐/加餐），分析时传入后端；结果页若来自分析页则直接确认保存不再选餐次与状态 `src/pages/analyze/` `src/pages/result/index.tsx` `src/utils/api.ts` `backend/main.py`
- ✨ feat: 记录页文字记录增加「当前状态」选择，开始计算时传入分析接口；结果页（result-text）若来自文字记录则直接使用该状态确认记录 `src/pages/record/index.tsx` `src/pages/record/index.scss` `src/pages/result-text/index.tsx` `src/utils/api.ts`
- ✨ feat: 分析页（pages/analyze）增加「当前状态」选择，分析时传入后端，AI 结合状态给出建议；结果页若来自分析页则直接使用该状态确认记录 `src/pages/analyze/index.tsx` `src/pages/analyze/index.scss` `src/pages/result/index.tsx` `src/utils/api.ts`
- ✨ feat: 增强食物分析：PFC 比例评价、吸收率说明、情境建议；确认记录时选择当前状态（刚健身完/空腹/减脂期/增肌期/维持/无特殊）；user_food_records 新增 context_state/pfc_ratio_comment/absorption_notes/context_advice `backend/database/user_food_records_pro_analysis.sql` `backend/main.py` `backend/database.py` `src/utils/api.ts` `src/pages/result/` `src/pages/result-text/` `src/pages/record-detail/`
- ✨ feat: 新增识别记录详情页，记录页点击历史记录卡片跳转详情（餐次/时间/总热量、描述与建议、食物明细与宏量汇总） `src/pages/record-detail/` `src/pages/record/index.tsx` `app.config.ts`
- 🎨 style: 健康档案选项宽度收窄，仅比文字略宽（性别/活动/病史/饮食） `src/pages/health-profile/index.scss`
- 🐛 fix: 健康档案切换下一题时校验必填项，未选择/未填写时不允许切换并提示；身高/体重超出范围时给出具体提示 `src/pages/health-profile/index.tsx`
- 🎨 style: 健康档案采用方案 D 轻优化：上一题收进卡片底部与确认同一行，左滑下一题/右滑上一题手势，进度旁「左滑下一题」提示，可选时确认按钮高亮 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- 🎨 style: 健康档案每步「确认」按钮改为紧贴选项/文本框下方，不再贴卡片底部 `src/pages/health-profile/index.scss`
- ✨ feat: 个人页「健康档案」按是否完成分流：未完成跳填写页，已完成跳新建查看页展示已填信息并可修改 `src/pages/profile/index.tsx` `src/pages/health-profile-view/` `app.config.ts`
- ✨ feat: 首页数据对接：GET /api/home/dashboard 聚合今日摄入与今日餐食，首页拉取并展示；运动区块保留静态 `src/pages/index/index.tsx` `src/utils/api.ts` `backend/main.py`
- ✨ feat: 文字记录数量改为多行输入，开始计算前增加用户确认弹窗 `src/pages/record/index.tsx` `src/pages/record/index.scss`
- ✨ feat: 文字记录：多行食物描述、开始计算调大模型分析、跳转 result-text 页展示并确认记录落库 `src/pages/record/index.tsx` `src/pages/result-text/` `src/utils/api.ts` `backend/main.py`
- ✨ feat: 记录页历史记录改为真实数据：GET /api/food-record/list 按日期拉取，支持最近 7 天日期选择，加载/空态/未登录提示 `src/pages/record/index.tsx` `src/utils/api.ts` `backend/main.py` `backend/database.py`
- ✨ feat: 结果页确认记录：点击「确认记录并完成」先选餐次（早餐/午餐/晚餐/加餐），确认后保存到 user_food_records，未登录提示先登录 `src/pages/result/index.tsx` `src/utils/api.ts` `backend/main.py` `backend/database.py` `backend/database/user_food_records.sql`
- 🗃️ db: 新增 user_food_records 表（user_id, meal_type, image_path, description, insight, items, total_* 营养与总重量），用于拍照识别后确认记录落库 `backend/database/user_food_records.sql`
- ✨ feat: 保存健康信息前弹出确认框，保存成功后 1.5 秒跳转到个人中心 `src/pages/health-profile/index.tsx`
- 🐛 fix: 健康档案最后一步改为第 10 步，显示「保存健康信息」按钮；修复 TOTAL_STEPS=9 导致最后一张保存卡无法到达的问题，问卷+OCR 一并保存到数据库 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- ✨ feat: 上传体检报告单独一卡，仅识别不落库；点击「保存健康档案」时将个人身体情况与病例信息一并存入数据库 `backend/main.py` `src/pages/health-profile/index.tsx` `src/utils/api.ts`
- 🎨 style: 健康档案页改为分步卡片答题式交互：每题一卡、卡片滑动切换、进度条、选项卡片点击即下一题，减少枯燥感 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- ✨ feat: 深度个性化健康档案（Professional Onboarding）：基础生理问卷、BMR/TDEE 代谢计算、病史与饮食偏好、体检报告 OCR 导入 `backend/database/user_health_profile.sql` `backend/main.py` `backend/database.py` `backend/metabolic.py` `src/pages/health-profile/` `src/pages/profile/index.tsx` `src/utils/api.ts`
- 🗃️ db: 扩展 weapp_user 表（height/weight/birthday/gender/activity_level/health_condition/bmr/tdee/onboarding_completed），新增 user_health_documents 表用于 OCR 报告 `backend/database/user_health_profile.sql`
- ✨ feat: 个人页增加「健康档案」入口与未完成引导时的提示条，登录后同步 onboarding_completed 状态 `src/pages/profile/index.tsx` `src/app.config.ts`

---

## 2025-01-28

- 🐛 fix: 优化登录错误提示，增加详细错误信息便于排查网络问题 `src/utils/api.ts`
- 🔧 chore: 前端 API 地址改为生产环境 https://healthymax.cn `src/utils/api.ts`
- 🔧 chore: 修改后端启动端口为 3010，同步更新前端 API 地址 `backend/run.sh` `src/utils/api.ts`
- 🔧 refactor: 给所有后端接口添加 /api 前缀，统一API路径规范 `backend/main.py`
- 🐛 fix: 修复结果页食物重量调节时摄入比例跟随变化的bug，现在两者独立调节 `src/pages/result/index.tsx`
- ✨ feat: 添加摄入比例滑块功能，支持拖动调节0-100%（步长5%） `src/pages/result/index.tsx`
- 📝 docs: 完成拍照识别功能的完整技术分析文档
- 🔧 chore: 创建项目开发规则文件 `.cursorrules` 和进度追踪文件 `PROGRESS.md`

---

## 项目初始化

- ✨ feat: 实现微信小程序登录功能（JWT认证）
- ✨ feat: 实现拍照识别食物热量功能（阿里云DashScope AI）
- ✨ feat: 实现营养成分展示（热量、蛋白质、碳水、脂肪、纤维、糖）
- ✨ feat: 实现AI健康建议生成
- ✨ feat: 实现用户信息管理
- ✨ feat: 实现手动调节食物摄入量

---

## 待开发

- [ ] 饮食记录保存到数据库
- [ ] 历史记录查询和展示
- [ ] 每日营养统计图表
- [ ] 摄入比例滑块控件
- [ ] 运动记录功能
- [ ] 社区分享功能
- [ ] 食物收藏功能

---

**当前版本：** v0.1.0-alpha  
**最后更新：** 2026-02-01

