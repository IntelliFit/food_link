// Command import-ai-yuandian-community imports the image and menu evidence
// supplied in "ai原点社区食谱(1).docx" into the community-canteen collection
// workflow. It is intentionally idempotent: the batch key and COS object keys
// are stable, and an existing batch is never duplicated.
package main

import (
	"archive/zip"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path"
	"regexp"
	"strings"
	"time"

	appcore "food_link/backend/internal/app"
	catalogdomain "food_link/backend/internal/campuscatalog/domain"
	catalogrepo "food_link/backend/internal/campuscatalog/repo"
	catalogservice "food_link/backend/internal/campuscatalog/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"
)

const (
	batchKey  = "ai-yuandian-community-20260715-docx-v1"
	batchName = "AI原点社区食堂菜单采集-20260715"
)

var schemaNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type photoSpec struct {
	imageIndex  int
	windowName  string
	entryType   string
	imageKind   string
	serviceMode string
	name        string
	rawText     string
	notes       string
}

type menuSpec struct {
	windowName  string
	entryType   string
	serviceMode string
	name        string
	price       *float64
	priceType   string
	priceText   string
	rawText     string
}

func main() {
	docxPath := flag.String("docx", "", "path to ai原点社区食谱(1).docx")
	configDir := flag.String("config-dir", ".", "directory containing backend config")
	apply := flag.Bool("apply", false, "upload images and create the idempotent collection batch")
	confirmDB := flag.String("confirm-db", "", "required with --apply; must equal host/database/schema")
	publishNormalImages := flag.Bool("publish-normal-images", false, "submit every image-backed entry through the normal image analysis path and wait for completion")
	workerCount := flag.Int("worker-count", 3, "in-process workers used only with --publish-normal-images")
	publishTimeout := flag.Duration("publish-timeout", 4*time.Hour, "maximum wait for normal image analysis")
	flag.Parse()

	if strings.TrimSpace(*docxPath) == "" {
		log.Fatal("必须通过 --docx 指定食谱文档")
	}
	if *publishNormalImages && !*apply {
		log.Fatal("--publish-normal-images 必须与 --apply 一起使用")
	}
	if *publishNormalImages && (*workerCount < 1 || *workerCount > 6) {
		log.Fatal("--worker-count 必须在 1 到 6 之间")
	}
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	schema := strings.TrimSpace(cfg.Database.Schema)
	if schema == "" {
		schema = "public"
	}
	if !schemaNamePattern.MatchString(schema) {
		log.Fatalf("数据库 schema 非法: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + schema).Error; err != nil {
		log.Fatalf("设置数据库 schema 失败: %v", err)
	}
	target := fmt.Sprintf("%s/%s/%s", cfg.Database.Host, cfg.Database.Name, schema)
	if *apply && strings.TrimSpace(*confirmDB) != target {
		log.Fatalf("写入保护未通过：--confirm-db 必须为 %q", target)
	}

	repo := catalogrepo.NewCatalogRepo(db)
	existing, err := repo.FindBatchByClientKey(ctx, batchKey)
	if err != nil {
		log.Fatalf("查询已有采集批次失败: %v", err)
	}
	if existing != nil {
		reportExistingBatch(ctx, repo, existing)
		if *publishNormalImages {
			runNormalImageAnalysis(cfg, repo, existing.ID, *workerCount, *publishTimeout)
		}
		return
	}

	photos := photoSpecs()
	menus := menuSpecs()
	if len(photos) != 83 {
		log.Fatalf("导入清单错误：期望 83 张图片，实际 %d 条", len(photos))
	}
	if !*apply {
		log.Printf("预演通过：target=%s 图片条目=%d 菜单条目=%d 合计=%d；使用 --apply --confirm-db %q 后写入", target, len(photos), len(menus), len(photos)+len(menus), target)
		return
	}

	archive, err := zip.OpenReader(*docxPath)
	if err != nil {
		log.Fatalf("打开食谱文档失败: %v", err)
	}
	defer archive.Close()
	storageClient := storage.New(cfg.Storage)
	entries := make([]catalogservice.CreateCatalogItemInput, 0, len(photos)+len(menus))
	for _, spec := range photos {
		data, err := readMedia(&archive.Reader, spec.imageIndex)
		if err != nil {
			log.Fatalf("读取第 %d 张文档图片失败: %v", spec.imageIndex, err)
		}
		key := fmt.Sprintf("campus-food/imports/ai-yuandian-community-20260715/image-%03d.png", spec.imageIndex)
		imageURL, err := storageClient.UploadBytes("food-images", key, data, "image/png")
		if err != nil {
			log.Fatalf("上传第 %d 张菜品图片失败: %v", spec.imageIndex, err)
		}
		entries = append(entries, catalogservice.CreateCatalogItemInput{
			EntryType: spec.entryType, Name: spec.name, WindowName: spec.windowName,
			ServiceMode: spec.serviceMode, PriceType: "unknown", ImagePaths: []string{imageURL},
			ImageKind: spec.imageKind, SourceFilename: sourceFilename(spec.imageIndex),
			RawText: spec.rawText, Notes: spec.notes,
		})
	}
	for _, spec := range menus {
		entries = append(entries, catalogservice.CreateCatalogItemInput{
			EntryType: spec.entryType, Name: spec.name, WindowName: spec.windowName,
			ServiceMode: spec.serviceMode, PriceType: spec.priceType, Price: spec.price,
			PriceUnit: "元/份", PriceText: spec.priceText, ImageKind: "price_tag",
			SourceFilename: "ai原点社区食谱(1).docx", RawText: spec.rawText,
		})
	}

	capturedAt := time.Date(2026, time.July, 15, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	svc := catalogservice.NewCatalogService(repo, storageClient)
	result, err := svc.CreateBatch(ctx, "", catalogservice.CreateBatchInput{
		ClientBatchKey: batchKey, BatchName: batchName, VenueType: "community",
		OrganizationName: "AI原点社区", CanteenName: "AI原点社区食堂",
		DefaultWindowLayout: "continuous_counter", DefaultServiceMode: "mixed",
		DefaultMealPeriods: []string{"unknown"}, CapturedAt: &capturedAt,
		SourceNote: "来源：ai原点社区食谱(1).docx；文档最后修改于 2026-07-15，实际拍摄日期未注明。带“待确认”的名称、品牌与食材组合保留原始不确定性，未作为已核实信息发布。",
		Entries:    entries,
	})
	if err != nil {
		log.Fatalf("创建食堂采集批次失败: %v", err)
	}
	log.Printf("食堂采集导入完成: batch_id=%s 条目=%d 图片=%d 菜单=%d", result.Batch.ID, len(result.Items), len(photos), len(menus))
	if *publishNormalImages {
		runNormalImageAnalysis(cfg, repo, result.Batch.ID, *workerCount, *publishTimeout)
	}
}

func runNormalImageAnalysis(cfg *config.Config, repo *catalogrepo.CatalogRepo, batchID string, workerCount int, timeout time.Duration) {
	if timeout <= 0 {
		log.Fatal("--publish-timeout 必须大于 0")
	}
	// The normal task queue is in-process in this deployment. Build the same App
	// composition as the HTTP server so the publisher and worker share one queue;
	// do not use the standalone publisher command, which would create a second
	// memory queue and leave tasks pending after the process exits.
	cfg.Worker.Count = workerCount
	if err := os.Setenv("FOOD_LINK_DISABLE_BACKGROUND_MAINTENANCE", "1"); err != nil {
		log.Fatalf("设置一次性识别运行环境失败: %v", err)
	}
	application, err := appcore.New(cfg)
	if err != nil {
		log.Fatalf("初始化普通图片识别应用失败: %v", err)
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if closeErr := application.Close(closeCtx); closeErr != nil {
			log.Printf("关闭普通图片识别应用失败: %v", closeErr)
		}
	}()
	service := application.CampusCatalogService()
	if service == nil {
		log.Fatal("普通图片识别服务未初始化")
	}
	analysisCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	items, err := repo.ListItemsByBatch(analysisCtx, batchID)
	if err != nil {
		log.Fatalf("读取待识别图片条目失败: %v", err)
	}
	targetCount := 0
	submitted := 0
	for _, item := range items {
		if len(item.ImagePaths) == 0 {
			continue
		}
		targetCount++
		switch item.Status {
		case "published", "analysis_pending":
			continue
		case "draft", "analysis_failed", "changes_pending":
			published, publishErr := service.PublishItem(analysisCtx, "", item.ID)
			if publishErr != nil {
				log.Fatalf("提交普通图片识别失败: item_id=%s name=%s err=%v", item.ID, item.Name, publishErr)
			}
			if published.Status == "analysis_pending" {
				submitted++
			}
		default:
			log.Fatalf("图片条目状态不支持普通识别: item_id=%s status=%s", item.ID, item.Status)
		}
	}
	log.Printf("普通图片识别已提交: batch_id=%s image_items=%d newly_submitted=%d worker_count=%d", batchID, targetCount, submitted, workerCount)
	waitForImageAnalysis(analysisCtx, repo, batchID, targetCount)
}

func waitForImageAnalysis(ctx context.Context, repo *catalogrepo.CatalogRepo, batchID string, targetCount int) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	lastSummary := ""
	for {
		items, err := repo.ListItemsByBatch(ctx, batchID)
		if err != nil {
			log.Fatalf("读取普通图片识别进度失败: %v", err)
		}
		statusCounts := map[string]int{}
		processed := 0
		for _, item := range items {
			if len(item.ImagePaths) == 0 {
				continue
			}
			statusCounts[item.Status]++
			if item.Status == "published" || item.Status == "analysis_failed" {
				processed++
			}
		}
		summary := fmt.Sprintf("%d/%d status_counts=%v", processed, targetCount, statusCounts)
		if summary != lastSummary {
			log.Printf("普通图片识别进度: %s", summary)
			lastSummary = summary
		}
		if processed == targetCount {
			if statusCounts["analysis_failed"] > 0 {
				log.Printf("普通图片识别完成，但仍有失败条目: %s", summary)
				return
			}
			log.Printf("普通图片识别全部完成: %s", summary)
			return
		}
		select {
		case <-ctx.Done():
			log.Fatalf("普通图片识别等待超时: %s", summary)
		case <-ticker.C:
		}
	}
}

func reportExistingBatch(ctx context.Context, repo *catalogrepo.CatalogRepo, batch *catalogdomain.CollectionBatch) {
	items, err := repo.ListItemsByBatch(ctx, batch.ID)
	if err != nil {
		log.Fatalf("读取已有采集批次条目失败: %v", err)
	}
	withImages := 0
	menuItems := 0
	statusCounts := map[string]int{}
	for _, item := range items {
		if len(item.ImagePaths) > 0 {
			withImages++
		}
		if item.EntryType == "menu_item" || item.EntryType == "combo" {
			menuItems++
		}
		statusCounts[item.Status]++
		if item.Status == "analysis_failed" {
			log.Printf("普通图片识别失败条目: item_id=%s name=%s source_filename=%s error=%s", item.ID, item.Name, item.SourceFilename, item.AnalysisError)
		}
	}
	log.Printf("采集批次已存在，未重复写入: batch_id=%s batch_name=%s total=%d with_images=%d menu_or_combo=%d status_counts=%v", batch.ID, batch.BatchName, len(items), withImages, menuItems, statusCounts)
}

func readMedia(archive *zip.Reader, index int) ([]byte, error) {
	wanted := fmt.Sprintf("word/media/image%d.png", index)
	for _, file := range archive.File {
		if path.Clean(file.Name) != wanted {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		return io.ReadAll(reader)
	}
	return nil, fmt.Errorf("文档中缺少 %s", wanted)
}

func sourceFilename(index int) string {
	return fmt.Sprintf("ai原点社区食谱(1).docx#word/media/image%d.png", index)
}

func photo(windowName, entryType, imageKind, serviceMode, name, rawText, notes string, imageIndex int) photoSpec {
	return photoSpec{imageIndex: imageIndex, windowName: windowName, entryType: entryType, imageKind: imageKind, serviceMode: serviceMode, name: name, rawText: rawText, notes: notes}
}

func photoSpecs() []photoSpec {
	const youth = "青年干饭窗口"
	const oneCity = "一城一味窗口"
	const fullSeat = "满座儿窗口自选"
	rows := []photoSpec{
		photo(youth, "dish", "dish", "self_select", "炒包菜", "炒包菜", "", 1),
		photo(youth, "dish", "dish", "self_select", "芹菜炒香干", "芹菜炒香干", "", 2),
		photo(youth, "dish", "dish", "self_select", "酸菜炖碎骨头", "酸菜炖碎骨头", "", 3),
		photo(youth, "dish", "dish", "self_select", "宫保鸡丁（青椒洋葱版）", "宫保鸡丁（青椒洋葱版）", "", 4),
		photo(youth, "dish", "dish", "self_select", "西兰花炒木耳", "西兰花炒木耳", "", 5),
		photo(youth, "dish", "dish", "self_select", "辣炒面筋", "辣炒面筋", "", 6),
		photo(youth, "dish", "dish", "self_select", "爆炒猪肝", "爆炒猪肝", "", 7),
		photo(youth, "dish", "dish", "self_select", "冬瓜肉丸汤", "冬瓜肉丸汤", "", 8),
		photo(youth, "dish", "dish", "self_select", "酸辣土豆丝", "酸辣土豆丝", "", 9),
		photo(youth, "dish", "dish", "self_select", "家常小炒（木耳山药炒青笋）", "家常小炒（木耳山药炒青笋）", "", 10),
		photo(youth, "dish", "dish", "self_select", "新疆大盘鸡（待确认）", "新疆大盘鸡？（存疑，土豆青椒鸡肉…很像）", "原文标注存疑，需现场核实。", 11),
		photo(youth, "dish", "dish", "self_select", "土豆豆角烧五花肉", "土豆豆角烧五花肉", "", 12),
		photo(youth, "dish", "dish", "self_select", "小炒黄豆芽", "小炒黄豆芽", "", 13),
		photo(youth, "dish", "dish", "self_select", "辣炒香肠（待确认）", "辣炒香肠（不知道什么肠 要确认一下）", "香肠种类待确认。", 14),
		photo(youth, "dish", "dish", "self_select", "烧茄子、炒千张（同图）", "烧茄子 炒千张", "同张图片包含多个菜品，后续可拆分。", 15),
		photo(youth, "dish", "dish", "self_select", "辣蒜苔炒猪肉、糖醋里脊（同图）", "辣蒜苔炒猪肉  糖醋里脊", "同张图片包含多个菜品，后续可拆分。", 16),
		photo(youth, "dish", "dish", "self_select", "炖鱼块（鱼种待确认）", "炖鱼块（啥鱼？）", "鱼种待确认。", 17),
		photo(youth, "dish", "dish", "self_select", "红烧狮子头", "红烧狮子头", "", 18),
		photo(youth, "dish", "dish", "self_select", "蒜苔炒河虾", "蒜苔炒河虾", "", 19),
	}
	ingredientNames := []struct{ name, rawText, notes string }{
		{"豆皮", "豆皮", ""}, {"粉丝", "粉丝", ""}, {"山药", "山药", ""}, {"鸡胸肉", "鸡胸肉", ""},
		{"调理肉类（待确认）", "认不出来 一个鸭肉一个猪肉吧", "原文无法确认，疑似一份鸭肉和一份猪肉。"},
		{"豆皮", "豆皮", ""}, {"一口肠（品牌待确认）", "一口肠--这种丸子半成品最好知道商家用的啥牌子", "半成品品牌待确认。"},
		{"虫草花", "虫草花", ""}, {"腐竹", "腐竹", ""}, {"宽粉", "宽粉", ""}, {"玉米", "玉米", ""}, {"土豆粉", "土豆粉", ""},
		{"海带丝", "海带丝", ""}, {"魔芋结", "魔芋结", ""}, {"鹌鹑蛋", "鹌鹑蛋", ""}, {"调理鸭血", "调理鸭血", ""},
		{"千页豆腐", "千叶豆腐", ""}, {"木耳", "木耳", ""}, {"调理鸡肉条（品牌待确认）", "调理鸡肉条（啥牌子的？可以按安井算，但一般没这么奢侈）", "半成品品牌待确认，不按推测品牌入库。"},
		{"大白菜", "大白菜", ""}, {"茼蒿", "茼蒿", ""}, {"小白菜", "小白菜", ""}, {"冬瓜", "冬瓜", ""}, {"金针菇", "金针菇", ""},
		{"烤麸", "烤麸", ""}, {"苦苣", "苦苣", ""}, {"香菜", "香菜", ""}, {"卷心菜", "卷心菜", ""}, {"菠菜", "菠菜", ""},
		{"生菜", "生菜", ""}, {"荞麦方便面", "荞麦方便面", ""}, {"珠江面", "珠江面", ""}, {"手擀面", "手擀面", ""},
		{"薯格和胡萝卜格", "薯格和胡萝卜格。", ""}, {"小酥肉", "小酥肉", ""}, {"香菇", "香菇", ""}, {"豆芽", "豆芽", ""}, {"西兰花", "西兰花", ""},
	}
	for offset, item := range ingredientNames {
		rows = append(rows, photo(oneCity, "ingredient", "ingredient_display", "malatang", item.name, item.rawText, item.notes, offset+20))
	}
	selfSelectNames := []struct{ name, rawText, notes string }{
		{"西瓜", "西瓜", ""}, {"哈密瓜", "哈密瓜", ""}, {"卤鸭锁骨", "卤鸭锁骨", ""}, {"果仁菠菜", "果仁菠菜", ""},
		{"卤鸭脖", "卤鸭脖", ""}, {"凉拌鸡块（待确认）", "凉拌鸡块?", "原文带问号，需现场核实。"}, {"红烧肉炖鹌鹑蛋", "红烧肉炖鹌鹑蛋", ""},
		{"广式烧鸭", "广式烧鸭", ""}, {"小炒花菜", "小炒花菜", ""}, {"肉汤白菜炖豆泡", "肉汤白菜炖豆泡", ""}, {"固始鹅块", "固始鹅块", ""},
		{"湘味小炒鸡", "湘味小炒鸡", ""}, {"豆角炒肉末", "豆角炒肉末", ""}, {"番茄炒蛋", "番茄炒蛋", ""}, {"青椒炒肉", "青椒炒肉", ""},
		{"青椒炒蛋", "青椒炒蛋", ""}, {"醋溜土豆丝", "醋溜土豆丝", ""}, {"五花肉炒包菜粉丝", "五花肉炒包菜粉丝", ""}, {"包菜炒肉", "包菜炒肉", ""},
		{"虫草花蒸鸡块", "虫草花蒸鸡块", ""}, {"炸雪花鸡柳", "炸雪花鸡柳", ""}, {"三丝海白虾", "三丝海白虾", ""}, {"酸菜炖猪肉", "酸菜炖猪肉", ""},
		{"炸洋葱圈", "炸洋葱圈", ""}, {"紫薯花卷", "紫薯花卷", ""}, {"奶黄花卷", "奶黄花卷", ""},
	}
	for offset, item := range selfSelectNames {
		rows = append(rows, photo(fullSeat, "dish", "dish", "self_select", item.name, item.rawText, item.notes, offset+58))
	}
	return rows
}

func menu(windowName, entryType, serviceMode, name string, price float64, rawText string) menuSpec {
	return menuSpec{windowName: windowName, entryType: entryType, serviceMode: serviceMode, name: name, price: &price, priceType: "fixed", rawText: rawText}
}

func menuSpecs() []menuSpec {
	rows := []menuSpec{
		menu("悠悠凉皮", "menu_item", "made_to_order", "肉夹馍", 9.8, "肉夹馍 9.8元"),
		menu("悠悠凉皮", "menu_item", "made_to_order", "麻酱凉皮", 13.8, "麻酱凉皮13.8元"),
		menu("悠悠凉皮", "menu_item", "made_to_order", "麻酱牛筋面", 13.8, "麻酱牛筋面13.8元"),
		menu("悠悠凉皮", "menu_item", "made_to_order", "凉皮牛筋面两掺", 13.8, "凉皮牛筋面两掺13.8元"),
		menu("悠悠凉皮", "combo", "combo", "凉皮肉夹馍套餐", 21.8, "凉皮肉夹馍套餐21.8元"),
		menu("太卤力卤肉饭", "menu_item", "fixed_portion", "香卤鸭腿饭", 19.8, "香卤鸭腿饭19.8元"),
		menu("太卤力卤肉饭", "menu_item", "fixed_portion", "香卤鸡腿饭", 21.8, "香卤鸡腿饭21.8元"),
		menu("太卤力卤肉饭", "menu_item", "fixed_portion", "香卤把子肉饭", 22.8, "香卤把子肉饭22.8元"),
		menu("太卤力卤肉饭", "menu_item", "fixed_portion", "招牌卤肉饭", 23.8, "招牌卤肉饭23.8元"),
		menu("太卤力卤肉饭", "menu_item", "fixed_portion", "香卤猪肘饭", 24.8, "香卤猪肘饭24.8元"),
		menu("笑蜀面店·太和板面", "menu_item", "made_to_order", "原味拌面", 16.8, "原味拌面16.8元"),
		menu("笑蜀面店·太和板面", "menu_item", "made_to_order", "牛肉拌面", 22.8, "牛肉拌面22.8元"),
		menu("笑蜀面店·椒香拌面", "menu_item", "made_to_order", "西红柿鸡蛋拌面", 18.8, "西红柿鸡蛋拌面18.8元"),
		menu("笑蜀面店·椒香拌面", "menu_item", "made_to_order", "肉末土豆茄子拌面", 19.8, "肉末土豆茄子拌面19.8元"),
		menu("笑蜀面店·椒香拌面", "menu_item", "made_to_order", "辣爆小公鸡拌面", 22.8, "辣爆小公鸡拌面22.8元"),
		menu("笑蜀面店·椒香拌面", "menu_item", "made_to_order", "家乡小炒肉拌面", 23.8, "家乡小炒肉拌面23.8元"),
		menu("笑蜀面店·椒香拌面", "menu_item", "made_to_order", "小炒黄牛肉拌面", 24.8, "小炒黄牛肉拌面24.8元"),
		menu("陕婆婆粉汤烙饼", "menu_item", "made_to_order", "原味粉汤烙饼", 19.8, "原味粉汤烙饼19.8元"),
		menu("陕婆婆粉汤烙饼", "menu_item", "made_to_order", "酥肉粉汤烙饼", 21.8, "酥肉粉汤烙饼21.8元"),
		menu("陕婆婆粉汤烙饼", "menu_item", "made_to_order", "羊杂粉汤烙饼", 22.8, "羊杂粉汤烙饼22.8元"),
		menu("陕婆婆粉汤烙饼", "menu_item", "made_to_order", "牛肉粉汤烙饼", 23.8, "牛肉粉汤烙饼23.8元"),
		menu("陕婆婆粉汤烙饼", "menu_item", "made_to_order", "羊肉粉汤烙饼", 24.8, "羊肉粉汤烙饼24.8元"),
	}
	for _, drink := range []struct {
		name  string
		price float64
	}{
		{"百岁山", 3}, {"茶Π", 5}, {"名仁苏打水", 3}, {"维他命", 5}, {"芬达", 3}, {"屈臣氏", 15}, {"可口可乐", 3},
		{"东方树叶", 6}, {"雪碧", 3}, {"尖叫", 6}, {"健力宝", 4}, {"三得利", 6}, {"冰红茶", 4}, {"山楂树下", 6},
		{"茉莉蜜茶", 4}, {"雀巢咖啡", 7}, {"脉动", 5}, {"NFC 100%橙汁", 8},
	} {
		rows = append(rows, menu("饮料柜", "menu_item", "retail", drink.name, drink.price, fmt.Sprintf("%s%.1g元", drink.name, drink.price)))
	}
	return rows
}
