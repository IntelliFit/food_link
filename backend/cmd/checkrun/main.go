package main

import (
	"fmt"
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type Sample struct {
	ID          string
	SampleID    string
	Status      string
	Prediction  []byte
	GroundTruth []byte
	Metrics     []byte
}

func main() {
	dsn := "host=154.8.205.78 port=5432 user=app_user password=ffa2053eddc5b7564be7c20437086f67 dbname=food-link sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	var samples []Sample
	if err := db.Raw("SELECT id, sample_id, status, prediction, ground_truth, metrics FROM benchmark_run_samples WHERE run_id = ?", "002ba4d5-1695-4ab1-9d5f-725845e315e6").Scan(&samples).Error; err != nil {
		log.Fatal(err)
	}
	for _, s := range samples {
		fmt.Printf("sample_id=%s status=%s\n", s.SampleID, s.Status)
		fmt.Printf("prediction=%s\n", string(s.Prediction))
		fmt.Printf("ground_truth=%s\n", string(s.GroundTruth))
		fmt.Printf("metrics=%s\n", string(s.Metrics))
	}
}
