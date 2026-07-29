package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const crawlerUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 FoodLinkCampusDirectoryResearch/1.0"

type auditFile struct {
	Schools []auditSchool `json:"schools"`
}

type auditSchool struct {
	SchoolID                  string         `json:"school_id"`
	OfficialCode              string         `json:"official_code"`
	Name                      string         `json:"name"`
	Province                  string         `json:"province"`
	AuditStatus               string         `json:"audit_status"`
	ActiveSiteCount           int            `json:"active_site_count"`
	ActiveCanteenCount        int            `json:"active_canteen_count"`
	CanteensWithFloorMetadata int            `json:"canteens_with_floor_metadata"`
	ActiveWindowCount         int            `json:"active_window_count"`
	Canteens                  []auditCanteen `json:"canteens,omitempty"`
}

type auditCanteen struct {
	SourceURL string `json:"source_url,omitempty"`
}

type seedFile struct {
	Schools []seedSchool `json:"schools"`
}

type seedSchool struct {
	SchoolID string            `json:"school_id"`
	Name     string            `json:"name,omitempty"`
	Sources  []searchCandidate `json:"sources"`
}

type crawlFile struct {
	GeneratedAt time.Time     `json:"generated_at"`
	Scope       string        `json:"scope"`
	Schools     []crawlSchool `json:"schools"`
}

type crawlSchool struct {
	SchoolID           string           `json:"school_id"`
	OfficialCode       string           `json:"official_code,omitempty"`
	Name               string           `json:"name"`
	Province           string           `json:"province,omitempty"`
	AuditStatus        string           `json:"audit_status,omitempty"`
	Coverage           coverageSnapshot `json:"coverage"`
	Status             string           `json:"status"`
	SearchQuery        string           `json:"search_query"`
	SearchQueries      []queryTask      `json:"search_queries,omitempty"`
	XiaohongshuQueries []queryTask      `json:"xiaohongshu_queries,omitempty"`
	CheckedAt          time.Time        `json:"checked_at"`
	Sources            []crawlSource    `json:"sources"`
	Note               string           `json:"note,omitempty"`
}

type coverageSnapshot struct {
	ActiveSites        int `json:"active_sites"`
	ActiveCanteens     int `json:"active_canteens"`
	CanteensWithFloors int `json:"canteens_with_floors"`
	ActiveNamedWindows int `json:"active_named_windows"`
}

type queryTask struct {
	QueryID string `json:"query_id"`
	Channel string `json:"channel"`
	Purpose string `json:"purpose"`
	Query   string `json:"query"`
	Status  string `json:"status,omitempty"`
}

type crawlSource struct {
	URL               string            `json:"url"`
	Title             string            `json:"title,omitempty"`
	Host              string            `json:"host"`
	Channel           string            `json:"channel,omitempty"`
	QueryID           string            `json:"query_id,omitempty"`
	SearchQuery       string            `json:"search_query,omitempty"`
	ContentType       string            `json:"content_type,omitempty"`
	Status            string            `json:"status"`
	CanteenCandidates []string          `json:"canteen_candidates,omitempty"`
	FloorMentions     []string          `json:"floor_mentions,omitempty"`
	WindowCandidates  []string          `json:"window_candidates,omitempty"`
	EvidenceExcerpt   string            `json:"evidence_excerpt,omitempty"`
	Error             string            `json:"error,omitempty"`
	DiscoveredLinks   []searchCandidate `json:"-"`
}

type searchCandidate struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Snippet     string `json:"snippet,omitempty"`
	Channel     string `json:"channel,omitempty"`
	QueryID     string `json:"query_id,omitempty"`
	SearchQuery string `json:"search_query,omitempty"`
	Status      string `json:"status,omitempty"`
}

type socialEvidenceFile struct {
	Schools []socialEvidenceSchool `json:"schools"`
}

type socialEvidenceSchool struct {
	SchoolID string        `json:"school_id"`
	Sources  []crawlSource `json:"sources"`
}

type xiaohongshuQueueFile struct {
	GeneratedAt time.Time                `json:"generated_at"`
	Scope       string                   `json:"scope"`
	Schools     []xiaohongshuQueueSchool `json:"schools"`
}

type xiaohongshuQueueSchool struct {
	SchoolID     string      `json:"school_id"`
	OfficialCode string      `json:"official_code,omitempty"`
	Name         string      `json:"name"`
	Province     string      `json:"province,omitempty"`
	AuditStatus  string      `json:"audit_status"`
	Queries      []queryTask `json:"queries"`
}

type researchQueueFile struct {
	GeneratedAt time.Time             `json:"generated_at"`
	Scope       string                `json:"scope"`
	Schools     []researchQueueSchool `json:"schools"`
}

type researchQueueSchool struct {
	SchoolID           string           `json:"school_id"`
	OfficialCode       string           `json:"official_code,omitempty"`
	Name               string           `json:"name"`
	Province           string           `json:"province,omitempty"`
	AuditStatus        string           `json:"audit_status"`
	Coverage           coverageSnapshot `json:"coverage"`
	OfficialQueries    []queryTask      `json:"official_queries"`
	XiaohongshuQueries []queryTask      `json:"xiaohongshu_queries"`
}

type rateLimitedClient struct {
	client      *http.Client
	delay       time.Duration
	lastRequest time.Time
	mu          sync.Mutex
}

