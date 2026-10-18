# 后端结构化日志

以下规范从原AGENTS完整搬入。日志只写定位所需摘要，不写完整手机号、配置凭据或大请求体；不要为日志规范改动启动真实业务worker。

## 日志规范

后端统一使用 `pkg/logger` 中基于 `log/slog` 的结构化日志，不再使用 `zap`，也不要直接使用 Gin 默认的 `gin.Logger()`。日志入口由 `internal/app.New` 初始化，`logger.RequestLogger()` 负责记录每个 HTTP 请求的结构化访问日志。

日志配置在 `config.yaml` 的 `log` 节中维护：

```yaml
log:
  # debug/info/warn/error
  level: info
  # json/text
  format: json
  # stdout/file/both
  output: stdout
  file_path: logs/food-link-backend.log
```

启用 `otel.enabled` 时，日志会同时通过 `otelslog` 和 OTLP gRPC 上报到 OpenTelemetry Collector。业务代码通过 `logger.Info/Warn/Error` 传入 `context.Context` 后，日志会自动附带 `trace_id` 和 `span_id`，便于在查看 trace 时关联到同一次请求的日志。

业务代码中添加日志时，使用下面的形式：

```go
logger.Info(ctx, "云端项目保存完成",
	slog.String("user_id", userID),
	slog.String("project_id", project.ID),
	slog.Int64("project.version", project.Version),
)

logger.Error(ctx, "保存云端项目失败", err,
	slog.String("user_id", userID),
	slog.String("project_id", project.ID),
)
```

日志消息必须使用中文；结构化字段名保持英文，例如 `user_id`、`project_id`、`http.status_code`、`trace_id`，方便日志平台过滤、聚合和跨系统关联。不要把完整请求体、项目快照、token、密码、OAuth code、邀请码明文等敏感或体积大的内容写入日志，只记录必要的 ID、状态、数量、版本、字节数和错误原因。

后续新增或修改 API 时，必须在关键位置补充日志：

- handler 层记录请求进入和成功完成，包含当前用户、资源 ID、主要动作和返回数量等摘要信息。
- service 层记录关键业务分支，例如创建转更新、权限校验失败、配额检查、状态流转、成员或邀请码变更。
- repo/外部依赖调用失败时，在 service 层记录错误日志，并带上定位问题所需的资源 ID。
- 对应的 trace 事件如果已经使用 `pkg/trace.RecordError`，事件名称也应使用中文，并与日志语义保持一致。
- 对预期内的业务错误使用 `Warn`，对数据库、外部服务、不可恢复异常使用 `Error`，正常关键状态变化使用 `Info`。
