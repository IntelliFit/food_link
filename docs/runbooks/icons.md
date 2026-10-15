# 图标与缓存资料

图标系统使用iconfont，已有脚本 `scripts/update-icon.py`。需要更新图标时先读脚本及输入/输出位置，按任务范围执行 `python scripts/update-icon.py`，不要在普通验收时运行。

缓存字段、页面和接口关系继续维护 `docs/frontend-cache-design.md`；新增缓存同步profile页 `handleClearCache`。原规则全文位于 `docs/archive/agents-backup-20261015/AGENTS.original.md` 的“图标更新”和“前端缓存与数据不一致排查”。