var (
	canteenPattern      = regexp.MustCompile(`[\p{Han}A-Za-z0-9·（）()]{1,18}(?:学生食堂|教工食堂|清真食堂|食堂|餐厅|美食城|美食广场|饭堂)`)
	floorMentionPattern = regexp.MustCompile(`(?:负?[一二三四五六七八九十两0-9]+(?:楼|层)|地下[一二三四五六七八九十两0-9]+层|B[0-9]+|[一二三四五六七八九十两0-9]+[至到~-][一二三四五六七八九十两0-9]+(?:楼|层))`)
	windowPattern       = regexp.MustCompile(`[\p{Han}A-Za-z0-9·（）()]{1,18}(?:窗口|档口)`)
	graduateAffiliation = regexp.MustCompile(`研究生会|研究生院|研究生处|研究生公众号|研究生招生|研究生新生|校研会`)
	spacePattern        = regexp.MustCompile(`\s+`)
	relevantLinkText    = regexp.MustCompile(`迎新|新生|食堂|餐厅|餐饮|饮食指南|后勤|生活指南|服务指南|校园生活|吃在`)
	relevantLinkPath    = regexp.MustCompile(`(?i)(?:yingxin|welcome|hello|freshman|fresh|/yx(?:/|$)|/hq(?:/|$)|houqin|canyin|shfw|fwzn|xszn|guide|\.pdf$)`)
)

func main() {
	inputPath := flag.String("input", "../docs/campus-directory-proofreading/nationwide-school-dining-audit.json", "per-school audit JSON")
	outputPath := flag.String("output", "../docs/campus-directory-proofreading/nationwide-official-source-crawl.json", "resumable crawl output JSON")
	seedPath := flag.String("seed-input", "../docs/campus-directory-proofreading/nationwide-official-source-seeds.json", "optional manually discovered official source seeds")
	socialInputPath := flag.String("xiaohongshu-input", "../docs/campus-directory-proofreading/nationwide-xiaohongshu-evidence.json", "optional Xiaohongshu evidence captured through the logged-in MCP browser")
	researchQueuePath := flag.String("research-queue-output", "../docs/campus-directory-proofreading/nationwide-campus-dining-research-queue.json", "unified web and Xiaohongshu research queue")
	xiaohongshuQueuePath := flag.String("xiaohongshu-queue-output", "../docs/campus-directory-proofreading/nationwide-xiaohongshu-query-queue.json", "generated resumable Xiaohongshu MCP query queue")
	province := flag.String("province", "", "optional exact province/city filter")
	excludeProvinces := flag.String("exclude-provinces", "", "optional comma-separated provinces/cities to exclude")
	schoolCodes := flag.String("school-codes", "", "optional comma-separated official school codes")
	auditStatuses := flag.String("audit-statuses", "not_started,pending_source_review,source_backed_missing_floors,source_backed_partial,source_found_no_published_canteen", "comma-separated audit statuses to include; empty means all")
	limit := flag.Int("limit", 20, "maximum new schools to process; 0 means all")
	maxPages := flag.Int("max-pages", 3, "maximum official result pages fetched per school")
	requestDelay := flag.Duration("request-delay", 1200*time.Millisecond, "minimum delay between network requests")
	requestTimeout := flag.Duration("request-timeout", 20*time.Second, "per-request timeout")
	schoolTimeout := flag.Duration("school-timeout", 90*time.Second, "overall timeout for one school")
	retryFailures := flag.Bool("retry-failures", true, "retry transient search failures already present in the crawl state")
	forceRefresh := flag.Bool("force-refresh", false, "reprocess matching schools even when a non-retryable crawl result exists")
	queueOnly := flag.Bool("queue-only", false, "only generate the Xiaohongshu query queue without making web requests")
	concurrency := flag.Int("concurrency", 2, "maximum schools crawled concurrently; capped at 8")
	sourceProfile := flag.String("source-profile", "standard", "official discovery profile: standard or orientation-first")
	flag.Parse()
	*sourceProfile = strings.TrimSpace(strings.ToLower(*sourceProfile))
	if *sourceProfile != "standard" && *sourceProfile != "orientation-first" {
		log.Fatalf("unsupported source profile %q; expected standard or orientation-first", *sourceProfile)
	}

	audit, err := loadAudit(*inputPath)
	if err != nil {
		log.Fatalf("读取逐校审计清单失败: %v", err)
	}
	state, err := loadCrawlState(*outputPath)
	if err != nil {
		log.Fatalf("读取断点状态失败: %v", err)
	}
	seeds, err := loadSeeds(*seedPath)
	if err != nil {
		log.Fatalf("读取人工发现来源失败: %v", err)
	}
	socialEvidence, err := loadSocialEvidence(*socialInputPath)
	if err != nil {
		log.Fatalf("读取小红书证据回填失败: %v", err)
	}
	statusFilter := parseCSVSet(*auditStatuses)
	schoolCodeFilter := parseCSVSet(*schoolCodes)
	excludedProvinceFilter := parseCSVSet(*excludeProvinces)
	selectedSchools := selectAuditSchools(audit.Schools, strings.TrimSpace(*province), statusFilter, schoolCodeFilter, excludedProvinceFilter)
	if err := saveResearchQueue(*researchQueuePath, selectedSchools, socialEvidence); err != nil {
		log.Fatalf("保存统一研究队列失败: %v", err)
	}
	if err := saveXiaohongshuQueue(*xiaohongshuQueuePath, selectedSchools, socialEvidence); err != nil {
		log.Fatalf("保存小红书查询队列失败: %v", err)
	}
	if *queueOnly {
		log.Printf("查询队列已生成: schools=%d research_output=%s xiaohongshu_output=%s", len(selectedSchools), *researchQueuePath, *xiaohongshuQueuePath)
		return
	}
	processed := make(map[string]struct{}, len(state.Schools))
	for _, school := range state.Schools {
		if *forceRefresh {
			continue
		}
		if *retryFailures && isRetryableStatus(school.Status) {
			continue
		}
		processed[school.SchoolID] = struct{}{}
	}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: min(*requestTimeout, 15*time.Second),
		IdleConnTimeout:       30 * time.Second,
	}
	crawler := &rateLimitedClient{
		client: &http.Client{
			Timeout:   *requestTimeout,
			Transport: transport,
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= 6 {
					return errors.New("重定向次数超过 6 次")
				}
				return nil
			},
		},
		delay: *requestDelay,
	}

	pendingSchools := make([]auditSchool, 0, len(selectedSchools))
	for _, school := range selectedSchools {
		if _, exists := processed[school.SchoolID]; exists {
			continue
		}
		if *limit > 0 && len(pendingSchools) >= *limit {
			break
		}
		pendingSchools = append(pendingSchools, school)
	}
	workerCount := min(max(1, *concurrency), 8, max(1, len(pendingSchools)))
	jobs := make(chan auditSchool)
	results := make(chan crawlSchool)
	var workers sync.WaitGroup
	for workerID := 1; workerID <= workerCount; workerID++ {
		workers.Add(1)
		go func(id int) {
			defer workers.Done()
			for school := range jobs {
				log.Printf("开始采集学校: worker=%d school=%s province=%s", id, school.Name, school.Province)
				schoolContext, cancel := context.WithTimeout(context.Background(), *schoolTimeout)
				result := crawlOneSchool(schoolContext, crawler, school, seeds[school.SchoolID], socialEvidence[school.SchoolID], max(1, *maxPages), *sourceProfile)
				cancel()
				log.Printf("学校采集完成: worker=%d school=%s status=%s sources=%d", id, school.Name, result.Status, len(result.Sources))
				results <- result
			}
		}(workerID)
	}
	go func() {
		for _, school := range pendingSchools {
			jobs <- school
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()
	completed := 0
	for result := range results {
		upsertCrawlSchool(state, result)
		state.GeneratedAt = time.Now()
		if err := saveCrawlState(*outputPath, state); err != nil {
			log.Fatalf("保存断点状态失败: %v", err)
		}
		completed++
	}
	log.Printf("本批采集结束: new_schools=%d selected_schools=%d workers=%d total_schools=%d output=%s xiaohongshu_queue=%s", completed, len(selectedSchools), workerCount, len(state.Schools), *outputPath, *xiaohongshuQueuePath)
}

func isRetryableStatus(status string) bool {
	switch status {
	case "search_failed", "school_timeout", "no_official_source_found", "discovery_no_candidates":
		return true
	default:
		return false
	}
}

func upsertCrawlSchool(state *crawlFile, result crawlSchool) {
	for index := range state.Schools {
		if state.Schools[index].SchoolID == result.SchoolID {
			state.Schools[index] = result
			return
		}
	}
	state.Schools = append(state.Schools, result)
}

func parseCSVSet(raw string) map[string]struct{} {
	result := map[string]struct{}{}
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			result[item] = struct{}{}
		}
	}
	return result
}

