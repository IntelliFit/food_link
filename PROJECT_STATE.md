# PROJECT_STATE

- Project: `food_link`
- Workspace: `D:\files\food_link`
- Ownership: dedicated coding agent for `food_link`
- Surface: WeChat Mini Program
- UI verification tool: `weapp-devtools`
- DevTools port: `3001` (allocated by portman)
- Automation note: prefer dedicated mini program automation target for this project; do not rely on a shared default target
- Memory rule: durable project facts must be written to `CURRENT_TASK.md`, `DECISIONS.md`, or `memory/YYYY-MM-DD.md` instead of living only in chat history

## 后端迁移状态

### 技术栈迁移
- 旧方案：Supabase（PostgreSQL + Storage）
- 新方案：独立 PostgreSQL + 腾讯云 COS + CDN
- 当前后端：Go 后端（位于 `backend/`）
- 旧后端：Python 后端（已归档到 `backend_bak/`）

### 迁移脚本（位于 `backend_bak/scripts/`）
1. `migrate_supabase_postgres_to_postgresql.py`
   - 作用：将 Supabase 数据库数据全量迁移到新的独立 PostgreSQL
   - 连接源：Supabase REST API
   - 连接目标：POSTGRESQL_HOST 等环境变量指向的 PostgreSQL

2. `migrate_supabase_storage_to_cos.py`
   - 作用：将 Supabase Storage 图片全量复制到腾讯云 COS
   - 支持按源 bucket 映射到不同目标 bucket
   - 支持跳过已存在对象、dry-run 等

3. `normalize_storage_keys_in_postgresql.py`
   - 作用：将数据库中存储的完整 Supabase URL 清洗为 COS key
   - 处理的表和字段：
     - `weapp_user.avatar` → user-avatars
     - `user_food_records.image_path` / `image_paths` → food-images
     - `analysis_tasks.image_url` / `image_paths` → food-images/health-reports
     - `user_health_documents.image_url` → health-reports
     - `public_food_library.image_path` / `image_paths` → food-images
     - `user_recipes.image_path` → food-images
   - 默认 dry-run，需传入 `--apply` 才真正更新
   - 支持重复运行（幂等）

### 图片存储架构约定
- 数据库只存储 COS key（如 `userID/uuid.jpg`）
- 上传时：`storage.UploadBytes`/`UploadBase64` 内部调用 `BuildAccessURL` 返回完整 CDN URL
- 查询返回时：Go 后端需要在 service/handler 层调用 `BuildAccessURL` 将 key 拼接为完整 CDN URL 后返回给前端
- CDN 配置（`backend/config.yaml`）：
  - food-images: `http://cdn-food-images.coachlink.fit`
  - user-avatars: `http://cdn-food-user-avatars.coachlink.fit`
  - icon: `http://cdn-food-icon.coachlink.fit`

### 当前问题
- Go 后端查询返回时直接透传了数据库中的 key，没有拼接 CDN 前缀，导致前端看到纯 key 路径
