package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/html"
)

func TestIsOfficialCandidate(t *testing.T) {
	assert.True(t, isOfficialCandidate("https://hq.example.edu.cn/info/1.htm"))
	assert.True(t, isOfficialCandidate("https://mp.weixin.qq.com/s/abc"))
	assert.True(t, isOfficialCandidate("https://jw.beijing.gov.cn/example.pdf"))
	assert.True(t, isOfficialCandidate("https://gaokao.chsi.com.cn/example"))
	assert.False(t, isOfficialCandidate("https://zhuanlan.zhihu.com/p/1"))
	assert.False(t, isOfficialCandidate("https://www.xiaohongshu.com/explore/1"))
}

func TestVisibleTextSkipsScripts(t *testing.T) {
	doc, err := html.Parse(strings.NewReader(`<html><body><h1>某大学第一食堂</h1><script>错误窗口</script></body></html>`))
	require.NoError(t, err)
	text := cleanText(visibleText(doc))
	assert.Contains(t, text, "某大学第一食堂")
	assert.NotContains(t, text, "错误窗口")
}

func TestCandidateExtractionRemainsPendingFriendly(t *testing.T) {
	text := "学校餐饮指南：第一学生食堂位于宿舍区，二楼设清真窗口。"
	assert.Contains(t, uniqueMatches(canteenPattern, text), "第一学生食堂")
	assert.Contains(t, uniqueMatches(floorMentionPattern, text), "二楼")
	assert.Contains(t, uniqueMatches(windowPattern, text), "清真窗口")
}

func TestRetryableStatus(t *testing.T) {
	assert.True(t, isRetryableStatus("search_failed"))
	assert.True(t, isRetryableStatus("school_timeout"))
	assert.True(t, isRetryableStatus("no_official_source_found"))
	assert.True(t, isRetryableStatus("discovery_no_candidates"))
	assert.False(t, isRetryableStatus("pending_manual_review"))
}

func TestAppendUniqueCandidatesPrefersSeedOrder(t *testing.T) {
	result := appendUniqueCandidates(
		[]searchCandidate{{URL: "https://example.edu.cn/a", Title: "人工来源"}},
		searchCandidate{URL: "https://example.edu.cn/a", Title: "搜索重复"},
		searchCandidate{URL: "https://example.edu.cn/b"},
	)
	require.Len(t, result, 2)
	assert.Equal(t, "人工来源", result[0].Title)
}

func TestRoundRobinCandidatesReservesOneResultPerQuery(t *testing.T) {
	result := roundRobinCandidates([][]searchCandidate{
		{{URL: "https://a.edu.cn/1"}, {URL: "https://a.edu.cn/2"}},
		{{URL: "https://b.edu.cn/1"}, {URL: "https://b.edu.cn/2"}},
		{{URL: "https://mp.weixin.qq.com/s/1"}},
	})
	require.Len(t, result, 5)
	assert.Equal(t, "https://a.edu.cn/1", result[0].URL)
	assert.Equal(t, "https://b.edu.cn/1", result[1].URL)
	assert.Equal(t, "https://mp.weixin.qq.com/s/1", result[2].URL)
	assert.Equal(t, "https://a.edu.cn/2", result[3].URL)
}

func TestGraduateAffiliationRequiresOfficialGraduateOrganizationLanguage(t *testing.T) {
	assert.True(t, hasGraduateAffiliation("学校研究生会发布迎新食堂指南"))
	assert.True(t, hasGraduateAffiliation("研究生院整理的新生手册"))
	assert.False(t, hasGraduateAffiliation("学校介绍：现有研究生一万余人"))
}

func TestExtract360CandidatesUsesDirectMetadataURL(t *testing.T) {
	doc, err := html.Parse(strings.NewReader(`<html><body>
		<h3 class="res-title"><a href="https://www.so.com/link?m=redirect" data-mdurl="https://www.example.edu.cn/info/1.htm">某某学院食堂</a></h3>
		<h3 class="title"><a href="https://footer.example.com">页脚</a></h3>
	</body></html>`))
	require.NoError(t, err)
	result := extract360Candidates(doc)
	require.Len(t, result, 1)
	assert.Equal(t, "https://www.example.edu.cn/info/1.htm", result[0].URL)
	assert.Equal(t, "某某学院食堂", result[0].Title)
}

