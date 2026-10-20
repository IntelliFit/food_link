// Command canteen-capture-ops is the local operator (or local AI agent) entry
// point for window capture: pull the exception queue with original photos,
// submit resolutions, review withdrawals and price rewards once the amounts
// are published. Read commands never write; write commands require
// --confirm-db host/database/schema.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	appcore "food_link/backend/internal/app"
	catalogservice "food_link/backend/internal/campuscatalog/service"
	"food_link/backend/pkg/config"
)

const usage = `canteen-capture-ops <command> [flags]

Commands
  list-exceptions   -out DIR [-limit 10]
      Writes DIR/<session_id>/case.json (session, items, both model
      transcriptions, photo list) and downloads the original photos next to it.
  resolve           -file resolution.json --confirm-db TARGET
      resolution.json: {"session_id":"...","resolver":"claude-local",
        "resolutions":[{"key":"<item key>","action":"publish|keep|discard",
        "name":"","prices":[12],"price_unit":"","kind":"dish|combo|ingredient","note":""}]}
  withdrawals       [-status requested|paid|cancelled]
  review-withdrawal -id LEDGER_ID -decision paid|rejected [-note TEXT] --confirm-db TARGET
  release-rewards   --confirm-db TARGET   (after reward amounts are configured)

How a local agent settles exceptions
  1. list-exceptions into a fresh folder under D:\CodexWork\canteen-capture.
  2. For each case.json open every photo. Items with status "exception" carry
     reason codes (NAME_NOT_GROUNDED, PRICE_NOT_GROUNDED, PASSES_DISAGREE,
     MISSED_BY_PRIMARY, KIND_DISAGREE, PRICE_CONFLICT, ...).
  3. Decide only from what the photo shows: publish when the name and price
     are clearly written; fix name/prices if a model misread them; use keep for
     self-select ingredient prices; discard misreads and duplicates.
     Never invent a unit, a size for price tiers, a filling, or give a combo
     price to its option dishes. Unknown stays empty.
  4. Write one resolution.json per session and run resolve.`

func main() {
	if len(os.Args) < 2 || os.Args[1] == "help" || os.Args[1] == "-h" {
		fmt.Println(usage)
		return
	}
	command := os.Args[1]
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	configDir := flags.String("config-dir", ".", "directory containing backend config")
	confirmDB := flags.String("confirm-db", "", "required for writes; must equal host/database/schema")
	outDir := flags.String("out", "", "output folder for list-exceptions")
	limit := flags.Int("limit", 10, "maximum sessions or rows")
	file := flags.String("file", "", "resolution JSON file")
	status := flags.String("status", "requested", "withdrawal status filter")
	ledgerID := flags.String("id", "", "withdrawal ledger id")
	decision := flags.String("decision", "", "paid or rejected")
	note := flags.String("note", "", "review note")
	if err := flags.Parse(os.Args[2:]); err != nil {
		log.Fatal(err)
	}
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	schema := cfg.Database.Schema
	if schema == "" {
		schema = "public"
	}
	target := fmt.Sprintf("%s/%s/%s", cfg.Database.Host, cfg.Database.Name, schema)
	writes := map[string]bool{"resolve": true, "review-withdrawal": true, "release-rewards": true}
	if writes[command] && strings.TrimSpace(*confirmDB) != target {
		log.Fatalf("写入保护未通过：--confirm-db 必须为 %q", target)
	}
	cfg.Worker.Count = 0
	if err := os.Setenv("FOOD_LINK_DISABLE_BACKGROUND_MAINTENANCE", "1"); err != nil {
		log.Fatalf("设置运行环境失败: %v", err)
	}
	application, err := appcore.New(cfg)
	if err != nil {
		log.Fatalf("初始化应用失败: %v", err)
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = application.Close(closeCtx)
	}()
	svc := application.CampusCatalogService()
	if svc == nil {
		log.Fatal("食堂采集服务未初始化")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	switch command {
	case "list-exceptions":
		err = listExceptions(ctx, svc, *outDir, *limit)
	case "resolve":
		err = resolve(ctx, svc, *file)
	case "withdrawals":
		err = printJSON(svc.ListCaptureWithdrawals(ctx, *status, *limit))
	case "review-withdrawal":
		err = svc.ReviewCaptureWithdrawal(ctx, *ledgerID, *decision, *note)
	case "release-rewards":
		var count int
		count, err = svc.ReleaseRatePendingCaptureRewards(ctx, 1000)
		log.Printf("已按当前金额入账 %d 条待定奖励", count)
	default:
		fmt.Println(usage)
		os.Exit(2)
	}
	if err != nil {
		log.Fatalf("%s 失败: %v", command, err)
	}
}

func printJSON(value any, err error) error {
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func listExceptions(ctx context.Context, svc *catalogservice.CatalogService, outDir string, limit int) error {
	if strings.TrimSpace(outDir) == "" {
		return fmt.Errorf("必须通过 -out 指定输出目录")
	}
	cases, err := svc.ListCaptureExceptions(ctx, limit)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 60 * time.Second}
	for _, item := range cases {
		dir := filepath.Join(outDir, item.Session.ID)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		photos := []map[string]string{}
		for index, asset := range item.Assets {
			name := fmt.Sprintf("%02d-%s-%s.jpg", index, asset.Kind, asset.ID[:8])
			if err := download(ctx, client, asset.URL, filepath.Join(dir, name)); err != nil {
				log.Printf("下载照片失败 session=%s asset=%s: %v", item.Session.ID, asset.ID, err)
				name = ""
			}
			photos = append(photos, map[string]string{"asset_id": asset.ID, "kind": asset.Kind, "file": name,
				"item_key": asset.ItemKey, "dish_name": asset.DishName})
		}
		doc := map[string]any{"session": item.Session, "photos": photos}
		data, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "case.json"), data, 0o644); err != nil {
			return err
		}
	}
	log.Printf("已导出 %d 个待处理窗口到 %s", len(cases), outDir)
	return nil
}

func download(ctx context.Context, client *http.Client, url, path string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, io.LimitReader(response.Body, 25<<20))
	return err
}

type resolutionFile struct {
	SessionID   string                             `json:"session_id"`
	Resolver    string                             `json:"resolver"`
	Resolutions []catalogservice.CaptureResolution `json:"resolutions"`
}

func resolve(ctx context.Context, svc *catalogservice.CatalogService, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var input resolutionFile
	if err := json.Unmarshal(data, &input); err != nil {
		return fmt.Errorf("解析处理文件失败: %w", err)
	}
	return printJSON(svc.ResolveCaptureExceptions(ctx, input.SessionID, input.Resolver, input.Resolutions))
}
