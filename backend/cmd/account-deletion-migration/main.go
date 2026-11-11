// Dedicated account lifecycle migration. Never called by HTTP startup.
package main

import (
	"context"
	"flag"
	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"log"
)

func main() {
	configFile := flag.String("config-dir", ".", "configuration directory")
	flag.Parse()
	cfg, err := config.Load(*configFile)
	if err != nil {
		log.Fatal(err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatal(err)
	}
	if err := migration.MigrateAccountDeletion(context.Background(), db, cfg.Database.Schema); err != nil {
		log.Fatal(err)
	}
	log.Print("账号注销专项迁移完成")
}
