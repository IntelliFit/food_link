package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{}

func New() *Handler { return &Handler{} }

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

func (h *Handler) MapPicker(c *gin.Context) {
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, "<html><body><h1>map-picker migrated to Go backend</h1></body></html>")
}

func (h *Handler) TestBackendPage(c *gin.Context) {
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, "<html><body><h1>test-backend</h1></body></html>")
}

func (h *Handler) TestBackendLoginPage(c *gin.Context) {
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, "<html><body><h1>test-backend login</h1></body></html>")
}