func selectAuditSchools(schools []auditSchool, province string, statuses map[string]struct{}, schoolCodes map[string]struct{}, excludedProvinces map[string]struct{}) []auditSchool {
	result := make([]auditSchool, 0, len(schools))
	for _, school := range schools {
		if province != "" && school.Province != province {
			continue
		}
		if _, excluded := excludedProvinces[school.Province]; excluded {
			continue
		}
		if len(statuses) > 0 {
			if _, ok := statuses[school.AuditStatus]; !ok {
				continue
			}
		}
		if len(schoolCodes) > 0 {
			if _, ok := schoolCodes[school.OfficialCode]; !ok {
				continue
			}
		}
		result = append(result, school)
	}
	return result
}

func buildOfficialSearchQueries(schoolName string) []queryTask {
	return []queryTask{
		{QueryID: "official-overview", Channel: "official_web", Purpose: "校区与食堂总览", Query: fmt.Sprintf(`"%s" 食堂 餐厅 后勤 迎新`, schoolName)},
		{QueryID: "official-floors", Channel: "official_web", Purpose: "食堂楼层映射", Query: fmt.Sprintf(`"%s" 食堂 楼层 校区`, schoolName)},
		{QueryID: "official-windows", Channel: "official_web", Purpose: "稳定命名窗口与档口", Query: fmt.Sprintf(`"%s" 食堂 窗口 档口`, schoolName)},
		{QueryID: "official-wechat", Channel: "official_web", Purpose: "官方公众号与迎新指南", Query: fmt.Sprintf(`site:mp.weixin.qq.com "%s" 食堂`, schoolName)},
	}
}

func buildOrientationFirstSearchQueries(schoolName string) []queryTask {
	return []queryTask{
		{
			QueryID: "official-orientation",
			Channel: "official_web",
			Purpose: "迎新网、新生指南与校园生活餐饮信息",
			Query:   fmt.Sprintf(`"%s" 迎新 新生指南 食堂 餐厅`, schoolName),
		},
		{
			QueryID: "official-logistics",
			Channel: "official_web",
			Purpose: "后勤与餐饮服务页面",
			Query:   fmt.Sprintf(`"%s" 后勤 餐饮 食堂 餐厅`, schoolName),
		},
		{
			QueryID: "official-graduate-wechat",
			Channel: "official_web",
			Purpose: "研究生会与研究生院官方公众号餐饮补采",
			Query:   fmt.Sprintf(`"%s" 研究生会 公众号 食堂 餐厅 迎新`, schoolName),
		},
	}
}

func buildOfficialSearchQueriesForProfile(schoolName, profile string) []queryTask {
	if profile == "orientation-first" {
		return buildOrientationFirstSearchQueries(schoolName)
	}
	return buildOfficialSearchQueries(schoolName)
}

