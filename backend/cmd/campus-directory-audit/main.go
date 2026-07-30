package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

type coverage struct {
	Locations             int64            `json:"locations"`
	LocationTypes         map[string]int64 `json:"location_types"`
	OfficialDirectory     int64            `json:"official_directory"`
	OfficialRegular       int64            `json:"official_regular"`
	OfficialAdult         int64            `json:"official_adult"`
	Sites                 int64            `json:"sites"`
	SiteStatuses          map[string]int64 `json:"site_statuses"`
	Canteens              int64            `json:"canteens"`
	CanteenStatuses       map[string]int64 `json:"canteen_statuses"`
	CanteenEvidenceLevels map[string]int64 `json:"canteen_evidence_levels"`
	Windows               int64            `json:"windows"`
	WindowStatuses        map[string]int64 `json:"window_statuses"`
	Sources               int64            `json:"sources"`
	SourceReviewStatuses  map[string]int64 `json:"source_review_statuses"`
	LocationsWithCanteens int64            `json:"locations_with_canteens"`
	DetailedAuditStatuses map[string]int64 `json:"detailed_audit_statuses"`
}

type schoolDiningAudit struct {
	SchoolID                  string                     `json:"school_id"`
	OfficialCode              string                     `json:"official_code,omitempty"`
	Name                      string                     `json:"name"`
	Province                  string                     `json:"province,omitempty"`
	InstitutionKind           string                     `json:"institution_kind,omitempty"`
	ActiveSiteCount           int64                      `json:"active_site_count"`
	ActiveCanteenCount        int64                      `json:"active_canteen_count"`
	CanteensWithFloorMetadata int64                      `json:"canteens_with_floor_metadata"`
	ActiveWindowCount         int64                      `json:"active_window_count"`
	ApprovedSourceCount       int64                      `json:"approved_source_count"`
	PendingSourceCount        int64                      `json:"pending_source_count"`
	AuditStatus               string                     `json:"audit_status"`
	NextAction                string                     `json:"next_action"`
	Canteens                  []schoolDiningCanteenAudit `json:"canteens,omitempty" gorm:"-"`
	Windows                   []schoolDiningWindowAudit  `json:"windows,omitempty" gorm:"-"`
}

type schoolDiningCanteenAudit struct {
	CampusName      string `json:"campus_name,omitempty"`
	Name            string `json:"name"`
	BuildingOrFloor string `json:"building_or_floor,omitempty"`
	Status          string `json:"status"`
	EvidenceLevel   string `json:"evidence_level,omitempty"`
	SourceURL       string `json:"source_url,omitempty"`
}

