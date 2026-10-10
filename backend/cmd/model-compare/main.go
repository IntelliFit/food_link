package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"food_link/backend/internal/modelcompare/handler"
	"food_link/backend/internal/modelcompare/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

func main() {
	stdin := flag.Bool("credentials-stdin", false, "从stdin单行JSON读取ExternalConfig，不写凭证文件")
	configDir := flag.String("config-dir", ".", "复用现有后端配置，不连接业务数据库")
	checkImage := flag.String("check-image", "", "一次性六路原生图像核验，完成即退出")
	prompt := flag.String("prompt", "", "自行指定问题，不添加默认提示词")
	timeout := flag.Duration("timeout", 90*time.Second, "每渠道总截止时间（含图片发送）")
	protocol := flag.String("protocol", "native", "显式选择native/compat，不自动回退")
	listen := flag.String("listen", "127.0.0.1:38915", "仅限本机127.0.0.1监听")
	flag.Parse()
	logger.SetGlobal(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	var external config.ExternalConfig
	if *stdin {
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Buffer(make([]byte, 4096), 128<<10)
		if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &external) != nil {
			fmt.Fprintln(os.Stderr, "凭证输入无效")
			os.Exit(1)
		}
	} else {
		cfg, err := config.Load(*configDir)
		if err != nil {
			fmt.Fprintln(os.Stderr, "配置读取失败，请检查已有配置源")
			os.Exit(1)
		}
		external = cfg.External
	}
	svc := service.New(service.Providers(external))
	if *checkImage == "" {
		host, _, err := net.SplitHostPort(*listen)
		if err != nil || host != "127.0.0.1" {
			fmt.Fprintln(os.Stderr, "只允许监听127.0.0.1")
			os.Exit(1)
		}
		h, err := handler.New(svc, *listen)
		if err != nil {
			fmt.Fprintln(os.Stderr, "初始化对比页面失败")
			os.Exit(1)
		}
		gin.SetMode(gin.ReleaseMode)
		router := gin.New()
		router.Use(logger.RequestLogger(), gin.Recovery())
		for _, route := range []string{"/", "/app.js", "/style.css", "/api/config"} {
			router.GET(route, gin.WrapH(h))
		}
		router.POST("/api/compare", gin.WrapH(h))
		server := &http.Server{Addr: *listen, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 110 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
		listener, err := net.Listen("tcp", *listen)
		if err != nil {
			fmt.Fprintln(os.Stderr, "对比服务未能监听，可能端口已占用")
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "对比页面已就绪：http://"+*listen+"（不影响现有后端；关闭此进程即停止）")
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Fprintln(os.Stderr, "对比服务未能监听，可能端口已占用")
			os.Exit(1)
		}
		return
	}
	if *timeout < time.Second || *timeout > 180*time.Second || (*protocol != "native" && *protocol != "compat") {
		fmt.Fprintln(os.Stderr, "诊断参数无效")
		os.Exit(1)
	}
	data, err := os.ReadFile(*checkImage)
	if err != nil {
		fmt.Fprintln(os.Stderr, "图片读取失败")
		os.Exit(1)
	}
	photo, err := service.ReadPhoto(filepath.Base(*checkImage), data)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	var mu sync.Mutex
	enc := json.NewEncoder(os.Stdout)
	svc.Compare(context.Background(), photo, *prompt, *protocol, *timeout, func(result service.Result) {
		mu.Lock()
		defer mu.Unlock()
		_ = enc.Encode(map[string]any{"photo": photo, "original_image_path": *checkImage, "result": result})
	})
}
