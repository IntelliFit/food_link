package database

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	applogger "food_link/backend/pkg/logger"

	oteltrace "go.opentelemetry.io/otel/trace"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	gormLogStartKey      = "food_link_logger_start"
	gormLogSlowThreshold = 200 * time.Millisecond
	gormStatementLimit   = 800
)

type gormLogAdapter struct {
	level         gormlogger.LogLevel
	slowThreshold time.Duration
}

func newGORMLogger() gormlogger.Interface {
	return gormLogAdapter{
		level:         gormlogger.Info,
		slowThreshold: gormLogSlowThreshold,
	}
}

func (l gormLogAdapter) LogMode(level gormlogger.LogLevel) gormlogger.Interface {
	l.level = level
	return l
}

func (l gormLogAdapter) Info(ctx context.Context, msg string, data ...interface{}) {
	if l.level < gormlogger.Info {
		return
	}
	applogger.Info(ctx, "数据库信息", slog.String("db.message", formatGORMMessage(msg, data...)))
}

func (l gormLogAdapter) Warn(ctx context.Context, msg string, data ...interface{}) {
	if l.level < gormlogger.Warn {
		return
	}
	applogger.Warn(ctx, "数据库警告", slog.String("db.message", formatGORMMessage(msg, data...)))
}

func (l gormLogAdapter) Error(ctx context.Context, msg string, data ...interface{}) {
	if l.level < gormlogger.Error {
		return
	}
	applogger.Error(ctx, "数据库错误", nil, slog.String("db.message", formatGORMMessage(msg, data...)))
}

func (l gormLogAdapter) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	if l.level <= gormlogger.Silent {
		return
	}
	hasTrace := shouldLogDBDetails(ctx)
	elapsed := time.Since(begin)
	sqlText, rowsAffected := fc()
	operation := operationFromSQL(sqlText)
	attrs := dbTraceAttrs(operation, "", elapsed, rowsAffected, sqlText)

	switch {
	case err != nil && !errors.Is(err, gorm.ErrRecordNotFound):
		if l.level >= gormlogger.Error {
			applogger.Error(ctx, gormTraceMessage(operation, "failed"), err, attrs...)
		}
	case err != nil && errors.Is(err, gorm.ErrRecordNotFound):
		if hasTrace && l.level >= gormlogger.Info {
			attrs = append(attrs, slog.String("db.status", "not_found"), applogger.NamedErr("db.error", err))
			applogger.Info(ctx, gormTraceMessage(operation, "not_found"), attrs...)
		}
	case elapsed > l.slowThreshold:
		if hasTrace && l.level >= gormlogger.Warn {
			applogger.Warn(ctx, gormTraceMessage(operation, "slow"), attrs...)
		}
	default:
		if hasTrace && l.level >= gormlogger.Info {
			applogger.Info(ctx, gormTraceMessage(operation, "done"), attrs...)
		}
	}
}

func registerGORMLogCallbacks(db *gorm.DB) {
	if db == nil {
		return
	}
	_ = db.Callback().Create().Before("gorm:create").Register("food_link:log_before_create", beforeGORMLogOperation("create"))
	_ = db.Callback().Query().Before("gorm:query").Register("food_link:log_before_query", beforeGORMLogOperation("query"))
	_ = db.Callback().Update().Before("gorm:update").Register("food_link:log_before_update", beforeGORMLogOperation("update"))
	_ = db.Callback().Delete().Before("gorm:delete").Register("food_link:log_before_delete", beforeGORMLogOperation("delete"))
	_ = db.Callback().Raw().Before("gorm:raw").Register("food_link:log_before_raw", beforeGORMLogOperation("raw"))
	_ = db.Callback().Row().Before("gorm:row").Register("food_link:log_before_row", beforeGORMLogOperation("row"))
}

func beforeGORMLogOperation(operation string) func(*gorm.DB) {
	return func(tx *gorm.DB) {
		if tx == nil {
			return
		}
		tx.InstanceSet(gormLogStartKey, time.Now())
		ctx := context.Background()
		table := ""
		if tx.Statement != nil {
			if tx.Statement.Context != nil {
				ctx = tx.Statement.Context
			}
			table = statementTable(tx)
		}
		if !shouldLogDBDetails(ctx) {
			return
		}
		applogger.Info(ctx, gormStartMessage(operation), dbStartAttrs(operation, table)...)
	}
}

func dbStartAttrs(operation, table string) []slog.Attr {
	attrs := []slog.Attr{slog.String("db.operation", operation)}
	if table = strings.TrimSpace(table); table != "" {
		attrs = append(attrs, slog.String("db.table", table))
	}
	return attrs
}

