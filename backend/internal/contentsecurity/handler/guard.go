package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/contentsecurity/service"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	"github.com/gin-gonic/gin"
)

func Guard(svc *service.Service, store *storage.Client, scene int) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Restore the exact bytes so the existing handler still binds its own DTO.
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, (2<<20)+1))
		if err != nil || len(body) > 2<<20 {
			response.Error(c, commonerrors.ErrBadRequest)
			c.Abort()
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		var doc map[string]any
		if json.Unmarshal(body, &doc) != nil || doc == nil {
			response.Error(c, commonerrors.ErrBadRequest)
			c.Abort()
			return
		}
		// Phone/privacy switches are private fields; only profile content is checked.
		if c.FullPath() == "/api/user/profile" {
			profile := make(map[string]any)
			for _, field := range []string{"nickname", "motto", "avatar", "cover_image"} {
				if value, ok := doc[field]; ok {
					profile[field] = value
				}
			}
			doc = profile
		}
		userID := c.GetString(authmw.ContextUserIDKey)
		logger.Info(c.Request.Context(), "进入发布内容审核", slog.String("user_id", userID), slog.String("path", c.FullPath()))
		if err := svc.CheckDocument(c.Request.Context(), userID, scene, doc, store); err != nil {
			if err == service.ErrUnavailable {
				logger.Error(c.Request.Context(), "发布内容审核服务不可用", err, slog.String("user_id", userID), slog.String("path", c.FullPath()))
			} else {
				logger.Warn(c.Request.Context(), "发布内容审核未通过", slog.String("user_id", userID), slog.String("path", c.FullPath()))
			}
			response.Error(c, err)
			c.Abort()
			return
		}
		c.Next()
		if c.Writer.Status() < http.StatusBadRequest {
			logger.Info(c.Request.Context(), "发布内容审核及写入完成", slog.String("user_id", userID), slog.String("path", c.FullPath()))
		}
	}
}