func TestExtractBingCandidatesKeepsOnlyOrganicResults(t *testing.T) {
	doc, err := html.Parse(strings.NewReader(`<html><body>
		<a href="https://www.beijing.gov.cn/">页头链接</a>
		<ol>
			<li class="b_algo"><h2><a href="https://www.example.edu.cn/">某某大学官网</a></h2><div class="b_caption"><p>某某大学官方网站</p></div></li>
			<li class="b_algo"><h2><a href="https://news.example.edu.cn/dining.htm">迎新饮食指南</a></h2><div class="b_caption"><p>某某大学研究生会整理食堂信息</p></div></li>
		</ol>
		<a href="https://beian.miit.gov.cn/">页脚链接</a>
	</body></html>`))
	require.NoError(t, err)
	result := extractBingCandidates(doc)
	require.Len(t, result, 2)
	assert.Equal(t, "https://www.example.edu.cn/", result[0].URL)
	assert.Equal(t, "某某大学官网", result[0].Title)
	assert.Contains(t, result[1].Snippet, "某某大学研究生会")
}

func TestFilterDiscoveryCandidatesRejectsUnrelatedOfficialFooterLinks(t *testing.T) {
	candidates := []searchCandidate{
		{URL: "https://www.beijing.gov.cn/", Title: "北京市政府"},
		{URL: "https://www.example.edu.cn/", Title: "某某大学官网"},
		{URL: "https://mp.weixin.qq.com/s/1", Title: "迎新饮食指南", Snippet: "某某大学研究生会发布"},
	}
	withoutTrustedDomain := filterDiscoveryCandidates(candidates, "某某大学", "")
	require.Len(t, withoutTrustedDomain, 2)
	assert.Equal(t, "https://www.example.edu.cn/", withoutTrustedDomain[0].URL)
	assert.Equal(t, "https://mp.weixin.qq.com/s/1", withoutTrustedDomain[1].URL)

	withTrustedDomain := filterDiscoveryCandidates([]searchCandidate{
		{URL: "https://yingxin.example.edu.cn/guide.htm", Title: "新生指南"},
		{URL: "https://other.edu.cn/guide.htm", Title: "某某大学新生指南"},
	}, "某某大学", "example.edu.cn")
	require.Len(t, withTrustedDomain, 1)
	assert.Equal(t, "https://yingxin.example.edu.cn/guide.htm", withTrustedDomain[0].URL)
}

func TestAuditSourceCandidatesReuseExistingOfficialEvidence(t *testing.T) {
	school := auditSchool{Canteens: []auditCanteen{
		{SourceURL: "https://news.example.edu.cn/dining.htm"},
		{SourceURL: "https://news.example.edu.cn/dining.htm"},
		{SourceURL: "https://www.xiaohongshu.com/explore/1"},
	}}
	result := auditSourceCandidates(school)
	require.Len(t, result, 1)
	assert.Equal(t, "https://news.example.edu.cn/dining.htm", result[0].URL)
	assert.Equal(t, "audit_existing_source", result[0].Channel)
}

func TestCollectOfficialHostsIgnoresThirdPartyResults(t *testing.T) {
	result := collectOfficialHosts([]searchCandidate{
		{URL: "https://www.sohu.com/a/1"},
		{URL: "https://www.example.edu.cn/"},
		{URL: "https://jw.beijing.gov.cn/report.pdf"},
	})
	assert.Equal(t, []string{"www.example.edu.cn", "jw.beijing.gov.cn"}, result)
}

func TestUpsertCrawlSchoolReplacesPreviousFailure(t *testing.T) {
	state := &crawlFile{Schools: []crawlSchool{{SchoolID: "school-1", Status: "search_failed"}}}
	upsertCrawlSchool(state, crawlSchool{SchoolID: "school-1", Status: "pending_manual_review"})
	require.Len(t, state.Schools, 1)
	assert.Equal(t, "pending_manual_review", state.Schools[0].Status)
}

func TestSelectAuditSchoolsSupportsNationwideAndProvinceMVP(t *testing.T) {
	schools := []auditSchool{
		{SchoolID: "bj-1", Province: "北京市", AuditStatus: "not_started"},
		{SchoolID: "bj-2", Province: "北京市", AuditStatus: "source_backed_partial"},
		{SchoolID: "sh-1", Province: "上海市", AuditStatus: "not_started"},
	}
	statuses := parseCSVSet("not_started, source_backed_partial")
	assert.Len(t, selectAuditSchools(schools, "", statuses, nil, nil), 3)
	beijing := selectAuditSchools(schools, "北京市", statuses, nil, nil)
	require.Len(t, beijing, 2)
	assert.Equal(t, "bj-1", beijing[0].SchoolID)
	byCode := selectAuditSchools([]auditSchool{{OfficialCode: "1001"}, {OfficialCode: "1002"}}, "", nil, parseCSVSet("1002"), nil)
	require.Len(t, byCode, 1)
	assert.Equal(t, "1002", byCode[0].OfficialCode)
	excludingBeijing := selectAuditSchools(schools, "", statuses, nil, parseCSVSet("北京市"))
	require.Len(t, excludingBeijing, 1)
	assert.Equal(t, "sh-1", excludingBeijing[0].SchoolID)
}

