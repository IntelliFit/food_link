package metrics

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

const gormStartKey = "food_link_metrics_start"

func RegisterGORMCallbacks(db *gorm.DB) {
	if db == nil {
		return
	}
	_ = db.Callback().Create().Before("gorm:create").Register("food_link:metrics_before_create", beforeGORMOperation())
	_ = db.Callback().Create().After("gorm:create").Register("food_link:metrics_after_create", afterGORMOperation("create"))
	_ = db.Callback().Query().Before("gorm:query").Register("food_link:metrics_before_query", beforeGORMOperation())
	_ = db.Callback().Query().After("gorm:query").Register("food_link:metrics_after_query", afterGORMOperation("query"))
	_ = db.Callback().Update().Before("gorm:update").Register("food_link:metrics_before_update", beforeGORMOperation())
	_ = db.Callback().Update().After("gorm:update").Register("food_link:metrics_after_update", afterGORMOperation("update"))
	_ = db.Callback().Delete().Before("gorm:delete").Register("food_link:metrics_before_delete", beforeGORMOperation())
	_ = db.Callback().Delete().After("gorm:delete").Register("food_link:metrics_after_delete", afterGORMOperation("delete"))
	_ = db.Callback().Raw().Before("gorm:raw").Register("food_link:metrics_before_raw", beforeGORMOperation())
	_ = db.Callback().Raw().After("gorm:raw").Register("food_link:metrics_after_raw", afterGORMOperation("raw"))
	_ = db.Callback().Row().Before("gorm:row").Register("food_link:metrics_before_row", beforeGORMOperation())
	_ = db.Callback().Row().After("gorm:row").Register("food_link:metrics_after_row", afterGORMOperation("row"))
}

func beforeGORMOperation() func(*gorm.DB) {
	return func(tx *gorm.DB) {
		if tx == nil {
			return
		}
		tx.InstanceSet(gormStartKey, time.Now())
	}
}

func afterGORMOperation(operation string) func(*gorm.DB) {
	return func(tx *gorm.DB) {
		if tx == nil {
			return
		}
		startValue, ok := tx.InstanceGet(gormStartKey)
		if !ok {
			return
		}
		start, ok := startValue.(time.Time)
		if !ok {
			return
		}
		table := ""
		if tx.Statement != nil {
			table = tx.Statement.Table
			if table == "" && tx.Statement.Schema != nil {
				table = tx.Statement.Schema.Table
			}
		}
		status := "success"
		if tx.Error != nil {
			if errors.Is(tx.Error, gorm.ErrRecordNotFound) {
				status = "not_found"
			} else {
				status = "error"
			}
		}
		ObserveDBOperation(operation, table, status, time.Since(start))
	}
}