type schoolDiningWindowAudit struct {
	CampusName string `json:"campus_name,omitempty"`
	Canteen    string `json:"canteen"`
	Name       string `json:"name"`
	Floor      string `json:"floor,omitempty"`
	Status     string `json:"status"`
	SourceURL  string `json:"source_url,omitempty"`
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing .env plus app-config.yaml or apollo-config.yaml")
	timeout := flag.Duration("timeout", 30*time.Second, "database audit timeout")
	detailOutput := flag.String("detail-output", "", "optional JSON path for the per-school dining audit queue")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取数据库连接失败: %v", err)
	}
	defer sqlDB.Close()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			log.Fatalf("设置数据库 schema 失败: %v", err)
		}
	}
	out := coverage{
		LocationTypes:         map[string]int64{},
		SiteStatuses:          map[string]int64{},
		CanteenStatuses:       map[string]int64{},
		CanteenEvidenceLevels: map[string]int64{},
		WindowStatuses:        map[string]int64{},
		SourceReviewStatuses:  map[string]int64{},
		DetailedAuditStatuses: map[string]int64{},
	}
	if err := db.WithContext(ctx).Table("schools").Where("status = ?", "active").Count(&out.Locations).Error; err != nil {
		log.Fatalf("统计地点失败: %v", err)
	}
	var locationTypeColumnExists bool
	if err := db.WithContext(ctx).Raw("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'schools' AND column_name = 'location_type')").Scan(&locationTypeColumnExists).Error; err != nil {
		log.Fatalf("检查地点类型字段失败: %v", err)
	}
	if !locationTypeColumnExists {
		out.LocationTypes["university"] = out.Locations
	} else {
		var types []struct {
			Type  string
			Count int64
		}
		if err := db.WithContext(ctx).Table("schools").Select("COALESCE(NULLIF(location_type, ''), 'university') AS type, COUNT(*) AS count").Where("status = ?", "active").Group("type").Scan(&types).Error; err != nil {
			log.Fatalf("统计地点类型失败: %v", err)
		}
		for _, row := range types {
			out.LocationTypes[row.Type] = row.Count
		}
		if err := db.WithContext(ctx).Table("schools").Where("official_source_version = ? AND status = ?", "2026-06-17", "active").Count(&out.OfficialDirectory).Error; err != nil {
			log.Fatalf("统计教育部高校目录失败: %v", err)
		}
		if err := db.WithContext(ctx).Table("schools").Where("official_source_version = ? AND institution_kind = ? AND status = ?", "2026-06-17", "regular", "active").Count(&out.OfficialRegular).Error; err != nil {
			log.Fatalf("统计普通高校失败: %v", err)
		}
		if err := db.WithContext(ctx).Table("schools").Where("official_source_version = ? AND institution_kind = ? AND status = ?", "2026-06-17", "adult", "active").Count(&out.OfficialAdult).Error; err != nil {
			log.Fatalf("统计成人高校失败: %v", err)
		}
	}
	if err := db.WithContext(ctx).Table("school_campuses").Where("status = ?", "active").Count(&out.Sites).Error; err != nil {
		log.Fatalf("统计地点分区失败: %v", err)
	}
	if err := collectGroupedCounts(ctx, db, "school_campuses", "status", out.SiteStatuses); err != nil {
		log.Fatalf("统计地点分区状态失败: %v", err)
	}
	if err := db.WithContext(ctx).Table("school_canteens").Where("status = ?", "active").Count(&out.Canteens).Error; err != nil {
		log.Fatalf("统计食堂失败: %v", err)
	}
	if err := collectGroupedCounts(ctx, db, "school_canteens", "status", out.CanteenStatuses); err != nil {
		log.Fatalf("统计食堂状态失败: %v", err)
	}
	if err := collectGroupedCounts(ctx, db, "school_canteens", "COALESCE(NULLIF(confidence_level, ''), 'unknown')", out.CanteenEvidenceLevels); err != nil {
		log.Fatalf("统计食堂证据等级失败: %v", err)
	}
	if err := db.WithContext(ctx).Table("canteen_windows").Where("status = ?", "active").Count(&out.Windows).Error; err != nil {
		log.Fatalf("统计窗口失败: %v", err)
	}
	if err := collectGroupedCounts(ctx, db, "canteen_windows", "status", out.WindowStatuses); err != nil {
		log.Fatalf("统计窗口状态失败: %v", err)
	}
	if err := db.WithContext(ctx).Table("campus_directory_sources").Count(&out.Sources).Error; err != nil {
		log.Fatalf("统计目录来源失败: %v", err)
	}
	if err := collectGroupedCounts(ctx, db, "campus_directory_sources", "review_status", out.SourceReviewStatuses); err != nil {
		log.Fatalf("统计目录来源审核状态失败: %v", err)
	}
	if err := db.WithContext(ctx).Table("schools s").Where("s.status = ? AND EXISTS (SELECT 1 FROM school_canteens c WHERE c.school_id = s.id AND c.status = 'active')", "active").Count(&out.LocationsWithCanteens).Error; err != nil {
		log.Fatalf("统计已覆盖地点失败: %v", err)
	}
	if strings.TrimSpace(*detailOutput) != "" {
		rows, err := collectSchoolDiningAudits(ctx, db)
		if err != nil {
			log.Fatalf("生成逐校餐饮审计清单失败: %v", err)
		}
		for _, row := range rows {
			out.DetailedAuditStatuses[row.AuditStatus]++
		}
		if err := writeSchoolDiningAudits(*detailOutput, rows); err != nil {
			log.Fatalf("写入逐校餐饮审计清单失败: %v", err)
		}
	}
	encoded, _ := json.MarshalIndent(out, "", "  ")
	fmt.Println(string(encoded))
}

