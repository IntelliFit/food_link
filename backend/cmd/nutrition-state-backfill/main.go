package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func main() {
	dir := flag.String("config-dir", ".", "配置目录")
	stdin := flag.Bool("connection-stdin", false, "从标准输入读取私有DSN配置")
	apply := flag.Bool("apply", false, "执行元数据补全；默认仅预览")
	expected := flag.String("expected-database", "", "执行时必须明确指定数据库名")
	flag.Parse()
	var db *gorm.DB
	var err error
	if *stdin {
		var input struct{ DSN string }
		if json.NewDecoder(os.Stdin).Decode(&input) != nil {
			panic("读取连接配置失败")
		}
		db, err = gorm.Open(postgres.Open(input.DSN), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	} else {
		cfg, e := config.Load(*dir)
		if e != nil {
			panic("读取配置失败")
		}
		db, err = database.Open(cfg.Database)
	}
	if err != nil {
		panic("数据库连接失败")
	}
	sqlDB, err := db.DB()
	if err != nil {
		panic("获取数据库连接失败")
	}
	defer sqlDB.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	var name string
	if db.WithContext(ctx).Raw("SELECT current_database()").Scan(&name).Error != nil {
		panic("读取数据库名称失败")
	}
	if *apply && (*expected == "" || *expected != name) {
		panic("执行目标数据库未明确确认")
	}
	plan, err := migration.PlanNutritionStateBackfill(ctx, db)
	if err != nil {
		panic("营养状态预览失败")
	}
	updated := 0
	if *apply {
		updated, err = migration.ApplyNutritionStateBackfill(ctx, db, plan)
		if err != nil {
			panic(err)
		}
	}
	if err = json.NewEncoder(os.Stdout).Encode(map[string]any{"database": name, "apply": *apply, "updated": updated, "plan": plan}); err != nil {
		fmt.Fprintln(os.Stderr, "输出补全计划失败")
		os.Exit(1)
	}
}
