package main

import (
	"log"
	"time"

	"food_link/backend/pkg/config"
)

func main() {
	cfg, err := config.Load(".")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	log.Printf("[worker] bootstrap ok env=%s db=%s:%d/%s", cfg.App.Env, cfg.Database.Host, cfg.Database.Port, cfg.Database.Name)
	for {
		time.Sleep(30 * time.Second)
	}
}