func collectSchoolDiningAudits(ctx context.Context, db *gorm.DB) ([]schoolDiningAudit, error) {
	var rows []schoolDiningAudit
	err := db.WithContext(ctx).Raw(`
		SELECT
			s.id AS school_id,
			COALESCE(s.official_code, '') AS official_code,
			s.name,
			COALESCE(s.province, '') AS province,
			COALESCE(s.institution_kind, '') AS institution_kind,
			COUNT(DISTINCT campus.id) FILTER (WHERE campus.status = 'active') AS active_site_count,
			COUNT(DISTINCT canteen.id) FILTER (WHERE canteen.status = 'active') AS active_canteen_count,
			COUNT(DISTINCT canteen.id) FILTER (
				WHERE canteen.status = 'active'
				  AND NULLIF(trim(canteen.building_or_floor), '') IS NOT NULL
			) AS canteens_with_floor_metadata,
			COUNT(DISTINCT window_row.id) FILTER (WHERE window_row.status = 'active') AS active_window_count,
			COUNT(DISTINCT source.id) FILTER (WHERE source.review_status = 'approved') AS approved_source_count,
			COUNT(DISTINCT source.id) FILTER (WHERE source.review_status = 'pending_review') AS pending_source_count
		FROM schools AS s
		LEFT JOIN school_campuses AS campus ON campus.school_id = s.id
		LEFT JOIN school_canteens AS canteen ON canteen.school_id = s.id
		LEFT JOIN canteen_windows AS window_row ON window_row.canteen_id = canteen.id
		LEFT JOIN campus_directory_sources AS source ON source.school_id = s.id
		WHERE s.status = 'active' AND COALESCE(NULLIF(s.location_type, ''), 'university') = 'university'
		GROUP BY s.id, s.official_code, s.name, s.province, s.institution_kind
		ORDER BY s.province ASC, s.name ASC
	`).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	rowIndexBySchoolID := make(map[string]int, len(rows))
	for index := range rows {
		rowIndexBySchoolID[rows[index].SchoolID] = index
	}
	var canteens []struct {
		SchoolID        string `gorm:"column:school_id"`
		CampusName      string `gorm:"column:campus_name"`
		Name            string `gorm:"column:name"`
		BuildingOrFloor string `gorm:"column:building_or_floor"`
		Status          string `gorm:"column:status"`
		EvidenceLevel   string `gorm:"column:evidence_level"`
		SourceURL       string `gorm:"column:source_url"`
	}
	if err := db.WithContext(ctx).Raw(`
		SELECT c.school_id,
		       COALESCE(campus.name, '') AS campus_name,
		       c.name,
		       COALESCE(c.building_or_floor, '') AS building_or_floor,
		       c.status,
		       COALESCE(c.confidence_level, '') AS evidence_level,
		       COALESCE(c.source_url, '') AS source_url
		FROM school_canteens AS c
		JOIN schools AS s ON s.id = c.school_id
		LEFT JOIN school_campuses AS campus ON campus.id = c.campus_id
		WHERE s.status = 'active'
		  AND COALESCE(NULLIF(s.location_type, ''), 'university') = 'university'
		  AND c.status NOT IN ('deleted', 'rejected')
		ORDER BY s.province ASC, s.name ASC, campus.sort_order ASC, c.sort_order ASC, c.name ASC
	`).Scan(&canteens).Error; err != nil {
		return nil, err
	}
	for _, canteen := range canteens {
		index, ok := rowIndexBySchoolID[canteen.SchoolID]
		if !ok {
			continue
		}
		rows[index].Canteens = append(rows[index].Canteens, schoolDiningCanteenAudit{
			CampusName:      canteen.CampusName,
			Name:            canteen.Name,
			BuildingOrFloor: canteen.BuildingOrFloor,
			Status:          canteen.Status,
			EvidenceLevel:   canteen.EvidenceLevel,
			SourceURL:       canteen.SourceURL,
		})
	}
	var windows []struct {
		SchoolID   string `gorm:"column:school_id"`
		CampusName string `gorm:"column:campus_name"`
		Canteen    string `gorm:"column:canteen"`
		Name       string `gorm:"column:name"`
		Floor      string `gorm:"column:floor"`
		Status     string `gorm:"column:status"`
		SourceURL  string `gorm:"column:source_url"`
	}
	if err := db.WithContext(ctx).Raw(`
		SELECT w.school_id,
		       COALESCE(campus.name, '') AS campus_name,
		       c.name AS canteen,
		       w.name,
		       COALESCE(w.floor, '') AS floor,
		       w.status,
		       COALESCE(w.source_url, '') AS source_url
		FROM canteen_windows AS w
		JOIN schools AS s ON s.id = w.school_id
		JOIN school_canteens AS c ON c.id = w.canteen_id
		LEFT JOIN school_campuses AS campus ON campus.id = w.campus_id
		WHERE s.status = 'active'
		  AND COALESCE(NULLIF(s.location_type, ''), 'university') = 'university'
		  AND w.status <> 'deleted'
		ORDER BY s.province ASC, s.name ASC, campus.sort_order ASC, c.sort_order ASC, w.sort_order ASC, w.name ASC
	`).Scan(&windows).Error; err != nil {
		return nil, err
	}
	for _, window := range windows {
		index, ok := rowIndexBySchoolID[window.SchoolID]
		if !ok {
			continue
		}
		rows[index].Windows = append(rows[index].Windows, schoolDiningWindowAudit{
			CampusName: window.CampusName,
			Canteen:    window.Canteen,
			Name:       window.Name,
			Floor:      window.Floor,
			Status:     window.Status,
			SourceURL:  window.SourceURL,
		})
	}
	for index := range rows {
		row := &rows[index]
		switch {
		case row.ApprovedSourceCount == 0 && row.PendingSourceCount == 0:
			row.AuditStatus = "not_started"
			row.NextAction = "discover_official_sources"
		case row.ApprovedSourceCount == 0:
			row.AuditStatus = "pending_source_review"
			row.NextAction = "review_existing_sources"
		case row.ActiveCanteenCount == 0:
			row.AuditStatus = "source_found_no_published_canteen"
			row.NextAction = "extract_and_review_canteens"
		case row.CanteensWithFloorMetadata == 0:
			row.AuditStatus = "source_backed_missing_floors"
			row.NextAction = "collect_floor_and_window_evidence"
		default:
			// A school is still only partial until an explicit whole-school
			// review confirms that every operating campus and canteen was checked.
			row.AuditStatus = "source_backed_partial"
			row.NextAction = "complete_whole_school_review"
		}
	}
	return rows, nil
}

func writeSchoolDiningAudits(outputPath string, rows []schoolDiningAudit) error {
	outputPath = filepath.Clean(strings.TrimSpace(outputPath))
	if outputPath == "." || outputPath == "" {
		return fmt.Errorf("invalid detail output path")
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return err
	}
	payload := struct {
		GeneratedAt time.Time           `json:"generated_at"`
		Scope       string              `json:"scope"`
		Schools     []schoolDiningAudit `json:"schools"`
	}{
		GeneratedAt: time.Now(),
		Scope:       "教育部2026-06-17全国高校目录；状态表示当前证据覆盖，不代表整校已完整核验",
		Schools:     rows,
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(outputPath, append(encoded, '\n'), 0o644)
}

func collectGroupedCounts(ctx context.Context, db *gorm.DB, table string, expression string, target map[string]int64) error {
	var rows []struct {
		Value string `gorm:"column:value"`
		Count int64  `gorm:"column:count"`
	}
	if err := db.WithContext(ctx).Table(table).
		Select(expression + " AS value, COUNT(*) AS count").
		Group(expression).
		Scan(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		target[row.Value] = row.Count
	}
	return nil
}
