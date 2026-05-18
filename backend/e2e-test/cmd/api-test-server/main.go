package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"food_link/backend/e2e-test/runner"
	"food_link/backend/internal/app"
	authservice "food_link/backend/internal/auth/service"
	"food_link/backend/pkg/config"
)

func main() {
	var (
		suitePath  = flag.String("suite", "e2e-test/suite.yaml", "path to suite.yaml")
		configDir  = flag.String("config-dir", ".", "backend config directory")
		port       = flag.Int("port", 3010, "HTTP server port")
		keepDB     = flag.Bool("keep-db", false, "keep temporary database after shutdown")
		host       = flag.String("host", "127.0.0.1", "HTTP server host")
	)
	flag.Parse()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. Load suite
	suite, err := e2e.LoadSuite(*suitePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load suite: %v\n", err)
		os.Exit(1)
	}
	if *keepDB {
		suite.TempDB.Keep = true
	}

	// 2. Load backend config
	cfg, err := config.Load(*configDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}
	cfg.App.Env = "test"
	cfg.OTel.Enabled = false
	cfg.Worker.Count = 0
	cfg.TaskQueue.Driver = "memory"
	if cfg.JWT.Secret == "" {
		cfg.JWT.Secret = "api-contract-test-secret"
	}
	// Override listen address for test server
	cfg.App.Host = *host
	cfg.App.Port = *port

	// 3. Prepare temporary database
	tempDB, err := e2e.PrepareDatabase(ctx, suite, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to prepare database: %v\n", err)
		os.Exit(1)
	}
	cfg.Database = tempDB.Config

	// 4. Apply seed SQL fixtures
	vars := e2e.SuiteVars(suite)
	if err := e2e.ApplySeedSQL(ctx, suite, tempDB.DB(), vars); err != nil {
		_ = tempDB.Close(ctx)
		fmt.Fprintf(os.Stderr, "failed to apply seed sql: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("[TestServer] Temporary database ready: %s\n", tempDB.Name)

	// 5. Build Gin app
	gin.SetMode(gin.TestMode)
	application, err := app.New(cfg)
	if err != nil {
		_ = tempDB.Close(ctx)
		fmt.Fprintf(os.Stderr, "failed to create app: %v\n", err)
		os.Exit(1)
	}

	// 6. Register test-only routes
	registerTestRoutes(application.Engine(), cfg, tempDB.DB(), suite)

	// 7. Start HTTP server
	addr := cfg.ListenAddr()
	server := &http.Server{
		Addr:         addr,
		Handler:      application.Engine(),
		ReadTimeout:  20 * time.Second,
		WriteTimeout: 20 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		fmt.Printf("[TestServer] Listening on http://%s\n", addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "[TestServer] server error: %v\n", err)
		}
	}()

	// 8. Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	fmt.Println("[TestServer] Shutting down...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	_ = server.Shutdown(shutdownCtx)
	_ = application.Close(shutdownCtx)
	_ = tempDB.Close(shutdownCtx)

	fmt.Println("[TestServer] Shutdown complete.")
}

func registerTestRoutes(engine *gin.Engine, cfg *config.Config, db *gorm.DB, suite *e2e.Suite) {
	jwtSvc := authservice.NewJWTService(cfg.JWT.Secret, cfg.JWT.AccessTokenTTLSeconds, cfg.JWT.RefreshTokenTTLSeconds)

	test := engine.Group("/api/test")
	{
		// Health check
		test.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": "ok", "database": suite.TempDB.NamePrefix})
		})

		// Issue JWT token for a test user
		test.GET("/auth/token", func(c *gin.Context) {
			userName := c.Query("user")
			user, ok := suite.Auth.Users[userName]
			if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unknown user %q", userName)})
				return
			}
			token, err := jwtSvc.IssueAccess(user.ID, user.OpenID, user.UnionID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"token":      token,
				"token_type": "Bearer",
				"user_id":    user.ID,
				"openid":     user.OpenID,
				"unionid":    user.UnionID,
			})
		})

		// Execute read-only SQL query (for cross-layer assertions)
		test.POST("/db/query", func(c *gin.Context) {
			var req struct {
				Query string   `json:"query" binding:"required"`
				Args  []any    `json:"args"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			rows, err := db.WithContext(c.Request.Context()).Raw(req.Query, req.Args...).Rows()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			defer rows.Close()

			columns, _ := rows.Columns()
			var results []map[string]any
			for rows.Next() {
				values := make([]any, len(columns))
				valuePtrs := make([]any, len(columns))
				for i := range values {
					valuePtrs[i] = &values[i]
				}
				if err := rows.Scan(valuePtrs...); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				row := make(map[string]any)
				for i, col := range columns {
					row[col] = values[i]
				}
				results = append(results, row)
			}
			c.JSON(http.StatusOK, gin.H{"columns": columns, "rows": results, "count": len(results)})
		})

		// Reset database to fixture state (truncate + re-seed)
		test.POST("/db/reset", func(c *gin.Context) {
			// Truncate all user data tables
			tables := []string{
				"user_food_records", "user_water_logs", "user_weight_records",
				"user_exercise_logs", "food_expiry_items", "user_recipes",
				"user_pro_memberships", "user_body_metric_settings",
			}
			for _, table := range tables {
				if err := db.Exec("TRUNCATE TABLE " + table + " CASCADE").Error; err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("truncate %s: %v", table, err)})
					return
				}
			}
			// Re-apply fixtures
			vars := e2e.SuiteVars(suite)
			if err := e2e.ApplySeedSQL(c.Request.Context(), suite, db, vars); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "reset_complete"})
		})

		// Get suite vars (useful for runner to know auth user IDs)
		test.GET("/suite/vars", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"vars": e2e.SuiteVars(suite)})
		})
	}
}
