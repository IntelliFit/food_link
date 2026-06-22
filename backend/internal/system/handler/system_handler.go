package handler

import (
	"net/http"
	"os"
	"path/filepath"

	"food_link/backend/pkg/config"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	cfg *config.Config
}

func New(cfg *config.Config) *Handler { return &Handler{cfg: cfg} }

func (h *Handler) Root(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"service": "food_link backend (go)",
		"status":  "ok",
	})
}

func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}

func (h *Handler) PublicConfig(c *gin.Context) {
	allow := false
	if h.cfg != nil {
		allow = h.cfg.App.AllowDebugRegister
	}
	c.JSON(http.StatusOK, gin.H{
		"allow_debug_register": allow,
	})
}

func (h *Handler) MapPicker(c *gin.Context) {
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, "<html><body><h1>map-picker migrated to Go backend</h1></body></html>")
}

func (h *Handler) TestBackendPage(c *gin.Context) {
	if _, err := c.Cookie("test_backend_token"); err != nil {
		c.Redirect(http.StatusFound, "/test-backend/login")
		return
	}
	serveStaticHTML(c, filepath.Join("static", "test_backend", "index.html"))
}

func (h *Handler) TestBackendLoginPage(c *gin.Context) {
	serveStaticHTML(c, filepath.Join("static", "test_backend", "login.html"))
}

func (h *Handler) SnackAdminPage(c *gin.Context) {
	serveStaticHTML(c, filepath.Join("static", "snack_admin", "index.html"))
}

func serveStaticHTML(c *gin.Context, path string) {
	if _, err := os.Stat(path); err != nil {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusNotFound, "<html><body><h1>page not found</h1></body></html>")
		return
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.File(path)
}
