# CURRENT_TASK

- Task: 运动记录功能 UI 实现
- Status: done（代码已实现并编译通过）
- Scope:
  ## 功能描述
  在首页添加"记运动"入口，用户可以通过聊天框形式输入运动描述，前端自动解析运动类型并估算热量消耗。

  ## 实现内容
  
  ### 1. 首页运动卡片入口
  - 在体重/喝水卡片区域新增运动卡片（3列网格布局）
  - 点击跳转至运动记录页面
  - 显示今日消耗热量统计（当前显示 "--" 占位）
  
  ### 2. 运动记录页面
  - 页面路径: `pages/exercise-record/index`
  - 聊天框UI设计，类似聊天界面
  - 支持输入自然语言描述（如"跑步30分钟"）
  - 前端自动解析运动类型并计算热量消耗
  - 显示历史记录列表
  - 支持快捷示例点击填充
  
  ### 3. 运动类型与热量计算
  支持解析以下运动类型：
  - 跑步: 600 kcal/小时
  - 游泳: 500 kcal/小时
  - 骑行: 400 kcal/小时
  - 走路: 250 kcal/小时
  - 健身: 350 kcal/小时
  - 瑜伽: 200 kcal/小时
  - 篮球: 450 kcal/小时
  - 羽毛球: 350 kcal/小时
  - 跳绳: 700 kcal/小时
  - 爬楼梯: 500 kcal/小时
  - 跳舞: 400 kcal/小时
  - 椭圆机: 450 kcal/小时
  - 划船机: 500 kcal/小时
  - HIIT: 800 kcal/小时
  
  ## 修改文件
  - `src/components/iconfont/index.tsx`: 新增 IconExercise、IconSend 图标
  - `src/pages/index/index.tsx`: 添加运动卡片入口和跳转逻辑
  - `src/pages/index/index.scss`: 修改 body-status-section 为3列网格布局，添加运动卡片样式
  - `src/app.config.ts`: 注册 exercise-record 页面
  - `src/pages/exercise-record/index.tsx`: 新建运动记录页面
  - `src/pages/exercise-record/index.scss`: 新建运动记录页面样式
  - `src/pages/exercise-record/index.config.ts`: 新建页面配置

  ## 待后续实现
  - 后端API：保存/获取运动记录
  - 与首页热量统计联动（增加"运动消耗"维度）
  - 运动数据持久化存储（目前仅本地存储）

---

- Previous Task: 波浪水池渲染优化 - 修复动画速度过慢和摄入目标变化时的剧烈波动问题
- Previous Status: done