func TestBuildXiaohongshuQueriesStartsWithLiteralSchoolCanteenQuery(t *testing.T) {
	queries := buildXiaohongshuQueries("某某学院")
	require.Len(t, queries, 3)
	assert.Equal(t, "某某学院 食堂", queries[0].Query)
	assert.Equal(t, "xiaohongshu", queries[0].Channel)
	assert.Equal(t, "pending_mcp_capture", queries[0].Status)
}

func TestBuildSiteScopedQueryDoesNotRepeatSchoolName(t *testing.T) {
	assert.Equal(t, "site:www.example.edu.cn 食堂 餐厅 楼层 校区", buildSiteScopedQuery("www.example.edu.cn", "official-floors"))
	assert.Equal(t, "site:www.example.edu.cn 食堂 窗口 档口", buildSiteScopedQuery("www.example.edu.cn", "official-windows"))
}

func TestSaveXiaohongshuQueueMarksCapturedQuery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "queue.json")
	schools := []auditSchool{{SchoolID: "school-1", OfficialCode: "1001", Name: "某某学院", Province: "北京市", AuditStatus: "not_started"}}
	evidence := map[string][]crawlSource{
		"school-1": {{QueryID: "school-1:xiaohongshu-overview", Channel: "xiaohongshu", Status: "candidate_evidence"}},
	}
	require.NoError(t, saveXiaohongshuQueue(path, schools, evidence))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var queue xiaohongshuQueueFile
	require.NoError(t, json.Unmarshal(data, &queue))
	require.Len(t, queue.Schools, 1)
	require.Len(t, queue.Schools[0].Queries, 3)
	assert.Equal(t, "captured", queue.Schools[0].Queries[0].Status)
	assert.Equal(t, "pending_mcp_capture", queue.Schools[0].Queries[1].Status)
}

func TestSaveResearchQueueIncludesBothChannelsAndCoverage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "research-queue.json")
	schools := []auditSchool{{
		SchoolID: "school-1", OfficialCode: "1001", Name: "某某学院", Province: "北京市", AuditStatus: "source_backed_partial",
		ActiveSiteCount: 2, ActiveCanteenCount: 4, CanteensWithFloorMetadata: 3, ActiveWindowCount: 1,
	}}
	require.NoError(t, saveResearchQueue(path, schools, nil))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	var queue researchQueueFile
	require.NoError(t, json.Unmarshal(data, &queue))
	require.Len(t, queue.Schools, 1)
	assert.Len(t, queue.Schools[0].OfficialQueries, 4)
	assert.Len(t, queue.Schools[0].XiaohongshuQueries, 3)
	assert.Equal(t, 4, queue.Schools[0].Coverage.ActiveCanteens)
	assert.Equal(t, 1, queue.Schools[0].Coverage.ActiveNamedWindows)
}

func TestLoadSocialEvidenceDefaultsChannel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "evidence.json")
	require.NoError(t, os.WriteFile(path, []byte(`{"schools":[{"school_id":"school-1","sources":[{"url":"https://www.xiaohongshu.com/explore/1","host":"www.xiaohongshu.com","status":"candidate_evidence"}]}]}`), 0o644))
	result, err := loadSocialEvidence(path)
	require.NoError(t, err)
	require.Len(t, result["school-1"], 1)
	assert.Equal(t, "xiaohongshu", result["school-1"][0].Channel)
}

func TestLoadSeedsDropsRejectedPriorCrawlSources(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prior-crawl.json")
	require.NoError(t, os.WriteFile(path, []byte(`{"schools":[{"school_id":"school-1","sources":[
		{"url":"https://www.example.edu.cn/good.htm","status":"candidate_evidence"},
		{"url":"https://www.example.edu.cn/empty.htm","status":"no_dining_evidence"},
		{"url":"https://www.example.edu.cn/manual.htm"},
		{"url":"https://beian.miit.gov.cn/","status":"school_name_not_found"},
		{"url":"https://www.example.edu.cn/fail.htm","status":"fetch_failed"}
	]}]}`), 0o644))
	result, err := loadSeeds(path)
	require.NoError(t, err)
	require.Len(t, result["school-1"], 3)
	assert.Equal(t, "https://www.example.edu.cn/good.htm", result["school-1"][0].URL)
	assert.Equal(t, "https://www.example.edu.cn/empty.htm", result["school-1"][1].URL)
	assert.Equal(t, "https://www.example.edu.cn/manual.htm", result["school-1"][2].URL)
}