func buildGapSearchQueries(schoolName string, sources []crawlSource) []queryTask {
	canteens := map[string]struct{}{}
	floors := map[string]struct{}{}
	windows := map[string]struct{}{}
	for _, source := range sources {
		for _, value := range source.CanteenCandidates {
			canteens[value] = struct{}{}
		}
		for _, value := range source.FloorMentions {
			floors[value] = struct{}{}
		}
		for _, value := range source.WindowCandidates {
			windows[value] = struct{}{}
		}
	}

	result := []queryTask{}
	if len(canteens) == 0 {
		result = append(result,
			queryTask{
				QueryID: "official-overview",
				Channel: "official_web",
				Purpose: "校区与食堂总览补采",
				Query:   fmt.Sprintf(`"%s" 食堂 餐厅 校区`, schoolName),
			},
			queryTask{
				QueryID: "official-wechat",
				Channel: "official_web",
				Purpose: "官方公众号与迎新指南补采",
				Query:   fmt.Sprintf(`site:mp.weixin.qq.com "%s" 食堂 迎新`, schoolName),
			},
		)
		return result
	}
	needsFloorMapping := len(floors) < len(canteens)
	needsWindowMapping := len(windows) < len(canteens)
	if needsFloorMapping {
		result = append(result, queryTask{
			QueryID: "official-floors",
			Channel: "official_web",
			Purpose: "食堂楼层映射补采",
			Query:   fmt.Sprintf(`"%s" 食堂 楼层 校区`, schoolName),
		})
	}
	if needsWindowMapping {
		result = append(result, queryTask{
			QueryID: "official-windows",
			Channel: "official_web",
			Purpose: "稳定命名窗口与档口补采",
			Query:   fmt.Sprintf(`"%s" 食堂 窗口 档口`, schoolName),
		})
	}
	return result
}

func buildXiaohongshuQueries(schoolName string) []queryTask {
	return []queryTask{
		{QueryID: "xiaohongshu-overview", Channel: "xiaohongshu", Purpose: "食堂总览与校区线索", Query: schoolName + " 食堂", Status: "pending_mcp_capture"},
		{QueryID: "xiaohongshu-floors", Channel: "xiaohongshu", Purpose: "食堂楼层线索", Query: schoolName + " 食堂 楼层", Status: "pending_mcp_capture"},
		{QueryID: "xiaohongshu-windows", Channel: "xiaohongshu", Purpose: "稳定命名窗口线索", Query: schoolName + " 食堂 窗口", Status: "pending_mcp_capture"},
	}
}

func coverageFromAudit(school auditSchool) coverageSnapshot {
	return coverageSnapshot{
		ActiveSites:        school.ActiveSiteCount,
		ActiveCanteens:     school.ActiveCanteenCount,
		CanteensWithFloors: school.CanteensWithFloorMetadata,
		ActiveNamedWindows: school.ActiveWindowCount,
	}
}

func setQueryStatus(queries []queryTask, queryID, status string) {
	for index := range queries {
		if queries[index].QueryID == queryID {
			queries[index].Status = status
		}
	}
}

func auditSourceCandidates(school auditSchool) []searchCandidate {
	result := []searchCandidate{}
	for _, canteen := range school.Canteens {
		candidate := searchCandidate{
			URL:     strings.TrimSpace(canteen.SourceURL),
			Channel: "audit_existing_source",
		}
		if !isOfficialCandidate(candidate.URL) {
			continue
		}
		result = appendUniqueCandidates(result, candidate)
	}
	return result
}

