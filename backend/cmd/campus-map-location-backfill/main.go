package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	utilityservice "food_link/backend/internal/utility/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

const (
	coordinateSourceTianditu = "tianditu_poi_cgcs2000_to_gcj02"
	coordinateSourceOverride = "manual_low_confidence_20260926"
)

type locationCandidate struct {
	Kind         string
	ID           string
	SchoolID     string
	SchoolName   string
	CampusName   string
	CanteenName  string
	Address      string
	LocationText string
	Province     string
	City         string
}

type poi struct {
	Name      string
	Address   string
	Longitude float64
	Latitude  float64
	Score     int
}

func main() {
	apply := flag.Bool("apply", false, "write resolved coordinates; default is dry-run")
	allowLowConfidence := flag.Bool("allow-low-confidence", false, "accept the first provider result and reviewed manual overrides when strict matching fails")
	limit := flag.Int("limit", 100, "maximum directory locations to resolve")
	pause := flag.Duration("pause", 800*time.Millisecond, "pause between geocoder calls")
	flag.Parse()

	if *limit <= 0 || *limit > 5000 {
		log.Fatal("--limit must be between 1 and 5000")
	}
	cfg, err := config.Load(".")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("读取数据库连接失败: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	candidates, err := listCandidates(ctx, db, *limit)
	if err != nil {
		log.Fatalf("读取待补坐标地点失败（请先运行 --only-campus-map-locations 迁移）: %v", err)
	}
	geocoder := utilityservice.NewLocationService(cfg)
	resolved, skipped := 0, 0
	for index, candidate := range candidates {
		selected, selectedQuery, fallback, err := resolveCandidate(ctx, geocoder, candidate, *pause, *allowLowConfidence)
		coordinateSource := coordinateSourceTianditu
		needsCoordinateConversion := true
		if *allowLowConfidence && (fallback || err != nil || selectedQuery == "") {
			if override, ok := lowConfidenceLocationOverride(candidate); ok {
				selected = override
				selectedQuery = "reviewed manual override"
				fallback = false
				err = nil
				coordinateSource = coordinateSourceOverride
				needsCoordinateConversion = false
			}
		}
		if fallback {
			log.Printf("拒绝写入开发环境兜底坐标: kind=%s id=%s name=%s", candidate.Kind, candidate.ID, displayName(candidate))
			skipped++
			continue
		}
		if err != nil {
			log.Printf("地理编码失败: kind=%s id=%s name=%s error=%v", candidate.Kind, candidate.ID, displayName(candidate), err)
			skipped++
			continue
		}
		if selectedQuery == "" {
			log.Printf("未找到可信地点: kind=%s id=%s name=%s queries=%s", candidate.Kind, candidate.ID, displayName(candidate), strings.Join(searchQueries(candidate), " | "))
			skipped++
			continue
		}
		longitude, latitude := selected.Longitude, selected.Latitude
		if needsCoordinateConversion {
			longitude, latitude = cgcs2000ToGCJ02(longitude, latitude)
		}
		log.Printf("地点坐标已解析: kind=%s name=%s query=%s poi=%s address=%s longitude=%.6f latitude=%.6f apply=%t",
			candidate.Kind, displayName(candidate), selectedQuery, selected.Name, selected.Address, longitude, latitude, *apply)
		if *apply {
			if err := updateCoordinates(ctx, db, candidate, longitude, latitude, coordinateSource); err != nil {
				log.Fatalf("写入地点坐标失败: kind=%s id=%s error=%v", candidate.Kind, candidate.ID, err)
			}
		}
		resolved++
		if index < len(candidates)-1 && *pause > 0 {
			time.Sleep(*pause)
		}
	}
	fmt.Printf("mode=%s candidates=%d resolved=%d skipped=%d\n", map[bool]string{true: "apply", false: "dry-run"}[*apply], len(candidates), resolved, skipped)
}

func listCandidates(ctx context.Context, db *gorm.DB, limit int) ([]locationCandidate, error) {
	var candidates []locationCandidate
	err := db.WithContext(ctx).Raw(`
		WITH published_school_ids AS (
			SELECT DISTINCT COALESCE(p.school_id, s.id) AS school_id
			FROM public_food_library p
			LEFT JOIN schools s ON s.name = p.school_name AND s.status = 'active'
			WHERE p.status = 'published'
			  AND (p.type = 'campus' OR p.is_campus_food = true)
			  AND COALESCE(p.school_id, s.id) IS NOT NULL
		), linked_campus_ids AS (
			SELECT DISTINCT COALESCE(c.campus_id, p.campus_id) AS campus_id
			FROM public_food_library p
			LEFT JOIN school_canteens c ON c.id = p.canteen_id AND c.status = 'active'
			WHERE p.status = 'published'
			  AND (p.type = 'campus' OR p.is_campus_food = true)
			  AND COALESCE(c.campus_id, p.campus_id) IS NOT NULL
		), linked_canteen_ids AS (
			SELECT DISTINCT p.canteen_id AS canteen_id
			FROM public_food_library p
			WHERE p.status = 'published'
			  AND (p.type = 'campus' OR p.is_campus_food = true)
			  AND p.canteen_id IS NOT NULL
		)
		SELECT * FROM (
			SELECT 'canteen' AS kind, c.id::text, c.school_id::text,
			       s.name AS school_name, COALESCE(sc.name, '') AS campus_name,
			       c.name AS canteen_name, COALESCE(sc.address, '') AS address,
			       COALESCE(c.location_text, '') AS location_text,
			       COALESCE(s.province, '') AS province, COALESCE(s.city, '') AS city
			FROM school_canteens c
			JOIN schools s ON s.id = c.school_id AND s.status = 'active' AND s.location_type = 'university'
			LEFT JOIN school_campuses sc ON sc.id = c.campus_id AND sc.status = 'active'
			JOIN linked_canteen_ids linked ON linked.canteen_id = c.id
			WHERE c.status = 'active'
			  AND (c.latitude IS NULL OR c.longitude IS NULL)
			UNION ALL
			SELECT 'campus' AS kind, sc.id::text, sc.school_id::text,
			       s.name AS school_name, sc.name AS campus_name, '' AS canteen_name,
			       sc.address, '' AS location_text,
			       COALESCE(s.province, '') AS province, COALESCE(s.city, '') AS city
			FROM school_campuses sc
			JOIN schools s ON s.id = sc.school_id AND s.status = 'active' AND s.location_type = 'university'
			JOIN linked_campus_ids linked ON linked.campus_id = sc.id
			WHERE sc.status = 'active'
			  AND NULLIF(BTRIM(sc.address), '') IS NOT NULL
			  AND (sc.latitude IS NULL OR sc.longitude IS NULL)
			UNION ALL
			SELECT 'school' AS kind, s.id::text, s.id::text,
			       s.name AS school_name, '' AS campus_name, '' AS canteen_name,
			       '' AS address, '' AS location_text,
			       COALESCE(s.province, '') AS province, COALESCE(s.city, '') AS city
			FROM schools s
			JOIN published_school_ids published ON published.school_id = s.id
			WHERE s.status = 'active' AND s.location_type = 'university'
			  AND (s.latitude IS NULL OR s.longitude IS NULL)
		) candidates
		ORDER BY CASE kind WHEN 'canteen' THEN 0 WHEN 'campus' THEN 1 ELSE 2 END,
		         school_name, campus_name, canteen_name
		LIMIT ?
	`, limit).Scan(&candidates).Error
	return candidates, err
}

func searchQuery(candidate locationCandidate) string {
	parts := []string{candidate.Province, candidate.City, candidate.SchoolName}
	if candidate.Kind == "campus" {
		parts = append(parts, candidate.CampusName, candidate.Address)
	} else if candidate.Kind == "canteen" {
		parts = append(parts, candidate.CampusName, candidate.CanteenName, candidate.LocationText, candidate.Address)
	}
	return joinUnique(parts...)
}

func searchQueries(candidate locationCandidate) []string {
	if candidate.Kind != "canteen" {
		return []string{searchQuery(candidate)}
	}
	coreName := canteenCoreName(candidate.CanteenName)
	return uniqueTexts(
		joinUnique(candidate.SchoolName, candidate.CanteenName),
		joinUnique(candidate.SchoolName, coreName),
		candidate.CanteenName,
		coreName,
	)
}

func resolveCandidate(
	ctx context.Context,
	geocoder *utilityservice.LocationService,
	candidate locationCandidate,
	pause time.Duration,
	allowLowConfidence bool,
) (poi, string, bool, error) {
	queries := searchQueries(candidate)
	var lastErr error
	for queryIndex, query := range queries {
		var result map[string]any
		for attempt := 0; attempt < 2; attempt++ {
			result, lastErr = geocoder.SearchAddress(ctx, query, 20, nil, nil, nil)
			if lastErr == nil || !strings.Contains(lastErr.Error(), "http_status=429") || attempt == 1 {
				break
			}
			if err := waitForGeocoder(ctx, 2*time.Second); err != nil {
				return poi{}, "", false, err
			}
		}
		if lastErr != nil {
			continue
		}
		if isFallbackResult(result) {
			return poi{}, "", true, nil
		}
		pois := parsePOIs(result)
		if selected, ok := choosePOI(candidate, pois); ok {
			return selected, query, false, nil
		}
		if allowLowConfidence && len(pois) > 0 {
			return pois[0], query, false, nil
		}
		if queryIndex < len(queries)-1 && pause > 0 {
			if err := waitForGeocoder(ctx, pause); err != nil {
				return poi{}, "", false, err
			}
		}
	}
	if lastErr != nil {
		return poi{}, "", false, lastErr
	}
	return poi{}, "", false, nil
}

// lowConfidenceLocationOverride is intentionally small and auditable. It is
// used only with --allow-low-confidence when the configured provider is
// unavailable. Coordinates are already GCJ-02 for direct WeChat map use.
func lowConfidenceLocationOverride(candidate locationCandidate) (poi, bool) {
	key := strings.Join([]string{
		normalizePlaceText(candidate.Kind),
		normalizePlaceText(candidate.SchoolName),
		normalizePlaceText(candidate.CampusName),
		normalizePlaceText(candidate.CanteenName),
	}, "|")
	overrides := map[string]poi{
		"canteen|清华大学||桃李园简约餐厅": {
			Name: "清华大学桃李园餐厅", Address: "北京市海淀区成府路45-1号清华园内",
			Longitude: 116.326059, Latitude: 40.010939,
		},
		"canteen|清华大学|清华园校区|桃李园": {
			Name: "清华大学桃李园餐厅", Address: "北京市海淀区成府路45-1号清华园内",
			Longitude: 116.326059, Latitude: 40.010939,
		},
		"campus|北京大学|燕园校区|": {
			Name: "北京大学燕园校区", Address: "北京市海淀区颐和园路5号",
			Longitude: 116.315282, Latitude: 39.993070,
		},
		"school|吉林工商学院||": {
			Name: "吉林工商学院", Address: "吉林省长春市九台区",
			Longitude: 125.548272, Latitude: 43.990346,
		},
	}
	selected, ok := overrides[key]
	return selected, ok
}

func waitForGeocoder(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func displayName(candidate locationCandidate) string {
	return joinUnique(candidate.SchoolName, candidate.CampusName, candidate.CanteenName)
}

func joinUnique(parts ...string) string {
	seen := make(map[string]struct{}, len(parts))
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		result = append(result, part)
	}
	return strings.Join(result, " ")
}

func isFallbackResult(result map[string]any) bool {
	fallback, _ := result["fallback"].(bool)
	return fallback
}

func parsePOIs(result map[string]any) []poi {
	raw, ok := result["pois"].([]any)
	if !ok {
		if typed, typedOK := result["pois"].([]map[string]any); typedOK {
			raw = make([]any, len(typed))
			for index := range typed {
				raw[index] = typed[index]
			}
		}
	}
	pois := make([]poi, 0, len(raw))
	for _, value := range raw {
		row, ok := value.(map[string]any)
		if !ok {
			continue
		}
		longitude, latitude, ok := parseLonLat(strings.TrimSpace(fmt.Sprint(row["lonlat"])))
		if !ok {
			longitude, latitude, ok = number(row["longitude"]), number(row["latitude"]), true
			if !validCoordinate(longitude, latitude) {
				ok = false
			}
		}
		if !ok {
			continue
		}
		pois = append(pois, poi{Name: strings.TrimSpace(fmt.Sprint(row["name"])), Address: strings.TrimSpace(fmt.Sprint(row["address"])), Longitude: longitude, Latitude: latitude})
	}
	return pois
}

func parseLonLat(value string) (float64, float64, bool) {
	parts := strings.Split(value, ",")
	if len(parts) < 2 {
		return 0, 0, false
	}
	longitude, longitudeErr := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	latitude, latitudeErr := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	return longitude, latitude, longitudeErr == nil && latitudeErr == nil && validCoordinate(longitude, latitude)
}

func number(value any) float64 {
	number, _ := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	return number
}

func validCoordinate(longitude, latitude float64) bool {
	return !math.IsNaN(longitude) && !math.IsNaN(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90 && !(longitude == 0 && latitude == 0)
}

func choosePOI(candidate locationCandidate, pois []poi) (poi, bool) {
	for index := range pois {
		poiName := normalizePlaceText(pois[index].Name)
		text := normalizePlaceText(pois[index].Name + " " + pois[index].Address)
		school := normalizePlaceText(candidate.SchoolName)
		campus := normalizePlaceText(candidate.CampusName)
		canteen := normalizePlaceText(candidate.CanteenName)
		address := normalizePlaceText(candidate.Address)
		locationText := normalizePlaceText(candidate.LocationText)
		if schoolNameMatches(text, school, candidate.Kind == "canteen") {
			pois[index].Score += 100
		}
		if campus != "" && strings.Contains(text, campus) {
			pois[index].Score += 80
		}
		if canteen != "" && placeNameMatches(text, canteen) {
			pois[index].Score += 100
			if strings.Contains(poiName, "食堂") || strings.Contains(poiName, "餐厅") || strings.Contains(poiName, "快餐") {
				pois[index].Score += 20
			}
		}
		if address != "" && strings.Contains(text, address) {
			pois[index].Score += 60
		}
		if locationText != "" && strings.Contains(text, locationText) {
			pois[index].Score += 40
		}
		if city := normalizePlaceText(candidate.City); city != "" && strings.Contains(text, city) {
			pois[index].Score += 10
		}
	}
	sort.SliceStable(pois, func(left, right int) bool { return pois[left].Score > pois[right].Score })
	if len(pois) == 0 || pois[0].Score < 100 {
		return poi{}, false
	}
	// Canteen coordinates must match both the university and the canteen name.
	// Campus/address hints only rank otherwise valid canteen results; they never
	// turn a similarly named restaurant outside the university into a match.
	if candidate.Kind == "canteen" && pois[0].Score < 200 {
		return poi{}, false
	}
	// A campus result is trusted when the school plus either the campus name or
	// its full reviewed address matches. Some directory rows call the main
	// campus "校本部", while map providers only return the university name.
	if candidate.Kind == "campus" && normalizePlaceText(candidate.CampusName) != "" && pois[0].Score < 160 {
		return poi{}, false
	}
	return pois[0], true
}

func normalizePlaceText(value string) string {
	replacer := strings.NewReplacer(" ", "", "\t", "", "\r", "", "\n", "", "（", "(", "）", ")")
	return strings.ToLower(replacer.Replace(strings.TrimSpace(value)))
}

func placeNameMatches(text, name string) bool {
	if name == "" {
		return false
	}
	if strings.Contains(text, name) {
		return true
	}
	core := canteenCoreName(name)
	return len([]rune(core)) >= 2 && strings.Contains(text, core)
}

func canteenCoreName(name string) string {
	core := strings.TrimSpace(name)
	for _, suffix := range []string{"简约餐厅", "学生餐厅", "餐厅", "食堂", "快餐"} {
		core = strings.TrimSuffix(core, suffix)
	}
	return core
}

func schoolNameMatches(text, school string, allowReviewedAlias bool) bool {
	if school == "" {
		return false
	}
	if strings.Contains(text, school) {
		return true
	}
	if !allowReviewedAlias {
		return false
	}
	aliases := map[string][]string{
		"北京大学":     {"北大"},
		"清华大学":     {"清华"},
		"中国农业大学":   {"中国农大", "农大"},
		"中国科学技术大学": {"中科大"},
		"上海交通大学":   {"上海交大"},
	}
	for _, alias := range aliases[school] {
		if strings.Contains(text, normalizePlaceText(alias)) {
			return true
		}
	}
	return false
}

func uniqueTexts(values ...string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func updateCoordinates(ctx context.Context, db *gorm.DB, candidate locationCandidate, longitude, latitude float64, coordinateSource string) error {
	var table string
	switch candidate.Kind {
	case "school":
		table = "schools"
	case "campus":
		table = "school_campuses"
	case "canteen":
		table = "school_canteens"
	default:
		return fmt.Errorf("unknown location kind %q", candidate.Kind)
	}
	return db.WithContext(ctx).Table(table).Where("id = ?", candidate.ID).Updates(map[string]any{
		"longitude":             longitude,
		"latitude":              latitude,
		"coordinate_source":     coordinateSource,
		"coordinate_updated_at": time.Now(),
	}).Error
}

func cgcs2000ToGCJ02(longitude, latitude float64) (float64, float64) {
	if outsideChina(longitude, latitude) {
		return longitude, latitude
	}
	dLatitude := transformLatitude(longitude-105, latitude-35)
	dLongitude := transformLongitude(longitude-105, latitude-35)
	radLatitude := latitude / 180 * math.Pi
	magic := math.Sin(radLatitude)
	magic = 1 - 0.00669342162296594323*magic*magic
	sqrtMagic := math.Sqrt(magic)
	dLatitude = (dLatitude * 180) / ((6335552.717000426 / (magic * sqrtMagic)) * math.Pi)
	dLongitude = (dLongitude * 180) / ((6378245.0 / sqrtMagic) * math.Cos(radLatitude) * math.Pi)
	return longitude + dLongitude, latitude + dLatitude
}

func outsideChina(longitude, latitude float64) bool {
	return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271
}

func transformLatitude(x, y float64) float64 {
	result := -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*math.Sqrt(math.Abs(x))
	result += (20*math.Sin(6*x*math.Pi) + 20*math.Sin(2*x*math.Pi)) * 2 / 3
	result += (20*math.Sin(y*math.Pi) + 40*math.Sin(y/3*math.Pi)) * 2 / 3
	result += (160*math.Sin(y/12*math.Pi) + 320*math.Sin(y*math.Pi/30)) * 2 / 3
	return result
}

func transformLongitude(x, y float64) float64 {
	result := 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*math.Sqrt(math.Abs(x))
	result += (20*math.Sin(6*x*math.Pi) + 20*math.Sin(2*x*math.Pi)) * 2 / 3
	result += (20*math.Sin(x*math.Pi) + 40*math.Sin(x/3*math.Pi)) * 2 / 3
	result += (150*math.Sin(x/12*math.Pi) + 300*math.Sin(x/30*math.Pi)) * 2 / 3
	return result
}