func dbTraceAttrs(operation, table string, elapsed time.Duration, rowsAffected int64, sqlText string) []slog.Attr {
	attrs := []slog.Attr{
		slog.Duration("db.duration", elapsed),
		slog.Int64("db.rows_affected", rowsAffected),
	}
	if operation = strings.TrimSpace(operation); operation != "" {
		attrs = append(attrs, slog.String("db.operation", operation))
	}
	if table = strings.TrimSpace(table); table != "" {
		attrs = append(attrs, slog.String("db.table", table))
	}
	statement, truncated := sanitizeSQLStatement(sqlText, gormStatementLimit)
	if statement != "" {
		attrs = append(attrs,
			slog.String("db.statement", statement),
			slog.Bool("db.statement_truncated", truncated),
		)
	}
	return attrs
}

func statementTable(tx *gorm.DB) string {
	if tx == nil || tx.Statement == nil {
		return ""
	}
	if table := strings.TrimSpace(tx.Statement.Table); table != "" {
		return table
	}
	if tx.Statement.Schema != nil {
		return strings.TrimSpace(tx.Statement.Schema.Table)
	}
	return ""
}

func shouldLogDBDetails(ctx context.Context) bool {
	return oteltrace.SpanContextFromContext(ctx).IsValid()
}

func gormStartMessage(operation string) string {
	switch operation {
	case "create":
		return "开始写入数据库"
	case "update":
		return "开始更新数据库"
	case "delete":
		return "开始删除数据库"
	case "raw":
		return "开始执行数据库语句"
	case "row":
		return "开始读取数据库单行"
	default:
		return "开始查询数据库"
	}
}

func gormTraceMessage(operation, status string) string {
	switch status {
	case "failed":
		switch operation {
		case "create":
			return "数据库写入失败"
		case "update":
			return "数据库更新失败"
		case "delete":
			return "数据库删除失败"
		case "raw":
			return "数据库语句执行失败"
		default:
			return "数据库查询失败"
		}
	case "not_found":
		return "数据库查询未命中"
	case "slow":
		switch operation {
		case "create":
			return "数据库写入较慢"
		case "update":
			return "数据库更新较慢"
		case "delete":
			return "数据库删除较慢"
		case "raw":
			return "数据库语句执行较慢"
		default:
			return "数据库查询较慢"
		}
	default:
		switch operation {
		case "create":
			return "数据库写入完成"
		case "update":
			return "数据库更新完成"
		case "delete":
			return "数据库删除完成"
		case "raw":
			return "数据库语句执行完成"
		default:
			return "数据库查询完成"
		}
	}
}

func operationFromSQL(sqlText string) string {
	fields := strings.Fields(strings.TrimSpace(sqlText))
	if len(fields) == 0 {
		return "query"
	}
	switch strings.ToUpper(fields[0]) {
	case "SELECT", "WITH":
		return "query"
	case "INSERT":
		return "create"
	case "UPDATE", "UPSERT":
		return "update"
	case "DELETE", "TRUNCATE":
		return "delete"
	default:
		return "raw"
	}
}

func formatGORMMessage(msg string, data ...interface{}) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return ""
	}
	if len(data) == 0 {
		return msg
	}
	return fmt.Sprintf(msg, data...)
}

func sanitizeSQLStatement(sqlText string, limit int) (string, bool) {
	compact := strings.Join(strings.Fields(strings.TrimSpace(sqlText)), " ")
	if compact == "" {
		return "", false
	}
	redacted := redactSQLStringLiterals(compact)
	if limit <= 0 || utf8.RuneCountInString(redacted) <= limit {
		return redacted, false
	}
	return truncateRunes(redacted, limit) + "...", true
}

func redactSQLStringLiterals(sqlText string) string {
	var b strings.Builder
	inString := false
	for i := 0; i < len(sqlText); i++ {
		ch := sqlText[i]
		if !inString {
			if ch == '\'' {
				inString = true
				continue
			}
			b.WriteByte(ch)
			continue
		}
		if ch == '\'' {
			if i+1 < len(sqlText) && sqlText[i+1] == '\'' {
				i++
				continue
			}
			b.WriteString("'?'")
			inString = false
			continue
		}
	}
	if inString {
		b.WriteString("'?'")
	}
	return b.String()
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	count := 0
	for index := range value {
		if count == limit {
			return value[:index]
		}
		count++
	}
	return value
}