func crawlOneSchool(ctx context.Context, crawler *rateLimitedClient, school auditSchool, seeded []searchCandidate, social []crawlSource, maxPages int, sourceProfile string) crawlSchool {
	officialQueries := buildOfficialSearchQueriesForProfile(school.Name, sourceProfile)
	xiaohongshuQueries := buildXiaohongshuQueries(school.Name)
	for index := range xiaohongshuQueries {
		xiaohongshuQueries[index].QueryID = school.SchoolID + ":" + xiaohongshuQueries[index].QueryID
	}
	result := crawlSchool{
		SchoolID: school.SchoolID, OfficialCode: school.OfficialCode, Name: school.Name,
		Province: school.Province, AuditStatus: school.AuditStatus, Coverage: coverageFromAudit(school),
		SearchQuery: officialQueries[0].Query, SearchQueries: officialQueries, XiaohongshuQueries: xiaohongshuQueries,
		CheckedAt: time.Now(), Sources: []crawlSource{},
	}
	candidates := make([]searchCandidate, 0, len(seeded)+16)
	for _, candidate := range seeded {
		if candidate.Channel == "" {
			candidate.Channel = "official_seed"
		}
		candidates = appendUniqueCandidates(candidates, candidate)
	}
	candidates = appendUniqueCandidates(candidates, auditSourceCandidates(school)...)
	searchErrors := []string{}
	officialHosts := collectOfficialHosts(candidates)
	if len(officialHosts) == 0 {
		homeCandidates, homeErr := searchRelevantCandidates(ctx, crawler, school.Name+" 官网", school.Name, "")
		if homeErr != nil {
			searchErrors = append(searchErrors, school.Name+" 官网: "+homeErr.Error())
		} else {
			officialHosts = collectOfficialHosts(homeCandidates)
		}
	}
	for _, query := range officialQueries {
		effectiveQuery := query.Query
		trustedOrganization := ""
		if len(officialHosts) > 0 && !strings.Contains(query.QueryID, "wechat") {
			trustedOrganization = organizationDomain(officialHosts[0])
			effectiveQuery = buildSiteScopedQuery(trustedOrganization, query.QueryID)
		}
		discovered, searchErr := searchRelevantCandidates(ctx, crawler, effectiveQuery, school.Name, trustedOrganization)
		if searchErr != nil {
			setQueryStatus(result.SearchQueries, query.QueryID, "search_failed")
			searchErrors = append(searchErrors, effectiveQuery+": "+searchErr.Error())
			continue
		}
		if len(discovered) == 0 {
			setQueryStatus(result.SearchQueries, query.QueryID, "searched_no_candidate")
		} else {
			setQueryStatus(result.SearchQueries, query.QueryID, "searched_candidates")
		}
		for index := range discovered {
			discovered[index].Channel = query.Channel
			discovered[index].QueryID = query.QueryID
			discovered[index].SearchQuery = effectiveQuery
		}
		candidates = appendUniqueCandidates(candidates, discovered...)
	}
	if len(searchErrors) >= len(officialQueries) && len(candidates) == 0 && len(social) == 0 {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			result.Status = "school_timeout"
		} else {
			result.Status = "search_failed"
		}
		result.Note = strings.Join(searchErrors, "；")
		return result
	}
	primaryPageBudget := maxPages
	if sourceProfile == "orientation-first" && maxPages >= 4 {
		primaryPageBudget = maxPages - max(2, maxPages/3)
	}
	result.Sources = inspectCandidateQueue(ctx, crawler, school.Name, candidates, result.Sources, primaryPageBudget)
	if sourceProfile == "orientation-first" && len(result.Sources) < maxPages && ctx.Err() == nil {
		gapQueries := buildGapSearchQueries(school.Name, result.Sources)
		result.SearchQueries = append(result.SearchQueries, gapQueries...)
		gapCandidateBatches := make([][]searchCandidate, 0, len(gapQueries))
		for _, query := range gapQueries {
			effectiveQuery := query.Query
			trustedOrganization := ""
			if len(officialHosts) > 0 && !strings.Contains(query.QueryID, "wechat") {
				trustedOrganization = organizationDomain(officialHosts[0])
				effectiveQuery = buildSiteScopedQuery(trustedOrganization, query.QueryID)
			}
			discovered, searchErr := searchRelevantCandidates(ctx, crawler, effectiveQuery, school.Name, trustedOrganization)
			if searchErr != nil {
				setQueryStatus(result.SearchQueries, query.QueryID, "search_failed")
				searchErrors = append(searchErrors, effectiveQuery+": "+searchErr.Error())
				continue
			}
			if len(discovered) == 0 {
				setQueryStatus(result.SearchQueries, query.QueryID, "searched_no_candidate")
			} else {
				setQueryStatus(result.SearchQueries, query.QueryID, "searched_candidates")
			}
			for index := range discovered {
				discovered[index].Channel = query.Channel
				discovered[index].QueryID = query.QueryID
				discovered[index].SearchQuery = effectiveQuery
			}
			gapCandidateBatches = append(gapCandidateBatches, discovered)
		}
		gapCandidates := roundRobinCandidates(gapCandidateBatches)
		result.Sources = inspectCandidateQueue(ctx, crawler, school.Name, gapCandidates, result.Sources, maxPages)
	}
	for _, source := range social {
		if strings.TrimSpace(source.Channel) == "" {
			source.Channel = "xiaohongshu"
		}
		result.Sources = append(result.Sources, source)
	}
	usable := 0
	for _, source := range result.Sources {
		if source.Status == "candidate_evidence" {
			usable++
		}
	}
	switch {
	case usable > 0:
		result.Status = "pending_manual_review"
		result.Note = "自动抽取只生成候选；核验校区与父级关系后才能入库"
		if len(searchErrors) > 0 {
			result.Note += "；部分搜索查询失败但已保留其他网页或小红书候选"
		}
	case len(result.Sources) > 0:
		result.Status = "official_pages_found_no_extractable_evidence"
	default:
		result.Status = "discovery_no_candidates"
		result.Note = "当前发现渠道未返回可检查的官方候选，不代表学校没有公开资料"
	}
	return result
}

func buildSiteScopedQuery(host string, queryID string) string {
	prefix := "site:" + strings.TrimSpace(host) + " "
	switch queryID {
	case "official-orientation":
		return prefix + "迎新 新生指南 食堂 餐厅"
	case "official-logistics":
		return prefix + "后勤 餐饮 食堂 餐厅"
	case "official-floors":
		return prefix + "食堂 餐厅 楼层 校区"
	case "official-windows":
		return prefix + "食堂 窗口 档口"
	default:
		return prefix + "食堂 餐厅 后勤 迎新"
	}
}

func organizationDomain(host string) string {
	host = strings.Trim(strings.ToLower(strings.TrimSpace(host)), ".")
	labels := strings.Split(host, ".")
	if len(labels) >= 3 && (strings.HasSuffix(host, ".edu.cn") || strings.HasSuffix(host, ".gov.cn")) {
		return strings.Join(labels[len(labels)-3:], ".")
	}
	return host
}

func appendUniqueCandidates(existing []searchCandidate, candidates ...searchCandidate) []searchCandidate {
	seen := make(map[string]struct{}, len(existing)+len(candidates))
	result := make([]searchCandidate, 0, len(existing)+len(candidates))
	for _, candidate := range append(existing, candidates...) {
		candidate.URL = strings.TrimSpace(candidate.URL)
		if candidate.URL == "" {
			continue
		}
		if _, ok := seen[candidate.URL]; ok {
			continue
		}
		seen[candidate.URL] = struct{}{}
		result = append(result, candidate)
	}
	return result
}

func roundRobinCandidates(batches [][]searchCandidate) []searchCandidate {
	result := []searchCandidate{}
	for offset := 0; ; offset++ {
		added := false
		for _, batch := range batches {
			if offset >= len(batch) {
				continue
			}
			result = appendUniqueCandidates(result, batch[offset])
			added = true
		}
		if !added {
			return result
		}
	}
}

func hasGraduateAffiliation(text string) bool {
	return graduateAffiliation.MatchString(text)
}

func filterDiscoveryCandidates(candidates []searchCandidate, schoolName, trustedOrganization string) []searchCandidate {
	trustedOrganization = organizationDomain(trustedOrganization)
	result := make([]searchCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if !isOfficialCandidate(candidate.URL) {
			continue
		}
		parsed, err := url.Parse(candidate.URL)
		if err != nil {
			continue
		}
		if trustedOrganization != "" {
			if organizationDomain(parsed.Hostname()) != trustedOrganization {
				continue
			}
		} else if !strings.Contains(candidate.Title+" "+candidate.Snippet, schoolName) {
			continue
		}
		result = appendUniqueCandidates(result, candidate)
	}
	return result
}