func TestBuildOrientationFirstSearchQueriesPrioritizesWelcomeAndLogistics(t *testing.T) {
	queries := buildOfficialSearchQueriesForProfile("某某大学", "orientation-first")
	require.Len(t, queries, 3)
	assert.Equal(t, "official-orientation", queries[0].QueryID)
	assert.Contains(t, queries[0].Query, "迎新")
	assert.Contains(t, queries[0].Query, "新生指南")
	assert.Equal(t, "official-logistics", queries[1].QueryID)
	assert.Contains(t, queries[1].Query, "后勤")
	assert.Equal(t, "official-graduate-wechat", queries[2].QueryID)
	assert.Contains(t, queries[2].Query, "研究生会")
}

func TestSetQueryStatusRecordsAttemptOutcome(t *testing.T) {
	queries := []queryTask{{QueryID: "official-logistics"}, {QueryID: "official-graduate-wechat"}}
	setQueryStatus(queries, "official-graduate-wechat", "searched_no_candidate")
	assert.Empty(t, queries[0].Status)
	assert.Equal(t, "searched_no_candidate", queries[1].Status)
}

func TestBuildGapSearchQueriesStopsAfterDirectHierarchyEvidence(t *testing.T) {
	complete := []crawlSource{{
		CanteenCandidates: []string{"第一食堂"},
		FloorMentions:     []string{"一层"},
		WindowCandidates:  []string{"民族餐窗口"},
	}}
	assert.Empty(t, buildGapSearchQueries("某某大学", complete))

	missingFloorAndWindow := []crawlSource{{CanteenCandidates: []string{"第一食堂"}}}
	queries := buildGapSearchQueries("某某大学", missingFloorAndWindow)
	require.Len(t, queries, 2)
	assert.Equal(t, "official-floors", queries[0].QueryID)
	assert.Equal(t, "official-windows", queries[1].QueryID)

	noCanteen := buildGapSearchQueries("某某大学", nil)
	require.Len(t, noCanteen, 2)
	assert.Equal(t, "official-overview", noCanteen[0].QueryID)
	assert.Equal(t, "official-wechat", noCanteen[1].QueryID)

	partiallyMapped := []crawlSource{{
		CanteenCandidates: []string{"第一食堂", "第二食堂"},
		FloorMentions:     []string{"一层"},
		WindowCandidates:  []string{"民族餐窗口"},
	}}
	partialQueries := buildGapSearchQueries("某某大学", partiallyMapped)
	require.Len(t, partialQueries, 2)
	assert.Equal(t, "official-floors", partialQueries[0].QueryID)
	assert.Equal(t, "official-windows", partialQueries[1].QueryID)
}

func TestOrganizationDomainAllowsOfficialSubdomains(t *testing.T) {
	assert.Equal(t, "example.edu.cn", organizationDomain("www.example.edu.cn"))
	assert.Equal(t, "example.edu.cn", organizationDomain("yingxin.example.edu.cn"))
	assert.Equal(t, "beijing.gov.cn", organizationDomain("jw.beijing.gov.cn"))
	assert.Equal(t, "mp.weixin.qq.com", organizationDomain("mp.weixin.qq.com"))
}

func TestExtractRelevantOfficialLinksKeepsSameSchoolWelcomeAndDiningPages(t *testing.T) {
	doc, err := html.Parse(strings.NewReader(`<html><body>
		<a href="/info/1001/dining.htm">饮食指南</a>
		<a href="https://yingxin.example.edu.cn/freshman.pdf">新生手册 PDF</a>
		<a href="https://other.edu.cn/food.htm">其他学校食堂</a>
		<a href="/news/ordinary.htm">普通新闻</a>
	</body></html>`))
	require.NoError(t, err)
	result := extractRelevantOfficialLinks(doc, "https://www.example.edu.cn/index.htm")
	require.Len(t, result, 2)
	assert.Equal(t, "https://www.example.edu.cn/info/1001/dining.htm", result[0].URL)
	assert.Equal(t, "https://yingxin.example.edu.cn/freshman.pdf", result[1].URL)
	assert.Equal(t, "official_recursive", result[0].Channel)
}
