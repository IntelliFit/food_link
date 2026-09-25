package main

import (
	"context"
	"encoding/base64"
	"encoding/csv"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/marketingqr/catalog"
	utilityservice "food_link/backend/internal/utility/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"
)

var unsafeFilename = regexp.MustCompile(`[\\/:*?"<>|]+`)

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	outputDir := flag.String("output-dir", "", "directory for QR images and manifest.csv")
	envVersion := flag.String("env-version", "release", "mini program env version: release/trial/develop")
	imageDir := flag.String("upload-images-dir", "", "optional directory containing <ipadpos-id> image files")
	skipQR := flag.Bool("skip-qr", false, "upload images and write manifest without calling the WeChat QR API")
	flag.Parse()

	if strings.TrimSpace(*outputDir) == "" {
		log.Fatal("--output-dir is required")
	}
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	if err := os.MkdirAll(*outputDir, 0o755); err != nil {
		log.Fatalf("创建输出目录失败: %v", err)
	}

	dataset := catalog.DatasetSnapshot()
	products := append([]catalog.Product(nil), dataset.Products...)
	sort.SliceStable(products, func(i, j int) bool {
		return products[i].SalesSnapshot > products[j].SalesSnapshot
	})

	storageClient := storage.New(cfg.Storage)
	if strings.TrimSpace(*imageDir) != "" {
		uploadImages(storageClient, products, *imageDir)
	}

	qrService := utilityservice.NewQRCodeService(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	manifestPath := filepath.Join(*outputDir, "二维码清单.csv")
	manifestFile, err := os.Create(manifestPath)
	if err != nil {
		log.Fatalf("创建二维码清单失败: %v", err)
	}
	defer manifestFile.Close()
	if _, err := manifestFile.Write([]byte{0xEF, 0xBB, 0xBF}); err != nil {
		log.Fatalf("写入二维码清单 BOM 失败: %v", err)
	}
	writer := csv.NewWriter(manifestFile)
	defer writer.Flush()
	_ = writer.Write([]string{"序号", "短码", "商品名", "原分类", "价格", "销量快照", "scene", "图片地址", "二维码文件"})

	for index, product := range products {
		fileName := fmt.Sprintf("%03d-%s-%s.jpg", index+1, sanitizeFilename(product.Name), product.ExternalID)
		if !*skipQR {
			if err := generateQR(ctx, qrService, "mq="+product.Code, *envVersion, filepath.Join(*outputDir, fileName)); err != nil {
				log.Fatalf("生成商品二维码失败: code=%s name=%s err=%v", product.Code, product.Name, err)
			}
		}
		price := fmt.Sprintf("%.2f", product.PriceMin)
		if product.PriceMax > product.PriceMin {
			price = fmt.Sprintf("%.2f-%.2f", product.PriceMin, product.PriceMax)
		}
		_ = writer.Write([]string{
			fmt.Sprintf("%d", index+1),
			product.Code,
			product.Name,
			product.SourceCategory,
			price,
			fmt.Sprintf("%d", product.SalesSnapshot),
			"mq=" + product.Code,
			storageClient.BuildAccessURL("food-images", product.ImageKey),
			fileName,
		})
		log.Printf("二维码进度 %d/%d: %s", index+1, len(products)+1, product.Name)
	}

	takeoutFile := "000-统一外卖包装码.jpg"
	if !*skipQR {
		if err := generateQR(ctx, qrService, "mq="+catalog.TakeoutCode, *envVersion, filepath.Join(*outputDir, takeoutFile)); err != nil {
			log.Fatalf("生成统一外卖包装码失败: %v", err)
		}
	}
	_ = writer.Write([]string{"0", catalog.TakeoutCode, "统一外卖包装码", "外卖包装", "", "", "mq=" + catalog.TakeoutCode, "", takeoutFile})
	writer.Flush()
	if err := writer.Error(); err != nil {
		log.Fatalf("写入二维码清单失败: %v", err)
	}
	log.Printf("二维码导出完成: output=%s total=%d env_version=%s", *outputDir, len(products)+1, *envVersion)
}

func uploadImages(client *storage.Client, products []catalog.Product, imageDir string) {
	for index, product := range products {
		matches, err := filepath.Glob(filepath.Join(imageDir, product.ExternalID+".*"))
		if err != nil || len(matches) == 0 {
			log.Fatalf("找不到商品图片: product_id=%s", product.ExternalID)
		}
		data, err := os.ReadFile(matches[0])
		if err != nil {
			log.Fatalf("读取商品图片失败: product_id=%s err=%v", product.ExternalID, err)
		}
		contentType := "image/jpeg"
		switch strings.ToLower(filepath.Ext(matches[0])) {
		case ".png":
			contentType = "image/png"
		case ".webp":
			contentType = "image/webp"
		}
		if _, err := client.UploadBytes("food-images", product.ImageKey, data, contentType); err != nil {
			log.Fatalf("上传商品图片失败: product_id=%s err=%v", product.ExternalID, err)
		}
		log.Printf("图片上传进度 %d/%d: %s", index+1, len(products), product.Name)
	}
}

func generateQR(ctx context.Context, service *utilityservice.QRCodeService, scene, envVersion, outputPath string) error {
	value, err := service.GenerateQRCode(ctx, scene, "pages/index/index", 640, false, envVersion)
	if err != nil {
		return err
	}
	encoded := value
	if comma := strings.Index(encoded, ","); comma >= 0 {
		encoded = encoded[comma+1:]
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	return os.WriteFile(outputPath, data, 0o644)
}

func sanitizeFilename(value string) string {
	value = strings.TrimSpace(unsafeFilename.ReplaceAllString(value, "-"))
	if value == "" {
		return "未命名商品"
	}
	return value
}