func searchRelevantCandidates(
	ctx context.Context,
	crawler *rateLimitedClient,
	query string,
	schoolName string,
	trustedOrganization string,
) ([]searchCandidate, error) {
	candidates360, err360 := search360(ctx, crawler, query)
	filtered360 := filterDiscoveryCandidates(candidates360, schoolName, trustedOrganization)
	if len(filtered360) > 0 {
		return filtered360, nil
	}
	candidatesBing, errBing := searchBing(ctx, crawler, query)
	filteredBing := filterDiscoveryCandidates(candidatesBing, schoolName, trustedOrganization)
	if len(filteredBing) > 0 {
		return filteredBing, nil
	}
	if err360 != nil && errBing != nil {
		return nil, fmt.Errorf("360: %v; Bing: %v", err360, errBing)
	}
	if errBing != nil {
		return nil, errBing
	}
	return nil, nil
}

func searchBing(ctx context.Context, crawler *rateLimitedClient, query string) ([]searchCandidate, error) {
	searchURL := "https://cn.bing.com/search?q=" + url.QueryEscape(query) + "&count=20"
	response, err := crawler.get(ctx, searchURL)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("搜索响应状态 %d", response.StatusCode)
	}
	document, err := html.Parse(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	return extractBingCandidates(document), nil
}

func extractBingCandidates(document *html.Node) []searchCandidate {
	seen := map[string]struct{}{}
	results := make([]searchCandidate, 0, 12)
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode && node.Data == "li" && hasClass(node, "b_algo") {
			if heading := firstDescendantElement(node, "h2"); heading != nil {
				if anchor := firstDescendantElement(heading, "a"); anchor != nil {
					href := attr(anchor, "href")
					if parsed, parseErr := url.Parse(href); parseErr == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
						canonical := parsed.String()
						if _, exists := seen[canonical]; !exists {
							seen[canonical] = struct{}{}
							results = append(results, searchCandidate{
								URL:     canonical,
								Title:   cleanText(nodeText(anchor)),
								Snippet: cleanText(nodeText(node)),
							})
						}
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	return results
}

func search360(ctx context.Context, crawler *rateLimitedClient, query string) ([]searchCandidate, error) {
	searchURL := "https://www.so.com/s?q=" + url.QueryEscape(query)
	response, err := crawler.get(ctx, searchURL)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("360搜索响应状态 %d", response.StatusCode)
	}
	document, err := html.Parse(io.LimitReader(response.Body, 6<<20))
	if err != nil {
		return nil, err
	}
	results := extract360Candidates(document)
	if len(results) == 0 {
		pageText := cleanText(visibleText(document))
		if strings.Contains(pageText, "验证码") || strings.Contains(pageText, "正常行为而不是自动程序") {
			return nil, errors.New("360搜索触发访问验证")
		}
	}
	return results, nil
}

func extract360Candidates(document *html.Node) []searchCandidate {
	seen := map[string]struct{}{}
	results := make([]searchCandidate, 0, 12)
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode && node.Data == "h3" && hasClass(node, "res-title") {
			if anchor := firstDescendantElement(node, "a"); anchor != nil {
				target := attr(anchor, "data-mdurl")
				if target == "" {
					target = attr(anchor, "data-replaceurl")
				}
				if target == "" {
					target = attr(anchor, "href")
				}
				if parsed, parseErr := url.Parse(target); parseErr == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
					canonical := parsed.String()
					if _, exists := seen[canonical]; !exists {
						seen[canonical] = struct{}{}
						results = append(results, searchCandidate{URL: canonical, Title: cleanText(nodeText(anchor))})
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	return results
}

func hasClass(node *html.Node, className string) bool {
	for _, value := range strings.Fields(attr(node, "class")) {
		if value == className {
			return true
		}
	}
	return false
}

func firstDescendantElement(node *html.Node, element string) *html.Node {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.ElementNode && child.Data == element {
			return child
		}
		if found := firstDescendantElement(child, element); found != nil {
			return found
		}
	}
	return nil
}

func collectOfficialHosts(candidates []searchCandidate) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, candidate := range candidates {
		if !isOfficialCandidate(candidate.URL) {
			continue
		}
		parsed, err := url.Parse(candidate.URL)
		if err != nil {
			continue
		}
		host := strings.ToLower(parsed.Hostname())
		if host == "" {
			continue
		}
		if _, exists := seen[host]; exists {
			continue
		}
		seen[host] = struct{}{}
		result = append(result, host)
		if len(result) >= 2 {
			break
		}
	}
	return result
}

func inspectCandidateQueue(
	ctx context.Context,
	crawler *rateLimitedClient,
	schoolName string,
	candidates []searchCandidate,
	existingSources []crawlSource,
	maxPages int,
) []crawlSource {
	result := append([]crawlSource{}, existingSources...)
	seen := make(map[string]struct{}, len(result))
	for _, source := range result {
		seen[source.URL] = struct{}{}
	}
	queue := appendUniqueCandidates(nil, candidates...)
	for cursor := 0; cursor < len(queue) && len(result) < maxPages && ctx.Err() == nil; cursor++ {
		candidate := queue[cursor]
		if !isOfficialCandidate(candidate.URL) {
			continue
		}
		if _, exists := seen[candidate.URL]; exists {
			continue
		}
		seen[candidate.URL] = struct{}{}
		source := inspectSource(ctx, crawler, schoolName, candidate)
		discovered := source.DiscoveredLinks
		for index := range discovered {
			discovered[index].QueryID = candidate.QueryID
		}
		source.DiscoveredLinks = nil
		result = append(result, source)
		queue = appendUniqueCandidates(queue, discovered...)
	}
	return result
}

func extractRelevantOfficialLinks(document *html.Node, baseURL string) []searchCandidate {
	base, err := url.Parse(baseURL)
	if err != nil {
		return nil
	}
	baseOrganization := organizationDomain(base.Hostname())
	seen := map[string]struct{}{}
	result := []searchCandidate{}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if len(result) >= 40 {
			return
		}
		if node.Type == html.ElementNode && node.Data == "a" {
			href := strings.TrimSpace(attr(node, "href"))
			title := cleanText(nodeText(node))
			if href != "" && (relevantLinkText.MatchString(title) || relevantLinkPath.MatchString(href)) {
				reference, parseErr := url.Parse(href)
				if parseErr == nil {
					resolved := base.ResolveReference(reference)
					resolved.Fragment = ""
					host := strings.ToLower(resolved.Hostname())
					canonical := resolved.String()
					if (resolved.Scheme == "http" || resolved.Scheme == "https") &&
						isOfficialCandidate(canonical) &&
						organizationDomain(host) == baseOrganization {
						if _, exists := seen[canonical]; !exists {
							seen[canonical] = struct{}{}
							result = append(result, searchCandidate{
								URL:         canonical,
								Title:       title,
								Channel:     "official_recursive",
								SearchQuery: "linked from " + baseURL,
							})
						}
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	return result
}

func inspectSource(ctx context.Context, crawler *rateLimitedClient, schoolName string, candidate searchCandidate) crawlSource {
	parsed, _ := url.Parse(candidate.URL)
	result := crawlSource{
		URL: candidate.URL, Title: candidate.Title, Host: strings.ToLower(parsed.Hostname()),
		Channel: candidate.Channel, QueryID: candidate.QueryID, SearchQuery: candidate.SearchQuery, Status: "fetch_failed",
	}
	response, err := crawler.get(ctx, candidate.URL)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer response.Body.Close()
	result.ContentType = response.Header.Get("Content-Type")
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		result.Status = "http_error"
		result.Error = fmt.Sprintf("HTTP %d", response.StatusCode)
		return result
	}
	if strings.Contains(strings.ToLower(result.ContentType), "pdf") || strings.HasSuffix(strings.ToLower(parsed.Path), ".pdf") {
		result.Status = "needs_pdf_extraction"
		return result
	}
	reader, err := charset.NewReader(io.LimitReader(response.Body, 6<<20), result.ContentType)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	document, err := html.Parse(reader)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.DiscoveredLinks = extractRelevantOfficialLinks(document, candidate.URL)
	text := cleanText(visibleText(document))
	if !strings.Contains(text, schoolName) && !strings.Contains(candidate.Title, schoolName) {
		result.Status = "school_name_not_found"
		return result
	}
	if candidate.QueryID == "official-graduate-wechat" && !hasGraduateAffiliation(candidate.Title+" "+text) {
		result.Status = "graduate_affiliation_not_found"
		return result
	}
	result.CanteenCandidates = uniqueMatches(canteenPattern, text)
	result.FloorMentions = uniqueMatches(floorMentionPattern, text)
	result.WindowCandidates = uniqueMatches(windowPattern, text)
	if len(result.CanteenCandidates)+len(result.WindowCandidates) == 0 {
		result.Status = "no_dining_evidence"
		return result
	}
	result.Status = "candidate_evidence"
	result.EvidenceExcerpt = evidenceExcerpt(text)
	return result
}

func (crawler *rateLimitedClient) get(ctx context.Context, target string) (*http.Response, error) {
	crawler.mu.Lock()
	if wait := crawler.delay - time.Since(crawler.lastRequest); wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			crawler.mu.Unlock()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		crawler.mu.Unlock()
		return nil, err
	}
	request.Header.Set("User-Agent", crawlerUserAgent)
	request.Header.Set("Accept", "text/html,application/xhtml+xml,application/pdf;q=0.8")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.6")
	crawler.lastRequest = time.Now()
	crawler.mu.Unlock()
	return crawler.client.Do(request)
}

func isOfficialCandidate(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "mp.weixin.qq.com" ||
		strings.HasSuffix(host, ".edu.cn") || host == "edu.cn" ||
		strings.HasSuffix(host, ".gov.cn") || host == "gov.cn" ||
		host == "gaokao.chsi.com.cn"
}

func visibleText(root *html.Node) string {
	var builder strings.Builder
	var walk func(*html.Node, bool)
	walk = func(node *html.Node, hidden bool) {
		if node.Type == html.ElementNode && (node.Data == "script" || node.Data == "style" || node.Data == "noscript") {
			hidden = true
		}
		if node.Type == html.TextNode && !hidden {
			builder.WriteString(node.Data)
			builder.WriteByte(' ')
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child, hidden)
		}
	}
	walk(root, false)
	return builder.String()
}

func evidenceExcerpt(text string) string {
	indexes := []int{}
	for _, keyword := range []string{"食堂", "餐厅", "饭堂", "窗口", "档口"} {
		if index := strings.Index(text, keyword); index >= 0 {
			indexes = append(indexes, index)
		}
	}
	if len(indexes) == 0 {
		return ""
	}
	sort.Ints(indexes)
	runes := []rune(text)
	position := len([]rune(text[:indexes[0]]))
	start := max(0, position-120)
	end := min(len(runes), position+500)
	return strings.TrimSpace(string(runes[start:end]))
}

func uniqueMatches(pattern *regexp.Regexp, text string) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, match := range pattern.FindAllString(text, -1) {
		match = cleanCandidate(strings.TrimSpace(match))
		if match == "" || len([]rune(match)) > 24 || isGenericNarrative(match) {
			continue
		}
		if _, exists := seen[match]; exists {
			continue
		}
		seen[match] = struct{}{}
		result = append(result, match)
		if len(result) >= 80 {
			break
		}
	}
	return result
}

func cleanCandidate(value string) string {
	for _, marker := range []string{"设置", "设有", "新增", "引入", "包括", "包含", "提供", "开设", "设"} {
		if index := strings.LastIndex(value, marker); index >= 0 {
			suffix := strings.TrimSpace(value[index+len(marker):])
			if suffix != "" {
				value = suffix
			}
		}
	}
	return strings.TrimSpace(value)
}

func isGenericNarrative(value string) bool {
	for _, prefix := range []string{"学校现有", "学院现有", "共有", "设有", "新增", "开放", "前往", "进入"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}

func cleanText(value string) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, value)
	return strings.TrimSpace(spacePattern.ReplaceAllString(value, " "))
}

func nodeText(node *html.Node) string {
	var builder strings.Builder
	var walk func(*html.Node)
	walk = func(current *html.Node) {
		if current.Type == html.TextNode {
			builder.WriteString(current.Data)
			builder.WriteByte(' ')
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return builder.String()
}

func attr(node *html.Node, name string) string {
	for _, item := range node.Attr {
		if item.Key == name {
			return strings.TrimSpace(item.Val)
		}
	}
	return ""
}

func loadAudit(path string) (*auditFile, error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return nil, err
	}
	var result auditFile
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func loadCrawlState(path string) (*crawlFile, error) {
	data, err := os.ReadFile(filepath.Clean(path))
	if errors.Is(err, os.ErrNotExist) {
		return &crawlFile{Scope: "公开官网/迎新页面/PDF/可访问公众号候选；所有结果均待人工审核", Schools: []crawlSchool{}}, nil
	}
	if err != nil {
		return nil, err
	}
	var result crawlFile
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func loadSeeds(path string) (map[string][]searchCandidate, error) {
	result := map[string][]searchCandidate{}
	if strings.TrimSpace(path) == "" {
		return result, nil
	}
	data, err := os.ReadFile(filepath.Clean(path))
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	var input seedFile
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}
	for _, school := range input.Schools {
		for _, source := range school.Sources {
			switch source.Status {
			case "", "candidate_evidence", "no_dining_evidence", "needs_pdf_extraction":
				result[school.SchoolID] = appendUniqueCandidates(result[school.SchoolID], source)
			}
		}
	}
	return result, nil
}

func loadSocialEvidence(path string) (map[string][]crawlSource, error) {
	result := map[string][]crawlSource{}
	if strings.TrimSpace(path) == "" {
		return result, nil
	}
	data, err := os.ReadFile(filepath.Clean(path))
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	var input socialEvidenceFile
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}
	for _, school := range input.Schools {
		if strings.TrimSpace(school.SchoolID) == "" {
			continue
		}
		for _, source := range school.Sources {
			if source.Channel == "" {
				source.Channel = "xiaohongshu"
			}
			result[school.SchoolID] = append(result[school.SchoolID], source)
		}
	}
	return result, nil
}

func saveResearchQueue(path string, schools []auditSchool, evidence map[string][]crawlSource) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	completed := map[string]struct{}{}
	for _, sources := range evidence {
		for _, source := range sources {
			if source.QueryID != "" && source.Status != "unreadable" && source.Status != "capture_failed" {
				completed[source.QueryID] = struct{}{}
			}
		}
	}
	queue := researchQueueFile{
		GeneratedAt: time.Now(),
		Scope:       "全国高校参数化餐饮研究队列；网页和小红书均只生成候选证据，食堂、楼层、窗口必须核验父子关系后发布",
		Schools:     make([]researchQueueSchool, 0, len(schools)),
	}
	for _, school := range schools {
		xiaohongshuQueries := buildXiaohongshuQueries(school.Name)
		for index := range xiaohongshuQueries {
			xiaohongshuQueries[index].QueryID = school.SchoolID + ":" + xiaohongshuQueries[index].QueryID
			if _, ok := completed[xiaohongshuQueries[index].QueryID]; ok {
				xiaohongshuQueries[index].Status = "captured"
			}
		}
		queue.Schools = append(queue.Schools, researchQueueSchool{
			SchoolID: school.SchoolID, OfficialCode: school.OfficialCode, Name: school.Name,
			Province: school.Province, AuditStatus: school.AuditStatus, Coverage: coverageFromAudit(school),
			OfficialQueries: buildOfficialSearchQueries(school.Name), XiaohongshuQueries: xiaohongshuQueries,
		})
	}
	return saveJSON(path, queue)
}

func saveXiaohongshuQueue(path string, schools []auditSchool, evidence map[string][]crawlSource) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	completed := map[string]struct{}{}
	for _, sources := range evidence {
		for _, source := range sources {
			if source.QueryID != "" && source.Status != "unreadable" && source.Status != "capture_failed" {
				completed[source.QueryID] = struct{}{}
			}
		}
	}
	queue := xiaohongshuQueueFile{
		GeneratedAt: time.Now(),
		Scope:       "全国高校参数化小红书发现队列；需通过用户已登录的 MCP 浏览器读取可见正文，结果只作为待人工核验证据",
		Schools:     make([]xiaohongshuQueueSchool, 0, len(schools)),
	}
	for _, school := range schools {
		queries := buildXiaohongshuQueries(school.Name)
		for index := range queries {
			queries[index].QueryID = school.SchoolID + ":" + queries[index].QueryID
			if _, ok := completed[queries[index].QueryID]; ok {
				queries[index].Status = "captured"
			}
		}
		queue.Schools = append(queue.Schools, xiaohongshuQueueSchool{
			SchoolID: school.SchoolID, OfficialCode: school.OfficialCode, Name: school.Name,
			Province: school.Province, AuditStatus: school.AuditStatus, Queries: queries,
		})
	}
	return saveJSON(path, queue)
}

func saveJSON(path string, value any) error {
	path = filepath.Clean(path)
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryPath)
	}()
	if err := temporary.Chmod(0o644); err != nil {
		return err
	}
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	return nil
}

func saveCrawlState(path string, state *crawlFile) error {
	return saveJSON(path, state)
}
